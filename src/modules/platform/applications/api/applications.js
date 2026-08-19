import { createRequest } from '../../shared/api/request.js'

/**
 * ApplicationRegistryError 表示应用接入与运行时管理接口的结构化错误。
 * @property {number} status HTTP 状态码；网络异常时为 0。
 * @property {string} code 服务端错误码。
 * @property {string} traceId 请求跟踪标识。
 * @property {Object} details 服务端的结构化详情。
 * @property {string} nextAction 服务端建议的后续操作。
 */
export class ApplicationRegistryError extends Error {
  constructor(message, options = {}) {
    super(message)
    this.name = 'ApplicationRegistryError'
    this.status = options.status || 0
    this.code = options.code || ''
    this.traceId = options.traceId || ''
    this.details = options.details && typeof options.details === 'object' ? options.details : {}
    this.nextAction = options.nextAction || this.details.next_action || ''
    this.detail = options.detail || this.details.detail || ''
  }
}


const request = createRequest({
  ErrorClass: ApplicationRegistryError,
  networkMessage: '无法连接应用注册服务，请确认后端服务已启动。',
  failureMessage: '应用注册请求失败。',
  subsystem: 'platform',
  feature: 'applications',
})
function pageQuery(parameters = {}) {
  const search = new URLSearchParams()
  Object.entries(parameters).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return
    search.set(key, String(value))
  })
  const encoded = search.toString()
  return encoded ? `?${encoded}` : ''
}

/**
 * listApplications 分页查询租户内已登记的应用。
 * @param {Object} [options] 查询参数，包含 page、pageSize、status 和 keyword。
 * @returns {Promise<Object>} 返回应用分页数据。
 * @throws {ApplicationRegistryError} 会话无效、无查询权限或应用注册服务不可用时抛出。
 */
export function listApplications({ page = 1, pageSize = 100, status = 'ACTIVE', keyword = '' } = {}) {
  return request(`/applications${pageQuery({ page, page_size: pageSize, status, keyword })}`)
}

/**
 * getApplication 查询指定应用的最新控制面记录。
 * @param {Object} options 查询参数。
 * @param {string} options.applicationId 应用标识。
 * @returns {Promise<Object>} 返回应用详情。
 * @throws {ApplicationRegistryError} applicationId 为空、应用不存在或请求无权限时抛出。
 */
export function getApplication({ applicationId } = {}) {
  if (!applicationId) throw new ApplicationRegistryError('applicationId 不能为空。', { code: 'VALIDATION_ERROR' })
  return request(`/applications/${encodeURIComponent(applicationId)}`)
}

/**
 * createApplication 创建业务子系统登记，不同步创建 OAuth 客户端或登录目标。
 * @param {Object} options 应用参数，包含 code、name、applicationType、description 和 status。
 * @returns {Promise<Object>} 返回新建的应用登记。
 * @throws {ApplicationRegistryError} 应用数据无效、编码冲突或操作无权限时抛出。
 */
export function createApplication({ code, name, applicationType = 'web', description = null, status = 'ACTIVE' } = {}) {
  return request('/applications', {
    method: 'POST',
    body: JSON.stringify({
      code,
      name,
      application_type: applicationType,
      description,
      status,
    }),
  })
}

/**
 * updateApplication 更新应用可变登记信息，应用编码保持不变。
 * @param {Object} options 更新参数，包含 applicationId、name、归属信息、展示信息、status 和 version。
 * @returns {Promise<Object>} 返回更新后的应用登记。
 * @throws {ApplicationRegistryError} 必填参数为空、版本冲突、应用不存在或操作无权限时抛出。
 */
export function updateApplication({ applicationId, name, applicationType = 'web', ownerOrgId = null, ownerUserId = null, homepageUrl = null, description = null, status = 'ACTIVE', version } = {}) {
  if (!applicationId || !String(name || '').trim() || !Number.isInteger(Number(version)) || Number(version) < 1) {
    throw new ApplicationRegistryError('applicationId、name 和有效 version 均不能为空。', { code: 'VALIDATION_ERROR' })
  }
  return request(`/applications/${encodeURIComponent(applicationId)}`, {
    method: 'PATCH',
    body: JSON.stringify({
      name: String(name).trim(),
      application_type: applicationType,
      owner_org_id: ownerOrgId,
      owner_user_id: ownerUserId,
      homepage_url: homepageUrl,
      description,
      status,
      version: Number(version),
    }),
  })
}

