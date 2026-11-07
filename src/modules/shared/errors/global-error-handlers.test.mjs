import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { isChunkLoadError, describeUnhandledError } from './errorMessages.js'
import { installGlobalErrorHandlers } from './globalErrorHandlers.js'
import { globalToastBus } from './toastBus.js'

// 全局错误兜底：谁都没接住的错误要变成一条用户能看懂的提示，而且只能变成一条。
//
// 这类代码平时不执行，只有线上崩了才跑，所以这里用假 window / 假 router / 可注入时钟
// 把每条通路都走一遍：注册、清洗、去重、节流、chunk 失败、误报过滤、拆除。

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')

// ---------------------------------------------------------------------------
// 控制台探针
// ---------------------------------------------------------------------------
//
// 兜底通道的契约之一是"原始错误必须落到日志通道"（Vue 一旦设置 app.config.errorHandler
// 就不再走自带的 logError，原始堆栈只能由这里负责）。所以 report() 默认会写 console.error。
// 整套用例共用一个探针：既避免把故障日志混进 TAP 输出，也让"到底记了几条、记了什么"
// 可以被断言。

const originalConsole = { error: console.error, warn: console.warn, log: console.log }
let consoleRecords = []
console.error = (...args) => { consoleRecords.push({ level: 'error', args }) }
console.warn = (...args) => { consoleRecords.push({ level: 'warn', args }) }

// 清空并返回只读视图：error()/warn() 取当前累积的调用参数。
function consoleSpy() {
  consoleRecords = []
  return {
    records: () => consoleRecords,
    error: () => consoleRecords.filter((record) => record.level === 'error'),
    warn: () => consoleRecords.filter((record) => record.level === 'warn'),
    clear: () => { consoleRecords = [] },
  }
}

test.after(() => {
  console.error = originalConsole.error
  console.warn = originalConsole.warn
})

// ---------------------------------------------------------------------------
// 假宿主：window 监听表 + router.onError + app.config + 可控时钟
// ---------------------------------------------------------------------------

function createHarness(options = {}) {
  const listeners = new Map()
  let clock = 1_000_000
  const calls = []
  const notify = (payload) => { calls.push(payload) }
  const win = {
    addEventListener(type, handler) {
      if (!listeners.has(type)) listeners.set(type, new Set())
      listeners.get(type).add(handler)
    },
    removeEventListener(type, handler) {
      listeners.get(type)?.delete(handler)
    },
    dispatch(type, event) {
      for (const handler of [...(listeners.get(type) ?? [])]) handler(event)
    },
    listenerCount(type) {
      return listeners.get(type)?.size ?? 0
    },
    location: { href: 'https://portal.test/portal', assign() {} },
    history: { length: 2, back() {} },
  }
  const routerHandlers = []
  const router = {
    onError(handler) {
      routerHandlers.push(handler)
      return () => {
        const index = routerHandlers.indexOf(handler)
        if (index >= 0) routerHandlers.splice(index, 1)
      }
    },
    errorHandlerCount: () => routerHandlers.length,
    fail: (error) => [...routerHandlers].forEach((handler) => handler(error)),
  }
  const app = { config: { errorHandler: undefined } }
  const harness = {
    app,
    router,
    win,
    calls,
    notify,
    advance: (ms) => { clock += ms },
    now: () => clock,
    handler: null,
    install(overrides = {}) {
      harness.handler = installGlobalErrorHandlers(app, router, {
        notify,
        win,
        now: () => clock,
        dedupeMs: 4000,
        windowMs: 10000,
        maxPerWindow: 3,
        ...options.install,
        ...overrides,
      })
      return harness.handler
    },
  }
  if (options.install !== false) harness.install()
  return harness
}

function uncaught(harness, error, info = 'render function') {
  assert.equal(typeof harness.app.config.errorHandler, 'function', 'app.config.errorHandler 必须被注册')
  harness.app.config.errorHandler(error, null, info)
}

// ---------------------------------------------------------------------------
// 注册与文案
// ---------------------------------------------------------------------------

