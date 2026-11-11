// 用途：识别异步任务是否已经到达终态，避免把排队或处理中当成完成。
// 参数：status 为服务端返回的任务状态。
// 返回值：完成、失败或过期时为 true。
export function taskSettled(status) {
  return ['DONE', 'FAILED', 'EXPIRED'].includes(status)
}

// 用途：短轮询一次异步任务，减少用户手动反复点击查询。
// 参数：read 为读取任务状态的函数；attempts/delay 控制次数与间隔；
//       wait 为可替换的等待实现（测试用）；onValue 为每次读取后的回调；
//       shouldContinue 用于页面切换或卸载后停止更新。
// 返回值：最后一次读取到的任务；中途终止时为最后一次值。
export async function pollTask(read, {
  attempts = 5,
  delay = 2000,
  wait = (ms) => new Promise((resolve) => {
    const timer = setTimeout(resolve, ms)
    if (typeof timer?.unref === 'function') timer.unref()
  }),
  onValue,
  shouldContinue,
} = {}) {
  const total = Math.max(1, Math.min(5, Number(attempts) || 5))
  let value = null
  for (let index = 0; index < total; index += 1) {
    if (shouldContinue && !shouldContinue()) return value
    value = await read()
    if (onValue) onValue(value, index)
    // 响应没有任务状态时立即停止，避免把列表或错误信封当成进行中的任务。
    if (!value || typeof value.status !== 'string') return value
    if (taskSettled(value.status)) return value
    if (shouldContinue && !shouldContinue()) return value
    if (index < total - 1) await wait(delay)
  }
  return value
}
