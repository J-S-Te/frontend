// 平台控制台视觉夹具（手工夹具，不进 CI）。
// 用真实 PlatformConsoleView + 真实模块 CSS，路由与全部后端请求替换为隔离替身；
// 不连接业务服务、不写业务数据。默认在 5181 启动一个临时 Vite dev server，渲染后自动关闭。
//
// 用法（在 frontend/ 下执行）：
//   node src/test/ui-harness/platform-console-page-browser.mjs
// 可选环境变量：
//   PAGE_WIDTHS=1440,1024,390   视口宽度（默认 1440）
//   PAGE_THEMES=light,dark      主题（默认 light）
//   PAGE_CASES=settings-iam,audit   只跑指定用例
//   PAGE_OUT=/abs/path          截图输出目录
//   PAGE_FULL=1                 额外输出整页截图
//   PAGE_PORT=5181              临时 dev server 端口
//   CHROMIUM_PATH=...           指定本机 Chrome/Chromium
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

const frontendRoot = fileURLToPath(new URL('../../../', import.meta.url))
const PORT = Number(process.env.PAGE_PORT || 5181)
const BASE = `http://127.0.0.1:${PORT}`
const OUT = process.env.PAGE_OUT
  || fileURLToPath(new URL('../../../../.ai/qa/platform-console-restyle-20261112/shots/harness/', import.meta.url))
const widths = (process.env.PAGE_WIDTHS || '1440').split(',').map(Number)
const themes = (process.env.PAGE_THEMES || 'light').split(',')
const only = (process.env.PAGE_CASES || '').split(',').filter(Boolean)
await mkdir(OUT, { recursive: true })

const NOW = '2026-11-12T19:20:00+08:00'
const principal = {
  tenant_id: 'tenant-demo', identity_id: 'actor-admin', subject_id: 'actor-admin',
  tenant: { id: 'tenant-demo', name: '示例租户' },
  user: { id: 'actor-admin', name: '管理员' },
  account: { id: 'account-admin', code: 'admin', name: '管理员' },
  permission_codes: ['*'],
  roles: [{ id: 'role-admin', name: '平台管理员', code: 'platform_admin' }],
  data_scopes: [{ type: 'TENANT', id: 'tenant-demo' }],
  authorization_revision: 7, catalog_version: 'v2026.11', idle_timeout_seconds: 3600,
}

