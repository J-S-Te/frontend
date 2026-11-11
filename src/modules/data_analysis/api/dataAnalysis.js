// 数据看板后端 API 封装（骨架，对齐 project_management/api/projectManagement.js 模式）
// 认证约定：HttpOnly Cookie 会话；401 由本客户端发起 OIDC 跳转；403 交由页面展示无权限。
import { attachStructuredContext } from '../../platform/shared/api/requestContext.js'
import { createApiRequestContext } from '../../platform/shared/api/requestContext.js'
import { shouldStartSubsystemLogin } from '../../shared/authz/sessionCompatibility.js'
import { formatDataAnalysisError } from '../utils/errors.js'
import { validMetricFactsSummary } from '../utils/metricFacts.js'

const runtimeEnv = import.meta.env || {}
const PUBLIC_PATH_PREFIX = (runtimeEnv.VITE_DATA_ANALYSIS_PUBLIC_PATH_PREFIX || '/data_analysis').replace(/\/$/, '')
const API_BASE_URL = (runtimeEnv.VITE_DATA_ANALYSIS_API_BASE_URL || `${PUBLIC_PATH_PREFIX}/api/v1`).replace(/\/$/, '')

let loginRedirectStarted = false

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

// 用途：校验标准财务来源的完整发布状态，禁止把任意JSON视为成功回执。
// 参数：data为状态或发布响应，allowUnpublished允许合法的未发布状态。
// 返回值：来源、版本、批次和指纹相互一致时返回true。
function validStandardPublication(data, allowUnpublished) {
  if (!isRecord(data) || data.source_code !== 'standard-finance'
    || !Number.isSafeInteger(data.version) || data.version < 0
    || typeof data.replayed !== 'boolean') return false
  if (data.version === 0) {
    return allowUnpublished && data.published === false && data.batch_id === ''
      && data.digest === '' && data.published_at === null
  }
  return data.published === true && typeof data.batch_id === 'string'
    && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/.test(data.batch_id)
    && /^[a-f0-9]{64}$/.test(data.digest) && typeof data.published_at === 'string'
    && Number.isFinite(Date.parse(data.published_at))
}

// 用途：校验预览用于确认的版本指纹及分币种金额，缺指标不能显示为零。
// 参数：data为服务端标准事实预览。
// 返回值：预览包含可安全展示的金额和版本时返回true。
function validStandardPreview(data) {
  if (!isRecord(data) || data.schema_version !== 1 || typeof data.batch_id !== 'string'
    || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/.test(data.batch_id)
    || !/^[a-f0-9]{64}$/.test(data.digest)
    || !Number.isSafeInteger(data.expected_version) || data.expected_version < 0
    || !Number.isInteger(data.row_count) || data.row_count < 0 || data.row_count > 1000
    || data.snapshot?.available !== true || !Array.isArray(data.snapshot?.metrics?.currencies)) {
    return false
  }
  const rows = data.snapshot.metrics.currencies
  // 非空事实必有币种汇总；缺失指标不能按合法的空来源呈现为零。
  if (data.row_count > 0 && rows.length === 0) return false
  if (!rows.every(isRecord)) return false
  if (rows.length > data.row_count || new Set(rows.map((row) => row.currency)).size !== rows.length) return false
  return rows.every((row) => isRecord(row) && /^[A-Z]{3}$/.test(row.currency)
    && ['original_minor', 'allocated_minor', 'open_minor', 'over_90_minor', 'month_receipts_minor']
      .every((key) => Number.isSafeInteger(row[key]) && row[key] >= 0)
    && row.allocated_minor <= row.original_minor
    && row.open_minor === row.original_minor - row.allocated_minor
    && row.over_90_minor <= row.open_minor
    && (row.collection_rate === null || (typeof row.collection_rate === 'number'
      && Number.isFinite(row.collection_rate) && row.collection_rate >= 0 && row.collection_rate <= 100)))
}

// validCount 校验可展示的非负整数，避免畸形值被格式化为零。
// 参数：value 为来源计数或金额。
// 返回值：安全非负整数时为 true。
function validCount(value) {
  return Number.isSafeInteger(value) && value >= 0
}

