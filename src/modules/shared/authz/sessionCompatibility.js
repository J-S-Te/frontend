export const SUBSYSTEM_ACCESS_REASON = Object.freeze({
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  FORBIDDEN: 'FORBIDDEN',
  DEPENDENCY_UNAVAILABLE: 'DEPENDENCY_UNAVAILABLE',
  IDENTITY_NOT_PROVISIONED: 'IDENTITY_NOT_PROVISIONED',
  OIDC_CLAIMS_INVALID: 'OIDC_CLAIMS_INVALID',
  UNKNOWN: 'UNKNOWN',
})

function stringValue(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function firstString(...values) {
  for (const value of values) {
    const normalized = stringValue(value)
    if (normalized) return normalized
  }
  return ''
}

/**
 * Normalize the rolling `/auth/me` contract without deriving authorization in the browser.
 *
 * Detailed permissions and data scopes are server-owned. The frontend only carries the
 * server response for display and request context; it never expands, merges or interprets
 * scope rules. Legacy fields remain on the returned object through the object spread, but
 * no new field is derived from role_config_hash.
 */
export function normalizeAuthorizationSession(value = {}) {
  const source = value && typeof value === 'object' ? value : {}
  const identityID = firstString(
    source.identity_id,
    source.sub,
    source.user?.identity_id,
    source.user_id,
    source.user?.id,
  )
  const personID = firstString(source.person_id, source.user?.person_id, source.person?.id)
  const authorizationRevision = source.authorization_revision ?? source.authz_revision ?? null

  return {
    ...source,
    identity_id: identityID,
    person_id: personID,
    data_scopes: Array.isArray(source.data_scopes) ? source.data_scopes : [],
    authorization_revision: authorizationRevision,
    catalog_version: stringValue(source.catalog_version),
  }
}

export function principalIdentityID(value = {}) {
  return normalizeAuthorizationSession(value).identity_id
}

function errorCode(error) {
  return stringValue(error?.code).toUpperCase()
}

function errorMessage(error) {
  return stringValue(error?.message)
}

function isOIDCClaimsFailure(code, message) {
  return code === 'PORTAL_OIDC_INVALID_CLAIMS'
    || /(?:OIDC|AUTHORIZATION).*(?:INVALID.*CLAIMS|CLAIMS.*INVALID)|INVALID.*(?:OIDC|AUTHORIZATION).*CLAIMS/i.test(code)
    || /OIDC (?:authorization )?claims (?:are )?(?:not valid|invalid)/i.test(message)
}

/** Keep authentication, authorization, dependency and provisioning failures distinct. */
export function classifySubsystemAccessError(error = {}) {
  const status = Number(error?.status || 0)
  const code = errorCode(error)
  const message = errorMessage(error)

  if (code === 'PORTAL_IDENTITY_NOT_PROVISIONED') {
    return { reason: SUBSYSTEM_ACCESS_REASON.IDENTITY_NOT_PROVISIONED, status, code }
  }
  if (isOIDCClaimsFailure(code, message)) {
    return { reason: SUBSYSTEM_ACCESS_REASON.OIDC_CLAIMS_INVALID, status, code }
  }
  if (status === 403 || code === 'PORTAL_AUTHORIZATION_REQUIRED') {
    return { reason: SUBSYSTEM_ACCESS_REASON.FORBIDDEN, status, code }
  }
  if (status === 503) {
    return { reason: SUBSYSTEM_ACCESS_REASON.DEPENDENCY_UNAVAILABLE, status, code }
  }
  if (status === 401) {
    return { reason: SUBSYSTEM_ACCESS_REASON.UNAUTHENTICATED, status, code }
  }
  return { reason: SUBSYSTEM_ACCESS_REASON.UNKNOWN, status, code }
}

export function shouldStartSubsystemLogin(error) {
  return classifySubsystemAccessError(error).reason === SUBSYSTEM_ACCESS_REASON.UNAUTHENTICATED
}

function queryValue(value, limit = 160) {
  return stringValue(value).slice(0, limit)
}

export function buildSubsystemAccessErrorRoute(error, from = '') {
  const classified = classifySubsystemAccessError(error)
  if ([SUBSYSTEM_ACCESS_REASON.UNAUTHENTICATED, SUBSYSTEM_ACCESS_REASON.UNKNOWN].includes(classified.reason)) return null

  return {
    name: 'subsystem_access_error',
    query: {
      reason: classified.reason,
      from: queryValue(from, 512),
      ...(classified.code ? { code: queryValue(classified.code) } : {}),
      ...(error?.requestID || error?.traceId ? { request_id: queryValue(error.requestID || error.traceId) } : {}),
    },
    replace: true,
  }
}

export const SUBSYSTEM_ACCESS_PRESENTATION = Object.freeze({
  [SUBSYSTEM_ACCESS_REASON.UNAUTHENTICATED]: Object.freeze({
    title: '登录状态已失效',
    message: '当前子系统会话已失效，请重新完成 Keycloak 登录。',
  }),
  [SUBSYSTEM_ACCESS_REASON.FORBIDDEN]: Object.freeze({
    title: '当前账号未获得访问权限',
    message: '身份认证已经完成，但服务器拒绝了当前应用访问。请联系管理员检查应用角色、权限目录和授权范围。',
  }),
  [SUBSYSTEM_ACCESS_REASON.DEPENDENCY_UNAVAILABLE]: Object.freeze({
    title: '统一授权依赖暂时不可用',
    message: 'Keycloak、统一授权上下文或目标子系统暂时不可用。服务器未在依赖故障时放宽权限，请稍后重试。',
  }),
  [SUBSYSTEM_ACCESS_REASON.IDENTITY_NOT_PROVISIONED]: Object.freeze({
    title: '客户门户身份尚未预配',
    message: '统一认证和应用授权已完成，但当前账号尚未绑定客户门户身份。请联系客户服务人员完成客户映射。',
  }),
  [SUBSYSTEM_ACCESS_REASON.OIDC_CLAIMS_INVALID]: Object.freeze({
    title: 'OIDC 登录响应校验失败',
    message: '服务器未接受本次 Keycloak 登录响应。请重新发起登录；若仍失败，请管理员检查 Client、回调地址和 Claims 映射。',
  }),
  [SUBSYSTEM_ACCESS_REASON.UNKNOWN]: Object.freeze({
    title: '暂时无法进入子系统',
    message: '服务器未能完成当前访问请求，请稍后重试。',
  }),
})

export function subsystemAccessMessage(error, fallback = '服务暂时不可用，请稍后重试。') {
  const { reason } = classifySubsystemAccessError(error)
  if (reason === SUBSYSTEM_ACCESS_REASON.UNKNOWN) return errorMessage(error) || fallback
  return SUBSYSTEM_ACCESS_PRESENTATION[reason]?.message || fallback
}
