import { normalizeAuthorizationSession, shouldStartSubsystemLogin } from '../../shared/authz/sessionCompatibility.js'
import { attachStructuredContext } from '../../platform/shared/api/requestContext.js'
import { logoutCurrentSession } from '../../platform/auth/api/auth.js'

const PUBLIC_PATH_PREFIX = (import.meta.env?.VITE_CUSTOMER_PORTAL_PUBLIC_PATH_PREFIX || '/customer-portal').replace(/\/$/, '')
const API_BASE_URL = (import.meta.env?.VITE_CUSTOMER_PORTAL_API_BASE_URL || `${PUBLIC_PATH_PREFIX}/api/v1`).replace(/\/$/, '')
let session = null
let sessionRequest = null
let redirectStarted = false

/**
 * PortalAPIError 表示客户门户 API 调用失败，并保留后端错误与追踪信息。
 * @param {string} message 错误信息。
 * @param {{status?: number, code?: string, requestID?: string, details?: unknown}} [context={}] 后端错误上下文。
 */
export class PortalAPIError extends Error {
  constructor(message, { status = 0, code = '', requestID = '', details = null } = {}) {
    super(message); this.name = 'PortalAPIError'; this.status = status; this.code = code; this.requestID = requestID; this.details = details
  }
}
/**
 * beginLogin 清空门户会话并发起登录；并发失败请求只允许首次跳转生效。
 * @returns {void}
 */
function beginLogin() {
  // 门户页面常并发加载项目、通知和能力状态；401 只允许触发一次跳转，并保留
  // 当前相对路径作为回跳目标，避免每个失败请求互相覆盖导航。
  if (redirectStarted) return
  redirectStarted = true
  session = null
  const returnPath = `${window.location.pathname}${window.location.search}${window.location.hash}`
  window.location.replace(`${PUBLIC_PATH_PREFIX}/auth/login?return_to=${encodeURIComponent(returnPath)}`)
}
/**
 * request 调用客户门户 API，统一附加 CSRF 请求头、解析响应并补充结构化错误上下文。
 * @param {string} path 相对于门户 API 根路径的请求地址。
 * @param {RequestInit} [options={}] Fetch 请求配置。
 * @returns {Promise<unknown>} 优先返回响应 data 字段，否则返回完整响应体。
 * @throws {PortalAPIError} 服务端返回非成功状态时抛出；会话失效时同时启动登录跳转。
 * @throws {TypeError} 网络连接或 Fetch 调用失败时抛出。
 */
async function request(path, options = {}) {
  const method = (options.method || 'GET').toUpperCase()
  const requiresCSRF = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)
  const requestContext = {
    subsystem: 'customer_portal',
    feature: 'portal_api',
    operation: method,
    path,
    method,
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options, credentials: 'include',
    // 固定 CSRF 标记只声明这是受控前端写请求，后端仍需结合 Origin 和会话校验。
    headers: { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(requiresCSRF ? { 'X-CSRF-Token': '1' } : {}), ...(options.headers || {}) },
  })
  const contentType = response.headers.get('content-type') || ''
  let body
  if (contentType.includes('application/json')) {
    try { body = await response.json() } catch { body = {} }
  } else {
    body = { message: await response.text() }
  }
  if (!response.ok) {
    const error = new PortalAPIError(body?.message || `HTTP ${response.status}`, { status: response.status, code: body?.code, requestID: body?.request_id, details: body?.details })
    attachStructuredContext(error, {
      ...requestContext,
      requestId: body?.request_id || '',
      traceId: body?.trace_id || body?.traceId || '',
      metadata: { source: 'portal_api' },
    }, {
      status: response.status,
      code: body?.code,
      requestId: body?.request_id || '',
      traceId: body?.trace_id || body?.traceId || '',
    })
    if (shouldStartSubsystemLogin(error)) beginLogin()
    throw error
  }
  return body?.data ?? body
}
/**
 * query 将非空参数编码为带问号的 URL 查询串。
 * @param {Record<string, unknown>} [params={}] 待编码参数；空字符串、null 和 undefined 会被忽略。
 * @returns {string} 查询串；没有有效参数时返回空字符串。
 */
function query(params = {}) {
  const value = new URLSearchParams(Object.entries(params).filter(([, item]) => item !== '' && item !== null && item !== undefined)).toString()
  return value ? `?${value}` : ''
}
/**
 * key 生成写操作幂等键；优先使用浏览器安全随机 UUID。
 * @returns {string} 当前页面进程内新生成的幂等键。
 */