// validCurrencyTotals 校验原币种金额及数量列表。
// 参数：rows 为接口币种聚合数组。
// 返回值：每项币种和数值完整合法时为 true。
function validCurrencyTotals(rows) {
  return Array.isArray(rows) && rows.every((row) => isRecord(row)
    && /^[A-Z]{3}$/.test(row.currency) && validCount(row.amount_minor) && validCount(row.contracts))
}

// validDashboardSummary 检查看板摘要的可用性及核心指标。
// 参数：data 为服务端摘要，kind 为看板类型。
// 返回值：不可用状态或完整真实指标符合契约时为 true。
function validDashboardSummary(data, kind) {
  if (!isRecord(data) || typeof data.available !== 'boolean') return false
  if (!data.available) return true
  if (kind === 'contract') {
    return ['total_contracts', 'approval_contracts', 'active_contracts', 'expired_contracts',
      'opportunity_count', 'won_contract_count', 'total_amount_minor'].every((key) => validCount(data[key]))
      && typeof data.conversion_available === 'boolean' && typeof data.discount_available === 'boolean'
      && validCurrencyTotals(data.currency_totals)
      && (data.total_contracts === 0 || data.currency_totals.length > 0)
  }
  if (kind === 'project') {
    return ['project_count', 'in_flight_projects', 'risk_projects', 'service_items']
      .every((key) => validCount(data[key])) && isRecord(data.status_counts)
      && Object.values(data.status_counts).every(validCount)
      && (data.report_stage_counts == null || (isRecord(data.report_stage_counts)
        && Object.values(data.report_stage_counts).every(validCount)))
  }
  if (!isRecord(data.metrics)) return false
  if (kind === 'report') {
    return ['active_reports', 'reviewed_reports', 'void_reports'].every((key) => validCount(data.metrics[key]))
      && (data.metrics.cycle_p50_days === null || (typeof data.metrics.cycle_p50_days === 'number'
        && Number.isFinite(data.metrics.cycle_p50_days) && data.metrics.cycle_p50_days >= 0))
      && isRecord(data.metrics.status_counts) && Object.values(data.metrics.status_counts).every(validCount)
  }
  return Array.isArray(data.metrics.currencies) && data.metrics.currencies.every((row) =>
    isRecord(row) && /^[A-Z]{3}$/.test(row.currency)
    && ['original_minor', 'allocated_minor', 'open_minor', 'over_90_minor', 'month_receipts_minor'].every((key) => validCount(row[key]))
    && (row.collection_rate === null || (typeof row.collection_rate === 'number'
      && Number.isFinite(row.collection_rate) && row.collection_rate >= 0 && row.collection_rate <= 100)))
}

// validDashboardDetails 检查分页信封与脱敏明细字段。
// 参数：data 为分页响应，project 为项目列表标记。
// 返回值：分页和记录数值类型合法时为 true。
function validDashboardDetails(data, project) {
  if (!isRecord(data) || !Array.isArray(data.items) || !validCount(data.total)
    || !Number.isSafeInteger(data.page) || data.page < 1 || !Number.isSafeInteger(data.page_size)
    || data.page_size < 1 || data.page_size > 100 || data.items.length > data.page_size) return false
  if (project && typeof data.available !== 'boolean') return false
  return data.items.every((row) => isRecord(row) && typeof row.status === 'string'
    && (project ? typeof row.project_id === 'string' && typeof row.name === 'string'
      && typeof row.manager === 'string' && typeof row.owner_org_id === 'string'
      && typeof row.report_stage === 'string' && typeof row.risk === 'boolean'
      && typeof row.in_flight === 'boolean' && validCount(row.service_items) : typeof row.contract_number === 'string'
      && typeof row.title === 'string' && validCount(row.amount_minor) && /^[A-Z]{3}$/.test(row.currency)))
}

