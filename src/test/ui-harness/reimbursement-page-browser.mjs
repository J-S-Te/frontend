// 报销原型视觉证据（手工夹具，不进 CI）。
// 用真实 ReimbursementView + AppShell + reimbursement.css，路由和 API 全部替换为隔离替身；
// 不连接任何业务服务、不写业务数据。输出 1440/375 浅深色截图，供人工比对高保真原型。
import { build } from 'esbuild'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { parse, compileScript, compileStyle } from '@vue/compiler-sfc'
import { chromium } from 'playwright-core'
import assert from 'node:assert/strict'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const outputDir = (process.env.PAGE_OUTPUT_DIR
  || fileURLToPath(new URL('../../../../.ai/qa/reimbursement-prototype-alignment-20261112/screenshots/', import.meta.url)))
  .replace(/\/?$/, '/')
const widthList = (process.env.PAGE_WIDTHS || '1440,375').split(',').map(Number)
const selectedCases = (process.env.PAGE_CASES || '').split(',').filter(Boolean)
const componentStyles = new Map()
const cases = [
  { key: 'dashboard', section: 'dashboard' },
  { key: 'dashboard-collapsed', section: 'dashboard', click: '发票中心', hideAfterClick: '发票台账' },
  { key: 'invoices', section: 'invoices' },
  { key: 'invoice-review', section: 'invoices', invoice: true },
  { key: 'invoice-controls', section: 'invoices', invoice: true },
  { key: 'invoice-upload', section: 'invoice-upload' },
  { key: 'claims', section: 'claims' },
  { key: 'claim-detail', section: 'claims', query: { claim_id: 'claim-1' } },
  { key: 'approvals', section: 'approvals' },
  { key: 'approval-detail', section: 'approvals', click: '查看任务与办理' },
  { key: 'payments', section: 'payments' },
  { key: 'archives', section: 'archives' },
  { key: 'policies', section: 'policies' },
  { key: 'analytics', section: 'analytics' },
  { key: 'messages', section: 'messages' },
]
const runCases = cases.filter(row => !selectedCases.length || selectedCases.includes(row.key))
assert.ok(runCases.length && selectedCases.every(key => cases.some(row => row.key === key)),
  'PAGE_CASES包含未知场景，不能以零用例通过')

const routerStub = `import { h, reactive } from 'vue'
export const __route = reactive({ params: { section: 'dashboard' }, query: {} })
export function __setRoute(section, query = {}) {
  __route.params = { section }
  __route.query = query
}
export function useRoute() { return __route }
export function useRouter() {
  return {
    push(to) { if (to?.params?.section) __setRoute(to.params.section, to.query || {}); return Promise.resolve() },
    replace(to) { if (to?.params?.section) __setRoute(to.params.section, to.query || {}); return Promise.resolve() },
  }
}
export function onBeforeRouteLeave() {}
export const RouterLink = { props: ['to'], setup(_props, { slots }) { return () => h('a', {}, slots.default?.()) } }
`

