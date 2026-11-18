export const AUTHORIZATION_REFRESH_HEADERS = Object.freeze({
  'X-Authorization-Refresh': '1',
  'Cache-Control': 'no-cache',
})

// 用途：比较当前账号实际授权边界，避免全应用修订号变化清空无关用户的工作区。
// 参数：session 为服务器返回的授权快照，空会话代表无可用授权。
// 返回值：包含主体、客户、角色、权限和数据范围的比较键。
export function authorizationScopeKey(session) {
  if (!session) return ''
  return JSON.stringify({
    tenant: session.tenant_id,
    user: session.user_id,
    subject: session.subject_id,
    identity: session.identity_id,
    platformUser: session.platform_user_id,
    customer: session.customer_id,
    person: session.customer_person_id,
    roles: [...(session.roles || [])].sort(),
    permissions: [...(session.permissions || [])].sort(),
    scopes: Array.isArray(session.data_scopes)
      ? session.data_scopes.map(scope => JSON.stringify(canonicalScopeValue(scope))).sort()
      : session.data_scopes,
    scopeMode: session.scope_mode,
    organizations: [...(session.organization_ids || [])].sort(),
    teams: [...(session.team_ids || [])].sort(),
  })
}

// 用途：稳定序列化数据范围对象的字段顺序，保留完整范围及扩展元数据。
// 参数：value 为服务端范围中的任意JSON值；内部数组保留原始次序。
// 返回值：对象键已排序的等价值，不删字段、不推导或扩大授权。
function canonicalScopeValue(value) {
  if (Array.isArray(value)) return value.map(canonicalScopeValue)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort()
      .map(key => [key, canonicalScopeValue(value[key])]))
  }
  return value
}

// 用途：协调真实授权读取，阻止旧响应恢复已变更权限。
// 参数：load 为读取，normalize 为规范化，cacheTTL 为缓存毫秒数，onError 处理当前读取错误。
// 返回值：读取和清空接口；强制读取失败不保留旧快照。
export function createAuthorizationSnapshotReader({ load, normalize = value => value,
  cacheTTL = Infinity, onError = undefined }) {
  let generation = 0
  let cached = null
  let inFlight = null

  // 用途：在登录、退出或账号变化时使旧授权读取全部失效。
  // 参数：无。
  // 返回值：无；不操作Cookie或服务器会话。
  function clear() {
    generation += 1
    cached = null
    inFlight = null
  }

  // 用途：让迟到请求跟随最新读取，避免向页面返回旧权限。
  // 参数：无。
  // 返回值：最新结果或在途Promise；已清空且无新读取时拒绝旧响应。
  function latest() {
    if (inFlight) return inFlight.promise
    if (cached) return cached.value
    throw Object.assign(new Error('会话或权限已变化，请重新读取当前权限。'), {
      code: 'AUTHORIZATION_SNAPSHOT_CHANGED', status: 409,
    })
  }

  // 用途：读取当前授权，必要时绕过缓存及先前在途请求。
  // 参数：force 表示明确重读，其余options原样传给现有API管道。
  // 返回值：最新规范化快照；错误保持原分类，不恢复旧缓存。
  async function read({ force = false, ...options } = {}) {
    if (!force && cached && Date.now() < cached.expiresAt) return cached.value
    if (!force && inFlight) return inFlight.promise
    const ticket = ++generation
    cached = null
    inFlight = null
    const pending = load(options)
    const promise = Promise.resolve(pending).then(value => {
      if (ticket !== generation) return latest()
      const snapshot = normalize(value)
      cached = { value: snapshot, expiresAt: Date.now() + cacheTTL }
      return snapshot
    }, error => {
      if (ticket !== generation) {
        // 账号切换的专用错误保留既有平台契约；其他旧失败不得触发新的登录副作用。
        if (!inFlight && !cached && error?.code === 'AUTH_SESSION_CHANGED') throw error
        return latest()
      }
      onError?.(error, options)
      throw error
    }).finally(() => {
      if (inFlight?.ticket === ticket) inFlight = null
    })
    inFlight = { ticket, promise }
    return promise
  }

  return { read, clear }
}
