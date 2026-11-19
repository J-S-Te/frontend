import { onBeforeUnmount, onMounted } from 'vue'

// 用途：页面重新可见或获得焦点时强制重读当前系统会话，避免侧栏角色停留在
// 登录时或上次加载时的历史快照；定时兜底覆盖长时间停留页面的场景。
// 参数：refresh 为强制重读函数，接收判断视图仍挂载的回调，intervalMs 为兜底间隔。
// 返回值：无；刷新失败不阻断页面，下一次可见/定时会继续重试。
export function useAuthorizationRefresh(refresh, { intervalMs = 15000 } = {}) {
  if (typeof refresh !== 'function') return
  if (typeof window === 'undefined' || typeof document === 'undefined') return
  let timer = 0
  let running = false
  let stopped = false

  // 用途：合并同一视图的授权刷新并提供挂载状态。
  // 参数：无。
  // 返回值：刷新完成的 Promise。
  async function run() {
    if (stopped || running || document.visibilityState === 'hidden') return
    running = true
    try {
      await refresh(() => !stopped)
    } catch {
      // 会话刷新失败由各系统请求层处理 401/跳转；这里只保证不阻断当前页面。
    } finally {
      running = false
    }
  }

  function onVisible() {
    if (document.visibilityState === 'visible') void run()
  }

  // 业务请求已确认 403 时立即复核会话，不等待下一个定时周期。
  function onAuthorizationDenied() { void run() }

  onMounted(() => {
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    window.addEventListener('dsh:authorization-denied', onAuthorizationDenied)
    timer = window.setInterval(() => void run(), intervalMs)
  })

  onBeforeUnmount(() => {
    stopped = true
    document.removeEventListener('visibilitychange', onVisible)
    window.removeEventListener('focus', onVisible)
    window.removeEventListener('dsh:authorization-denied', onAuthorizationDenied)
    window.clearInterval(timer)
  })
}