function key() { return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}` }

/**
 * projectSnapshot 将历史 Go 默认字段名和当前 JSON 标签统一为视图使用的小写字段。
 * @param {Record<string, unknown>} [value={}] 原始项目快照。
 * @returns {Record<string, unknown>} 保留原字段并补齐规范字段的项目快照。
 */
function projectSnapshot(value = {}) {
  return {
    ...value,
    project_id: value.project_id ?? value.ProjectID,
    project_name: value.project_name ?? value.ProjectName,
    contract_no: value.contract_no ?? value.ContractNo,
    status: value.status ?? value.Status,
    progress_pct: value.progress_pct ?? value.ProgressPct,
    current_stage: value.current_stage ?? value.CurrentStage,
    expected_end_date: value.expected_end_date ?? value.ExpectedEndDate,
    delayed: value.delayed ?? value.Delayed,
    manager_name: value.manager_name ?? value.ManagerName,
    manager_contact_masked: value.manager_contact_masked ?? value.ManagerContactMasked,
    manager_message_available: value.manager_message_available ?? value.ManagerMessageAvailable ?? false,
    source_updated_at: value.source_updated_at ?? value.SourceUpdatedAt,
    synced_at: value.synced_at ?? value.SyncedAt,
  }
}
/**
 * projectChild 规范化项目里程碑或动态记录的兼容字段。
 * @param {Record<string, unknown>} [value={}] 原始项目子记录。
 * @returns {Record<string, unknown>} 规范化后的项目子记录。
 */
function projectChild(value = {}) {
  return {
    ...value,
    id: value.id ?? value.ID,
    stage_code: value.stage_code ?? value.StageCode,
    stage_name: value.stage_name ?? value.StageName,
    status: value.status ?? value.Status,
    planned_at: value.planned_at ?? value.PlannedAt,
    completed_at: value.completed_at ?? value.CompletedAt,
    sort_no: value.sort_no ?? value.SortNo,
    type: value.type ?? value.Type,
    content: value.content ?? value.Content,
    occurred_at: value.occurred_at ?? value.OccurredAt,
  }
}
/**
 * projectTeamMember 规范化项目团队成员的姓名、角色和脱敏联系方式字段。
 * @param {Record<string, unknown>} [value={}] 原始团队成员记录。
 * @returns {Record<string, unknown>} 规范化后的团队成员记录。
 */
function projectTeamMember(value = {}) {
  return {
    ...value,
    name: value.name ?? value.Name,
    role: value.role ?? value.Role,
    contact_masked: value.contact_masked ?? value.ContactMasked,
  }
}
/**
 * reportRequest 规范化报告申请的历史字段名与当前 JSON 字段。
 * @param {Record<string, unknown>} [value={}] 原始报告申请。
 * @returns {Record<string, unknown>} 规范化后的报告申请。
 */
function reportRequest(value = {}) {
  return {
    ...value,
    request_no: value.request_no ?? value.RequestNo,
    project_id: value.project_id ?? value.ProjectID,
    report_type: value.report_type ?? value.ReportType,
    reason: value.reason ?? value.Reason,
    status: value.status ?? value.Status,
    approval_result: value.approval_result ?? value.ApprovalResult,
    submitted_at: value.submitted_at ?? value.SubmittedAt,
    approved_at: value.approved_at ?? value.ApprovedAt,
    issued_at: value.issued_at ?? value.IssuedAt,
    version: value.version ?? value.Version,
  }
}
/**
 * reportStatusEvent 规范化报告申请状态事件的兼容字段。
 * @param {Record<string, unknown>} [value={}] 原始状态事件。
 * @returns {Record<string, unknown>} 规范化后的状态事件。
 */
function reportStatusEvent(value = {}) {
  return {
    event_type: value.event_type ?? value.EventType,
    sequence: value.sequence ?? value.Sequence,
    from_status: value.from_status ?? value.FromStatus,
    to_status: value.to_status ?? value.ToStatus,
    occurred_at: value.occurred_at ?? value.OccurredAt,
  }
}

/**
 * normalizeReportRequestPayload 按后端摘要字段清理报告申请，避免空白或邮箱大小写改变幂等语义。
 * @param {Record<string, unknown>} [value={}] 报告申请输入。
 * @returns {{project_id: string, report_type: string, reason: string, receive_email: string}} 规范化后的提交载荷。
 */
export function normalizeReportRequestPayload(value = {}) {
  return {
    project_id: String(value.project_id || '').trim(),
    report_type: String(value.report_type || '').trim(),
    reason: String(value.reason || '').trim(),
    receive_email: String(value.receive_email || '').trim().toLowerCase(),
  }
}

/**
 * reportRequestFingerprint 为规范化后的报告申请生成稳定指纹。
 * @param {Record<string, unknown>} [value={}] 报告申请输入。
 * @returns {string} 可用于比较重复提交的 JSON 指纹。
 */
export function reportRequestFingerprint(value = {}) {
  return JSON.stringify(normalizeReportRequestPayload(value))
}

/**
 * createIdempotencyKey 生成供门户写操作使用的幂等键。
 * @returns {string} 新生成的幂等键。
 */
export function createIdempotencyKey() { return key() }

/**
 * getPortalSession 读取并规范化客户门户会话，并合并并发读取请求。
 * @param {{force?: boolean}} [options={}] force 为 true 时忽略会话缓存和在途请求。
 * @returns {Promise<Record<string, unknown>>} 规范化后的门户会话。
 * @throws {PortalAPIError} 会话失效或服务端返回非成功状态时抛出。
 * @throws {TypeError} 网络连接失败时抛出。
 */
export function getPortalSession({ force = false } = {}) {
  // 合并并发会话读取；缓存仅驱动界面，所有业务权限仍由 HttpOnly Cookie 和后端判定。
  if (!force && session) return Promise.resolve(session)
  if (!force && sessionRequest) return sessionRequest
  sessionRequest = request('/auth/me').then((value) => { session = normalizeAuthorizationSession(value); return session }).finally(() => { sessionRequest = null })
  return sessionRequest
}
/**
 * capability 将单项运行时能力规范为明确的可用状态、模式和原因代码。
 * @param {Record<string, unknown>} [value={}] 原始能力数据。
 * @returns {{available: boolean, mode: string, reason_code: string}} 规范化后的能力状态。
 */
function capability(value = {}) {
  return {
    available: value.available === true,
    mode: String(value.mode || 'UNAVAILABLE'),
    reason_code: String(value.reason_code || ''),
  }
}
/**
 * customerCapabilities 规范化客户级功能开关；缺失字段按兼容策略视为启用。
 * @param {Record<string, unknown>} [value={}] 原始客户功能配置。
 * @returns {{project_enabled: boolean, report_enabled: boolean, filing_enabled: boolean, feedback_enabled: boolean, evaluation_enabled: boolean}} 客户功能开关。
 */
function customerCapabilities(value = {}) {
  return {
    project_enabled: value?.project_enabled !== false,
    report_enabled: value?.report_enabled !== false,
    filing_enabled: value?.filing_enabled !== false,
    feedback_enabled: value?.feedback_enabled !== false,
    evaluation_enabled: value?.evaluation_enabled !== false,
  }
}
/**
 * getPortalCapabilities 获取并规范化客户门户的集成能力与客户级功能开关。
 * @returns {Promise<Record<string, unknown>>} 规范化后的门户能力集合。
 * @throws {PortalAPIError} 会话失效或服务端返回非成功状态时抛出。
 * @throws {TypeError} 网络连接失败时抛出。
 */
export async function getPortalCapabilities() {
  const value = await request('/capabilities')
  return {
    report_request_submission: capability(value?.report_request_submission),
    project_export: capability(value?.project_export),
    report_download: capability(value?.report_download),
    filing_material_upload: capability(value?.filing_material_upload),
    filing_export: capability(value?.filing_export),
    filing_police_submission: capability(value?.filing_police_submission),
    customer: customerCapabilities(value?.customer),
  }
}
/**
 * ensurePortalSession 强制刷新门户会话；已触发登录跳转时将认证错误转换为 null。
 * @returns {Promise<Record<string, unknown>|null>} 有效门户会话；需重新登录时返回 null。
 * @throws {Error} 非登录类错误、网络失败或服务端异常时抛出。
 */
export function ensurePortalSession() { return getPortalSession({ force: true }).catch((error) => shouldStartSubsystemLogin(error) ? null : Promise.reject(error)) }

/**
 * logoutPortal 请求注销门户会话，并无论网络结果如何都返回门户入口页。
 * @returns {Promise<void>}
 */
export async function logoutPortal() {
  session = null
  // 先撤销基础平台共享会话，再撤销门户会话；这样即使两个请求都被记录，
  // 门户注销仍是用户可观察到的最终边界，且任一请求失败都不会阻断另一请求。
  try {
    await logoutCurrentSession()
  } catch (error) {
    attachStructuredContext(error, {
      subsystem: 'customer_portal',
      feature: 'portal_auth',
      operation: 'POST',
      path: '/auth/logout',
      method: 'POST',
      metadata: { source: 'platform_logout_before_portal_logout' },
    }, {
      status: error?.status || 0,
      code: error?.code || 'PLATFORM_LOGOUT_ERROR',
      requestId: error?.requestId || '',
      traceId: error?.traceId || '',
    })
  }

  try {
    await fetch(`${PUBLIC_PATH_PREFIX}/auth/logout`, {
      method: 'POST',
      credentials: 'include',
      headers: { Accept: 'application/json', 'X-CSRF-Token': '1' },
    })
  } catch {
    // 网络失败只记录结构化上下文；页面仍需跳转以清理前端会话状态。
    attachStructuredContext(new PortalAPIError('本地登出请求失败，但会话仍可继续回收。', { status: 0, code: 'PORTAL_LOGOUT_NETWORK_ERROR' }), {
      subsystem: 'customer_portal',
      feature: 'portal_auth',
      operation: 'POST',
      path: `${PUBLIC_PATH_PREFIX}/auth/logout`,
      method: 'POST',
      metadata: { source: 'portal_logout' },
    }, {
      status: 0,
      code: 'PORTAL_LOGOUT_NETWORK_ERROR',
      requestId: '',
      traceId: '',
    })
  }

  window.location.assign(`${PUBLIC_PATH_PREFIX}/`)
}
/**
 * listProjects 获取客户可见项目分页结果，并规范化每个项目快照。
 * @param {Record<string, unknown>} [params={}] 项目筛选与分页参数。
 * @returns {Promise<Record<string, unknown>>} 保留分页字段且 items 已规范化的项目结果。
 * @throws {Error} 会话失效、网络失败或服务端返回非成功状态时抛出。
 */
export const listProjects = async (params) => {
  const value = await request(`/projects${query(params)}`)
  return { ...value, items: (value?.items || []).map(projectSnapshot) }
}
/**
 * getProject 获取项目详情，并统一快照、里程碑、动态和团队成员字段。
 * @param {string|number} id 项目标识。
 * @returns {Promise<{snapshot: Record<string, unknown>, milestones: Array<unknown>, activities: Array<unknown>, team: Array<unknown>}>} 规范化后的项目详情。
 * @throws {Error} 网络失败、请求被取消或服务端返回非成功状态时抛出。
 */
export const getProject = async (id) => {
  const value = await request(`/projects/${encodeURIComponent(id)}`)
  return {
    snapshot: projectSnapshot(value?.snapshot ?? value?.Snapshot),
    milestones: (value?.milestones ?? value?.Milestones ?? []).map(projectChild),
    activities: (value?.activities ?? value?.Activities ?? []).map(projectChild),
    team: (value?.team ?? value?.Team ?? []).map(projectTeamMember),
  }
}
/**
 * listProjectActivities 获取指定项目动态，并规范化分页结果中的记录字段。
 * @param {string|number} id 项目标识。
 * @param {Record<string, unknown>} [params={}] 动态筛选与分页参数。
 * @returns {Promise<Record<string, unknown>>} 保留分页字段且 items 已规范化的动态结果。
 * @throws {Error} 网络失败、请求被取消或服务端返回非成功状态时抛出。
 */
export const listProjectActivities = async (id, params) => {
  const value = await request(`/projects/${encodeURIComponent(id)}/activities${query(params)}`)
  return { ...value, items: (value?.items || []).map(projectChild) }
}
/**
 * createProjectExport 创建项目导出任务。
 * @param {string|number} projectId 项目标识。
 * @param {string} [idempotencyKey] 幂等键；未提供时自动生成。
 * @param {{signal?: AbortSignal}} [options={}] 请求取消配置。
 * @returns {Promise<unknown>} 新建或复用的项目导出任务。
 * @throws {Error} 网络失败、请求被取消或服务端返回非成功状态时抛出。
 */
export const createProjectExport = (projectId, idempotencyKey = key(), { signal } = {}) => request(`/projects/${encodeURIComponent(projectId)}/exports`, { method: 'POST', signal, headers: { 'Idempotency-Key': idempotencyKey } })

/**
 * getProjectExport 获取项目导出任务状态。
 * @param {string|number} id 导出任务标识。
 * @param {{signal?: AbortSignal}} [options={}] 请求取消配置。
 * @returns {Promise<unknown>} 项目导出任务状态。
 * @throws {Error} 网络失败、请求被取消或服务端返回非成功状态时抛出。
 */
export const getProjectExport = (id, { signal } = {}) => request(`/project-exports/${encodeURIComponent(id)}`, { signal })

/**
 * createProjectConversation 为指定项目创建或取得客户沟通会话。
 * @param {string|number} projectId 项目标识。
 * @param {string} [idempotencyKey] 幂等键；未提供时自动生成。
 * @returns {Promise<unknown>} 项目沟通会话。
 * @throws {Error} 网络失败或服务端返回非成功状态时抛出。
 */
export const createProjectConversation = (projectId, idempotencyKey = key()) => request(`/projects/${encodeURIComponent(projectId)}/conversation`, { method: 'POST', headers: { 'Idempotency-Key': idempotencyKey } })

/**
 * getProjectConversation 获取指定项目的沟通会话及消息分页。
 * @param {string|number} projectId 项目标识。
 * @param {Record<string, unknown>} [params={}] 消息游标与分页参数。
 * @returns {Promise<unknown>} 项目沟通会话及消息数据。
 * @throws {Error} 网络失败或服务端返回非成功状态时抛出。
 */
export const getProjectConversation = (projectId, params = {}) => request(`/projects/${encodeURIComponent(projectId)}/conversation${query(params)}`)

/**
 * sendProjectConversationMessage 向项目沟通会话发送消息。
 * @param {string|number} conversationId 沟通会话标识。
 * @param {string} content 消息正文。
 * @param {string} [idempotencyKey] 幂等键；未提供时自动生成。
 * @returns {Promise<unknown>} 已创建的消息。
 * @throws {Error} 网络失败或服务端返回非成功状态时抛出。
 */
export const sendProjectConversationMessage = (conversationId, content, idempotencyKey = key()) => request(`/project-conversations/${encodeURIComponent(conversationId)}/messages`, { method: 'POST', body: JSON.stringify({ content }), headers: { 'Idempotency-Key': idempotencyKey } })

/**
 * readProjectConversationMessages 按消息游标批量标记项目会话消息为已读。
 * @param {string|number} conversationId 沟通会话标识。
 * @param {Array<string|number>} messageCursors 待确认的消息游标。
 * @returns {Promise<unknown>} 已读状态更新结果。
 * @throws {Error} 网络失败或服务端返回非成功状态时抛出。
 */
export const readProjectConversationMessages = (conversationId, messageCursors) => request(`/project-conversations/${encodeURIComponent(conversationId)}/read`, { method: 'POST', body: JSON.stringify({ message_cursors: messageCursors }) })

/**
 * downloadProjectExport 领取短效下载授权并立即通过同源请求头下载项目 PDF。
 * @param {string|number} id 项目导出任务标识。
 * @param {{signal?: AbortSignal}} [options={}] 请求取消配置。
 * @returns {Promise<{blob: Blob, fileName: string}>} PDF 文件和安全文件名。
 * @throws {PortalAPIError} 授权缺失、网络不可达、响应失败或文件类型不是 PDF 时抛出。
 * @throws {DOMException} 请求被 AbortSignal 取消时可能抛出。
 */
export async function downloadProjectExport(id, { signal } = {}) {
  const exportID = encodeURIComponent(id)
  const grant = await request(`/project-exports/${exportID}/download-grants`, { method: 'POST', signal })
  const token = String(grant?.download_token || '')
  if (!token) {
    const error = new PortalAPIError('项目导出下载授权无效。', { status: 503, code: 'PORTAL_PROJECT_EXPORT_NOT_READY' })
    attachStructuredContext(error, {
      subsystem: 'customer_portal',
      feature: 'project_export',
      operation: 'POST',
      path: `/project-exports/${exportID}/downloads`,
      method: 'POST',
      metadata: { export_id: exportID, source: 'project_export' },
    }, { status: 503, code: 'PORTAL_PROJECT_EXPORT_NOT_READY' })
    throw error
  }
  const response = await fetch(`${API_BASE_URL}/project-exports/${exportID}/downloads`, {
    method: 'POST', credentials: 'include', signal,
    headers: { Accept: 'application/pdf, application/json', 'X-CSRF-Token': '1', 'X-Project-Export-Download-Token': token },
  }).catch((error) => {
    const downloadError = new PortalAPIError('下载项目导出失败：网络不可达。', { status: 0, code: 'PORTAL_PROJECT_EXPORT_NETWORK_ERROR' })
    attachStructuredContext(downloadError, {
      subsystem: 'customer_portal',
      feature: 'project_export',
      operation: 'POST',
      path: `/project-exports/${exportID}/downloads`,
      method: 'POST',
      metadata: {
        export_id: exportID,
        source: 'project_export',
        rawError: String(error || '').slice(0, 120),
      },
    }, {
      status: 0,
      code: 'PORTAL_PROJECT_EXPORT_NETWORK_ERROR',
      requestId: '',
      traceId: '',
    })
    throw downloadError
  })
  if (!response.ok) throw await reportDownloadError(response)
  const blob = await response.blob()
  if (blob.type && blob.type !== 'application/pdf') {
    const error = new PortalAPIError('项目导出文件类型无效。', { status: 503, code: 'PORTAL_PROJECT_EXPORT_INVALID_FILE' })
    attachStructuredContext(error, {
      subsystem: 'customer_portal',
      feature: 'project_export',
      operation: 'POST',
      path: `/project-exports/${exportID}/downloads`,
      method: 'POST',
      metadata: { export_id: exportID, source: 'project_export', response_type: blob.type },
    }, { status: 503, code: 'PORTAL_PROJECT_EXPORT_INVALID_FILE' })
    throw error
  }
  return { blob, fileName: safePDFFileName(response.headers.get('content-disposition')) }
}
/**
 * listReportRequests 获取报告申请分页结果，并规范化列表记录字段。
 * @param {Record<string, unknown>} [params={}] 报告状态、项目与分页参数。
 * @returns {Promise<Record<string, unknown>>} 保留分页字段且 items 已规范化的报告申请结果。
 * @throws {Error} 会话失效、网络失败或服务端返回非成功状态时抛出。
 */
export const listReportRequests = async (params) => {
  const value = await request(`/reports${query(params)}`)
  return { ...value, items: (value?.items || []).map(reportRequest) }
}
/**
 * getReportRequest 获取报告申请详情，并按事件序号升序返回状态轨迹。
 * @param {string|number} id 报告申请标识。
 * @returns {Promise<Record<string, unknown>>} 规范化后的报告申请及状态事件。
 * @throws {Error} 网络失败或服务端返回非成功状态时抛出。
 */
export const getReportRequest = async (id) => {
  const value = await request(`/reports/${encodeURIComponent(id)}`)
  return {
    ...reportRequest(value),
    events: (value?.events ?? value?.Events ?? []).map(reportStatusEvent).sort((left, right) => Number(left.sequence || 0) - Number(right.sequence || 0)),
  }
}
/**
 * createReportRequest 创建报告申请，并规范化提交载荷与响应字段。
 * @param {Record<string, unknown>} payload 报告申请内容。
 * @param {string} [idempotencyKey] 幂等键；未提供时自动生成。
 * @returns {Promise<Record<string, unknown>>} 新建或复用的报告申请。
 * @throws {Error} 网络失败或服务端返回非成功状态时抛出。
 */
export const createReportRequest = async (payload, idempotencyKey = key()) => reportRequest(await request('/reports', { method: 'POST', body: JSON.stringify(normalizeReportRequestPayload(payload)), headers: { 'Idempotency-Key': idempotencyKey } }))

/**
 * listReportNotifications 获取报告通知列表。
 * @param {Record<string, unknown>} [params={}] 通知状态与分页参数。
 * @returns {Promise<unknown>} 报告通知分页结果。
 * @throws {Error} 会话失效、网络失败或服务端返回非成功状态时抛出。
 */
export const listReportNotifications = (params) => request(`/report-notifications${query(params)}`)

/**
 * getReportNotificationUnreadCount 获取未读报告通知数量。
 * @returns {Promise<unknown>} 未读数量响应。
 * @throws {Error} 会话失效、网络失败或服务端返回非成功状态时抛出。
 */
export const getReportNotificationUnreadCount = () => request('/report-notifications/unread-count')
export const listFeedbackNotifications = (params = {}) => request(`/feedback-notifications?${new URLSearchParams(params).toString()}`)
export const getFeedbackNotificationUnreadCount = () => request('/feedback-notifications/unread-count')
export const readFeedbackNotification = (id) => request(`/feedback-notifications/${id}/read`, { method: 'POST', headers: { 'X-CSRF-Token': '1' } })

/**
 * readReportNotification 将指定报告通知标记为已读。
 * @param {string|number} id 通知标识。
 * @returns {Promise<unknown>} 已读状态更新结果。
 * @throws {Error} 网络失败或服务端返回非成功状态时抛出。
 */
export const readReportNotification = (id) => request(`/report-notifications/${encodeURIComponent(id)}/read`, { method: 'POST' })

/**
 * listReportRiskAlerts 获取报告风险预警列表。
 * @param {Record<string, unknown>} [params={}] 风险等级、状态与分页参数。
 * @returns {Promise<unknown>} 风险预警分页结果。
 * @throws {Error} 会话失效、网络失败或服务端返回非成功状态时抛出。
 */
export const listReportRiskAlerts = (params) => request(`/report-risk-alerts${query(params)}`)

/**
 * safePDFFileName 从 Content-Disposition 提取安全 PDF 文件名。
 * @param {string|null} disposition 响应文件名头。
 * @returns {string} 清除路径与控制字符后的 PDF 文件名；无效时返回 report.pdf。
 */
function safePDFFileName(disposition) {
  const matched = String(disposition || '').match(/filename\*?=(?:UTF-8''|\")?([^;\"]+)/i)
  let value = 'report.pdf'
  if (matched) {
    try { value = decodeURIComponent(matched[1].replace(/\"/g, '').trim()) }
    catch { value = 'report.pdf' }
  }
  value = value.replace(/[\\/\u0000-\u001f\u007f]/g, '_').trim().slice(0, 160)
  if (!value || value === '.' || value === '..' || value.startsWith('.') || !value.toLowerCase().endsWith('.pdf')) return 'report.pdf'
  return value
}

/**
 * reportDownloadError 将报告或项目下载失败响应转换为带结构化上下文的门户错误。
 * @param {Response} response 下载失败响应。
 * @returns {Promise<PortalAPIError>} 可由调用方抛出的门户错误。
 */
async function reportDownloadError(response) {
  const contentType = response.headers.get('content-type') || ''
  let body = {}
  if (contentType.toLowerCase().includes('application/json')) {
    try { body = await response.json() } catch { body = {} }
  }
  let responsePath = String(response?.url || '')
  if (responsePath) {
    try {
      const parsedUrl = new URL(responsePath, API_BASE_URL)
      responsePath = parsedUrl.pathname + (parsedUrl.search || '')
    } catch {
      responsePath = ''
    }
  }
  const error = new PortalAPIError(body?.message || `HTTP ${response.status}`, { status: response.status, code: body?.code, requestID: body?.request_id, details: body?.details })
  attachStructuredContext(error, {
    subsystem: 'customer_portal',
    feature: 'portal_report',
    operation: 'POST',
    path: responsePath,
    method: 'POST',
    requestId: body?.request_id || '',
    traceId: body?.trace_id || body?.traceId || '',
    metadata: { source: 'portal_report_download' },
  }, {
    status: response.status,
    code: body?.code,
    requestId: body?.request_id || '',
    traceId: body?.trace_id || body?.traceId || '',
  })
  if (shouldStartSubsystemLogin(error)) beginLogin()
  return error
}

/**
 * downloadIssuedReport 领取短效授权并立即通过同源请求头下载已签发报告 PDF。
 * @param {string|number} id 已签发报告标识。
 * @param {{idempotencyKey?: string, signal?: AbortSignal}} [options={}] 幂等键与请求取消配置。
 * @returns {Promise<{blob: Blob, filename: string, expires_at: unknown}>} PDF 文件、安全文件名和授权过期时间。
 * @throws {PortalAPIError} 授权缺失、网络不可达、响应失败或媒体类型不是 PDF 时抛出。
 * @throws {DOMException} 请求被 AbortSignal 取消时可能抛出。
 */
export async function downloadIssuedReport(id, { idempotencyKey = key(), signal } = {}) {
  const reportID = encodeURIComponent(id)
  const grant = await request(`/reports/${reportID}/download-grants`, {
    method: 'POST',
    signal,
    headers: { 'Idempotency-Key': idempotencyKey },
  })
  const downloadToken = String(grant?.download_token || '')
  if (!downloadToken) {
    const error = new PortalAPIError('下载授权响应无效。', { status: 503, code: 'PORTAL_REPORT_DOWNLOAD_UNAVAILABLE' })
    attachStructuredContext(error, {
      subsystem: 'customer_portal',
      feature: 'report_download',
      operation: 'POST',
      path: `/reports/${reportID}/download-grants`,
      method: 'POST',
      metadata: { report_id: reportID, source: 'report_download' },
    }, { status: 503, code: 'PORTAL_REPORT_DOWNLOAD_UNAVAILABLE' })
    throw error
  }

  const response = await fetch(`${API_BASE_URL}/reports/${reportID}/downloads`, {
    method: 'POST',
    credentials: 'include',
    signal,
    headers: {
      Accept: 'application/pdf, application/json',
      'X-CSRF-Token': '1',
      'X-Report-Download-Token': downloadToken,
    },
  }).catch((error) => {
    const downloadError = new PortalAPIError('下载项目报表失败：网络不可达。', { status: 0, code: 'PORTAL_REPORT_DOWNLOAD_NETWORK_ERROR' })
    attachStructuredContext(downloadError, {
      subsystem: 'customer_portal',
      feature: 'report_download',
      operation: 'POST',
      path: `/reports/${reportID}/downloads`,
      method: 'POST',
      metadata: {
        report_id: reportID,
        source: 'report_download',
        rawError: String(error || '').slice(0, 120),
      },
    }, {
      status: 0,
      code: 'PORTAL_REPORT_DOWNLOAD_NETWORK_ERROR',
      requestId: '',
      traceId: '',
    })
    throw downloadError
  })
  if (!response.ok) throw await reportDownloadError(response)
  const contentType = (response.headers.get('content-type') || '').split(';', 1)[0].trim().toLowerCase()
  if (contentType !== 'application/pdf') {
    const error = new PortalAPIError('下载响应不是受支持的 PDF 文件。', { status: response.status, code: 'PORTAL_REPORT_DOWNLOAD_CONTENT_TYPE_INVALID' })
    attachStructuredContext(error, {
      subsystem: 'customer_portal',
      feature: 'report_download',
      operation: 'POST',
      path: `/reports/${reportID}/downloads`,
      method: 'POST',
      metadata: { report_id: reportID, source: 'report_download', contentType },
    }, { status: response.status, code: 'PORTAL_REPORT_DOWNLOAD_CONTENT_TYPE_INVALID' })
    throw error
  }
  return {
    blob: await response.blob(),
    filename: safePDFFileName(response.headers.get('content-disposition')),
    expires_at: grant?.expires_at,
  }
}
/**
 * getAccountSecurity 获取当前客户账号的安全概览。
 * @returns {Promise<unknown>} 账号安全状态与安全事件摘要。
 * @throws {Error} 会话失效、网络失败或服务端返回非成功状态时抛出。
 */
export const getAccountSecurity = () => request('/account/security')

/**
 * listAccountSessions 获取当前客户账号的活动会话。
 * @returns {Promise<unknown>} 活动会话列表。
 * @throws {Error} 会话失效、网络失败或服务端返回非成功状态时抛出。
 */
export const listAccountSessions = () => request('/account/sessions')

/**
 * revokeAccountSession 撤销指定客户账号会话。
 * @param {string|number} id 会话标识。
 * @returns {Promise<unknown>} 会话撤销结果。
 * @throws {Error} 网络失败或服务端返回非成功状态时抛出。
 */
export const revokeAccountSession = (id) => request(`/account/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' })

