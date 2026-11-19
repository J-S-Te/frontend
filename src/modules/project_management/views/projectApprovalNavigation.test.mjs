import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { openNotificationTarget } from '../../shared/utils/notificationNavigation.js'
import { approvalTaskTarget } from '../approvalTasks.js'

test('新项目待办携带完整业务坐标进入原处理页，保存及未知范围写入阻止导航', async () => {
  const source = readFileSync(new URL('./ProjectManagementView.vue', import.meta.url), 'utf8')
  const open = source.match(/function openApprovalRequest\([^]*?\n\}/)[0]
  const guard = source.match(/function guardApprovalNavigation\([^]*?\n\}/)[0]
  const opens = [], notices = []
  const context = { approvalTaskTarget, URLSearchParams,
    openProjectNotificationTarget: async item => { opens.push(item.target_url); return true },
    openApprovalTarget: async () => { throw new Error('新类型不能走旧审批页') },
    saving: { value: false }, nativeScopeLocked: { value: false },
    showToast: message => notices.push(message) }
  const ui = vm.runInNewContext(`${open}\n${guard}\n({openApprovalRequest,guardApprovalNavigation})`, context)
  await ui.openApprovalRequest({ id: 'DV-2', type: 'FIELD_DEVIATION', service_item_id: 'SI-2' })
  assert.deepEqual(opens, ['/project_management/exceptions?service_item_id=SI-2&deviation_id=DV-2'])
  assert.equal(ui.guardApprovalNavigation(), true)
  context.nativeScopeLocked.value = true
  assert.equal(ui.guardApprovalNavigation(), false)
  assert.match(notices.at(-1), /保存或核对/)
})

test('原业务写入口拒绝旧偏离及另一实例，精确当前偏离仍调用原评审接口', async () => {
  const source = readFileSync(new URL('./ProjectManagementView.vue', import.meta.url), 'utf8')
  const body = source.match(/async function runOperation\([^]*?\n\}/)[0]
  const writes = [], notices = []
  const context = { saving: { value: false }, selectedServiceItem: { value: { id: 'SI-2' } },
    operationForm: { value: { deviationID: 'DV-new', decision: 'RELEASE', comment: '核实' } },
    selectedDeviation: { value: { payload: { deviation_id: 'DV-new' } } },
    approvalDeepLink: { requested: { value: { type: 'FIELD_DEVIATION' } }, canProcess: { value: false } },
    focusedApprovalTask: { value: { id: 'DV-old', service_item_id: 'SI-2' } },
    reviewDeviation: async (...args) => writes.push(args), refreshAfterWrite: async () => {},
    showToast: message => notices.push(message), formatUserError: error => error.message }
  const run = vm.runInNewContext(`${body}\nrunOperation`, context)
  await run('exception-review')
  assert.equal(writes.length, 0)
  context.approvalDeepLink.canProcess.value = true
  context.focusedApprovalTask.value.id = 'DV-target'
  await run('exception-review')
  assert.equal(writes.length, 0)
  context.operationForm.value.deviationID = 'DV-target'
  context.selectedDeviation.value.payload.deviation_id = 'DV-target'
  await run('exception-review')
  assert.equal(writes.length, 1)
  assert.equal(writes[0][0], 'DV-target')
  assert.equal(writes[0][1].decision, 'RELEASE')
  assert.equal(context.saving.value, false)
})

test('旧审批入口和通知目的地通过统一页打开指定申请，无导航授权时给明确反馈', async () => {
  const source = readFileSync(new URL('./ProjectManagementView.vue', import.meta.url), 'utf8')
  const functions = ['openApprovalTarget', 'openApprovalRequest'].map(name => {
    const body = source.match(new RegExp(`(?:async )?function ${name}\\([^]*?\\n\\}`))?.[0]
    assert.ok(body, `应提供统一审批导航 ${name}`)
    return body
  })
  const pushes = [], notices = []
  const context = { URLSearchParams, openNotificationTarget,
    navigation: { value: { sections: ['approvals'] } },
    router: { push: async target => { pushes.push(target) } }, mobileMenuOpen: { value: true },
    showToast: message => notices.push(message), formatUserError: error => error.message }
  const run = vm.runInNewContext(`${functions.join('\n')}\nopenApprovalRequest`, context)
  await run('req-1')
  assert.deepEqual(pushes, ['/project_management/approvals?request_id=req-1'])
  assert.equal(context.mobileMenuOpen.value, false)
  context.navigation.value.sections = []
  await run('req-2')
  assert.equal(pushes.length, 1)
  assert.match(notices[0], /无权/)
})


test('报告返工提交后明确提示等待技术总监审批', async () => {
  const source = readFileSync(new URL('./ProjectManagementView.vue', import.meta.url), 'utf8')
  const body = source.match(/async function submitRollbackRequest\(kind\) \{[^]*?\n\}/)?.[0]
  assert.ok(body)
  const notices = [], writes = []
  const context = { canRequestRollback: { value: true }, saving: { value: false },
    promptDialog: { value: null }, selectedServiceItem: { value: {
      id: 'SI-1', status: '现场实施完成', report_status: 'COMPILING', version: 3,
    } }, captureReasonContext: items => ({ items }), askOperationReason: async () => '补测',
    requestRollback: async (...args) => writes.push(args), refreshAfterWrite: async () => {},
    showToast: message => notices.push(message), formatUserError: error => error.message }
  const run = vm.runInNewContext(`${body}\nsubmitRollbackRequest`, context)
  await run('REPORT_TO_FIELD')
  assert.equal(writes.length, 1)
  assert.match(notices[0], /等待技术总监审批/)
})