// 用途：按现有接口契约检查数据响应，写操作缺真实回执时拒绝确认成功。
// 参数：body为响应信封，path为业务路径，method为HTTP方法。
// 返回值：符合当前或受支持旧信封返回true，否则触发结果异常处理。
function validDataEnvelope(body, path, method) {
  // response.OK 使用 {code:"OK", data:...}；兼容无 code 的旧版 data 信封。
  if (!isRecord(body) || !Object.hasOwn(body, 'data')) return false
  const data = body.data
  const route = path.split('?')[0]
  if (route === '/dashboard/metrics') return validMetricFactsSummary(data)
    && data.section === new URLSearchParams(path.split('?')[1] || '').get('section')
  if (route === '/admin/standard-finance/publish') return validStandardPublication(data, false)
  if (route === '/admin/standard-finance/status') {
    return isRecord(data) && ['standard', 'integration'].includes(data.selected_source)
      && validStandardPublication(data.publication, true)
  }
  if (route === '/admin/standard-finance/preview') return validStandardPreview(data)
  if (['/dashboard/contract', '/dashboard/project', '/dashboard/report', '/dashboard/finance'].includes(route)) {
    return validDashboardSummary(data, route.split('/').at(-1))
  }
  if (route === '/dashboard/contracts' || route === '/dashboard/projects') return validDashboardDetails(data, route.endsWith('/projects'))
  if (route === '/dashboard/trend') return Array.isArray(data) && data.every((row) => isRecord(row)
    && /^\d{4}-(0[1-9]|1[0-2])$/.test(row.period) && validCount(row.contract_count)
    && validCount(row.project_count) && validCurrencyTotals(row.currency_totals || []))
  if (route === '/alerts/summary') return isRecord(data)
    && ['total', 'open', 'ack', 'closed'].every((key) => validCount(data[key]))
    && isRecord(data.by_severity) && Object.values(data.by_severity).every(validCount)
  if (route === '/auth/me') return isRecord(data) && !!data.user_id && !!data.tenant_id && Array.isArray(data.permissions)
  const listRoute = ['/alerts', '/alert-rules', '/admin/sources', '/dashboard/trend'].includes(route) || /^\/dictionary\/metrics\/[^/]+\/versions$/.test(route)
  if (method === 'GET' && listRoute) return Array.isArray(data)
  if (method === 'PUT' && route === '/alert-rules') return Array.isArray(data) && data.length > 0
  if (method === 'DELETE') return isRecord(data) && data.deleted === true
  return isRecord(data) && Object.keys(data).length > 0
}

/**
 * startDataAnalysisLogin 发起数据看板子系统登录流程。
 * @returns {void}
 */
export function startDataAnalysisLogin() {
  if (loginRedirectStarted) return
  loginRedirectStarted = true
  window.location.replace(`${PUBLIC_PATH_PREFIX}/auth/login`)
}

async function request(path, options = {}) {
  const method = (options.method || 'GET').toUpperCase()
  // suppressLoginRedirect 供会话空闲探测使用：401 由生命周期统一收口。
  const suppressLoginRedirect = options.suppressLoginRedirect === true
  const requestContext = {
    subsystem: 'data_analysis',
    feature: 'dashboard_api',
    operation: method,
    path,
    method,
  }
  const context = createApiRequestContext(requestContext)

  const requiresCSRF = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)
  let response
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      credentials: 'include',
      ...options,
      headers: {
        Accept: 'application/json',
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        // 写操作必须携带同源 CSRF 标记；后端仍会结合 Origin/Sec-Fetch-Site 校验，
        // 该固定值不构成身份凭据（对齐 CRM crmauth 客户端约定）。
        ...(requiresCSRF ? { 'X-CSRF-Token': '1' } : {}),
        ...(options.headers || {}),
      },
    })
  } catch (cause) {
    const code = cause?.name === 'AbortError' || cause?.name === 'TimeoutError' ? 'REQUEST_TIMEOUT' : 'NETWORK_ERROR'
    const requestError = new Error(method === 'GET'
      ? formatDataAnalysisError(cause, { code, status: 0, method, fallback: '无法连接数据看板服务，请检查网络后重试。' })
      : '连接中断，尚无法确认本次操作是否已生效。请先刷新列表核对结果，勿重复提交。')
    requestError.status = 0
    requestError.code = code
    requestError.cause = cause
    attachStructuredContext(requestError, {
      ...context,
      metadata: { ...(context.metadata || {}), network: true },
    }, {
      status: 0,
      code,
      requestId: '',
      traceId: '',
    })
    throw requestError
  }

  const contentType = response.headers.get('content-type') || ''
  const requestId = response.headers.get('x-request-id') || ''
  const traceId = response.headers.get('x-trace-id') || ''
  let body = {}
  let parseCause = null
  const isJSON = /\bapplication\/(?:[\w.-]+\+)?json\b/i.test(contentType)
  if (isJSON) {
    try { body = await response.json() } catch (cause) { parseCause = cause }
  }
  const businessError = isRecord(body) && Object.hasOwn(body, 'code') && body.code !== 'OK'
  if (!response.ok || businessError) {
    const error = new Error(formatDataAnalysisError(body, { status: response.status, method, fallback: '数据看板服务暂时无法处理请求。' }))
    error.details = body?.details
    if (parseCause) error.cause = parseCause
    attachStructuredContext(error, {
      ...requestContext,
      requestId: body?.request_id || requestId,
      traceId: body?.trace_id || body?.traceId || traceId,
      metadata: { source: 'data_analysis_api' },
    }, {
      status: response.status,
      code: body?.code,
      requestId: body?.request_id || requestId,
      traceId: body?.trace_id || body?.traceId || traceId,
    })
    error.status = response.status
    error.code = body?.code
    error.requestID = body?.request_id || requestId
    if (!suppressLoginRedirect && shouldStartSubsystemLogin(error)) startDataAnalysisLogin()
    throw error
  }
  // DELETE 的无内容成功兼容旧部署；创建／审批等必须收到实际业务结果。
  if ((response.status === 204 || response.status === 205) && method === 'DELETE') return null
  if (parseCause || !isJSON || !validDataEnvelope(body, path, method)) {
    const error = new Error(method === 'GET'
      ? '服务返回的数据格式异常，请刷新页面后重试；仍失败时请联系管理员。'
      : '服务器已接受操作，但返回结果异常。请先刷新列表核对结果，勿重复提交。')
    error.status = response.status
    error.code = 'INVALID_RESPONSE'
    error.cause = parseCause
    attachStructuredContext(error, requestContext, { status: response.status, code: error.code, requestId, traceId })
    throw error
  }
  return body.data
}

