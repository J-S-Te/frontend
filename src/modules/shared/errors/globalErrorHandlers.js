// 全局错误兜底：把"没有任何组件接住"的错误收进提示通道。
//
// 三条来源，一条出口：
//   1. Vue 运行期未捕获错误（app.config.errorHandler）——页面组件、watcher、生命周期；
//   2. 浏览器层的 window 'error' / 'unhandledrejection'——事件回调、未被 catch 的 Promise；
//   3. router.onError——路由守卫抛错、按需加载的 chunk 拉取失败。
//
// 为什么去重和节流放在这里而不是只管展示：一次断网能同时触发 error、rejection 和
// 多个路由失败，如果不在这里收口，用户会被十几条同样的提示埋掉。判定复用
// toastQueue（与全局提示总线同一套策略），所以"去重窗口""10s 内最多 3 条"只有一份实现。
import { createToastQueue } from './toastQueue.js'
import { describeUnhandledError } from './errorMessages.js'
import { notifyGlobalError } from './toastBus.js'

// 这些不是用户能处理、也不代表页面坏了的信号，直接忽略：
// ResizeObserver 的循环提示是浏览器噪音；资源加载失败（<img>/<link>）由 target 判断。
const BENIGN_MESSAGE = /ResizeObserver loop (?:completed with undelivered notifications|limit exceeded)/i

/**
 * 安装全局错误兜底。
 *
 * @param {object} app Vue 应用实例（会改写 app.config.errorHandler）
 * @param {object} router vue-router 实例（会挂 onError）
 * @param {object} options
 * @param {Function} [options.notify] 提示落地函数，默认进全球提示总线
 * @param {number} [options.dedupeMs] 同一文案的去重窗口
 * @param {number} [options.windowMs] 节流窗口
 * @param {number} [options.maxPerWindow] 节流窗口内的最大条数
 * @param {object} [options.win] window 替身（测试用）
 * @param {Function} [options.now] 时钟（测试用）
 * @returns {{dispose: Function, report: Function}}
 */
export function installGlobalErrorHandlers(app, router, options = {}) {
  const deliver = typeof options.notify === 'function' ? options.notify : notifyGlobalError
  const gate = createToastQueue({
    dedupeMs: options.dedupeMs,
    windowMs: options.windowMs,
    maxPerWindow: options.maxPerWindow,
  })
  const now = typeof options.now === 'function' ? options.now : () => Date.now()
  const win = options.win ?? (typeof window === 'undefined' ? null : window)
  const previousErrorHandler = app?.config?.errorHandler

  /**
   * 翻译 + 过闸 + 落地。
   * @returns {boolean} 是否真的产生了提示
   */
  function report(error, source) {
    const payload = describeUnhandledError(error, source)
    const verdict = gate.push(payload, now())
    if (!verdict.accepted) return false
    deliver(payload)
    return true
  }

  function onWindowError(event) {
    // 资源加载失败（<img>/<link>/<script>）也会冒泡到 window，但 target 是元素而不是 window，
    // 那不是页面崩溃，不该弹"页面遇到错误"。
    if (event?.target && event.target !== win) return
    const message = typeof event?.message === 'string' ? event.message : ''
    if (message && BENIGN_MESSAGE.test(message)) return
    report(event?.error ?? message, 'window-error')
  }

  function onUnhandledRejection(event) {
    const reason = event?.reason
    const text = typeof reason === 'string' ? reason : String(reason?.message ?? '')
    // 已经被业务代码标记处理（preventDefault）或被忽略的噪音不重复提示。
    if (!reason && !text) return
    if (text && BENIGN_MESSAGE.test(text)) return
    report(reason ?? text, 'unhandledrejection')
  }

  function onRouterError(error) {
    report(error, 'router')
  }

  if (app?.config) {
    app.config.errorHandler = (error, instance, info) => {
      // 调用方原有的处理（如果有）先跑，保证不吞掉别人的日志/上报。
      if (typeof previousErrorHandler === 'function') previousErrorHandler(error, instance, info)
      report(error, 'vue')
    }
  }
  win?.addEventListener?.('error', onWindowError)
  win?.addEventListener?.('unhandledrejection', onUnhandledRejection)

  let unregisterRouter = null
  if (typeof router?.onError === 'function') {
    const maybeUnregister = router.onError(onRouterError)
    unregisterRouter = typeof maybeUnregister === 'function' ? maybeUnregister : null
  }

  let disposed = false
  // dispose 退出安装时的全部副作用；重复调用安全（HMR / 测试复用同一 app 时会发生）。
  function dispose() {
    if (disposed) return
    disposed = true
    win?.removeEventListener?.('error', onWindowError)
    win?.removeEventListener?.('unhandledrejection', onUnhandledRejection)
    unregisterRouter?.()
    unregisterRouter = null
    if (app?.config) app.config.errorHandler = previousErrorHandler
  }

  return { dispose, report }
}
