/**
 * 根组件重新读取服务端权威主体后发送的跨组件浏览器事件，事件中绝不包含令牌。
 * 消费方只能把主体用于展示和导航；每个操作仍必须以后端 401/403 为最终鉴权结果。
 */
export const AUTHORIZATION_REFRESHED_EVENT = 'platform-auth:authorization-refreshed'

export const AUTHORIZATION_REFRESH_INTERVAL_MS = 15 * 1000

// 快照清空订阅者集合：登录、退出、换号与会话失效都会走到 clearAuthorizationSnapshot。
const snapshotClearedListeners = new Set()

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
  // 账号切换/退出/会话失效时，各模块的身份缓存必须与授权快照一起作废，
  // 否则换号后仍可能读到上一账号的主体。
  for (const listener of snapshotClearedListeners) {
    try {
      listener()
    } catch {
      // 单个订阅者失败不得阻断其余订阅者与事件派发。
    }
  }
  dispatchAuthorizationRefreshed(null)
}

/**
 * onAuthorizationSnapshotCleared 订阅“内存身份快照被清空”。
 * @param {Function} listener 快照清空时同步执行的回调。
 * @returns {Function} 取消订阅的函数。
 */
export function onAuthorizationSnapshotCleared(listener) {
  if (typeof listener !== 'function') return () => {}
  snapshotClearedListeners.add(listener)
  return () => snapshotClearedListeners.delete(listener)
}
