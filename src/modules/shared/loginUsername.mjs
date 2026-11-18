import { principalIdentityID } from './authz/sessionCompatibility.js'

// 用途：读取已认证响应中的非空文本字段，拒绝异常类型。
// 参数：value 为服务端返回的账号或身份字段。
// 返回值：去除首尾空白的文本；字段无效时返回空字符串。
function sessionText(value) {
  return typeof value === 'string' ? value.trim() : ''
}

// 用途：兼容各系统认证响应中的平台主体字段，仅用于用户名展示匹配。
// 参数：session 为当前系统已认证会话，含普通、报销或客户门户主体字段。
// 返回值：平台主体标识；缺失时返回空字符串，不用于推导权限。
export function loginIdentityID(session) {
  return sessionText(session?.identity_id) || sessionText(session?.subject_id)
    || sessionText(session?.platform_user_id) || principalIdentityID(session)
}

// 用途：统一读取登录用户名，同主体同租户时优先采用平台真实账号。
// 参数：session 为当前系统会话；platformPrincipal 为可选的平台已认证主体。
// 返回值：登录用户名；没有可信账号时返回“当前用户”，不以姓名或内部投影替代。
export function loginUsername(session, platformPrincipal = null) {
  const identityID = loginIdentityID(session)
  const tenantID = sessionText(session?.tenant_id) || sessionText(session?.tenant?.id)
  const platformTenant = sessionText(platformPrincipal?.tenant_id)
    || sessionText(platformPrincipal?.tenant?.id)
  const matched = identityID && tenantID && tenantID === platformTenant
    && identityID === loginIdentityID(platformPrincipal)
  const account = matched ? platformPrincipal?.account : session?.account
  const registeredUsername = sessionText(account?.name) || sessionText(account?.code)
  if (registeredUsername) return registeredUsername

  // Keycloak 使用稳定主体生成内部账号，只过滤与当前主体精确对应的投影名。
  const projectedUsername = identityID
    ? `platform-${identityID.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '-')}` : ''
  for (const key of ['username', 'preferred_username', 'user_name', 'account_name']) {
    const value = sessionText(session?.[key])
    if (value && value !== projectedUsername) return value
  }
  return '当前用户'
}
