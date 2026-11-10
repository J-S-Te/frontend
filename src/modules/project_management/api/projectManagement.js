import { getCurrentPrincipal } from '@/modules/platform/auth/api/auth'
import {
  normalizeAuthorizationSession,
  principalIdentityID,
  shouldStartSubsystemLogin,
} from '../../shared/authz/sessionCompatibility.js'
import { attachStructuredContext } from '../../platform/shared/api/requestContext.js'
import { formatUserError } from '../../shared/utils/userError.js'
import { todayBusinessDate } from '../../shared/utils/businessTime.js'
import { safeDownloadFilename } from '../../shared/utils/contentDisposition.js'
import { DOWNLOAD_TIMEOUT_MESSAGE, downloadRequestSignal } from '../../shared/utils/downloadTimeout.js'

const runtimeEnv = import.meta.env || {}
const PUBLIC_PATH_PREFIX = (runtimeEnv.VITE_PROJECT_PUBLIC_PATH_PREFIX || '/project_management').replace(/\/$/, '')
const API_BASE_URL = (runtimeEnv.VITE_PROJECT_API_BASE_URL || `${PUBLIC_PATH_PREFIX}/api/v1`).replace(/\/$/, '')
let currentSession = null
let sessionRequest = null
let loginRedirectStarted = false

export function startProjectLogin({ force = false } = {}) {
  // 并发请求共享一次登录跳转，并在跳转前清空旧主体缓存。
  if (loginRedirectStarted) return
  loginRedirectStarted = true
  clearProjectSessionCache()
  const prompt = force ? '?prompt=login' : ''
  window.location.replace(`${PUBLIC_PATH_PREFIX}/auth/login${prompt}`)
}

function projectRequestError(body, response, context, { code, fallback, outcomeUnknown = false } = {}) {
  const status = response?.status || 0
  const requestId = body?.request_id || body?.requestId || response?.headers?.get('x-request-id') || ''
  const traceId = body?.trace_id || body?.traceId || response?.headers?.get('x-trace-id') || ''
  const error = new Error(formatUserError(body, { status, code: code || body?.code, method: context.method, details: body?.details ?? body?.field_errors ?? body?.fieldErrors, fallback }))
  error.status = status
  error.code = code || body?.code || ''
  error.requestID = requestId
  error.details = body?.details ?? null
  error.fieldErrors = body?.field_errors ?? body?.fieldErrors ?? body?.details?.fields ?? null
  if (outcomeUnknown) {
    error.outcomeUnknown = true
    error.message = '尚未确认本次操作结果，请先刷新相关列表核对状态，不要重复提交；仍无法确认时请联系管理员。'
  }
  attachStructuredContext(error, {
    ...context, tenantId: String(body?.tenant_id || ''), requestId, traceId,
    metadata: { source: 'project_api', outcomeUnknown },
  }, { status, code: error.code, requestId, traceId })
  return error
}

async function readProjectBody(response) {
  if (response.status === 204 || response.status === 205) return null
  const mediaType = (response.headers.get('content-type') || '').split(';', 1)[0].trim().toLowerCase()
  if (mediaType.endsWith('/json') || mediaType.endsWith('+json')) return response.json()
  const message = await response.text()
  return message ? { message } : {}
}

function handleProjectAuthentication(error, response) {
  if (response.status === 401) {
    if (!error.code) error.code = 'PROJECT_UNAUTHENTICATED'
    if (shouldStartSubsystemLogin(error)) startProjectLogin()
  }
  return error
}

async function request(path, options = {}) {
  const method = String(options.method || 'GET').toUpperCase()
  const isMutation = !['GET', 'HEAD', 'OPTIONS'].includes(method)
  const requestContext = {
    subsystem: 'project_management',
    feature: 'project_api',
    operation: method,
    path,
    method,
  }

  let response
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      credentials: 'include',
      ...options,
      headers: {
        Accept: 'application/json',
        ...(options.body && !(options.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers || {}),
      },
    })
  } catch {
    throw projectRequestError(null, null, requestContext, {
      code: 'NETWORK_ERROR', fallback: '无法连接项目管理服务，请检查网络后重试。', outcomeUnknown: isMutation,
    })
  }
  let body
  let invalidBody = false
  try { body = await readProjectBody(response) } catch { invalidBody = true }
  const mediaType = (response.headers.get('content-type') || '').split(';', 1)[0].trim().toLowerCase()
  const isJSON = mediaType.endsWith('/json') || mediaType.endsWith('+json')
  // 网关误回 200 HTML、损坏响应或错误 envelope 都不能变成成功写入或“空列表”。
  const hasData = body && typeof body === 'object' && !Array.isArray(body) && Object.hasOwn(body, 'data')
  if (response.ok && ![204, 205].includes(response.status) && (!isJSON || invalidBody || !hasData)) {
    throw projectRequestError(null, response, requestContext, {
      code: 'INVALID_PROJECT_RESPONSE', fallback: '项目服务返回的数据格式异常，请刷新页面；仍无法操作时请联系管理员检查前后端版本。', outcomeUnknown: isMutation,
    })
  }
  if (!response.ok) {
    const error = projectRequestError(body, response, requestContext, {
      fallback: '项目操作未完成，请稍后重试。',
      outcomeUnknown: isMutation && ([408, 502, 504].includes(response.status) || body?.code === 'PM_SERVICE_TIMEOUT'),
    })
    if (options.suppressLoginRedirect) throw error
    throw handleProjectAuthentication(error, response)
  }
  return body?.data ?? null
}

/**
 * clearProjectSessionCache 清空项目会话与进行中的会话读取任务，避免后续请求读取过期会话。
 * @returns {void}
 */
export function clearProjectSessionCache() { currentSession = null; sessionRequest = null }

/**
 * getProjectSession 读取项目会话并进行标准化，支持 force 参数强制绕过缓存。
 * @param {Object} [options] 读取参数。
 * @param {boolean} [options.force=false] true 强制重新发起一次 /auth/me。
 * @returns {Promise<object>} 项目会话对象。
 * @throws {Error} 网络不可达、鉴权失效或服务端返回非成功状态时抛出。
 */
export async function getProjectSession({ force = false, suppressLoginRedirect = false } = {}) {
  // 合并同一时刻的 /auth/me 请求，防止多个组件各自读取并提交不同时间点的会话。
  if (!force && currentSession) return currentSession
  if (!force && sessionRequest) return sessionRequest
  sessionRequest = request('/auth/me', { suppressLoginRedirect }).then((session) => { currentSession = normalizeAuthorizationSession(session); return currentSession }).finally(() => { sessionRequest = null })
  return sessionRequest
}

/**
 * probeProjectSession 只读读取项目会话及服务端权威空闲窗口；401 不自行跳转。
 * @returns {Promise<object>} 规范化会话（含 idle_timeout_seconds/idle_remaining_ms）。
 */
export async function probeProjectSession() {
  return getProjectSession({ force: true, suppressLoginRedirect: true })
}

/**
 * recordProjectSessionActivity 上报真实用户操作，滑动项目子系统会话空闲窗口。
 * @returns {Promise<unknown>} 服务端权威空闲窗口。
 */
export async function recordProjectSessionActivity() {
  return request('/auth/activity', {
    method: 'POST',
    suppressLoginRedirect: true,
    headers: { Accept: 'application/json', 'X-CSRF-Token': '1' },
  })
}

export async function getProjectNavigation() {
  const data = await request('/navigation')
  return {
    roles: Array.isArray(data?.roles) ? data.roles : [],
    sections: Array.isArray(data?.sections) ? data.sections : [],
    default_section: typeof data?.default_section === 'string' ? data.default_section : '',
    authorization_revision: data?.authorization_revision ?? null,
    catalog_version: data?.catalog_version || '',
  }
}

