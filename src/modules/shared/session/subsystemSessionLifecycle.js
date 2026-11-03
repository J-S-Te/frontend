// 业务子系统（合同/CRM/项目/数析）浏览器会话的空闲生命周期。
// 与平台会话不同，子系统使用各自独立的 HttpOnly OIDC 会话；本模块只负责：
// 1) 监听真实用户操作（鼠标/键盘/滚动/触摸），节流上报子系统活动接口；
// 2) 在本地空闲窗口到点时只读探测子系统会话，确认到期才结束本页；
// 3) 后台轮询、接口请求和自动刷新都不续期，避免无人操作时“假活跃”。
// 计时与事件目标均可注入，便于 Node 原生测试覆盖；浏览器默认使用 window。

const DEFAULT_IDLE_TIMEOUT_SECONDS = 30 * 60
const MIN_IDLE_TIMEOUT_SECONDS = 60
const MAX_IDLE_TIMEOUT_SECONDS = 24 * 60 * 60
const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'scroll', 'touchstart']
const MIN_TOUCH_INTERVAL_MS = 10 * 1000
const MAX_TOUCH_INTERVAL_MS = 60 * 1000
const PROBE_TIMEOUT_MS = 10 * 1000
const PROBE_RETRY_MS = 15 * 1000
const MAX_PROBE_FAILURES = 3
// 滚动更新期：新前端 + 旧后端（/auth/me 尚无空闲字段）时不能立刻锁死页面，
// 以较短周期只读探测，等 401 出现或后端升级完成。
const LEGACY_PROBE_MS = 60 * 1000

// browserWindow 返回默认的浏览器事件/计时环境；Node 测试必须显式注入。
function browserWindow() {
  return typeof window !== 'undefined' ? window : null
}

// normalizeIdleSeconds 限制服务端空闲秒数到受支持范围，非法值回退默认策略。
function normalizeIdleSeconds(value) {
  const seconds = Number(value)
  if (!Number.isFinite(seconds) || seconds < MIN_IDLE_TIMEOUT_SECONDS) return DEFAULT_IDLE_TIMEOUT_SECONDS
  return Math.min(seconds, MAX_IDLE_TIMEOUT_SECONDS)
}

// remainingFromSession 读取服务端权威剩余空闲毫秒；缺失/非法时返回 null。
function remainingFromSession(session, idleTimeoutMs) {
  if (!session || typeof session !== 'object') return null
  const raw = session.idle_remaining_ms
  const remaining = Number(raw)
  if (!Number.isFinite(remaining) || remaining < 0) return null
  return Math.min(remaining, idleTimeoutMs)
}

// isUnauthorized 判断错误是否表示子系统会话已失效。
function isUnauthorized(error) {
  return Number(error?.status) === 401
}

/**
 * createSubsystemSessionLifecycle 创建单个子系统的本页空闲生命周期控制器。
 * @param {{
 *   touch?: () => Promise<Record<string, unknown>>,
 *   probe?: () => Promise<Record<string, unknown>>,
 *   onIdle?: (reason: string) => void,
 *   onError?: (error: unknown) => void,
 *   environment?: Window | null,
 *   now?: () => number,
 * }} [options={}] 活动上报、只读探测、空闲结束回调及可注入环境。
 * @returns {{start: Function, stop: Function, refresh: Function, destroy: Function, getState: Function}} 生命周期控制器。
 */
