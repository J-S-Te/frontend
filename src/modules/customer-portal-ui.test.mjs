import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const view = await readFile(new URL('./customer_portal/views/CustomerPortalView.vue', import.meta.url), 'utf8')
const filingWizard = await readFile(new URL('./customer_portal/components/FilingWizard.vue', import.meta.url), 'utf8')
const portal = await import('./customer_portal/api/portal.js')

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify({ code: 'OK', message: 'success', data }), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

test('Portal 页面已对齐真实 HTTP 路由并对未配置能力失败关闭', () => {
  assert.match(view, /登录、会话、项目查询、报告申请和等保备案草稿均已接入门户服务/)
  assert.match(view, /备案材料已接(?:受控|入受控)上传与扫描状态/)
  assert.doesNotMatch(view, /退出登录/)
  assert.match(view, /aria-label="结束门户会话"/)
  assert.match(view, /下载 PDF 报告/)
  assert.match(view, /账号安全/)
  assert.match(view, /统一身份账号安全中心/)
  assert.doesNotMatch(view, /用户名|忘记密码|密码强度/)
})

test('备案 API 使用后端真实路径、版本字段、CSRF 与调用方幂等键', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })
  const requests = []
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url, options })
    return jsonResponse(url.endsWith('/validate') ? { valid: false, issues: [{ path: 'sections.ORGANIZATION.city', code: 'REQUIRED', message: 'field is required' }] } : { id: 'FILE/1', version: 2 })
  }

  await portal.listFilings({ page: 1, page_size: 50 })
  await portal.getFiling('FILE/1')
  await portal.createFiling({ project_id: '' }, 'create-key-123')
  await portal.saveFilingSection('FILE/1', 'ORGANIZATION', { expected_version: 3, data: { city: '深圳市' } }, 'section-key-123')
  await portal.saveFilingMatrix('FILE/1', 'BUSINESS_INFORMATION', { expected_filing_version: 8, expected_matrix_version: 2, row_code: 'PUBLIC_INTEREST', column_code: 'SERIOUS_DAMAGE', selected: true }, 'matrix-key-123')
  await portal.validateFiling('FILE/1')
  await portal.submitFiling('FILE/1', { expected_version: 9 }, 'submit-key-123')
  await portal.createFilingMaterialUpload('FILE/1', { material_code: 'NETWORK_TOPOLOGY', file_name: 'topology.pdf', mime_type: 'application/pdf', size_bytes: 3, sha256: 'a'.repeat(64) }, 'material-key-123')
  await portal.completeFilingMaterialUpload('FILE/1', 'MAT/1', 2)
  await portal.deleteFiling('FILE/1')

  assert.equal(requests[0].url, '/customer-portal/api/v1/filings?page=1&page_size=50')
  assert.equal(requests[1].url, '/customer-portal/api/v1/filings/FILE%2F1')
  assert.equal(requests[2].url, '/customer-portal/api/v1/filings')
  assert.equal(requests[2].options.headers['Idempotency-Key'], 'create-key-123')
  assert.equal(requests[3].url, '/customer-portal/api/v1/filings/FILE%2F1/sections/ORGANIZATION')
  assert.deepEqual(JSON.parse(requests[3].options.body), { expected_version: 3, data: { city: '深圳市' } })
  assert.equal(requests[3].options.method, 'PUT')
  assert.equal(requests[4].url, '/customer-portal/api/v1/filings/FILE%2F1/matrix/BUSINESS_INFORMATION')
  assert.deepEqual(JSON.parse(requests[4].options.body), { expected_filing_version: 8, expected_matrix_version: 2, row_code: 'PUBLIC_INTEREST', column_code: 'SERIOUS_DAMAGE', selected: true })
  assert.equal(requests[5].url, '/customer-portal/api/v1/filings/FILE%2F1/validate')
  assert.equal(requests[6].url, '/customer-portal/api/v1/filings/FILE%2F1/submit')
  for (const request of requests.slice(2)) assert.equal(request.options.headers['X-CSRF-Token'], '1')
  assert.equal(requests[6].options.headers['Idempotency-Key'], 'submit-key-123')
  assert.equal(requests[7].url, '/customer-portal/api/v1/filings/FILE%2F1/material-uploads')
  assert.equal(requests[7].options.headers['Idempotency-Key'], 'material-key-123')
  assert.equal(requests[8].url, '/customer-portal/api/v1/filings/FILE%2F1/materials/MAT%2F1/complete')
  assert.deepEqual(JSON.parse(requests[8].options.body), { expected_version: 2 })
  assert.equal(requests[9].url, '/customer-portal/api/v1/filings/FILE%2F1')
  assert.equal(requests[9].options.method, 'DELETE')
  assert.equal(requests[9].options.headers['X-CSRF-Token'], '1')
})