const apiStub = `const session = {
  tenant_id: 'tenant-demo', subject_id: 'actor-demo', username: 'fixture.reader', display_name: '王晓磊',
  roles: ['reimbursement_admin', 'expense_applicant', 'expense_approver', 'expense_accountant',
    'expense_cashier', 'expense_archive_operator', 'expense_finance_director'],
  permissions: [
    'expense.claim.read', 'expense.claim.create', 'expense.claim.update', 'expense.claim.submit',
    'expense.claim.withdraw', 'expense.claim.void', 'expense.claim.reopen', 'expense.claim.approved_void',
    'expense.invoice.read', 'expense.invoice.upload', 'expense.invoice.review',
    'expense.invoice.correct', 'expense.finance.review',
    'expense.approval.act', 'expense.approval.transfer', 'expense.approval.recover',
    'expense.payment.read', 'expense.payment.record', 'expense.payment.exception.record',
    'expense.payment.exception.review', 'expense.archive.read', 'expense.archive.export',
    'expense.archive.borrow', 'expense.archive.borrow.approve', 'expense.config.manage',
    'expense.policy.publish', 'expense.integration.manage', 'expense.scope.tenant_all',
    'expense.project.reference', 'expense.analytics.read'
  ],
}
window.__invoiceFixtureSession = session;
const claim = {
  id: 'claim-1', claim_no: 'BX-2026-0001', title: '北京项目差旅', status: 'IN_APPROVAL', version: 3,
  claim_type: 'TRAVEL', applicant_subject_id: 'actor-demo', applicant_name: '王晓磊',
  payable_minor: '128800', currency: 'CNY', current_round: 2, current_approval_node: 'TECHNICAL_DIRECTOR',
  created_at: '2026-11-10T09:00:00+08:00', allowed_actions: ['WITHDRAW'], scope_limited: false,
  invoice_date_warnings: [],
  items: [{
    id: 'item-1', fee_type: '交通费', occurred_date: '2026-11-08', requested_minor: '128800',
    reason: '北京往返高铁', expense_nature: 'ACTUAL', travel_exception: false, over_standard: true,
    allocations: [{ project_id: 'project-1', service_item_id: '', amount_minor: '128800', ratio_basis_points: 10000 }],
    invoice_usages: [{ invoice_id: 'inv-1', used_minor: '128800', amount: '1288.00' }],
    no_invoice_evidence_file_ids: [], historical_tail_evidence_file_ids: [],
  }],
}
const task = {
  id: 'task-1', claim_id: 'claim-1', claim_no: 'BX-2026-0001', round: 2, node_role: 'TECHNICAL_DIRECTOR',
  node_code: 'TECHNICAL_DIRECTOR', status: 'PENDING', assignee: 'actor-demo', urgency: 'NORMAL',
  allowed_actions: ['APPROVE', 'RETURN', 'TRANSFER'], created_at: '2026-11-10T09:00:00+08:00',
  pending_since: '2026-11-10T09:00:00+08:00',
  snapshot: { version: 3, scope_limited: false, items: claim.items },
}
const claimRow = { id: 'claim-1', claim_no: 'BX-2026-0001', title: '北京项目差旅', status: 'IN_APPROVAL',
  version: 3, claim_type: 'TRAVEL', payable_minor: '128800', applicant_subject_id: 'actor-demo',
  current_approval_node: 'TECHNICAL_DIRECTOR', created_at: '2026-11-10T09:00:00+08:00',
  pending_since: '2026-11-10T09:00:00+08:00', has_over_standard: true }
const invoiceRow = { id: 'inv-1', invoice_number: 'INV-2026-0001', invoice_type: '增值税专用发票',
  invoice_date: '2026-11-08', total_minor: '128800', seller_tax_id: '91310000DEMO',
  owner_subject_id: 'actor-demo', buyer_tax_id: '91310000FIXTURE', file_ids: ['file-demo'],
  content: { lines: [{ name: '合成检测服务', amount_minor: '120000', tax_minor: '8800' }] },
  verification_status: 'MANUAL_REVIEWED', review_status: 'PENDING', reservation_state: 'AVAILABLE',
  created_at: '2026-11-08T10:00:00+08:00', version: 1 }
const round = { round: 2, created_at: '2026-11-10T09:00:00+08:00', content_hash: 'hash-demo', rule_version: 'v2',
  snapshot: claim, frozen_tasks: [{ id: 'task-1', node_role: 'TECHNICAL_DIRECTOR', assignee_subject_id: 'actor-demo',
    allocation_keys: ['project-1'] }],
  references: [{ project_id: 'project-1', service_item_id: '', reference_version: 4,
    required_approver_refs: [{ node_role: 'FINANCE_DIRECTOR', subject_id: 'finance-demo',
      source_field: 'finance_director', source_version: '7' }] }],
  actions: [{ ID: 'action-1', CreatedAt: '2026-11-10T10:00:00+08:00', Actor: 'actor-demo', Action: 'APPROVE', Reason: '同意' }] }

const invoiceSource = { id: 'source-demo', file_id: 'file-demo', document_id: 'document-demo',
  filename: '隔离票据样例.png', original_name: '隔离票据样例.png', source_kind: 'PARSED',
  parse_status: 'NEEDS_REVIEW', parser_version: 'fixture-parser', rules_version: 'fixture-rules',
  run_id: 'fixture-run', candidate_index: 0, sources_hash: 'fixture-source-hash',
  issues: ['MANUAL_CONFIRMATION_REQUIRED'],
  sources: Array.from({ length: 30 }, () => ({ page: 1, text: '隔离来源字段', x: 10, y: 20 })) }
// 用途：只为隔离页面返回合成HTTP数据，不读取业务服务。
// 参数：path 为真实组件请求的业务路径。
// 返回值：与对应读取/命令边界匹配的合成响应。
function fixture(path) {
  const value = String(path)
  if (value === '/dashboard') return { my_claims: 3, pending_approvals: 1, pending_payments: 2,
    invoice_review_required: 4, my_paid_this_month: 5,
    pending_tasks: [{ id: 'task-1', claim_id: 'claim-1', claim_no: 'BX-2026-0001', node_code: 'TECHNICAL_DIRECTOR', created_at: '2026-11-10T09:00:00+08:00' }] }
  if (value.startsWith('/claim-options')) return {
    applicant: { id: 'actor-demo', name: '王晓磊' },
    organizations: [{ id: 'org-demo', name: '技术部', is_primary: true }],
    draft_context: { status: 'READY', org_id: 'org-demo', route_type: 'TECHNICAL', employee_profile_id: 'profile-demo' },
    employee_profiles: [{ id: 'profile-demo', org_id: 'org-demo', route_type: 'TECHNICAL', active: true, grade: 'P6' }],
    fee_types: ['交通费', '住宿费', '餐饮费'], finance_entities: [{ id: 'entity-demo', name: '示例主体' }],
    payee_profiles: [{ id: 'payee-demo', name: '本人工资卡' }], standards: [], historical_tail_policies: [],
  }
  if (value.startsWith('/project-options')) return { items: [{ project_id: 'project-1', project_name: '示例项目' }], total: 1 }
  if (value === '/claims/claim-1') return claim
  if (value.startsWith('/claims?')) return { items: [claimRow], total: 1, page: 1 }
  if (value.startsWith('/invoices?')) return { items: [invoiceRow], total: 1, page: 1 }
  if (value === '/invoices/inv-1') return { ...invoiceRow,
    review_status: window.__invoiceReadonly ? 'CONFIRMED' : 'PENDING' }
  if (value === '/invoices/inv-1/sources') return { items: [invoiceSource] }
  if (value === '/invoices/inv-1/controls') return {
    corrections: window.__invoiceReviewWork ? [{ id: 'correction-fixture', status: 'PENDING',
      version: 1, requester_subject_id: 'other-actor', content: { reason: '合成更正原因' } }] : [],
    impacts: [], risks: [], sources: [invoiceSource] }
  if (value === '/invoices/inv-1/files/file-demo/download-ticket') return {
    download_url: '/file-gateway/fixture-original.png', ticket: 'fixture-only-download-ticket' }
  if (value.startsWith('/invoice-document-options')) return { items: [], total: 0 }
  if (value.startsWith('/invoice-options')) return { items: [{ id: invoiceRow.id,
    name: invoiceRow.invoice_number }], total: 1 }
  if (value === '/invoices/inv-1/confirm') return { id: 'inv-1' }
  if (value === '/invoices/inv-1/corrections') return { id: 'correction-fixture' }
  if (value.startsWith('/approval-tasks?')) return { items: [task], total: 1, page: 1 }
  if (value === '/approval-tasks/task-1') return task
  if (value.startsWith('/approval-tasks/task-1/history')) return { items: [{ id: 'h1', round: 1, node_role: 'TECH_DIRECTOR',
    action: 'APPROVE', actor_subject_id: 'actor-demo', created_at: '2026-11-09T10:00:00+08:00', reason: '同意' }], total: 1 }
  if (value.startsWith('/claims/claim-1/approval-rounds')) return { items: [round], total: 1 }
  if (value.startsWith('/claims/claim-1/payments')) return { items: [], total: 0, page: 1 }
  if (value.startsWith('/claims/claim-1/reversal-requests')) return { items: [], total: 0, page: 1 }
  if (value.startsWith('/claims/claim-1/archives')) return { items: [], total: 0 }
  if (value.startsWith('/claims/claim-1/sync-status')) return { status: 'SYNCED', current_revision: 1, successful_revision: 1 }
  if (value.startsWith('/claims/claim-1/spend-capacity')) return { can_record: true, allocations_used: 0, allocation_limit: 20 }
  if (value.startsWith('/statistics')) return { date_from: '2026-11-01', date_to: '2026-11-30', total_count: 3,
    over_standard_count: 1, exception_count: 0, submitted_count: 3, returned_count: 1,
    return_rate_basis_points: 3333,
    monthly: [{ month: '2026-11', amount_minor: '128800', count: 3 }],
    by_type: [{ claim_type: 'TRAVEL', amount_minor: '128800', count: 3 }],
    by_project: [{ project_id: 'project-1', amount_minor: '128800', count: 3 }] }
  if (value.startsWith('/archive-projects')) return { items: [{ project_id: 'project-1', claim_count: 2,
    amount_minor: '257600', last_archived_at: '2026-11-10T09:00:00+08:00' }], total: 1, page: 1 }
  if (value.startsWith('/configurations/')) return { items: [{ id: 'policy-1', version: 2, published: true,
    lifecycle_status: 'ACTIVE', name: '差旅费用标准', fee_type: '交通费', limit_minor: '80000',
    created_at: '2026-11-01T09:00:00+08:00' }], total: 1, page: 1 }
  if (value.startsWith('/archive-borrows')) return { items: [], total: 0 }
  if (value.startsWith('/parse-exceptions')) return { items: [], total: 0 }
  if (value.startsWith('/notifications')) return { items: [], total: 0 }
  return { items: [], total: 0, page: 1 }
}

export const publicPrefix = '/reimbursement'
export async function ensureReimbursementSession() { return session }
export function getReimbursementSession() { return session }
export async function logoutReimbursement() {}
export function startReimbursementLogin() {}
export const reimbursementAPI = {
// 用途：记录真实组件发送的读取和命令，转到隔离数据边界。
// 参数：path为请求路径，options为真实组件传入的请求选项。
// 返回值：对应合成响应，不向真实后端发送请求。
request: async (path, options) => {
  window.__invoiceFixtureRequests ||= [];
  window.__invoiceFixtureRequests.push({path,method:options?.method || 'GET',
    body:options?.body ? JSON.parse(options.body) : null});
  return fixture(path);
} }
`