/**
 * acknowledgeSecurityEvent 确认指定账号安全事件。
 * @param {string|number} id 安全事件标识。
 * @returns {Promise<unknown>} 安全事件确认结果。
 * @throws {Error} 网络失败或服务端返回非成功状态时抛出。
 */
export const acknowledgeSecurityEvent = (id) => request(`/account/security-events/${encodeURIComponent(id)}/ack`, { method: 'POST' })

/**
 * listFeedbacks 获取客户反馈列表。
 * @param {Record<string, unknown>} [params={}] 状态、类型与分页参数。
 * @returns {Promise<unknown>} 客户反馈分页结果。
 * @throws {Error} 会话失效、网络失败或服务端返回非成功状态时抛出。
 */
export const listFeedbacks = (params) => request(`/feedbacks${query(params)}`)

/**
 * getFeedback 获取指定客户反馈详情。
 * @param {string|number} id 反馈标识。
 * @returns {Promise<unknown>} 反馈详情与沟通记录。
 * @throws {Error} 网络失败或服务端返回非成功状态时抛出。
 */
export const getFeedback = (id) => request(`/feedbacks/${encodeURIComponent(id)}`)

/**
 * createFeedback 创建客户反馈，并自动附加幂等键。
 * @param {Record<string, unknown>} payload 反馈分类、标题与正文。
 * @returns {Promise<unknown>} 新建或复用的反馈记录。
 * @throws {Error} 网络失败或服务端返回非成功状态时抛出。
 */
