/**
 * 基础平台关联数据失效总线。
 *
 * 目标：写入成功的一方立即通知关心同一份目录的其他组件，而不把员工信息、角色明细
 * 或任何凭据放进通知里。通知只包含资源类别、当前会话范围和单调递增的版本号。
 *
 * 约束：
 * - 只有服务端确认写入成功后才允许发布（由 API 封装层调用，见 iam.js / applications.js /
 *   positionAuthorization.js），不能在“本地已加入列表”这种乐观假设上发布。
 * - 发布不等于读取成功。订阅方读取失败时必须保留写入结果并单独提供重试，不能诱导重复写入。
 * - 会话范围（租户 + 用户）变化时推进世代并清空版本，旧会话的在途响应必须被丢弃。
 * - 本模块不依赖浏览器或 Vue，便于在没有 DOM 的环境做单元测试。
 */

export const RELATED_DATA = Object.freeze({
  ORGANIZATIONS: 'organizations',
  POSITIONS: 'positions',
  PEOPLE: 'people',
  MEMBERSHIPS: 'memberships',
  AUTHORIZATION_TEMPLATES: 'authorization-templates',
  APPLICATIONS: 'applications',
  ENVIRONMENTS: 'environments',
  ROLE_CATALOG: 'role-catalog',
})

const KNOWN_KINDS = new Set(Object.values(RELATED_DATA))

/** 无会话上下文时使用的占位范围；它同样是合法范围，只是不会被真实登录态命中。 */
const ANONYMOUS_SCOPE = 'anonymous'

let sessionScope = ANONYMOUS_SCOPE
let sessionEpoch = 0
let versions = new Map()
const listeners = new Set()
const inFlight = new Map()

function normalizeScope(scope) {
  const value = String(scope ?? '').trim()
  return value || ANONYMOUS_SCOPE
}

function normalizeKinds(kinds) {
  const list = Array.isArray(kinds) ? kinds : [kinds]
  const result = []
  const seen = new Set()
  for (const kind of list) {
    const value = String(kind ?? '').trim()
    if (!value || !KNOWN_KINDS.has(value) || seen.has(value)) continue
    seen.add(value)
    result.push(value)
  }
  return result
}

function versionSnapshot(kinds) {
  const snapshot = {}
  for (const kind of kinds) snapshot[kind] = versions.get(kind) || 0
  return snapshot
}

function notify(event) {
  // 快照迭代：监听器可以在回调里退订，不能因此跳过后面的监听器。
  for (const listener of Array.from(listeners)) {
    try {
      listener(event)
    } catch (error) {
      // 单个订阅方的异常不能中断其他组件的失效处理；调用方各自负责错误展示。
      console.error('relatedDataInvalidation listener failed', error)
    }
  }
}

/** 当前会话范围标识，形如 `tenant|user`；未登录时为 `anonymous`。 */
export function relatedDataSessionScope() {
  return sessionScope
}

/** 当前会话世代；每次登录/退出/换号/换租户递增。 */
export function relatedDataSessionEpoch() {
  return sessionEpoch
}

/** 迟到的响应只有在世代未变时才允许写回。 */
export function isRelatedDataEpochCurrent(epoch) {
  return Number(epoch) === sessionEpoch
}

/**
 * 更新会话范围。登录、退出、切换账号或租户时由 `auth/utils/principal.js` 调用。
 * 范围变化会清空版本、丢弃在途合并键并通知订阅方清除缓存。
 */
export function setRelatedDataSessionScope(scope) {
  const next = normalizeScope(scope)
  if (next === sessionScope) return sessionEpoch
  sessionScope = next
  sessionEpoch += 1
  versions = new Map()
  inFlight.clear()
  notify({
    type: 'session',
    kinds: Object.freeze(Array.from(KNOWN_KINDS)),
    scope: sessionScope,
    epoch: sessionEpoch,
    versions: versionSnapshot(KNOWN_KINDS),
  })
  return sessionEpoch
}

export function relatedDataVersion(kind) {
  return versions.get(String(kind ?? '').trim()) || 0
}

export function relatedDataVersions(kinds = Object.values(RELATED_DATA)) {
  return versionSnapshot(normalizeKinds(kinds))
}

/** 稳定摘要：只有被关注的类别版本变化时才变化，用于“打开表单后是否已过期”的判断。 */
export function relatedDataStamp(kinds = Object.values(RELATED_DATA)) {
  return normalizeKinds(kinds)
    .map((kind) => `${kind}:${relatedDataVersion(kind)}`)
    .join('|')
}

/**
 * 发布失效通知。只有服务端写入确认成功后调用。
 * @param {string|string[]} kinds 资源类别，超出 RELATED_DATA 的取值会被忽略。
 * @returns {number} 实际发布的类别数量。
 */