const notificationsStub = `export async function listInbox() {
  return { total: 2, items: [
    { delivery_id: 'd1', title: '审批待办', content: '报销单 BX-2026-0001 等待技术负责人审批。', delivered_at: '2026-11-10T09:00:00+08:00', read_at: null },
    { delivery_id: 'd2', title: '付款完成', content: '报销单 BX-2026-0000 已付款，归档已完成。', delivered_at: '2026-11-09T18:00:00+08:00', read_at: '2026-11-09T18:05:00+08:00' },
  ] }
}
export async function getUnreadCount() { return { unread_count: 1 } }
export async function getNotification() { return { title: '审批待办', content: '报销单 BX-2026-0001 等待审批。', target_url: '/reimbursement/claims' } }
export async function markNotificationRead() { return {} }
// 用途：显式拒绝本票据夹具未覆盖的通知删除操作。
// 参数：无。
// 返回值：无；调用即失败，不能冒充业务删除成功。
export async function deleteReadNotifications() { throw new Error('票据夹具不包含通知删除操作') }
`

const entry = `import { createApp } from 'vue'
import View from './src/modules/reimbursement/views/ReimbursementView.vue'
import { __setRoute, RouterLink } from 'vue-router'
import './src/modules/platform/shared/styles/main.css'
import './src/modules/platform/shared/styles/state.css'
import './src/modules/shared/styles/global-ux.css'
import './src/modules/reimbursement/reimbursement.css'
window.__mountReimbursement = ({ section, query = {} }) => {
  __setRoute(section, query)
  const app = createApp(View)
  app.component('RouterLink', RouterLink)
  app.mount('#app')
  return app
}
`

