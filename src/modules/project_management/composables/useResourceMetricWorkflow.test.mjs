import test from 'node:test'
import assert from 'node:assert/strict'
import { effectScope, ref, nextTick } from 'vue'
import { readFileSync } from 'node:fs'

// 用途：装配实际节点协调逻辑，仅替换现场完成和导航边界。
// 参数：complete 为原现场完成命令的结果边界。
// 返回值：当前会话、节点、协调状态和清理方法。
async function fixture(complete = async () => true) {
  const { useResourceMetricWorkflow } = await import('./useResourceMetricWorkflow.js')
  const session = ref({ tenant_id: 'tenant-a', user_id: 'manager', permissions: ['project.read'] })
  const selectedItem = ref({ id: 'SI-a', version: 1, status: '实施中' })
  const items = ref([selectedItem.value]), section = ref('implementation'), saving = ref(false)
  const canComplete = ref(true), navigations = []
  const scope = effectScope()
  const state = scope.run(() => useResourceMetricWorkflow({ session, selectedItem, items,
    section, saving, canComplete, complete, loadEquipment: () => {},
    navigateCenter: id => navigations.push(id),
  }))
  return { ...state, session, selectedItem, items, section, saving, canComplete,
    navigations, stop: () => scope.stop() }
}

test('节点入口带出当前服务项，关闭或切换栏目保留原未知资源命令', async () => {
  const h = await fixture()
  try {
    h.open('capacity')
    assert.equal(h.dialog.value.itemID, 'SI-a')
    assert.equal(h.dialog.value.initialTab, 'capacity')
    h.commands.value.pending = { payload: { service_item_id: 'SI-a' }, key: 'original' }
    h.close(); assert.ok(h.commands.value.pending)
    h.open('usage'); h.section.value = 'reports'; await nextTick()
    assert.equal(h.dialog.value, null)
    assert.equal(h.commands.value.pending.key, 'original')
    h.openCenter(); assert.deepEqual(h.navigations, ['SI-a'])
  } finally { h.stop() }
})

test('现场完成核对不新增用量门禁，原命令拒绝保留窗口，确认保存后关闭', async () => {
  let accepted = false, calls = 0
  const h = await fixture(async () => { calls++; return accepted })
  try {
    h.open('usage', true)
    h.commands.value.pending = { payload: { service_item_id: 'SI-a' }, key: 'unresolved' }
    await h.finish()
    assert.equal(calls, 1)
    assert.ok(h.dialog.value)
    accepted = true; await h.finish()
    assert.equal(h.dialog.value, null)
    assert.equal(h.commands.value.pending.key, 'unresolved')
    h.open('usage', true); h.canComplete.value = false; await h.finish()
    assert.equal(calls, 2)
  } finally { h.stop() }
})

test('切换用户或租户丢弃旧界面上下文，旧命令对象不能进入新会话', async () => {
  const h = await fixture()
  try {
    h.open('usage', true)
    const previous = h.commands.value
    previous.pending = { key: 'private-key' }
    h.session.value = { tenant_id: 'tenant-b', user_id: 'other', permissions: ['project.read'] }
    await nextTick()
    assert.equal(h.dialog.value, null)
    assert.notEqual(h.commands.value, previous)
    assert.equal(h.commands.value.pending, null)
    previous.pending = { key: 'late-callback' }
    assert.equal(h.commands.value.pending, null)
  } finally { h.stop() }
})

test('实际现场完成已保存但刷新失败仍返回已确认，避免重复结束', async () => {
  const source = readFileSync(new URL('../views/ProjectManagementView.vue', import.meta.url), 'utf8')
  const body = source.match(/async function runOperation\(kind\) \{[^]*?\n\}/)?.[0]
  assert.ok(body)
  const notices = [], writes = []
  const inputs = {
    saving: ref(false), selectedServiceItem: ref({ id: 'SI-a', version: 3 }), selectedServiceItems: ref([]),
    operationForm: ref({ fieldIncompleteReason: '' }), fieldEvidenceBlocksCompletion: ref(false),
    selectedFieldEvidence: ref({}), selectedFieldEvidenceGaps: ref([]),
    fieldEvidenceReasonMismatch: () => '',
    completeServiceItemField: async (...args) => { writes.push(args) },
    refreshAfterWrite: async () => { throw new Error('刷新失败') },
    showToast: (message, tone) => notices.push({ message, tone }),
    formatUserError: error => error.message,
  }
  const run = new Function(...Object.keys(inputs), `${body}; return runOperation`)(...Object.values(inputs))
  assert.equal(await run('complete'), true)
  assert.equal(writes.length, 1)
  assert.match(notices.at(-1).message, /已保存|已确认/)
  assert.equal(notices.at(-1).tone, 'warning')
})
