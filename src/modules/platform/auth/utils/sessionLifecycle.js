// 与 auth.js 互相调用的生命周期协调器使用相对导入，避免 Node 测试环境依赖 Vite 别名。
import { AuthError, logoutCurrentSession, recordSessionActivity, refreshCurrentSession } from '../api/auth.js'

const SESSION_EVENT = 'platform-auth:session-ended'
const SESSION_CHANNEL = 'basic-platform-auth'
const DEFAULT_IDLE_TIMEOUT_SECONDS = 30 * 60
const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'scroll', 'touchstart']
const SERVER_TOUCH_INTERVAL_MS = 60 * 1000
const MIN_SERVER_TOUCH_INTERVAL_MS = 10 * 1000
const SESSION_REFRESH_INTERVAL_MS = 10 * 60 * 1000

function browserAvailable() {
  return typeof window !== 'undefined'
}

function normalizeTimeout(value) {
  const seconds = Number(value)
  if (!Number.isFinite(seconds) || seconds < 60) return DEFAULT_IDLE_TIMEOUT_SECONDS
  return Math.min(seconds, 24 * 60 * 60)
}

function notifySessionEnded(reason = 'logout') {
  if (!browserAvailable()) return
  window.dispatchEvent(new CustomEvent(SESSION_EVENT, { detail: { reason } }))
}

/**
 * 统一协调 SPA 各路由的浏览器无操作退出反馈。服务端会话撤销始终是权威；这里只在
 * 真实点击、按键、滚动或触摸后限流上报活动，后台接口请求和轮询不能延长会话。
 */
export function createSessionLifecycle({ onSessionEnded, onSessionError } = {}) {
  let idleTimer = 0
  let timeoutSeconds = DEFAULT_IDLE_TIMEOUT_SECONDS
  let stopped = true
  let expiring = false
  let lastServerTouchAt = 0
  let lastSessionRefreshAt = 0
  let serverTouchInFlight = false
  let channel = null

  const clearTimer = () => {
    if (idleTimer) window.clearTimeout(idleTimer)
    idleTimer = 0
  }

  const stop = () => {
    stopped = true
    clearTimer()
    ACTIVITY_EVENTS.forEach((event) => window.removeEventListener(event, onActivity))
  }

  const end = async (reason) => {
    if (stopped || expiring) return
    expiring = true
    stop()
    try {
      if (reason === 'idle-timeout') {
        try {
          await logoutCurrentSession()
        } catch {
          // 服务端可能已经使基础平台会话失效，本地仍必须完成退出；各子系统持有独立会话，
          // 是否立即失效由其退出、授权重验与会话到期机制决定。
        }
      }
      onSessionEnded?.(reason)
    } finally {
      expiring = false
    }
  }

  const scheduleExpiry = () => {
    clearTimer()
    idleTimer = window.setTimeout(() => { void end('idle-timeout') }, timeoutSeconds * 1000)
  }

  const touchServer = async () => {
    // 首次真实交互必须立即写入服务端。后续间隔取空闲窗口的三分之一（上限一分钟），
    // 让最短 60 秒策略也有足够余量，不会因用户恰好在旧窗口末尾操作而被服务端误判为空闲。
    const interval = Math.max(MIN_SERVER_TOUCH_INTERVAL_MS, Math.min(SERVER_TOUCH_INTERVAL_MS, Math.floor(timeoutSeconds * 1000 / 3)))
    if (stopped || serverTouchInFlight || Date.now() - lastServerTouchAt < interval) return
    serverTouchInFlight = true
    try {
      const principal = await recordSessionActivity()
      timeoutSeconds = normalizeTimeout(principal?.idle_timeout_seconds)
      // 服务端仅在这条由真实交互触发的路径上延长 Cookie；/auth/me、权限轮询及隐藏
      // 标签页均不会调用它，所以无人操作的会话仍会在空闲窗口到期后退出。
      const touchedAt = Date.now()
      if (touchedAt - lastSessionRefreshAt >= SESSION_REFRESH_INTERVAL_MS) {
        await refreshCurrentSession()
        lastSessionRefreshAt = touchedAt
      }
      lastServerTouchAt = touchedAt
    } catch (error) {
      if (error instanceof AuthError && error.status === 401) {
        notifySessionEnded('server-revoked')
        await end('server-revoked')
        return
      }
      onSessionError?.(error)
    } finally {
      serverTouchInFlight = false
    }
  }

  function onActivity() {
    if (stopped || expiring) return
    scheduleExpiry()
    void touchServer()
  }

  const onExternalSessionEnd = (event) => {
    const reason = event?.detail?.reason || 'global-logout'
    void end(reason)
  }

  const start = (principal) => {
    if (!browserAvailable()) return
    stop()
    timeoutSeconds = normalizeTimeout(principal?.idle_timeout_seconds)
    stopped = false
    // 登录本身已写入初始交互时间；保留 0 可使用户登录后的第一次操作立即与服务端
    // 同步，而不是被固定一分钟的节流窗口吞掉。
    lastServerTouchAt = 0
    lastSessionRefreshAt = 0
    ACTIVITY_EVENTS.forEach((event) => window.addEventListener(event, onActivity, { passive: true }))
    scheduleExpiry()
  }

  if (browserAvailable()) {
    // CustomEvent 覆盖当前标签页，BroadcastChannel 覆盖同源其他标签页；二者都不跨站传递凭据。
    window.addEventListener(SESSION_EVENT, onExternalSessionEnd)
    if (typeof BroadcastChannel !== 'undefined') {
      channel = new BroadcastChannel(SESSION_CHANNEL)
      channel.onmessage = (event) => {
        if (event?.data?.type === 'session-ended') {
          notifySessionEnded(event.data.reason || 'global-logout')
        }
      }
    }
  }

  return {
    start,
    stop,
    destroy() {
      stop()
      if (!browserAvailable()) return
      window.removeEventListener(SESSION_EVENT, onExternalSessionEnd)
      channel?.close()
      channel = null
    },
  }
}

/** 将显式退出立即广播到当前标签页及其他同源应用标签页。 */
export function broadcastSessionEnded(reason = 'logout') {
  notifySessionEnded(reason)
  if (browserAvailable() && typeof BroadcastChannel !== 'undefined') {
    const channel = new BroadcastChannel(SESSION_CHANNEL)
    channel.postMessage({ type: 'session-ended', reason })
    channel.close()
  }
}