async function clearProjectLocalSession() {
  clearProjectSessionCache()
  try {
    await fetch(`${PUBLIC_PATH_PREFIX}/auth/local-logout`, { method: 'POST', credentials: 'include', headers: { Accept: 'application/json' } })
  } catch {
    attachStructuredContext(new Error('本地会话清理失败。'), {
      subsystem: 'project_management',
      feature: 'project_session',
      operation: 'POST',
      path: `${PUBLIC_PATH_PREFIX}/auth/local-logout`,
      method: 'POST',
      metadata: { source: 'project_local_logout' },
    }, {
      status: 0,
      code: 'NETWORK_ERROR',
      requestId: '',
      traceId: '',
    })
    // 本地清理暂时失败时，后续 OIDC 回调仍会覆盖旧会话。失败不应中断主流程。
  }
}

/**
 * ensureProjectSession 校验项目会话与平台主体是否一致，不一致时清理本地项目会话并触发项目登录。
 *
 * 项目与平台各自持有 Cookie；当会话有效时会对比平台主体，避免用户/租户切换后沿用旧权限。
 *
 * @returns {Promise<object|null>} 项目会话对象；已触发重登录跳转时返回 null。
 * @throws {Error} 网络失败、鉴权失败或项目服务返回错误时抛出。
 */
export async function ensureProjectSession() {
  try {
    // 两侧 `/auth/me` 互不依赖，并行发起可把进入项目系统的导航缩短一个往返；
    // 失败语义不变：平台侧失败仍被吞掉，项目侧失败仍由 shouldStartSubsystemLogin 处理。
    const [projectSession, platformResult] = await Promise.all([
      getProjectSession({ force: true }),
      getCurrentPrincipal().then(
        (principal) => ({ ok: true, principal }),
        (error) => ({ ok: false, error }),
      ),
    ])
    try {
      if (platformResult.ok) {
        const platformPrincipal = platformResult.principal
        const platformIdentityID = principalIdentityID(platformPrincipal)
        const projectIdentityID = principalIdentityID(projectSession)
        const userChanged = platformIdentityID && projectIdentityID && platformIdentityID !== projectIdentityID
        const platformTenantID = String(platformPrincipal?.tenant_id || platformPrincipal?.tenant?.id || '')
        const tenantChanged = platformTenantID && platformTenantID !== String(projectSession?.tenant_id || '')
        // 普通 OIDC 登录会复用 Keycloak 中仍存活的旧 Realm 会话。账号切换后必须
        // 强制 Keycloak 重新经过基础平台 Broker；能够切换时建立当前主体会话，
        // Keycloak 拒绝切换时停在明确错误页，均不能再静默重建旧会话形成刷新风暴。
        if (userChanged || tenantChanged) { await clearProjectLocalSession(); startProjectLogin({ force: true }); return null }
      }
    } catch { /* 基础平台暂时不可用时，项目 OIDC 会话仍按自身有效期独立生效。 */ }
    return projectSession
  } catch (error) {
    if (shouldStartSubsystemLogin(error)) { startProjectLogin(); return null }
    throw error
  }
}

/**
 * unwrapPage 兼容两种列表响应：分页 envelope（{items,total,page,page_size,truncated}）与历史数组。
 * 后端省略 page_size 时只返回默认 20 行，因此 items 不再等于全量；需要完整集合时必须显式
 * 走 all 快照模式（listProjectsSnapshot / listServiceItemsSnapshot）并检查 truncated。
 * @param {unknown} data 接口返回体。
 * @returns {{items: Array<object>, total: number, truncated: boolean}} 列表、总数与快照截断标记。
 */
function unwrapPage(data) {
  if (Array.isArray(data)) return { items: data, total: data.length, truncated: false }
  if (data && Array.isArray(data.items)) {
    return { items: data.items, total: Number(data.total ?? data.items.length), truncated: Boolean(data.truncated) }
  }
  return { items: [], total: 0, truncated: false }
}

/**
 * listProjects 按前端约定参数查询项目列表，并在返回非数组时兜底为空列表。
 *
 * 支持 `report_stage` 查询参数（NONE/RECTIFYING/COMPILING/REVIEWED/ISSUED/ARCHIVED）：
 * 参数原样下发给服务端做筛选与合法性校验，前端不对已加载列表做二次全量过滤。
 * 未传 page_size 时服务端只返回默认 20 行（安全审查 F1：省略分页不再等于全量），
 * 因此这里只适合分页/筛选读取；工作区完整快照走 listProjectsSnapshot。
 *
 * @param {Record<string, string|number|boolean>} [params={}] 查询条件。支持 keyword 兼容映射为 q。
 * @returns {Promise<Array<object>>} 项目列表（默认最多 20 行）。
 * @throws {Error} 会话失效、鉴权失败或网关返回非成功状态时抛出。
 */
export async function listProjects(params = {}) {
  // 项目后端的查询参数名称是 q；保留 keyword 作为前端调用兼容别名，避免
  // 将未被后端读取的 keyword 原样发送，导致关键词筛选静默失效。
  const query = { ...params }
  if (query.q === undefined && query.keyword !== undefined) query.q = query.keyword
  delete query.keyword
  const search = new URLSearchParams(Object.entries(query).filter(([, value]) => value !== undefined && value !== null && value !== '')).toString()
  const data = await request(`/projects${search ? `?${search}` : ''}`)
  return unwrapPage(data).items
}

/**
 * listProjectsSnapshot 以显式 all 快照模式读取项目集合，供工作区一次性替换使用。
 *
 * all=1 时服务端最多返回 500 行，总数（过滤后）仍由 total 给出；total 大于实际行数时
 * truncated 为 true，调用方必须提示“仅展示前 500 条”，不能把截断集合当成全量。
 * all 与 page/page_size 互斥（同传即 422），这里主动剔除分页参数避免误传。
 *
 * @param {Record<string, string|number|boolean>} [params={}] 查询条件。支持 keyword 兼容映射为 q。
 * @returns {Promise<{items: Array<object>, total: number, truncated: boolean}>} 快照行、过滤后总数与截断标记。
 * @throws {Error} 会话失效、鉴权失败或网关返回非成功状态时抛出。
 */
export async function listProjectsSnapshot(params = {}) {
  const query = { ...params, all: 1 }
  if (query.q === undefined && query.keyword !== undefined) query.q = query.keyword
  delete query.keyword
  delete query.page
  delete query.page_size
  const search = new URLSearchParams(Object.entries(query).filter(([, value]) => value !== undefined && value !== null && value !== '')).toString()
  const page = unwrapPage(await request(`/projects${search ? `?${search}` : ''}`))
  return { items: page.items, total: page.total, truncated: page.truncated }
}

/** 返回一份由服务端生成、按角色限定范围的进行中监控快照。 */
export async function getProjectMonitoring(params = {}) {
  const query = { ...params }
  if (query.q === undefined && query.keyword !== undefined) query.q = query.keyword
  delete query.keyword
  const search = new URLSearchParams(Object.entries(query).filter(([, value]) => value !== undefined && value !== null && value !== '' && value !== false)).toString()
  const data = await request(`/projects-monitoring${search ? `?${search}` : ''}`)
  return {
    items: Array.isArray(data?.items) ? data.items : [],
    recent_events: Array.isArray(data?.recent_events) ? data.recent_events : [],
    status_counts: data?.status_counts || {},
    // 报告阶段是独立维度：旧后端不返回该字段时保持空对象，分桶按 0 处理。
    report_stage_counts: data?.report_stage_counts || {},
    categories: Array.isArray(data?.categories) ? data.categories : [],
    teams: Array.isArray(data?.teams) ? data.teams : [],
    project_manager_ids: Array.isArray(data?.project_manager_ids) ? data.project_manager_ids : [],
    total: Number(data?.total || 0),
    page: Number(data?.page || 1),
    page_size: Number(data?.page_size || params.page_size || 20),
    server_time: data?.server_time || '',
    snapshot_version: data?.snapshot_version || '',
  }
}

