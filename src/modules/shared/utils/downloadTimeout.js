/**
 * 下载/模板类请求的超时工具。
 *
 * 约定：
 * - 纯函数，不发起网络、不读写 DOM，也不持有任何模块级可变状态。
 * - 仅用于导出、模板、预览等下载类请求；上传（multipart、大文件、三段式）不设
 *   硬超时，避免慢速上传被误杀。
 * - 调用方若已传入自己的 AbortSignal（例如切换原件时取消旧请求），取消语义必须保留；
 *   同时仍附加下载超时（两者合并，不覆盖调用方 signal），从而区分“用户取消”和
 *   “下载超时”。
 * - `AbortSignal.timeout` 在旧浏览器（如 Safari 16 之前、旧版 Chromium）不存在；
 *   此时用 `AbortController` + `setTimeout` 实现等价超时信号（超时后以 TimeoutError
 *   中止），不退化为“无超时”。降级定时器在超时或调用 `dispose()` 后清理，不留下
 *   悬挂定时器。
 * - `AbortSignal.any` 不可用时，手工合并调用方 signal 与超时 signal：任一中止即中止
 *   合并信号，并在合并结束或 `dispose()` 时移除监听，保证取消与超时同时生效且不泄漏
 *   监听。
 */

/** 下载/模板请求的默认超时时间（毫秒）。 */
export const DOWNLOAD_TIMEOUT_MS = 60000

/** 下载超时时面向用户的可读提示；调用方按各自错误类包装。 */
export const DOWNLOAD_TIMEOUT_MESSAGE = '下载超时，请重试。'

/** 超时中止使用的错误名，与 `AbortSignal.timeout` 的 DOMException 名称保持一致。 */
const TIMEOUT_ERROR_NAME = 'TimeoutError'

/**
 * createDownloadTimeoutSignal 生成下载超时 signal 及其清理函数。
 * @param {number} [ms=DOWNLOAD_TIMEOUT_MS] 超时毫秒数。
 * @returns {{signal: AbortSignal|undefined, dispose: () => void}} 超时 signal（环境无法生成时为
 *   undefined）与清理函数；清理函数可提前撤销降级定时器，重复调用无效。
 */
export function createDownloadTimeoutSignal(ms = DOWNLOAD_TIMEOUT_MS) {
  if (typeof globalThis.AbortSignal?.timeout === 'function') {
    try {
      return { signal: globalThis.AbortSignal.timeout(ms), dispose: () => {} }
    } catch {
      // 非法毫秒数等运行时限制回退为无超时，不能因为生成 signal 失败而阻断下载。
      return { signal: undefined, dispose: () => {} }
    }
  }
  try {
    return createFallbackTimeoutSignal(ms)
  } catch {
    // 降级实现同样无法建立时保持原有无超时语义，而不是无端取消下载。
    return { signal: undefined, dispose: () => {} }
  }
}

/**
 * downloadAbortSignal 生成下载请求的超时取消信号。
 * 旧浏览器没有 `AbortSignal.timeout` 时走 AbortController 降级实现；需要提前释放降级
 * 定时器时改用 `createDownloadTimeoutSignal`。
 * @param {number} [ms=DOWNLOAD_TIMEOUT_MS] 超时毫秒数。
 * @returns {AbortSignal|undefined} 超时 signal；连降级实现也无法建立时返回 undefined。
 */
export function downloadAbortSignal(ms = DOWNLOAD_TIMEOUT_MS) {
  return createDownloadTimeoutSignal(ms).signal
}

/**
 * downloadRequestSignal 合并调用方取消信号与下载超时信号。
 * 返回的 signal 直接传给 fetch；`cancelled()` / `timedOut()` 用于在 catch 中区分
 * 用户取消（原样抛出 AbortError）与下载超时（转换为可读错误）。`dispose()` 在请求
 * 结束后清理降级定时器与手工合并的监听，可重复调用。
 * @param {AbortSignal|undefined|null} callerSignal 调用方自带的取消信号。
 * @param {number} [ms=DOWNLOAD_TIMEOUT_MS] 下载超时毫秒数。
 * @returns {{signal: AbortSignal|undefined, cancelled: () => boolean, timedOut: () => boolean, dispose: () => void}}
 *   请求信号、中断归因与清理函数。
 */
