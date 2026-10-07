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

// Cancelling the UI observer never cancels the server-side deployment job.
export async function pollDeployment({ readStatus, onStatus, signal, intervalMs = 4000,
  timeoutMs = 20 * 60 * 1000, now = Date.now, wait = pause }) {
  const deadline = now() + timeoutMs
  while (now() < deadline) {
    if (signal?.aborted) return 'CANCELLED'
    await wait(Math.min(intervalMs, deadline - now()), signal)
    if (signal?.aborted) return 'CANCELLED'
    if (now() >= deadline) break
    let state
    try {
      state = await readStatus()
    } catch (error) {
      if (signal?.aborted) return 'CANCELLED'
      throw error
    }
    if (signal?.aborted) return 'CANCELLED'
    onStatus?.(state)
    if (['READY', 'PROVISION_FAILED', 'OFFBOARDED'].includes(state?.status)) return state.status
  }
  return 'TIMEOUT'
}