/**
 * listApprovedContracts 通过项目后端读取当前租户已审批合同。
 * 跨子系统调用由项目后端使用机器身份完成，浏览器无需合同系统 Cookie。
 * @param {Record<string, string|number>} [params={}] 查询参数。
 * @returns {Promise<Array<object>>} 可用于创建项目的已审批合同摘要。
 */
export async function listApprovedContracts(params = {}) {
  const search = new URLSearchParams(Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== '')).toString()
  const data = await request(`/approved-contracts${search ? `?${search}` : ''}`)
  return Array.isArray(data) ? data : []
}

/**
 * searchApprovedContractOptions 按关键字跨游标页搜索可建项的已审批合同（BIZ-XAPI-09）。
 * 服务端会先按审批通过 + 普通来源过滤，再排除当前租户已建项的合同；
 * 返回值只含项目建项所需的合同摘要，不含合同正文、金额或附件。
 * @param {{keyword?: string, afterId?: string, limit?: number}} [params={}] 搜索参数。
 * @returns {Promise<{contracts: Array<object>, next_after_id: string}>} 本页合同与下一页游标。
 */
export async function searchApprovedContractOptions({ keyword = '', afterId = '', limit = 50 } = {}) {
  const search = new URLSearchParams()
  const trimmedKeyword = String(keyword || '').trim()
  if (trimmedKeyword) search.set('keyword', trimmedKeyword)
  if (afterId) search.set('after_id', afterId)
  if (limit) search.set('limit', String(limit))
  const data = await request(`/approved-contract-options${search.toString() ? `?${search}` : ''}`)
  return {
    contracts: Array.isArray(data?.contracts) ? data.contracts : [],
    next_after_id: String(data?.next_after_id || ''),
  }
}

/**
 * getApprovedContractServiceItems 读取一份已审批合同可关联的权威服务范围。
 * 返回值只包含项目创建所需的结构化服务项，不包含合同正文、金额或附件。
 * @param {string} contractID 合同管理系统合同 ID。
 * @returns {Promise<{contract_id: string, contract_version: number, service_items: Array<object>}>} 合同版本及可选服务项。
 */
export async function getApprovedContractServiceItems(contractID) {
  const data = await request(`/approved-contracts/${encodeURIComponent(contractID)}/service-items`)
  return {
    contract_id: String(data?.contract_id || ''),
    contract_version: Number(data?.contract_version || 0),
    service_items: Array.isArray(data?.service_items) ? data.service_items : [],
  }
}

export async function listSupplementContracts(projectID, params = {}) {
  const query = new URLSearchParams(params)
  const data = await request(`/projects/${encodeURIComponent(projectID)}/supplement-contracts${query.toString() ? `?${query}` : ''}`)
  return Array.isArray(data) ? data : []
}

/**
 * closeSupplement 关闭项目的补充协议分支（BIZ-PROJECT-04）。
 * 服务端要求 project.decomposition.manage：项目必须处于补充协议处理中，补充协议
 * 必须已审批且同客户，原因必填；成功后项目以当前范围指纹为新基准并回读状态。
 * @param {string|number} projectID 项目 ID。
 * @param {{supplement_contract_id: string, reason: string}} payload 已审批补充协议与关账原因。
 * @returns {Promise<{status?: string}>} 服务端回读的项目状态。
 * @throws {Error} 403 无权限、409 状态不满足、422 校验失败或依赖不可用时抛出。
 */
export function closeSupplement(projectID, payload) {
  return request(`/projects/${encodeURIComponent(projectID)}/supplement-closure`, { method: 'POST', body: JSON.stringify(payload) })
}

/**
 * listProjectsPage 分页查询项目列表，返回 items 与 total 供分页控件渲染。
 * 状态过滤发生在服务端的派生态上，因此 total 是"筛选后的总数"。
 * `report_stage` 与状态筛选一样原样下发，由服务端决定组合口径。
 * @param {Record<string, string|number|boolean>} [params={}] 查询条件，含 page / page_size / report_stage。
 * @returns {Promise<{items: Array<object>, total: number}>} 当前页与筛选后的总数。
 * @throws {Error} 会话失效、鉴权失败或分页参数不合法时抛出。
 */
export async function listProjectsPage(params = {}) {
  const query = { ...params }
  if (query.q === undefined && query.keyword !== undefined) query.q = query.keyword
  delete query.keyword
  const search = new URLSearchParams(Object.entries(query).filter(([, value]) => value !== undefined && value !== null && value !== '')).toString()
  return unwrapPage(await request(`/projects${search ? `?${search}` : ''}`))
}

/**
 * getProject 获取单个项目详情。
 * @param {string|number} projectID 项目 ID。
 * @returns {Promise<object>} 项目详情。
 * @throws {Error} 项目不存在、鉴权失败或服务端异常时抛出。
 */
export function getProject(projectID) {
  return request(`/projects/${encodeURIComponent(projectID)}`)
}

/**
 * createProject 创建项目主档。
 * @param {Object} payload 项目创建字段。
 * @returns {Promise<object>} 创建后的项目对象。
 * @throws {Error} 数据校验失败、重复提交或权限不足时抛出。
 */
export function createProject(payload) {
  return request('/projects', { method: 'POST', body: JSON.stringify(payload) })
}

/**
 * adjustDecomposition 调整服务项拆解并发起补充协议。
 * 服务端要求 project.decomposition.manage，且仅当项目不存在"待确认/待复核"之外的服务项时才受理。
 * @param {string|number} projectID 项目 ID。
 * @param {{reason: string, supplement_contract_id: string, items: Array<object>}} payload 调整原因、补充协议编号与新的服务项清单。
 * @returns {Promise<object>} 服务端返回的项目唯一状态。
 * @throws {Error} 数据校验失败或权限不足时抛出。
 */
export function adjustDecomposition(projectID, payload) {
  return request(`/projects/${encodeURIComponent(projectID)}/decomposition-adjustments`, { method: 'POST', body: JSON.stringify(payload) })
}

/**
 * listServiceItems 查询项目下的服务项；projectID 为空时返回全部。
 *
 * 未传 page_size 时服务端只返回默认 20 行（安全审查 F1）；需要完整服务项集合
 * （按项目详情核对、写后读取权威版本）时必须使用 listServiceItemsSnapshot。
 *
 * @param {string|number} [projectID=''] 可选项目 ID。
 * @returns {Promise<Array<object>>} 服务项列表（默认最多 20 行）。
 * @throws {Error} 会话失效、鉴权失败或网关返回非成功状态时抛出。
 */
export async function listServiceItems(projectID = '') {
  const search = projectID ? `?project_id=${encodeURIComponent(projectID)}` : ''
  const data = await request(`/service-items${search}`)
  return unwrapPage(data).items
}

/**
 * listServiceItemsSnapshot 以显式 all 快照模式读取服务项集合（可选按项目过滤）。
 *
 * all=1 时服务端最多返回 500 行，truncated 表示过滤后总数大于本次行数：
 * 调用方不得把截断集合当成完整清单，需要向用户提示缩小筛选范围。
 *
 * @param {string|number} [projectID=''] 可选项目 ID。
 * @returns {Promise<{items: Array<object>, total: number, truncated: boolean}>} 快照行、过滤后总数与截断标记。
 * @throws {Error} 会话失效、鉴权失败或网关返回非成功状态时抛出。
 */
export async function listServiceItemsSnapshot(projectID = '') {
  const search = projectID ? `?all=1&project_id=${encodeURIComponent(projectID)}` : '?all=1'
  const page = unwrapPage(await request(`/service-items${search}`))
  return { items: page.items, total: page.total, truncated: page.truncated }
}

/**
 * listPersonnel 从基础平台负责人目录查询可选人员，供服务项操作台按人员选择团队负责人、
 * 项目经理和工程师，避免业务用户手工填写平台用户 ID。
 * @param {Object} [params={}] 查询参数：keyword、user_id、role_code、page、page_size。
 *   role_code 为数组时按重复参数发送（平台目录按重复参数解析），可以一次只取某个角色的候选人。
 * @returns {Promise<{items: Array<object>, total: number}>} 人员分页结果；目录未返回列表时兜底为空。
 * @throws {Error} 目录未开通、权限不足或平台暂不可用时抛出。
 */