const stubPlugin = {
  name: 'reimbursement-page-stubs',
  setup(builder) {
    builder.onResolve({ filter: /^vue-router$/ }, () => ({ path: 'vue-router', namespace: 'stub' }))
    builder.onResolve({ filter: /api\/reimbursement\.js$/ }, () => ({ path: 'reimbursement-api', namespace: 'stub' }))
    builder.onResolve({ filter: /notifications\/api\/notifications\.js$/ }, () => ({ path: 'notifications-api', namespace: 'stub' }))
    builder.onLoad({ filter: /.*/, namespace: 'stub' }, ({ path }) => ({
      contents: path === 'vue-router' ? routerStub : path === 'reimbursement-api' ? apiStub : notificationsStub,
      loader: 'js',
      resolveDir: root,
    }))
    builder.onLoad({ filter: /\.vue$/ }, async ({ path }) => {
      const { descriptor } = parse(await readFile(path, 'utf8'), { filename: path })
      const id = 'data-v-' + createHash('sha256').update(path).digest('hex').slice(0, 8)
      const script = compileScript(descriptor, { id, inlineTemplate: true,
        genDefaultAs: '__fixtureComponent', templateOptions: { compilerOptions: { scopeId: id } } })
      componentStyles.set(path, descriptor.styles.map(style => compileStyle({
        source: style.content, filename: path, id, scoped: style.scoped,
      }).code).join('\n'))
      return {
        contents: script.content + '\n__fixtureComponent.__scopeId=' + JSON.stringify(id) + ';export default __fixtureComponent;',
        loader: 'ts',
        resolveDir: fileURLToPath(new URL('.', 'file://' + path)),
      }
    })
  },
}