// 用途：读取受认证会话中的嵌入能力，兼容未提供此字段的旧服务。
// 参数：session 为 /auth/me 返回的当前会话信息。
// 返回值：仅显式关闭时为 false；旧服务缺失字段时维持嵌入行为。
export function isDashboardEmbedEnabled(session) {
  return session?.capabilities?.dashboard_embed_enabled !== false
}

/**
 * getAuthMe 查询数据看板当前会话信息。
 * @returns {Promise<any>} 返回 /auth/me 的会话结果。
 * @throws {Error} 会话不存在或服务异常时抛出错误。
 */
export function getAuthMe() {
  return request('/auth/me')
}

/**
 * probeDataAnalysisSession 只读读取数据看板会话及服务端权威空闲窗口；401 不自行跳转。
 * @returns {Promise<any>} 会话结果（含 idle_timeout_seconds/idle_remaining_ms）。
 */
export function probeDataAnalysisSession() {
  return request('/auth/me', { suppressLoginRedirect: true })
}

/**
 * recordDataAnalysisSessionActivity 上报真实用户操作，滑动数据看板会话空闲窗口。
 * @returns {Promise<any>} 服务端权威空闲窗口。
 */
export function recordDataAnalysisSessionActivity() {
  return request('/auth/activity', { method: 'POST', suppressLoginRedirect: true })
}

/**
 * ensureDataAnalysisSession 获取并修正会话状态；真正未鉴权时发起 OIDC 跳转并返回 null。
 * - IDENTITY_NOT_PROVISIONED / OIDC_CLAIMS_INVALID / FORBIDDEN / 503 等非登录类错误
 *   不触发跳转，由路由守卫转交 subsystem_access_error 页。
 * - 401 UNAUTHENTICATED 必须主动发起 Keycloak 登录，否则路由守卫只看到 null
 *   会静默中止跳转，用户点击卡片后看不到任何反馈。
 * @returns {Promise<any|null>} 会话有效返回会话对象，无效时若已发起跳转返回 null。
 * @throws {Error} 非登录类鉴权错误、网络失败或服务端异常时抛出。
 */
export async function ensureDataAnalysisSession() {
  try {
    return await getAuthMe()
  } catch (error) {
    if (shouldStartSubsystemLogin(error)) {
      startDataAnalysisLogin()
      return null
    }
    throw error
  }
}