/**
 * deleteApplicationRegistration 将应用退役为 RETIRED，保留环境、OAuth 客户端、登录目标与审计历史。
 * @param {Object} options 退役参数。
 * @param {string} options.applicationId 应用标识。
 * @param {number} options.version 当前乐观锁版本号。
 * @param {string} options.confirmationCode 必须与稳定应用编码完全一致的确认码。
 * @returns {Promise<Object>} 返回应用退役结果。
 * @throws {ApplicationRegistryError} 必填参数无效、确认码不匹配、版本冲突或应用不允许退役时抛出。
 */
export function deleteApplicationRegistration({ applicationId, version, confirmationCode } = {}) {
  const normalizedApplicationId = String(applicationId || '').trim()
  const normalizedConfirmationCode = String(confirmationCode || '').trim()
  const normalizedVersion = Number(version)
  if (!normalizedApplicationId || !normalizedConfirmationCode || !Number.isInteger(normalizedVersion) || normalizedVersion < 1) {
    throw new ApplicationRegistryError('applicationId、version 和 confirmationCode 均不能为空。', { code: 'VALIDATION_ERROR' })
  }
  return request(`/applications/${encodeURIComponent(normalizedApplicationId)}`, {
    method: 'DELETE',
    body: JSON.stringify({
      confirmation_code: normalizedConfirmationCode,
      version: normalizedVersion,
    }),
  })
}

/**
 * listEnvironments 分页查询指定应用下的部署环境。
 * @param {Object} options 查询参数，包含 applicationId、page、pageSize 和 status。
 * @returns {Promise<Object>} 返回环境分页数据；applicationId 为空时返回空页。
 * @throws {ApplicationRegistryError} 应用不存在、无查询权限或服务不可用时抛出。
 */
export function listEnvironments({ applicationId, page = 1, pageSize = 50, status = 'ACTIVE' } = {}) {
  if (!applicationId) {
    return Promise.resolve({ items: [], total: 0, page: 1, page_size: pageSize })
  }
  return request(`/applications/${encodeURIComponent(applicationId)}/environments${pageQuery({ page, page_size: pageSize, status })}`)
}

/**
 * createEnvironment 创建应用环境，并配置公开地址到内部上游的网关映射。
 * @param {Object} options 环境参数，包含 applicationId、environment、访问地址、路径、发行方别名、metadata 和 status。
 * @returns {Promise<Object>} 返回新建的应用环境。
 * @throws {ApplicationRegistryError} applicationId 为空、环境数据无效、环境冲突或操作无权限时抛出。
 */
export function createEnvironment({ applicationId, environment, baseUrl = null, upstreamUrl = null, pathPrefix = null, issuerAlias = null, metadata = {}, status = 'ACTIVE' } = {}) {
  if (!applicationId) throw new ApplicationRegistryError('applicationId 不能为空。', { code: 'VALIDATION_ERROR' })
  return request(`/applications/${encodeURIComponent(applicationId)}/environments`, {
    method: 'POST',
    body: JSON.stringify({
      environment,
      base_url: baseUrl,
      upstream_url: upstreamUrl,
      path_prefix: pathPrefix,
      issuer_alias: issuerAlias,
      metadata,
      status,
    }),
  })
}

/**
 * updateEnvironment 更新应用环境及网关映射配置。
 * @param {Object} options 更新参数，包含 applicationId、environmentId、访问地址、路径、metadata、status 和 version。
 * @returns {Promise<Object>} 返回更新后的环境。
 * @throws {ApplicationRegistryError} 必填标识为空、环境不存在、版本冲突或配置无效时抛出。
 */
