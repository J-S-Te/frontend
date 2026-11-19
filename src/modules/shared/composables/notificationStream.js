import { onBeforeUnmount, onMounted } from 'vue'

const endpoint = '/api/v1/notifications/inbox/stream'

/**
 * 用途：合并当前页面的收件箱订阅，断线时继续校准并在重连后补查。
 * 参数：connect 建立同源 SSE，coalesceMs 为批量刷新等待，fallbackMs 为断线初始间隔。
 * 返回值：接收刷新回调并返回取消函数的订阅器。
 */
export function createNotificationStream({
  connect = () => new EventSource(endpoint),
  coalesceMs = 80,
  fallbackMs = 15000,
} = {}) {
  const listeners = new Set()
  let source
  let refreshTimer
  let recoveryTimer
  let delay = fallbackMs

  /**
   * 用途：合并到达的通知信号，并在各页面刷新后处理刷新期间的新信号。
   * 参数：无。
   * 返回值：无。
   */
  function scheduleRefresh() {
    if (refreshTimer !== undefined) return
    refreshTimer = setTimeout(() => {
      refreshTimer = undefined
      for (const listener of listeners) {
        if (listener.running) {
          listener.pending = true
          continue
        }
        void refresh(listener)
      }
    }, coalesceMs)
  }

  /**
   * 用途：串行调用一个视图的刷新；新信号合并为下一次补查。
   * 参数：listener 为当前登记的视图回调和状态。
   * 返回值：刷新后的 Promise。
   */
  async function refresh(listener) {
    listener.running = true
    try {
      do {
        listener.pending = false
        await listener.run()
      } while (listener.pending && listeners.has(listener))
    } finally {
      listener.running = false
    }
  }

  /**
   * 用途：在长连接不可用时带退避补查，终止的连接也会重新建立。
   * 参数：无。
   * 返回值：无。
   */
  function recover() {
    if (recoveryTimer !== undefined || !listeners.size) return
    recoveryTimer = setTimeout(() => {
      recoveryTimer = undefined
      if (typeof document === 'undefined' || !document.hidden) scheduleRefresh()
      delay = Math.min(delay * 2, 60000)
      if (source?.readyState === 2) start()
      recover()
    }, delay)
  }

  /**
   * 用途：为全部活动订阅建立一条 SSE 连接，并忽略旧连接的迟到事件。
   * 参数：无。
   * 返回值：无。
   */
  function start() {
    source?.close()
    try {
      const connection = connect()
      source = connection
      connection.addEventListener('ready', () => {
        if (source !== connection) return
        clearTimeout(recoveryTimer)
        recoveryTimer = undefined
        delay = fallbackMs
        scheduleRefresh()
      })
      connection.addEventListener('inbox-changed', () => {
        if (source === connection) scheduleRefresh()
      })
      connection.addEventListener('error', () => {
        if (source === connection) recover()
      })
      recover()
    } catch {
      source = undefined
      recover()
    }
  }

  return (run) => {
    const listener = { run, running: false, pending: false }
    listeners.add(listener)
    if (listeners.size === 1) start()
    return () => {
      listeners.delete(listener)
      if (listeners.size) return
      source?.close()
      source = undefined
      clearTimeout(refreshTimer)
      clearTimeout(recoveryTimer)
      refreshTimer = recoveryTimer = undefined
      delay = fallbackMs
    }
  }
}

const observe = createNotificationStream()

/**
 * 用途：随 Vue 视图挂载和卸载订阅平台收件箱变更。
 * 参数：refresh 为重新读取当前收件箱或角标的函数。
 * 返回值：无。
 */
export function useNotificationStream(refresh) {
  let stop
  onMounted(() => { stop = observe(refresh) })
  onBeforeUnmount(() => { stop?.() })
}