export async function listPersonnel(params = {}) {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue
    for (const item of Array.isArray(value) ? value : [value]) {
      if (item === undefined || item === null || item === '') continue
      search.append(key, item)
    }
  }
  const query = search.toString()
  const data = await request(`/personnel${query ? `?${query}` : ''}`)
  return data && Array.isArray(data.items) ? data : { items: [], total: 0 }
}

/**
 * listQualifiedPersonnel 查询项目系统人员资质库中的当前有效人员。
 * 这是任务分配人员下拉的唯一候选源；基础平台 /personnel 仅用于建立资质档案。
 * @param {Object} [params={}] role_code（必填）、keyword、page、page_size。
 * @returns {Promise<{items: Array<object>, total: number}>} 有效人员资质分页结果。
 */
export async function listQualifiedPersonnel(params = {}) {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') search.append(key, value)
  }
  const query = search.toString()
  const data = await request(`/qualified-personnel${query ? `?${query}` : ''}`)
  return data && Array.isArray(data.items) ? data : { items: [], total: 0 }
}

/**
 * returnServiceItemEquipment 归还设备：释放该服务项对设备的使用登记，设备回到「在公司」。
 * @param {string} itemID 服务项标识。
 * @param {string} resourceID 设备编号。
 * @returns {Promise<object>} 归还结果。
 * @throws {Error} 未登录、无权限或服务项不存在时抛出。
 */
export async function returnServiceItemEquipment(itemID, resourceID) {
  return request(`/service-items/${encodeURIComponent(itemID)}/equipment-return`, {
    method: 'POST',
    body: JSON.stringify({ resource_id: resourceID }),
  })
}

/**
 * listEquipmentReservations 查询某服务项计划窗口内、被其他服务项占用的设备。
 * 实施准备的选择器据此把已占用设备置灰，保存时服务端仍会再次硬拦重叠占用。
 * @param {string} itemID 服务项标识。
 * @returns {Promise<Array<object>>} 占用记录列表；接口异常时由调用方兜底为空。
 * @throws {Error} 未登录、无权限或项目服务不可用时抛出。
 */
export async function listEquipmentReservations(itemID) {
  const data = await request(`/service-items/${encodeURIComponent(itemID)}/equipment-reservations`)
  return Array.isArray(data) ? data : []
}

/**
 * resolvePersonnelNames 批量把平台 user_id 翻译成显示名。
 * 团队负责人、项目经理、工程师在界面上必须显示姓名而不是 ULID；负责人目录只支持单个
 * user_id 查询，因此由服务端聚合并一次返回映射。
 * @param {Array<string>} ids 平台 user_id 列表。
 * @returns {Promise<Object>} user_id → display_name 映射；解析不到的 ID 不出现在结果中。
 * @throws {Error} 目录未开通、权限不足或平台暂不可用时抛出。
 */
export async function resolvePersonnelNames(ids = []) {
  const unique = [...new Set((Array.isArray(ids) ? ids : []).map((id) => String(id || '').trim()).filter(Boolean))]
  if (!unique.length) return {}
  const data = await request(`/personnel/names?user_ids=${encodeURIComponent(unique.join(','))}`)
  return data && typeof data.names === 'object' && data.names !== null ? data.names : {}
}

/**
 * syncPersonnelIdentities 回基础平台负责人目录复核人员资质档案。
 * 资质在本系统维护，但"这个人是否真实存在（在职）"只能由基础平台回答：
 * 复核结果写入 identity_status，界面据此区分在职 / 已离职 / 未关联。
 * @returns {Promise<{total:number, active:number, missing:number, unlinked:number, unverified:number, checked_at:string}>} 复核统计。
 * @throws {Error} 目录未开通、权限不足或平台暂不可用时抛出。
 */
export function syncPersonnelIdentities() {
  return request('/capabilities/sync-identities', { method: 'POST' })
}

/**
 * confirmServiceItems 批量确认服务项归属/签收。
 * @param {Array<string|number>} ids 服务项 ID 列表。
 * @returns {Promise<object>} 批量确认结果。
 * @throws {Error} 请求体为空、会话失效或部分服务项状态异常时抛出。
 */
export function confirmServiceItems(ids) {
  return request('/service-items/confirm', { method: 'POST', body: JSON.stringify({ ids }) })
}

/**
 * listRules 查询项目规则列表（全部配置类型）。
 * @returns {Promise<Array<object>>} 规则列表。
 * @throws {Error} 会话失效、鉴权失败或网关返回非成功状态时抛出。
 */
export async function listRules() {
  const data = await request('/rules')
  return Array.isArray(data) ? data : []
}

/**
 * listApplicationRoles 读取本应用的角色目录（服务端下发，来自权限清单）。
 * 字段级权限的「角色」必须从这个目录里选：角色码写错时规则接口不会报错，
 * 但规则永远不会命中任何主体，属于只在运行期静默失效的错误，因此前端不得硬编码角色列表。
 * @returns {Promise<Array<{code: string, name: string}>>} 角色目录（含中文展示名，按清单顺序）。
 * @throws {Error} 会话失效、鉴权失败或网关返回非成功状态时抛出。
 */
export async function listApplicationRoles() {
  const data = await request('/role-catalog')
  const roles = Array.isArray(data?.roles) ? data.roles : []
  return roles
    .map((role) => ({ code: String(role?.code || '').trim(), name: String(role?.name || '').trim() || String(role?.code || '').trim() }))
    .filter((role) => role.code)
}

/**
 * listRuleConfigurationCatalog 读取自动化事件与服务项 SLA 状态的服务端权威目录。
 * @returns {Promise<{automation_triggers: Array, sla_statuses: Array}>} 规则可选值。
 */
export async function listRuleConfigurationCatalog() {
  const data = await request('/rule-configuration-catalog')
  const normalize = (items) => (Array.isArray(items) ? items : [])
    .map((item) => ({
      value: String(item?.value || '').trim(),
      label: String(item?.label || '').trim() || String(item?.value || '').trim(),
      description: String(item?.description || '').trim(),
    }))
    .filter((item) => item.value)
  return {
    automation_triggers: normalize(data?.automation_triggers),
    sla_statuses: normalize(data?.sla_statuses),
  }
}

/**
 * createRule 新建配置规则（按 kind 落入五套真实配置表中的对应一张）。
 * @param {Object} payload 规则内容。
 * @returns {Promise<object>} 创建结果。
 * @throws {Error} 入参非法、冲突或操作被拒绝时抛出。
 */
export function createRule(payload) {
  return request('/rules', { method: 'POST', body: JSON.stringify(payload) })
}

/**
 * getSplitPolicy 读取合同拆解的默认分组规则（原型 PG-CFG-01 第一块）。
 * @returns {Promise<object>} 默认分组规则（未配置时服务端返回原型默认值）。
 * @throws {Error} 会话失效或鉴权失败时抛出。
 */
export async function getSplitPolicy() {
  return request('/split-policy')
}

/**
 * saveSplitPolicy 保存默认分组规则（整行覆盖）。
 * @param {Object} payload 分组维度、默认进入状态、摘要与缺规则处理等设置。
 * @returns {Promise<object>} 保存后的分组规则。
 * @throws {Error} 入参非法或无权限时抛出。
 */
export function saveSplitPolicy(payload) {
  return request('/split-policy', { method: 'PUT', body: JSON.stringify(payload) })
}

/**
 * listDetectionCategories 读取检测类别（服务类型）域，含每类的关联服务项数。
 * @returns {Promise<Array<object>>} 检测类别列表。
 * @throws {Error} 会话失效或鉴权失败时抛出。
 */
export async function listDetectionCategories() {
  const data = await request('/detection-categories')
  return Array.isArray(data?.items) ? data.items : []
}