/**
 * getEmbedToken 获取仪表盘嵌入 token，用于前端 iframe 直接加载嵌入视图。
 * @param {string} dashboardCode 仪表盘代码（contract/project 等）。
 * @returns {Promise<any>} 返回 token 与过期时间。
 * @throws {Error} token 获取失败时抛出。
 */
export function getEmbedToken(dashboardCode) {
  return request(`/embed/${encodeURIComponent(dashboardCode)}`)
}

/**
 * getContractDashboardSummary 查询合同看板快照摘要（后端聚合库）。
 * @returns {Promise<any>} 返回聚合统计字段。
 * @throws {Error} 查询失败抛出错误。
 */
export function getContractDashboardSummary() { return request('/dashboard/contract') }

/**
 * getProjectDashboardSummary 查询项目看板快照摘要（后端聚合库）。
 * @returns {Promise<any>} 返回聚合统计字段。
 * @throws {Error} 查询失败抛出错误。
 */
export function getProjectDashboardSummary() { return request('/dashboard/project') }

export function getReportDashboardSummary() { return request('/dashboard/report') }
export function getFinanceDashboardSummary() { return request('/dashboard/finance') }

// getMetricFacts 查询当前分区的真实新增业务指标，范围由服务端主体决定。
// 参数：section为看板分区，period为可选北京业务月份。
// 返回值：经过完整契约校验的摘要，缺来源或错误原样明确呈现。
export function getMetricFacts(section, period = '') {
  const query = new URLSearchParams({ section })
  if (period) query.set('period', period)
  return request(`/dashboard/metrics?${query}`)
}

/** getContractDetails 查询合同下钻分页明细。 */
export function getContractDetails(params = {}) { const query = new URLSearchParams(params).toString(); return request(`/dashboard/contracts${query ? `?${query}` : ''}`) }

// getProjectDetails 查询当前可信范围内成功发布的项目明细。
// 参数：params 为页码与页大小，权限范围由服务端确定。
// 返回值：分页响应；无首次成功时 available 为 false。
export function getProjectDetails(params = {}) {
  const query = new URLSearchParams(params).toString()
  return request(`/dashboard/projects${query ? `?${query}` : ''}`)
}

/** getDashboardTrend 查询合同/项目月度趋势。 */
export function getDashboardTrend() { return request('/dashboard/trend') }

/** getAlertSummary 查询当前租户预警聚合。 */
export function getAlertSummary() { return request('/alerts/summary') }

/**
 * getAlerts 查询预警列表，默认返回当前租户可见告警。
 * @param {Object} params 筛选参数。
 * @returns {Promise<any>} 返回告警分页结果。
 * @throws {Error} 查询失败抛出错误。
 */
export function getAlerts(params = {}) {
  const query = new URLSearchParams(params).toString()
  return request(`/alerts${query ? `?${query}` : ''}`)
}

/**
 * ackAlert 确认告警已知悉并记录处理人。
 * @param {string|number} id 告警 ID。
 * @returns {Promise<any>} 返回处理结果。
 * @throws {Error} 请求失败抛出错误。
 */
export function ackAlert(id) { return request(`/alerts/${encodeURIComponent(id)}/ack`, { method: 'POST' }) }

/**
 * closeAlert 关闭告警并提交处理结果。
 * @param {string|number} id 告警 ID。
 * @returns {Promise<any>} 返回处理结果。
 * @throws {Error} 请求失败抛出错误。
 */
export function closeAlert(id) { return request(`/alerts/${encodeURIComponent(id)}/close`, { method: 'POST' }) }

/**
 * getAlertRules 查询告警规则列表。
 * @returns {Promise<any>} 返回规则配置。
 * @throws {Error} 查询失败抛出错误。
 */
export function getAlertRules() { return request('/alert-rules') }

/**
 * putAlertRules 批量写入/覆盖告警规则。
 * @param {Object} payload 告警规则配置。
 * @returns {Promise<any>} 返回持久化结果。
 * @throws {Error} 写入失败抛出错误。
 */
export function putAlertRules(payload) {
  return request('/alert-rules', { method: 'PUT', body: JSON.stringify(payload) })
}

/**
 * deleteAlertRule 删除没有历史预警记录的规则。
 * @param {string} id 规则 ID。
 * @returns {Promise<any>} 返回删除结果。
 * @throws {Error} 规则存在历史预警或请求失败时抛出。
 */