export const createFeedback = (payload) => request('/feedbacks', { method: 'POST', body: JSON.stringify(payload), headers: { 'Idempotency-Key': key() } })

/**
 * addFeedbackMessage 向指定反馈追加客户消息，并自动附加幂等键。
 * @param {string|number} id 反馈标识。
 * @param {string} content 消息正文。
 * @returns {Promise<unknown>} 新增消息。
 * @throws {Error} 网络失败或服务端返回非成功状态时抛出。
 */
export const addFeedbackMessage = (id, content) => request(`/feedbacks/${encodeURIComponent(id)}/messages`, { method: 'POST', body: JSON.stringify({ content }), headers: { 'Idempotency-Key': key() } })

/**
 * closeFeedback 关闭指定客户反馈。
 * @param {string|number} id 反馈标识。
 * @param {string} idempotencyKey 调用方生成的幂等键。
 * @returns {Promise<unknown>} 关闭后的反馈记录。
 * @throws {Error} 网络失败或服务端返回非成功状态时抛出。
 */
export const closeFeedback = (id, idempotencyKey) => request(`/feedbacks/${encodeURIComponent(id)}/close`, { method: 'POST', body: JSON.stringify({}), headers: { 'Idempotency-Key': idempotencyKey } })

/**
 * getEvaluationEligibility 获取指定项目的客户评价资格。
 * @param {string|number} projectId 项目标识。
 * @returns {Promise<unknown>} 评价资格与不可评价原因。
 * @throws {Error} 网络失败或服务端返回非成功状态时抛出。
 */