const result = await build({
  stdin: { contents: entry, resolveDir: root, sourcefile: 'reimbursement-page-entry.js' },
  bundle: true, write: false, format: 'iife', platform: 'browser', outdir: 'out',
  define: { 'import.meta.env': '{}' }, alias: { '@': root + 'src' },
  loader: { '.css': 'css' }, plugins: [stubPlugin],
})
const js = result.outputFiles.find(file => file.path.endsWith('.js'))?.text || ''
const css = result.outputFiles.find(file => file.path.endsWith('.css'))?.text || ''
const scopedCss = [...componentStyles.values()].join('\n')
if (!js || !css) throw new Error('page fixture bundle incomplete')

// 用途：验证三种维护操作互斥展开、输入保留和待批准记录可见。
// 参数：page为隔离页面，review/controls为真实面板，width/theme用于证据命名。
// 返回值：无；维护表单或独立财务动作不可达时断言失败。
async function checkInvoiceControls(page, review, controls, width, theme) {
  assert.equal(await controls.locator('textarea:visible').count(), 0, '维护表单不应默认全部展开')
  await controls.getByRole('button', { name: '更正票面', exact: true }).click()
  await controls.getByLabel('发票号码', { exact: true }).fill('编辑中的合成票号')
  await controls.screenshot({ path: outputDir + 'invoice-controls-' + width + '-' + theme + '-working.png' })
  await controls.getByRole('button', { name: '补充原件', exact: true }).click()
  assert.equal(await controls.getByLabel('发票号码', { exact: true }).count(), 0)
  await controls.getByRole('button', { name: '登记异常', exact: true }).click()
  assert.equal(await controls.getByRole('combobox', { name: /^事实类型/ }).isVisible(), true)
  await controls.getByRole('button', { name: '更正票面', exact: true }).click()
  assert.equal(await controls.getByLabel('发票号码', { exact: true }).inputValue(), '编辑中的合成票号')
  await controls.locator('summary').filter({ hasText: '票面行程' }).click()
  const kind = controls.getByRole('combobox', { name: /^票面类别/ })
  await kind.selectOption('RAIL')
  await controls.getByLabel('票面开始日', { exact: true }).fill('2026-11-08')
  await kind.selectOption('')
  await controls.getByLabel('本次处理原因', { exact: true }).fill('对照隔离原件更正')
  await controls.getByRole('button', { name: '提交独立更正申请', exact: true }).click()
  await page.waitForFunction(() => window.__invoiceFixtureRequests.some(row => row.path.endsWith('/corrections')))
  const correction = await page.evaluate(() => window.__invoiceFixtureRequests.find(row => row.path.endsWith('/corrections')).body)
  assert.equal(Object.hasOwn(correction.proposed_invoice, 'travel_facts'), false)
  await page.evaluate(() => { window.__invoiceReviewWork = true })
  await review.getByRole('button', { name: '返回发票列表', exact: true }).click()
  await page.getByRole('button', { name: '复核详情', exact: true }).click()
  await controls.getByRole('button', { name: '独立批准', exact: true }).waitFor()
  assert.equal(await controls.getByLabel('本次处理原因', { exact: true }).isVisible(), true)
  await review.getByRole('button', { name: '返回发票列表', exact: true }).click()
  await page.evaluate(() => {
    window.__invoiceFixtureSession.permissions = ['expense.invoice.read']
    window.__invoiceReviewWork = false
  })
  await page.getByRole('button', { name: '复核详情', exact: true }).click()
  assert.equal(await controls.getByRole('button', { name: '更正票面', exact: true }).count(), 0)
  assert.equal(await review.getByLabel('发票号码', { exact: true }).isDisabled(), true)
}