const apps = [
  { application_id: 'app-contract', code: 'contract_management', name: '合同管理', description: '合同起草、审批、用印与归档', status: 'ACTIVE', environment_id: 'env-prod', environment: 'prod', projection_ready: true, projection_status: 'READY', public_url: '' },
  { application_id: 'app-project', code: 'project_management', name: '项目管理', description: '项目拆解、实施与交付', status: 'ACTIVE', environment_id: 'env-prod', environment: 'prod', projection_ready: true, projection_status: 'READY', public_url: '' },
  { application_id: 'app-settlement', code: 'settlement', name: '结算与开票', description: '结算、开票与回款', status: 'ACTIVE', environment_id: 'env-prod', environment: 'prod', projection_ready: true, projection_status: 'READY', public_url: '' },
  { application_id: 'app-crm', code: 'customer_opportunity', name: '客户与商机', description: '客户、商机与售前协同', status: 'ACTIVE', environment_id: 'env-prod', environment: 'prod', projection_ready: true, projection_status: 'READY', public_url: '' },
  { application_id: 'app-analysis', code: 'data_analysis', name: '数据分析', description: '经营看板与指标分析', status: 'ACTIVE', environment_id: 'env-prod', environment: 'prod', projection_ready: true, projection_status: 'READY', public_url: '' },
  { application_id: 'app-reimb', code: 'reimbursement', name: '报销管理', description: '报销申请、审批与付款', status: 'ACTIVE', environment_id: 'env-prod', environment: 'prod', projection_ready: true, projection_status: 'READY', public_url: '' },
]
const environments = [
  { environment_id: 'env-prod', environment_code: 'prod', status: 'ACTIVE', application_id: 'app-contract' },
  { environment_id: 'env-test', environment_code: 'test', status: 'ACTIVE', application_id: 'app-contract' },
]
const orgUnits = [
  { org_unit_id: 'org-root', name: '基础能力平台', parent_id: null, sort_order: 0, status: 'ACTIVE', created_at: NOW },
  { org_unit_id: 'org-tech', name: '技术中心', parent_id: 'org-root', sort_order: 1, status: 'ACTIVE', created_at: NOW },
  { org_unit_id: 'org-ops', name: '运营中心', parent_id: 'org-root', sort_order: 2, status: 'ACTIVE', created_at: NOW },
  { org_unit_id: 'org-fin', name: '财务部', parent_id: 'org-root', sort_order: 3, status: 'ACTIVE', created_at: NOW },
]
const positions = [
  { position_id: 'pos-dev', name: '平台开发工程师', org_unit_id: 'org-tech', org_unit: { org_unit_id: 'org-tech', name: '技术中心' }, status: 'ACTIVE', created_at: NOW },
  { position_id: 'pos-ops', name: '系统管理员', org_unit_id: 'org-tech', org_unit: { org_unit_id: 'org-tech', name: '技术中心' }, status: 'ACTIVE', created_at: NOW },
  { position_id: 'pos-fin', name: '结算专员', org_unit_id: 'org-fin', org_unit: { org_unit_id: 'org-fin', name: '财务部' }, status: 'ACTIVE', created_at: NOW },
  { position_id: 'pos-owner', name: '业务负责人', org_unit_id: 'org-ops', org_unit: { org_unit_id: 'org-ops', name: '运营中心' }, status: 'ACTIVE', created_at: NOW },
]
const users = [
  { user_id: 'u-1001', display_name: '张磊', employee_no: 'E1001', email: 'zhanglei@example.com', mobile_masked: '138****2211', status: 'ACTIVE', updated_at: NOW, valid_until: null },
  { user_id: 'u-1002', display_name: '王敏', employee_no: 'E1002', email: 'wangmin@example.com', mobile_masked: '139****8890', status: 'ACTIVE', updated_at: NOW, valid_until: null },
  { user_id: 'u-1003', display_name: '李伟', employee_no: 'E1003', email: 'liwei@example.com', mobile_masked: '137****3344', status: 'ACTIVE', updated_at: NOW, valid_until: null },
  { user_id: 'u-1004', display_name: '陈静', employee_no: 'E1004', email: 'chenjing@example.com', mobile_masked: '136****5566', status: 'ACTIVE', updated_at: NOW, valid_until: '2027-03-31T00:00:00+08:00' },
  { user_id: 'u-1005', display_name: '赵磊', employee_no: 'E1005', email: 'zhaolei@example.com', mobile_masked: '135****7788', status: 'DISABLED', updated_at: NOW, valid_until: null },
]
const accounts = users.map((user, index) => ({
  account_id: 'acc-' + user.user_id, account_name: ['zhanglei', 'wangmin', 'liwei', 'chenjing', 'zhaolei'][index],
  user: { user_id: user.user_id, display_name: user.display_name }, user_id: user.user_id,
  login_account_type: 'LOCAL', account_source: 'LOCAL', password_initialized: index !== 3,
  status: user.status, updated_at: NOW, valid_until: user.valid_until,
}))
const memberships = [
  { membership_id: 'm-1', user: { user_id: 'u-1001', display_name: '张磊' }, user_id: 'u-1001', user_name: '张磊', org_unit: { org_unit_id: 'org-tech', name: '技术中心' }, org_unit_id: 'org-tech', position: { position_id: 'pos-ops', name: '系统管理员' }, position_id: 'pos-ops', membership_type: 'PRIMARY', inherit_authorization: true, effective_from: '2025-06-01', status: 'ACTIVE' },
  { membership_id: 'm-2', user: { user_id: 'u-1002', display_name: '王敏' }, user_id: 'u-1002', user_name: '王敏', org_unit: { org_unit_id: 'org-fin', name: '财务部' }, org_unit_id: 'org-fin', position: { position_id: 'pos-fin', name: '结算专员' }, position_id: 'pos-fin', membership_type: 'PRIMARY', inherit_authorization: true, effective_from: '2025-08-15', status: 'ACTIVE' },
  { membership_id: 'm-3', user: { user_id: 'u-1003', display_name: '李伟' }, user_id: 'u-1003', user_name: '李伟', org_unit: { org_unit_id: 'org-tech', name: '技术中心' }, org_unit_id: 'org-tech', position: { position_id: 'pos-dev', name: '平台开发工程师' }, position_id: 'pos-dev', membership_type: 'PRIMARY', inherit_authorization: true, effective_from: '2026-01-10', status: 'ACTIVE' },
  { membership_id: 'm-4', user: { user_id: 'u-1004', display_name: '陈静' }, user_id: 'u-1004', user_name: '陈静', org_unit: { org_unit_id: 'org-ops', name: '运营中心' }, org_unit_id: 'org-ops', position: { position_id: 'pos-owner', name: '业务负责人' }, position_id: 'pos-owner', membership_type: 'PRIMARY', inherit_authorization: false, effective_from: '2026-02-20', status: 'ACTIVE' },
]
const dictionaries = [
  { dictionary_id: 'dict-change', code: 'PERSONNEL_CHANGE_TYPE', name: '人员异动类型', description: '晋升、调岗、离职等异动口径', status: 'ACTIVE', item_count: 4, version: 3, updated_at: NOW },
  { dictionary_id: 'dict-contract', code: 'CONTRACT_CATEGORY', name: '合同分类', description: '销售、采购、服务合同分类', status: 'ACTIVE', item_count: 3, version: 2, updated_at: NOW },
  { dictionary_id: 'dict-invoice', code: 'INVOICE_TYPE', name: '发票类型', description: '增值税专票、普票与电子票', status: 'ACTIVE', item_count: 3, version: 1, updated_at: NOW },
  { dictionary_id: 'dict-status', code: 'PROJECT_STATUS', name: '项目状态', description: '项目全生命周期状态', status: 'DISABLED', item_count: 5, version: 4, updated_at: NOW },
]
const dictItems = [
  { item_id: 'item-1', dictionary_id: 'dict-change', code: 'PROMOTION', label: '晋升', value: 'PROMOTION', sort_order: 10, status: 'ACTIVE', version: 1 },
  { item_id: 'item-2', dictionary_id: 'dict-change', code: 'TRANSFER', label: '调岗', value: 'TRANSFER', sort_order: 20, status: 'ACTIVE', version: 1 },
  { item_id: 'item-3', dictionary_id: 'dict-change', code: 'RESIGNATION', label: '离职', value: 'RESIGNATION', sort_order: 30, status: 'ACTIVE', version: 1 },
  { item_id: 'item-4', dictionary_id: 'dict-change', code: 'REHIRE', label: '复职', value: 'REHIRE', sort_order: 40, status: 'DISABLED', version: 2 },
]
const jobs = [
  { job_id: 'job-20261112-001', job_type: 'AUDIT_EXPORT', status: 'SUCCEEDED', application_id: 'platform', aggregate_type: 'AUDIT_EXPORT', aggregate_id: 'exp-001', attempt_count: 1, max_attempts: 3, priority: 100, created_at: NOW, updated_at: NOW, available_at: NOW },
  { job_id: 'job-20261112-002', job_type: 'REPORT_EXPORT', status: 'RUNNING', application_id: 'project_management', aggregate_type: 'REPORT', aggregate_id: 'rpt-221', attempt_count: 1, max_attempts: 3, priority: 100, created_at: NOW, updated_at: NOW, available_at: NOW },
  { job_id: 'job-20261112-003', job_type: 'CONTRACT_IMPORT', status: 'FAILED', application_id: 'contract_management', aggregate_type: 'IMPORT', aggregate_id: 'imp-077', attempt_count: 3, max_attempts: 3, priority: 100, created_at: NOW, updated_at: NOW, available_at: NOW, error_message: '模板列缺失：合同金额' },
  { job_id: 'job-20261112-004', job_type: 'FILE_HASH', status: 'PENDING', application_id: 'file_gateway', aggregate_type: 'FILE', aggregate_id: 'file-9981', attempt_count: 0, max_attempts: 3, priority: 200, created_at: NOW, updated_at: NOW, available_at: NOW },
]
const auditEvents = Array.from({ length: 9 }).map((_, index) => {
  const results = ['SUCCESS', 'SUCCESS', 'DENIED', 'ERROR', 'PARTIAL', 'SUCCESS']
  const risks = ['LOW', 'LOW', 'HIGH', 'MEDIUM', 'LOW', 'HIGH']
  const actions = ['LOGIN', 'ROLE_BINDING_UPDATE', 'USER_DELETE', 'CONTRACT_EXPORT', 'TENANT_UPDATE', 'PASSWORD_RESET']
  return {
    event_id: 'evt-20261112-' + String(index + 1).padStart(3, '0'),
    occurred_at: new Date(Date.parse(NOW) - index * 3600e3).toISOString(),
    operator_display_name: ['张磊', '王敏', '李伟', '陈静', '赵磊'][index % 5],
    actor_id: 'u-100' + (index % 5 + 1), actor_type: 'USER',
    application_code: 'contract_management', application_name: '合同管理', environment_code: 'prod',
    action_type: ['AUTH', 'AUTHORIZATION', 'IDENTITY'][index % 3], action: actions[index % 6],
    result: results[index % 6], risk_level: risks[index % 6], method: 'POST', path: '/api/v1/contracts/2026-0031',
    client_ip: '10.8.12.' + (20 + index), status_code: index % 3 === 0 ? 200 : 403,
    resource_type: 'CONTRACT', resource_name: '年度框架采购合同', resource_id: 'contract-2026-0031',
    request_id: 'req-' + (1000 + index), correlation_id: 'corr-' + (500 + index), trace_id: 'trace-' + (9000 + index),
    detail: '依据角色绑定变更执行', change_summary: [{ field: 'status', before: 'DRAFT', after: 'SIGNED' }],
  }
})
const notifications = Array.from({ length: 4 }).map((_, i) => ({
  delivery_id: 'ntf-' + (i + 1), category: 'SYSTEM', title: ['会话策略已更新', '合同导出任务完成', '新员工入职待核对', '月度结算提醒'][i],
  content: ['平台管理员调整了无操作退出策略，当前生效值为 30 分钟。', '导出文件已生成，可在审计日志页下载。', '张磊的账号与任职关系已创建，请核对岗位授权继承结果。', '本月有 3 个结算单待确认，请及时处理。'][i],
  delivered_at: new Date(Date.parse(NOW) - i * 7200e3).toISOString(), read_at: i === 3 ? NOW : null, target_url: '', visible: true,
}))
const namespaces = [
  { namespace_id: 'ns-contract', code: 'contract', name: '合同默认配置', description: '合同模块公共开关', application: { code: 'contract_management', name: '合同管理' }, status: 'ACTIVE' },
  { namespace_id: 'ns-project', code: 'project', name: '项目默认配置', description: '项目模块公共开关', application: { code: 'project_management', name: '项目管理' }, status: 'ACTIVE' },
]
const personnelChanges = Array.from({ length: 4 }).map((_, i) => ({
  change_id: 'chg-' + (i + 1), change_type: ['PROMOTION', 'TRANSFER', 'RESIGNATION', 'REHIRE'][i],
  user_name: ['张磊', '王敏', '李伟', '陈静'][i], display_name: ['张磊', '王敏', '李伟', '陈静'][i],
  effective_date: ['2026-11-20', '2026-11-25', '2026-12-01', '2026-12-10'][i], effective_at: null,
  status: ['PENDING', 'APPROVED', 'SCHEDULED', 'COMPLETED'][i],
  target_org_unit_id: 'org-tech', target_organization_name: '技术中心', target_position_id: 'pos-dev', target_position_name: '平台开发工程师',
  reason: '年度晋升评审结果', created_at: NOW,
}))
const loginPolicy = { max_failed_attempts: 5, lockout_duration_seconds: 900, failure_reset_window_seconds: 300, idle_timeout_seconds: 1800, version: 6 }
const lockedAccounts = [
  { account_id: 'acc-zhaolei', account_name: 'zhaolei', locked_until: '2026-11-12T20:05:00+08:00', failed_attempts: 5, updated_at: NOW },
  { account_id: 'acc-testsvc', account_name: 'svc-report', locked_until: '2026-11-12T21:15:00+08:00', failed_attempts: 8, updated_at: NOW },
]
const licenseStatus = {
  initialized: true,
  deployment: { customer_id: 'customer-demo', environment: 'prod', deployment_id: 'dep-demo-01', expires_at: '2027-11-12T00:00:00+08:00' },
  systems: [
    { application_code: 'contract_management', application_name: '合同管理', enforcement: 'ACTIVE', reason_code: '' },
    { application_code: 'project_management', application_name: '项目管理', enforcement: 'ACTIVE', reason_code: '' },
    { application_code: 'reimbursement', application_name: '报销管理', enforcement: 'PENDING_ACTIVATION', reason_code: 'AWAITING_ACTIVATION' },
  ],
  server_time: NOW, runtime_enforcement: { status: 'ENFORCED', verified_at: NOW }, runtime_enforcement_source: 'RUNTIME', configured_environment: 'prod',
}
const licenseEvents = { items: Array.from({ length: 5 }).map((_, i) => ({ event_id: 'lic-' + i, type: ['IMPORT', 'ACTIVATE', 'CLOCK_RECOVERY', 'IMPORT', 'EXPIRE'][i], occurred_at: NOW, operator: '张磊', detail: '供应商签发', result: 'SUCCESS' })), total: 5 }
const platformSettings = { organization_name: '基础能力平台', organization_alias: 'BPC', timezone: 'Asia/Shanghai', qualification: '', version: 3 }
const accessSettings = { public_origin: 'https://portal.example.com', allow_insecure_http_redirect: false, version: 4, updated_at: NOW }
const notificationSettings = { inbox_enabled: true, reminder_frequency: 'IMMEDIATE', version: 2 }
const notificationTemplates = [
  { id: 'tpl-1', code: 'ACCOUNT_CREATED', name: '账号创建通知', status: 'ACTIVE', current_version: 3 },
  { id: 'tpl-2', code: 'CONTRACT_APPROVED', name: '合同审批通过', status: 'ACTIVE', current_version: 5 },
  { id: 'tpl-3', code: 'SETTLEMENT_DUE', name: '结算到期提醒', status: 'DISABLED', current_version: 1 },
]
const deliveries = Array.from({ length: 3 }).map((_, i) => ({ id: 'dlv-' + (i + 1), recipient_user_id: 'u-100' + (i + 1), status: ['DELIVERED', 'FAILED', 'PENDING'][i], attempt_count: [1, 3, 0][i], next_attempt_at: i === 1 ? NOW : null }))
const capabilities = { docker_available: true, discovery_supported: true, agent_version: '2026.11', environments: ['prod', 'test'] }