export const getEvaluationEligibility = (projectId) => request(`/projects/${encodeURIComponent(projectId)}/evaluation-eligibility`)

/**
 * getEvaluation 获取指定客户评价详情。
 * @param {string|number} id 评价标识。
 * @returns {Promise<unknown>} 客户评价详情。
 * @throws {Error} 网络失败或服务端返回非成功状态时抛出。
 */
export const getEvaluation = (id) => request(`/evaluations/${encodeURIComponent(id)}`)

/**
 * submitEvaluation 提交客户项目评价，并自动附加幂等键。
 * @param {Record<string, unknown>} payload 项目标识、评分与评价内容。
 * @returns {Promise<unknown>} 新建或复用的评价记录。
 * @throws {Error} 网络失败或服务端返回非成功状态时抛出。
 */
export const submitEvaluation = (payload) => request('/evaluations', { method: 'POST', body: JSON.stringify(payload), headers: { 'Idempotency-Key': key() } })

/**
 * listFilings 获取客户备案列表。
 * @param {Record<string, unknown>} [params={}] 备案状态、项目与分页参数。
 * @returns {Promise<unknown>} 备案分页结果。
 * @throws {Error} 会话失效、网络失败或服务端返回非成功状态时抛出。
 */
export const listFilings = (params) => request(`/filings${query(params)}`)