export function updateEnvironment({ applicationId, environmentId, baseUrl = null, upstreamUrl = null, pathPrefix = null, issuerAlias = null, metadata = {}, status = 'ACTIVE', version } = {}) {
  if (!applicationId || !environmentId) throw new ApplicationRegistryError('applicationId 和 environmentId 不能为空。', { code: 'VALIDATION_ERROR' })
  return request(`/applications/${encodeURIComponent(applicationId)}/environments/${encodeURIComponent(environmentId)}`, {
    method: 'PATCH',
    body: JSON.stringify({
      base_url: baseUrl,
      upstream_url: upstreamUrl,
      path_prefix: pathPrefix,
      issuer_alias: issuerAlias,
      metadata,
      status,
      version,
    }),
  })
}

/**
 * deleteEnvironment 删除一个非 dev 环境及其派生的登录目标和 OAuth 客户端。
 * @param {Object} options 删除参数，包含 applicationId、environmentId、confirmationCode 和 version。
 * @returns {Promise<Object>} 返回环境下线结果。
 * @throws {ApplicationRegistryError} 参数无效、dev 环境不允许删除、确认失败或版本冲突时抛出。
 */
export function deleteEnvironment({ applicationId, environmentId, confirmationCode, version } = {}) {
  if (!applicationId || !environmentId || !String(confirmationCode || '').trim() || !Number.isInteger(Number(version)) || Number(version) < 1) {
    throw new ApplicationRegistryError('应用、环境、确认码和有效 version 均不能为空。', { code: 'VALIDATION_ERROR' })
  }
  return request(`/applications/${encodeURIComponent(applicationId)}/environments/${encodeURIComponent(environmentId)}`, {
    method: 'DELETE',
    body: JSON.stringify({ confirmation_code: String(confirmationCode).trim(), version: Number(version) }),
  })
}

/**
 * purgeEnvironment 在完成保留审批和下线确认后，永久清除已下线环境。
 * @param {Object} options 清除参数，包含应用与环境标识、确认码、审批号、两项确认及 version。
 * @returns {Promise<Object>} 返回永久清除结果。
 * @throws {ApplicationRegistryError} 必填确认缺失、审批无效、环境尚未下线或版本冲突时抛出。
 */
export function purgeEnvironment({ applicationId, environmentId, confirmationCode, retentionApprovalId, retentionConfirmed, offboardedConfirmed, version } = {}) {
  if (!applicationId || !environmentId || !String(confirmationCode || '').trim() || !String(retentionApprovalId || '').trim() || !retentionConfirmed || !offboardedConfirmed || !Number.isInteger(Number(version)) || Number(version) < 1) {
    throw new ApplicationRegistryError('应用、环境、确认码、审批编号、下线确认和有效 version 均不能为空。', { code: 'VALIDATION_ERROR' })
  }
  return request(`/applications/${encodeURIComponent(applicationId)}/environments/${encodeURIComponent(environmentId)}/purge`, {
    method: 'POST',
    body: JSON.stringify({
      confirmation_code: String(confirmationCode).trim(),
      retention_approval_id: String(retentionApprovalId).trim(),
      retention_confirmed: true,
      offboarded_confirmed: true,
      version: Number(version),
    }),
  })
}

/**
 * onboardSubsystem 一次完成应用登记、环境配置、登录目标、OAuth 客户端和自动部署。
 * 该接口是受控编排入口，不等同于依次调用普通 CRUD；部分失败的补偿和幂等由后端负责。
 * @param {Object} options 接入参数，包含应用编码与名称、环境、公开与上游地址、路径、客户端类型及可选初始管理员。
 * @returns {Promise<Object>} 返回编排后的接入记录与部署状态。
 * @throws {ApplicationRegistryError} 接入参数无效、资源冲突、编排失败或操作无权限时抛出。
 */
