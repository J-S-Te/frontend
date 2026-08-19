import { getCurrentPrincipal } from '@/modules/platform/auth/api/auth'
import {
  normalizeAuthorizationSession,
  principalIdentityID,
  shouldStartSubsystemLogin,
} from '../../shared/authz/sessionCompatibility.js'
import { attachStructuredContext } from '../../platform/shared/api/requestContext.js'

const runtimeEnv = import.meta.env || {}
const PUBLIC_PATH_PREFIX = (runtimeEnv.VITE_PROJECT_PUBLIC_PATH_PREFIX || '/project_management').replace(/\/$/, '')
const API_BASE_URL = (runtimeEnv.VITE_PROJECT_API_BASE_URL || `${PUBLIC_PATH_PREFIX}/api/v1`).replace(/\/$/, '')
let currentSession = null
let sessionRequest = null
let loginRedirectStarted = false

function startProjectLogin() {
  // 并发请求共享一次登录跳转，并在跳转前清空旧主体缓存。
  if (loginRedirectStarted) return
  loginRedirectStarted = true
  clearProjectSessionCache()
  window.location.replace(`${PUBLIC_PATH_PREFIX}/auth/login`)
}

async function request(path, options = {}) {
  const method = String(options.method || 'GET').toUpperCase()
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
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers || {}),
      },
    })
  } catch (error) {
    const requestError = new Error('无法连接项目管理服务，请稍后重试。')
    attachStructuredContext(requestError, {
      ...requestContext,
      metadata: { ...requestContext, network: true, rawError: String(error || '').slice(0, 160) },
    }, {
      status: 0,
      code: 'NETWORK_ERROR',
      requestId: '',
      traceId: '',
    })
    throw requestError
  }
  const contentType = response.headers.get('content-type') || ''
  const body = contentType.includes('application/json') ? await response.json() : { message: await response.text() }
  if (!response.ok) {
    const error = new Error(body?.message || `HTTP ${response.status}`)
    attachStructuredContext(error, {
      ...requestContext,
      tenantId: String(body?.tenant_id || ''),
      requestId: body?.request_id || '',
      traceId: body?.trace_id || body?.traceId || '',
      metadata: { source: 'project_api' },
    }, {
      status: response.status,
      code: body?.code,
      requestId: body?.request_id || '',
      traceId: body?.trace_id || body?.traceId || '',
    })
    error.status = response.status
    error.code = body?.code
    error.requestID = body?.request_id || ''
    error.details = body?.details || null
    if (response.status === 401) {
      if (!error.code) error.code = 'PROJECT_UNAUTHENTICATED'
      if (shouldStartSubsystemLogin(error)) startProjectLogin()
      throw error
    }
    throw error
  }
  return body?.data ?? body
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
export async function getProjectSession({ force = false } = {}) {
  // 合并同一时刻的 /auth/me 请求，防止多个组件各自读取并提交不同时间点的会话。
  if (!force && currentSession) return currentSession
  if (!force && sessionRequest) return sessionRequest
  sessionRequest = request('/auth/me').then((session) => { currentSession = normalizeAuthorizationSession(session); return currentSession }).finally(() => { sessionRequest = null })
  return sessionRequest
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
    const projectSession = await getProjectSession({ force: true })
    try {
      const platformPrincipal = await getCurrentPrincipal()
      const platformIdentityID = principalIdentityID(platformPrincipal)
      const projectIdentityID = principalIdentityID(projectSession)
      const userChanged = platformIdentityID && projectIdentityID && platformIdentityID !== projectIdentityID
      const platformTenantID = String(platformPrincipal?.tenant_id || platformPrincipal?.tenant?.id || '')
      const tenantChanged = platformTenantID && platformTenantID !== String(projectSession?.tenant_id || '')
      if (userChanged || tenantChanged) { await clearProjectLocalSession(); startProjectLogin(); return null }
    } catch { /* 基础平台暂时不可用时，项目 OIDC 会话仍按自身有效期独立生效。 */ }
    return projectSession
  } catch (error) {
    if (shouldStartSubsystemLogin(error)) { startProjectLogin(); return null }
    throw error
  }
}