/**
 * createFiling 创建客户备案草稿。
 * @param {Record<string, unknown>} payload 备案基础信息。
 * @param {string} [idempotencyKey] 幂等键；未提供时自动生成。
 * @returns {Promise<unknown>} 新建或复用的备案草稿。
 * @throws {Error} 网络失败或服务端返回非成功状态时抛出。
 */
export const createFiling = (payload, idempotencyKey = key()) => request('/filings', { method: 'POST', body: JSON.stringify(payload), headers: { 'Idempotency-Key': idempotencyKey } })

/**
 * getFiling 获取指定备案详情。
 * @param {string|number} id 备案标识。
 * @returns {Promise<unknown>} 备案详情、分区与材料信息。
 * @throws {Error} 网络失败或服务端返回非成功状态时抛出。
 */
export const getFiling = (id) => request(`/filings/${encodeURIComponent(id)}`)

/**
 * saveFilingSection 保存备案的指定表单分区。
 * @param {string|number} id 备案标识。
 * @param {string} code 分区代码。
 * @param {Record<string, unknown>} payload 分区表单数据及版本信息。
 * @param {string} [idempotencyKey] 幂等键；未提供时自动生成。
 * @returns {Promise<unknown>} 更新后的备案分区。
 * @throws {Error} 网络失败或服务端返回非成功状态时抛出。
 */