test('安装后接管 app.config.errorHandler、window 两类事件与 router.onError', () => {
  const harness = createHarness()
  assert.equal(typeof harness.app.config.errorHandler, 'function')
  assert.equal(harness.win.listenerCount('error'), 1)
  assert.equal(harness.win.listenerCount('unhandledrejection'), 1)
  assert.equal(harness.router.errorHandlerCount(), 1)
  harness.handler.dispose()
})

test('未捕获的界面错误变成一条中文兜底提示，不把原始异常文本漏给用户', () => {
  const harness = createHarness()
  uncaught(harness, new TypeError("Cannot read properties of undefined (reading 'customer_id')"))
  assert.equal(harness.calls.length, 1)
  const [payload] = harness.calls
  assert.equal(payload.tone, 'error')
  assert.match(payload.message, /[\u3400-\u9fff]/u, '提示必须是中文文案')
  assert.match(payload.message, /重试|刷新/, '要告诉用户下一步做什么')
  assert.doesNotMatch(payload.message, /TypeError|Cannot read|undefined|customer_id|render function/i,
    '异常类型、字段名、内部钩子名都不能出现在用户提示里')
  harness.handler.dispose()
})

test('业务方自己抛出的中文可读消息可以透传', () => {
  const harness = createHarness()
  uncaught(harness, new Error('该合同已提交审批，不能重复提交。'))
  assert.equal(harness.calls.length, 1)
  assert.match(harness.calls[0].message, /该合同已提交审批/)
  harness.handler.dispose()
})

// ---------------------------------------------------------------------------
// 去重与节流
// ---------------------------------------------------------------------------

test('同一个错误从 error 与 unhandledrejection 同时冒出来时只提示一条', () => {
  const harness = createHarness()
  const error = new TypeError('x is not a function')
  harness.win.dispatch('unhandledrejection', { reason: error, preventDefault() {} })
  harness.win.dispatch('error', { message: error.message, error, target: harness.win })
  assert.equal(harness.calls.length, 1, '去重窗口内同一消息只能产生 1 条提示')

  // 时间推进后仍然允许提示，不是永久静音。
  harness.advance(5000)
  harness.win.dispatch('unhandledrejection', { reason: new TypeError('y is not a function'), preventDefault() {} })
  assert.equal(harness.calls.length, 2)
  harness.handler.dispose()
})

test('10 秒内最多 3 条不同提示，多出来的被节流丢弃', () => {
  const harness = createHarness()
  for (let index = 1; index <= 5; index += 1) {
    uncaught(harness, new Error(`第 ${index} 个业务失败`))
    harness.advance(1000)
  }
  assert.equal(harness.calls.length, 3, '刷屏保护：10s 内最多 3 条')
  assert.deepEqual(harness.calls.map((call) => call.message), ['第 1 个业务失败', '第 2 个业务失败', '第 3 个业务失败'])
  harness.handler.dispose()
})

// ---------------------------------------------------------------------------
// 路由与 chunk 加载失败
// ---------------------------------------------------------------------------

test('路由 chunk 加载失败给出“刷新重试”类提示，且重复失败不重复弹', () => {
  const harness = createHarness()
  const failure = new TypeError('Failed to fetch dynamically imported module: https://portal.test/assets/PlatformConsoleView-8f3a.js')
  harness.router.fail(failure)
  assert.equal(harness.calls.length, 1)
  const [payload] = harness.calls
  assert.equal(payload.tone, 'error')
  assert.match(payload.message, /刷新/, 'chunk 失败重试没用，必须让用户刷新页面')
  assert.doesNotMatch(payload.message, /PlatformConsoleView|assets|Failed to fetch/i)

  harness.router.fail(failure)
  assert.equal(harness.calls.length, 1, '同一个 chunk 连续失败只提示一次')
  harness.handler.dispose()
})

