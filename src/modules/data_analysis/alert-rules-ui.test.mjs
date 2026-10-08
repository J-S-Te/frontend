import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

const source = await readFile(new URL('./views/AlertRulesView.vue', import.meta.url), 'utf8')
const script = source.match(/<script setup>([\s\S]*?)<\/script>/)[1].replace(/^import .*$/gm, '')
const existing = () => ({ id: 42, version: 3, created_at: '2026-10-01', rule_code: 'CONTRACT_EXPIRY', name: '合同提醒', source_fct: 'dim_contract', severity: 'MEDIUM', enabled: false, threshold_json: '{"days":30}' })

function harness({ permissions = ['alert.manage'], get = async () => [existing()], put, remove, confirm = true } = {}) {
  const calls = { put: [], remove: [], confirm: [] }
  const context = vm.createContext({
    ref: (value) => ({ value }),
    computed: (getter) => ({ get value() { return getter() } }),
    defineProps: () => ({ permissions }),
    onMounted: () => {}, onBeforeUnmount: () => {},
    window: { clearTimeout() {}, setTimeout() { return 1 }, confirm(message) { calls.confirm.push(message); return confirm } },
    getAlertRules: get,
    putAlertRules: async (payload) => { calls.put.push(payload); return put ? put(payload) : payload },
    deleteAlertRule: async (id) => { calls.remove.push(id); if (remove) await remove(id) },
  })
  vm.runInContext(`${script}\nglobalThis.ui = { rules, loading, error, saving, toast, editing, draft, canWrite, canCreate, load, toggleRule, openEditor, closeEditor, saveEditor, removeRule, setDraftThresholdDays }`, context)
  return { ui: context.ui, calls }
}

test('alert.manage grants management without an admin role in permissions', async () => {
  const { ui } = harness()
  await ui.load()
  assert.equal(ui.canWrite.value, true)
  ui.openEditor(ui.rules.value[0])
  assert.equal(ui.editing.value, 'edit')
  assert.doesNotMatch(source, /isAdmin|permissions\.includes\("admin"\)/)
})

test('read only, loading and failed loads block every mutation', async () => {
  for (const options of [{ permissions: ['alert.view'] }, { get: async () => { throw Error('加载失败') } }]) {
    const { ui, calls } = harness(options)
    await ui.load()
    const rule = existing()
    ui.rules.value = [rule]
    ui.openEditor(rule)
    await ui.toggleRule(rule)
    await ui.removeRule(rule)
    await ui.saveEditor()
    assert.equal(ui.editing.value, null)
    assert.equal(calls.put.length + calls.remove.length + calls.confirm.length, 0)
  }
  const { ui, calls } = harness()
  ui.rules.value = [existing()]
  ui.openEditor()
  await ui.toggleRule(ui.rules.value[0])
  await ui.removeRule(ui.rules.value[0])
  assert.equal(calls.put.length + calls.remove.length, 0)
})

test('toggle persists immediately and prevents concurrent mutation until saved', async () => {
  let resolveSave
  const { ui, calls } = harness({ put: () => new Promise((resolve) => { resolveSave = resolve }) })
  await ui.load()
  const rule = ui.rules.value[0]
  const pending = ui.toggleRule(rule)
  assert.equal(ui.saving.value, true)
  assert.equal(rule.enabled, false)
  assert.equal(calls.put[0][0].enabled, true)
  assert.equal(calls.put[0][0].version, 3)
  await ui.toggleRule(rule)
  await ui.removeRule(rule)
  ui.openEditor(rule)
  assert.equal(calls.put.length, 1)
  assert.equal(calls.remove.length, 0)
  assert.equal(ui.editing.value, null)
  resolveSave(calls.put[0])
  await pending
  assert.equal(ui.rules.value[0].enabled, true)
  assert.equal(ui.saving.value, false)
})

test('concurrent reloads cannot release the write gate while a request is pending', async () => {
  let resolveLoad
  let reads = 0
  const { ui } = harness({ get: () => { reads += 1; return new Promise((resolve) => { resolveLoad = resolve }) } })
  const pending = ui.load()
  await ui.load()
  assert.equal(reads, 1)
  assert.equal(ui.loading.value, true)
  assert.equal(ui.canWrite.value, false)
  resolveLoad([existing()])
  await pending
  assert.equal(ui.canWrite.value, true)
})

test('failed toggle preserves saved state and version conflicts require refresh', async () => {
  const { ui, calls } = harness({ put: async () => { throw Object.assign(Error('冲突'), { code: 'RULE_VERSION_CONFLICT' }) } })
  await ui.load()
  const rule = ui.rules.value[0]
  await ui.toggleRule(rule)
  assert.equal(rule.enabled, false)
  assert.equal(ui.rules.value[0], rule)
  assert.equal(ui.saving.value, false)
  assert.match(ui.toast.value, /刷新规则后重试/)
  assert.equal(calls.put.length, 1)
})

test('empty list can create only the supported rule, disabled by default', async () => {
  const { ui, calls } = harness({ get: async () => [] })
  await ui.load()
  ui.openEditor()
  assert.equal(ui.draft.value.rule_code, 'CONTRACT_EXPIRY')
  assert.equal(ui.draft.value.enabled, false)
  ui.draft.value.name = '  合同到期提醒  '
  await ui.saveEditor()
  assert.equal(calls.put[0][0].enabled, false)
  assert.equal(calls.put[0][0].name, '合同到期提醒')
  assert.equal(ui.editing.value, null)
  assert.equal(ui.canCreate.value, false)
  ui.openEditor()
  assert.equal(ui.editing.value, null)
  assert.match(source, /当前支持合同到期提醒（CONTRACT_EXPIRY）/)
})

test('editor validates thresholds and preserves identity and persisted state on failure', async () => {
  const { ui, calls } = harness({ put: async () => { throw Error('保存失败') } })
  await ui.load()
  const original = ui.rules.value[0]
  ui.openEditor(original)
  for (const days of [0, 3651, 1.5, '']) {
    ui.setDraftThresholdDays(days)
    await ui.saveEditor()
    assert.equal(calls.put.length, 0)
  }
  ui.setDraftThresholdDays(3650)
  ui.draft.value.name = '更新名称'
  await ui.saveEditor()
  assert.equal(calls.put[0][0].id, original.id)
  assert.equal(calls.put[0][0].version, original.version)
  assert.equal(calls.put[0][0].created_at, original.created_at)
  assert.equal(ui.rules.value[0].name, '合同提醒')
  assert.equal(ui.editing.value, 'edit')
  assert.equal(ui.saving.value, false)
})

test('deletion requires confirmation and history rejection keeps the rule visible', async () => {
  const canceled = harness({ confirm: false })
  await canceled.ui.load()
  await canceled.ui.removeRule(canceled.ui.rules.value[0])
  assert.equal(canceled.calls.remove.length, 0)
  assert.match(canceled.calls.confirm[0], /已有历史预警的规则只能停用/)
  const rejected = harness({ remove: async () => { throw Error('已有历史预警的规则只能停用') } })
  await rejected.ui.load()
  await rejected.ui.removeRule(rejected.ui.rules.value[0])
  assert.equal(rejected.ui.rules.value.length, 1)
  assert.match(rejected.ui.toast.value, /只能停用/)
  const success = harness()
  await success.ui.load()
  await success.ui.removeRule(success.ui.rules.value[0])
  assert.equal(success.ui.rules.value.length, 0)
})