export function downloadRequestSignal(callerSignal, ms = DOWNLOAD_TIMEOUT_MS) {
  const timeout = createDownloadTimeoutSignal(ms)
  const timeoutSignal = timeout.signal
  if (!callerSignal) {
    return {
      signal: timeoutSignal,
      cancelled: () => false,
      timedOut: () => Boolean(timeoutSignal?.aborted),
      dispose: timeout.dispose,
    }
  }
  if (!timeoutSignal) {
    return {
      signal: callerSignal,
      cancelled: () => Boolean(callerSignal.aborted),
      timedOut: () => false,
      dispose: () => {},
    }
  }
  if (typeof globalThis.AbortSignal?.any === 'function') {
    try {
      const combined = globalThis.AbortSignal.any([callerSignal, timeoutSignal])
      return {
        signal: combined,
        cancelled: () => Boolean(callerSignal.aborted),
        timedOut: () => !callerSignal.aborted && Boolean(timeoutSignal.aborted),
        dispose: timeout.dispose,
      }
    } catch {
      // 运行时拒绝合并时继续走手工合并，保证超时与取消都不会丢失。
    }
  }
  return mergeAbortSignals(callerSignal, timeoutSignal, timeout.dispose)
}

/**
 * isAbortError 判断错误是否为调用方主动取消（AbortController.abort）。
 * @param {unknown} error 捕获到的异常。
 * @returns {boolean} 名称恰为 AbortError 时为 true。
 */
export function isAbortError(error) {
  return error?.name === 'AbortError'
}

/**
 * isDownloadAbort 判断错误是否由取消/超时中断产生。
 * `AbortSignal.timeout` 触发时 DOMException 的 name 是 TimeoutError，而用户主动
 * 取消是 AbortError；下载客户端需要同时识别两者，再用 downloadRequestSignal 的
 * `cancelled()` / `timedOut()` 决定保留取消语义还是转换成可读超时错误。
 * @param {unknown} error 捕获到的异常。
 * @returns {boolean} 取消或超时中断时为 true。
 */
export function isDownloadAbort(error) {
  return isAbortError(error) || error?.name === 'TimeoutError'
}

// 用途：构造与 `AbortSignal.timeout` 同名的中止原因。
// 参数：无。
// 返回值：name 为 TimeoutError 的 DOMException（环境缺 DOMException 时用等价 Error）。
function timeoutReason() {
  try {
    if (typeof DOMException === 'function') return new DOMException('download timeout', TIMEOUT_ERROR_NAME)
  } catch {
    // 继续走 Error 兜底。
  }
  return Object.assign(new Error('download timeout'), { name: TIMEOUT_ERROR_NAME })
}

// 用途：用 AbortController + setTimeout 实现 `AbortSignal.timeout` 的等价降级。
// 参数：ms 为超时毫秒数。
// 返回值：超时 signal 与清理函数；非法毫秒数按原生行为抛 RangeError（由调用方兜底）。
function createFallbackTimeoutSignal(ms) {
  const delay = Number(ms)
  if (!Number.isFinite(delay) || delay < 0) throw new RangeError('invalid timeout')
  const controller = new AbortController()
  let timer
  const dispose = () => {
    if (timer === undefined) return
    globalThis.clearTimeout?.(timer)
    timer = undefined
  }
  timer = globalThis.setTimeout(() => {
    timer = undefined
    try {
      controller.abort(timeoutReason())
    } catch {
      controller.abort()
    }
  }, delay)
  // Node 下允许进程在只剩该定时器时退出；浏览器没有 unref，取值为 undefined 也安全。
  timer?.unref?.()
  return { signal: controller.signal, dispose }
}

// 用途：手工合并调用方 signal 与超时 signal（`AbortSignal.any` 的等价降级）。
// 参数：callerSignal 为调用方取消信号，timeoutSignal 为超时信号，disposeTimeout 为超时清理函数。
// 返回值：合并 signal、取消/超时归因与清理函数；监听在任一信号中止或 dispose 时移除。
function mergeAbortSignals(callerSignal, timeoutSignal, disposeTimeout) {
  const controller = new AbortController()
  let disposed = false
  const abort = (reason) => {
    try {
      controller.abort(reason)
    } catch {
      controller.abort()
    }
  }
  const cleanup = () => {
    if (disposed) return
    disposed = true
    callerSignal.removeEventListener?.('abort', onCallerAbort)
    timeoutSignal.removeEventListener?.('abort', onTimeoutAbort)
    disposeTimeout?.()
  }
  function onCallerAbort() {
    cleanup()
    abort(callerSignal.reason)
  }
  function onTimeoutAbort() {
    cleanup()
    abort(timeoutSignal.reason)
  }
  if (callerSignal.aborted) abort(callerSignal.reason)
  else if (timeoutSignal.aborted) abort(timeoutSignal.reason)
  else {
    callerSignal.addEventListener?.('abort', onCallerAbort, { once: true })
    timeoutSignal.addEventListener?.('abort', onTimeoutAbort, { once: true })
  }
  return {
    signal: controller.signal,
    // 归因读取原始信号状态：即使合并信号已中止，也要能区分是谁先中止的。
    cancelled: () => Boolean(callerSignal.aborted),
    timedOut: () => !callerSignal.aborted && Boolean(timeoutSignal.aborted),
    dispose: cleanup,
  }
}