test('普通导航错误与 chunk 失败用不同文案，用户知道该重试还是该刷新', () => {
  const harness = createHarness()
  harness.router.fail(new Error('navigation guard rejected'))
  assert.equal(harness.calls.length, 1)
  const [payload] = harness.calls
  assert.match(payload.message, /跳转|页面/, '导航失败要说清是跳转没完成')
  assert.doesNotMatch(payload.message, /资源加载失败/)
  harness.handler.dispose()
})

test('识别各种 chunk 加载失败写法（浏览器与打包器两套措辞）', () => {
  const cases = [
    new TypeError('Failed to fetch dynamically imported module: /assets/a.js'),
    new Error('error loading dynamically imported module'),
    new Error('Importing a module script failed.'),
    new Error('Loading chunk 42 failed.'),
    Object.assign(new Error('boom'), { name: 'ChunkLoadError' }),
  ]
  for (const error of cases) assert.equal(isChunkLoadError(error), true, String(error?.message ?? error))
  assert.equal(isChunkLoadError(new Error('navigation guard rejected')), false)
  assert.equal(isChunkLoadError(undefined), false)
})

test('describeUnhandledError 给出稳定的去重键与来源说明', () => {
  const chunk = describeUnhandledError(new TypeError('Failed to fetch dynamically imported module: /a.js'), 'router')
  const again = describeUnhandledError(new Error('Loading chunk 1 failed.'), 'router')
  assert.equal(chunk.key, again.key, '同一类 chunk 失败的键必须一致，否则去重会漏')
  assert.equal(chunk.key, chunk.message)
  assert.ok(chunk.detail.length > 0)

  const unknown = describeUnhandledError(new TypeError('boom'), 'window-error')
  assert.match(unknown.message, /[\u3400-\u9fff]/u)
  assert.equal(unknown.tone, 'error')
})

// ---------------------------------------------------------------------------
// 误报过滤
// ---------------------------------------------------------------------------

test('资源加载错误与 ResizeObserver 循环提示不被当成页面崩溃', () => {
  const harness = createHarness()
  // 资源错误（<img>/<link> 加载失败）在 window 冒泡，target 是元素而不是 window。
  harness.win.dispatch('error', { message: '', target: { tagName: 'IMG' } })
  harness.win.dispatch('error', { message: 'ResizeObserver loop completed with undelivered notifications.', target: harness.win })
  harness.win.dispatch('unhandledrejection', { reason: undefined, preventDefault() {} })
  assert.equal(harness.calls.length, 0, '这些不是用户能处理的问题，不该弹提示')
  harness.handler.dispose()
})

// ---------------------------------------------------------------------------
// 拆除
// ---------------------------------------------------------------------------

test('dispose 后监听、router 钩子全部拆除，errorHandler 还原为安装前的值', () => {
  const harness = createHarness({ install: false })
  const previous = () => {}
  harness.app.config.errorHandler = previous
  harness.install()
  assert.notEqual(harness.app.config.errorHandler, previous, '安装期必须接管')
  harness.handler.dispose()
  assert.equal(harness.app.config.errorHandler, previous, '拆掉后必须交还给此前的处理函数')
  assert.equal(harness.win.listenerCount('error'), 0)
  assert.equal(harness.win.listenerCount('unhandledrejection'), 0)
  assert.equal(harness.router.errorHandlerCount(), 0)
})

test('没有前置 errorHandler 时，dispose 会清空而不是留下空转函数', () => {
  const harness = createHarness({ install: false })
  harness.install()
  assert.equal(typeof harness.app.config.errorHandler, 'function')
  harness.handler.dispose()
  assert.equal(harness.app.config.errorHandler, undefined)
})

test('重复 dispose 不抛错', () => {
  const harness = createHarness()
  harness.handler.dispose()
  assert.doesNotThrow(() => harness.handler.dispose())
})

// ---------------------------------------------------------------------------
// 默认落地：真正接到全局 toast 总线
// ---------------------------------------------------------------------------

