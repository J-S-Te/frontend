// 数据看板后端 API 封装（骨架，对齐 project_management/api/projectManagement.js 模式）
// 认证约定：HttpOnly Cookie 会话；401 由本客户端发起 OIDC 跳转；403 交由页面展示无权限。
import { attachStructuredContext } from '../platform/shared/api/requestContext.js'
import { createApiRequestContext } from '../platform/shared/api/requestContext.js'

const runtimeEnv = import.meta.env || {}
const PUBLIC_PATH_PREFIX = (runtimeEnv.VITE_DATA_ANALYSIS_PUBLIC_PATH_PREFIX || '/data_analysis').replace(/\/$/, '')
const API_BASE_URL = (runtimeEnv.VITE_DATA_ANALYSIS_API_BASE_URL || `${PUBLIC_PATH_PREFIX}/api/v1`).replace(/\/$/, '')

let loginRedirectStarted = false

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
  } catch (error) {
    const requestError = new Error('无法连接数据看板服务，请确认后端服务已启动。')
    attachStructuredContext(requestError, {
      ...context,
      metadata: { ...(context.metadata || {}), network: true },
    }, {
      status: 0,
      code: 'NETWORK_ERROR',
      requestId: '',
      traceId: '',
    })
    throw requestError
  }

  const contentType = response.headers.get('content-type') || ''
  let body = {}
  if (contentType.includes('application/json')) {
    body = await response.json().catch(() => ({ message: `HTTP ${response.status}` }))
  } else {
    const text = await response.text().catch(() => '')
    body = text ? { message: text } : {}
  }
  if (!response.ok) {
    const error = new Error(body?.message || `HTTP ${response.status}`)
    attachStructuredContext(error, {
      ...requestContext,
      requestId: body?.request_id || '',
      traceId: body?.trace_id || body?.traceId || '',
      metadata: { source: 'data_analysis_api' },
    }, {
      status: response.status,
      code: body?.code,
      requestId: body?.request_id || '',
      traceId: body?.trace_id || body?.traceId || '',
    })
    error.status = response.status
    error.code = body?.code
    error.requestID = body?.request_id || ''
    if (response.status === 401) startDataAnalysisLogin()
    throw error
  }
  return body?.data ?? body
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
 * ensureDataAnalysisSession 获取并修正会话状态；401 时返回 null，便于路由守卫统一跳登录。
 * @returns {Promise<any|null>} 会话有效返回会话对象，无效返回 null。
 * @throws {Error} 非 401 的错误会直接向上抛出。
 */
export async function ensureDataAnalysisSession() {
  try {
    return await getAuthMe()
  } catch (error) {
    if (error.status === 401) return null
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
 * getDictionary 查询指标字典（维度码值、状态口径）。
 * @returns {Promise<any>} 返回指标字典对象。
 * @throws {Error} 查询失败抛出错误。
 */
export function getDictionary() { return request('/dictionary') }

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