function payload(pathname, search) {
  const p = pathname.replace('/api/v1', '')
  if (p === '/auth/me') return principal
  if (p === '/auth/activity' || p === '/auth/session') return { idle_expires_at: new Date(Date.now() + 3600e3).toISOString() }
  if (p === '/settings/platform') return platformSettings
  if (p === '/settings/access') return accessSettings
  if (p === '/applications') return { items: apps, total: apps.length, page: 1, page_size: 20 }
  if (p.startsWith('/applications/') && p.endsWith('/environments')) return { items: environments, total: 2, page: 1, page_size: 50 }
  if (p === '/portal/applications') return apps
  if (p === '/subsystem-capabilities') return capabilities
  if (p === '/org-units') return { items: orgUnits, total: orgUnits.length, page: 1, page_size: 100 }
  if (p === '/positions') return { items: positions, total: positions.length, page: 1, page_size: 100 }
  if (p === '/users') return { items: users, total: users.length, page: 1, page_size: 50 }
  if (p === '/accounts') return { items: accounts, total: accounts.length, page: 1, page_size: 50 }
  if (p === '/memberships') return { items: memberships, total: memberships.length, page: 1, page_size: 50 }
  if (p === '/dictionaries') return { items: dictionaries, total: dictionaries.length, page: 1, page_size: 20 }
  if (p.startsWith('/dictionaries/') && p.endsWith('/items')) return { items: dictItems, total: dictItems.length, page: 1, page_size: 20 }
  if (p.startsWith('/dictionaries/code/')) return { items: dictItems, total: dictItems.length }
  if (p === '/async-jobs') return { items: jobs, total: jobs.length, page: 1, page_size: 20 }
  if (p === '/audit/events') return { items: auditEvents, total: 47, page: 1, page_size: 20 }
  if (p === '/audit/ingestion-health') return { recent_events: 1284, total_events: 98211, unknown_provenance: 6, last_received_at: NOW, oldest_unknown_at: '2026-11-10T08:12:00+08:00' }
  if (p === '/notifications/inbox') return { items: notifications, total: notifications.length, page: 1, page_size: 8 }
  if (p === '/notifications/inbox/unread-count') return { unread_count: 3 }
  if (p === '/notifications/templates') return { items: notificationTemplates, total: notificationTemplates.length }
  if (p === '/notifications/deliveries') return { items: deliveries, total: deliveries.length }
  if (p === '/notifications/settings') return notificationSettings
  if (p === '/config/namespaces') return { items: namespaces, total: namespaces.length }
  if (p.startsWith('/config/namespaces/') && p.endsWith('/items')) return { items: [], total: 0 }
  if (p === '/security/login-policy') return loginPolicy
  if (p === '/security/locked-accounts') return { items: lockedAccounts, total: lockedAccounts.length, page: 1, page_size: 20 }
  if (p === '/personnel-changes') return { items: personnelChanges, total: personnelChanges.length, page: 1, page_size: 20 }
  if (p === '/licenses/status') return licenseStatus
  if (p === '/licenses/events') return licenseEvents
  if (p.startsWith('/licenses/enforcement/') && p.endsWith('/overview')) return { enforcement: 'ACTIVE', verified_at: NOW }
  if (p === '/async-jobs' ) return { items: jobs, total: jobs.length }
  return null
}

