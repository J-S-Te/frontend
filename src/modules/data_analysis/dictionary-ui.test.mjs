import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'

const source = await readFile(new URL('./views/DictionaryView.vue', import.meta.url), 'utf8')
const script = source.match(/<script setup>([\s\S]*?)<\/script>/)[1].replace(/^import .*$/gm, '')
const metric = (extra = {}) => ({ code: 'TEST_COUNT', name: '统计数量', dashboard: '项目看板', definition: '统计口径', formula: 'count', source: '项目', period: '月', status: '已确认', version: 3, origin: 'CUSTOM', enabled: false, can_enable: false, calculation_binding: '', ...extra })
function harness({ permissions = ['dictionary.manage'], get = async () => ({ metrics: [metric()] }), create, update, toggle, remove, versions, confirm = true } = {}) {
  const calls = { create: [], update: [], toggle: [], remove: [], versions: [], confirm: [] }
  const context = vm.createContext({ ref: (value) => ({ value }), computed: (getter) => ({ get value() { return getter() } }), defineProps: () => ({ permissions }), onMounted() {}, window: { confirm(message) { calls.confirm.push(message); return confirm } },
    getDictionary: get,
    createDictionaryMetric: async (payload) => { calls.create.push(payload); return create ? create(payload) : metric({ ...payload, enabled: false, version: 1 }) },
    updateDictionaryMetric: async (code, payload) => { calls.update.push({ code, payload }); return update ? update(code, payload) : metric({ ...payload, code, version: payload.version + 1 }) },
    setDictionaryMetricEnabled: async (code, enabled, version) => { calls.toggle.push({ code, enabled, version }); return toggle ? toggle(code, enabled, version) : metric({ code, enabled, version: version + 1 }) },
    deleteDictionaryMetric: async (code, version) => { calls.remove.push({ code, version }); if (remove) await remove(code, version) },
    getDictionaryMetricVersions: async (code) => { calls.versions.push(code); return versions ? versions(code) : [{ metric: metric(), operation: 'UPDATE', actor_id: 'user', created_at: '2026-10-08' }] },
  })
  vm.runInContext(`${script}\nglobalThis.ui = { dictionary, loading, error, canManage, canWrite, saving, draft, editing, editorError, toast, history, historyLoading, historyError, load, openEditor, closeEditor, saveEditor, toggleMetric, removeMetric, openHistory, closeHistory }`, context)
  return { ui: context.ui, calls }
}
test('dictionary component script and template compile', () => {
  const { descriptor, errors } = parse(source)
  assert.deepEqual(errors, [])
  const compiled = compileScript(descriptor, { id: 'dictionary' })
  assert.deepEqual(compileTemplate({ source: descriptor.template.content, filename: 'DictionaryView.vue', id: 'dictionary', compilerOptions: { bindingMetadata: compiled.bindings } }).errors, [])
})
test('management uses dictionary.manage; admin alone cannot mutate and read errors block writes', async () => {
  const writable = harness()
  await writable.ui.load()
  writable.ui.openEditor()
  assert.equal(writable.ui.editing.value.mode, 'create')
  for (const options of [{ permissions: ['admin'] }, { get: async () => { throw Error('服务不可用') } }]) {
    const { ui, calls } = harness(options)
    await ui.load()
    ui.openEditor(metric())
    await ui.toggleMetric(metric({ enabled: true }))
    await ui.removeMetric(metric())
    assert.equal(ui.editing.value, null)
    assert.equal(calls.toggle.length + calls.remove.length + calls.confirm.length, 0)
  }
  assert.doesNotMatch(source, /isAdmin|permissions\.includes\("admin"\)/)
})
test('duplicate loads are serialized and failed loads can retry', async () => {
  let resolve
  let reads = 0
  const { ui } = harness({ get: () => { reads++; return new Promise((r) => { resolve = r }) } })
  const pending = ui.load()
  await ui.load()
  assert.equal(reads, 1)
  assert.equal(ui.canWrite.value, false)
  resolve({ metrics: [metric()] })
  await pending
  assert.equal(ui.canWrite.value, true)
  let failure = true
  const retry = harness({ get: async () => { if (failure) throw Error('失败'); return { metrics: [metric()] } } })
  await retry.ui.load()
  assert.equal(retry.ui.error.value, '失败')
  failure = false
  await retry.ui.load()
  assert.equal(retry.ui.error.value, null)
})
test('create sends only user fields, server defaults disabled and refresh retains created metric', async () => {
  let persisted = []
  const { ui, calls } = harness({ get: async () => ({ metrics: persisted }), create: async (payload) => { const saved = metric({ ...payload, enabled: false, version: 1 }); persisted = [saved]; return saved } })
  await ui.load()
  ui.openEditor()
  ui.draft.value = metric({ code: 'NEW_COUNT', enabled: true, can_enable: true, calculation_binding: 'evil', origin: 'BUILTIN' })
  await ui.saveEditor()
  assert.equal(ui.dictionary.value.metrics[0].enabled, false)
  assert.equal(ui.editing.value, null)
  for (const key of ['enabled', 'version', 'origin', 'can_enable', 'calculation_binding']) assert.equal(key in calls.create[0], false)
  await ui.load()
  assert.equal(ui.dictionary.value.metrics[0].code, 'NEW_COUNT')
})
test('edit preserves immutable code and version, failure leaves editor and saved row intact', async () => {
  const { ui, calls } = harness({ update: async () => { throw Object.assign(Error('版本冲突'), { status: 409 }) } })
  await ui.load()
  ui.openEditor(ui.dictionary.value.metrics[0])
  ui.draft.value.code = 'OTHER'
  ui.draft.value.name = '修订名称'
  await ui.saveEditor()
  assert.equal(calls.update[0].code, 'TEST_COUNT')
  assert.equal(calls.update[0].payload.version, 3)
  assert.equal('code' in calls.update[0].payload, false)
  assert.equal(ui.dictionary.value.metrics[0].name, '统计数量')
  assert.equal(ui.editing.value.mode, 'edit')
  assert.match(ui.editorError.value, /刷新指标字典后重试/)
})
test('invalid fields never reach the API and the draft survives validation', async () => {
  const { ui, calls } = harness()
  await ui.load()
  ui.openEditor()
  for (const invalid of [metric({ code: '/bad' }), metric({ code: 'A'.repeat(65) }), metric({ code: 'NEW', name: '' }), metric({ code: 'NEW', formula: 'x'.repeat(513) }), metric({ code: 'TEST_COUNT' })]) {
    ui.draft.value = invalid
    await ui.saveEditor()
    assert.equal(calls.create.length, 0)
    assert.equal(ui.editing.value.mode, 'create')
    assert.ok(ui.editorError.value)
  }
})
test('enable requires server can_enable, existing enabled metric can disable, errors preserve state', async () => {
  const { ui, calls } = harness({ toggle: async () => { throw Error('更新失败') } })
  await ui.load()
  await ui.toggleMetric(ui.dictionary.value.metrics[0])
  assert.equal(calls.toggle.length, 0)
  const enabled = metric({ enabled: true })
  ui.dictionary.value.metrics = [enabled]
  await ui.toggleMetric(enabled)
  assert.equal(calls.toggle[0].enabled, false)
  assert.equal(calls.toggle[0].version, 3)
  assert.equal(ui.dictionary.value.metrics[0].enabled, true)
  assert.match(ui.toast.value, /更新失败/)
})
test('pending writes freeze all mutations and do not optimistically change enabled state', async () => {
  let resolve
  const { ui, calls } = harness({ toggle: () => new Promise((r) => { resolve = r }) })
  await ui.load()
  const item = metric({ can_enable: true })
  ui.dictionary.value.metrics = [item]
  const pending = ui.toggleMetric(item)
  await ui.toggleMetric(item)
  await ui.removeMetric(item)
  await ui.load()
  ui.openEditor(item)
  assert.equal(ui.saving.value, true)
  assert.equal(ui.dictionary.value.metrics[0].enabled, false)
  assert.equal(calls.toggle.length, 1)
  assert.equal(calls.remove.length, 0)
  assert.equal(ui.editing.value, null)
  resolve(metric({ enabled: true, version: 4 }))
  await pending
  assert.equal(ui.dictionary.value.metrics[0].enabled, true)
})
test('delete protects builtins, confirms custom, preserves referenced row, then removes on success', async () => {
  const builtin = harness()
  await builtin.ui.load()
  await builtin.ui.removeMetric(metric({ origin: 'BUILTIN' }))
  assert.equal(builtin.calls.confirm.length, 0)
  const canceled = harness({ confirm: false })
  await canceled.ui.load()
  await canceled.ui.removeMetric(metric())
  assert.equal(canceled.calls.remove.length, 0)
  const referenced = harness({ remove: async () => { throw Error('指标已被引用') } })
  await referenced.ui.load()
  await referenced.ui.removeMetric(metric())
  assert.equal(referenced.ui.dictionary.value.metrics.length, 1)
  assert.match(referenced.ui.toast.value, /已被引用/)
  const success = harness()
  await success.ui.load()
  await success.ui.removeMetric(metric())
  assert.equal(success.calls.remove[0].version, 3)
  assert.equal(success.ui.dictionary.value.metrics.length, 0)
})
test('history supports read permissions, errors retry, closing discards late responses', async () => {
  let resolve
  const { ui } = harness({ permissions: ['dictionary.view'], versions: () => new Promise((r) => { resolve = r }) })
  const pending = ui.openHistory(metric())
  assert.equal(ui.historyLoading.value, true)
  ui.closeHistory()
  resolve([{ metric: metric(), operation: 'CREATE' }])
  await pending
  assert.equal(ui.history.value, null)
  let failure = true
  const retry = harness({ versions: async () => { if (failure) throw Error('历史不可用'); return [{ metric: metric(), operation: 'UPDATE' }] } })
  await retry.ui.openHistory(metric())
  assert.equal(retry.ui.historyError.value, '历史不可用')
  failure = false
  await retry.ui.openHistory(retry.ui.history.value)
  assert.equal(retry.ui.history.value.versions[0].metric.version, 3)
})
test('dictionary API routes encode code and pass version on all changes', async () => {
  const api = await readFile(new URL('./api/dataAnalysis.js', import.meta.url), 'utf8')
  const relevant = api.slice(api.indexOf('export function getDictionary()'), api.indexOf('/**\n * listSources'))
  const calls = []
  const context = vm.createContext({ request: (path, options) => { calls.push({ path, options }); return Promise.resolve({}) }, encodeURIComponent })
  vm.runInContext(relevant.replace(/export /g, '') + '\nglobalThis.api = { getDictionary, createDictionaryMetric, updateDictionaryMetric, setDictionaryMetricEnabled, deleteDictionaryMetric, getDictionaryMetricVersions }', context)
  await context.api.getDictionary()
  await context.api.createDictionaryMetric({ code: 'NEW' })
  await context.api.updateDictionaryMetric('A/B', { version: 0, name: '名称' })
  await context.api.setDictionaryMetricEnabled('A/B', false, 0)
  await context.api.deleteDictionaryMetric('A/B', 4)
  await context.api.getDictionaryMetricVersions('A/B')
  assert.deepEqual(calls.map((c) => [c.path, c.options?.method || 'GET']), [['/dictionary', 'GET'], ['/dictionary/metrics', 'POST'], ['/dictionary/metrics/A%2FB', 'PUT'], ['/dictionary/metrics/A%2FB/enabled', 'PATCH'], ['/dictionary/metrics/A%2FB', 'DELETE'], ['/dictionary/metrics/A%2FB/versions', 'GET']])
  assert.deepEqual(JSON.parse(calls[3].options.body), { enabled: false, version: 0 })
  assert.deepEqual(JSON.parse(calls[4].options.body), { version: 4 })
  assert.doesNotMatch(relevant, /putDictionary/)
})
