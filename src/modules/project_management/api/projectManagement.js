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
        ...(options.body && !(options.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
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
 * createRule 新建配置规则（按 kind 落入五套真实配置表中的对应一张）。
 * @param {Object} payload 规则内容。
 * @returns {Promise<object>} 创建结果。
 * @throws {Error} 入参非法、冲突或操作被拒绝时抛出。
 */
export function createRule(payload) {
  return request('/rules', { method: 'POST', body: JSON.stringify(payload) })
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
 * updateReportStatus 推进服务项报告状态（编制中→已审核→已签发→已归档）。
 * @param {string|number} itemID 服务项 ID。
 * @param {string} phase 目标阶段（COMPILING / REVIEWED / ISSUED / ARCHIVED）。
 * @returns {Promise<object>} 更新结果。
 * @throws {Error} 状态不允许、无权限或目标阶段非法时抛出。
 */
export function updateReportStatus(itemID, phase) {
  return request(`/service-items/${encodeURIComponent(itemID)}/report-status`, {
    method: 'POST',
    body: JSON.stringify({ phase }),
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
 * submitFieldRecord 提交服务项现场记录；提交成功即代表该服务项进入"实施中"。
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
 * completeServiceItemField 确认单个服务项的现场实施完成。
 * 项目级"一刀切"完成已移除：多服务项项目里先做完的项不必等最后一个动作顺带完成。
 * @param {string|number} itemID 服务项 ID。
 * @returns {Promise<object>} 完成结果；服务项随后进入报告编制阶段。
 * @throws {Error} 会话失效、服务项不在"实施中"或权限不足时抛出。
 */
export function completeServiceItemField(itemID) {
  return request(`/service-items/${encodeURIComponent(itemID)}/field-complete`, {
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

export async function listEquipment() {
  const data = await request('/equipment')
  return Array.isArray(data) ? data : []
}

export function upsertEquipment(payload) {
  return request('/equipment', { method: 'PUT', body: JSON.stringify({ ...payload, resource_type: 'EQUIPMENT' }) })
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
 * @param {File} file 待上传的 CSV 文件。
 * @param {string} [resourceType=''] 目标资源类型，可空表示两类均可。
 * @returns {Promise<{imported: number, skipped: number, errors?: string[]}>} 导入结果统计。
 * @throws {Error} 解析失败、权限不足或服务端异常时抛出。
 */
export async function importCapabilities(file, resourceType = '') {
  const formData = new FormData()
  formData.append('file', file)
  if (resourceType) formData.append('resource_type', resourceType)
  return request('/capabilities/import', { method: 'POST', body: formData })
}

/**
 * exportCapabilities 导出能力记录为 CSV 附件（UTF-8 BOM，可直接用 Excel 打开）。
 * @param {string} [resourceType=''] 资源类型过滤。
 * @returns {Promise<{blob: Blob, filename: string}>} 下载内容与文件名。
 * @throws {Error} 权限不足、网络失败或服务端异常时抛出。
 */
export async function exportCapabilities(resourceType = '') {
  const query = resourceType ? `?resource_type=${encodeURIComponent(resourceType)}` : ''
  const response = await fetch(`${API_BASE_URL}/capabilities/export${query}`, {
    credentials: 'include',
    headers: { Accept: '*/*' },
  })
  if (!response.ok) {
    let message = `HTTP ${response.status}`
    try {
      const parsed = await response.json()
      message = parsed?.message || message
    } catch { /* 保持默认提示 */ }
    const error = new Error(message)
    error.status = response.status
    throw error
  }
  const disposition = response.headers.get('content-disposition') || ''
  let filename = `capabilities-${new Date().toISOString().slice(0, 10)}.csv`
  const match = disposition.match(/filename\*?=(?:UTF-8''|")?([^";]+)/i)
  if (match) filename = match[1].replace(/^"|"$/g, '')
  return { blob: await response.blob(), filename }
}