export function publishRelatedDataChanged(kinds) {
  const list = normalizeKinds(kinds)
  if (!list.length) return 0
  for (const kind of list) versions.set(kind, (versions.get(kind) || 0) + 1)
  notify({
    type: 'change',
    kinds: Object.freeze(list),
    scope: sessionScope,
    epoch: sessionEpoch,
    versions: versionSnapshot(list),
  })
  return list.length
}

/**
 * 订阅关联数据变化。
 * @param {(event: {type: string, kinds: string[], scope: string, epoch: number, versions: Record<string, number>}) => void} listener
 * @param {{kinds?: string[]}} [options] 只接收指定类别；省略时接收全部。
 * @returns {() => void} 退订函数。
 */
export function subscribeRelatedDataChanges(listener, options = {}) {
  if (typeof listener !== 'function') return () => {}
  const wanted = options.kinds ? new Set(normalizeKinds(options.kinds)) : null
  const wrapped = (event) => {
    if (!wanted) {
      listener(event)
      return
    }
    if (event.type === 'session') {
      listener(event)
      return
    }
    const matched = event.kinds.filter((kind) => wanted.has(kind))
    if (!matched.length) return
    listener({ ...event, kinds: Object.freeze(matched) })
  }
  listeners.add(wrapped)
  return () => { listeners.delete(wrapped) }
}

/**
 * 合并同一时刻的重复目录读取。
 *
 * 合并键包含会话范围、会话世代、调用键，以及（可选）被读取类别的版本摘要：
 * 同一批目录的并发读取只发一次请求；但写入确认成功发布失效后，版本摘要改变，
 * 后续刷新会发起新的读取，而不是复用“写入前就已经在途”的旧请求，避免旧目录
 * 又被当成最新目录写回页面。请求结束后自动释放，失败不缓存，重试一定重新读取。
 *
 * @param {string} key 调用方稳定的读取键。
 * @param {() => Promise<any>} loader 真正的读取实现。
 * @param {{kinds?: string[]}} [options] 本次读取覆盖的资源类别。
 */
export function loadRelatedDataOnce(key, loader, options = {}) {
  const normalized = String(key ?? '').trim()
  if (typeof loader !== 'function') return Promise.resolve(undefined)
  if (!normalized) return Promise.resolve().then(loader)
  const kinds = normalizeKinds(options.kinds || [])
  const versionPart = kinds.length ? `#${relatedDataStamp(kinds)}` : ''
  const mergedKey = `${sessionScope}#${sessionEpoch}#${normalized}${versionPart}`
  const existing = inFlight.get(mergedKey)
  if (existing) return existing
  const request = Promise.resolve()
    .then(loader)
    .finally(() => {
      if (inFlight.get(mergedKey) === request) inFlight.delete(mergedKey)
    })
  inFlight.set(mergedKey, request)
  return request
}

/** 清空版本、订阅、在途合并与世代增量；供退出登录和单元测试使用。 */
export function resetRelatedDataInvalidation() {
  versions = new Map()
  listeners.clear()
  inFlight.clear()
  sessionScope = ANONYMOUS_SCOPE
  sessionEpoch = 0
}

/**
 * 读取一份关联目录并把“成功 / 失败 / 会话已切换 / 读取期间目录已被写入”压成一个结果对象。
 *
 * 组件用它实现“打开表单就重新校验”：并发调用合并，失败可重试（不缓存失败），
 * 会话切换或读取期间发生写入（版本摘要改变）时，在途响应被标记为 stale 且绝不回填，
 * 这样慢的旧响应不会覆盖写入后的新目录。
 *
 * @param {string} key 调用方稳定的读取键。
 * @param {() => Promise<any>} loader 真正的读取实现。
 * @param {{kinds?: string[]}} [options] 本次读取覆盖的资源类别。
 * @returns {Promise<{items: any[]|null, error: Error|null, stale: boolean, epoch: number}>}
 */
export async function loadRelatedDataSafely(key, loader, options = {}) {
  const epoch = sessionEpoch
  const kinds = normalizeKinds(options.kinds || [])
  const stamp = kinds.length ? relatedDataStamp(kinds) : ''
  const isStale = () => epoch !== sessionEpoch || (kinds.length > 0 && stamp !== relatedDataStamp(kinds))
  try {
    const items = await loadRelatedDataOnce(key, loader, options)
    if (isStale()) return { items: null, error: null, stale: true, epoch }
    return { items, error: null, stale: false, epoch }
  } catch (error) {
    if (isStale()) return { items: null, error: null, stale: true, epoch }
    return { items: null, error, stale: false, epoch }
  }
}
