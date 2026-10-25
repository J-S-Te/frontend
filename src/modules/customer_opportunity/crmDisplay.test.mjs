import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CREDIT_APPROVAL_ROLES,
  alertTypeText,
  approvalResultText,
  assignees,
  catalogSelectionIDs,
  creditLevelLabel,
  emptyCustomer,
  emptyOpportunity,
  formatAmount,
  formatDate,
  formatDateTimeLocal,
  hasCreditApprovalAccess,
  influenceText,
  isPresaleEligibleOpportunity,
  mergeCatalogOptions,
  platformUserName,
  presaleOpportunityLabel,
  presaleRequestID,
  protectionLevelText,
  safeHTTPSURL,
  stableQuery,
  terminalPendingText,
  timelineEventMeta,
  usableOperationName,
  urgencyText,
  venueText,
} from './crmDisplay.js'

test('商机售前资格只认跟进中的五个售前阶段（current_stage）', () => {
  for (const stage of ['初步接触', '需求沟通', '方案制定', '报价', '投标']) {
    assert.equal(isPresaleEligibleOpportunity({ opp_status: 'FOLLOWING', current_stage: stage }), true, stage)
  }
  assert.equal(isPresaleEligibleOpportunity({ opp_status: 'FOLLOWING', current_stage: '已签约' }), false)
  assert.equal(isPresaleEligibleOpportunity({ opp_status: 'CLOSED', current_stage: '初步接触' }), false)
})

test('信用审批权限按权限码或内置审批角色判定，等级标签统一大写回落 B', () => {
  assert.equal(hasCreditApprovalAccess({ permissions: ['customer.credit.approve'] }), true)
  for (const role of CREDIT_APPROVAL_ROLES) {
    assert.equal(hasCreditApprovalAccess({ roles: [role] }), true, role)
  }
  assert.equal(hasCreditApprovalAccess({ roles: ['sales'] }), false)
  assert.equal(creditLevelLabel('a'), 'A · 优秀')
  assert.equal(creditLevelLabel(''), 'B · 良好')
  assert.equal(creditLevelLabel('X'), 'B · 良好')
})

test('通用枚举文案映射：等级保护、影响力、场地、紧急度与告警类型', () => {
  assert.equal(protectionLevelText('LEVEL_3'), '三级')
  assert.equal(protectionLevelText('LEVEL_9'), 'LEVEL_9')
  assert.equal(influenceText('HIGH'), '高')
  assert.equal(venueText('REMOTE'), '远程')
  assert.equal(venueText('UNKNOWN'), '未知场地')
  assert.equal(urgencyText('URGENT'), '紧急')
  assert.equal(alertTypeText('ASSIGNMENT_OVERDUE'), '待指派超时')
  assert.equal(alertTypeText('SOMETHING'), 'SOMETHING')
})

test('金额格式化为人民币两位小数，非法输入回落破折号', () => {
  assert.equal(formatAmount(1234567), '¥1,234,567.00')
  assert.equal(formatAmount('2,000'), '¥2,000.00')
  assert.equal(formatAmount('not-a-number'), '—')
  assert.equal(terminalPendingText('CONTRACT'), '待关联合同')
  assert.equal(terminalPendingText('LOST_REASON'), '待补失败原因')
  assert.equal(terminalPendingText('OTHER'), '无')
})

test('日期格式化：Date 对象转 datetime-local 字符串，字符串转中文中等日期', () => {
  assert.equal(formatDateTimeLocal(new Date(2026, 9, 22, 9, 5)), '2026-10-22T09:05')
  assert.equal(formatDate(''), '—')
  assert.equal(formatDate('not-a-date'), 'not-a-date')
  assert.ok(formatDate('2026-10-25T10:00:00Z').length > 0)
})

