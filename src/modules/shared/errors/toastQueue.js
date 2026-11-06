// 全局兜底提示的队列策略：去重、节流、可见条数上限、自动消失。
//
// 这一层刻意不依赖 Vue 也不依赖浏览器：线上只在故障态才会走到这里，
// 如果策略和渲染、DOM 纠缠在一起，就只能靠"打开页面看看"来验证，
// 而这类问题的正确行为（去重窗口、刷屏上限、到点消失）恰恰最需要被单独锁住。
//
// 术语：
//   - 去重窗口 dedupeMs：同一句提示在这个时间内只出现一次。
//   - 节流窗口 windowMs / 上限 maxPerWindow：窗口内最多接受几条，避免一次断网刷出十几条。
//   - 可见条数 maxVisible：同时挂在屏幕上的上限，超出丢掉最旧的一条。
//   - 存活时间 ttlMs：到点自动消失，不要求用户手动关闭。
export const DEFAULT_TOAST_LIMITS = Object.freeze({
  dedupeMs: 4000,
  windowMs: 10000,
  maxPerWindow: 3,
  maxVisible: 3,
  ttlMs: 6000,
})

const LIMIT_KEYS = ['dedupeMs', 'windowMs', 'maxPerWindow', 'maxVisible', 'ttlMs']

// 只接受正的有限数：传 0 / 负数 / NaN 会把闸门整个关掉，此时回落到默认值。
function positive(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback
}

/** 合并调用方配置与默认值，非法值一律回落到默认值。 */
export function normalizeToastLimits(overrides = {}) {
  const limits = {}
  for (const key of LIMIT_KEYS) limits[key] = positive(overrides?.[key], DEFAULT_TOAST_LIMITS[key])
  return limits
}

const TONES = new Set(['error', 'warning', 'success', 'info'])

/**
 * 创建一个提示队列。
 * @param {object} overrides 见 DEFAULT_TOAST_LIMITS，非法值回落到默认值。
 * @returns {{limits: object, push: Function, sweep: Function, list: Function, dismiss: Function, clear: Function}}
 */
export function createToastQueue(overrides = {}) {
  const limits = normalizeToastLimits(overrides)
  // 去重表按"用户看到的这句提示"记：同一个崩溃从 error 和 unhandledrejection 各来一次，
  // 文案相同就应该合并；反过来，不同文案各自成立，所以键就是 message 本身。
  const seen = new Map()
  const acceptedAt = []
  const items = []
  let sequence = 0

  function snapshot() {
    return items.map((item) => ({ ...item }))
  }

  function pruneSeen(now) {
    const from = now - limits.dedupeMs
    for (const [key, at] of seen) if (at <= from) seen.delete(key)
  }

  function pruneThrottle(now) {
    const from = now - limits.windowMs
    while (acceptedAt.length && acceptedAt[0] <= from) acceptedAt.shift()
  }

  /**
   * 尝试入列一条提示。
   * @param {{message: string, tone?: string, detail?: string, key?: string}} input
   * @param {number} now 当前时间戳（由调用方注入，便于测试）
   * @returns {{accepted: boolean, reason: string, item: object|null, items: object[], dropped: object[]}}
   */
  function push(input = {}, now = Date.now()) {
    const message = typeof input.message === 'string' ? input.message.trim() : ''
    if (!message) return { accepted: false, reason: 'empty', item: null, items: snapshot(), dropped: [] }

    pruneSeen(now)
    if (seen.has(message)) return { accepted: false, reason: 'duplicate', item: null, items: snapshot(), dropped: [] }

    pruneThrottle(now)
    if (acceptedAt.length >= limits.maxPerWindow) {
      return { accepted: false, reason: 'throttled', item: null, items: snapshot(), dropped: [] }
    }

    sequence += 1
    const item = {
      id: sequence,
      message,
      tone: TONES.has(input.tone) ? input.tone : 'error',
      detail: typeof input.detail === 'string' ? input.detail.trim() : '',
      // key 只用于排查（例如区分 chunk 失败与普通导航失败），去重始终按文案判定。
      key: typeof input.key === 'string' && input.key.trim() ? input.key.trim() : message,
      createdAt: now,
      expiresAt: now + limits.ttlMs,
    }
    seen.set(message, now)
    acceptedAt.push(now)
    items.push(item)

    const dropped = []
    while (items.length > limits.maxVisible) dropped.push(items.shift())
    return { accepted: true, reason: 'accepted', item: { ...item }, items: snapshot(), dropped }
  }

  /** 清掉已经到点的提示，返回清理后的可见列表。 */
  function sweep(now = Date.now()) {
    for (let index = items.length - 1; index >= 0; index -= 1) {
      if (items[index].expiresAt <= now) items.splice(index, 1)
    }
    return snapshot()
  }

  function list() {
    return snapshot()
  }

  function dismiss(id) {
    const index = items.findIndex((item) => item.id === id)
    if (index >= 0) items.splice(index, 1)
    return snapshot()
  }

  function clear() {
    items.length = 0
    acceptedAt.length = 0
    seen.clear()
    return snapshot()
  }

  return { limits, push, sweep, list, dismiss, clear }
}