export const saveFilingSection = (id, code, payload, idempotencyKey = key()) => request(`/filings/${encodeURIComponent(id)}/sections/${encodeURIComponent(code)}`, { method: 'PUT', body: JSON.stringify(payload), headers: { 'Idempotency-Key': idempotencyKey } })

/**
 * saveFilingMatrix 保存备案的指定矩阵数据。
 * @param {string|number} id 备案标识。
 * @param {string} code 矩阵代码。
 * @param {Record<string, unknown>} payload 矩阵数据及版本信息。
 * @param {string} [idempotencyKey] 幂等键；未提供时自动生成。
 * @returns {Promise<unknown>} 更新后的备案矩阵。
 * @throws {Error} 网络失败或服务端返回非成功状态时抛出。
 */
export const saveFilingMatrix = (id, code, payload, idempotencyKey = key()) => request(`/filings/${encodeURIComponent(id)}/matrix/${encodeURIComponent(code)}`, { method: 'PUT', body: JSON.stringify(payload), headers: { 'Idempotency-Key': idempotencyKey } })

/**
 * validateFiling 校验指定备案的完整性与业务规则。
 * @param {string|number} id 备案标识。
 * @returns {Promise<unknown>} 校验结果与问题列表。
 * @throws {Error} 网络失败或服务端返回非成功状态时抛出。
 */