export function onboardSubsystem({
  applicationCode,
  applicationName,
  description = null,
  environment = 'prod',
  publicBaseUrl,
  upstreamUrl,
  pathPrefix = '',
  clientType = 'confidential',
  initialAdminUserId = '',
  issuerAlias = '',
} = {}) {
  return request('/subsystem-onboarding', {
    method: 'POST',
    body: JSON.stringify({
      application_code: applicationCode,
      application_name: applicationName,
      description,
      environment,
      public_base_url: publicBaseUrl,
      upstream_url: upstreamUrl,
      path_prefix: pathPrefix,
      client_type: clientType,
      ...(String(issuerAlias || '').trim() ? { issuer_alias: String(issuerAlias).trim() } : {}),
      ...(String(initialAdminUserId || '').trim()
        ? { initial_admin_user_id: String(initialAdminUserId).trim() }
        : {}),
    }),
  })
}

/**
 * registerSubsystemDirectory 仅登记应用、环境和登录目标，不创建 Keycloak Client 也不部署运行时。
 * @param {Object} options 目录登记参数，包含应用编码与名称、环境、公开与上游地址、路径及发行方别名。
 * @returns {Promise<Object>} 返回应用目录登记结果。
 * @throws {ApplicationRegistryError} 登记参数无效、应用或环境冲突、登录目标创建失败时抛出。
 */
export function registerSubsystemDirectory({
  applicationCode,
  applicationName,
  description = null,
  environment = 'prod',
  publicBaseUrl,
  upstreamUrl,
  pathPrefix = '',
  issuerAlias = '',
} = {}) {
  return request('/subsystem-directory', {
    method: 'POST',
    body: JSON.stringify({
      application_code: applicationCode,
      application_name: applicationName,
      description,
      environment,
      public_base_url: publicBaseUrl,
      upstream_url: upstreamUrl,
      path_prefix: pathPrefix,
      ...(String(issuerAlias || '').trim() ? { issuer_alias: String(issuerAlias).trim() } : {}),
    }),
  })
}

/**
 * getSubsystemStatus 查询部署 Agent 的持久化状态。
 * @param {Object} options 包含 applicationCode 和 environment 的定位参数。
 * @returns {Promise<Object>} 返回页面刷新后仍可恢复的真实部署结果。
 * @throws {ApplicationRegistryError} 子系统不存在、无查询权限或部署服务不可用时抛出。
 */
export function getSubsystemStatus({ applicationCode, environment } = {}) {
  return request(`/subsystem-status${pageQuery({ application_code: applicationCode, environment })}`)
}

/**
 * getKeycloakIntegrationStatus 查询持久化的非敏感 Keycloak Client、映射与切换状态。
 * @param {Object} options 包含 applicationCode 和 environment 的定位参数。
 * @returns {Promise<Object>} 返回 Keycloak 集成状态。
 * @throws {ApplicationRegistryError} 集成记录不存在、无查询权限或服务不可用时抛出。
 */
export function getKeycloakIntegrationStatus({ applicationCode, environment } = {}) {
  return request(`/keycloak-integration/status${pageQuery({ application_code: applicationCode, environment })}`)
}

/**
 * startKeycloakObservation 启动由服务端控制的七天 Keycloak 观察期。
 * @param {Object} options 包含 applicationCode 和 environment 的定位参数。
 * @returns {Promise<Object>} 返回观察期状态。
 * @throws {ApplicationRegistryError} 当前集成阶段不允许启动、子系统不存在或操作无权限时抛出。
 */
export function startKeycloakObservation({ applicationCode, environment } = {}) {
  return request('/keycloak-integration/observation', {
    method: 'POST',
    body: JSON.stringify({ application_code: applicationCode, environment }),
  })
}

/**
 * listKeycloakProjectionFailures 分页查询持久化的 Keycloak 授权投影失败记录，不返回负载或密钥。
 * @param {Object} [options] 查询参数，包含 page、pageSize、applicationCode 和 environment。
 * @returns {Promise<Object>} 返回失败投影分页数据。
 * @throws {ApplicationRegistryError} 无查询权限或 Keycloak 集成服务不可用时抛出。
 */
export function listKeycloakProjectionFailures({ page = 1, pageSize = 50, applicationCode = '', environment = '' } = {}) {
  return request(`/keycloak-integration/projection-failures${pageQuery({ page, page_size: pageSize, application_code: applicationCode, environment })}`)
}