// 临时 dev server：只服务本机回环，不依赖调用方预先启动。
const viteBin = fileURLToPath(new URL('../../../node_modules/vite/bin/vite.js', import.meta.url))
const server = spawn(process.execPath, [viteBin, '--port', String(PORT), '--strictPort'], {
  cwd: frontendRoot,
  stdio: 'ignore',
})
let serverExited = false
server.on('exit', () => { serverExited = true })
// 异常退出或 Ctrl+C 时也要回收临时 dev server，避免残留端口。
function shutdownServer() {
  if (!serverExited) server.kill('SIGTERM')
}
process.on('exit', shutdownServer)
process.on('SIGINT', () => { shutdownServer(); process.exit(130) })
async function waitForServer() {
  const deadline = Date.now() + 40000
  while (Date.now() < deadline) {
    if (serverExited) throw new Error('vite dev server 提前退出')
    try {
      const response = await fetch(`${BASE}/login`)
      if (response.ok) return
    } catch { /* 启动中 */ }
    await new Promise((resolve) => setTimeout(resolve, 400))
  }
  throw new Error('vite dev server 启动超时')
}

await waitForServer()
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true })
const errors = []
const cases = [
  ['login', '/login', {}],
  ['forbidden', '/forbidden', {}],
  ['force-password', '/force-password-change', {}],
  ['portal', '/portal', {}],
  ['settings-iam', '/settings/iam', {}],
  ['settings-iam-memberships', '/settings/iam', {}],
  ['settings-applications', '/settings/applications', {}],
  ['settings-base', '/settings/base', {}],
  ['settings-access', '/settings/access', {}],
  ['settings-personnel', '/settings/personnel', {}],
  ['settings-notify', '/settings/notify', {}],
  ['settings-security', '/settings/security', {}],
  ['settings-dict', '/settings/dict', {}],
  ['settings-config', '/settings/config', {}],
  ['settings-jobs', '/settings/jobs', {}],
  ['settings-licenses', '/settings/licenses', {}],
  ['audit', '/audit', {}],
  ['audit-advanced', '/audit', { advanced: true }],
]
const selected = only.length ? cases.filter((c) => only.includes(c[0])) : cases

