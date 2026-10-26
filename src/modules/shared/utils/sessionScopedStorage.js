// 会话作用域存储：把操作记录、操作结果与表单草稿按「租户 + 用户 + 格式版本」隔离。
// 同一标签页切换账号/租户后，B 主体不得读出 A 主体的残留数据；登出经
// clearSessionScopedStorage 统一清漏斗（见 auth/utils/sessionLifecycle.js）。

const SCOPE_MARKER = '@scope:'
const SCOPE_FORMAT = 'v1'

function storage() {
  if (typeof window === 'undefined') return null
  try { return window.sessionStorage } catch { return null }
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim()
    if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  }
  return ''
}

/**
 * 由当前会话主体派生作用域标识。
 * 返回 'v1|t:<tenant>|u:<identity>'；任一关键字段缺失时返回 null——
 * 尚未识别主体时不得恢复或持久化任何会话作用域数据。
 */
export function sessionScopeOf(principal) {
  const source = principal && typeof principal === 'object' ? principal : {}
  const tenant = firstString(source.tenant_id, source.tenantId, source.tenant?.id, source.tenant?.tenant_id)
  const identity = firstString(source.identity_id, source.sub, source.user_id, source.user?.identity_id, source.user?.id)
  if (!tenant || !identity) return null
  return `${SCOPE_FORMAT}|t:${tenant}|u:${identity}`
}

export function scopedStorageKey(baseKey, scope) {
  return scope ? `${baseKey}${SCOPE_MARKER}${scope}` : baseKey
}

export function readScopedJSON(baseKey, scope) {
  if (!scope) return null
  const store = storage()
  if (!store) return null
  try {
    const value = JSON.parse(store.getItem(scopedStorageKey(baseKey, scope)) || 'null')
    return value && typeof value === 'object' ? value : null
  } catch {
    return null
  }
}

export function writeScopedJSON(baseKey, scope, value) {
  if (!scope) return false
  try {
    storage()?.setItem(scopedStorageKey(baseKey, scope), JSON.stringify(value))
    return true
  } catch {
    return false
  }
}

export function removeScopedKey(baseKey, scope) {
  if (!scope) return
  try { storage()?.removeItem(scopedStorageKey(baseKey, scope)) } catch { /* storage is optional */ }
}

/** 登出/会话终结漏斗：删除全部会话作用域键（保留无作用域的旧键不动）。 */
export function clearSessionScopedStorage() {
  const store = storage()
  if (!store) return
  const doomed = []
  for (let index = 0; index < store.length; index += 1) {
    const key = store.key(index)
    if (key && key.includes(SCOPE_MARKER)) doomed.push(key)
  }
  for (const key of doomed) {
    try { store.removeItem(key) } catch { /* best effort */ }
  }
}
