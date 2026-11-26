import assert from 'node:assert/strict'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { ref } from 'vue'
import { mountSFC } from '../../../../test/helpers/mountSFC.mjs'

const component = fileURLToPath(new URL('./PersonnelChangeCenter.vue', import.meta.url))
const principalModule = fileURLToPath(
  new URL('../../auth/utils/principal.js', import.meta.url),
)
const approverID = 'approver-1'
const permissions = ['platform:user:read', 'platform:user:update', 'platform:approval:process']
const independentChange = {
  id: 'change-1', status: 'PENDING_APPROVAL', change_type: 'TRANSFER',
  user_id: 'employee-1', submitted_by: 'submitter-1',
}

/**
 * 用途：挂载真实审批组件，并在网络边界记录状态迁移请求体。
 * 参数：context 为当前测试；roleCode 为当前账号的角色编码。
 * 返回值：组件状态及已捕获的请求体，组件在测试结束时卸载。
 */
async function mountApproval(context, roleCode = 'platform-super-admin') {
  const requests = []
  const principal = ref({
    user: { id: approverID },
    roles: [{ code: roleCode }],
    permission_codes: permissions,
  })
  context.mock.method(globalThis, 'fetch', async (url, options) => {
    let data = { items: [], total: 0 }
    if (url === '/api/v1/personnel-changes/change-1/transition' && options.method === 'POST') {
      const body = JSON.parse(options.body)
      requests.push(body)
      data = { ...independentChange, status: body.to_status }
    }
    return Response.json({ data })
  })
  const mounted = await mountSFC(component, {
    [principalModule]: {
      useCurrentPrincipal: () => ({ principal }),
      hasPermission: (code) => principal.value.permission_codes.includes(code),
    },
  })
  context.after(mounted.unmount)
  return { state: mounted.state, requests }
}

test('超管通过自己提交的调岗单时独立提交审批凭据和例外原因', async (context) => {
  const { state, requests } = await mountApproval(context, ' PLATFORM-SUPER-ADMIN ')
  await state.openWorkflowAction({ ...independentChange, submitted_by: approverID })
  state.workflowReference.value = 'APR-1001'
  state.workflowAction.value.exceptionReason = '  已按例外流程复核  '
  await state.confirmWorkflowAction()
  assert.deepEqual(requests, [{
    to_status: 'SCHEDULED', approval_reference: 'APR-1001', immediate: false,
    exception_reason: '已按例外流程复核',
  }])
})

test('超管驳回涉及本人的异动时独立提交驳回原因和例外原因', async (context) => {
  const { state, requests } = await mountApproval(context)
  await state.openWorkflowAction({ ...independentChange, user_id: approverID })
  state.workflowReference.value = '目标岗位信息有误'
  state.workflowAction.value.exceptionReason = '  需由本人说明例外处理依据  '
  await state.rejectWorkflowAction()
  assert.deepEqual(requests, [{
    to_status: 'REJECTED', approval_reference: '目标岗位信息有误', immediate: false,
    exception_reason: '需由本人说明例外处理依据',
  }])
})

test('超管通过自己提交的离职单时提交例外原因并进入待交接', async (context) => {
  const { state, requests } = await mountApproval(context)
  await state.openWorkflowAction({
    ...independentChange, submitted_by: approverID, change_type: 'TERMINATION',
  })
  state.workflowReference.value = 'APR-1002'
  state.workflowAction.value.exceptionReason = '按例外流程复核离职请求'
  await state.confirmWorkflowAction()
  assert.deepEqual(requests, [{
    to_status: 'PENDING_HANDOVER', approval_reference: 'APR-1002', immediate: false,
    exception_reason: '按例外流程复核离职请求',
  }])
})

test('例外原因空白或超长时，通过和驳回均在发请求前校验', async (context) => {
  const { state, requests } = await mountApproval(context)
  await state.openWorkflowAction({ ...independentChange, submitted_by: approverID })
  state.workflowReference.value = '审批留痕'
  for (const submit of [state.confirmWorkflowAction, state.rejectWorkflowAction]) {
    state.workflowAction.value.exceptionReason = ' \u3000 '
    await submit()
    assert.match(state.error.value, /填写例外审批原因/)
    state.workflowAction.value.exceptionReason = '原'.repeat(501)
    await submit()
    assert.match(state.error.value, /例外审批原因.{0,8}500/)
  }
  assert.deepEqual(requests, [])
})

test('关闭后重新打开待审批异动，例外原因必须重新填写', async (context) => {
  const { state, requests } = await mountApproval(context)
  const change = { ...independentChange, submitted_by: approverID }
  await state.openWorkflowAction(change)
  state.workflowAction.value.exceptionReason = '尚未提交的原因'
  state.closeWorkflowAction()
  await state.openWorkflowAction(change)
  state.workflowReference.value = 'APR-1001'
  await state.confirmWorkflowAction()
  assert.match(state.error.value, /填写例外审批原因/)
  assert.deepEqual(requests, [])
})

test('超管审批独立异动单时沿用原请求契约', async (context) => {
  const { state, requests } = await mountApproval(context)
  await state.openWorkflowAction(independentChange)
  state.workflowReference.value = 'APR-1003'
  await state.confirmWorkflowAction()
  assert.deepEqual(requests, [{
    to_status: 'SCHEDULED', approval_reference: 'APR-1003', immediate: false,
  }])
})

test('普通审批人的请求不携带超管例外原因，交由后端判定自审权限', async (context) => {
  const { state, requests } = await mountApproval(context, 'personnel-approver')
  await state.openWorkflowAction({ ...independentChange, user_id: approverID })
  state.workflowReference.value = '复核未通过'
  state.workflowAction.value.exceptionReason = '无效的例外原因'
  await state.rejectWorkflowAction()
  assert.deepEqual(requests, [{
    to_status: 'REJECTED', approval_reference: '复核未通过', immediate: false,
  }])
})

test('人员异动申请人独立于异动对象，历史记录只用已加载目录补齐', async (context) => {
  const { state } = await mountApproval(context)
  state.users.value = [
    { id: 'submitter-1', display_name: '旧版目录的申请人' },
    { id: 'employee-1', display_name: '异动人员' },
  ]
  assert.equal(state.applicantLabel({
    ...independentChange, submitted_by_display_name: '服务端确认的申请人', user_display_name: '异动人员',
  }), '服务端确认的申请人')
  assert.equal(state.applicantLabel(independentChange), '旧版目录的申请人')
  assert.equal(state.applicantLabel({
    ...independentChange, submitted_by: 'missing-user', user_display_name: '异动人员',
  }), '姓名未记录')
})