test('不传 notify 时，未捕获错误会进入全局 toast 总线', () => {
  globalToastBus.clear()
  const harness = createHarness({ install: { notify: undefined } })
  harness.app.config.errorHandler(new TypeError('kaboom'), null, 'setup function')
  const messages = globalToastBus.items.value.map((item) => item.message)
  assert.equal(messages.length, 1)
  assert.match(messages[0], /[\u3400-\u9fff]/u)
  harness.handler.dispose()
  globalToastBus.clear()
})

// ---------------------------------------------------------------------------
// 原始错误留痕：控制台 + 可注入上报通道
// ---------------------------------------------------------------------------
//
// Vue 3 一旦设置 app.config.errorHandler，就改用这个函数而不再调用自带的 logError，
// 所以"渲染 / watch 期崩溃的原始堆栈"只能由这里写进日志。下面把四条通路各走一遍，
// 断言原始 error 对象本身（不是清洗后的中文文案）确实被记录。

test('四条通路的原始错误各写一条控制台日志，来源标签可分辨', () => {
  const spy = consoleSpy()
  const harness = createHarness()

  const vueError = new TypeError("Cannot read properties of undefined (reading 'rows')")
  uncaught(harness, vueError)
  const windowError = new TypeError('window boom')
  harness.win.dispatch('error', { message: windowError.message, error: windowError, target: harness.win })
  const rejection = new Error('rejection boom')
  harness.win.dispatch('unhandledrejection', { reason: rejection, preventDefault() {} })
  const routerError = new TypeError('Failed to fetch dynamically imported module: https://portal.test/assets/X-1.js')
  harness.router.fail(routerError)

  const errors = spy.error()
  assert.equal(errors.length, 4, '每个来源各记录一次')
  assert.deepEqual(errors.map((record) => record.args[1].source),
    ['app.errorHandler', 'window.error', 'unhandledrejection', 'router.onError'],
    '来源标签必须能一眼对上注册入口')
  assert.deepEqual(errors.map((record) => record.args[1].error), [vueError, windowError, rejection, routerError],
    '记录里必须是原始 error，不能是清洗后的用户文案')
  assert.equal(errors[0].args[0], '[global-error]', '统一前缀，便于在控制台过滤')
  harness.handler.dispose()
})

test('节流丢弃的提示不静默：用户只有 3 条，日志一条不少', () => {
  const spy = consoleSpy()
  const harness = createHarness()
  for (let index = 1; index <= 5; index += 1) {
    uncaught(harness, new Error(`第 ${index} 个业务失败`))
    harness.advance(1000)
  }
  assert.equal(harness.calls.length, 3, '用户侧仍然只有 3 条提示')
  assert.equal(spy.error().length, 5, '被丢弃的两条原始错误也必须留在日志里')
  const warns = spy.warn()
  assert.equal(warns.length, 2, '丢弃要有明确记录，不能当没发生')
  assert.deepEqual(warns.map((record) => record.args[1].reason), ['throttled', 'throttled'])
  harness.handler.dispose()
})

test('去重窗口内的重复错误只弹一条提示，但两条都留日志', () => {
  const spy = consoleSpy()
  const harness = createHarness()
  const error = new TypeError('x is not a function')
  harness.win.dispatch('unhandledrejection', { reason: error, preventDefault() {} })
  harness.win.dispatch('error', { message: error.message, error, target: harness.win })
  assert.equal(harness.calls.length, 1, '去重仍然生效')
  assert.equal(spy.error().length, 2)
  assert.equal(spy.warn().length, 1)
  assert.equal(spy.warn()[0].args[1].reason, 'duplicate')
  harness.handler.dispose()
})

test('注入的 reportTo 在写日志之后调用，且不受提示节流裁剪', () => {
  const spy = consoleSpy()
  const uploaded = []
  const seenLogCount = []
  const harness = createHarness({
    install: {
      reportTo: (event) => {
        uploaded.push(event)
        // 记录上报时刻已有的日志条数，用来证明"先记录再上报"。
        seenLogCount.push(spy.error().length)
      },
    },
  })
  for (let index = 1; index <= 5; index += 1) {
    uncaught(harness, new Error(`第 ${index} 个业务失败`))
    harness.advance(1000)
  }
  assert.equal(harness.calls.length, 3, '提示仍然受节流保护')
  assert.equal(uploaded.length, 5, '上报通道不能被用户提示的节流裁掉')
  assert.deepEqual(uploaded.map((event) => event.source), Array(5).fill('app.errorHandler'))
  assert.deepEqual(seenLogCount, [1, 2, 3, 4, 5], 'console.error 必须先于 reportTo')
  harness.handler.dispose()
})