// 用途：验证普通票据不展示行程字段，选择类别后才显示且切换不丢输入。
// 参数：review为真实人工复核区域。
// 返回值：无；行程显隐或本地编辑保留不正确时断言失败。
async function checkInvoiceTravel(review) {
  await review.locator('summary').filter({ hasText: '票面行程' }).click()
  assert.equal(await review.locator('input[type=date]:visible').count(), 1)
  const kind = review.getByRole('combobox', { name: /^票面类别/ })
  await kind.selectOption('RAIL')
  await review.getByLabel('票面开始日', { exact: true }).fill('2026-11-08')
  assert.equal(await review.locator('input[type=date]:visible').count(), 3)
  await kind.selectOption('')
  assert.equal(await review.locator('input[type=date]:visible').count(), 1)
  await kind.selectOption('RAIL')
  assert.equal(await review.getByLabel('票面开始日', { exact: true }).inputValue(), '2026-11-08')
  await kind.selectOption('')
}

// 用途：确认复核仍发送真实金额/明细契约，已确认票据保持只读。
// 参数：page为隔离页面，review为真实人工复核区域。
// 返回值：无；命令接线、列表返回或只读失效时断言失败。
async function checkInvoiceConfirmation(page, review) {
  await review.getByLabel('人工复核或校正原因', { exact: true }).fill('对照隔离原件确认')
  await review.getByRole('button', { name: '确认人工复核字段', exact: true }).click()
  await page.waitForFunction(() => window.__invoiceFixtureRequests.some(row => row.path.endsWith('/confirm')))
  const payload = await page.evaluate(() => window.__invoiceFixtureRequests.find(row => row.path.endsWith('/confirm')).body)
  assert.equal(payload.total_minor, '128800')
  assert.equal(payload.content.lines[0].name, '合成检测服务')
  assert.equal(Object.hasOwn(payload, 'travel_facts'), false)
  await page.evaluate(() => { window.__invoiceReadonly = true })
  await review.getByRole('button', { name: '返回发票列表', exact: true }).click()
  assert.equal(await page.locator('.expense-list-tools').isVisible(), true)
  await page.getByRole('button', { name: '复核详情', exact: true }).click()
  assert.equal(await review.getByLabel('发票号码', { exact: true }).isDisabled(), true)
  await review.locator('summary').filter({ hasText: '商品服务明细' }).click()
  assert.equal(await review.getByLabel('第1项名称', { exact: true }).isDisabled(), true)
}

