import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { createHash, webcrypto } from 'node:crypto'

import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
import * as Vue from 'vue'
import { renderToString } from '@vue/server-renderer'
import { approvalNodeLabel, approvalNodesLabel, assignmentPurpose, expenseScopeDescription, hasTenantAllCapability, reimbursementRoleLabel } from '../rolePresentation.js'
import { canSelectProjectReference, editableClaimItem, evidenceIDs,travelInput } from '../claimFields.js'
import { policyFields, policyFormFrom, policyPayload } from '../policy.js'
import { createCommandRunner, createRequestID, formatMinor, toMinor, timeoutSignal, validateItems } from '../api/client.js'
import { sourceSHA256 } from '../../shared/utils/sourceIntegrity.js'
import * as claimPresentation from '../claimPresentation.js'
import * as workspaceState from '../workspaceState.js'
import { frontendModules } from '../../registry/compiledModules.js'
import * as workspace from '../workspace.js'
import { allocationInput } from '../allocation.js'
import * as invoiceClassification from '../invoiceClassification.js'
import { PaginationBarStub } from '../../../test/helpers/paginationStub.mjs'
import { claimStatusLabel as statusLabel, failureMessage, failureText } from '../statusLabels.js'
import { pollTask, taskSettled } from '../asyncTask.js'
import { recallTask, rememberTask, savedAtLabel } from '../taskPersistence.js'
import { formatUserError } from '../../shared/utils/userError.js'

const panelStub = { render: () => null }

// 失败态替身：把标题和错误原因渲染成可断言文本，验证"失败没有被渲染成空态"。
const ErrorStateStub = {
  props: ['error', 'title', 'retry', 'retryText', 'description', 'compact'],
  emits: ['retry'],
  setup: (props, { emit }) => () => Vue.h('div', { class: 'ui-state error-state', role: 'alert' }, [
    Vue.h('b', {}, props.title || '加载失败'),
    Vue.h('span', {}, String(props.error?.message || props.error || '')),
    props.retry === false ? null : Vue.h('button', { onClick: () => emit('retry') }, props.retryText || '重新加载'),
  ]),
}