test('售前申请标识与商机标签：主键优先、旧字段兜底、名称与编号组合', () => {
  assert.equal(presaleRequestID({ id: 'a1' }), 'a1')
  assert.equal(presaleRequestID({ request_id: 'r1' }), 'r1')
  assert.equal(presaleRequestID({ request: { id: 'r2' } }), 'r2')
  assert.equal(presaleRequestID({}), '')
  assert.equal(presaleOpportunityLabel({ opportunity_name: 'Naming', opportunity_no: 'OPP-1' }), 'Naming（OPP-1）')
  assert.equal(presaleOpportunityLabel({ opportunity_name: 'Naming' }), 'Naming')
  assert.equal(presaleOpportunityLabel({}), '—')
})

test('操作人名兜底：快照名缺失或等于用户 ID 时返回空串', () => {
  assert.equal(usableOperationName('张三', 'u1'), '张三')
  assert.equal(usableOperationName('u1', 'u1'), '')
  assert.equal(usableOperationName('  ', 'u1'), '')
  assert.equal(platformUserName({ display_name: ' 李四 ' }), '李四')
  assert.equal(platformUserName({}), '未命名用户')
  assert.equal(assignees([{ person_name: '甲' }, { person_name: '乙' }]), '甲、乙')
  assert.equal(assignees([]), '未指派')
})

test('目录选项按数字 ID 合并去重并按 sort_order 排序；选择 ID 优先结构化结构', () => {
  const available = [{ id: 1, name: 'A', sort_order: 2 }, { id: 2, name: 'B', sort_order: 1 }]
  const merged = mergeCatalogOptions(available, [{ id: 3, name: 'C', sort_order: 0 }])
  assert.deepEqual(merged.map((item) => item.id), [3, 2, 1])
  const mergedDup = mergeCatalogOptions(available, [{ id: 1, name: 'A-覆盖', sort_order: 1 }])
  assert.equal(mergedDup.filter((item) => item.id === 1).length, 1)
  assert.equal(mergedDup.find((item) => item.id === 1).name, 'A-覆盖')

  assert.deepEqual(catalogSelectionIDs([{ id: '7' }], '甲、乙', []), [7])
  assert.deepEqual(catalogSelectionIDs([], '甲、乙', [{ id: 1, name: '甲' }, { id: 2, name: '乙' }]), [1, 2])
  assert.deepEqual(catalogSelectionIDs([], '不存在的名字', [{ id: 1, name: '甲' }]), [])
})

test('时间线事件元数据与审批结论文案', () => {
  assert.deepEqual(timelineEventMeta('REQUEST_CREATED'), { icon: '建', stage: '发起', tone: 'created' })
  assert.deepEqual(timelineEventMeta('UNKNOWN_EVENT'), { icon: '记', stage: '记录', tone: 'default' })
  assert.equal(approvalResultText('PASS'), '通过')
  assert.equal(approvalResultText('REJECTED'), '驳回')
  assert.equal(approvalResultText('UNKNOWN'), '已处理')
})

test('表单工厂返回全新空对象，字段名与后端契约一致', () => {
  const customer = emptyCustomer()
  assert.ok(Array.isArray(customer.contacts))
  const opp = emptyOpportunity()
  assert.ok('name' in opp && 'owner_user_id' in opp && 'type_ids' in opp)
  const again = emptyCustomer()
  assert.notEqual(again.contacts, customer.contacts)
})

test('安全 URL 校验返回 https href 或空串，稳定查询键序无关', () => {
  assert.equal(safeHTTPSURL('https://example.com/x'), 'https://example.com/x')
  assert.equal(safeHTTPSURL('http://example.com/x'), '')
  assert.equal(safeHTTPSURL('javascript:alert(1)'), '')
  assert.equal(safeHTTPSURL('::::'), '')
  assert.equal(stableQuery({ b: 1, a: 2 }), stableQuery({ a: 2, b: 1 }))
  assert.notEqual(stableQuery({ a: 1 }), stableQuery({ a: 2 }))
})
