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
//
// 日志与提示是两条独立承诺：
//   - 每条原始错误都必须先写进控制台（并可注入 reportTo 上报），一条都不能因为节流消失；
//   - 提示条数受去重 / 节流限制，被丢弃的那条会补一条 console.warn 说明原因。
// Vue 3 一旦设置 app.config.errorHandler 就不再调用自带的 logError，所以渲染 / watch
// 期的原始堆栈只能靠这里留下，这条顺序不能反过来。
import { createToastQueue } from './toastQueue.js'
import { describeUnhandledError } from './errorMessages.js'
import { notifyGlobalError } from './toastBus.js'

// 这些不是用户能处理、也不代表页面坏了的信号，直接忽略：
// ResizeObserver 的循环提示是浏览器噪音；资源加载失败（<img>/<link>）由 target 判断。
const BENIGN_MESSAGE = /ResizeObserver loop (?:completed with undelivered notifications|limit exceeded)/i

// 日志里用"注册入口名"而不是内部来源名：在控制台看到 app.errorHandler 就知道去哪儿改。
// 内部来源名（vue / window-error / router）继续给 describeUnhandledError 做文案分流。
// 边界（ErrorBoundary）的日志由 App.vue 的 onBoundaryError 负责，不走这条通路。
const CONSOLE_TAG = {
  vue: 'app.errorHandler',
  'window-error': 'window.error',
  unhandledrejection: 'unhandledrejection',
  router: 'router.onError',
}

/**
 * 安装全局错误兜底。
 *
 * @param {object} app Vue 应用实例（会改写 app.config.errorHandler）
 * @param {object} router vue-router 实例（会挂 onError）
 * @param {object} options
 * @param {Function} [options.notify] 提示落地函数，默认进全球提示总线
 * @param {Function} [options.reportTo] 上报通道（日志已先落地），默认 noop
 * @param {number} [options.dedupeMs] 同一文案的去重窗口
 * @param {number} [options.windowMs] 节流窗口
 * @param {number} [options.maxPerWindow] 节流窗口内的最大条数
 * @param {object} [options.win] window 替身（测试用）
 * @param {Function} [options.now] 时钟（测试用）
 * @returns {{dispose: Function, report: Function}}
 */
export function installGlobalErrorHandlers(app, router, options = {}) {
  const deliver = typeof options.notify === 'function' ? options.notify : notifyGlobalError
  const reportTo = typeof options.reportTo === 'function' ? options.reportTo : () => {}
  const gate = createToastQueue({
    dedupeMs: options.dedupeMs,
    windowMs: options.windowMs,
    maxPerWindow: options.maxPerWindow,
  })
  const now = typeof options.now === 'function' ? options.now : () => Date.now()
  const win = options.win ?? (typeof window === 'undefined' ? null : window)
  const previousErrorHandler = app?.config?.errorHandler
  let disposed = false

  /**
   * 记录 + 上报 + 翻译 + 过闸 + 落地。
   * @returns {boolean} 是否真的产生了提示
   */
  function report(error, source) {
    // 卸载后（HMR 重装、测试复用同一 app）不再记录：日志通道的归属在 dispose 时已经交还。
    if (disposed) return false
    const tag = CONSOLE_TAG[source] ?? source
    // 先记录原始错误，再进闸门。Vue 3 一旦设置 app.config.errorHandler 就不再调用
    // 自带的 logError，渲染 / watch 期的原始堆栈只有这里能留下；而闸门管的是
    // "用户看到几条提示"，不该连带把日志一起吞掉。
    console.error('[global-error]', { source: tag, error })
    try {
      // 上报通道同样不受提示节流裁剪：丢提示是体验决策，不是"这件事没发生"。
      reportTo({ source: tag, error })
    } catch (reportError) {
      // 上报通道自己坏了不能反过来打断兜底提示。
      console.error('[global-error] 上报通道抛错', reportError)
    }
    const payload = describeUnhandledError(error, source)
    const verdict = gate.push(payload, now())
    if (!verdict.accepted) {
      // 去重 / 节流丢弃也要留痕，否则线上只剩"用户没看到提示"这一条线索。
      console.warn('[global-error] 提示未展示', { source: tag, reason: verdict.reason, error })
      return false
    }
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