export function createSubsystemSessionLifecycle({ touch, probe, onIdle, onError, environment, now = () => Date.now() } = {}) {
  const env = environment === undefined ? browserWindow() : environment
  let idleTimeoutMs = DEFAULT_IDLE_TIMEOUT_SECONDS * 1000
  let timer = 0
  let probeTimer = 0
  let stopped = true
  let expiring = false
  let generation = 0
  let probeInFlight = null
  let touchInFlight = null
  let lastTouchAt = -Infinity
  let probeFailures = 0

  const clearTimer = () => {
    if (timer && env) env.clearTimeout(timer)
    timer = 0
  }

  const clearProbeTimer = () => {
    if (probeTimer && env) env.clearTimeout(probeTimer)
    probeTimer = 0
  }

  // invalidateProbe 让在途的只读探测失效；旧响应不得覆盖新的活动窗口。
  const invalidateProbe = () => {
    generation += 1
    probeInFlight = null
    clearProbeTimer()
  }

  // stop 停止计时与事件监听，不触发空闲回调；用于路由切换或组件卸载。
  const stop = () => {
    stopped = true
    invalidateProbe()
    touchInFlight = null
    clearTimer()
    if (env) ACTIVITY_EVENTS.forEach((event) => env.removeEventListener(event, onActivity))
  }

  // end 只在探测确认会话空闲到期/被撤销后结束本页；不调用全账号退出。
  const end = (reason) => {
    if (stopped || expiring) return
    expiring = true
    stop()
    try { onIdle?.(reason) } finally { expiring = false }
  }

  // scheduleExpiry 安排下一次只读探测；活动或服务端剩余窗口变化时重排。
  const scheduleExpiry = (remainingMs) => {
    if (!env) return
    clearTimer()
    const delay = Number.isFinite(remainingMs) ? Math.max(250, remainingMs) : idleTimeoutMs
    timer = env.setTimeout(() => { timer = 0; void probeIdle() }, delay)
  }

  // probeIdle 只读确认服务端权威剩余空闲；通过后才重排下一窗口。
  const probeIdle = async () => {
    if (stopped || expiring || probeInFlight || typeof probe !== 'function') return
    clearTimer()
    const requestedGeneration = generation
    const token = {}
    probeInFlight = token
    const startedAt = now()
    probeTimer = env?.setTimeout(() => {
      if (!stopped && generation === requestedGeneration && probeInFlight === token) {
        probeInFlight = null
        probeTimer = 0
        probeFailures += 1
        if (probeFailures >= MAX_PROBE_FAILURES) end('probe-failed')
        else scheduleExpiry(PROBE_RETRY_MS)
      }
    }, PROBE_TIMEOUT_MS) || 0
    try {
      const session = await probe()
      if (stopped || generation !== requestedGeneration || probeInFlight !== token) return
      const idleSeconds = Number(session?.idle_timeout_seconds)
      if (Number.isFinite(idleSeconds) && idleSeconds >= MIN_IDLE_TIMEOUT_SECONDS) idleTimeoutMs = normalizeIdleSeconds(idleSeconds) * 1000
      const remaining = remainingFromSession(session, idleTimeoutMs)
      if (remaining === null) {
        probeFailures = 0
        scheduleExpiry(Math.min(LEGACY_PROBE_MS, idleTimeoutMs))
        return
      }
      if (remaining <= 0) {
        end('idle-timeout')
        return
      }
      probeFailures = 0
      const elapsed = Math.max(0, now() - startedAt)
      scheduleExpiry(Math.max(250, remaining - elapsed))
    } catch (error) {
      if (stopped || generation !== requestedGeneration || probeInFlight !== token) return
      if (isUnauthorized(error)) { end('idle-timeout'); return }
      onError?.(error)
      probeFailures += 1
      if (probeFailures >= MAX_PROBE_FAILURES) end('probe-failed')
      else scheduleExpiry(PROBE_RETRY_MS)
    } finally {
      if (probeInFlight === token) {
        probeInFlight = null
        clearProbeTimer()
      }
    }
  }

  // touchServer 节流上报真实活动；只有活动接口能滑动服务端空闲窗口。
  const touchServer = async () => {
    if (stopped || touchInFlight || typeof touch !== 'function') return
    const interval = Math.max(MIN_TOUCH_INTERVAL_MS, Math.min(MAX_TOUCH_INTERVAL_MS, Math.floor(idleTimeoutMs / 3)))
    const current = now()
    if (current - lastTouchAt < interval) return
    const token = {}
    touchInFlight = token
    lastTouchAt = current
    try {
      const session = await touch()
      if (stopped || touchInFlight !== token) return
      const idleSeconds = Number(session?.idle_timeout_seconds)
      if (Number.isFinite(idleSeconds) && idleSeconds >= MIN_IDLE_TIMEOUT_SECONDS) idleTimeoutMs = normalizeIdleSeconds(idleSeconds) * 1000
      const remaining = remainingFromSession(session, idleTimeoutMs)
      if (remaining !== null && remaining > 0) scheduleExpiry(remaining)
      probeFailures = 0
    } catch (error) {
      if (stopped || touchInFlight !== token) return
      if (isUnauthorized(error)) { end('server-revoked'); return }
      onError?.(error)
    } finally {
      if (touchInFlight === token) touchInFlight = null
    }
  }

  // onActivity 处理真实用户操作：使旧探测失效、重排本地窗口并节流上报。
  function onActivity() {
    if (stopped || expiring) return
    invalidateProbe()
    scheduleExpiry(idleTimeoutMs)
    void touchServer()
  }

  /**
   * start 按服务端会话剩余窗口启动本页空闲计时。
   * @param {{idleTimeoutSeconds?: number, idleRemainingMs?: number}} [session={}] 会话空闲参数。
   * @returns {void}
   */
  const start = (session = {}) => {
    if (!env) return
    stop()
    idleTimeoutMs = normalizeIdleSeconds(session.idleTimeoutSeconds) * 1000
    stopped = false
    expiring = false
    probeFailures = 0
    lastTouchAt = -Infinity
    ACTIVITY_EVENTS.forEach((event) => env.addEventListener(event, onActivity, { passive: true }))
    const remaining = Number(session.idleRemainingMs)
    scheduleExpiry(Number.isFinite(remaining) && remaining > 0 ? Math.min(remaining, idleTimeoutMs) : idleTimeoutMs)
  }

  // refresh 供页面重新可见等场景立即校准；不视为用户活动。
  const refresh = () => {
    if (stopped || expiring) return
    invalidateProbe()
    void probeIdle()
  }

  return {
    start,
    stop,
    refresh,
    destroy() { stop() },
    // getState 仅用于回归测试断言，不承载业务含义。
    getState() {
      return { stopped, idleTimeoutMs, probeFailures, hasTimer: timer !== 0, probeInFlight: probeInFlight !== null, touchInFlight: touchInFlight !== null }
    },
  }
}