/**
 * saveDetectionCategory 新增或更新一项检测类别（按租户 + 类别幂等）。
 * @param {Object} payload 类别、默认体系要求、必备资质与特殊方法口径。
 * @returns {Promise<object>} 保存后的检测类别。
 * @throws {Error} 入参非法或无权限时抛出。
 */
export function saveDetectionCategory(payload) {
  return request('/detection-categories', { method: 'POST', body: JSON.stringify(payload) })
}

/**
 * importDetectionCategories 批量导入检测类别域（页面「导入」入口）。
 * 确认导入必须携带 Idempotency-Key：服务端按「租户 + 键」保证重试不重复写入，
 * 同键不同内容返回 409；缺失或非法键返回 400。
 * @param {File} file 原始 CSV 文件。
 * @param {number[]|null} selectedRows 预检通过且用户选择的文件行号。
 * @param {string} idempotencyKey 由文件与选中行推导的稳定幂等键。
 * @returns {Promise<{imported: number, skipped: number, errors?: string[]}>} 导入结果摘要。
 * @throws {Error} 无权限、幂等键冲突或网关返回非成功状态时抛出。
 */
export function importDetectionCategories(file, selectedRows = null, idempotencyKey = '') {
  const formData = new FormData()
  formData.append('file', file)
  if (Array.isArray(selectedRows)) formData.append('selected_rows', JSON.stringify(selectedRows))
  return request('/detection-categories/import', { method: 'POST', body: formData, headers: importIdempotencyHeaders(idempotencyKey) })
}

export function previewDetectionCategoriesImport(file) {
  const formData = new FormData()
  formData.append('file', file)
  return request('/detection-categories/import/preview', { method: 'POST', body: formData })
}

export function downloadDetectionCategoryImportTemplate(example = false) {
  return downloadImportTemplate(`/detection-categories/import/template${example ? '?example=true' : ''}`, example ? '检测类别导入填写示例.csv' : '检测类别导入模板.csv')
}

/**
 * deleteDetectionCategory 删除一项检测类别；仍被服务项引用时服务端返回冲突。
 * @param {string} category 检测类别。
 * @returns {Promise<object>} 被删除的类别。
 * @throws {Error} 类别仍被引用、不存在或无权限时抛出。
 */
export function deleteDetectionCategory(category) {
  return request(`/detection-categories/${encodeURIComponent(category)}`, { method: 'DELETE' })
}

/**
 * listSplitOverrides 读取覆盖规则（按优先级升序）。
 * @returns {Promise<Array<object>>} 覆盖规则列表。
 * @throws {Error} 会话失效或鉴权失败时抛出。
 */
export async function listSplitOverrides() {
  const data = await request('/split-overrides')
  return Array.isArray(data?.items) ? data.items : []
}

/**
 * saveSplitOverride 新增（无 id）或更新一条覆盖规则。
 * @param {Object} payload 名称、匹配条件、覆盖设置、优先级与启停。
 * @returns {Promise<object>} 保存后的覆盖规则。
 * @throws {Error} 入参非法或无权限时抛出。
 */
export function saveSplitOverride(payload) {
  return request('/split-overrides', { method: 'POST', body: JSON.stringify(payload) })
}

/**
 * deleteSplitOverride 删除一条覆盖规则。
 * @param {string|number} id 覆盖规则 ID。
 * @returns {Promise<object>} 被删除的覆盖规则。
 * @throws {Error} 规则不存在或无权限时抛出。
 */
export function deleteSplitOverride(id) {
  return request(`/split-overrides/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

/**
 * deleteRule 删除一条配置规则。六套配置各自成表，因此 kind 必填：只有 kind 能确定目标表，
 * 主键在不同表之间会重复，缺 kind 服务端按参数不合法拒绝。
 * @param {string|number} id 规则 ID。
 * @param {string} kind 规则类型（split-rules / warning-rules / automations / permissions / sla / standards）。
 * @returns {Promise<object>} 被删除的规则。
 * @throws {Error} 规则不存在、类型缺失、无权限或网关返回非成功状态时抛出。
 */
export function deleteRule(id, kind) {
  return request(`/rules/${encodeURIComponent(id)}?kind=${encodeURIComponent(kind || '')}`, { method: 'DELETE' })
}

/**
 * updateRule 整行更新配置规则（名称、启停开关与该配置类型专属字段）。
 * @param {string|number} id 规则 ID。
 * @param {Object} payload 更新后的规则内容（必须携带 kind）。
 * @returns {Promise<object>} 更新后的规则信息。
 * @throws {Error} 规则不存在、校验失败或无权限时抛出。
 */
export function updateRule(id, payload) {
  return request(`/rules/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(payload) })
}

/**
 * setRuleEnabled 更新单条配置规则启停。
 * @param {string|number} id 规则 ID。
 * @param {string} kind 配置类型（split-rules / warning-rules / automations / permissions / sla）。
 * @param {boolean} enabled 是否启用。
 * @returns {Promise<object>} 更新后的规则信息。
 * @throws {Error} 规则不存在、版本校验失败或无权限时抛出。
 */
export function setRuleEnabled(id, kind, enabled) {
  return request(`/rules/${encodeURIComponent(id)}?kind=${encodeURIComponent(kind)}`, { method: 'PATCH', body: JSON.stringify({ enabled }) })
}

/**
 * reviewSpecialMethod 技术总监对特殊方法服务项进行复核。
 * @param {string|number} itemID 服务项 ID。
 * @param {Object} payload 复核决定 { decision: 'APPROVED' | 'REJECTED', comment }。
 * @returns {Promise<object>} 复核结果。
 * @throws {Error} 状态不允许、无权限或复核内容非法时抛出。
 */