/**
 * getKeycloakProjectionAlerts 查询当前租户的 Keycloak 投影告警摘要。
 * @returns {Promise<Object>} 返回精简的失败计数与告警信号。
 * @throws {ApplicationRegistryError} 无查询权限或 Keycloak 集成服务不可用时抛出。
 */
export function getKeycloakProjectionAlerts() {
  return request('/keycloak-integration/projection-alerts')
}

/**
 * replayKeycloakProjectionFailure 在操作员显式确认后，将失败投影重置为待处理。
 * @param {Object} options 重放参数，包含 eventId、confirmation 和 reason。
 * @returns {Promise<Object>} 返回重放后的投影状态。
 * @throws {ApplicationRegistryError} eventId 为空、事件不在失败状态、确认无效或操作无权限时抛出。
 */
export function replayKeycloakProjectionFailure({ eventId, confirmation, reason } = {}) {
  if (!String(eventId || '').trim()) throw new ApplicationRegistryError('eventId 不能为空。', { code: 'VALIDATION_ERROR' })
  return request(`/keycloak-integration/projection-failures/${encodeURIComponent(String(eventId).trim())}/replay`, {
    method: 'POST',
    body: JSON.stringify({ confirmation, reason }),
  })
}

/**
 * getSubsystemCapabilities 查询后端部署 Agent 的非敏感能力。
 * @returns {Promise<Object>} 返回用于渲染接入表单的服务器能力。
 * @throws {ApplicationRegistryError} 无查询权限或部署 Agent 不可用时抛出。
 */
export function getSubsystemCapabilities() {
  return request('/subsystem-capabilities')
}

/**
 * discoverSubsystemCandidates 发现带标准 Docker 标签且尚未在当前租户登记的子系统。
 * @returns {Promise<Object>} 返回可接入的子系统候选项。
 * @throws {ApplicationRegistryError} 无发现权限或 Docker 发现服务不可用时抛出。
 */
export function discoverSubsystemCandidates() {
  return request('/subsystem-discovery')
}

/**
 * retrySubsystem 重试既有子系统运行时部署，不重复创建接入记录。
 * @param {Object} options 包含 applicationCode 和 environment 的定位参数。
 * @returns {Promise<Object>} 返回重试后的部署任务。
 * @throws {ApplicationRegistryError} 接入记录不存在、当前状态不允许重试或部署 Agent 不可用时抛出。
 */
export function retrySubsystem({ applicationCode, environment } = {}) {
  return request('/subsystem-retry', {
    method: 'POST',
    body: JSON.stringify({ application_code: applicationCode, environment }),
  })
}

/**
 * updateSubsystemRuntime 更新控制面访问配置并重新部署子系统运行时。
 * @param {Object} options 包含应用与环境定位、公开地址、上游地址、路径和发行方别名。
 * @returns {Promise<Object>} 返回更新后的部署任务。
 * @throws {ApplicationRegistryError} 配置无效、子系统不存在、部署失败或操作无权限时抛出。
 */
export function updateSubsystemRuntime({ applicationCode, environment, publicBaseUrl = '', upstreamUrl = '', pathPrefix = '', issuerAlias = '' } = {}) {
  return request('/subsystem-update', {
    method: 'POST',
    body: JSON.stringify({
      application_code: applicationCode,
      environment,
      ...(String(publicBaseUrl || '').trim() ? { public_base_url: String(publicBaseUrl).trim().replace(/\/$/, '') } : {}),
      ...(String(upstreamUrl || '').trim() ? { upstream_url: String(upstreamUrl).trim().replace(/\/$/, '') } : {}),
      ...(String(pathPrefix || '').trim() ? { path_prefix: String(pathPrefix).trim().replace(/\/$/, '') } : {}),
      ...(String(issuerAlias || '').trim() ? { issuer_alias: String(issuerAlias).trim().toLowerCase() } : {}),
    }),
  })
}

/**
 * syncKeycloakClient 创建或更新 Keycloak Realm Client 及所需令牌声明映射。
 * @param {Object} options 包含应用与环境定位、公开地址、上游地址和路径。
 * @returns {Promise<Object>} 返回客户端与映射同步状态。
 * @throws {ApplicationRegistryError} 接入记录不存在、地址配置无效、Keycloak 拒绝同步或操作无权限时抛出。
 */
