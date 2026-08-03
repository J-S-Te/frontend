/**
 * 串联平台路由会话同步，并用世代号丢弃导航后才返回的旧 /auth/me 结果。
 * 每次边界变化都创建新世代；旧请求不能重新启动子系统页已停止的平台 idle timer。
 */
export function createPlatformSessionSynchronizer({
  loadPrincipal,
  activate,
  deactivate,
  onSynchronizationError,
  onRefresh,
  onRefreshError,
} = {}) {
  let generation = 0
  let active = false

  async function synchronize(requiresPlatformSession) {
    const currentGeneration = ++generation
    active = requiresPlatformSession
    if (!requiresPlatformSession) {
      deactivate?.()
      return
    }

    try {
      const principal = await loadPrincipal()
      if (currentGeneration !== generation || !active) return
      activate?.(principal)
    } catch (error) {
      if (currentGeneration !== generation || !active) return
      deactivate?.()
      await onSynchronizationError?.(error)
    }
  }

  async function refresh() {
    const currentGeneration = generation
    if (!active) return
    try {
      const principal = await loadPrincipal()
      if (currentGeneration !== generation || !active) return
      onRefresh?.(principal)
    } catch (error) {
      if (currentGeneration !== generation || !active) return
      await onRefreshError?.(error)
    }
  }

  return { synchronize, refresh }
}