/**
 * listProjects 按前端约定参数查询项目列表，并在返回非数组时兜底为空列表。
 *
 * @param {Record<string, string|number|boolean>} [params={}] 查询条件。支持 keyword 兼容映射为 q。
 * @returns {Promise<Array<object>>} 项目列表。
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
  return Array.isArray(data) ? data : []
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
 * listServiceItems 查询项目下的服务项；projectID 为空时返回全部。
 * @param {string|number} [projectID=''] 可选项目 ID。
 * @returns {Promise<Array<object>>} 服务项列表。
 * @throws {Error} 会话失效、鉴权失败或网关返回非成功状态时抛出。
 */
export async function listServiceItems(projectID = '') {
  const search = projectID ? `?project_id=${encodeURIComponent(projectID)}` : ''
  const data = await request(`/service-items${search}`)
  return Array.isArray(data) ? data : []
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
 * listRules 查询项目规则列表（含启停状态）。
 * @returns {Promise<Array<object>>} 规则列表。
 * @throws {Error} 会话失效、鉴权失败或网关返回非成功状态时抛出。
 */
export async function listRules() {
  const data = await request('/rules')
  return Array.isArray(data) ? data : []
}

/**
 * createRule 新建规则定义。
 * @param {Object} payload 规则内容。
 * @returns {Promise<object>} 创建结果。
 * @throws {Error} 入参非法、冲突或操作被拒绝时抛出。
 */
export function createRule(payload) {
  return request('/rules', { method: 'POST', body: JSON.stringify(payload) })
}

/**
 * setRuleEnabled 更新单条规则启停。
 * @param {string|number} id 规则 ID。
 * @param {boolean} enabled 是否启用。
 * @returns {Promise<object>} 更新后的规则信息。
 * @throws {Error} 规则不存在、版本校验失败或无权限时抛出。
 */
export function setRuleEnabled(id, enabled) {
  return request(`/rules/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ enabled }) })
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
 * activateContract 激活合同接收流程并返回可用于后续阶段操作的合同信息。
 * @param {Object} payload 合同激活参数。
 * @returns {Promise<object>} 激活后的执行结果。
 * @throws {Error} 合同数据非法、重复激活或权限不足时抛出。
 */
export function activateContract(payload) {
  return request('/contracts/activate', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

/**
 * adjustDecomposition 更新项目服务项的拆解或分工结构。
 * @param {string|number} projectID 项目 ID。
 * @param {Object} payload 拆解调整数据。
 * @returns {Promise<object>} 调整结果。
 * @throws {Error} 会话失效、项目状态不允许重算时抛出。
 */
export function adjustDecomposition(projectID, payload) {
  return request(`/projects/${encodeURIComponent(projectID)}/decomposition-adjustments`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

/**
 * assignServiceItem 为服务项分配签派/负责人。
 * @param {string|number} itemID 服务项 ID。
 * @param {Object} payload 分配负载。
 * @returns {Promise<object>} 分配结果。
 * @throws {Error} 参数非法或服务项状态不允许分配时抛出。
 */
export function assignServiceItem(itemID, payload) {
  return request(`/service-items/${encodeURIComponent(itemID)}/assignment`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
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
 * fieldCheckIn 提交实地核验签到记录。
 * @param {string|number} itemID 服务项 ID。
 * @param {Object} payload 签到负载。
 * @returns {Promise<object>} 提交结果。
 * @throws {Error} 请求参数无效、当前状态不允许签到或权限不足时抛出。
 */
export function fieldCheckIn(itemID, payload) {
  return request(`/service-items/${encodeURIComponent(itemID)}/check-in`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

/**
 * submitFieldRecord 提交服务项现场记录。
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
 * completeFieldImplementation 完成现场实施阶段，触发后续验收节点。
 * @param {string|number} projectID 项目 ID。
 * @returns {Promise<object>} 完成结果。
 * @throws {Error} 会话失效、项目状态不允许完成现场实施时抛出。
 */
export function completeFieldImplementation(projectID) {
  return request(`/projects/${encodeURIComponent(projectID)}/field-complete`, {
    method: 'POST',
  })
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

/**
 * saveCapability 维护能力定义（增/改）。
 * @param {Object} payload 能力对象。
 * @returns {Promise<object>} 保存结果。
 * @throws {Error} 入参非法或无权限更新能力时抛出。
 */
export function saveCapability(payload) {
  return request('/capabilities', {
    method: 'PUT',
    body: JSON.stringify(payload),
  })
}