test('备案向导具备七步、权限门禁、冲突停止、全量校验与内部锁定语义', () => {
  for (const code of ['ORGANIZATION', 'CLASSIFIED_OBJECT', 'CLASSIFICATION', 'NEW_TECHNOLOGY', 'MATERIALS', 'DATA_INVENTORY', 'CLASSIFICATION_REPORT']) assert.match(filingWizard, new RegExp(code))
  for (const permission of ['filing.create', 'filing.update', 'filing.submit', 'filing.delete']) assert.match(filingWizard, new RegExp(permission.replace('.', '\\.')))
  assert.match(filingWizard, /item\.status === 'DRAFT' && canDelete/)
  assert.match(filingWizard, /window\.confirm\(`确认删除备案草稿/)
  assert.match(filingWizard, /item\.unit_name/)
  assert.match(filingWizard, /item\.system_name/)
  assert.match(filingWizard, /await deleteFiling\(item\.id\)/)
  assert.match(filingWizard, /FORM_VERSION = '2025\.1'/)
  assert.match(filingWizard, /saveQueue = saveQueue\.catch/)
  assert.match(filingWizard, /filing\.value\.version \+= 1/)
  assert.doesNotMatch(filingWizard, /saveState\[code\][\s\S]{0,500}filing\.value = await getFiling/)
  assert.match(filingWizard, /if \(error\?\.status !== 409\) return false/)
  assert.match(filingWizard, /自动暂存已停止，请重新加载/)
  assert.match(filingWizard, /validation\.issues/)
  assert.match(filingWizard, /WAITING_CONTRACT/)
  assert.match(filingWizard, /SUBMITTING: '正在向公安提交'/)
  assert.match(filingWizard, /SUBMISSION_FAILED: '公安提交失败，待人工处理'/)
  assert.match(filingWizard, /不代表已经向公安机关提交/)
  assert.match(filingWizard, /公安 Provider 已返回并验证回执/)
  assert.doesNotMatch(filingWizard, /SUBMITTED[^\n]{0,300}不表示已经向公安机关提交/)
  assert.doesNotMatch(filingWizard, /localStorage|sessionStorage/)
})

test('备案矩阵使用原生单选，材料走受控上传且 PDF 能力失败关闭', () => {
  assert.match(filingWizard, /type="radio"/)
  assert.doesNotMatch(filingWizard, /matrix version=/)
  assert.doesNotMatch(filingWizard, /section_code=/)
  assert.doesNotMatch(filingWizard, /schema_version=/)
  assert.doesNotMatch(filingWizard, /备案版本 v/)
  assert.doesNotMatch(filingWizard, /固定表单版本/)
  assert.doesNotMatch(filingWizard, /版本 \{\{ item\.form_version \}\}/)
  assert.match(filingWizard, /expected_filing_version/)
  assert.match(filingWizard, /expected_matrix_version/)
  assert.match(filingWizard, /撤销当前选择/)
  assert.match(filingWizard, /createFilingMaterialUpload/)
  assert.match(filingWizard, /completeFilingMaterialUpload/)
  assert.match(filingWizard, /materialCreateKeys\[item\.key\] \|\|= newKey\(\)/)
  assert.match(filingWizard, /materialCreateKeys\[item\.key\]\)/)
  assert.match(filingWizard, /materialCreateKeys\[item\.key\] = ''/)
  assert.match(filingWizard, /credentials: 'omit'/)
  assert.match(filingWizard, /target\.protocol !== 'https:'/)
  assert.match(filingWizard, /正式对象存储或病毒扫描尚未配置/)
  assert.match(filingWizard, /!filingExportAvailable/)
  assert.match(filingWizard, /当前运行环境尚未启用备案 PDF 导出/)
  assert.match(filingWizard, /<input type="file"/)
  assert.doesNotMatch(filingWizard, /v-html/)
})

test('备案入口按 filing.read 门禁，无权限时不挂载向导', () => {
  assert.match(view, /v-if="hasPermission\('filing\.read'\)"/)
  assert.match(view, /v-else-if="section === 'filings' && hasPermission\('filing\.read'\)"/)
  assert.match(view, /当前账号没有备案读取权限/)
})

test('账号安全会话撤销和事件确认使用 CSRF 写接口', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })
  const requests = []
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url, options })
    return jsonResponse({ ok: true })
  }

  await portal.revokeAccountSession('opaque/session')
  await portal.acknowledgeSecurityEvent('event/one')
  assert.equal(requests[0].url, '/customer-portal/api/v1/account/sessions/opaque%2Fsession')
  assert.equal(requests[0].options.method, 'DELETE')
  assert.equal(requests[0].options.headers['X-CSRF-Token'], '1')
  assert.equal(requests[1].url, '/customer-portal/api/v1/account/security-events/event%2Fone/ack')
  assert.equal(requests[1].options.method, 'POST')
  assert.equal(requests[1].options.headers['X-CSRF-Token'], '1')
})

test('报告列表调用约定的 /reports 而不是旧 /report-requests', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })
  let requestURL = ''
  globalThis.fetch = async (url) => {
    requestURL = url
    return jsonResponse({ items: [], total: 0 })
  }

  await portal.listReportRequests({ page: 1, page_size: 20 })
  assert.equal(requestURL, '/customer-portal/api/v1/reports?page=1&page_size=20')
})

test('报告异步安全入库状态使用明确中文且不会误称已发放', () => {
  assert.match(view, /INGEST_PENDING: '文件安全处理中'/)
  assert.match(view, /REPORT_INGEST_QUEUED: '文件安全处理已入队'/)
})

test('报告申请调用 /reports 并携带幂等键', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })
  let request
  globalThis.fetch = async (url, options) => {
    request = { url, options }
    return jsonResponse({ id: 7, status: 'SUBMITTED' }, 201)
  }

  const result = await portal.createReportRequest({ project_id: 'P-1', report_type: 'PDF', reason: '验收' })
  assert.equal(result.id, 7)
  assert.equal(request.url, '/customer-portal/api/v1/reports')
  assert.equal(request.options.method, 'POST')
  assert.ok(request.options.headers['Idempotency-Key'])
  assert.equal(request.options.headers['X-CSRF-Token'], '1')
  assert.equal(request.options.credentials, 'include')
})

test('服务评价资格和提交使用真实路由、CSRF 与幂等键', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })
  const requests = []
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url, options })
    return jsonResponse(url.endsWith('evaluation-eligibility') ? { project_id: 'P/1', eligible: true } : { id: 'EV-1', average_score: '4.50' }, url.endsWith('/evaluations') ? 201 : 200)
  }

  await portal.getEvaluationEligibility('P/1')
  await portal.submitEvaluation({ project_id: 'P/1', professional_score: 5, response_score: 4, report_score: 4, attitude_score: 5 })
  assert.equal(requests[0].url, '/customer-portal/api/v1/projects/P%2F1/evaluation-eligibility')
  assert.equal(requests[0].options.method, undefined)
  assert.equal(requests[1].url, '/customer-portal/api/v1/evaluations')
  assert.equal(requests[1].options.method, 'POST')
  assert.equal(requests[1].options.headers['X-CSRF-Token'], '1')
  assert.ok(requests[1].options.headers['Idempotency-Key'])
})

test('服务评价页面使用原生单选控件且不使用 v-html 展示评语', () => {
  assert.match(view, /aria-label="服务评分"/)
  assert.match(view, /type="radio"/)
  assert.match(view, /提交后不可修改/)
  assert.doesNotMatch(view, /v-html/)
})

test('Portal 退出使用受 CSRF 保护的 POST 并清理本地页面', async (t) => {
  const originalFetch = globalThis.fetch
  const originalWindow = globalThis.window
  t.after(() => { globalThis.fetch = originalFetch; globalThis.window = originalWindow })
  let request
  let assigned = ''
  globalThis.fetch = async (url, options) => {
    request = { url, options }
    return jsonResponse({ logged_out: true })
  }
  globalThis.window = { location: { assign: (value) => { assigned = value } } }

  await portal.logoutPortal()
  assert.equal(request.url, '/customer-portal/auth/logout')
  assert.equal(request.options.method, 'POST')
  assert.equal(request.options.headers['X-CSRF-Token'], '1')
  assert.equal(assigned, '/customer-portal/')
})

test('Portal API 将后端原始 Go 模型字段规范化为页面字段', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })
  globalThis.fetch = async () => jsonResponse({ items: [{ ProjectID: 'P-9', ProjectName: '统一认证', ProgressPct: 60, SourceUpdatedAt: '2026-07-31T00:00:00Z' }] })
  const value = await portal.listProjects({ page: 1 })
  assert.equal(value.items[0].project_id, 'P-9')
  assert.equal(value.items[0].project_name, '统一认证')
  assert.equal(value.items[0].progress_pct, 60)
})

test('客户门户表单受控化、分页加载与流程引导', () => {
  assert.match(view, /reportTypeOptions/)
  assert.match(view, /请选择报告类型/)
  assert.match(view, /receive_email" type="email" required/)
  assert.match(view, /feedbackForm\.project_id/)
  assert.match(view, /validContact\(/)
  assert.match(view, /securityCenterHref/)
  assert.match(view, /onDialogKeydown/)
  assert.match(view, /loadMoreProjects|loadMoreReports|loadMoreFeedbacks/)
  assert.match(view, /低分事项已转交服务团队跟进处理/)
  assert.match(view, /通过「客户反馈」提交或联系您的服务人员/)
  assert.match(view, /class="project-actions"/)
  assert.doesNotMatch(view, /class="project-export-actions"/)
  assert.match(filingWizard, /createProjectId/)
  assert.match(filingWizard, /beforeunload/)
  assert.match(filingWizard, /后续将由服务人员与您联系办理/)
  assert.match(filingWizard, /filing\.status === 'DRAFT' && canDelete/)
})
