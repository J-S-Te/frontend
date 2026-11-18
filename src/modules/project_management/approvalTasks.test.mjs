import test from 'node:test'
import assert from 'node:assert/strict'

import { projectApprovalTarget, approvalOwnerLabel, approvalStatusLabel, approvalTypeLabel } from './approvalTasks.js'

test('平台真实收件箱的大写引用类型可直达，代码字段兼容大小写和首尾空白', () => {
  const item = {
    delivery_id: 'delivery-1', message_id: 'message-1', source_application: 'project_management',
    category: 'ROLLBACK_REQUESTED', title: '报告返工待审批', content: '请处理对应申请。',
    target_url: '/project_management/approvals?request_id=request-1',
    reference_type: 'PROJECT_APPROVAL', reference_id: 'request-1',
    delivered_at: '2026-11-18T10:00:00Z', read_at: null,
  }
  const origin = 'https://app.example'
  assert.equal(projectApprovalTarget(item, origin),
    '/project_management/approvals?request_id=request-1')
  assert.equal(projectApprovalTarget({ ...item, source_application: ' PROJECT_MANAGEMENT ',
    category: ' rollback_requested ', reference_type: ' project_approval ' }, origin),
  '/project_management/approvals?request_id=request-1')
  for (const changed of [
    { source_application: ' PROJECT_MANAGEMENT_OTHER ' },
    { category: ' ROLLBACK_REQUESTED_OTHER ' }, { reference_type: ' PROJECT_APPROVAL_OTHER ' },
    { reference_id: 'Request-1' }, { reference_id: ' request-1 ' },
    { target_url: '/PROJECT_MANAGEMENT/APPROVALS?request_id=request-1' },
    { target_url: '/project_management/approvals?REQUEST_ID=request-1' },
  ]) assert.equal(projectApprovalTarget({ ...item, ...changed }, origin), '', JSON.stringify(changed))
})

test('本系统审批通知仅接受同源且与申请引用完全一致的受控目标', async () => {
  const item = { source_application: 'project_management', category: 'ROLLBACK_REQUESTED',
    reference_type: 'project_approval', reference_id: 'request-1',
    target_url: '/project_management/approvals?request_id=request-1' }
  assert.equal(projectApprovalTarget(item, 'https://app.example'), item.target_url)
  assert.equal(projectApprovalTarget({ ...item, target_url: 'https://app.example' + item.target_url },
    'https://app.example'), item.target_url)
  for (const changed of [
    { source_application: 'other' }, { source_application: '' },
    { category: 'UNKNOWN' }, { reference_type: 'service_item' },
    { reference_id: 'request-2' }, { target_url: 'https://evil.example' + item.target_url },
    { target_url: '/project_management/approvals?request_id=request-1&request_id=request-2' },
    { target_url: '/project_management/approvals?request_id=request-1&decision=APPROVED' },
    { target_url: '/project_management/approvals?request_id=request-1#execute' },
    { target_url: '/project_management/projects?request_id=request-1' },
  ]) assert.equal(projectApprovalTarget({ ...item, ...changed }, 'https://app.example'), '',
    JSON.stringify(changed))
})

test('返工和更正均明确归属技术总监审批', async () => {
  assert.equal(approvalOwnerLabel({ type: 'REPORT_REWORK', approver_user_id: 'lead-1' }),
    '技术总监')
  assert.equal(approvalOwnerLabel({ type: 'REPORT_CORRECTION' }), '技术总监')
  assert.equal(approvalTypeLabel('REPORT_REWORK'), '报告返工')
  assert.equal(approvalStatusLabel('WITHDRAWN'), '已撤回')
})
