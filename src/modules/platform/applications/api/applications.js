const API_BASE_URL = (import.meta.env?.VITE_API_BASE_URL || '/api/v1').replace(/\/$/, '')

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

async function readBody(response) {
  const contentType = response.headers.get('content-type') || ''
  if (contentType.includes('application/json')) {
    try {
      return await response.json()
    } catch {
      return {}
    }
  }
  const text = await response.text()
  return text ? { message: text } : {}
}

async function request(path, options = {}) {
  let response
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...options,
      credentials: 'include',
      // 应用和门户目录是租户/用户授权投影；bp_session Cookie 切换后，浏览器或反向代理
      // 绝不能复用上一账号的目录响应。
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        'Cache-Control': 'no-cache',
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers || {}),
      },
    })
  } catch {
    throw new ApplicationRegistryError('无法连接应用注册服务，请确认后端服务已启动。', { code: 'NETWORK_ERROR' })
  }
  const body = await readBody(response)
  if (!response.ok) {
    throw new ApplicationRegistryError(body?.message || '应用注册请求失败。', {
      status: response.status,
      code: body?.code,
      traceId: body?.request_id || body?.trace_id || body?.traceId,
      details: body?.details,
      nextAction: body?.details?.next_action,
    })
  }
  return body?.data
}

function pageQuery(parameters = {}) {
  const search = new URLSearchParams()
  Object.entries(parameters).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return
    search.set(key, String(value))
  })
  const encoded = search.toString()
  return encoded ? `?${encoded}` : ''
}

/** 列出租户内已登记的应用（默认只取 ACTIVE）。 */
export function listApplications({ page = 1, pageSize = 100, status = 'ACTIVE', keyword = '' } = {}) {
  return request(`/applications${pageQuery({ page, page_size: pageSize, status, keyword })}`)
}

/** 查询一个应用的最新控制面记录。 */
export function getApplication({ applicationId } = {}) {
  if (!applicationId) throw new ApplicationRegistryError('applicationId 不能为空。', { code: 'VALIDATION_ERROR' })
  return request(`/applications/${encodeURIComponent(applicationId)}`)
}

/** 创建一个业务子系统登记；OAuth 客户端与登录目标仍通过各自独立接口维护。 */
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

/** 更新应用可变登记信息；应用编码保持稳定，version 必须来自最近一次查询。 */
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
 * 删除一个应用登记。后端实际将应用退役为 RETIRED，以保留环境、OAuth 客户端、
 * 登录目标及审计历史；confirmationCode 必须与稳定应用编码完全一致。
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

/** 列出指定应用下的部署环境（默认只取 ACTIVE）。 */
export function listEnvironments({ applicationId, page = 1, pageSize = 50, status = 'ACTIVE' } = {}) {
  if (!applicationId) {
    return Promise.resolve({ items: [], total: 0, page: 1, page_size: pageSize })
  }
  return request(`/applications/${encodeURIComponent(applicationId)}/environments${pageQuery({ page, page_size: pageSize, status })}`)
}

/** 创建应用环境。网关字段用于把外部公开地址映射到门户主机可达的内部上游。 */
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

/** 更新应用环境；version 必须使用最近一次查询返回的乐观锁版本。 */
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

/** 删除一个非 dev 环境及其派生的登录目标和 OAuth Client。 */
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
 * 一次完成应用登记、环境配置、登录目标、OAuth 客户端和自动部署。
 * 该接口是受控编排入口，不等同于依次调用普通 CRUD；部分失败的补偿和幂等由后端负责。
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
      ...(String(initialAdminUserId || '').trim()
        ? { initial_admin_user_id: String(initialAdminUserId).trim() }
        : {}),
    }),
  })
}

/** 查询部署 Agent 的持久化状态，页面刷新后仍可恢复真实部署结果。 */
export function getSubsystemStatus({ applicationCode, environment } = {}) {
  return request(`/subsystem-status${pageQuery({ application_code: applicationCode, environment })}`)
}

/** 查询后端部署 Agent 的非敏感能力，用于按真实服务器模式渲染接入表单。 */
export function getSubsystemCapabilities() {
  return request('/subsystem-capabilities')
}

/** 重新执行既有子系统运行时部署，不重复创建接入记录。 */
export function retrySubsystem({ applicationCode, environment } = {}) {
  return request('/subsystem-retry', {
    method: 'POST',
    body: JSON.stringify({ application_code: applicationCode, environment }),
  })
}

/** 按已有控制面配置重新部署子系统运行时。 */
export function updateSubsystemRuntime({ applicationCode, environment } = {}) {
  return request('/subsystem-update', {
    method: 'POST',
    body: JSON.stringify({ application_code: applicationCode, environment }),
  })
}

/** 清理子系统运行时；数据库环境记录仍需通过 deleteEnvironment 删除。 */
export function teardownSubsystem({ applicationCode, environment } = {}) {
  return request('/subsystem-teardown', {
    method: 'POST',
    body: JSON.stringify({ application_code: applicationCode, environment }),
  })
}

/** 查询当前登录用户已获得应用角色、可显示在子系统门户中的 ACTIVE 应用。 */
export function listPortalApplications({ environment = '' } = {}) {
  return request(`/portal/applications${pageQuery({ environment })}`)
}