// 空态替身：只有真实空数据才允许出现"暂无记录"。
const EmptyStateStub = {
  props: ['title', 'description', 'icon', 'compact'],
  setup: (props) => () => Vue.h('div', { class: 'ui-state empty-state' }, [Vue.h('b', {}, props.title || '暂无数据')]),
}

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
  const routerCalls = { push: [], replace: [] }
  const router = { push(...args) { routerCalls.push.push(args) }, replace(...args) { routerCalls.replace.push(args) } }
  const { descriptor } = parse(readFileSync(new URL('./ReimbursementView.vue', import.meta.url), 'utf8'))
  const script = compileScript(descriptor, { id: 'expense-view-test' })
  const dependencies = { ...claimPresentation, ...workspaceState, ...workspace, ...invoiceClassification, allocationInput, travelInput,frontendModules,sourceSHA256,
    computed: Vue.computed, nextTick: Vue.nextTick, onBeforeUnmount: Vue.onBeforeUnmount,
    onMounted: Vue.onMounted, ref: Vue.ref, watch: Vue.watch, useRoute: () => route, useRouter: () => router,
    onBeforeRouteLeave() {}, PaginationBar: PaginationBarStub,
    AppShell: { setup: (_props, { slots }) => () => Vue.h('main', slots.default?.()) }, LoadingState: panelStub, ErrorState: ErrorStateStub, EmptyState: EmptyStateStub, ExpenseInbox: panelStub, ArchiveBorrowPanel: panelStub, TravelFields: panelStub, BusinessObjectSelect: panelStub, BusinessAttachmentSelect: panelStub, CitySelect: panelStub, ClaimPreviewPanel:panelStub,InvoiceContentFields:panelStub,InvoiceContentMappings:panelStub,InvoiceClassificationEvidence:panelStub,ParseExceptionsPanel:panelStub, PaymentExceptionPanel: panelStub, ClaimEvidenceTravelPanel: panelStub, BusinessOptionPicker: panelStub, ArchivePackagePanel: panelStub, InvoiceControlsPanel: panelStub, ApprovalRoundsPanel: panelStub, ClaimSyncPanel: panelStub, RecoveryPanel: panelStub, InvoiceOriginalViewer: panelStub, todayBusinessDate: () => '2026-11-10', formatBusinessDateTime: (value) => value,
    createCommandRunner, createRequestID, timeoutSignal, formatMinor, toMinor, validateItems, createIdempotencyKey: (() => { let n = 0; return () => `expense-key-${++n}` })(), approvalNodeLabel, approvalNodesLabel, assignmentPurpose, expenseScopeDescription, hasTenantAllCapability, reimbursementRoleLabel, canSelectProjectReference, editableClaimItem, evidenceIDs, policyFields, policyFormFrom, policyPayload, statusLabel, failureMessage, failureText, formatUserError, pollTask, taskSettled, recallTask, rememberTask, savedAtLabel,

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
  return { state, route, routerCalls, html, unmount: () => { app.unmount(); globalThis.window = previousWindow } }
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

test('我发起的审批默认查询全部已提交状态，状态页签可见且切换后重新请求', async () => {
  const calls = []
  const fixture = await mountPage(['expense.claim.read'], async path => {
    calls.push(path); return { items: [], total: 0 }
  }, 'submitted')
  try {
    const initial = new URLSearchParams(calls[0].split('?')[1])
    assert.equal(initial.get('mine'), 'true')
    assert.deepEqual(initial.get('status').split(','),
      ['IN_APPROVAL', 'RETURNED', 'APPROVED_PENDING_PAYMENT', 'PAID', 'VOID'])
    const html = await fixture.html()
    const tabs = html.match(/<div[^>]*aria-label="报销状态"[^>]*>([\s\S]*?)<\/div>/)?.[1] || ''
    for (const label of ['全部', '审批中', '已退回', '待付款', '已付款', '已作废']) {
      assert.match(tabs, new RegExp(`>${label}<`), `缺少状态页签 ${label}`)
    }
    assert.doesNotMatch(tabs, /草稿/, '我发起的审批不应出现草稿页签')
    fixture.state.listFilters.value.status = 'RETURNED'
    await fixture.state.applyFilters()
    assert.equal(new URLSearchParams(calls.at(-1).split('?')[1]).get('status'), 'RETURNED')
    assert.equal(new URLSearchParams(calls.at(-1).split('?')[1]).get('mine'), 'true')
    assert.equal(calls.length, 2)
    fixture.state.listFilters.value.status = 'PAID'
    await fixture.state.applyFilters()
    assert.equal(new URLSearchParams(calls.at(-1).split('?')[1]).get('status'), 'PAID')
    fixture.state.listFilters.value.status = ''
    await fixture.state.applyFilters()
    assert.equal(new URLSearchParams(calls.at(-1).split('?')[1]).get('status'),
      'IN_APPROVAL,RETURNED,APPROVED_PENDING_PAYMENT,PAID,VOID')
  } finally { fixture.unmount() }
})

test('从我的报销单带着草稿筛选进入我发起的审批时，不带入草稿状态', async () => {
  const calls = []
  const fixture = await mountPage(['expense.claim.read'], async path => {
    calls.push(path); return { items: [], total: 0 }
  }, 'claims')
  try {
    fixture.state.listFilters.value.status = 'DRAFT'
    await fixture.state.applyFilters()
    assert.equal(new URLSearchParams(calls.at(-1).split('?')[1]).get('status'), 'DRAFT')
    fixture.route.params.section = 'submitted'
    await new Promise((resolve) => setImmediate(resolve))
    await Vue.nextTick()
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(fixture.state.listFilters.value.status, '', '进入审批入口应丢弃草稿页签筛选')
    const query = new URLSearchParams(calls.at(-1).split('?')[1])
    assert.equal(query.get('mine'), 'true')
    assert.equal(query.get('status'), 'IN_APPROVAL,RETURNED,APPROVED_PENDING_PAYMENT,PAID,VOID')
  } finally { fixture.unmount() }
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
    Object.assign(fixture.state.exceptionForm.value, { amount: '12.34', source_account_ref: 'external-account', payee_profile_id: 'external-payee',
      transaction_no: 'external-transaction', voucher_file_ids: 'evidence', reason: '实际已付款但与当前审批不符' })
    await fixture.state.recordPaymentException()
    assert.equal(posts[0][0], '/claims/claim/payment-exceptions')
    assert.equal(posts[0][1].source_account_ref, 'external-account')
    assert.equal(posts[0][1].payee_profile_id, 'external-payee')
    assert.equal(fixture.state.paymentForm.value.source_account_ref, '')
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

test('409 冲突读取报销单最新版本并保留当前编辑', async () => {
  const fixture = await mountPage(['expense.claim.read', 'expense.claim.update'], async (path, options) => {
    if (path === '/claim-options') return draftOptionsFixture()
    if (options?.method === 'PATCH') throw Object.assign(new Error('单据版本已更新'), { status: 409, code: 'STATE_CONFLICT' })
    if (path === '/claims/claim-1') return { id: 'claim-1', version: 4, status: 'RETURNED', title: '差旅报销', org_id: 'org', items: [] }
    return { items: [], total: 0, page: 1, page_size: 20 }
  }, 'claims')
  try {
    const item = fixture.state.draft.value.items[0]
    Object.assign(fixture.state.draft.value, { title: '保留的标题', org_id: 'org' })
    Object.assign(item, { fee_type: 'TRAVEL', amount: '12.34', no_invoice_reason: '政策允许' })
    Object.assign(item.allocations[0], { project_id: 'project', amount: '12.34' })
    fixture.state.selected.value = { id: 'claim-1', version: 3, status: 'DRAFT' }
    await fixture.state.saveDraft()
    assert.equal(fixture.state.draft.value.title, '保留的标题')
    assert.match(fixture.state.error.value, /单据版本已更新/)
    assert.match(fixture.state.conflictSnapshot.value.text, /报销单/)
    assert.match(fixture.state.conflictSnapshot.value.text, /版本 4/)
    assert.match(fixture.state.conflictSnapshot.value.text, /已退回/)
    assert.match(fixture.state.conflictSnapshot.value.text, /当前编辑仍保留/)
  } finally { fixture.unmount() }
})

test('409 冲突覆盖配置版本路径并读取最新发布状态', async () => {
  const fixture = await mountPage(['expense.policy.read', 'expense.policy.publish'], async (path, options) => {
    if (options && path.includes('/publish')) throw Object.assign(new Error('配置版本已变化'), { status: 409, code: 'STATE_CONFLICT' })
    if (path.startsWith('/configurations/travel-policy')) {
      return { items: [{ id: 'p1', version: 5, content_version: 5, status: 'ACTIVE' }], total: 1, page: 1, page_size: 20 }
    }
    return { items: [], total: 0, page: 1, page_size: 20 }
  }, 'policies')
  try {
    fixture.state.policyKind.value = 'travel-policy'
    fixture.state.policyID.value = 'p1'
    fixture.state.policyVersion.value = 4
    await fixture.state.publishPolicy()
    assert.match(fixture.state.error.value, /配置版本已变化/)
    assert.match(fixture.state.conflictSnapshot.value.text, /配置版本/)
    assert.match(fixture.state.conflictSnapshot.value.text, /版本 5/)
  } finally { fixture.unmount() }
})

test('422 非费用字段错误滚动并聚焦对应控件', async () => {
  const fixture = await mountPage(['expense.claim.read'], async () => ({ items: [], total: 0 }), 'claims')
  const focused = []
  const previousDocument = globalThis.document
  globalThis.document = {
    querySelectorAll: (selector) => selector === '[data-field]'
      ? [{ dataset: { field: 'org_id' }, matches: (value) => value.includes('select'),
        scrollIntoView() {}, focus() { focused.push('org_id') } }]
      : [],
    querySelector: () => null,
  }
  try {
    await fixture.state.focusValidation('org_id')
    assert.deepEqual(focused, ['org_id'])
    assert.equal(fixture.state.validationHint.value, '')
  } finally {
    globalThis.document = previousDocument
    fixture.unmount()
  }
})

test('422 费用子字段错误聚焦具体输入而非整行', async () => {
  const fixture = await mountPage(['expense.claim.read'], async () => ({ items: [], total: 0 }), 'claims')
  const focused = []
  const sub = { dataset: { field: 'city_code' }, matches: (value) => value.includes('input'),
    scrollIntoView() {}, focus() { focused.push('city_code') } }
  const row = { matches: () => false, scrollIntoView() {}, querySelectorAll: () => [sub] }
  const previousDocument = globalThis.document
  globalThis.document = {
    querySelectorAll: () => [],
    querySelector: (selector) => selector === '[data-expense-index="0"]' ? row : null,
  }
  try {
    await fixture.state.focusValidation('items[0].city_code')
    assert.deepEqual(focused, ['city_code'])
    assert.equal(fixture.state.validationHint.value, '')
  } finally {
    globalThis.document = previousDocument
    fixture.unmount()
  }
})

test('422 无锚点字段给出可见提示而非静默忽略', async () => {
  const fixture = await mountPage(['expense.claim.read'], async () => ({ items: [], total: 0 }), 'claims')
  const previousDocument = globalThis.document
  globalThis.document = { querySelectorAll: () => [], querySelector: () => null }
  try {
    await fixture.state.focusValidation('unknown_field')
    assert.match(fixture.state.validationHint.value, /unknown_field/)
  } finally {
    globalThis.document = previousDocument
    fixture.unmount()
  }
})

test('付款分区打开单据后请求付款历史并渲染历史表', async () => {
  const calls = []
  const payment = { id: 'pay-1', amount_minor: '1234', currency: 'CNY', paid_date: '2026-11-09',
    method: 'BANK', transaction_no: 'TXN-1', status: 'PAID', voucher_file_ids: [], created_at: '2026-11-09T02:00:00Z' }
  const fixture = await mountPage(['expense.payment.read', 'expense.claim.read'], async (path) => {
    calls.push(path)
    if (path === '/claims/claim-1') return { id: 'claim-1', claim_no: 'EXP-1', version: 3, status: 'PAID',
      currency: 'CNY', payable_minor: '1234', items: [] }
    if (path === '/claims/claim-1/payments?page=1&page_size=20') {
      return { items: [payment], total: 1, page: 1, page_size: 20 }
    }
    if (path === '/claims/claim-1/reversal-requests?page=1&page_size=20') return { items: [], total: 0 }
    return { items: [], total: 0 }
  }, 'payments')
  try {
    await fixture.state.openClaim('claim-1')
    assert.ok(calls.includes('/claims/claim-1/payments?page=1&page_size=20'))
    assert.equal(fixture.state.paymentHistory.value.length, 1)
    const html = await fixture.html()
    assert.match(html, /付款历史/)
    assert.match(html, /pay-1/)
    assert.match(html, /付款单号/)
  } finally { fixture.unmount() }
})

test('付款分区展示项目费用参与人查询与维护入口', async () => {
  const fixture = await mountPage(['expense.payment.read', 'expense.claim.read'], async () => ({ items: [], total: 0 }), 'payments')
  try {
    fixture.state.projectOptions.value = [{ project_id: 'project-1', project_name: '示例项目' }]
    const html = await fixture.html()
    assert.match(html, /项目费用参与人/)
    assert.match(html, /查询项目选项/)
    assert.match(html, /project-1/)
    assert.match(html, /示例项目/)
    assert.match(html, /维护费用参与人/)
  } finally { fixture.unmount() }
})


test('导出命令409时读取导出范围内每张单据的最新版本', async () => {
  const fixture = await mountPage(['expense.claim.read', 'expense.archive.export'], async (path) => {
    if (path === '/exports') throw Object.assign(new Error('导出范围已变化'), { status: 409, code: 'STATE_CONFLICT' })
    if (path === '/claims/a') return { id: 'a', version: 7, status: 'APPROVED_PENDING_PAYMENT', claim_no: 'EXP-A' }
    if (path === '/claims/b') return { id: 'b', version: 3, status: 'DRAFT', claim_no: 'EXP-B' }
    return { items: [], total: 0, page: 1, page_size: 20 }
  }, 'claims')
  try {
    fixture.state.selected.value = { id: 'a', version: 6 }
    await fixture.state.createExport(['a', 'b'])
    assert.match(fixture.state.error.value, /导出范围已变化/)
    assert.match(fixture.state.conflictSnapshot.value.text, /导出范围 2 张单据/)
    assert.match(fixture.state.conflictSnapshot.value.text, /EXP-A@v7/)
    assert.match(fixture.state.conflictSnapshot.value.text, /EXP-B@v3/)
    assert.match(fixture.state.conflictSnapshot.value.text, /当前编辑仍保留/)
  } finally { fixture.unmount() }
})

test('付款中心读取单据付款与冲正历史，不再只依赖active_payment_id单条', async () => {
  const calls = []
  const fixture = await mountPage(['expense.claim.read', 'expense.payment.read'], async (path) => {
    calls.push(path)
    if (path === '/claims/c1') return { id: 'c1', version: 2, status: 'APPROVED_PENDING_PAYMENT', payable_minor: '1000', currency: 'CNY', items: [] }
    if (path.startsWith('/claims/c1/payments')) return { items: [{ id: 'p1', amount_minor: '1000', currency: 'CNY', paid_date: '2026-11-10', method: 'BANK', transaction_no: 'T1', status: 'SETTLED' }], total: 1, page: 1, page_size: 50 }
    if (path.startsWith('/claims/c1/reversal-requests')) return { items: [{ id: 'r1', fact_kind: 'NO_PAYMENT', status: 'PENDING', version: 1 }], total: 1, page: 1, page_size: 50 }
    if (path === '/payments/p1') assert.fail('无 active_payment_id 时不应读取单条付款')
    return { items: [], total: 0, page: 1, page_size: 20 }
  }, 'payments')
  try {
    await fixture.state.openClaim('c1')
    assert.equal(fixture.state.payment.value, null)
    assert.equal(fixture.state.paymentHistory.value.length, 1)
    assert.equal(fixture.state.paymentHistory.value[0].id, 'p1')
    assert.equal(fixture.state.reversalHistory.value[0].id, 'r1')
    assert.ok(calls.some((path) => path.startsWith('/claims/c1/payments')))
    assert.ok(calls.some((path) => path.startsWith('/claims/c1/reversal-requests')))
    // 付款历史与冲正历史必须挂在真实滚动容器里：裸 <table> 在 375px 会被逐字压窄（与同批异常表同一问题）。
    const html = await fixture.html()
    const paymentSection = html.slice(html.indexOf('付款历史'), html.indexOf('冲正申请'))
    assert.match(paymentSection, /<div class="expense-table"><table class="expense-table-body">/,
      '付款历史表必须包在 .expense-table 滚动容器内并带 .expense-table-body 表体挂点')
    assert.equal((paymentSection.match(/<th scope="col">/g) || []).length, 7, '付款历史表固定 7 列')
    assert.doesNotMatch(paymentSection, /<table(?! class="expense-table-body")/,
      '付款历史表不能再出现裸 <table>')
    const reversalSection = html.slice(html.indexOf('冲正申请'))
    assert.match(reversalSection, /<div class="expense-table"><table class="expense-table-body">/,
      '冲正历史表必须包在 .expense-table 滚动容器内并带 .expense-table-body 表体挂点')
    assert.equal((reversalSection.match(/<th scope="col">/g) || []).length, 4, '冲正历史表固定 4 列')
    assert.doesNotMatch(reversalSection, /<table(?! class="expense-table-body")/,
      '冲正历史表不能再出现裸 <table>')
  } finally { fixture.unmount() }
})

test('422 嵌套字段坐标按别名回退到收款档案锚点', async () => {
  const fixture = await mountPage(['expense.claim.read'], async () => ({ items: [], total: 0 }), 'claims')
  const focused = []
  const payee = { dataset: { field: 'payee_profile_id' }, matches: (value) => value.includes('input'),
    scrollIntoView() {}, focus() { focused.push('payee_profile_id') } }
  const previousDocument = globalThis.document
  globalThis.document = { querySelectorAll: () => [payee], querySelector: () => null }
  try {
    await fixture.state.focusValidation('payee_profile.tax_id')
    assert.deepEqual(focused, ['payee_profile_id'])
    assert.equal(fixture.state.validationHint.value, '')
  } finally { globalThis.document = previousDocument; fixture.unmount() }
})

test('422 items.0.field 点号坐标同样聚焦费用行子控件', async () => {
  const fixture = await mountPage(['expense.claim.read'], async () => ({ items: [], total: 0 }), 'claims')
  const focused = []
  const sub = { dataset: { field: 'city_code' }, matches: (value) => value.includes('input'),
    scrollIntoView() {}, focus() { focused.push('city_code') } }
  const row = { matches: () => false, scrollIntoView() {}, querySelectorAll: () => [sub] }
  const previousDocument = globalThis.document
  globalThis.document = {
    querySelectorAll: () => [],
    querySelector: (selector) => selector === '[data-expense-index="0"]' ? row : null,
  }
  try {
    await fixture.state.focusValidation('items.0.city_code')
    assert.deepEqual(focused, ['city_code'])
    assert.equal(fixture.state.validationHint.value, '')
  } finally { globalThis.document = previousDocument; fixture.unmount() }
})

test('报销工作区基于授权项目选项提供费用参与人入口且不代持项目写操作', async () => {
  const source = readFileSync(new URL('./ReimbursementView.vue', import.meta.url), 'utf8')
  assert.match(source, /项目费用参与人/)
  assert.match(source, /\/project-options\?/)
  assert.match(source, /openProjectExpenseParticipants/)
  assert.match(source, /project_detail/)
  assert.doesNotMatch(source, /expense-participants/)
})

test('列表当前节点显示中文岗位，不把审批节点编码直接交给用户', async () => {
  const fixture = await mountPage(['expense.claim.read'], async (path) => {
    if (path.startsWith('/claims?')) return { items: [{
      id: 'claim-1', claim_no: 'BX-1', status: 'IN_APPROVAL', version: 3,
      current_approval_node: 'ACCOUNTANT / FINANCE_DIRECTOR', payable_minor: '100', created_at: '2026-11-11T08:00:00+08:00',
    }], total: 1 }
    throw new Error(`unexpected ${path}`)
  }, 'claims')
  try {
    const html = await fixture.html()
    assert.match(html, /会计审核 \/ 财务负责人/)
    assert.doesNotMatch(html, /ACCOUNTANT|FINANCE_DIRECTOR/)
  } finally { fixture.unmount() }
})

test('解析失败现场显示原因与下一步，不回显 PARSER_FAILED 机器码', async () => {
  const fixture = await mountPage(['expense.invoice.read', 'expense.invoice.upload'], async (path) => {
    if (path.startsWith('/invoices?')) return { items: [], total: 0 }
    throw new Error(`unexpected ${path}`)
  }, 'invoices')
  try {
    fixture.state.parseRun.value = { id: 'job-1', status: 'FAILED', attempt: 2, last_error: 'PARSER_FAILED' }
    fixture.state.documentStatus.value = { id: 'document-1', status: 'READY' }
    const html = await fixture.html()
    assert.match(html, /未能从原件中提取票面字段/)
    assert.match(html, /人工录入/)
    assert.match(html, /已就绪/)
    assert.doesNotMatch(html, /PARSER_FAILED/)
  } finally { fixture.unmount() }
})

test('有未保存草稿时切换分区、刷新和新建都先确认，取消后保留输入', async () => {
  const fixture = await mountPage(['expense.claim.read', 'expense.claim.create'], async () => ({ items: [], total: 0 }), 'claims')
  try {
    fixture.state.draft.value.title = '未保存的差旅标题'
    assert.equal(fixture.state.draftProtected.value, true)
    const confirms = []
    globalThis.window.confirm = (message) => { confirms.push(message); return false }
    fixture.state.navigate('invoices')
    assert.equal(confirms.length, 1)
    assert.equal(fixture.routerCalls.push.length, 0)
    let prevented = false
    fixture.state.protectPending({ preventDefault() { prevented = true } })
    assert.equal(prevented, true)
    await fixture.state.newDraft()
    assert.equal(fixture.state.draft.value.title, '未保存的差旅标题')
    assert.equal(confirms.length, 2)
    assert.match(confirms[0], /未保存.*丢失/)
  } finally { delete globalThis.window.confirm; fixture.unmount() }
})

test('新建草稿里的空白占位费用不触发未保存确认', async () => {
  const fixture = await mountPage(['expense.claim.read', 'expense.claim.create'], async () => ({ items: [], total: 0 }), 'claims')
  try {
    assert.equal(fixture.state.draft.value.items.length, 1)
    assert.equal(fixture.state.draftProtected.value, false)
    let confirms = 0
    globalThis.window.confirm = () => { confirms += 1; return true }
    fixture.state.navigate('invoices')
    assert.equal(confirms, 0)
  } finally { delete globalThis.window.confirm; fixture.unmount() }
})

test('客户端校验失败带费用行坐标、标红对应区域且不发送保存请求', async () => {
  const calls = []
  const fixture = await mountPage(['expense.claim.read', 'expense.claim.create'], async (path, options) => {
    calls.push([path, options])
    return path === '/claim-options' ? draftOptionsFixture() : { items: [], total: 0 }
  }, 'claims')
  try {
    Object.assign(fixture.state.draft.value, { title: '分摊不平', org_id: 'org' })
    const item = fixture.state.draft.value.items[0]
    Object.assign(item, { fee_type: 'TRAVEL', amount: '12.00' })
    Object.assign(item.allocations[0], { project_id: 'project', amount: '10.00' })
    const scrolled = []
    const row = { matches: () => false, scrollIntoView: () => scrolled.push('row'), querySelectorAll: () => [] }
    const previousDocument = globalThis.document
    globalThis.document = { querySelectorAll: () => [], querySelector: () => row }
    try {
      await fixture.state.saveDraft()
      await new Promise((resolve) => setImmediate(resolve))
      assert.deepEqual(scrolled, ['row'])
    } finally { globalThis.document = previousDocument }
    assert.equal(calls.some(([path, options]) => path === '/claims' && options?.method === 'POST'), false)
    assert.equal(fixture.state.fieldErrors.value[0].field, 'items[0].allocations')
    assert.equal(fixture.state.invalidField('allocations', 0), true)
    assert.equal(fixture.state.invalidField('allocations', 1), false)
    assert.match(fixture.state.error.value, /分摊/)
    assert.match(await fixture.html(), /aria-invalid="true"/)
  } finally { fixture.unmount() }
})

test('打开单据详情写入深链并滚动到视口，详情显示轮次节点且可返回列表', async () => {
  const fixture = await mountPage(['expense.claim.read', 'expense.claim.update'], async (path) => {
    if (path === '/claims/claim-1') return { id: 'claim-1', claim_no: 'BX-1', version: 2, status: 'IN_APPROVAL',
      current_round: 2, current_approval_node: 'ACCOUNTANT', applicant_subject_id: 'actor',
      payable_minor: '100', items: [] }
    return { items: [], total: 0 }
  }, 'claims')
  try {
    let scrolled = null
    fixture.state.detailPanel.value = { scrollIntoView: (options) => { scrolled = options } }
    await fixture.state.openClaim('claim-1')
    assert.equal(fixture.state.selected.value.id, 'claim-1')
    assert.equal(fixture.routerCalls.replace.at(-1)[0].query.claim_id, 'claim-1')
    assert.equal(scrolled.block, 'start')
    const html = await fixture.html()
    assert.match(html, /第 2 轮/)
    assert.match(html, /会计审核/)
    assert.match(html, /返回列表/)
    await fixture.state.backToList('claim')
    assert.equal(fixture.state.selected.value, null)
    assert.equal(fixture.routerCalls.replace.at(-1)[0].query.claim_id, undefined)
  } finally { fixture.unmount() }
})

test('审批动作在详情内与原因同屏，二次确认后才提交并显示待办人', async () => {
  const actions = []
  const fixture = await mountPage(['expense.claim.read', 'expense.approval.act', 'expense.approval.transfer'], async (path, options) => {
    if (path === '/approval-tasks/task-1') return { id: 'task-1', claim_id: 'claim-1', claim_version: 8,
      round: 2, version: 3, status: 'PENDING', node_code: 'ACCOUNTANT', assignee: 'approver',
      allowed_actions: ['APPROVE', 'RETURN', 'TRANSFER'], snapshot: { version: 4, items: [] } }
    if (path === '/approval-tasks/task-1/history') return { items: [] }
    if (path === '/approval-tasks/task-1/actions') { actions.push(JSON.parse(options.body)); return {} }
    return { items: [], total: 0 }
  }, 'approvals')
  try {
    await fixture.state.openApproval('task-1')
    assert.match((await fixture.html()), /待办人 approver/)
    fixture.state.approvalReason.value = ''
    fixture.state.requestApprovalAction('RETURN')
    assert.match(fixture.state.error.value, /退回前请填写审批说明/)
    assert.equal(fixture.state.pendingApprovalAction.value, '')
    fixture.state.approvalReason.value = '票据不合规'
    fixture.state.requestApprovalAction('RETURN')
    assert.equal(fixture.state.pendingApprovalAction.value, 'RETURN')
    const html = await fixture.html()
    assert.match(html, /确认对第 2 轮/)
    assert.match(html, /票据不合规/)
    assert.equal(actions.length, 0)
    await fixture.state.confirmApprovalAction()
    assert.equal(actions.length, 1)
    assert.equal(actions[0].action, 'RETURN')
    assert.equal(actions[0].reason, '票据不合规')
    assert.equal(actions[0].round, 2)
  } finally { fixture.unmount() }
})

test('审批列表不再行内直接办理动作，只保留进入详情的入口', async () => {
  const fixture = await mountPage(['expense.claim.read', 'expense.approval.act'], async (path) => {
    if (path.startsWith('/approval-tasks?')) return { items: [{ id: 'task-1', claim_no: 'BX-1',
      status: 'PENDING', round: 1, version: 1, node_code: 'ACCOUNTANT', allowed_actions: ['APPROVE', 'RETURN'] }], total: 1 }
    return { items: [], total: 0 }
  }, 'approvals')
  try {
    const html = await fixture.html()
    assert.match(html, /查看任务与办理/)
    assert.doesNotMatch(html, /服务端未授予动作/)
    assert.doesNotMatch(html, />退回</)
  } finally { fixture.unmount() }
})

// 用途：构造付款分区可打开的单据与历史请求替身。
// 参数：无。
// 返回值：按路径返回单据、付款和冲正历史的 request 函数。
function paymentFixtureRequest() {
  return async (path) => {
    if (path === '/claims/claim-1') return { id: 'claim-1', claim_no: 'BX-1', status: 'APPROVED_PENDING_PAYMENT',
      version: 2, payable_minor: '100', currency: 'CNY', items: [], applicant_subject_id: 'applicant' }
    if (path.startsWith('/claims/claim-1/payments')) return { items: [], total: 0 }
    if (path.startsWith('/claims/claim-1/reversal-requests')) return { items: [], total: 0 }
    return { items: [], total: 0 }
  }
}

test('没有登记付款权限时不显示可填写付款表单，并说明下一步', async () => {
  const fixture = await mountPage(['expense.claim.read', 'expense.payment.read'], paymentFixtureRequest(), 'payments')
  try {
    await fixture.state.openClaim('claim-1')
    const html = await fixture.html()
    assert.match(html, /你没有登记付款的权限/)
    assert.match(html, /出纳登记/)
    assert.doesNotMatch(html, /登记全额/)
    assert.doesNotMatch(html, /付款凭证文件ID/)
  } finally { fixture.unmount() }
})

test('有登记付款权限时显示付款表单，并在非待付款状态禁用', async () => {
  const fixture = await mountPage(['expense.claim.read', 'expense.payment.read', 'expense.payment.record'],
    paymentFixtureRequest(), 'payments')
  try {
    await fixture.state.openClaim('claim-1')
    const html = await fixture.html()
    assert.match(html, /全额付款事实登记/)
    assert.match(html, /登记全额/)
    assert.doesNotMatch(html, /你没有登记付款的权限/)
  } finally { fixture.unmount() }
})

test('没有发起冲正权限时只显示记录和原因，不显示可填写冲正表单', async () => {
  const fixture = await mountPage(['expense.claim.read', 'expense.payment.read'], paymentFixtureRequest(), 'payments')
  try {
    await fixture.state.openClaim('claim-1')
    const html = await fixture.html()
    assert.match(html, /你没有发起或批准冲正的权限/)
    assert.doesNotMatch(html, /事实与原因/)
    assert.doesNotMatch(html, />\s*申请冲正\s*</)
  } finally { fixture.unmount() }
})

test('只读报销单说明为什么不能编辑，区分权限、身份和状态', async () => {
  const fixture = await mountPage(['expense.claim.read'], async (path) => {
    if (path === '/claims/claim-1') return { id: 'claim-1', claim_no: 'BX-1', version: 2, status: 'IN_APPROVAL',
      applicant_subject_id: 'actor', payable_minor: '100', items: [] }
    return { items: [], total: 0 }
  }, 'claims')
  try {
    await fixture.state.openClaim('claim-1')
    assert.match((await fixture.html()), /当前账号没有修改报销单的权限/)
  } finally { fixture.unmount() }
})

test('有编辑权限但不是本人或状态不允许时，说明具体只读原因', async () => {
  const fixture = await mountPage(['expense.claim.read', 'expense.claim.update'], async (path) => {
    if (path === '/claims/claim-1') return { id: 'claim-1', claim_no: 'BX-1', version: 2, status: 'IN_APPROVAL',
      applicant_subject_id: 'actor', payable_minor: '100', items: [] }
    return { items: [], total: 0 }
  }, 'claims')
  try {
    await fixture.state.openClaim('claim-1')
    assert.match((await fixture.html()), /单据当前为「审批中」，只有草稿、已退回或已撤回状态可以编辑/)
  } finally { fixture.unmount() }
})

test('解析创建后自动查询任务并提示完成，失败现场可重新发起', async () => {
  let phase = 'done'
  const paths = []
  const fixture = await mountPage(['expense.claim.read', 'expense.invoice.upload'], async (path) => {
    paths.push(path)
    if (path.startsWith('/invoices?')) return { items: [], total: 0 }
    if (path === '/invoice-documents/doc') return { id: 'doc', version: 2, file_id: 'file', status: 'READY' }
    if (path === '/invoice-documents/doc/parse') return { id: 'run-1', status: 'PENDING', document_version: 3 }
    if (path === '/parse-runs/run-1') {
      return phase === 'done'
        ? { id: 'run-1', status: 'DONE' }
        : { id: 'run-1', status: 'FAILED', last_error: 'PARSER_FAILED' }
    }
    return { items: [], total: 0 }
  }, 'invoices')
  try {
    fixture.state.documentID.value = 'doc'
    await fixture.state.parseDocument()
    assert.ok(paths.includes('/parse-runs/run-1'), '发起解析后应自动查询任务')
    assert.equal(fixture.state.parseRun.value.status, 'DONE')
    assert.match(fixture.state.notice.value, /解析任务已完成/)
    phase = 'failed'
    await fixture.state.parseDocument()
    assert.match(fixture.state.notice.value, /解析任务未完成/)
    assert.match(fixture.state.notice.value, /人工录入/)
    const html = await fixture.html()
    assert.match(html, /重新发起解析/)
    assert.doesNotMatch(html, /PARSER_FAILED/)
  } finally { fixture.unmount() }
})

test('导出创建后自动查询任务，失败保留重试并按原范围重发', async () => {
  let phase = 'failed'
  let posts = 0
  const fixture = await mountPage(['expense.claim.read', 'expense.archive.export'], async (path, options) => {
    if (path === '/exports' && options?.method === 'POST') {
      posts += 1
      return { id: `export-${posts}`, status: 'PENDING' }
    }
    if (path.startsWith('/exports/export-')) {
      return phase === 'done'
        ? { id: path.split('/').at(-1), status: 'DONE', result: { result: { filename: 'a.csv', claim_ids: ['claim-1'], sha256: 'a'.repeat(64), content: 'a\n' } } }
        : { id: path.split('/').at(-1), status: 'FAILED', last_error: 'EXPORT_LIMIT_EXCEEDED' }
    }
    return { items: [], total: 0 }
  }, 'claims')
  try {
    await fixture.state.createExport(['claim-1'])
    assert.match(fixture.state.notice.value, /导出任务未完成/)
    assert.match(fixture.state.notice.value, /缩小日期范围|减少勾选/)
    let html = await fixture.html()
    assert.match(html, /重试导出/)
    phase = 'done'
    await fixture.state.retryExport()
    assert.equal(posts, 2)
    assert.equal(fixture.state.exportJob.value.status, 'DONE')
    assert.match(fixture.state.notice.value, /导出任务已完成/)
    html = await fixture.html()
    assert.match(html, /下载导出文件/)
  } finally { fixture.unmount() }
})

test('发票票面总额按元录入、按整数分提交，100.00 元与 10000 分不多算一百倍', async () => {
  // 单位换算本身先确认一遍：展示用元、提交用整数分。
  assert.equal(toMinor('100.00'), '10000')
  assert.equal(formatMinor('10000'), '100.00')
  const sent = []
  const fixture = await mountPage(['expense.invoice.read', 'expense.invoice.review'], async (path, options) => {
    if (path === '/invoices/inv') {
      return { id: 'inv', version: 2, total_minor: '10000', file_ids: ['file'], owner_subject_id: 'actor',
        reservation_state: 'AVAILABLE', review_status: 'PENDING', content: { lines: [] } }
    }
    if (path === '/invoices/inv/confirm') { sent.push(JSON.parse(options.body)); return { id: 'inv' } }
    return { items: [], total: 0 }
  }, 'invoices')
  try {
    await fixture.state.openInvoice('inv')
    // 展示层统一为元：服务端 10000 分显示 100.00 元。
    assert.equal(fixture.state.invoiceTotalYuan.value, '100.00')
    let html = await fixture.html()
    assert.match(html, /票面总额（元）/)
    assert.doesNotMatch(html, /票面总额（整数分）/)
    fixture.state.invoiceReviewReason.value = '对照原件核对票面'
    await fixture.state.confirmInvoice()
    assert.equal(sent[0].total_minor, '10000')
    // 人工改成 100.00 元后仍提交 10000 分，并给出等价分提示。
    fixture.state.invoiceTotalYuan.value = '100.00'
    assert.match(fixture.state.invoiceTotalMinorHint.value, /10000 分/)
    await fixture.state.confirmInvoice()
    assert.equal(sent[1].total_minor, '10000')
    // 录入非法金额时不发确认请求，只给可见原因。
    fixture.state.invoiceTotalYuan.value = '100.00.0'
    await fixture.state.confirmInvoice()
    assert.equal(sent.length, 2)
    assert.match(fixture.state.error.value, /金额/)
  } finally { fixture.unmount() }
})

test('报销模块金额标签统一为元，需要展示分时同时给出等值元', () => {
  const components = new URL('../components/', import.meta.url)
  const files = [new URL('./ReimbursementView.vue', import.meta.url),
    ...readdirSync(components).filter((name) => name.endsWith('.vue'))
      .map((name) => new URL(`../components/${name}`, import.meta.url))]
  for (const file of files) {
    const source = readFileSync(file, 'utf8')
    assert.doesNotMatch(source, /票面总额（整数分）/, `${file.pathname} 仍把整数分当录入单位`)
    assert.doesNotMatch(source, /（分）/, `${file.pathname} 仍有只标分的字段标签`)
    assert.doesNotMatch(source, /金额为整数分/, `${file.pathname} 仍按整数分解释金额`)
  }
  const view = readFileSync(new URL('./ReimbursementView.vue', import.meta.url), 'utf8')
  // 解析候选（服务端给整数分）必须同时显示等值元。
  assert.match(view, /分（\$\{formatMinor\(text\)\} 元）/)
})

test('列表读取失败显示错误态与重试，不渲染成"暂无记录"', async () => {
  const fixture = await mountPage(['expense.claim.read'], async (path) => {
    if (path.startsWith('/claims?')) throw Object.assign(new Error('报销列表读取失败，请稍后重试'), { status: 503 })
    return { items: [], total: 0 }
  }, 'claims')
  try {
    assert.match(fixture.state.listError.value, /报销列表读取失败/)
    const html = await fixture.html()
    assert.match(html, /列表加载失败/)
    assert.match(html, /role="alert"/)
    assert.match(html, /重新加载/)
    assert.doesNotMatch(html, /当前权限范围内暂无记录/)
  } finally { fixture.unmount() }
})

test('工作台、看板与归档项目读取失败各自显示错误态，不冒充"没有待办/暂无数据"', async () => {
  const dashboard = await mountPage(['expense.claim.read'], async () => { throw new Error('工作台读取失败，请稍后重试') })
  try {
    const html = await dashboard.html()
    assert.match(html, /工作台加载失败/)
    assert.match(html, /工作台读取失败/)
    assert.doesNotMatch(html, /当前没有可办理的审批待办/)
  } finally { dashboard.unmount() }

  const analytics = await mountPage(['expense.claim.read'], async () => {
    throw new Error('看板读取失败，请稍后重试')
  }, 'analytics')
  try {
    const html = await analytics.html()
    assert.match(html, /看板加载失败/)
    assert.doesNotMatch(html, /当前范围没有数据/)
  } finally { analytics.unmount() }

  const archives = await mountPage(['expense.archive.read'], async (path) => {
    if (path.startsWith('/archive-projects')) throw new Error('归档聚合读取失败，请稍后重试')
    return { items: [], total: 0 }
  }, 'archives')
  try {
    const html = await archives.html()
    assert.match(html, /项目归档包加载失败/)
    assert.doesNotMatch(html, /当前范围没有已封存项目档案/)
  } finally { archives.unmount() }
})

test('冲正历史读取失败显示原因，不被当成"没有冲正"', async () => {
  const fixture = await mountPage(['expense.claim.read', 'expense.payment.read'], async (path) => {
    if (path === '/claims/claim-1') {
      return { id: 'claim-1', status: 'PAID', version: 2, payable_minor: '100', currency: 'CNY', items: [] }
    }
    if (path.startsWith('/claims/claim-1/payments')) return { items: [], total: 0 }
    if (path.startsWith('/claims/claim-1/reversal-requests')) throw new Error('冲正服务暂不可用')
    return { items: [], total: 0 }
  }, 'payments')
  try {
    await fixture.state.openClaim('claim-1')
    assert.match(fixture.state.reversalHistoryError.value, /冲正/)
    const html = await fixture.html()
    assert.match(html, /冲正申请读取失败/)
    // 付款历史本身读成功且为空，这时"尚无付款记录"才是真话。
    assert.equal(fixture.state.paymentHistoryLoaded.value, true)
    assert.match(html, /当前单据尚无付款记录/)
  } finally { fixture.unmount() }
})

test('跨分区切换后重读付款数据，不把"没发请求"显示成尚无付款记录', async () => {
  const calls = []
  const fixture = await mountPage(['expense.claim.read', 'expense.payment.read'], async (path) => {
    calls.push(path)
    if (path === '/claims/claim-1') {
      return { id: 'claim-1', status: 'APPROVED_PENDING_PAYMENT', version: 2, payable_minor: '100',
        currency: 'CNY', active_payment_id: 'pay-1', items: [] }
    }
    if (path === '/payments/pay-1') return { id: 'pay-1', amount_minor: '100', currency: 'CNY' }
    if (path.startsWith('/claims/claim-1/payments')) return { items: [], total: 0 }
    if (path.startsWith('/claims/claim-1/reversal-requests')) return { items: [], total: 0 }
    return { items: [], total: 0 }
  }, 'claims')
  try {
    await fixture.state.openClaim('claim-1')
    assert.equal(calls.some((path) => path.startsWith('/claims/claim-1/payments')), false, '单据分区不读付款历史')
    assert.equal(fixture.state.paymentHistoryLoaded.value, false, '还没发请求时不能把空列表当成已读结果')
    fixture.route.params.section = 'payments'
    await new Promise((resolve) => setImmediate(resolve))
    await Vue.nextTick()
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(fixture.state.selected.value.id, 'claim-1', '切换分区后仍保留当前单据')
    assert.ok(calls.includes('/payments/pay-1'), '进入付款分区应重读当前有效付款')
    assert.ok(calls.some((path) => path.startsWith('/claims/claim-1/payments')), '进入付款分区应重读付款历史')
    assert.equal(fixture.state.paymentHistoryLoaded.value, true)
  } finally { fixture.unmount() }
})

test('列表列按分区拆分：审批区显示轮次与节点，付款区不显示空节点列', async () => {
  const approvals = await mountPage(['expense.claim.read', 'expense.approval.act'], async (path) => {
    if (path.startsWith('/approval-tasks?')) {
      return { items: [{ id: 'task-1', claim_no: 'BX-1', status: 'PENDING', round: 2, version: 1,
        node_code: 'ACCOUNTANT', assignee_subject_id: 'approver' }], total: 1 }
    }
    return { items: [], total: 0 }
  }, 'approvals')
  try {
    const html = await approvals.html()
    assert.match(html, /审批轮次/)
    assert.match(html, /第 2 轮/)
    assert.match(html, /审批节点 \/ 异常/)
    assert.match(html, /会计审核/)
    assert.doesNotMatch(html, /金额 \/ 任务/)
    assert.doesNotMatch(html, /金额 \/ 任务/)
  } finally { approvals.unmount() }

  const payments = await mountPage(['expense.claim.read', 'expense.payment.read'], async (path) => {
    if (path.startsWith('/claims?')) {
      return { items: [{ id: 'c1', claim_no: 'BX-2', status: 'PAID', version: 2, claim_type: 'TRAVEL',
        applicant_subject_id: 'actor', payable_minor: '123400', current_approval_node: 'ACCOUNTANT' }], total: 1 }
    }
    return { items: [], total: 0 }
  }, 'payments')
  try {
    const html = await payments.html()
    assert.match(html, /应付金额/)
    assert.match(html, /1234\.00 元/)
    assert.doesNotMatch(html, /当前节点 \/ 异常/)
    assert.doesNotMatch(html, /会计审核/)
  } finally { payments.unmount() }
})

test('工作台指标可跳转到对应分区，侧栏重复按钮墙已移除', async () => {
  const fixture = await mountPage(['expense.claim.read', 'expense.approval.act', 'expense.payment.read', 'expense.invoice.read'],
    async (path) => {
      if (path === '/dashboard') {
        return { my_claims: 3, pending_approvals: 1, pending_payments: 2, invoice_review_required: 4,
          my_paid_this_month: 5, pending_tasks: [] }
      }
      return { items: [], total: 0 }
    })
  try {
    const html = await fixture.html()
    assert.match(html, /<button[^>]*expense-metric-link[^>]*>我的单据：3/)
    assert.match(html, /<button[^>]*expense-metric-link[^>]*>待复核发票：4/)
    // 指标点击走导航，而不是只有一行数字。
    fixture.state.navigate('invoices')
    assert.equal(fixture.routerCalls.push.at(-1)[0].params.section, 'invoices')
    // 侧栏已有入口，工作台不再重复一墙按钮。
    assert.doesNotMatch(html, /<button[^>]*>(发票中心|报销看板|审批中心|付款中心)</)
  } finally { fixture.unmount() }
})

test('发票上传并入发票中心导航，异常池保留单独入口并说明关系', async () => {
  const fixture = await mountPage(['expense.invoice.read', 'expense.invoice.upload'],
    async () => ({ items: [], total: 0 }), 'invoices')
  try {
    const items = fixture.state.navGroups.value.flatMap((group) => group.items || [])
    assert.deepEqual(items.map((item) => item.key), ['portal', 'invoices', 'invoice-abnormal'])
    const html = await fixture.html()
    assert.match(html, /上传、人工录入与票面复核都在本页完成/)
    assert.match(html, /打开异常发票池/)
    assert.doesNotMatch(html, /发票上传与人工录入/)
  } finally { fixture.unmount() }
})

test('列表不再出现开发文案，被禁用的发票勾选给出具体原因', async () => {
  const invoices = await mountPage(['expense.claim.read', 'expense.invoice.read', 'expense.claim.create'], async (path) => {
    if (path.startsWith('/invoices?')) {
      return { items: [
        { id: 'i1', invoice_number: 'INV-1', status: 'PENDING', review_status: 'PENDING', reservation_state: 'AVAILABLE' },
        { id: 'i2', invoice_number: 'INV-2', status: 'CONFIRMED', review_status: 'CONFIRMED', reservation_state: 'RESERVED' },
      ], total: 2 }
    }
    return { items: [], total: 0 }
  }, 'invoices')
  try {
    const html = await invoices.html()
    assert.doesNotMatch(html, /按任务可见|服务端金额|服务端未授予|按服务端能力/)
    assert.match(html, /只有「已人工复核」且未被其他单据占用的本人票据可以勾选生成费用/)
    assert.match(html, /title="这张发票还未人工复核，不能生成费用"/)
    assert.match(html, /title="这张发票已被其他单据占用或消费，不能重复使用"/)
  } finally { invoices.unmount() }

  const claims = await mountPage(['expense.claim.read'], async (path) => {
    if (path.startsWith('/claims?')) {
      return { items: [{ id: 'c1', claim_no: 'BX-3', status: 'IN_APPROVAL', version: 1,
        claim_type: 'TRAVEL', payable_minor: '100' }], total: 1 }
    }
    return { items: [], total: 0 }
  }, 'claims')
  try {
    const html = await claims.html()
    assert.match(html, /本任务范围未提供/)
    assert.doesNotMatch(html, /按任务可见/)
  } finally { claims.unmount() }
})

test('刷新后仍能靠本地记忆找回解析任务与最近原件并继续查询', async () => {
  const store = new Map()
  globalThis.localStorage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
  }
  try {
    const first = await mountPage(['expense.claim.read', 'expense.invoice.read', 'expense.invoice.upload'], async (path) => {
      if (path === '/invoice-documents/doc') return { id: 'doc', version: 2, file_id: 'file', status: 'READY' }
      if (path === '/invoice-documents/doc/parse') return { id: 'run-1', status: 'PENDING', document_version: 3 }
      if (path === '/parse-runs/run-1') return { id: 'run-1', status: 'DONE' }
      return { items: [], total: 0 }
    }, 'invoices')
    try {
      first.state.documentID.value = 'doc'
      await first.state.parseDocument()
      first.state.applyUploadCompletion({ document_id: 'doc' }, 'reimbursement.invoice.original', 'file')
      assert.ok(store.has('reimbursement.task.parse'), '解析任务号应写入本地记忆')
      assert.ok(store.has('reimbursement.task.document'), '最近上传的原件应写入本地记忆')
    } finally { first.unmount() }

    // 刷新：新页面实例不再持有内存状态，只能靠本地记忆找回。
    const calls = []
    const second = await mountPage(['expense.claim.read', 'expense.invoice.read', 'expense.invoice.upload'], async (path) => {
      calls.push(path)
      if (path === '/parse-runs/run-1') return { id: 'run-1', status: 'DONE' }
      if (path === '/invoice-documents/doc') return { id: 'doc', version: 2, file_id: 'file', status: 'READY' }
      return { items: [], total: 0 }
    }, 'invoices')
    try {
      assert.equal(second.state.recentTask.value.parse.task_id, 'run-1')
      assert.equal(second.state.recentTask.value.document.document_id, 'doc')
      const html = await second.html()
      assert.match(html, /继续查询上次解析任务/)
      assert.match(html, /读取最近上传的原件/)
      await second.state.resumeRecentDocument()
      assert.equal(second.state.documentID.value, 'doc')
      await second.state.resumeParseTask()
      assert.ok(calls.includes('/parse-runs/run-1'))
      assert.equal(second.state.parseRun.value.status, 'DONE')
    } finally { second.unmount() }
  } finally { delete globalThis.localStorage }
})

test('导出任务号写入本地记忆，刷新后能继续查询上次导出', async () => {
  const store = new Map()
  globalThis.localStorage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
  }
  try {
    const first = await mountPage(['expense.claim.read', 'expense.archive.export'], async (path) => {
      if (path === '/exports') return { id: 'export-1', status: 'PENDING' }
      if (path.startsWith('/exports/')) return { id: 'export-1', status: 'DONE', result: { result: { filename: 'a.csv', claim_ids: ['c1'], sha256: 'a'.repeat(64), content: 'a\n' } } }
      return { items: [], total: 0 }
    }, 'claims')
    try {
      await first.state.createExport(['c1'])
      assert.ok(store.has('reimbursement.task.export'))
    } finally { first.unmount() }

    const calls = []
    const second = await mountPage(['expense.claim.read', 'expense.archive.export'], async (path) => {
      calls.push(path)
      if (path === '/exports/export-1') return { id: 'export-1', status: 'DONE', result: { result: { filename: 'a.csv', claim_ids: ['c1'], sha256: 'a'.repeat(64), content: 'a\n' } } }
      return { items: [], total: 0 }
    }, 'claims')
    try {
      assert.match(await second.html(), /继续查询上次导出/)
      await second.state.resumeExportTask()
      assert.ok(calls.includes('/exports/export-1'))
      assert.equal(second.state.exportJob.value.status, 'DONE')
      assert.deepEqual(second.state.exportScopeIDs.value, ['c1'])
    } finally { second.unmount() }
  } finally { delete globalThis.localStorage }
})

test('付款历史读取失败只显示失败原因，不同时声称尚无付款记录', async () => {
  const fixture = await mountPage(['expense.claim.read', 'expense.payment.read'], async (path) => {
    if (path === '/claims/c2') {
      return { id: 'c2', status: 'PAID', version: 1, payable_minor: '100', currency: 'CNY', items: [] }
    }
    if (path.startsWith('/claims/c2/payments')) throw new Error('付款历史服务暂不可用')
    if (path.startsWith('/claims/c2/reversal-requests')) return { items: [], total: 0 }
    return { items: [], total: 0 }
  }, 'payments')
  try {
    await fixture.state.openClaim('c2')
    assert.equal(fixture.state.paymentHistoryLoaded.value, false)
    const html = await fixture.html()
    assert.match(html, /付款历史读取失败/)
    assert.doesNotMatch(html, /当前单据尚无付款记录/)
  } finally { fixture.unmount() }
})

// 用途：读取报销视图模板源码，供"证据归位"这类结构契约做模板级断言。
// 参数：无。
// 返回值：SFC 模板内容文本。
function reimbursementTemplate() {
  return parse(readFileSync(new URL('./ReimbursementView.vue', import.meta.url), 'utf8'))
    .descriptor.template.content
}

test('证据录入归位：标题在字段之前，证据面板在所属费用项卡片内部', async () => {
  const template = reimbursementTemplate()
  const itemLoop = template.indexOf('v-for="(item, index) in draft.items"')
  assert.ok(itemLoop > 0, '费用项必须仍有逐项渲染的卡片')
  const cardStart = template.lastIndexOf('<article', itemLoop)
  const card = template.slice(cardStart, template.indexOf('</article>', cardStart))
  // 「费用 N」标题必须在卡片最前面：字段不再出现在标题之前。
  const titleAt = card.indexOf('费用 {{ index + 1 }}')
  const firstFieldAt = card.indexOf('data-field="expense_nature"')
  assert.ok(titleAt >= 0, '费用卡片必须有「费用 N」标题')
  assert.ok(titleAt < firstFieldAt, '「费用 N」标题必须出现在第一个字段之前')
  // 证据面板只渲染一次并跟随当前费用项，不再在全部费用项之后另起一块。
  assert.ok(card.includes('<ClaimEvidenceTravelPanel'), '证据面板必须位于所属费用项卡片内部')
  assert.ok(card.includes(':item="item"'), '证据面板必须绑定当前费用项而不是整张单据')
  assert.equal((template.match(/<ClaimEvidenceTravelPanel/g) || []).length, 1,
    '证据面板只能出现一次，由费用项 v-for 逐项渲染')
  assert.ok(template.indexOf('</article>', cardStart) > card.indexOf('<ClaimEvidenceTravelPanel'))

  // 3 个费用项时每个卡片各自带标题与自己的字段，证据区不会离费用项隔数屏。
  const fixture = await mountPage(['expense.claim.read', 'expense.claim.update'], async (path) => {
    if (path === '/claims/claim-3') return { id: 'claim-3', claim_no: 'BX-3', version: 1, status: 'DRAFT',
      applicant_subject_id: 'actor', org_id: 'org-1', items: [1, 2, 3].map((index) => ({
        id: `item-${index}`, fee_type: 'TRAVEL', occurred_date: '2026-11-01', requested_minor: '100',
        reason: '', allocations: [], invoice_usages: [],
        no_invoice_evidence_file_ids: [], historical_tail_evidence_file_ids: [], travel_confirmation: {},
      })) }
    return { items: [], total: 0 }
  }, 'claims')
  try {
    await fixture.state.openClaim('claim-3')
    const html = await fixture.html()
    const cards = html.split('data-expense-index=')
    assert.equal(cards.length, 4, '三个费用项必须各渲染一张卡片')
    for (const [index, cardHtml] of cards.slice(1).entries()) {
      assert.ok(cardHtml.indexOf(`费用 ${index + 1}`) >= 0, `第${index + 1}张卡片必须有对应标题`)
      assert.ok(cardHtml.indexOf(`费用 ${index + 1}`) < cardHtml.indexOf('data-field='),
        '每张费用卡片的标题都必须先于字段出现')
    }
  } finally { fixture.unmount() }
})

test('内部标识不再手填：组织与文件走既有选项接口，提交仍是原内部值', async () => {
  const template = reimbursementTemplate()
  // 组织只能来自本人任职上下文，不再使用更宽的组织目录。
  const orgField = template.slice(template.indexOf('v-model="draft.org_id"'), template.indexOf('v-model="draft.org_id"') + 500)
  assert.match(orgField, /:options="organizationOptions"/)
  assert.match(orgField, /applyDraftContext/)
  assert.doesNotMatch(template, /组织ID/, '页面不再把组织ID当字段标题')
  // 证据/原件/凭证一律按文件名从既有文件选项接口选择，不再留手抄文件ID的输入框。
  assert.doesNotMatch(template, /v-model="item\.no_invoice_evidence_text"/)
  assert.doesNotMatch(template, /v-model="paymentForm\.voucher_file_ids"/)
  assert.doesNotMatch(template, /v-model="evidenceFiles"/)
  assert.doesNotMatch(template, /v-model="verificationEvidence"/)
  assert.doesNotMatch(template, /上传后的文档ID/, '文档引用不再用可手抄的输入框')
  assert.doesNotMatch(template, /<input v-model="documentID"/)
  assert.equal((template.match(/path="\/invoice-document-options"/g) || []).length, 5,
    '独立证明、付款凭证、冲正证据、核验证据、原件文档都必须走文件选项接口')
  assert.match(template, /purpose="reimbursement\.claim\.evidence"/)
  assert.equal((template.match(/purpose="reimbursement\.payment\.voucher"/g) || []).length, 2,
    '付款凭证与冲正证据都按付款凭证用途选择')
  assert.equal((template.match(/purpose="reimbursement\.invoice\.original"/g) || []).length, 2,
    '原件文档与核验证据都按发票原件用途选择')
})

test('付款表单按受控账户名称选择，提交账户引用而不是账户内部ID', async () => {
  const posts = []
  const fixture = await mountPage(['expense.claim.read', 'expense.payment.read', 'expense.payment.record'],
    async (path, options) => {
      if (path === '/claims/claim-1') return { id: 'claim-1', claim_no: 'BX-1', status: 'APPROVED_PENDING_PAYMENT',
        version: 2, payable_minor: '100', currency: 'CNY', items: [], applicant_subject_id: 'applicant',
        payee_profile_id: 'payee-1' }
      if (path === '/claims/claim-1/payment-options') return {
        source_accounts: [{ id: 'acct-1', name: '财务主体基本户', account_ref: 'ACC-PRIMARY' }],
        payee_profiles: [{ id: 'payee-1', name: '本人已审核收款资料', account_ref: 'PAYEE-PRIMARY', version: 3 }],
      }
      if (path.startsWith('/claims/claim-1/payments')) {
        if (options?.method === 'POST') { posts.push(JSON.parse(options.body)); return { id: 'pay-1' } }
        return { items: [], total: 0 }
      }
      if (path.startsWith('/claims/claim-1/reversal-requests')) return { items: [], total: 0 }
      if (path === '/payments/pay-1') return { id: 'pay-1' }
      return { items: [], total: 0 }
    }, 'payments')
  try {
    await fixture.state.openClaim('claim-1')
    const html = await fixture.html()
    assert.match(html, /付款账户（受控账户，按名称选择）/)
    assert.match(html, /财务主体基本户 · ACC-PRIMARY/)
    assert.match(html, /收款档案：本人已审核收款资料 · 账户引用 PAYEE-PRIMARY · v3/)
    // 没选受控账户就不发付款命令，也不伪造成功。
    fixture.state.paymentForm.value.source_account_ref = ''
    await fixture.state.registerPayment()
    assert.equal(posts.length, 0)
    assert.match(fixture.state.error.value, /请选择受控付款账户/)
    fixture.state.paymentForm.value.source_account_ref = 'ACC-PRIMARY'
    await fixture.state.registerPayment()
    assert.equal(posts.length, 1)
    assert.equal(posts[0].source_account_ref, 'ACC-PRIMARY')
    assert.equal(Object.hasOwn(posts[0], 'account_id'), false, '提交的是受控账户引用，不是内部账户ID')
  } finally { fixture.unmount() }
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

test('付款详情切换后迟到的旧付款不能覆盖当前单据或回写旧深链', async () => {
  let finishOldPayment
  const oldPayment = new Promise((resolve) => { finishOldPayment = resolve })
  const fixture = await mountPage(['expense.claim.read', 'expense.payment.read'], async (path) => {
    if (path === '/claims/old') return { id: 'old', version: 1, status: 'PAID',
      items: [], active_payment_id: 'old-payment' }
    if (path === '/claims/current') return { id: 'current', version: 2, status: 'APPROVED_PENDING_PAYMENT', items: [] }
    if (path === '/payments/old-payment') return oldPayment
    return { items: [], total: 0 }
  }, 'payments')
  try {
    const readingOld = fixture.state.openClaim('old')
    await new Promise((resolve) => setImmediate(resolve))
    await fixture.state.openClaim('current')
    finishOldPayment({ id: 'old-payment', claim_id: 'old' })
    await readingOld
    assert.equal(fixture.state.selected.value.id, 'current')
    assert.equal(fixture.state.payment.value, null)
    assert.equal(fixture.routerCalls.replace.at(-1)[0].query.claim_id, 'current')
  } finally { fixture.unmount() }
})