export function deleteAlertRule(id) { return request(`/alert-rules/${encodeURIComponent(id)}`, { method: 'DELETE' }) }

/**
 * getDictionary 查询指标字典（维度码值、状态口径）。
 * @returns {Promise<any>} 返回指标字典对象。
 * @throws {Error} 查询失败抛出错误。
 */
export function getDictionary() { return request('/dictionary') }

/** createDictionaryMetric 新建默认停用的指标口径。 */
export function createDictionaryMetric(payload) { return request('/dictionary/metrics', { method: 'POST', body: JSON.stringify(payload) }) }

/** updateDictionaryMetric 使用当前版本修改单个指标，编码不可变。 */
export function updateDictionaryMetric(code, payload) { return request(`/dictionary/metrics/${encodeURIComponent(code)}`, { method: 'PUT', body: JSON.stringify(payload) }) }

/** setDictionaryMetricEnabled 启停指标；未绑定计算能力的指标不可启用。 */
export function setDictionaryMetricEnabled(code, enabled, version) { return request(`/dictionary/metrics/${encodeURIComponent(code)}/enabled`, { method: 'PATCH', body: JSON.stringify({ enabled, version }) }) }

/** deleteDictionaryMetric 删除未被引用的自定义指标。 */
export function deleteDictionaryMetric(code, version) { return request(`/dictionary/metrics/${encodeURIComponent(code)}`, { method: 'DELETE', body: JSON.stringify({ version }) }) }

/** getDictionaryMetricVersions 查询单指标不可变版本历史。 */
export function getDictionaryMetricVersions(code) { return request(`/dictionary/metrics/${encodeURIComponent(code)}/versions`) }

/**
 * listSources 查询数据源同步接入状态。
 * @returns {Promise<any>} 返回数据源状态列表。
 * @throws {Error} 查询失败抛出错误。
 */
export function listSources() { return request('/admin/sources') }

/**
 * triggerSource 手动触发指定数据源一次同步。
 * @param {string|number} id 数据源 ID。
 * @returns {Promise<any>} 返回触发结果。
 * @throws {Error} 触发失败抛出错误。
 */
export function triggerSource(id) { return request(`/admin/sources/${encodeURIComponent(id)}/trigger`, { method: 'POST' }) }

/**
 * triggerAllSources 将当前租户全部启用数据源一次性加入同步队列。
 * @returns {Promise<any>} 返回入队数量和跳过数量。
 * @throws {Error} 批量入队失败时抛出。
 */
export function triggerAllSources() { return request('/admin/sources/trigger-all', { method: 'POST' }) }

/**
 * getContractImportHistory 查询独立历史统计与逐轮发布状态。
 * 参数：无；授权范围由服务端会话确定。
 * 返回值：Promise<Object>，缺失或失败状态原样保留，读取失败抛错。
 */
export function getContractImportHistory() { return request('/dashboard/contract-import-history') }

// 用途：读取标准财务事实模板及字段业务说明。
// 参数：无。
// 返回值：模板对象；认证、权限或来源异常时抛出错误。
export function getStandardFinanceTemplate() {
  return request('/admin/standard-finance/template')
}

// 用途：读取当前财务来源与标准事实发布状态。
// 参数：无。
// 返回值：来源和当前批次版本；依赖异常时抛出错误。
export function getStandardFinanceStatus() {
  return request('/admin/standard-finance/status')
}

// 用途：校验完整标准事实文件并取得可核对的财务指标预览。
// 参数：document 为完整财务事实文件，不含客户端租户信息。
// 返回值：指纹、当前版本及计算指标；非法事实或依赖异常时抛出错误。
export function previewStandardFinance(document) {
  return request('/admin/standard-finance/preview', { method: 'POST', body: JSON.stringify(document) })
}

// 用途：以预览绑定和来源版本原子发布完整标准财务事实。
// 参数：payload 为完整文件、预览指纹和预期来源版本。
// 返回值：权威发布回执；冲突、许可或依赖异常时抛出错误。
export function publishStandardFinance(payload) {
  return request('/admin/standard-finance/publish', { method: 'POST', body: JSON.stringify(payload) })
}
