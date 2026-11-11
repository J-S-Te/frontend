import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveDraftContext, draftOrganizations, financeEntityChoices, payeeChoices,
  normalProjectReference, projectReferenceLabel } from './claimPresentation.js'

const options = {
  applicant: { id: 'person', name: '王工' },
  organizations: [{ id: 'tech', name: '技术部', is_primary: true }, { id: 'sales', name: '销售部' }],
  employee_profiles: [{ id: 'profile-tech', org_id: 'tech', route_type: 'TECHNICAL', active: true },
    { id: 'profile-sales', org_id: 'sales', route_type: 'SALES', active: true }],
  draft_context: { status: 'READY', org_id: 'tech', route_type: 'TECHNICAL', employee_profile_id: 'profile-tech' },
}

test('新草稿仅从真实任职与唯一有效费用档案决定组织和线路，歧义不猜首条', () => {
  assert.equal(resolveDraftContext(options).route_type, 'TECHNICAL')
  assert.equal(resolveDraftContext(options, 'sales').route_type, 'SALES')
  assert.equal(resolveDraftContext(options, 'forged').ready, false)
  const ambiguous = { ...options, employee_profiles: [...options.employee_profiles,
    { id: 'second', org_id: 'tech', route_type: 'SALES', active: true }] }
  assert.equal(resolveDraftContext(ambiguous).ready, false)
  assert.equal(draftOrganizations({ ...options, organizations: [{ id: 'other', name: '其他部门' }] }).length, 0)
})

test('付款主体按当前组织过滤，本人收款档案展示姓名和已审核版本且不露受控引用', () => {
  const data = { ...options,
    finance_entities: [{ id: 'one', name: '甲公司', org_ids: ['tech'], active: true },
      { id: 'two', name: '乙公司', org_ids: ['sales'], active: true }],
    payee_profiles: [{ id: 'payee', subject_id: 'person', account_ref: 'private-reference',
      active: true, reviewed: true, version: 3 },
    { id: 'foreign', subject_id: 'other', active: true, reviewed: true, name: '别人的档案' }],
  }
  assert.deepEqual(financeEntityChoices(data, 'tech').map((row) => row.id), ['one'])
  const payees = payeeChoices(data)
  assert.equal(payees.length, 1)
  assert.match(payees[0].name, /王工.*已审核.*3/)
  assert.doesNotMatch(payees[0].name, /private-reference|payee/)
})

test('普通项目选择严格要求报告阶段与当前资格，项目标签只使用名称现场日期状态', () => {
  const row = { project_id: 'private-project', service_item_id: 'private-item', project_name: '年度检测',
    site: '杭州现场', planned_start: '2026-11-10', planned_end: '2026-11-12',
    project_status: '报告编制', service_item_status: '现场实施完成', eligible: true, participant_eligible: true }
  assert.equal(normalProjectReference(row), true)
  for (const project_status of ['', '未知', '实施中', '现场实施完成', '已终止']) {
    assert.equal(normalProjectReference({ ...row, project_status }), false)
  }
  assert.equal(normalProjectReference({ ...row, participant_eligible: false }), false)
  assert.match(projectReferenceLabel(row), /年度检测.*杭州现场.*2026-11-10.*报告编制/)
  assert.doesNotMatch(projectReferenceLabel(row), /private-project|private-item/)
})
