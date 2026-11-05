import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DOWNLOAD_TIMEOUT_MESSAGE,
  DOWNLOAD_TIMEOUT_MS,
  createDownloadTimeoutSignal,
  downloadAbortSignal,
  downloadRequestSignal,
  isAbortError,
  isDownloadAbort,
} from './downloadTimeout.js'

// 临时替换 AbortSignal 静态方法并保证恢复；run 可为异步，恢复在 run 完成后执行。
async function withAbortSignalStatics(overrides, run) {
  const saved = {}
  for (const [key, value] of Object.entries(overrides)) {
    saved[key] = globalThis.AbortSignal[key]
    globalThis.AbortSignal[key] = value
  }
  try {
    return await run()
  } finally {
    for (const [key, value] of Object.entries(saved)) globalThis.AbortSignal[key] = value
  }
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

test('下载超时默认 60 秒，并按调用方给定毫秒数生成 signal', async () => {
  const sentinel = { kind: 'timeout-signal' }
  const calls = []
  await withAbortSignalStatics({ timeout: (ms) => { calls.push(ms); return sentinel } }, () => {
    assert.equal(downloadAbortSignal(), sentinel)
    assert.equal(downloadAbortSignal(1500), sentinel)
    assert.equal(DOWNLOAD_TIMEOUT_MS, 60000)
  })
  assert.deepEqual(calls, [DOWNLOAD_TIMEOUT_MS, 1500])
})

test('生成 signal 抛错时回退为无超时，不能阻断下载', async () => {
  await withAbortSignalStatics({ timeout: () => { throw new RangeError('invalid timeout') } }, () => {
    assert.equal(downloadAbortSignal(), undefined)
    assert.equal(createDownloadTimeoutSignal().signal, undefined)
  })
})

test('降级路径：缺少 AbortSignal.timeout 时用 AbortController + setTimeout 等价超时', async () => {
  await withAbortSignalStatics({ timeout: undefined }, async () => {
    const timeout = createDownloadTimeoutSignal(10)
    assert.ok(timeout.signal instanceof AbortSignal, '降级实现必须返回真实 signal，而不是空值')
    assert.equal(timeout.signal.aborted, false)
    await wait(40)
    assert.equal(timeout.signal.aborted, true, '超时后必须中止请求')
    assert.equal(timeout.signal.reason?.name, 'TimeoutError', '中止原因与 AbortSignal.timeout 同名')
    assert.equal(isDownloadAbort(timeout.signal.reason), true)
    timeout.dispose()
    assert.equal(timeout.signal.aborted, true, '超时后清理不能撤销已发生的中止')
  })
})

test('降级路径：dispose 提前撤销定时器，不泄漏悬挂定时器也不误伤请求', async () => {
  await withAbortSignalStatics({ timeout: undefined }, async () => {
    const timeout = createDownloadTimeoutSignal(10)
    timeout.dispose()
    timeout.dispose()
    await wait(40)
    assert.equal(timeout.signal.aborted, false, '清理后不能再中止已完成的请求')
  })
})

test('降级路径：非法毫秒数按原生语义回退为无超时信号', async () => {
  await withAbortSignalStatics({ timeout: undefined }, () => {
    assert.equal(createDownloadTimeoutSignal(-1).signal, undefined)
    assert.equal(createDownloadTimeoutSignal(Number.NaN).signal, undefined)
  })
})

test('AbortError 只匹配主动取消，超时中断由 isDownloadAbort 一并识别', () => {
  assert.equal(isAbortError({ name: 'AbortError' }), true)
  assert.equal(isAbortError(new DOMException('aborted', 'AbortError')), true)
  assert.equal(isAbortError({ name: 'TimeoutError' }), false)
  assert.equal(isAbortError(null), false)
  assert.equal(isAbortError(undefined), false)

  assert.equal(isDownloadAbort({ name: 'TimeoutError' }), true)
  assert.equal(isDownloadAbort(new DOMException('timed out', 'TimeoutError')), true)
  assert.equal(isDownloadAbort({ name: 'AbortError' }), true)
  assert.equal(isDownloadAbort(new TypeError('Failed to fetch')), false)
  assert.equal(isDownloadAbort(null), false)
})

test('下载超时提示为可直接展示的中文文案', () => {
  assert.equal(typeof DOWNLOAD_TIMEOUT_MESSAGE, 'string')
  assert.match(DOWNLOAD_TIMEOUT_MESSAGE, /下载超时/)
})

test('无调用方 signal 时直接使用超时 signal 并可归因超时', async () => {
  const requestSignal = downloadRequestSignal(undefined, 10)
  assert.equal(requestSignal.cancelled(), false)
  assert.equal(requestSignal.timedOut(), false)
  assert.equal(requestSignal.signal?.aborted, false)
  await wait(40)
  assert.equal(requestSignal.signal?.aborted, true)
  assert.equal(requestSignal.timedOut(), true)
  assert.equal(requestSignal.cancelled(), false)
  requestSignal.dispose()
})

test('调用方 signal 不被覆盖：合并后取消仍归因为用户取消', async () => {
  const controller = new AbortController()
  const requestSignal = downloadRequestSignal(controller.signal, 10000)
  assert.ok(requestSignal.signal)
  assert.equal(requestSignal.signal.aborted, false)
  controller.abort()
  assert.equal(requestSignal.signal.aborted, true)
  assert.equal(requestSignal.cancelled(), true)
  assert.equal(requestSignal.timedOut(), false)
  requestSignal.dispose()
})

test('合并 signal 在超时后中止请求且不被当作调用方取消', async () => {
  const controller = new AbortController()
  const requestSignal = downloadRequestSignal(controller.signal, 10)
  assert.equal(controller.signal.aborted, false)
  await wait(40)
  assert.equal(requestSignal.signal?.aborted, true)
  assert.equal(requestSignal.cancelled(), false)
  assert.equal(requestSignal.timedOut(), true)
  requestSignal.dispose()
})

test('环境不支持超时 signal 时沿用调用方 signal，不改变取消行为', async () => {
  const controller = new AbortController()
  await withAbortSignalStatics({ timeout: () => { throw new RangeError('invalid timeout') } }, () => {
    const requestSignal = downloadRequestSignal(controller.signal)
    assert.equal(requestSignal.signal, controller.signal)
    assert.equal(requestSignal.timedOut(), false)
    controller.abort()
    assert.equal(requestSignal.cancelled(), true)
    requestSignal.dispose()
  })
})

test('降级路径：缺少 AbortSignal.any 时手工合并，取消与超时都生效', async () => {
  await withAbortSignalStatics({ any: undefined }, async () => {
    const cancelledController = new AbortController()
    const cancelled = downloadRequestSignal(cancelledController.signal, 10000)
    assert.ok(cancelled.signal)
    assert.notEqual(cancelled.signal, cancelledController.signal, '合并信号不能直接复用调用方 signal')
    assert.equal(cancelled.signal.aborted, false)
    cancelledController.abort()
    assert.equal(cancelled.signal.aborted, true)
    assert.equal(cancelled.cancelled(), true)
    assert.equal(cancelled.timedOut(), false)
    cancelled.dispose()

    const timedOutController = new AbortController()
    const timedOut = downloadRequestSignal(timedOutController.signal, 10)
    assert.equal(timedOutController.signal.aborted, false)
    await wait(40)
    assert.equal(timedOut.signal?.aborted, true, '手工合并后超时仍须中止请求')
    assert.equal(timedOut.cancelled(), false)
    assert.equal(timedOut.timedOut(), true)
    timedOut.dispose()
  })
})

test('降级路径：调用方 signal 已中止时合并信号立即中止，归因为用户取消', async () => {
  const controller = new AbortController()
  controller.abort()
  await withAbortSignalStatics({ any: undefined }, () => {
    const requestSignal = downloadRequestSignal(controller.signal, 10000)
    assert.equal(requestSignal.signal?.aborted, true)
    assert.equal(requestSignal.cancelled(), true)
    assert.equal(requestSignal.timedOut(), false)
    requestSignal.dispose()
  })
})

test('降级路径：dispose 移除手工监听与降级定时器，之后不再中止也不抛异常', async () => {
  await withAbortSignalStatics({ any: undefined, timeout: undefined }, async () => {
    const controller = new AbortController()
    const requestSignal = downloadRequestSignal(controller.signal, 10)
    requestSignal.dispose()
    requestSignal.dispose()
    controller.abort()
    await wait(40)
    assert.equal(requestSignal.signal?.aborted, false, '清理后既不再接受超时也不再接受已释放的取消')
    assert.equal(requestSignal.cancelled(), true, '归因读取原始调用方 signal，清理不影响事实')
  })
})

test('降级路径：缺少 AbortSignal.any 与 timeout 时超时兜底仍生效且不产生未处理异常', async () => {
  await withAbortSignalStatics({ any: undefined, timeout: undefined }, async () => {
    const controller = new AbortController()
    const requestSignal = downloadRequestSignal(controller.signal, 10)
    const reasons = []
    requestSignal.signal?.addEventListener('abort', () => reasons.push(requestSignal.signal.reason))
    await wait(40)
    assert.equal(requestSignal.signal?.aborted, true)
    assert.equal(reasons.length, 1)
    assert.equal(reasons[0]?.name, 'TimeoutError')
    assert.equal(requestSignal.timedOut(), true)
    assert.equal(requestSignal.cancelled(), false)
    requestSignal.dispose()
  })
})