export function reviewSpecialMethod(itemID, payload) {
  return request(`/service-items/${encodeURIComponent(itemID)}/special-method-review`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

/**
 * updateReportStatus 用途：依次推进整改中→编制中→已审核→已签发→已归档。
 * 参数：itemID 为服务项 ID，phase 为目标阶段，expectedVersion 为当前服务项版本。
 * 返回值：更新结果 Promise；跳级、无权限、版本冲突或阶段非法时抛出错误。
 */
export function updateReportStatus(itemID, phase, expectedVersion) {
  // expectedVersion 为服务端返回的服务项版本：带上它，服务端在探测到"我基于的是旧版本"时
  // 返回 409，避免静默覆盖他人刚提交的修改。
  return request(`/service-items/${encodeURIComponent(itemID)}/report-status`, {
    method: 'POST',
    body: JSON.stringify({ phase, expected_version: Number(expectedVersion) || 0 }),
  })
}

/**
 * getDashboard 获取项目看板聚合数据。
 * @returns {Promise<object>} 看板指标与图表源数据。
 * @throws {Error} 会话失效或服务异常时抛出。
 */
export function getDashboard() {
  return request('/dashboard')
}

/**
 * listSlaOverdue 获取 SLA 超期 / 临近超期服务项（服务端口径：计划完成超期 + 状态停留超期/临近）。
 * @returns {Promise<Array<object>>} SLA 超期项列表，kind 区分 PLAN_END_OVERDUE / STATUS_DEADLINE_OVERDUE / STATUS_DEADLINE_APPROACHING。
 * @throws {Error} 会话失效或服务异常时抛出。
 */
export async function listSlaOverdue() {
  const data = await request('/delivery/sla-overdue')
  return Array.isArray(data) ? data : []
}

/**
 * assignTeam 为服务项指派实施团队。
 * @param {string|number} itemID 服务项 ID。
 * @param {Object} payload 团队指派负载。
 * @returns {Promise<object>} 指派结果。
 * @throws {Error} 会话失效、无权限或服务项状态异常时抛出。
 */
export function assignTeam(itemID, payload) {
  return request(`/service-items/${encodeURIComponent(itemID)}/team-assignment`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function revokeTeamAssignment(itemID, payload) {
  return request(`/service-items/${encodeURIComponent(itemID)}/team-assignment/revoke`, { method: 'POST', body: JSON.stringify(payload) })
}

export function returnServiceItemToDecomposition(itemID, payload) {
  return request(`/service-items/${encodeURIComponent(itemID)}/decomposition-return`, { method: 'POST', body: JSON.stringify(payload) })
}

/**
 * assignExecutionTeam 为服务项指派执行团队。
 * @param {string|number} itemID 服务项 ID。
 * @param {Object} payload 执行团队负载。
 * @returns {Promise<object>} 指派结果。
 * @throws {Error} 会话失效、无权限或执行团队缺失时抛出。
 */
export function assignExecutionTeam(itemID, payload) {
  return request(`/service-items/${encodeURIComponent(itemID)}/execution-assignment`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function revokeExecutionAssignment(itemID, payload) {
  return request(`/service-items/${encodeURIComponent(itemID)}/execution-assignment/revoke`, { method: 'POST', body: JSON.stringify(payload) })
}

export function revokeImplementationPlan(itemID, payload) {
  return request(`/service-items/${encodeURIComponent(itemID)}/implementation-plan/revoke`, { method: 'POST', body: JSON.stringify(payload) })
}

export function revokePreparation(itemID, payload) {
  return request(`/service-items/${encodeURIComponent(itemID)}/preparation/revoke`, { method: 'POST', body: JSON.stringify(payload) })
}

export function requestRollback(itemID, payload) {
  return request(`/service-items/${encodeURIComponent(itemID)}/rollback-requests`, { method: 'POST', body: JSON.stringify(payload) })
}

export function decideRollback(itemID, requestID, payload) {
  return request(`/service-items/${encodeURIComponent(itemID)}/rollback-requests/${encodeURIComponent(requestID)}/decision`, { method: 'POST', body: JSON.stringify(payload) })
}

export function withdrawRollback(itemID, requestID, payload) {
  return request(`/service-items/${encodeURIComponent(itemID)}/rollback-requests/${encodeURIComponent(requestID)}/withdraw`, { method: 'POST', body: JSON.stringify(payload) })
}

export function requestReportCorrection(itemID, payload) {
  return request(`/service-items/${encodeURIComponent(itemID)}/report-corrections`, { method: 'POST', body: JSON.stringify(payload) })
}

export function decideReportCorrection(itemID, requestID, payload) {
  return request(`/service-items/${encodeURIComponent(itemID)}/report-corrections/${encodeURIComponent(requestID)}/decision`, { method: 'POST', body: JSON.stringify(payload) })
}

export async function listReportRevisions(itemID) {
  const data = await request(`/service-items/${encodeURIComponent(itemID)}/report-revisions`)
  return Array.isArray(data) ? data : []
}

export function registerReportArtifact(itemID, revision, payload) {
  return request(`/service-items/${encodeURIComponent(itemID)}/report-revisions/${encodeURIComponent(revision)}/artifact`, { method: 'PUT', body: JSON.stringify(payload) })
}

function commandKey(prefix) {
  const random = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`
  return `${prefix}-${random}`.slice(0, 128)
}

function penetrationCommand(itemID, suffix, method, payload, stableKey = '') {
  return request(`/service-items/${encodeURIComponent(itemID)}/penetration-work-package${suffix}`, {
    method,
    headers: { 'Idempotency-Key': stableKey || commandKey(`penetration-${String(itemID)}-${suffix || 'ensure'}`) },
    body: JSON.stringify(payload),
  })
}

export function getPenetrationWorkPackage(itemID) {
  return request(`/service-items/${encodeURIComponent(itemID)}/penetration-work-package`)
}

export function ensurePenetrationWorkPackage(itemID, expectedVersion, idempotencyKey = '') {
  return penetrationCommand(itemID, '', 'POST', { expected_version: Number(expectedVersion) || 0 }, idempotencyKey)
}

export function savePenetrationDecision(itemID, payload, idempotencyKey = '') {
  return penetrationCommand(itemID, '/decision', 'PUT', payload, idempotencyKey)
}

export function savePenetrationPlan(itemID, payload, idempotencyKey = '') {
  return penetrationCommand(itemID, '/plan', 'PUT', payload, idempotencyKey)
}

export function advancePenetrationExecution(itemID, payload, idempotencyKey = '') {
  return penetrationCommand(itemID, '/execution', 'POST', payload, idempotencyKey)
}

export function listPenetrationReportRevisions(itemID) {
  return request(`/service-items/${encodeURIComponent(itemID)}/penetration-work-package/report-revisions`).then((value) => Array.isArray(value) ? value : [])
}

export function registerPenetrationReportArtifact(itemID, payload, idempotencyKey = '') {
  return penetrationCommand(itemID, '/report-artifact', 'PUT', payload, idempotencyKey)
}

export function advancePenetrationReport(itemID, payload, idempotencyKey = '') {
  return penetrationCommand(itemID, '/report-status', 'POST', payload, idempotencyKey)
}

/**
 * planImplementation 保存服务项实施方案与排期。
 * @param {string|number} itemID 服务项 ID。
 * @param {Object} payload 实施方案负载。
 * @returns {Promise<object>} 保存结果。
 * @throws {Error} 会话失效、数据校验失败或状态不允许时抛出。
 */
export function planImplementation(itemID, payload) {
  return request(`/service-items/${encodeURIComponent(itemID)}/implementation-plan`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

/**
 * startImplementationPreparation 发起服务项实施前置准备（可选字段按后端约定处理）。
 * @param {string|number} itemID 服务项 ID。
 * @param {Object} payload 附加参数。
 * @returns {Promise<object>} 准备结果。
 * @throws {Error} 会话失效、状态非法或服务端校验失败时抛出。
 */
export function startImplementationPreparation(itemID, payload) {
  return request(`/service-items/${encodeURIComponent(itemID)}/preparation`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

/**
 * submitFieldRecord 提交实施中服务项的现场记录。
 * @param {string|number} itemID 服务项 ID。
 * @param {Object} payload 现场记录负载。
 * @returns {Promise<object>} 提交结果。
 * @throws {Error} 会话失效、字段校验失败或服务端规则拒绝时抛出。
 */
export function submitFieldRecord(itemID, payload) {
  return request(`/service-items/${encodeURIComponent(itemID)}/field-records`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

/** 持久化 GPS 与时间戳签到；client_operation_id 确保离线重放安全。 */
export function checkInField(itemID, payload) {
  return request(`/service-items/${encodeURIComponent(itemID)}/field-check-ins`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

/** 将不可变的签名回执绑定到已认证工程师及采集时间。 */
export function captureFieldSignature(itemID, payload) {
  return request(`/service-items/${encodeURIComponent(itemID)}/field-signatures`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

/**
 * startFieldExecution 由项目经理确认实施准备完成，显式进入“实施中”。
 * @param {string|number} itemID 服务项 ID。
 * @param {{expected_version:number}} payload 乐观锁版本。
 * @returns {Promise<object>} 最新状态。
 */
export function startFieldExecution(itemID, payload) {
  return request(`/service-items/${encodeURIComponent(itemID)}/field-start`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function uploadServiceItemEvidence(itemID, kind, file) {
  const body = new FormData()
  body.append('kind', kind)
  body.append('file', file)
  return request(`/service-items/${encodeURIComponent(itemID)}/evidence`, { method: 'POST', body })
}

/**
 * reportDeviation 上报服务项偏差。
 * @param {string|number} itemID 服务项 ID。
 * @param {Object} payload 偏差上报负载。
 * @returns {Promise<object>} 上报结果。
 * @throws {Error} 权限不足、状态不允许或参数不符合规则时抛出。
 */
export function reportDeviation(itemID, payload) {
  return request(`/service-items/${encodeURIComponent(itemID)}/deviations`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

/**
 * reviewDeviation 审核偏差报告。
 * @param {string|number} deviationID 偏差 ID。
 * @param {Object} payload 审核反馈。
 * @returns {Promise<object>} 审核结果。
 * @throws {Error} 会话失效、无权限或偏差状态不允许审核时抛出。
 */
export function reviewDeviation(deviationID, payload) {
  return request(`/deviations/${encodeURIComponent(deviationID)}/review`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

/**
 * completeServiceItemField 确认单个服务项的现场实施完成。
 * 项目级"一刀切"完成已移除：多服务项项目里先做完的项不必等最后一个动作顺带完成。
 * @param {string|number} itemID 服务项 ID。
 * @returns {Promise<object>} 完成结果；服务项随后进入报告编制阶段。
 * @throws {Error} 会话失效、服务项不在"实施中"或权限不足时抛出。
 */
export function completeServiceItemField(itemID, payload = {}) {
  return request(`/service-items/${encodeURIComponent(itemID)}/field-complete`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

/**
 * getServiceItemFieldEvidence 读取服务项的现场证据完整性判定（BIZ-PROJECT-06）。
 * 判定由服务端按该服务项的完整事件流计算，前端不再用"租户最近 500 条事件"的窗口推导缺项。
 * @param {string|number} itemID 服务项 ID。
 * @returns {Promise<object|null>} {service_item_id, gaps, missing, evidence, evidence_complete, state, gate_policy}；无内容时为 null。
 * @throws {Error} 会话失效、无读权限、越权或判定不可用（事件超限/核验能力不可用）时抛出。
 */
export async function getServiceItemFieldEvidence(itemID) {
  const data = await request(`/service-items/${encodeURIComponent(itemID)}/field-evidence`)
  return data && typeof data === 'object' ? data : null
}

/**
 * listDeliveryEvents 查询交付事件。
 * @param {string|number} [projectID=''] 项目 ID，可空表示全量。
 * @returns {Promise<Array<object>>} 交付事件列表。
 * @throws {Error} 会话失效、鉴权失败或服务端错误时抛出。
 */
export async function listDeliveryEvents(projectID = '') {
  const query = projectID ? `?project_id=${encodeURIComponent(projectID)}` : ''
  const data = await request(`/delivery-events${query}`)
  return Array.isArray(data) ? data : []
}

/**
 * listCapabilities 查询资源能力列表（按资源类型可选过滤）。
 * @param {string} [resourceType=''] 资源类型。
 * @returns {Promise<Array<object>>} 能力列表。
 * @throws {Error} 会话失效或权限不足时抛出。
 */
export async function listCapabilities(resourceType = '') {
  const query = resourceType ? `?resource_type=${encodeURIComponent(resourceType)}` : ''
  const data = await request(`/capabilities${query}`)
  return Array.isArray(data) ? data : []
}

export async function listEquipment() {
  const data = await request('/equipment')
  return unwrapPage(data).items
}

export function upsertEquipment(payload) {
  return request('/equipment', { method: 'PUT', body: JSON.stringify({ ...payload, resource_type: 'EQUIPMENT' }) })
}

export function deleteEquipment(resourceID) {
  return request(`/equipment/${encodeURIComponent(resourceID)}`, { method: 'DELETE' })
}

/**
 * importEquipment 以 CSV 批量导入设备能力。
 * @param {File} file 原始 CSV 文件。
 * @param {number[]|null} selectedRows 本次确认的文件行号。
 * @param {string} idempotencyKey 由文件与选中行推导的稳定幂等键。
 * @returns {Promise<{imported: number, skipped: number, rows: object[]}>} 导入结果。
 * @throws {Error} 无权限、幂等键冲突或网关返回非成功状态时抛出。
 */
export function importEquipment(file, selectedRows = null, idempotencyKey = '') {
  const formData = new FormData()
  formData.append('file', file)
  if (Array.isArray(selectedRows)) formData.append('selected_rows', JSON.stringify(selectedRows))
  return request('/equipment/import', { method: 'POST', body: formData, headers: importIdempotencyHeaders(idempotencyKey) })
}

export function previewEquipmentImport(file) {
  const formData = new FormData()
  formData.append('file', file)
  return request('/equipment/import/preview', { method: 'POST', body: formData })
}

export function downloadEquipmentImportTemplate() {
  return downloadImportTemplate('/equipment/import/template', '设备能力导入模板.csv')
}

// importIdempotencyHeaders 只在确实拿到幂等键时发送请求头：缺失时让服务端按 400 失败关闭，
// 不用空字符串冒充有效键。
function importIdempotencyHeaders(idempotencyKey) {
  const key = typeof idempotencyKey === 'string' ? idempotencyKey.trim() : ''
  return key ? { 'Idempotency-Key': key } : {}
}

/**
 * upsertCapability 新增或更新人员资质/设备能力记录（按资源类型+编号覆盖能力码）。
 * @param {Object} payload 能力字段：resource_type、resource_id、resource_name、codes、status、valid_from、valid_until。
 * @returns {Promise<object>} 保存后的能力记录。
 * @throws {Error} 校验失败、权限不足或服务端异常时抛出。
 */
export function upsertCapability(payload) {
  return request('/capabilities', { method: 'PUT', body: JSON.stringify(payload) })
}

/**
 * importCapabilities 以 CSV 批量导入能力记录。
 * 确认导入必须携带 Idempotency-Key：服务端按「租户 + 键」保证重试不重复写入，
 * 同键不同内容返回 409；缺失或非法键返回 400。
 * @param {File} file 待上传的 CSV 文件。
 * @param {string} [resourceType=''] 目标资源类型，可空表示两类均可。
 * @param {number[]|null} selectedRows 本次确认的文件行号。
 * @param {string} idempotencyKey 由文件与选中行推导的稳定幂等键。
 * @returns {Promise<{imported: number, skipped: number, errors?: string[]}>} 导入结果统计。
 * @throws {Error} 解析失败、权限不足、幂等键冲突或服务端异常时抛出。
 */
export async function importCapabilities(file, resourceType = '', selectedRows = null, idempotencyKey = '') {
  const formData = new FormData()
  formData.append('file', file)
  if (resourceType) formData.append('resource_type', resourceType)
  if (Array.isArray(selectedRows)) formData.append('selected_rows', JSON.stringify(selectedRows))
  return request('/capabilities/import', { method: 'POST', body: formData, headers: importIdempotencyHeaders(idempotencyKey) })
}

export async function previewCapabilitiesImport(file) {
  const formData = new FormData()
  formData.append('file', file)
  return request('/capabilities/import/preview', { method: 'POST', body: formData })
}

export async function downloadCapabilityImportTemplate() {
  return downloadImportTemplate('/capabilities/import/template', '人员资质导入模板.csv')
}

async function requestProjectCSV(path, fallbackFilename) {
  const context = { subsystem: 'project_management', feature: 'project_download', operation: 'GET', path, method: 'GET' }
  // 导出与模板下载共用本函数；只在这里附加超时 signal，上传仍保持原有不设硬超时。
  const downloadAbort = downloadRequestSignal()
  let response
  try {
    response = await fetch(`${API_BASE_URL}${path}`, { credentials: 'include', signal: downloadAbort.signal, headers: { Accept: 'text/csv' } })
  } catch (cause) {
    if (downloadAbort.timedOut()) throw downloadTimeoutError(cause, context)
    throw projectRequestError(null, null, context, { code: 'NETWORK_ERROR', fallback: '下载未完成，请检查网络后重新下载。' })
  }
  if (!response.ok) {
    let body
    try { body = await readProjectBody(response) } catch { /* HTTP 状态及响应头仍用于诊断和登录处理。 */ }
    throw handleProjectAuthentication(projectRequestError(body, response, context, { fallback: '文件下载未完成，请稍后重试。' }), response)
  }
  const mediaType = (response.headers.get('content-type') || '').split(';', 1)[0].trim().toLowerCase()
  if (mediaType !== 'text/csv') {
    throw projectRequestError(null, response, context, { code: 'INVALID_DOWNLOAD_RESPONSE', fallback: '下载服务返回的文件格式异常，请联系管理员检查文件下载配置。' })
  }
  const filename = safeDownloadFilename(response.headers.get('content-disposition'), fallbackFilename, { extensions: ['.csv'] })
  return { response, filename, downloadAbort }
}

/**
 * downloadTimeoutError 把本端下载超时转换为项目模块可读错误，保持既有错误字段结构。
 * @param {unknown} cause 底层中断原因。
 * @param {Record<string, unknown>} context 下载请求上下文。
 * @returns {Error} 带下载超时错误码的结构化错误。
 */
function downloadTimeoutError(cause, context) {
  const error = projectRequestError(null, null, context, { code: 'DOWNLOAD_TIMEOUT', fallback: DOWNLOAD_TIMEOUT_MESSAGE })
  error.message = DOWNLOAD_TIMEOUT_MESSAGE
  error.cause = cause
  return error
}

/**
 * readDownloadBlob 读取下载响应体；超时发生在读取阶段时同样转换为可读超时错误。
 * @param {Response} response 下载响应。
 * @param {{timedOut: () => boolean}} downloadAbort 下载超时归因。
 * @param {Record<string, unknown>} context 下载请求上下文。
 * @returns {Promise<Blob>} 完整响应体。
 */
async function readDownloadBlob(response, downloadAbort, context) {
  try {
    return await response.blob()
  } catch (cause) {
    if (downloadAbort.timedOut()) throw downloadTimeoutError(cause, context)
    throw projectRequestError(null, response, context, { code: 'NETWORK_ERROR', fallback: '文件下载中断，请检查网络后重新下载。' })
  }
}

async function downloadImportTemplate(path, filename) {
  const { response, downloadAbort } = await requestProjectCSV(path)
  return { blob: await readDownloadBlob(response, downloadAbort, { subsystem: 'project_management', feature: 'project_download', operation: 'GET', path, method: 'GET' }), filename }
}

/**
 * exportCapabilities 导出能力记录为 CSV 附件（UTF-8 BOM，可直接用 Excel 打开）。
 * @param {string} [resourceType=''] 资源类型过滤。
 * @returns {Promise<{blob: Blob, filename: string}>} 下载内容与文件名。
 * @throws {Error} 权限不足、网络失败或服务端异常时抛出。
 */
export async function exportCapabilities(resourceType = '') {
  const query = resourceType ? `?resource_type=${encodeURIComponent(resourceType)}` : ''
  const fallbackFilename = `capabilities-${todayBusinessDate()}.csv`
  const path = `/capabilities/export${query}`
  const { response, filename, downloadAbort } = await requestProjectCSV(`/capabilities/export${query}`, fallbackFilename)
  return { blob: await readDownloadBlob(response, downloadAbort, { subsystem: 'project_management', feature: 'project_download', operation: 'GET', path, method: 'GET' }), filename }
}
// 用途：读取当前环境显式开放的项目创建来源。
// 参数：无。
// 返回值：包含native_enabled的能力响应；失败时抛出HTTP错误。
export function getProjectCreationCapabilities() {
  return request('/project-creation-capabilities')
}

// 用途：按本地委托创建原生项目及待确认服务范围。
// 参数：payload为稳定source_id、本地单位和服务项，来源必须为NATIVE。
// 返回值：创建或相同请求重放的项目；校验、权限和幂等冲突时抛出错误。
export function createNativeProject(payload) {
  return request('/native-projects', { method: 'POST', body: JSON.stringify(payload) })
}

// 用途：读取原生项目的当前权威范围及审批历史。
// 参数：id 为真实项目主键。
// 返回值：服务端范围状态；认证和错误沿用现有transport。
export function getNativeProjectScope(id) {
  return request(`/projects/${encodeURIComponent(id)}/native-scope`)
}

// 用途：以明确操作号提交完整本地范围提案。
// 参数：id 为项目主键，payload 为版本和冻结范围。
// 返回值：真实持久提案或明确错误。
export function requestNativeProjectScope(id, payload) {
  return request(`/projects/${encodeURIComponent(id)}/native-scope-changes`, { method: 'POST', body: JSON.stringify(payload) })
}

// 用途：执行不同人的本地范围单级审批。
// 参数：id/changeID 为真实坐标，payload 为原操作号、版本及决定。
// 返回值：真实最终提案；未知结果沿原transport标记。
export function decideNativeProjectScope(id, changeID, payload) {
  return request(`/projects/${encodeURIComponent(id)}/native-scope-changes/${encodeURIComponent(changeID)}/decision`, { method: 'POST', body: JSON.stringify(payload) })
}

// 用途：由原申请人撤回本地待审批范围。
// 参数：id/changeID 为真实坐标，payload 为原操作号和撤回意见。
// 返回值：真实撤回回执或授权及状态错误。
export function withdrawNativeProjectScope(id, changeID, payload) {
  return request(`/projects/${encodeURIComponent(id)}/native-scope-changes/${encodeURIComponent(changeID)}/withdraw`, { method: 'POST', body: JSON.stringify(payload) })
}

// 用途：读取当前项目允许公开的报销净支出摘要，不请求票据或其他项目分摊。
// 参数：projectID 为项目ID，cursor 为上一页单据游标。
// 返回值：服务端项目范围内的分页金额摘要；失败原样抛出。
export function getProjectReimbursementSpend(projectID, cursor = '') {
  const query = new URLSearchParams({ page_size: '20' })
  if (cursor) query.set('cursor', cursor)
  return request(`/projects/${encodeURIComponent(projectID)}/reimbursement-spend?${query}`)
}

// 用途：编码参与资格的有效期、版本及移除请求，不推断永久有效资格。
// 参数：form 为人工输入及当前版本，revoke 表示受控移除。
// 返回值：项目参与资格DTO；日期、原因或版本不合法时拒绝请求。
export function expenseParticipantPayload(form, revoke = false) {
  const subject = String(form.subject_id || '').trim()
  const reason = String(form.reason || '').trim()
  const version = Number(form.version ?? 0)
  if (!subject || subject.length > 128 || !reason || reason.length > 1000) throw new Error('请填写人员稳定主体和不超过1000字的原因')
  if (!Number.isSafeInteger(version) || version < 0) throw new Error('请重新读取资格当前版本')
  const value = { subject_id: subject, reason, expected_version: version, status: revoke ? 'REVOKED' : 'ACTIVE' }
  if (!revoke) {
    const fromText=String(form.valid_from||''), untilText=String(form.valid_until||'')
    const from = new Date(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(fromText) ? `${fromText}:00+08:00` : fromText)
    const until = new Date(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(untilText) ? `${untilText}:00+08:00` : untilText)
    if (!Number.isFinite(from.getTime()) || !Number.isFinite(until.getTime())
      || from >= until || until - from > 366 * 86400000) throw new Error('请填写有效起止时间，最长366天')
    value.valid_from = from.toISOString(); value.valid_until = until.toISOString()
  }
  return value
}

// 用途：读取当前项目显式费用参与资格，仅由精确管理能力触发。
// 参数：projectID 为项目标识，cursor 为上一页人员主体。
// 返回值：项目范围内的参与资格页或真实错误。
export function getProjectExpenseParticipants(projectID, cursor = '') {
  const query = new URLSearchParams({ page_size: '20', ...(cursor ? { cursor } : {}) })
  return request(`/projects/${encodeURIComponent(projectID)}/expense-participants?${query}`)
}

// 用途：按当前版本增加、修改或移除项目费用参与资格。
// 参数：projectID 为项目标识，form 为人工字段，revoke 为移除标志。
// 返回值：真实持久化资格回执；不通过前端推导项目读取权限。
export function putProjectExpenseParticipant(projectID, form, revoke = false) {
  return request(`/projects/${encodeURIComponent(projectID)}/expense-participants`, {
    method: 'PUT', body: JSON.stringify(expenseParticipantPayload(form, revoke)),
  })
}