test('reportTo 抛错不会打断兜底提示', () => {
  consoleSpy()
  const harness = createHarness({ install: { reportTo: () => { throw new Error('uploader down') } } })
  assert.doesNotThrow(() => uncaught(harness, new Error('业务失败')))
  assert.equal(harness.calls.length, 1, '上报失败不影响用户看到提示')
  harness.handler.dispose()
})

test('dispose 之后不再记录、不再上报，直接调用 report 也静默', () => {
  const spy = consoleSpy()
  const uploaded = []
  const harness = createHarness({ install: { reportTo: (event) => uploaded.push(event) } })
  harness.handler.dispose()
  spy.clear()

  harness.win.dispatch('error', { message: 'late boom', error: new Error('late boom'), target: harness.win })
  harness.win.dispatch('unhandledrejection', { reason: new Error('later'), preventDefault() {} })
  harness.router.fail(new Error('late route'))
  assert.equal(harness.handler.report(new Error('late direct'), 'vue'), false, '卸载后 report 不再接受')
  assert.equal(spy.records().length, 0, '卸载后不能再往控制台写兜底日志')
  assert.equal(uploaded.length, 0, '卸载后不能再上报')
})

// ---------------------------------------------------------------------------
// 装配守卫：注册顺序错了，兜底就不生效
// ---------------------------------------------------------------------------

test('main.js 在 mount 之前安装全局错误处理', () => {
  const source = read('../../../main.js')
  const installAt = source.indexOf('installGlobalErrorHandlers')
  const mountAt = source.indexOf('.mount(')
  assert.ok(installAt >= 0, 'main.js 必须安装全局错误处理')
  assert.ok(mountAt > installAt, '必须先用 use(router) 装好 router、再注册兜底、最后 mount')
  assert.match(source, /\.use\(router\)[\s\S]*installGlobalErrorHandlers/, 'router.onError 依赖 router 已安装')
})

test('App.vue 用错误边界包住 RouterView，并挂载全局提示宿主', () => {
  const source = read('../../platform/app/App.vue')
  assert.match(source, /<ErrorBoundary\b[\s\S]*<RouterView\s*\/>[\s\S]*<\/ErrorBoundary>/, 'RouterView 必须被错误边界包住')
  assert.match(source, /<GlobalErrorToasts\s*\/>/, '全局提示宿主必须挂在 App.vue')
})

test('App.vue 的边界把原始错误写进控制台，不再额外弹提示', () => {
  const source = read('../../platform/app/App.vue')
  // 用 test 而不是 assert.match：失败时不要把整个 App.vue 打进 TAP 输出。
  assert.ok(/<ErrorBoundary\b[^>]*@error="onBoundaryError"/.test(source),
    '边界必须监听 @error，否则原始错误随降级页一起消失')
  const handlerAt = source.indexOf('function onBoundaryError')
  assert.ok(handlerAt >= 0, 'App.vue 必须有 onBoundaryError')
  const body = source.slice(handlerAt, handlerAt + 300)
  assert.match(body, /console\.error\('\[error-boundary\]'/, '边界错误必须留日志')
  assert.match(body, /\berror\b/, '日志要带原始 error')
  assert.match(body, /\binfo\b/, '日志要带 Vue 给出的出错钩子信息')
  assert.doesNotMatch(source, /onBoundaryError[\s\S]{0,200}notifyGlobalError|onBoundaryError[\s\S]{0,200}showToast/,
    '边界已经渲染降级页，不允许再弹一条全局提示造成双重提示')
})