export const validateFiling = (id) => request(`/filings/${encodeURIComponent(id)}/validate`, { method: 'POST', body: JSON.stringify({}) })

/**
 * submitFiling 提交指定备案进入后续流程。
 * @param {string|number} id 备案标识。
 * @param {Record<string, unknown>} payload 提交确认及版本信息。
 * @param {string} [idempotencyKey] 幂等键；未提供时自动生成。
 * @returns {Promise<unknown>} 提交后的备案状态。
 * @throws {Error} 网络失败或服务端返回非成功状态时抛出。
 */
export const submitFiling = (id, payload, idempotencyKey = key()) => request(`/filings/${encodeURIComponent(id)}/submit`, { method: 'POST', body: JSON.stringify(payload), headers: { 'Idempotency-Key': idempotencyKey } })

/**
 * deleteFiling 删除指定备案草稿。
 * @param {string|number} id 备案标识。
 * @returns {Promise<unknown>} 服务端删除结果。
 * @throws {Error} 网络失败或服务端返回非成功状态时抛出。
 */
export const deleteFiling = (id) => request(`/filings/${encodeURIComponent(id)}`, { method: 'DELETE' })

/**
 * createFilingMaterialUpload 创建备案材料上传任务。
 * @param {string|number} id 备案标识。
 * @param {Record<string, unknown>} payload 文件名、媒体类型与大小等上传元数据。
 * @param {string} [idempotencyKey] 幂等键；未提供时自动生成。
 * @returns {Promise<unknown>} 材料上传任务与上传凭据。
 * @throws {Error} 网络失败或服务端返回非成功状态时抛出。
 */
export const createFilingMaterialUpload = (id, payload, idempotencyKey = key()) => request(`/filings/${encodeURIComponent(id)}/material-uploads`, { method: 'POST', body: JSON.stringify(payload), headers: { 'Idempotency-Key': idempotencyKey } })

/**
 * completeFilingMaterialUpload 确认备案材料上传完成并校验期望版本。
 * @param {string|number} id 备案标识。
 * @param {string|number} materialId 材料标识。
 * @param {string|number} expectedVersion 期望备案版本，用于阻止并发覆盖。
 * @returns {Promise<unknown>} 已完成的材料记录。
 * @throws {Error} 网络失败或服务端返回非成功状态时抛出。
 */
export const completeFilingMaterialUpload = (id, materialId, expectedVersion) => request(`/filings/${encodeURIComponent(id)}/materials/${encodeURIComponent(materialId)}/complete`, { method: 'POST', body: JSON.stringify({ expected_version: expectedVersion }) })
