import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { ref } from 'vue'

const source = readFileSync(new URL('./ProjectManagementView.vue', import.meta.url), 'utf8')
const operations = [
  ['revokeSelectedAssignment', ['team']],
  ['returnSelectedToDecomposition', []],
  ['withdrawPendingRollback', ['REQUEST']],
  ['revokeDeliveryPhase', ['plan']],
  ['submitRollbackRequest', ['FIELD_TO_PREPARATION']],
  ['decidePendingRollback', ['REQUEST', 'APPROVED']],
]

// 用途：执行真实组件函数并注入延迟输入与隔离 API，验证写入边界。
// 参数：operation 为要执行的动作名。
// 返回值：测试上下文、输入完成器与业务请求记录。
function harness(operation) {
  const item = { id: 'SI-1', version: 5, status: '待分配', team_lead_id: 'LEAD', project_manager_id: 'MANAGER' }
  if (operation === 'revokeDeliveryPhase') item.status = '待实施'
  if (operation === 'submitRollbackRequest') item.status = '实施中'
  const request = { id: 'REQ-1', service_item_id: item.id, actor_user_id: operation === 'decidePendingRollback' ? 'OTHER' : 'USER' }
  const writes = [], prompts = []
  let resolve
  const context = {
    saving: ref(false), promptDialog: ref(null), activeSection: ref('allocation'),
    session: ref({ user_id: 'USER', tenant_id: 'TENANT' }),
    selectedServiceItemIDs: ref([item.id]), serviceItems: ref([item]),
    selectedServiceItem: ref(item), selectedServiceItems: ref([item]), pendingRollbackRequests: ref([request]),
    canRevokeTeam: ref(true), canRevokeExecution: ref(true), canManageDecomposition: ref(true),
    canRevokeImplementation: ref(true), canRequestRollback: ref(true), canApproveRollback: ref(true),
    askPrompt: (options) => { prompts.push(options); context.promptDialog.value = options; return new Promise((yes) => { resolve = yes }) },
    showToast: () => {}, formatUserError: () => '', loadWorkspace: async () => {}, refreshAfterWrite: async () => {},
    window: { prompt: () => { throw new Error('必须使用可等待的共享输入弹窗') } },
  }
  for (const name of ['revokeTeamAssignment', 'revokeExecutionAssignment', 'returnServiceItemToDecomposition', 'withdrawRollback', 'revokeImplementationPlan', 'revokePreparation', 'requestRollback', 'decideRollback']) {
    context[name] = async (...args) => writes.push([name, ...args])
  }
  const names = ['captureReasonContext', 'reasonContextCurrent', 'askOperationReason', operation]
  const functions = names.map((name) => {
    const start = source.search(new RegExp(`(?:async )?function ${name}\\(`))
    if (start < 0 && name !== operation) return ''
    assert.ok(start >= 0, `缺少动作 ${name}`)
    return source.slice(start, source.indexOf('\n}', start) + 2)
  })
  const run = vm.runInNewContext(`${functions.join('\n')}\n${operation}`, context)
  return { context, item, request, writes, prompts, run: (args) => run(...args.map((arg) => arg === 'REQUEST' ? request : arg)), finish: (value) => { context.promptDialog.value = null; resolve(value) } }
}

for (const [name, args] of operations) {
  test(`${name}：取消原因弹窗不发业务请求`, async () => {
    const h = harness(name)
    const pending = h.run(args)
    assert.equal(h.prompts.length, 1)
    assert.ok(h.prompts[0].confirmText)
    assert.equal(h.prompts[0].minlength, 1)
    h.finish(null)
    await pending
    assert.equal(h.writes.length, 0)
    assert.equal(h.context.saving.value, false)
  })
  test(`${name}：提交保留原版本与非空原因，重复点击不替换输入`, async () => {
    const h = harness(name)
    const pending = h.run(args)
    await h.run(args)
    assert.equal(h.prompts.length, 1)
    h.finish('  业务原因  ')
    await pending
    assert.equal(h.writes.length, 1)
    const payload = h.writes[0].at(-1)
    assert.equal(payload.reason || payload.comment, '业务原因')
    if (name !== 'withdrawPendingRollback') assert.equal(payload.expected_version, 5)
    assert.equal(h.context.saving.value, false)
  })
  test(`${name}：空白原因与接口失败均不会保留提交忙锁`, async () => {
    const empty = harness(name)
    const cancelled = empty.run(args)
    empty.finish('   ')
    await cancelled
    assert.equal(empty.writes.length, 0)
    assert.equal(empty.context.saving.value, false)
    const failed = harness(name)
    for (const api of ['revokeTeamAssignment', 'returnServiceItemToDecomposition', 'withdrawRollback', 'revokeImplementationPlan', 'requestRollback', 'decideRollback']) {
      failed.context[api] = async () => { throw new Error('隔离接口失败') }
    }
    const pending = failed.run(args)
    failed.finish('业务原因')
    await pending
    assert.equal(failed.context.saving.value, false)
  })
  for (const change of ['selection', 'version', 'permission', 'busy', 'section', 'session', 'request']) {
    if (change === 'request' && !['withdrawPendingRollback', 'decidePendingRollback'].includes(name)) continue
    test(`${name}：等待输入时 ${change} 改变会停止写入`, async () => {
      const h = harness(name)
      const pending = h.run(args)
      if (change === 'selection') h.context.selectedServiceItemIDs.value = ['SI-OTHER']
      if (change === 'version') h.context.serviceItems.value[0].version += 1
      if (change === 'permission') for (const [key, value] of Object.entries(h.context)) if (key.startsWith('can')) value.value = false
      if (change === 'busy') h.context.saving.value = true
      if (change === 'section') h.context.activeSection.value = 'projects'
      if (change === 'session') h.context.session.value = { user_id: 'OTHER', tenant_id: 'TENANT' }
      if (change === 'request') h.context.pendingRollbackRequests.value = []
      h.finish('业务原因')
      await pending
      assert.equal(h.writes.length, 0)
    })
  }
}

test('报告整改中的返工申请保留当前版本与必填原因', async () => {
  const h = harness('submitRollbackRequest')
  Object.assign(h.context.selectedServiceItem.value,
    { status: '现场实施完成', report_status: 'RECTIFYING' })
  const pending = h.run(['REPORT_TO_FIELD'])
  assert.equal(h.prompts.length, 1)
  h.finish('整改后需要再次现场测评')
  await pending
  assert.equal(h.writes.length, 1)
  assert.equal(h.writes[0][2].kind, 'REPORT_TO_FIELD')
  assert.equal(h.writes[0][2].expected_version, 5)
  assert.equal(h.writes[0][2].reason, '整改后需要再次现场测评')
})

test('报告返工等待原因时进入签发阶段会停止写入', async () => {
  const h = harness('submitRollbackRequest')
  Object.assign(h.context.selectedServiceItem.value,
    { status: '现场实施完成', report_status: 'RECTIFYING' })
  const pending = h.run(['REPORT_TO_FIELD'])
  assert.equal(h.prompts.length, 1)
  h.context.selectedServiceItem.value.report_status = 'ISSUED'
  h.finish('需要再次现场测评')
  await pending
  assert.equal(h.writes.length, 0)
})
