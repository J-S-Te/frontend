import { AuthError, logoutCurrentSession, recordSessionActivity } from '@/modules/platform/auth/api/auth'

const SESSION_EVENT = 'platform-auth:session-ended'
const SESSION_CHANNEL = 'basic-platform-auth'
const DEFAULT_IDLE_TIMEOUT_SECONDS = 30 * 60
const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'scroll', 'touchstart']
const SERVER_TOUCH_INTERVAL_MS = 60 * 1000

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
 * Coordinates browser-side inactivity feedback for every route in this SPA. Server-side session
 * revocation remains authoritative: this helper provides immediate user feedback and sends a
 * throttled activity signal only after real user interaction, never after background API traffic.
 */
export function createSessionLifecycle({ onSessionEnded, onSessionError } = {}) {
  let idleTimer = 0
  let timeoutSeconds = DEFAULT_IDLE_TIMEOUT_SECONDS
  let stopped = true
  let expiring = false
  let lastServerTouchAt = 0
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
          // The server might already have invalidated this session. The local sign-in state must
          // still end, and other systems will reject the shared server session as well.
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
    if (stopped || Date.now() - lastServerTouchAt < SERVER_TOUCH_INTERVAL_MS) return
    lastServerTouchAt = Date.now()
    try {
      const principal = await recordSessionActivity()
      timeoutSeconds = normalizeTimeout(principal?.idle_timeout_seconds)
    } catch (error) {
      if (error instanceof AuthError && error.status === 401) {
        notifySessionEnded('server-revoked')
        await end('server-revoked')
        return
      }
      onSessionError?.(error)
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
    lastServerTouchAt = Date.now()
    ACTIVITY_EVENTS.forEach((event) => window.addEventListener(event, onActivity, { passive: true }))
    scheduleExpiry()
  }

  if (browserAvailable()) {
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

/** Broadcasts an explicit sign-out to same-origin application tabs immediately. */
export function broadcastSessionEnded(reason = 'logout') {
  notifySessionEnded(reason)
  if (browserAvailable() && typeof BroadcastChannel !== 'undefined') {
    const channel = new BroadcastChannel(SESSION_CHANNEL)
    channel.postMessage({ type: 'session-ended', reason })
    channel.close()
  }
}
