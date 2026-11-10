import test from 'node:test'
import assert from 'node:assert/strict'

test('政策业务表单把元转换成字符串分，数组和布尔按契约编码', async () => {
  const { policyPayload, policyFormFrom, policyFields } = await import('./policy.js')
  const payload = policyPayload('standards', { fee_type: 'TRAVEL', org_id: 'org', city_level: 'A',
    grade: 'P1', unit: 'DAY', limit_minor: '120.50', valid_from: '2026-11-10', valid_until: '',
    priority: '1', allow_no_invoice: false })
  assert.equal(payload.limit_minor, '12050')
  assert.equal(payload.priority, 1)
  assert.equal(payload.allow_no_invoice, false)
  assert.equal(policyFormFrom('standards', payload).limit_minor, '120.50')
  assert.ok(policyFields('invoice_rules').some((field) => field.key === 'required_external_verification'))
  assert.deepEqual(policyPayload('finance_entities', { name: '主体', tax_id: 'tax', org_ids: 'a,b,a', active: true }).org_ids, ['a', 'b'])
  assert.throws(() => policyPayload('standards', { fee_type: '' }), /费用类型/)
})

test('历史尾款政策默认关闭，费用截止日与有效日期分开；标准差旅要求默认false', async () => {
  const { policyFormFrom, policyPayload, policyFields } = await import('./policy.js')
  const form = policyFormFrom('historical_tail_policies')
  assert.equal(form.enabled, false)
  Object.assign(form, { org_id: 'org', project_id: 'project', expense_cutoff: '2026-10-31', valid_from: '2026-11-01', valid_until: '2026-11-30' })
  const value = policyPayload('historical_tail_policies', form)
  assert.equal(value.expense_cutoff, '2026-10-31')
  assert.equal(value.valid_from, '2026-11-01')
  assert.equal(value.enabled, false)
  assert.equal(policyFormFrom('standards').requires_travel_facts, false)
  assert.ok(policyFields('standards').some((field) => field.key === 'requires_travel_facts'))
})

test('普通范围表单默认组织列表且不默认为tenant_all，不接受客户端admin/任意放行字段', async () => {
  const { policyFormFrom, policyPayload } = await import('./policy.js')
  const form = policyFormFrom('scopes')
  assert.equal(form.tenant_all, false)
  assert.equal(form.org_ids, '')
  const payload = policyPayload('scopes', { subject_id: 'person', org_ids: 'org-a,org-b', tenant_all: false,
    admin: true, reimbursement_admin: true, permissions: ['expense.scope.tenant_all'], allow_all: true })
  assert.deepEqual(payload, { subject_id: 'person', org_ids: ['org-a', 'org-b'], tenant_all: false })
})

test('普通财务范围未填组织列表时不能保存为空范围，显式tenant_all才可省略列表', async () => {
  const { policyPayload } = await import('./policy.js')
  assert.throws(() => policyPayload('scopes', { subject_id: 'person', org_ids: '', tenant_all: false }), /组织列表/)
  assert.equal(policyPayload('scopes', { subject_id: 'person', org_ids: '', tenant_all: true }).tenant_all, true)
})

test('业务首岗位不通过本地表单分配，路由兼容字段按线路固定且忽略伪造值', async () => {
  const { policyFields, policyPayload } = await import('./policy.js')
  for (const key of ['base_role', 'extra_role', 'accounting_role']) {
    assert.equal(policyFields('route_rules').some((field) => field.key === key), false)
  }
  const payload = policyPayload('route_rules', { org_id: 'org', route_type: 'TECHNICAL',
    base_role: 'SALES_DIRECTOR', extra_role: 'FINANCE_DIRECTOR', accounting_role: 'forged',
    valid_from: '2026-11-10', valid_until: '' })
  assert.equal(payload.base_role, 'PROJECT_EXPENSE_OWNER')
  assert.equal(payload.extra_role, 'TECHNICAL_DIRECTOR')
  assert.equal(payload.accounting_role, 'ACCOUNTANT')
  assert.throws(() => policyPayload('assignments', { org_id: 'org', project_id: '', role: 'PROJECT_EXPENSE_OWNER',
    subject_id: 'person', valid_from: '2026-11-10', valid_until: '' }), /项目ID/)
})

test('票面分类规则业务表单完整往返且只发送受控字段',async()=>{
 const {policyFormFrom,policyPayload}=await import('./policy.js')
 const form=policyFormFrom('invoice_rules',{invoice_type:'VAT',identity_fields:['invoice_number'],content_mappings:[{id:'hotel',tax_code_prefixes:['123'],keywords:['住宿'],fee_type:'HOTEL',default_claim_type:'TRAVEL',priority:10}]})
 assert.equal(form.content_mappings?.length,1)
 assert.equal(form.content_mappings[0].keywords,'住宿')
 form.content_mappings[0].server_only='forged'
 const result=policyPayload('invoice_rules',form)
 assert.deepEqual(result.content_mappings,[{id:'hotel',tax_code_prefixes:['123'],keywords:['住宿'],fee_type:'HOTEL',default_claim_type:'TRAVEL',priority:10}])
})
