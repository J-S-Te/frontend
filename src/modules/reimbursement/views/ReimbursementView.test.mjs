import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash, webcrypto } from 'node:crypto'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
import * as Vue from 'vue'
import { renderToString } from '@vue/server-renderer'
import { approvalNodeLabel, assignmentPurpose, expenseScopeDescription, hasTenantAllCapability, reimbursementRoleLabel } from '../rolePresentation.js'
import { canSelectProjectReference, editableClaimItem, evidenceIDs,travelInput } from '../claimFields.js'
import { policyFields, policyFormFrom, policyPayload } from '../policy.js'
import { createCommandRunner, createRequestID, formatMinor, toMinor, validateItems } from '../api/client.js'
import { sourceSHA256 } from '../../shared/utils/sourceIntegrity.js'
import * as claimPresentation from '../claimPresentation.js'
import * as workspaceState from '../workspaceState.js'
import { frontendModules } from '../../registry/compiledModules.js'
import * as workspace from '../workspace.js'
import { allocationInput } from '../allocation.js'
import * as invoiceClassification from '../invoiceClassification.js'

const panelStub = { render: () => null }

// 用途：提供当前真实任职与唯一有效费用档案的完整合成选项。
// 参数：orgID为费用组织，routeType为该档案的权威业务线路。
// 返回值：适用于普通草稿测试的完整claim-options响应。
function draftOptionsFixture(orgID = 'org', routeType = 'TECHNICAL') {
  return { applicant: { id: 'actor', name: '王工' },
    organizations: [{ id: orgID, name: '技术部', is_primary: true }],
    draft_context: { status: 'READY', org_id: orgID, route_type: routeType, employee_profile_id: 'profile' },
    employee_profiles: [{ id: 'profile', org_id: orgID, route_type: routeType, active: true }] }
}

// 用途：挂载真实报销页面setup，仅替换路由、认证和HTTP外部边界。
// 参数：permissions 为服务端能力，request 为接口替身，section 为入口，roles 为显示角色。
// 返回值：真实Vue响应式状态和卸载方法，不冒充浏览器DOM验收。
async function mountPage(permissions, request, section = 'dashboard', roles = []) {
  const previousWindow = globalThis.window
  globalThis.window = { addEventListener() {}, removeEventListener() {} }
  const route = Vue.reactive({ params: { section }, query: {} })
  const { descriptor } = parse(readFileSync(new URL('./ReimbursementView.vue', import.meta.url), 'utf8'))
  const script = compileScript(descriptor, { id: 'expense-view-test' })
  const dependencies = { ...claimPresentation, ...workspaceState, ...workspace, ...invoiceClassification, allocationInput, travelInput,frontendModules,sourceSHA256,
    computed: Vue.computed, nextTick: Vue.nextTick, onBeforeUnmount: Vue.onBeforeUnmount,
    onMounted: Vue.onMounted, ref: Vue.ref, watch: Vue.watch, useRoute: () => route, useRouter: () => ({ push() {} }),
    onBeforeRouteLeave() {}, AppShell: { setup: (_props, { slots }) => () => Vue.h('main', slots.default?.()) }, LoadingState: panelStub, ExpenseInbox: panelStub, ArchiveBorrowPanel: panelStub, TravelFields: panelStub, BusinessObjectSelect: panelStub, BusinessAttachmentSelect: panelStub, CitySelect: panelStub, ClaimPreviewPanel:panelStub,InvoiceContentFields:panelStub,InvoiceContentMappings:panelStub,InvoiceClassificationEvidence:panelStub,ParseExceptionsPanel:panelStub, PaymentExceptionPanel: panelStub, ClaimEvidenceTravelPanel: panelStub, ArchivePackagePanel: panelStub, InvoiceControlsPanel: panelStub, ApprovalRoundsPanel: panelStub, ClaimSyncPanel: panelStub, RecoveryPanel: panelStub, todayBusinessDate: () => '2026-11-10', formatBusinessDateTime: (value) => value,
    createCommandRunner, createRequestID, formatMinor, toMinor, validateItems, approvalNodeLabel, assignmentPurpose, expenseScopeDescription, hasTenantAllCapability, reimbursementRoleLabel, canSelectProjectReference, editableClaimItem, evidenceIDs, policyFields, policyFormFrom, policyPayload,
    ensureReimbursementSession: async () => ({ tenant_id: 'test', subject_id: 'actor', permissions, roles }),
    logoutReimbursement: async () => ({}), api: { request }, startReimbursementLogin() {} }
  const content = script.content.replace(/^import[\s\S]*?['"][^'"]+['"]\n/gm, '')
    .replace('export default', 'return')
  const component = new Function(...Object.keys(dependencies), content)(...Object.values(dependencies))
  let state
  const setup = component.setup
  component.setup = (props, context) => { state = setup(props, context); return () => null }
  const renderer = Vue.createRenderer({ createComment: () => ({}), insert() {}, remove() {},
    parentNode: () => null, nextSibling: () => null, createElement: () => ({}),
    createText: () => ({}), setText() {}, setElementText() {}, patchProp() {} })
  const app = renderer.createApp(component)
  app.mount({})
  await new Promise((resolve) => setImmediate(resolve))
  // 用途：渲染真实模板，验证权限按钮和历史文案而不冒充浏览器DOM。
  // 参数：无。
  // 返回值：当前状态的SSR HTML。
  async function html() {
    const compiled = compileTemplate({ source: descriptor.template.content,
      filename: 'ReimbursementView.vue', id: 'expense-view-test',
      compilerOptions: { bindingMetadata: script.bindings } })
    assert.deepEqual(compiled.errors, [])
    const render = new Function('Vue', compiled.code
      .replace(/import \{([^}]+)\} from "vue"/g, (_, names) =>
        `const { ${names.replace(/ as /g, ': ')} } = Vue`)
      .replace('export function render', 'return function render'))(Vue)
    const app = Vue.createSSRApp({ setup: () => state, render })
    app.component('RouterLink', { props: ['to'],
      // 用途：在组件测试中保留链接槽位；实际路由守卫不在SSR夹具中替代。
      // 参数：props 为业务路由，slots 为真实模板内容。
      // 返回值：仅供模板观察的链接节点。
      setup: (props, { slots }) => () => Vue.h('a', {}, slots.default?.()) })
    return renderToString(app)
  }
  return { state, route, html, unmount: () => { app.unmount(); globalThis.window = previousWindow } }
}

test('工作台统计只显示服务端范围统计，不用当前页条数推导', async () => {
  const calls = []
  const fixture = await mountPage(['expense.claim.read'], async (path) => {
    calls.push(path)
    return { my_claims: 57, pending_approvals: 2, pending_payments: 3, invoice_review_required: 4 }
  })
  try {
    assert.deepEqual(calls, ['/dashboard'])
    assert.equal(fixture.state.dashboard.value.my_claims, 57)
    assert.equal(fixture.state.rows.value.length, 0)
  } finally { fixture.unmount() }
})