// 用途：检查真实票据页面以原件和关键字段为主，其他内容按需展开。
// 参数：page为隔离浏览器，item为场景，width/theme为当前视口及主题。
// 返回值：无；页面层次、布局、原件访问或交互错误时断言失败。
async function checkInvoicePage(page, item, width, theme) {
  await page.getByRole('button', { name: '复核详情', exact: true }).click()
  const review = page.locator('section.expense-panel').filter({
    has: page.getByRole('heading', { name: /^人工复核/ }),
  })
  const controls = page.locator('article').filter({
    has: page.getByRole('heading', { name: '票据更正与财务复核', exact: true }),
  })
  await review.waitFor()
  if (item.key === 'invoice-controls') return checkInvoiceControls(page, review, controls, width, theme)
  assert.ok((await review.boundingBox()).y < (await controls.boundingBox()).y,
    '常规人工复核应位于维护操作之前')
  assert.equal(await page.locator('.expense-list-tools').count(), 0,
    '复核时收起台账筛选，返回列表后恢复原上下文')
  assert.equal(await review.locator('input[type=date]:visible').count(), 1,
    '普通票据不应展示行程日期')
  await review.getByRole('button', { name: '获取受控原件', exact: true }).click()
  await review.getByRole('button', { name: /隔离票据样例.png/ }).click()
  await review.getByRole('img', { name: '受控发票原件', exact: true }).waitFor()
  assert.equal(await review.getByText('fixture-run', { exact: false }).isVisible(), false)
  const original = await review.locator('.expense-invoice-original').boundingBox()
  const fields = await review.locator('.expense-invoice-form').boundingBox()
  assert.ok(width <= 900 ? fields.y > original.y : fields.x > original.x)
  await review.screenshot({ path: outputDir + 'invoice-review-' + width + '-' + theme + '-working.png' })
  await review.locator('summary').filter({ hasText: '商品服务明细' }).click()
  assert.equal(await review.getByLabel('第1项名称', { exact: true }).inputValue(), '合成检测服务')
  await checkInvoiceTravel(review)
  await checkInvoiceConfirmation(page, review)
}

