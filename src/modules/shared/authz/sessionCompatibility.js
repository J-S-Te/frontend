export const SUBSYSTEM_ACCESS_REASON = Object.freeze({
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  FORBIDDEN: 'FORBIDDEN',
  DEPENDENCY_UNAVAILABLE: 'DEPENDENCY_UNAVAILABLE',
  IDENTITY_NOT_PROVISIONED: 'IDENTITY_NOT_PROVISIONED',
  OIDC_CLAIMS_INVALID: 'OIDC_CLAIMS_INVALID',
  // 子系统 OIDC 回调阶段失败（state 失效 / 令牌交换 / id_token 校验 / authorization_context
  // 无法解析等）。后端在每个失败点都会带着 stage 跳到 /access-error?reason=CALLBACK_FAILED。
  CALLBACK_FAILED: 'CALLBACK_FAILED',
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
 * 规范化滚动更新中的 `/auth/me` 契约，不在浏览器推导授权。
 *
 * 详细权限和数据范围由服务端管理。前端仅携带服务端响应，用于展示与请求上下文；
 * 不扩展、合并或解释范围规则。对象展开会保留返回对象中的旧字段，
 * 但不从 role_config_hash 推导任何新字段。
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

/** 明确区分认证、授权、依赖和配置供给失败。 */
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
  if ([502, 503, 504].includes(status)) {
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
    message: '当前登录状态已过期，请重新登录后继续操作。',
  }),
  [SUBSYSTEM_ACCESS_REASON.FORBIDDEN]: Object.freeze({
    title: '当前账号未获得访问权限',
    message: '你已登录，但尚未获得此系统或相关数据的访问权限，请联系管理员确认账号权限和数据范围。',
  }),
  [SUBSYSTEM_ACCESS_REASON.DEPENDENCY_UNAVAILABLE]: Object.freeze({
    title: '子系统或依赖服务暂时不可用',
    message: '目标系统暂时无法访问，可能尚未部署、已停用或服务异常。请稍后重试；仍失败时请联系管理员检查运行状态。',
  }),
  [SUBSYSTEM_ACCESS_REASON.IDENTITY_NOT_PROVISIONED]: Object.freeze({
    title: '当前账号尚未关联客户',
    message: '当前账号还不能进入客户门户，请联系客户服务人员完成账号与客户的关联。',
  }),
  [SUBSYSTEM_ACCESS_REASON.OIDC_CLAIMS_INVALID]: Object.freeze({
    title: '登录信息未通过校验',
    message: '本次登录信息与应用配置不一致，请重新登录；仍失败时请联系管理员检查应用接入配置。',
  }),
  [SUBSYSTEM_ACCESS_REASON.CALLBACK_FAILED]: Object.freeze({
    title: '暂时未能完成系统登录',
    message: '进入目标系统时未能完成身份确认，请点击「重新登录」再试；若仍失败，请把下方排查信息提供给管理员。',
  }),
  [SUBSYSTEM_ACCESS_REASON.UNKNOWN]: Object.freeze({
    title: '暂时无法进入子系统',
    message: '服务器未能完成当前访问请求，请稍后重试。',
  }),
})

/**
 * 子系统功能权限被拒绝（`PM_FORBIDDEN`、`SETTLEMENT_FORBIDDEN` 等）与
 * 账号完全无权访问应用（`PORTAL_AUTHORIZATION_REQUIRED`、`*_AUTHORIZATION_DENIED`）
 * 是不同情况。二者均返回 403；若用户会话有效却只缺少某个功能角色，
 * 提示“服务器拒绝此应用”会将用户引向错误的处理方向。
 */
function isFeaturePermissionDenial(code) {
  return /_FORBIDDEN$/.test(code) && !/AUTHORIZATION/.test(code)
}

export function subsystemAccessMessage(error, fallback = '服务暂时不可用，请稍后重试。') {
  if (isFeaturePermissionDenial(errorCode(error))) {
    return '当前账号没有访问该功能的权限，请联系管理员分配对应的应用角色。'
  }
  // 503 不只表示统一认证依赖故障。业务子系统会用稳定错误码区分工作流、
  // 人员目录等依赖；这类错误应保留后端已经脱敏的业务文案，避免误导用户
  // 去排查 Keycloak。只有明确的授权依赖错误或无错误码的旧响应沿用通用提示。
  const code = errorCode(error)
  if (Number(error?.status || 0) === 503 && code && code !== 'AUTH_DEPENDENCY_UNAVAILABLE') {
    return errorMessage(error) || fallback
  }
  const { reason } = classifySubsystemAccessError(error)
  if (reason === SUBSYSTEM_ACCESS_REASON.UNKNOWN) return errorMessage(error) || fallback
  return SUBSYSTEM_ACCESS_PRESENTATION[reason]?.message || fallback
}
