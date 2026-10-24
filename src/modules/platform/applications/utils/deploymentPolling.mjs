function pause(ms, signal) {
  if (signal?.aborted) return Promise.resolve()
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', finish)
      resolve()
    }
    const timer = setTimeout(finish, ms)
    signal?.addEventListener('abort', finish, { once: true })
  })
}

// 默认终端状态：遗留部署状态机的终态（保持既有行为不变）。
const DEFAULT_TERMINAL_STATUSES = ['READY', 'PROVISION_FAILED', 'OFFBOARDED']

// 取消界面观察不会取消服务端部署任务。
// 统一接入向导按操作 ID 轮询时传入 terminalStatuses: ['SUCCEEDED', 'FAILED', 'WAITING']
// 与 immediate: true（进入页面立即读一次，不必先等一个间隔）。
export async function pollDeployment({ readStatus, onStatus, signal, intervalMs = 4000,
  timeoutMs = 20 * 60 * 1000, now = Date.now, wait = pause,
  terminalStatuses = DEFAULT_TERMINAL_STATUSES, immediate = false }) {
  const deadline = now() + timeoutMs
  const terminals = Array.isArray(terminalStatuses) && terminalStatuses.length > 0
    ? terminalStatuses : DEFAULT_TERMINAL_STATUSES
  let firstRead = !immediate
  while (now() < deadline) {
    if (signal?.aborted) return 'CANCELLED'
    if (firstRead) {
      await wait(Math.min(intervalMs, deadline - now()), signal)
      if (signal?.aborted) return 'CANCELLED'
      if (now() >= deadline) break
    }
    firstRead = true
    let state
    try {
      state = await readStatus()
    } catch (error) {
      if (signal?.aborted) return 'CANCELLED'
      throw error
    }
    if (signal?.aborted) return 'CANCELLED'
    onStatus?.(state)
    if (terminals.includes(state?.status)) return state.status
  }
  return 'TIMEOUT'
}