await mkdir(outputDir, { recursive: true })
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
})
const results = []
try {
  for (const width of widthList) {
    for (const theme of ['light', 'dark']) {
      for (const item of runCases) {
        const page = await browser.newPage({ viewport: { width, height: 1000 }, reducedMotion: 'reduce' })
        page.setDefaultTimeout(8000)
        const errors = []
        page.on('pageerror', error => errors.push(error.message))
        page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
        await page.route('**/*', async route => {
          const path = new URL(route.request().url()).pathname
          if (path === '/') return route.fulfill({ contentType: 'text/html', body:
            '<style>html,body{margin:0;background:#f1f5f9}' + css + scopedCss + '</style><div id="app"></div>' })
          if (path === '/api/v1/auth/me') return route.fulfill({ json: {
            tenant_id: 'tenant-demo', user_id: 'actor-demo', account: { name: 'fixture.reader' },
          } })
          if (path === '/file-gateway/fixture-original.png') {
            const base64 = await page.evaluate(() => {
              const canvas = document.createElement('canvas')
              canvas.width = 840; canvas.height = 560
              const ctx = canvas.getContext('2d')
              ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 840, 560)
              ctx.strokeStyle = '#2563eb'; ctx.strokeRect(20, 20, 800, 520)
              ctx.fillStyle = '#1e293b'; ctx.font = '26px sans-serif'
              ctx.fillText('隔离票据样例 · 非真实业务票据', 50, 85)
              ctx.font = '20px sans-serif'
              ctx.fillText('发票号码 INV-2026-0001', 50, 155)
              ctx.fillText('开票日期 2026/11/08', 50, 210)
              ctx.fillText('合成检测服务', 50, 300)
              ctx.fillText('价税合计  ¥1,288.00', 50, 415)
              return canvas.toDataURL('image/png').split(',')[1]
            })
            return route.fulfill({ contentType: 'image/png', body: Buffer.from(base64, 'base64') })
          }
          errors.push('未声明的外部请求：' + path)
          return route.abort()
        })
        await page.goto('http://reimbursement-fixture.invalid/')
        await page.addScriptTag({ content: js })
        await page.evaluate(({ item, theme }) => {
          document.documentElement.dataset.theme = theme
          window.__mountReimbursement({ section: item.section, query: item.query || {} })
        }, { item, theme })
        await page.waitForTimeout(900)
        if (item.invoice) {
          try { await checkInvoicePage(page, item, width, theme) }
          catch (error) { errors.push(error.message) }
        }
        // 桌面侧栏常驻才做折叠交互；窄屏侧栏在抽屉里，截图保留默认态。
        if (item.click && width >= 821) {
          const button = page.getByRole('button', { name: item.click }).first()
          if (await button.count()) { await button.click(); await page.waitForTimeout(700) }
        }
        if (item.hideAfterClick && width >= 821) {
          const hidden = await page.getByRole('button', { name: item.hideAfterClick, exact: true }).count()
          if (hidden) errors.push('折叠后仍渲染入口：' + item.hideAfterClick)
        }
        const metrics = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
          panels: document.querySelectorAll('.expense-panel').length,
          cards: document.querySelectorAll('.expense-card-head').length,
          theme: document.documentElement.dataset.theme || '',
        }))
        const file = outputDir + item.key + '-' + width + '-' + theme + '.png'
        await page.screenshot({ path: file })
        // 固定侧栏/顶栏在全页截图里会重复叠到内容中间；内容证据单独隐藏壳层后截取。
        await page.evaluate(() => {
          document.querySelector('.console-sidebar')?.remove()
          document.querySelector('.console-topbar')?.remove()
          const main = document.querySelector('.console-main')
          if (main) main.style.marginLeft = '0'
        })
        let contentFile = ''
        if (await page.locator('.console-content').count()) {
          contentFile = outputDir + item.key + '-' + width + '-' + theme + '-content.png'
          await page.locator('.console-content').screenshot({ path: contentFile })
        }
        results.push({ case: item.key, width, theme, errors, metrics, file, contentFile })
        await page.close()
      }
    }
  }
} finally {
  await browser.close()
}
await writeFile(outputDir + 'results.json', JSON.stringify(results, null, 2))
const failures = results.filter(row => row.errors.length || row.metrics.scrollWidth > row.metrics.clientWidth + 1)
console.log(JSON.stringify({ cases: results.length, failures: failures.length, examples: failures.slice(0, 5) }, null, 2))
if (failures.length) process.exitCode = 1
