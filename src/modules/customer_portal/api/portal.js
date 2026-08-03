const PUBLIC_PATH_PREFIX = (import.meta.env?.VITE_CUSTOMER_PORTAL_PUBLIC_PATH_PREFIX || '/customer-portal').replace(/\/$/, '')
const API_BASE_URL = (import.meta.env?.VITE_CUSTOMER_PORTAL_API_BASE_URL || `${PUBLIC_PATH_PREFIX}/api/v1`).replace(/\/$/, '')
let session = null
let sessionRequest = null
let redirectStarted = false

export class PortalAPIError extends Error {
  constructor(message, { status = 0, code = '', details = null } = {}) {
    super(message); this.name = 'PortalAPIError'; this.status = status; this.code = code; this.details = details
  }
}
function beginLogin() {
  // 门户页面常并发加载项目、通知和能力状态；401 只允许触发一次跳转，并保留
  // 当前相对路径作为回跳目标，避免每个失败请求互相覆盖导航。
  if (redirectStarted) return
  redirectStarted = true
  session = null
  const returnPath = `${window.location.pathname}${window.location.search}${window.location.hash}`
  window.location.replace(`${PUBLIC_PATH_PREFIX}/auth/login?return_to=${encodeURIComponent(returnPath)}`)
}
async function request(path, options = {}) {
  const method = (options.method || 'GET').toUpperCase()
  const requiresCSRF = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)
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
    if (response.status === 401) beginLogin()
    throw new PortalAPIError(body?.message || `HTTP ${response.status}`, { status: response.status, code: body?.code, details: body?.details })
  }
  return body?.data ?? body
}
function query(params = {}) {
  const value = new URLSearchParams(Object.entries(params).filter(([, item]) => item !== '' && item !== null && item !== undefined)).toString()
  return value ? `?${value}` : ''
}
function key() { return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}` }
// Portal 同时兼容历史 Go 默认字段名与当前 JSON 标签。只在适配层消化差异，
// 视图始终读取统一的小写字段，便于后端滚动升级而不污染页面逻辑。
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
function projectTeamMember(value = {}) {
  return {
    ...value,
    name: value.name ?? value.Name,
    role: value.role ?? value.Role,
    contact_masked: value.contact_masked ?? value.ContactMasked,
  }
}
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
 * 按后端报告申请摘要覆盖的字段规范化载荷。邮箱大小写和首尾空白不应产生新的
 * 业务命令，否则网络重试可能绕开幂等结果并重复提交申请。
 */
export function normalizeReportRequestPayload(value = {}) {
  return {
    project_id: String(value.project_id || '').trim(),
    report_type: String(value.report_type || '').trim(),
    reason: String(value.reason || '').trim(),
    receive_email: String(value.receive_email || '').trim().toLowerCase(),
  }
}

export function reportRequestFingerprint(value = {}) {
  return JSON.stringify(normalizeReportRequestPayload(value))
}

export function createIdempotencyKey() { return key() }

export function getPortalSession({ force = false } = {}) {
  // 合并并发会话读取；缓存仅驱动界面，所有业务权限仍由 HttpOnly Cookie 和后端判定。
  if (!force && session) return Promise.resolve(session)
  if (!force && sessionRequest) return sessionRequest
  sessionRequest = request('/auth/me').then((value) => { session = value; return value }).finally(() => { sessionRequest = null })
  return sessionRequest
}
function capability(value = {}) {
  return {
    available: value.available === true,
    mode: String(value.mode || 'UNAVAILABLE'),
    reason_code: String(value.reason_code || ''),
  }
}
export async function getPortalCapabilities() {
  const value = await request('/capabilities')
  return {
    report_request_submission: capability(value?.report_request_submission),
    project_export: capability(value?.project_export),
    report_download: capability(value?.report_download),
    filing_material_upload: capability(value?.filing_material_upload),
    filing_export: capability(value?.filing_export),
    filing_police_submission: capability(value?.filing_police_submission),
  }
}
export function ensurePortalSession() { return getPortalSession({ force: true }).catch((error) => error?.status === 401 ? null : Promise.reject(error)) }
export async function logoutPortal() {
  session = null
  try {
    await fetch(`${PUBLIC_PATH_PREFIX}/auth/logout`, {
      method: 'POST',
      credentials: 'include',
      headers: { Accept: 'application/json', 'X-CSRF-Token': '1' },
    })
  } finally {
    window.location.assign(`${PUBLIC_PATH_PREFIX}/`)
  }
}
export const listProjects = async (params) => {
  const value = await request(`/projects${query(params)}`)
  return { ...value, items: (value?.items || []).map(projectSnapshot) }
}
export const getProject = async (id) => {
  const value = await request(`/projects/${encodeURIComponent(id)}`)
  return {
    snapshot: projectSnapshot(value?.snapshot ?? value?.Snapshot),
    milestones: (value?.milestones ?? value?.Milestones ?? []).map(projectChild),
    activities: (value?.activities ?? value?.Activities ?? []).map(projectChild),
    team: (value?.team ?? value?.Team ?? []).map(projectTeamMember),
  }
}
export const listProjectActivities = async (id, params) => {
  const value = await request(`/projects/${encodeURIComponent(id)}/activities${query(params)}`)
  return { ...value, items: (value?.items || []).map(projectChild) }
}
export const createProjectExport = (projectId, idempotencyKey = key(), { signal } = {}) => request(`/projects/${encodeURIComponent(projectId)}/exports`, { method: 'POST', signal, headers: { 'Idempotency-Key': idempotencyKey } })
export const getProjectExport = (id, { signal } = {}) => request(`/project-exports/${encodeURIComponent(id)}`, { signal })
export const createProjectConversation = (projectId, idempotencyKey = key()) => request(`/projects/${encodeURIComponent(projectId)}/conversation`, { method: 'POST', headers: { 'Idempotency-Key': idempotencyKey } })
export const getProjectConversation = (projectId, params = {}) => request(`/projects/${encodeURIComponent(projectId)}/conversation${query(params)}`)
export const sendProjectConversationMessage = (conversationId, content, idempotencyKey = key()) => request(`/project-conversations/${encodeURIComponent(conversationId)}/messages`, { method: 'POST', body: JSON.stringify({ content }), headers: { 'Idempotency-Key': idempotencyKey } })
export const readProjectConversationMessages = (conversationId, messageCursors) => request(`/project-conversations/${encodeURIComponent(conversationId)}/read`, { method: 'POST', body: JSON.stringify({ message_cursors: messageCursors }) })

/**
 * 先领取 15 分钟短效下载授权，再通过同源请求头立即消费。明文授权不进入 URL、
 * 请求体或浏览器存储，减少历史记录、代理日志和前端状态泄露面。
 */
export async function downloadProjectExport(id, { signal } = {}) {
  const exportID = encodeURIComponent(id)
  const grant = await request(`/project-exports/${exportID}/download-grants`, { method: 'POST', signal })
  const token = String(grant?.download_token || '')
  if (!token) throw new PortalAPIError('项目导出下载授权无效。', { status: 503, code: 'PORTAL_PROJECT_EXPORT_NOT_READY' })
  const response = await fetch(`${API_BASE_URL}/project-exports/${exportID}/downloads`, {
    method: 'POST', credentials: 'include', signal,
    headers: { Accept: 'application/pdf, application/json', 'X-CSRF-Token': '1', 'X-Project-Export-Download-Token': token },
  })
  if (!response.ok) throw await reportDownloadError(response)
  const blob = await response.blob()
  if (blob.type && blob.type !== 'application/pdf') throw new PortalAPIError('项目导出文件类型无效。', { status: 503, code: 'PORTAL_PROJECT_EXPORT_INVALID_FILE' })
  return { blob, fileName: safePDFFileName(response.headers.get('content-disposition')) }
}
export const listReportRequests = async (params) => {
  const value = await request(`/reports${query(params)}`)
  return { ...value, items: (value?.items || []).map(reportRequest) }
}
export const getReportRequest = async (id) => {
  const value = await request(`/reports/${encodeURIComponent(id)}`)
  return {
    ...reportRequest(value),
    events: (value?.events ?? value?.Events ?? []).map(reportStatusEvent).sort((left, right) => Number(left.sequence || 0) - Number(right.sequence || 0)),
  }
}
export const createReportRequest = async (payload, idempotencyKey = key()) => reportRequest(await request('/reports', { method: 'POST', body: JSON.stringify(normalizeReportRequestPayload(payload)), headers: { 'Idempotency-Key': idempotencyKey } }))
export const listReportNotifications = (params) => request(`/report-notifications${query(params)}`)
export const getReportNotificationUnreadCount = () => request('/report-notifications/unread-count')
export const readReportNotification = (id) => request(`/report-notifications/${encodeURIComponent(id)}/read`, { method: 'POST' })
export const listReportRiskAlerts = (params) => request(`/report-risk-alerts${query(params)}`)

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

async function reportDownloadError(response) {
  const contentType = response.headers.get('content-type') || ''
  let body = {}
  if (contentType.toLowerCase().includes('application/json')) {
    try { body = await response.json() } catch { body = {} }
  }
  if (response.status === 401) beginLogin()
  return new PortalAPIError(body?.message || `HTTP ${response.status}`, { status: response.status, code: body?.code, details: body?.details })
}

/**
 * 创建一次可见的短效授权并立即在同源下载请求中消费。明文凭据只存在于本函数
 * 局部变量，不返回视图、不进入 URL/请求体，也不由浏览器代码持久化。
 */
export async function downloadIssuedReport(id, { idempotencyKey = key(), signal } = {}) {
  const reportID = encodeURIComponent(id)
  const grant = await request(`/reports/${reportID}/download-grants`, {
    method: 'POST',
    signal,
    headers: { 'Idempotency-Key': idempotencyKey },
  })
  const downloadToken = String(grant?.download_token || '')
  if (!downloadToken) throw new PortalAPIError('下载授权响应无效。', { status: 503, code: 'PORTAL_REPORT_DOWNLOAD_UNAVAILABLE' })

  const response = await fetch(`${API_BASE_URL}/reports/${reportID}/downloads`, {
    method: 'POST',
    credentials: 'include',
    signal,
    headers: {
      Accept: 'application/pdf, application/json',
      'X-CSRF-Token': '1',
      'X-Report-Download-Token': downloadToken,
    },
  })
  if (!response.ok) throw await reportDownloadError(response)
  const contentType = (response.headers.get('content-type') || '').split(';', 1)[0].trim().toLowerCase()
  if (contentType !== 'application/pdf') {
    throw new PortalAPIError('下载响应不是受支持的 PDF 文件。', { status: response.status, code: 'PORTAL_REPORT_DOWNLOAD_CONTENT_TYPE_INVALID' })
  }
  return {
    blob: await response.blob(),
    filename: safePDFFileName(response.headers.get('content-disposition')),
    expires_at: grant?.expires_at,
  }
}
export const getAccountSecurity = () => request('/account/security')
export const listAccountSessions = () => request('/account/sessions')
export const revokeAccountSession = (id) => request(`/account/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' })
export const acknowledgeSecurityEvent = (id) => request(`/account/security-events/${encodeURIComponent(id)}/ack`, { method: 'POST' })
export const listFeedbacks = (params) => request(`/feedbacks${query(params)}`)
export const getFeedback = (id) => request(`/feedbacks/${encodeURIComponent(id)}`)
export const createFeedback = (payload) => request('/feedbacks', { method: 'POST', body: JSON.stringify(payload), headers: { 'Idempotency-Key': key() } })
export const addFeedbackMessage = (id, content) => request(`/feedbacks/${encodeURIComponent(id)}/messages`, { method: 'POST', body: JSON.stringify({ content }), headers: { 'Idempotency-Key': key() } })
export const closeFeedback = (id, idempotencyKey) => request(`/feedbacks/${encodeURIComponent(id)}/close`, { method: 'POST', body: JSON.stringify({}), headers: { 'Idempotency-Key': idempotencyKey } })
export const getEvaluationEligibility = (projectId) => request(`/projects/${encodeURIComponent(projectId)}/evaluation-eligibility`)
export const getEvaluation = (id) => request(`/evaluations/${encodeURIComponent(id)}`)
export const submitEvaluation = (payload) => request('/evaluations', { method: 'POST', body: JSON.stringify(payload), headers: { 'Idempotency-Key': key() } })
export const listFilings = (params) => request(`/filings${query(params)}`)
export const createFiling = (payload, idempotencyKey = key()) => request('/filings', { method: 'POST', body: JSON.stringify(payload), headers: { 'Idempotency-Key': idempotencyKey } })
export const getFiling = (id) => request(`/filings/${encodeURIComponent(id)}`)
export const saveFilingSection = (id, code, payload, idempotencyKey = key()) => request(`/filings/${encodeURIComponent(id)}/sections/${encodeURIComponent(code)}`, { method: 'PUT', body: JSON.stringify(payload), headers: { 'Idempotency-Key': idempotencyKey } })
export const saveFilingMatrix = (id, code, payload, idempotencyKey = key()) => request(`/filings/${encodeURIComponent(id)}/matrix/${encodeURIComponent(code)}`, { method: 'PUT', body: JSON.stringify(payload), headers: { 'Idempotency-Key': idempotencyKey } })
export const validateFiling = (id) => request(`/filings/${encodeURIComponent(id)}/validate`, { method: 'POST', body: JSON.stringify({}) })
export const submitFiling = (id, payload, idempotencyKey = key()) => request(`/filings/${encodeURIComponent(id)}/submit`, { method: 'POST', body: JSON.stringify(payload), headers: { 'Idempotency-Key': idempotencyKey } })
export const createFilingMaterialUpload = (id, payload, idempotencyKey = key()) => request(`/filings/${encodeURIComponent(id)}/material-uploads`, { method: 'POST', body: JSON.stringify(payload), headers: { 'Idempotency-Key': idempotencyKey } })
export const completeFilingMaterialUpload = (id, materialId, expectedVersion) => request(`/filings/${encodeURIComponent(id)}/materials/${encodeURIComponent(materialId)}/complete`, { method: 'POST', body: JSON.stringify({ expected_version: expectedVersion }) })