test('HTTP入口缺少randomUUID时仍能初始化工作台费用表单', async () => {
  const previousCrypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto')
  Object.defineProperty(globalThis, 'crypto', { configurable: true,
    value: { getRandomValues: webcrypto.getRandomValues.bind(webcrypto) } })
  let fixture
  try {
    fixture = await mountPage(['expense.claim.read'], async () => ({ my_claims: 0 }))
    assert.match(fixture.state.draft.value.items[0].id,
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    assert.equal(fixture.state.dashboard.value.my_claims, 0)
  } finally {
    fixture?.unmount()
    Object.defineProperty(globalThis, 'crypto', previousCrypto)
  }
})

test('HTTP上传仍计算原件摘要并使用系统回执文档，不暴露可编辑文档编号', async () => {
  const previousCrypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto')
  const previousFetch = globalThis.fetch
  Object.defineProperty(globalThis, 'crypto', { configurable: true,
    value: { getRandomValues: webcrypto.getRandomValues.bind(webcrypto) } })
  const writes = []
  const file = new File(['%PDF-1.4\n% test fixture\n%%EOF\n'], 'upload-fixture.pdf',
    { type: 'application/pdf' })
  let fixture
  try {
    fixture = await mountPage(['expense.invoice.read', 'expense.invoice.upload'], async (path, options) => {
      writes.push([path, options && JSON.parse(options.body)])
      if (path === '/invoice-documents/upload-sessions') return {
        status: 'CREATED', document_id: 'server-document', file_id: 'server-file',
        upload_url: '/file-gateway/upload/fixture', ticket: 'synthetic-upload-ticket',
      }
      if (path === '/invoice-documents/server-document/complete') return {
        id: 'server-document', file_id: 'server-file', status: 'READY', parse_run_id: 'server-run',
      }
      throw new Error(`unexpected API: ${path}`)
    }, 'invoice-upload')
    window.location = { origin: 'http://fixture.example.test',
      href: 'http://fixture.example.test/reimbursement/invoice-upload' }
    globalThis.fetch = async (url, options) => {
      assert.equal(url, 'http://fixture.example.test/file-gateway/upload/fixture')
      assert.equal(options.method, 'PUT')
      assert.equal(options.body, file)
      return new Response(null, { status: 200 })
    }
    await fixture.state.uploadInvoiceBatch({ target: { files: [file] } })
    assert.equal(fixture.state.error.value, '')
    assert.equal(fixture.state.uploadBatch.value[0].status, 'READY')
    assert.equal(writes[0][1].sha256,
      createHash('sha256').update(Buffer.from(await file.arrayBuffer())).digest('hex'))
    assert.equal(fixture.state.documentID.value, 'server-document')
    assert.equal(fixture.state.evidenceNames.value['server-file'], 'upload-fixture.pdf')
    const html = await fixture.html()
    assert.doesNotMatch(html, /文档ID|上传后的文档ID|server-document/)
    assert.match(html, /upload-fixture\.pdf/)
    assert.match(html, /查询原件状态/)
  } finally {
    fixture?.unmount()
    globalThis.fetch = previousFetch
    Object.defineProperty(globalThis, 'crypto', previousCrypto)
  }
})

test('列表筛选发送完整业务条件且应用后回到第一页，异常入口保留服务端约束', async () => {
  const calls = []
  const fixture = await mountPage(['expense.claim.read'], async path => {
    calls.push(path); return { items:[], total:0 }
  },'claims')
  try {
    fixture.state.page.value=4
    Object.assign(fixture.state.listFilters.value,{q:'EXP 1',claim_type:'TRAVEL',date_from:'2026-11-01'})
    await fixture.state.applyFilters()
    assert.equal(fixture.state.page.value,1)
    assert.equal(calls.at(-1),'/claims?page=1&page_size=20&q=EXP+1&claim_type=TRAVEL&date_from=2026-11-01')
  } finally {fixture.unmount()}
})

test('新费用草稿保存类型备注与比例派生金额，不把展示比例当服务端结论', async () => {
  const fixture = await mountPage(['expense.claim.read','expense.claim.create'],async(path)=>path === '/claim-options' ? draftOptionsFixture() : ({items:[],total:0}),'claims')
  try {
    Object.assign(fixture.state.draft.value,{title:'差旅',claim_type:'TRAVEL',remark:'业务说明'})
    const item=fixture.state.draft.value.items[0]
    Object.assign(item,{amount:'1.01',allocation_mode:'RATIO',allocations:[
      {project_id:'b',ratio:'50'},{project_id:'a',ratio:'50'}]})
    const value=fixture.state.claimPayload()
    assert.equal(value.claim_type,'TRAVEL');assert.equal(value.remark,'业务说明')
    assert.deepEqual(value.items[0].allocations.map(row=>row.amount_minor),['50','51'])
  } finally {fixture.unmount()}
})

test('未授权页面不请求业务列表，也不把权限失败显示成空数据成功', async () => {
  const fixture = await mountPage([], async () => { assert.fail('未授权页面不应请求数据') }, 'payments')
  try { assert.match(fixture.state.error.value, /没有.*访问能力/) }
  finally { fixture.unmount() }
})

test('提交依赖故障保留草稿输入和原命令，不显示提交成功', async () => {
  const calls = []
  const fixture = await mountPage(['expense.claim.read', 'expense.claim.create'], async (path, options) => {
    calls.push([path, options])
    if (path === '/claim-options') return draftOptionsFixture()
    if (!options) return { items: [], total: 0, page: 1, page_size: 20 }
    throw Object.assign(new Error('项目引用服务暂不可用'), { status: 503, outcomeUnknown: true })
  }, 'claims')
  try {
    const item = fixture.state.draft.value.items[0]
    Object.assign(fixture.state.draft.value, { title: '保留草稿', org_id: 'org' })
    Object.assign(item, { fee_type: 'TRAVEL', amount: '12.34', no_invoice_reason: '政策允许' })
    Object.assign(item.allocations[0], { project_id: 'project', amount: '12.34' })
    await fixture.state.saveDraft()
    assert.equal(fixture.state.draft.value.title, '保留草稿')
    assert.match(fixture.state.error.value, /项目引用服务暂不可用/)
    assert.equal(fixture.state.notice.value, '')
    assert.ok(fixture.state.pending.value.command_id)
    const sent = JSON.parse(calls.at(-1)[1].body)
    assert.equal(sent.items[0].requested_minor, '1234')
    assert.equal(sent.items[0].allocations[0].amount_minor, '1234')
  } finally { fixture.unmount() }
})

test('新建草稿立即获得服务器ID并绑定可信组织选项', async () => {
  const calls = []
  const fixture = await mountPage(['expense.claim.read', 'expense.claim.create'], async (path, options) => {
    calls.push([path, options])
    if (path === '/claim-options') return { applicant: { id: 'actor', name: '王工' }, organizations: [{ id: 'trusted-org', name: '技术部' }], draft_context: { status: 'READY', org_id: 'trusted-org' }, employee_profiles: [{ id: 'profile', org_id: 'trusted-org', route_type: 'TECHNICAL', active: true }] }
    if (path === '/claims' && options?.method === 'POST') return { id: 'server-draft' }
    if (path === '/claims/server-draft') return { id: 'server-draft', version: 1, status: 'DRAFT', org_id: 'trusted-org', items: [] }
    return { items: [], total: 0 }
  }, 'claims')
  try {
    await fixture.state.newDraft()
    assert.equal(fixture.state.selected.value.id, 'server-draft')
    assert.equal(fixture.state.draft.value.org_id, 'trusted-org')
    const create = calls.find(([path, options]) => path === '/claims' && options?.method === 'POST')
    assert.equal(JSON.parse(create[1].body).org_id, 'trusted-org')
  } finally { fixture.unmount() }
})

test('销售人员新建草稿按当前受控人员资料选择线路，不能沿用技术默认值', async () => {
  let sent
  const fixture = await mountPage(['expense.claim.read', 'expense.claim.create'], async (path, options) => {
    if (path === '/claim-options') return { applicant: { id: 'actor', name: '销售人员' }, organizations: [{ id: 'sales-org', name: '销售部' }], draft_context: { status: 'READY', org_id: 'sales-org' }, employee_profiles: [
      { id: 'sales-profile', org_id: 'sales-org', route_type: 'SALES', active: true },
    ] }
    if (path === '/claims' && options?.method === 'POST') { sent = JSON.parse(options.body); return { id: 'sales-draft' } }
    if (path === '/claims/sales-draft') return { id: 'sales-draft', version: 1, status: 'DRAFT',
      org_id: 'sales-org', route_type: 'SALES', items: [] }
    return { items: [], total: 0 }
  }, 'claims')
  try {
    await fixture.state.newDraft()
    assert.equal(sent.route_type, 'SALES')
    assert.equal(fixture.state.draft.value.route_type, 'SALES')
  } finally { fixture.unmount() }
})

test('审批绑定单据版本和任务版本，冲正绑定独立申请版本', async () => {
  const calls = []
  const fixture = await mountPage(['expense.claim.read'], async (path, options) => {
    if (options) calls.push([path, JSON.parse(options.body)])
    return options ? { id: 'accepted' } : { my_claims: 1 }
  })
  try {
    fixture.state.approvalTask.value = { id: 'task' }
    fixture.state.transferSubject.value = 'qualified-person'
    await fixture.state.approve({ id: 'task', claim_version: 8, version: 3, round: 2 }, 'TRANSFER')
    assert.equal(calls[0][1].expected_version, 8)
    assert.equal(calls[0][1].task_version, 3)
    assert.equal(calls[0][1].round, 2)
    fixture.state.selected.value = { id: 'claim', version: 10 }
    fixture.state.reversalID.value = 'reversal'
    fixture.state.reversalVersion.value = 2
    await fixture.state.decideReversal(true)
    assert.equal(calls[1][1].expected_version, 2)
    assert.equal(calls[1][1].approve, true)
  } finally { fixture.unmount() }
})

test('人工复核仅发送可写票面字段与理由，不回传服务端剩余量和归属', async () => {
  const calls = []
  const fixture = await mountPage(['expense.claim.read'], async (path, options) => {
    if (options) { calls.push(JSON.parse(options.body)); return { id: 'inv' } }
    if (path === '/invoices/inv') return { id: 'inv', file_ids: ['file'] }
    return { my_claims: 0 }
  })
  try {
    fixture.state.selectedInvoice.value = { id: 'inv', version: 4, invoice_type: 'VAT', total_minor: '100',
      file_ids: ['file'], remaining_minor: '100', owner_subject_id: 'private' }
    fixture.state.invoiceReviewReason.value = '逐项对照原件复核'
    fixture.state.invoiceContentEditor.value={lines:[{name:'住宿',amount:'1.00',tax_classification_code:'123',classification_status:'MATCHED'}]}
    await fixture.state.confirmInvoice()
    assert.equal(calls[0].reason, '逐项对照原件复核')
    assert.equal(calls[0].expected_version, 4)
    assert.equal(calls[0].total_minor, '100')
    assert.deepEqual(calls[0].content,{lines:[{name:'住宿',tax_classification_code:'123',amount_minor:'100'}]})
    assert.equal(Object.hasOwn(calls[0], 'remaining_minor'), false)
    assert.equal(Object.hasOwn(calls[0], 'owner_subject_id'), false)
  } finally { fixture.unmount() }
})

test('已发布政策只能派生新草稿，发布传递种类与当前版本', async () => {
  const calls = []
  const fixture = await mountPage(['expense.claim.read'], async (path, options) => {
    if (options) calls.push([path, JSON.parse(options.body)])
    return options ? { id: 'new', version: 1 } : { my_claims: 0 }
  })
  try {
    fixture.state.selectPolicy({ id: 'old', version: 7, published: true, fee_type: 'TRAVEL', org_id: 'org',
      city_level: 'A', grade: 'P1', unit: 'PER_NIGHT', limit_minor: '12345', valid_from: '2026-11-10' })
    assert.equal(fixture.state.policyPublished.value, true)
    fixture.state.clonePolicy()
    assert.equal(fixture.state.policyID.value, '')
    assert.equal(fixture.state.policyVersion.value, 0)
    assert.equal(fixture.state.policyPublished.value, false)
    await fixture.state.savePolicy()
    assert.equal(calls[0][1].limit_minor, '12345')
    assert.match(calls[0][1].id, /^[0-9a-f-]{36}$/)
    assert.notEqual(calls[0][1].id, 'old')
    fixture.state.policyID.value = 'new'
    fixture.state.policyVersion.value = 1
    await fixture.state.publishPolicy()
    assert.equal(calls[1][1].kind, 'standards')
    assert.equal(calls[1][1].expected_version, 1)
  } finally { fixture.unmount() }
})

test('清空项目选项不会误绑定第一条搜索结果', async () => {
  const fixture = await mountPage(['expense.claim.read'], async () => ({ my_claims: 0 }))
  try {
    fixture.state.projectOptions.value = [{ project_id: 'first', service_item_id: 'service', eligible: true }]
    const allocation = { project_id: 'old', service_item_id: 'old-service' }
    fixture.state.selectProject(allocation, { target: { value: '' } })
    assert.equal(allocation.project_id, '')
    assert.equal(allocation.service_item_id, '')
  } finally { fixture.unmount() }
})

test('政策退休绑定当前行版本和原因，配置管理员没有退休能力', async () => {
  const calls = []
  const fixture = await mountPage(['expense.claim.read', 'expense.policy.publish'], async (path, options) => {
    if (options) { calls.push([path, JSON.parse(options.body)]); return { id: 'old', version: 9, lifecycle_status: 'RETIRED' } }
    return { my_claims: 0 }
  })
  try {
    fixture.state.selectPolicy({ id: 'old', version: 8, content_version: 7, published: true, lifecycle_status: 'ACTIVE' })
    fixture.state.policyLifecycleReason.value = '新制度生效，停止新增使用'
    await fixture.state.retirePolicy()
    assert.match(calls[0][0], /\/configurations\/standards\/old\/retire$/)
    assert.equal(calls[0][1].expected_version, 8)
    assert.equal(calls[0][1].reason, '新制度生效，停止新增使用')
    assert.ok(calls[0][1].command_id)
    assert.equal(fixture.state.policyRecord.value.lifecycle_status, 'RETIRED')
    assert.equal(fixture.state.policyRecord.value.content_version, 7)
    fixture.state.session.value.permissions = ['expense.config.manage']
    await fixture.state.retirePolicy()
    assert.equal(calls.length, 1)
  } finally { fixture.unmount() }
})

test('原子替换绑定旧版本和已保存草稿版本，未知结果重试冻结原替换内容', async () => {
  const calls = []
  let lost = true
  const fixture = await mountPage(['expense.claim.read', 'expense.policy.publish'], async (path, options) => {
    if (!options && path.startsWith('/commands/')) throw { status: 404 }
    if (!options) return { my_claims: 0 }
    calls.push([path, JSON.parse(options.body)])
    if (lost) { lost = false; throw { message: '连接中断', outcomeUnknown: true } }
    return { id: 'old', version: 4, lifecycle_status: 'RETIRED', replaced_by_id: 'draft' }
  })
  try {
    fixture.state.selectPolicy({ id: 'old', version: 3, published: true, lifecycle_status: 'ACTIVE' })
    fixture.state.rows.value = [{ id: 'draft', version: 6, published: false, lifecycle_status: 'DRAFT' }]
    fixture.state.replacementPolicyID.value = 'draft'
    fixture.state.policyLifecycleReason.value = '发布新费用标准'
    await fixture.state.replacePolicy()
    assert.equal(calls[0][1].replacement_expected_version, 6)
    fixture.state.policyLifecycleReason.value = '修改后的理由不得污染原命令'
    fixture.state.replacementPolicyID.value = 'other'
    await fixture.state.retryPending()
    assert.deepEqual(calls[1][1], calls[0][1])
    assert.equal(fixture.state.policyRecord.value.replaced_by_id, 'draft')
  } finally { fixture.unmount() }
})

test('每跳转交历史使用历史原新受理人，缺失旧资格证据保持未记录', async () => {
  const history = [
    { id: 'a1', action: 'TRANSFER', from_subject_id: 'first', to_subject_id: 'second', reason: '休假转交', created_at: '2026-11-10T01:00:00Z', qualification_evidence: { target_subject_id: 'second', required_permission: 'expense.approval.act' } },
    { id: 'a2', action: 'TRANSFER', from_subject_id: 'second', to_subject_id: 'third', reason: '职责调整', created_at: '2026-11-10T02:00:00Z', qualification_evidence_status: 'LEGACY_NOT_RECORDED' },
  ]
  const calls = []
  const fixture = await mountPage(['expense.approval.act'], async (path) => {
    calls.push(path)
    if (path.endsWith('/history')) return { items: history, total: 2 }
    if (path === '/approval-tasks/task') return { id: 'task', assignee_subject_id: 'third' }
    return { items: [], total: 0 }
  }, 'approvals')
  try {
    await fixture.state.openApproval('task')
    assert.ok(calls.includes('/approval-tasks/task/history'))
    assert.equal(fixture.state.approvalHistory.value[0].from_subject_id, 'first')
    assert.equal(fixture.state.approvalHistory.value[0].to_subject_id, 'second')
    assert.equal(fixture.state.approvalHistory.value[1].qualification_evidence_status, 'LEGACY_NOT_RECORDED')
    assert.equal(fixture.state.approvalHistory.value[1].qualification_evidence, undefined)
    fixture.state.approvalTask.value = { id: 'task', assignee_subject_id: 'third' }
    fixture.state.approvalHistory.value = history
    const html = await fixture.html()
    assert.match(html, /first<\/strong>/)
    assert.match(html, /second<\/strong>/)
    assert.match(html, /休假转交/)
    assert.match(html, /旧记录未保存当时资格证据/)
  } finally { fixture.unmount() }
})

test('配置管理员页面不展示退休替换入口，已退休旧内容仍只读可审阅', async () => {
  const fixture = await mountPage(['expense.config.manage'], async () => ({ items: [], total: 0 }), 'policies')
  try {
    fixture.state.selectPolicy({ id: 'retired', version: 9, content_version: 7, published: true,
      lifecycle_status: 'RETIRED', retirement_reason: '新标准替换', replaced_by_id: 'new', fee_type: 'TRAVEL' })
    const html = await fixture.html()
    assert.match(html, /已退休/)
    assert.match(html, /内容版本 7/)
    assert.match(html, /新标准替换/)
    assert.match(html, /替换版本：new/)
    assert.match(html, /<fieldset disabled/)
    assert.doesNotMatch(html, /退休当前版本（不可恢复）|原子替换并发布草稿/)
  } finally { fixture.unmount() }
})

test('重解析先读取Document当前版本，未知结果重试保持原版本和命令', async () => {
  let version = 7
  const posts = [], paths = []
  const fixture = await mountPage(['expense.claim.read'], async (path, options) => {
    paths.push(path)
    if (path === '/invoice-documents/doc') return { id: 'doc', version, file_id: 'file', status: 'READY' }
    if (path.startsWith('/commands/')) throw { status: 404 }
    if (options) {
      posts.push(JSON.parse(options.body))
      if (posts.length === 1) throw { message: '断线', outcomeUnknown: true }
      return { id: 'new-run', document_version: 8 }
    }
    return { my_claims: 0 }
  })
  try {
    fixture.state.documentID.value = 'doc'
    await fixture.state.parseDocument()
    assert.equal(posts[0].expected_version, 7)
    assert.ok(paths.indexOf('/invoice-documents/doc') < paths.indexOf('/invoice-documents/doc/parse'))
    version = 99
    await fixture.state.parseDocument()
    assert.deepEqual(posts[1], posts[0])
  } finally { fixture.unmount() }
})

test('缺总额候选保留空金额待复核，同一授权原件可人工创建多张票', async () => {
  const posts = []
  const fixture = await mountPage(['expense.claim.read', 'expense.invoice.upload'], async (path, options) => {
    if (path === '/invoice-documents/doc') return { id: 'doc', version: 3, file_id: 'authorized-file', status: 'READY',parse_run_id:'run', detail: { purpose: 'reimbursement.invoice.original',parse_result:{documents:[{ invoice_number:'candidate',group_kind:'UNCERTAIN',issues:['TOTAL_MISSING'] }]} } }
    if (options) { posts.push(JSON.parse(options.body)); return { id: `invoice-${posts.length}` } }
    if (path.startsWith('/invoices/')) return { id: path.split('/').at(-1), items: [], file_ids: ['authorized-file'] }
    return { my_claims: 0 }
  })
  try {
    fixture.state.documentID.value = 'doc'
    await fixture.state.readDocument()
    await fixture.state.prepareManualInvoice(fixture.state.parsedCandidates.value[0])
    assert.equal(fixture.state.manualInvoiceForm.value.amount, '')
    await fixture.state.createManualInvoice()
    assert.equal(posts.length, 0)
    fixture.state.manualInvoiceForm.value.amount = '12.34'
    await fixture.state.createManualInvoice()
    assert.equal(posts[0].total_minor, '1234')
    assert.deepEqual(posts[0].file_ids, ['authorized-file'])
    assert.equal(Object.hasOwn(posts[0], 'review_status'), false)
    await fixture.state.prepareManualInvoice()
    fixture.state.manualInvoiceForm.value.amount = '56.78'
    await fixture.state.createManualInvoice()
    assert.deepEqual(posts[1].file_ids, ['authorized-file'])
    assert.notEqual(posts[1].command_id, posts[0].command_id)
  } finally { fixture.unmount() }
})

test('待付款重开和批准后作废只使用服务端允许动作、原版本与原因', async () => {
  const posts = []
  const fixture = await mountPage(['expense.claim.read', 'expense.claim.reopen', 'expense.claim.approved_void'], async (path, options) => {
    if (options) { posts.push([path, JSON.parse(options.body)]); return { id: 'claim' } }
    if (path === '/claims/claim') return { id: 'claim', status: 'RETURNED', version: 10, items: [] }
    return { my_claims: 0 }
  })
  try {
    fixture.state.selected.value = { id: 'claim', version: 9, status: 'APPROVED_PENDING_PAYMENT', allowed_actions: ['REOPEN'] }
    fixture.state.claimControlReason.value = '收款资料需重新确认'
    await fixture.state.controlledClaimAction('reopen')
    assert.equal(posts[0][0], '/claims/claim/reopen')
    assert.equal(posts[0][1].expected_version, 9)
    assert.equal(posts[0][1].reason, '收款资料需重新确认')
    await fixture.state.controlledClaimAction('approved-void')
    assert.equal(posts.length, 1)
  } finally { fixture.unmount() }
})

test('外部付款异常金额独立精确，核实绑定异常游标和单据两个版本且不另造付款', async () => {
  const posts = []
  const detail = { id: 'exception', claim_id: 'claim', version: 4, claim_version: 12,
    amount_minor: '1234', status: 'PENDING', reviews: [], allowed_actions: ['REVIEW_EXCEPTION'] }
  const fixture = await mountPage(['expense.claim.read', 'expense.payment.exception.record', 'expense.payment.exception.review'], async (path, options) => {
    if (options) { posts.push([path, JSON.parse(options.body)]); return { id: 'exception' } }
    if (path === '/payment-exceptions/exception') return detail
    if (path.includes('/payment-exceptions?')) return { items: [detail], total: 1 }
    return { my_claims: 0 }
  })
  try {
    fixture.state.selected.value = { id: 'claim', version: 12, payable_minor: '999999', status: 'RETURNED' }
    Object.assign(fixture.state.exceptionForm.value, { amount: '12.34', source_account_ref: 'account',
      transaction_no: 'external-transaction', voucher_file_ids: 'evidence', reason: '实际已付款但与当前审批不符' })
    await fixture.state.recordPaymentException()
    assert.equal(posts[0][1].amount_minor, '1234')
    assert.equal(posts[0][1].method, 'BANK')
    assert.equal(posts[0][1].expected_version, 12)
    fixture.state.exceptionReviewForm.value.reason = '依据银行回单核对'
    fixture.state.exceptionReviewForm.value.evidence_file_ids = 'evidence'
    fixture.state.exceptionReviewForm.value.decision = 'CONFIRM_CONFLICT'
    await fixture.state.reviewPaymentException()
    assert.equal(posts[1][0], '/payment-exceptions/exception/reviews')
    assert.equal(posts[1][1].expected_version, 4)
    assert.equal(posts[1][1].expected_claim_version, 12)
    assert.equal(posts.some(([path]) => path.endsWith('/payments')), false)
    assert.equal(fixture.state.selected.value.status, 'RETURNED')
  } finally { fixture.unmount() }
})

test('同一文件不同解析运行的来源视图保持所选来源，不误用第一条', async () => {
  const fixture = await mountPage(['expense.claim.read'], async (path) => {
    if (path.includes('/download-ticket')) throw { status: 503, message: '测试中不读取实际文件' }
    return { my_claims: 0 }
  })
  try {
    const first = { id: 'source-old', file_id: 'file', run_id: 'run-old' }
    const second = { id: 'source-new', file_id: 'file', run_id: 'run-new' }
    fixture.state.invoiceRows.value = [first, second]
    fixture.state.selectedInvoice.value = { id: 'invoice' }
    await fixture.state.readInvoiceOriginal(second)
    assert.equal(fixture.state.selectedSource.value.run_id, 'run-new')
  } finally { fixture.unmount() }
})

test('候选业务模板明确显示缺总额和不确定分组，不把空值呈现零元票据', async () => {
  const doc = { id: 'doc', status: 'READY', file_id: 'file', version: 2,
    detail: { purpose: 'reimbursement.invoice.original', parse_result: { documents: [
      { invoice_number: '', gross_minor: '', group_kind: 'AMBIGUOUS_MERGE_OR_CONTINUATION', issues: ['TOTAL_MISSING'] },
    ] } } }
  const fixture = await mountPage(['expense.invoice.read', 'expense.invoice.upload'], async (path) =>
    path === '/invoice-documents/doc' ? doc : { items: [], total: 0 }, 'invoices')
  try {
    fixture.state.documentID.value = 'doc'
    await fixture.state.readDocument()
    await fixture.state.prepareManualInvoice(fixture.state.parsedCandidates.value[0])
    const html = await fixture.html()
    assert.match(html, /缺失，需人工填写/)
    assert.match(html, /合并或接续关系不确定，需人工判断/)
    assert.match(html, /创建这张待复核票据/)
    assert.doesNotMatch(html, /0\.00 元/)
  } finally { fixture.unmount() }
})

test('费用证据完成回填原费用项且不创建解析任务，只读评估不进入草稿请求', async () => {
  const fixture = await mountPage(['expense.claim.read'], async () => ({ my_claims: 0 }))
  try {
    const item = fixture.state.draft.value.items[0]
    fixture.state.applyUploadCompletion({ file_id: 'tail-file' }, 'reimbursement.claim.evidence', 'tail-file', `claimTail:${item.id}`)
    fixture.state.applyUploadCompletion({ file_id: 'travel-file' }, 'reimbursement.claim.evidence', 'travel-file', `claimTravel:${item.id}`)
    assert.equal(item.historical_tail_evidence_text, 'tail-file')
    assert.equal(item.travel_confirmation.evidence_text, 'travel-file')
    assert.equal(fixture.state.parseRun.value, null)
    Object.assign(item, { amount: '12.34', historical_tail_reason: '终止前发生的费用',
      requires_travel_facts: true, travel_assessment: { status: 'MATCH' }, historical_tail_applications: [{ policy: { id: 'forged' } }] })
    Object.assign(item.allocations[0], { project_id: 'project', amount: '12.34' })
    const payload = fixture.state.claimPayload().items[0]
    assert.equal(payload.requested_minor, '1234')
    assert.deepEqual(payload.historical_tail_evidence_file_ids, ['tail-file'])
    assert.equal(Object.hasOwn(payload, 'travel_assessment'), false)
    assert.equal(Object.hasOwn(payload, 'requires_travel_facts'), false)
    assert.equal(Object.hasOwn(payload, 'historical_tail_applications'), false)
    assert.equal(Object.hasOwn(payload, 'travel_confirmation'), false)
  } finally { fixture.unmount() }
})

test('超级管理员会话可展示全部29项服务端能力，普通配置维护者不获得全量marker或发布能力', async () => {
  const permissions = ['expense.claim.read', 'expense.claim.create', 'expense.claim.update', 'expense.claim.submit',
    'expense.claim.withdraw', 'expense.claim.void', 'expense.claim.reopen', 'expense.claim.approved_void',
    'expense.invoice.read', 'expense.invoice.upload', 'expense.invoice.review', 'expense.invoice.verify',
    'expense.approval.act', 'expense.approval.transfer', 'expense.finance.review', 'expense.payment.read',
    'expense.payment.record', 'expense.payment.reversal.request', 'expense.payment.reversal.approve',
    'expense.payment.exception.record', 'expense.payment.exception.review', 'expense.archive.read',
    'expense.archive.retry', 'expense.archive.export', 'expense.config.manage', 'expense.policy.publish',
    'expense.project.reference', 'expense.audit.read', 'expense.scope.tenant_all']
  const fixture = await mountPage(permissions, async () => ({ my_claims: 0 }), 'dashboard', ['reimbursement_admin'])
  try {
    assert.equal(permissions.length, 29)
    for (const code of permissions) assert.equal(fixture.state.can(code), true)
    assert.equal(fixture.state.hasTenantAllCapability(fixture.state.session.value), true)
    assert.match(fixture.state.sessionRolesLabel.value, /超级管理员/)
    assert.match(fixture.state.scopeDescription.value, /本租户/)
    fixture.state.session.value.permissions = ['expense.config.manage']
    assert.equal(fixture.state.can('expense.policy.publish'), false)
    assert.equal(fixture.state.hasTenantAllCapability(fixture.state.session.value), false)
    fixture.state.session.value.permissions = ['expense.scope.tenant_all']
    assert.equal(fixture.state.can('expense.claim.read'), false)
    Object.assign(fixture.state.draft.value, { admin: true, tenant_all: true, permissions: ['expense.scope.tenant_all'] })
    const item = fixture.state.draft.value.items[0]
    item.amount = '1.00'
    Object.assign(item.allocations[0], { project_id: 'project', amount: '1.00' })
    const payload = fixture.state.claimPayload()
    for (const field of ['admin', 'tenant_all', 'permissions']) assert.equal(Object.hasOwn(payload, field), false)
  } finally { fixture.unmount() }
})

test('配置页面明确业务映射仅替代、财务首次与转交，并保留显式范围说明', async () => {
  const fixture = await mountPage(['expense.config.manage'], async () => ({ items: [], total: 0 }), 'policies')
  try {
    fixture.state.policyKind.value = 'assignments'
    await new Promise((resolve) => setImmediate(resolve))
    fixture.state.policyForm.value.role = 'PROJECT_EXPENSE_OWNER'
    const substitution = await fixture.html()
    assert.match(substitution, /受控替代人：不决定首次业务审批/)
    assert.match(substitution, /会计（首次与转交）/)
    assert.match(substitution, /项目经理受控替代（不决定首次审批）/)
    fixture.state.policyKind.value = 'scopes'
    await new Promise((resolve) => setImmediate(resolve))
    const scope = await fixture.html()
    assert.match(scope, /默认按已发布组织列表授权/)
    assert.match(scope, /tenant_all必须显式勾选/)
    assert.match(scope, /未配置范围时拒绝/)
  } finally { fixture.unmount() }
})

test('人工拆票固定选择时的解析运行和候选序号，不被原件刷新替换', async () => {
  let reads = 0
  let submitted
  const candidate = { invoice_type: 'VAT', invoice_number: 'manual-ticket',
    invoice_date: '2026-11-10', gross_minor: '100', detail_lines:[{name:'住宿',amount_minor:'100',sources:[{page:2}]}], sources: [{ page: 2 }] }
  const page = await mountPage(['expense.invoice.read', 'expense.invoice.upload'], async (path, options = {}) => {
    if (path === '/invoice-documents/doc') {
      reads++
      return { id: 'doc', document_id: 'doc', file_id: 'file', status: 'PARSED', version: reads,
        parse_run_id: `run-${reads}`, detail: { purpose: 'reimbursement.invoice.original',
          parse_result: { documents: [structuredClone(candidate)] } } }
    }
    if (path === '/invoices' && options.method === 'POST') {
      submitted = JSON.parse(options.body)
      return { id: 'manual', version: 1 }
    }
    if (path === '/invoices/manual') return { id: 'manual', total_minor: '100', file_ids: ['file'], version: 1 }
    if (path.endsWith('/sources')) return { items: [] }
    if (path.startsWith('/invoices?')) return { items: [], total: 0 }
    throw new Error(`unexpected ${path}`)
  }, 'invoices')
  try {
    page.state.documentID.value = 'doc'
    await page.state.readDocument()
    await page.state.prepareManualInvoice(page.state.parsedCandidates.value[0])
    await page.state.createManualInvoice()
    assert.equal(submitted.source_selections[0].run_id, 'run-1')
    assert.deepEqual(submitted.content,{lines:[{name:'住宿',amount_minor:'100'}]})
    assert.equal(submitted.source_selections[0].candidate_index, 0)
    assert.equal(submitted.source_selections[0].document_id, 'doc')
  } finally { page.unmount() }
})


test('预览只发送当前草稿和版本，不提交单据、不占用命令恢复器', async () => {
  const calls=[]
  const fixture=await mountPage(['expense.claim.read','expense.claim.update'],async(path,options)=>{
    if(options) calls.push([path,JSON.parse(options.body)])
    if(path==='/claim-options')return draftOptionsFixture()
    if(path==='/claims/c/preview')return {claim_id:'c',expected_version:4,preview_only:true,items:[],approval_nodes:[]}
    return {items:[],total:0}
  },'claims')
  try {
    fixture.state.selected.value={id:'c',version:4,status:'DRAFT',applicant_subject_id:'actor',allowed_actions:['UPDATE']}
    Object.assign(fixture.state.draft.value,{title:'待预览',org_id:'org'})
    const item=fixture.state.draft.value.items[0]
    item.amount='1.00';Object.assign(item.allocations[0],{project_id:'p',amount:'1.00'})
    await fixture.state.refreshClaimPreview()
    assert.equal(calls.length,1)
    assert.equal(calls[0][0],'/claims/c/preview')
    assert.equal(calls[0][1].claim_id,'c')
    assert.equal(calls[0][1].expected_version,4)
    assert.equal(Object.hasOwn(calls[0][1],'command_id'),false)
    assert.equal(fixture.state.runner.pending(),null)
    assert.equal(fixture.state.claimPreview.value.preview_only,true)
    assert.equal(fixture.state.selected.value.version,4)
  } finally {fixture.unmount()}
})

test('列表批量导出仅发送当前可见勾选单据，不用空数组扩大成全部范围',async()=>{
  let sent
  const fixture=await mountPage(['expense.claim.read','expense.archive.export'],async(path,options)=>{
    if(path==='/exports'){sent=JSON.parse(options.body);return {id:'export',status:'PENDING'}}
    return {items:[],total:0}
  },'claims')
  try {
    fixture.state.rows.value=[{id:'a'},{id:'b'}]
    fixture.state.selectedClaimIDs.value=['a','hidden']
    await fixture.state.exportSelectedClaims()
    assert.equal(sent,undefined)
    fixture.state.selectedClaimIDs.value=['b']
    await fixture.state.exportSelectedClaims()
    assert.deepEqual(sent.claim_ids,['b'])
  }finally{fixture.unmount()}
})


test('财务审批快照就地显示预付重点审、用途和独立证明，局部范围不显示共享附件',async()=>{
  const fixture=await mountPage(['expense.approval.act','expense.claim.read'],async()=>({items:[],total:0}),'approvals')
  try {
    fixture.state.approvalTask.value={id:'task',claim_id:'claim',snapshot:{scope_limited:false,items:[{
      id:'i',fee_type:'SERVICE',requested_minor:'100',expense_nature:'PREPAYMENT',reason:'合同约定预付用途',
      finance_review_required:true,review_hints:['请财务核对支付条件'],no_invoice_evidence_file_ids:['proof-file'],allocations:[],
    }]}}
    const html=await fixture.html()
    assert.match(html,/预付费用/)
    assert.match(html,/合同约定预付用途/)
    assert.match(html,/请财务核对支付条件/)
    assert.match(html,/查看独立证明 proof-file/)
    fixture.state.approvalTask.value.snapshot.scope_limited=true
    const scoped=await fixture.html()
    assert.doesNotMatch(scoped,/查看独立证明 proof-file|合同约定预付用途/)
  }finally{fixture.unmount()}
})


test('解析异常Job依赖失败显示错误且快速切换不会覆盖后一个原件',async()=>{
  let finish
  const fixture=await mountPage(['expense.invoice.read'],async path=>{
    if(path==='/invoice-documents/old')return new Promise(resolve=>{finish=resolve})
    if(path==='/invoice-documents/new')return {id:'new',version:1}
    if(path==='/parse-runs/new-job')throw new Error('任务查询暂不可用')
    return {items:[],total:0}
  },'invoice-abnormal')
  try {
    const first=fixture.state.openParseException({document_id:'old',parse_job_id:'old-job'})
    await fixture.state.openParseException({document_id:'new',parse_job_id:'new-job'})
    finish({id:'old',version:1});await first
    assert.equal(fixture.state.documentStatus.value.id,'new')
    assert.match(fixture.state.error.value,/任务查询暂不可用/)
    assert.equal(fixture.state.parseRun.value,null)
  }finally{fixture.unmount()}
})

test('内容分类有歧义时保留票据选择及命中依据，不创建空白草稿', async()=>{
  const calls=[]
  const fixture=await mountPage(['expense.claim.read','expense.invoice.read','expense.claim.create'],async(path,options)=>{
    calls.push([path,options])
    if(path==='/invoice-expense-suggestions')return [{invoice_id:'invoice',classification_status:'NEEDS_REVIEW',classification_source:'CONTENT',classification_reasons:['MIXED_CATEGORIES'],classification_matches:[{mapping_id:'hotel',line_index:0,line_name:'住宿',fee_type:'HOTEL',matched_by:'KEYWORD',matched_value:'住宿'}],fee_type:''}]
    if(path==='/claims'&&options?.method==='POST')return {id:'created'}
    if(path==='/claims/created')return {id:'created',items:[]}
    return {items:[],total:0}
  },'invoices')
  try {
    fixture.state.selectedInvoiceIDs.value=['invoice']
    await fixture.state.createDraftFromInvoices()
    assert.equal(calls.some(([path,options])=>path==='/claims'&&options?.method==='POST'),false)
    assert.deepEqual(fixture.state.selectedInvoiceIDs.value,['invoice'])
    assert.match(fixture.state.error.value,/人工.*归类|归类.*人工/)
    assert.equal(fixture.state.invoiceSuggestions.value[0].classification_matches[0].line_name,'住宿')
  }finally{fixture.unmount()}
})

test('会计批准回执实际自动退回时展示真实原因及合规码',async()=>{
 const fixture=await mountPage(['expense.approval.act'],async(path,options)=>options?
  {action:'RETURN',status:'RETURNED',auto_returned:true,reason:'票据已被独立更正',compliance_codes:['INVOICE_CHANGED']}:{items:[],total:0},'approvals')
 try {
  await fixture.state.approve({id:'task',claim_version:8,version:3,round:2},'APPROVE')
  assert.match(fixture.state.notice.value,/实际退回/)
  assert.match(fixture.state.notice.value,/票据已被独立更正/)
  assert.match(fixture.state.notice.value,/INVOICE_CHANGED/)
 }finally{fixture.unmount()}
})

test('退回率展示真实提交分母和退回分子，零分母不显示零率',async()=>{
 const fixture=await mountPage(['expense.claim.read'],async()=>({total_count:5,exception_count:3,submitted_count:0,returned_count:0,return_rate_basis_points:null,date_from:'2026-01-01',date_to:'2026-11-11'}),'analytics')
 try {
  const html=await fixture.html()
  assert.match(html,/已提交单据.*0/)
  assert.match(html,/实际退回单据.*0/)
  assert.match(html,/暂无已提交单据/)
  assert.match(html,/差旅异常/)
 }finally{fixture.unmount()}
})

test('基础信息只读展示本人姓名任职部门，唯一主体及收款档案自动选择且不露受控引用', async () => {
  const options = { ...draftOptionsFixture(),
    finance_entities: [{ id: 'entity', name: '甲公司', active: true, org_ids: ['org'] },
      { id: 'foreign', name: '其他公司', active: true, org_ids: ['other'] }],
    payee_profiles: [{ id: 'payee', subject_id: 'actor', active: true, reviewed: true,
      account_ref: 'private-bank-reference', version: 3 }] }
  const fixture = await mountPage(['expense.claim.read', 'expense.claim.create'], async (path) =>
    path === '/claim-options' ? options : { items: [], total: 0 }, 'claims')
  try {
    assert.equal(fixture.state.draft.value.org_id, 'org')
    assert.equal(fixture.state.draft.value.route_type, 'TECHNICAL')
    assert.equal(fixture.state.draft.value.finance_entity_id, 'entity')
    assert.equal(fixture.state.draft.value.payee_profile_id, 'payee')
    const html = await fixture.html()
    assert.match(html, /报销人<input[^>]*value="王工"[^>]*readonly/)
    assert.match(html, /所属部门<input[^>]*value="技术部"[^>]*readonly/)
    assert.doesNotMatch(html, /private-bank-reference|组织ID|付款主体ID|收款档案ID/)
  } finally { fixture.unmount() }
})

test('歧义档案不能新建草稿，手改组织或线路不会绕过真实本人上下文', async () => {
  const mutations = []
  const options = draftOptionsFixture()
  options.employee_profiles.push({ id: 'other-profile', org_id: 'org', route_type: 'SALES', active: true })
  options.draft_context = { status: 'PROFILE_AMBIGUOUS', message: '当前部门存在多份费用档案' }
  const fixture = await mountPage(['expense.claim.read', 'expense.claim.create'], async (path, request) => {
    if (request) mutations.push(path)
    return path === '/claim-options' ? options : { items: [], total: 0 }
  }, 'claims')
  try {
    Object.assign(fixture.state.draft.value, { org_id: 'forged', route_type: 'SALES' })
    await fixture.state.createDraft()
    assert.equal(mutations.length, 0)
    assert.match(fixture.state.error.value, /本人有效任职/)
    Object.assign(fixture.state.draft.value, { org_id: 'org', route_type: 'TECHNICAL' })
    await fixture.state.createDraft()
    assert.equal(mutations.length, 0)
    assert.match(fixture.state.error.value, /歧义/)
  } finally { fixture.unmount() }
})

test('本人项目默认空词读取仅保留报告阶段资格，游标翻页仍保留已选业务标签', async () => {
  const requests = []
  const reference = { project_id: 'private-project', service_item_id: 'private-item',
    project_name: '年度检测', site: '杭州现场', planned_start: '2026-11-10',
    project_status: '报告编制', eligible: true, participant_eligible: true }
  const fixture = await mountPage(['expense.claim.read', 'expense.claim.create'], async (path) => {
    if (path === '/claim-options') return draftOptionsFixture()
    if (path.startsWith('/project-options?')) {
      requests.push(path)
      return path.includes('cursor=') ? { items: [], next_cursor: '' } : {
        items: [reference, { ...reference, project_id: 'early', project_status: '实施中' },
          { ...reference, project_id: 'outsider', participant_eligible: false }], next_cursor: 'opaque',
      }
    }
    return { items: [], total: 0 }
  }, 'claims')
  try {
    assert.equal(requests.length, 1)
    assert.equal(new URL(requests[0], 'https://test.invalid').searchParams.get('keyword'), '')
    assert.equal(fixture.state.projectOptions.value.length, 1)
    const allocation = fixture.state.draft.value.items[0].allocations[0]
    fixture.state.selectProject(allocation, { target: { value: '0' } })
    await fixture.state.searchProjects(true)
    assert.ok(requests[1].includes('cursor=opaque'))
    assert.equal(fixture.state.selectedProjectOption(allocation), 'retained')
    assert.match(fixture.state.selectedProjectLabel(allocation), /年度检测.*杭州现场/)
    assert.doesNotMatch(fixture.state.selectedProjectLabel(allocation), /private-project|private-item/)
  } finally { fixture.unmount() }
})

test('转交先绑定当前任务再选择人员，上一任务人员不能直接带到另一条待办', async () => {
  const mutations = []
  const task = { id: 'task', version: 2, claim_version: 3, round: 1, allowed_actions: ['TRANSFER'] }
  const fixture = await mountPage(['expense.approval.act'], async (path, options) => {
    if (options) { mutations.push([path, JSON.parse(options.body)]); return { id: 'accepted' } }
    if (path === '/approval-tasks/task') return task
    return { items: [], total: 0 }
  }, 'approvals')
  try {
    fixture.state.transferSubject.value = 'previous-task-person'
    await fixture.state.approve(task, 'TRANSFER')
    assert.equal(mutations.length, 0)
    assert.equal(fixture.state.approvalTask.value.id, 'task')
    assert.equal(fixture.state.transferSubject.value, '')
    await fixture.state.approve(task, 'TRANSFER')
    assert.equal(mutations.length, 0)
    fixture.state.transferSubject.value = 'current-task-person'
    await fixture.state.approve(task, 'TRANSFER')
    assert.equal(mutations[0][1].target_subject_id, 'current-task-person')
    assert.equal(mutations[0][1].task_version, 2)
  } finally { fixture.unmount() }
})

test('READY上传会话回放跳过网关PUT，仍完成原本地文档且不重建会话或幂等键', async () => {
  const previousFetch = globalThis.fetch
  const file = new File(['%PDF-1.4\n% replay fixture\n'], 'replayed.pdf', { type: 'application/pdf' })
  const calls = []
  let fetches = 0
  const fixture = await mountPage(['expense.invoice.read', 'expense.invoice.upload'], async (path, options) => {
    calls.push([path, options ? JSON.parse(options.body) : null])
    if (path === '/invoice-documents/upload-sessions') {
      throw Object.assign(new Error('上传会话结果未知'), { status: 503, outcomeUnknown: true })
    }
    if (path.startsWith('/commands/')) return {
      status: 'READY', document_id: 'same-document', file_id: 'same-file', upload_id: 'same-upload',
      sha256: createHash('sha256').update(Buffer.from(await file.arrayBuffer())).digest('hex'),
      media_type: 'application/pdf', purpose: 'reimbursement.invoice.original',
    }
    if (path === '/invoice-documents/same-document/complete') return {
      document_id: 'same-document', file_id: 'same-file', status: 'READY', parse_run_id: 'real-local-run',
    }
    return { items: [], total: 0 }
  }, 'invoice-upload')
  globalThis.fetch = async () => { fetches++; throw new Error('READY不得重新传输文件') }
  try {
    await fixture.state.uploadInvoiceBatch({ target: { files: [file] } })
    const original = fixture.state.runner.pending()
    assert.equal(original.key, 'document.upload')
    await fixture.state.resolvePending()
    assert.equal(fetches, 0)
    assert.equal(calls.filter(([path]) => path === '/invoice-documents/upload-sessions').length, 1)
    assert.ok(calls.some(([path]) => path === `/commands/${original.command_id}`))
    assert.equal(calls.filter(([path]) => path === '/invoice-documents/same-document/complete').length, 1)
    assert.equal(fixture.state.documentID.value, 'same-document')
    assert.equal(fixture.state.parseRun.value.id, 'real-local-run')
    assert.equal(fixture.state.uploadBatch.value[0].status, 'READY')
    assert.equal(fixture.state.uploadBatch.value[0].document_id, 'same-document')
    assert.equal(fixture.state.evidenceNames.value['same-file'], 'replayed.pdf')
    assert.equal(fixture.state.runner.pending(), null)
  } finally { fixture.unmount(); globalThis.fetch = previousFetch }
})

test('远端READY但本地complete失败仍保持未完成及原complete待确认命令', async () => {
  const previousFetch = globalThis.fetch
  const file = new File(['%PDF-1.4\n% incomplete fixture\n'], 'incomplete.pdf', { type: 'application/pdf' })
  const calls = []
  const fixture = await mountPage(['expense.invoice.read', 'expense.invoice.upload'], async (path, options) => {
    calls.push([path, options ? JSON.parse(options.body) : null])
    if (path === '/invoice-documents/upload-sessions') {
      throw Object.assign(new Error('上传会话结果未知'), { status: 503, outcomeUnknown: true })
    }
    if (path.startsWith('/commands/')) return {
      status: 'READY', document_id: 'same-document', file_id: 'same-file', upload_id: 'same-upload',
    }
    if (path === '/invoice-documents/same-document/complete') {
      throw Object.assign(new Error('本地完成结果未知'), { status: 503, outcomeUnknown: true })
    }
    return { items: [], total: 0 }
  }, 'invoice-upload')
  globalThis.fetch = async () => { assert.fail('READY不应调用fetch') }
  try {
    await fixture.state.uploadInvoiceBatch({ target: { files: [file] } })
    await fixture.state.resolvePending()
    assert.equal(calls.filter(([path]) => path.endsWith('/complete')).length, 1)
    assert.equal(fixture.state.uploadBatch.value[0].status, 'UNKNOWN')
    assert.equal(fixture.state.parseRun.value, null)
    assert.equal(fixture.state.evidenceNames.value['same-file'], undefined)
    assert.equal(fixture.state.runner.pending().key, 'document.complete')
    assert.match(fixture.state.error.value, /本地完成结果未知/)
    assert.equal(fixture.state.notice.value, '')
  } finally { fixture.unmount(); globalThis.fetch = previousFetch }
})

test('未知上传状态在传输前拒绝，不调用本地完成或生成替代文档', async () => {
  const calls = []
  const fixture = await mountPage(['expense.invoice.read'], async (path) => {
    calls.push(path)
    return { my_claims: 0 }
  })
  try {
    await assert.rejects(() => fixture.state.uploadContent({ status: 'UPLOADING', document_id: 'document',
      upload_url: 'https://outside.invalid/file-gateway/path', ticket: 'unused' }, null,
    'reimbursement.invoice.original'), /上传状态/)
    assert.equal(calls.filter((path) => path.includes('/complete')).length, 0)
  } finally { fixture.unmount() }
})
