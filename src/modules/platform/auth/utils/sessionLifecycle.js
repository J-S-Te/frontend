// 与 auth.js 互相调用的生命周期协调器使用相对导入，避免 Node 测试环境依赖 Vite 别名。
import {
  AuthError, getCurrentPrincipal, logoutCurrentSession,
  recordSessionActivity, refreshCurrentSession,
} from '../api/auth.js'
import { clearRememberedAccount } from './rememberedAccount.js'
import { clearSessionScopedStorage } from '../../../shared/utils/sessionScopedStorage.js'

const SESSION_EVENT = 'platform-auth:session-ended'
const SESSION_CHANNEL = 'basic-platform-auth'
const DEFAULT_IDLE_TIMEOUT_SECONDS = 30 * 60
const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'scroll', 'touchstart']
const SERVER_TOUCH_INTERVAL_MS = 60 * 1000
const MIN_SERVER_TOUCH_INTERVAL_MS = 10 * 1000
const SESSION_REFRESH_INTERVAL_MS = 10 * 60 * 1000
const IDLE_PROBE_TIMEOUT_MS = 10 * 1000

// browserAvailable 判断生命周期是否运行在浏览器。
// 参数：无。
// 返回值：是否存在浏览器窗口。
function browserAvailable() {
  return typeof window !== 'undefined'
}

// normalizeTimeout 将服务端策略限制到支持的空闲秒数范围。
// 参数：value 为服务端返回的租户空闲秒数。
// 返回值：有效秒数；非法输入回退默认策略。
function normalizeTimeout(value) {
  const seconds = Number(value)
  if (!Number.isFinite(seconds) || seconds < 60) return DEFAULT_IDLE_TIMEOUT_SECONDS
  return Math.min(seconds, 24 * 60 * 60)
}

// notifySessionEnded 清理本页存储并发送会话结束事件。
// 参数：reason 为手动退出或服务端撤销等结束原因。
// 返回值：无。
function notifySessionEnded(reason = 'logout') {
  if (!browserAvailable()) return
  // SEC-X3：会话终结（显式登出/空闲超时/服务端撤销/跨标签页广播）是“记住的账号”
  // 必须清除的统一漏斗——localStorage 无过期时间，登出后残留的明文账号在共享设备上
  // 属于信息泄露。放在这里可同时覆盖本标签页事件与 BroadcastChannel 转发。
  // 会话作用域存储（操作记录/操作结果/表单草稿）同样在此清除，防止下一账号读出。
  clearRememberedAccount()
  clearSessionScopedStorage()
  window.dispatchEvent(new CustomEvent(SESSION_EVENT, { detail: { reason } }))
}