export function syncKeycloakClient({ applicationCode, environment, publicBaseUrl, upstreamUrl, pathPrefix } = {}) {
  return request('/keycloak-integration/sync', {
    method: 'POST',
    body: JSON.stringify({
      application_code: applicationCode,
      environment,
      public_base_url: String(publicBaseUrl || '').trim().replace(/\/$/, ''),
      upstream_url: String(upstreamUrl || '').trim().replace(/\/$/, ''),
      path_prefix: String(pathPrefix || '').trim().replace(/\/$/, ''),
    }),
  })
}

/**
 * switchToKeycloak 将子系统切换到 Keycloak 认证，目标提供方由后端固定。
 * @param {Object} options 包含应用与环境定位及可选运行时地址配置。
 * @returns {Promise<Object>} 返回认证提供方切换结果。
 * @throws {ApplicationRegistryError} Keycloak 尚未就绪、观察期不满足、配置无效或切换失败时抛出。
 */
export function switchToKeycloak({ applicationCode, environment, publicBaseUrl = '', upstreamUrl = '', pathPrefix = '' } = {}) {
  return request('/keycloak-integration/switch', {
    method: 'POST',
    body: JSON.stringify({
      application_code: applicationCode,
      environment,
      ...(String(publicBaseUrl || '').trim() ? { public_base_url: String(publicBaseUrl).trim().replace(/\/$/, '') } : {}),
      ...(String(upstreamUrl || '').trim() ? { upstream_url: String(upstreamUrl).trim().replace(/\/$/, '') } : {}),
      ...(String(pathPrefix || '').trim() ? { path_prefix: String(pathPrefix).trim().replace(/\/$/, '') } : {}),
    }),
  })
}

/**
 * rollbackToPlatform 将子系统认证回滚到基础平台，目标提供方由后端固定。
 * @param {Object} options 包含应用与环境定位及可选运行时地址配置。
 * @returns {Promise<Object>} 返回认证提供方回滚结果。
 * @throws {ApplicationRegistryError} 子系统不存在、配置无效、回滚失败或操作无权限时抛出。
 */
export function rollbackToPlatform({ applicationCode, environment, publicBaseUrl = '', upstreamUrl = '', pathPrefix = '' } = {}) {
  return request('/keycloak-integration/rollback', {
    method: 'POST',
    body: JSON.stringify({
      application_code: applicationCode,
      environment,
      ...(String(publicBaseUrl || '').trim() ? { public_base_url: String(publicBaseUrl).trim().replace(/\/$/, '') } : {}),
      ...(String(upstreamUrl || '').trim() ? { upstream_url: String(upstreamUrl).trim().replace(/\/$/, '') } : {}),
      ...(String(pathPrefix || '').trim() ? { path_prefix: String(pathPrefix).trim().replace(/\/$/, '') } : {}),
    }),
  })
}

/**
 * teardownSubsystem 清理子系统运行时，不删除数据库中的环境记录。
 * @param {Object} options 包含 applicationCode 和 environment 的定位参数。
 * @returns {Promise<Object>} 返回运行时清理结果。
 * @throws {ApplicationRegistryError} 子系统不存在、当前状态不允许清理、Agent 执行失败或操作无权限时抛出。
 */
export function teardownSubsystem({ applicationCode, environment } = {}) {
  return request('/subsystem-teardown', {
    method: 'POST',
    body: JSON.stringify({ application_code: applicationCode, environment }),
  })
}

/**
 * listPortalApplications 查询当前用户已获授权且可显示在门户中的活跃应用。
 * @param {Object} [options] 查询参数。
 * @param {string} [options.environment] 可选环境筛选。
 * @returns {Promise<Object>} 返回当前用户可访问的门户应用列表。
 * @throws {ApplicationRegistryError} 会话无效或门户应用查询服务不可用时抛出。
 */
export function listPortalApplications({ environment = '' } = {}) {
  return request(`/portal/applications${pageQuery({ environment })}`)
}