for (const width of widths) {
  for (const theme of themes) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, locale: 'zh-CN', colorScheme: theme === 'dark' ? 'dark' : 'light' })
    await context.addInitScript((mode) => { localStorage.setItem('basic-platform.portal-theme', mode) }, theme)
    const page = await context.newPage()
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)) })
    page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message.slice(0, 300)))
    await page.route('**/api/v1/**', (route) => {
      const url = new URL(route.request().url())
      const data = payload(url.pathname, url.searchParams)
      if (data === null) return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ code: 'OK', data: {} }) })
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ code: 'OK', data }) })
    })
    for (const [name, path, options] of selected) {
      await page.goto(BASE + path, { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(1300)
      // 首登导览只遮挡截图，不参与布局评审。
      const skip = page.locator('.first-run-tour button', { hasText: '跳过导览' })
      if (await skip.count()) { await skip.first().click().catch(() => {}); await page.waitForTimeout(200) }
      if (options.advanced) {
        const toggle = page.locator('.audit-advanced-toggle')
        if (await toggle.count()) { await toggle.first().click().catch(() => {}); await page.waitForTimeout(250) }
      }
      const overflow = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth }))
      if (overflow.scroll > overflow.inner + 1) console.log('OVERFLOW', name, width, theme, JSON.stringify(overflow))
      const file = join(OUT, name + '-' + width + '-' + theme + '.png')
      await page.screenshot({ path: file, fullPage: false })
      if (process.env.PAGE_FULL === '1') await page.screenshot({ path: join(OUT, name + '-' + width + '-' + theme + '-full.png'), fullPage: true })
      console.log('shot', name, width, theme)
    }
    await context.close()
  }
}
console.log('ERRORS:', JSON.stringify([...new Set(errors)].slice(0, 10), null, 1))
await browser.close()
shutdownServer()
