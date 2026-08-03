/**
 * 根组件重新读取服务端权威主体后发送的跨组件浏览器事件，事件中绝不包含令牌。
 * 消费方只能把主体用于展示和导航；每个操作仍必须以后端 401/403 为最终鉴权结果。
 */
export const AUTHORIZATION_REFRESHED_EVENT = 'platform-auth:authorization-refreshed'

export const AUTHORIZATION_REFRESH_INTERVAL_MS = 15 * 1000

export function principalFingerprint(principal) {
  if (!principal || typeof principal !== 'object') return ''

  const roles = Array.isArray(principal.roles)
    ? principal.roles
      .map((role) => String(role?.id || role?.code || role?.name || '').trim())
      .filter(Boolean)
      .sort()
    : []
  const permissions = Array.isArray(principal.permission_codes)
    ? principal.permission_codes.map((code) => String(code || '').trim()).filter(Boolean).sort()
    : []

  // 排序后序列化，消除后端集合返回顺序变化造成的虚假“权限已变化”事件。
  return JSON.stringify({
    tenant: String(principal.tenant?.id || ''),
    user: String(principal.user?.id || ''),
    account: String(principal.account?.id || ''),
    roles,
    permissions,
  })
}

export function dispatchAuthorizationRefreshed(principal, { changed = false } = {}) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(AUTHORIZATION_REFRESHED_EVENT, {
    detail: { principal, changed: Boolean(changed) },
  }))
}

/**
 * 立即清除当前 SPA 的所有内存身份/授权快照。
 * HttpOnly Cookie 仍完全归服务端管理；此事件只防止登录、退出跳转期间组件继续展示上一账号。
 */
export function clearAuthorizationSnapshot() {
  dispatchAuthorizationRefreshed(null)
}
