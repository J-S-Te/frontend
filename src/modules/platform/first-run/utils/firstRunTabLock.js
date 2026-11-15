// 多标签页导览锁：同一 (tenant,user) 作用域同一时刻只允许一个标签页展示导览。
// 纯 localStorage 租约，带 TTL；标签页关闭/崩溃后锁会自然过期，不会永久阻塞。
export const FIRST_RUN_TAB_LOCK_TTL_MS = 8000

export function firstRunTabLockKey(scope) {
  return scope ? `${scope}|tab-lock` : ''
}

/**
 * 创建可注入存储/时间源的标签页锁。
 * @param {Object} [options] 依赖注入。
 * @param {Storage|null} [options.storage] 显式存储；undefined 用 window.localStorage。
 * @param {Function} [options.now] 毫秒时间源。
 * @param {string} [options.id] 当前标签页标识。
 * @returns {Object} acquire/renew/release/heldByOther 等动作。
 */
export function createFirstRunTabLock({ storage, now = () => Date.now(), id } = {}) {
  const owner = id || `tab-${now()}-${Math.random().toString(36).slice(2)}`

  function store() {
    if (storage !== undefined) return storage
    if (typeof window === 'undefined') return null
    try { return window.localStorage || null } catch { return null }
  }

  function read(scope) {
    const key = firstRunTabLockKey(scope)
    const target = store()
    if (!key || !target) return null
    try {
      const value = JSON.parse(target.getItem(key) || 'null')
      if (!value || typeof value !== 'object' || typeof value.owner !== 'string') return null
      if (!Number.isFinite(value.expiresAt) || value.expiresAt <= now()) return null
      return value
    } catch {
      return null
    }
  }

  function write(scope, value) {
    const key = firstRunTabLockKey(scope)
    const target = store()
    if (!key || !target) return false
    try { target.setItem(key, JSON.stringify(value)); return true } catch { return false }
  }

  function acquire(scope, guideKey = '') {
    const current = read(scope)
    if (current && current.owner !== owner) return false
    return write(scope, { owner, guideKey, expiresAt: now() + FIRST_RUN_TAB_LOCK_TTL_MS })
  }

  function renew(scope, guideKey = '') {
    const current = read(scope)
    if (!current || current.owner !== owner) return false
    return write(scope, { owner, guideKey, expiresAt: now() + FIRST_RUN_TAB_LOCK_TTL_MS })
  }

  function release(scope) {
    const current = read(scope)
    if (!current || current.owner !== owner) return false
    const key = firstRunTabLockKey(scope)
    const target = store()
    if (!key || !target) return false
    try { target.removeItem(key); return true } catch { return false }
  }

  function heldByOther(scope) {
    const current = read(scope)
    return Boolean(current && current.owner !== owner)
  }

  return { owner, acquire, renew, release, heldByOther }
}