// createSessionLifecycle 协调本页空闲退出，后台接口请求和轮询不能延长会话。
// 参数：onSessionEnded 接收结束原因，onSessionError 接收真实交互上报异常。
// 返回值：包含启动、停止和销毁操作的生命周期控制器。
export function createSessionLifecycle({ onSessionEnded, onSessionError } = {}) {
  let idleTimer = 0
  let timeoutSeconds = DEFAULT_IDLE_TIMEOUT_SECONDS
  let stopped = true
  let expiring = false
  let lastServerTouchAt = 0
  let lastSessionRefreshAt = 0
  let serverTouchInFlight = null
  let idleProbeInFlight = null
  let idleProbeTimer = 0
  let generation = 0
  let sessionGeneration = 0
  let activeIdentity = null
  let channel = null

  // clearTimer 取消本页当前空闲定时器。
  // 参数：无。
  // 返回值：无。
  const clearTimer = () => {
    if (idleTimer) window.clearTimeout(idleTimer)
    idleTimer = 0
  }

  // clearProbeTimer 清理空闲读取的等待截止计时器。
  // 参数：无。
  // 返回值：无。
  const clearProbeTimer = () => {
    if (idleProbeTimer) window.clearTimeout(idleProbeTimer)
    idleProbeTimer = 0
  }

  // invalidateProbe 使旧空闲读取失效，防止迟到响应覆盖新交互窗口。
  // 参数：无。
  // 返回值：无。
  const invalidateProbe = () => {
    generation += 1
    idleProbeInFlight = null
    clearProbeTimer()
  }

  // stop 停止本页计时和事件监听，并使旧请求失效。
  // 参数：无。
  // 返回值：无。
  const stop = () => {
    stopped = true
    sessionGeneration += 1
    invalidateProbe()
    serverTouchInFlight = null
    clearTimer()
    ACTIVITY_EVENTS.forEach((event) => window.removeEventListener(event, onActivity))
  }

  // end 结束本页；只有明确的旧协议回退才调用全账号退出接口。
  // 参数：reason 为结束原因，legacyLogout 表示服务端尚无剩余窗口协议。
  // 返回值：退出处理完成的 Promise。
  const end = async (reason, legacyLogout = false) => {
    if (stopped || expiring) return
    expiring = true
    stop()
    const endedGeneration = generation
    try {
      if (legacyLogout) {
        try {
          await logoutCurrentSession()
        } catch {
          // 旧协议保持原有退出语义；服务端已经失效时本页仍须退出。
        }
      }
      if (generation === endedGeneration && stopped) {
        clearRememberedAccount()
        clearSessionScopedStorage()
        onSessionEnded?.(reason)
      }
    } finally {
      if (generation === endedGeneration) expiring = false
    }
  }

  // sameIdentity 验证读取结果仍属于本页启动时的租户、用户和账号。
  // 参数：principal 为只读会话检查返回的主体。
  // 返回值：三个主体标识均有效且相同时为真。
  const sameIdentity = (principal) => ['tenant', 'user', 'account'].every((key) => {
    const id = principal?.[key]?.id
    return typeof id === 'string' && id.trim() && id === activeIdentity?.[key]
  })

  // probeIdleExpiry 以只读接口确认共享会话剩余窗口，不上报活动或刷新令牌。
  // 参数：无。
  // 返回值：检查完成的 Promise；失败只结束当前页面。
  const probeIdleExpiry = async () => {
    if (stopped || expiring || idleProbeInFlight) return
    const requestedGeneration = generation
    const probe = {}
    idleProbeInFlight = probe
    const requestedAt = performance.now()
    // 网络一直没有结果时也须结束本页；世代变化后旧计时器无权影响新窗口。
    idleProbeTimer = window.setTimeout(() => {
      if (!stopped && generation === requestedGeneration && idleProbeInFlight === probe) {
        void end('idle-timeout')
      }
    }, IDLE_PROBE_TIMEOUT_MS)
    try {
      const principal = await getCurrentPrincipal()
      if (stopped || generation !== requestedGeneration || idleProbeInFlight !== probe) return
      if (!sameIdentity(principal)) {
        await end('idle-timeout')
        return
      }
      if (!Object.hasOwn(principal, 'idle_remaining_ms')) {
        // 滚动更新期间只有明确缺少新字段的旧服务端进入原有全局退出回退。
        await end('idle-timeout', true)
        return
      }
      const remaining = principal.idle_remaining_ms
      const policyMS = normalizeTimeout(principal.idle_timeout_seconds) * 1000
      const elapsed = performance.now() - requestedAt
      if (typeof remaining !== 'number' || !Number.isFinite(remaining)
        || remaining <= 0 || remaining > policyMS || !Number.isFinite(elapsed) || elapsed < 0
        || remaining <= elapsed) {
        await end('idle-timeout')
        return
      }
      timeoutSeconds = policyMS / 1000
      scheduleExpiry(remaining - elapsed)
    } catch {
      if (!stopped && generation === requestedGeneration && idleProbeInFlight === probe) {
        await end('idle-timeout')
      }
    } finally {
      if (idleProbeInFlight === probe) {
        clearProbeTimer()
        idleProbeInFlight = null
      }
    }
  }

  // scheduleExpiry 按本地交互策略或权威剩余窗口安排下一次只读校验。
  // 参数：remainingMS 为扣除请求耗时后的剩余毫秒，默认使用租户策略。
  // 返回值：无。
  const scheduleExpiry = (remainingMS = timeoutSeconds * 1000) => {
    clearTimer()
    idleTimer = window.setTimeout(() => { void probeIdleExpiry() }, remainingMS)
  }

  // touchServer 限流记录真实交互，并按原有节奏刷新浏览器 Cookie。
  // 参数：无。
  // 返回值：交互处理完成的 Promise；异常交给会话错误回调。
  const touchServer = async () => {
    // 首次真实交互必须立即写入服务端。后续间隔取空闲窗口的三分之一（上限一分钟），
    // 让最短 60 秒策略也有足够余量，不会因用户恰好在旧窗口末尾操作而被服务端误判为空闲。
    const interval = Math.max(MIN_SERVER_TOUCH_INTERVAL_MS, Math.min(SERVER_TOUCH_INTERVAL_MS, Math.floor(timeoutSeconds * 1000 / 3)))
    if (stopped || serverTouchInFlight || Date.now() - lastServerTouchAt < interval) return
    const touch = {}
    const requestedGeneration = sessionGeneration
    serverTouchInFlight = touch
    try {
      const principal = await recordSessionActivity()
      if (stopped || sessionGeneration !== requestedGeneration || serverTouchInFlight !== touch) return
      timeoutSeconds = normalizeTimeout(principal?.idle_timeout_seconds)
      // 服务端仅在这条由真实交互触发的路径上延长 Cookie；/auth/me、权限轮询及隐藏
      // 标签页均不会调用它，所以无人操作的会话仍会在空闲窗口到期后退出。
      const touchedAt = Date.now()
      if (touchedAt - lastSessionRefreshAt >= SESSION_REFRESH_INTERVAL_MS) {
        await refreshCurrentSession()
        if (stopped || sessionGeneration !== requestedGeneration || serverTouchInFlight !== touch) return
        lastSessionRefreshAt = touchedAt
      }
      lastServerTouchAt = touchedAt
    } catch (error) {
      if (stopped || sessionGeneration !== requestedGeneration || serverTouchInFlight !== touch) return
      if (error instanceof AuthError && error.status === 401) {
        notifySessionEnded('server-revoked')
        await end('server-revoked')
        return
      }
      onSessionError?.(error)
    } finally {
      if (serverTouchInFlight === touch) serverTouchInFlight = null
    }
  }

  // onActivity 使旧校验失效并记录浏览器真实交互。
  // 参数：无。
  // 返回值：无。
  function onActivity() {
    if (stopped || expiring) return
    invalidateProbe()
    scheduleExpiry()
    void touchServer()
  }

  // onExternalSessionEnd 响应本页事件或跨标签页的显式退出。
  // 参数：event 为包含退出原因的事件。
  // 返回值：无。
  const onExternalSessionEnd = (event) => {
    const reason = event?.detail?.reason || 'global-logout'
    void end(reason)
  }

  // start 根据已认证主体启动新的本页会话生命周期。
  // 参数：principal 为当前租户、用户、账号和空闲策略。
  // 返回值：无。
  const start = (principal) => {
    if (!browserAvailable()) return
    stop()
    timeoutSeconds = normalizeTimeout(principal?.idle_timeout_seconds)
    stopped = false
    expiring = false
    activeIdentity = Object.fromEntries(['tenant', 'user', 'account']
      .map(key => [key, principal?.[key]?.id]))
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
    // destroy 解除本页会话监听并关闭广播资源。
    // 参数：无。
    // 返回值：无。
    destroy() {
      stop()
      if (!browserAvailable()) return
      window.removeEventListener(SESSION_EVENT, onExternalSessionEnd)
      channel?.close()
      channel = null
    },
  }
}

// broadcastSessionEnded 将显式退出广播到本页及同源应用标签页。
// 参数：reason 为用户退出或其他全局会话结束原因。
// 返回值：无。
export function broadcastSessionEnded(reason = 'logout') {
  notifySessionEnded(reason)
  if (browserAvailable() && typeof BroadcastChannel !== 'undefined') {
    const channel = new BroadcastChannel(SESSION_CHANNEL)
    channel.postMessage({ type: 'session-ended', reason })
    channel.close()
  }
}
