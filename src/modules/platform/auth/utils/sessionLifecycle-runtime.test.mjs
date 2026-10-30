import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

const source = (await readFile(new URL('./sessionLifecycle.js', import.meta.url), 'utf8'))
  .replace(/^import \{[\s\S]*?from '[^']+'\n/gm, '').replaceAll('export function ', 'function ')
const minute = 60_000
const identity = { tenant: { id: 't1' }, user: { id: 'u1' }, account: { id: 'a1' } }

// createHarness 加载真实生命周期源码并提供可控浏览器时钟和网络边界。
// 参数：无。
// 返回值：共享时钟、双窗口创建器和可观察的请求记录。
function createHarness() {
  let now = 0
  let nextTimer = 1
  let lastInteractive = 0
  const timers = new Map()
  const calls = { reads: 0, activity: 0, refresh: 0, logout: 0, cleanup: 0, broadcasts: 0 }
  const channels = new Set()
  const state = { read: null, activity: null, fixedExpiry: Infinity, timeout: 30 * minute }

  // advance 依次触发到指定时间的计时器并排空异步回调。
  // 参数：target 为相对登录时刻的目标毫秒数。
  // 返回值：计时器推进完成的 Promise。
  const advance = async (target) => {
    for (;;) {
      await flush()
      const pending = [...timers].filter(([, timer]) => timer.at <= target)
        .sort((a, b) => a[1].at - b[1].at)[0]
      if (!pending) break
      now = pending[1].at
      timers.delete(pending[0])
      pending[1].callback()
    }
    now = target
    await flush()
  }

  // createTab 在独立全局上下文中运行生产源码。
  // 参数：principal 为本页启动主体，默认使用共享测试账号。
  // 返回值：生命周期对象、退出记录及真实浏览器事件入口。
  const createTab = (principal = identity) => {
    const events = new Map()
    const ended = []
    const errors = []
    const window = {
      setTimeout: (callback, delay) => {
        const id = nextTimer++
        timers.set(id, { at: now + delay, callback })
        return id
      },
      clearTimeout: id => timers.delete(id),
      addEventListener: (type, listener) => {
        if (!events.has(type)) events.set(type, new Set())
        events.get(type).add(listener)
      },
      removeEventListener: (type, listener) => events.get(type)?.delete(listener),
      dispatchEvent: event => events.get(event.type)?.forEach(listener => listener(event)),
    }
    const context = vm.createContext({
      window,
      Date: { now: () => 1_700_000_000_000 + now },
      performance: { now: () => now },
      CustomEvent: class {
        // constructor 构造供窗口分发的浏览器事件。
        // 参数：type 为事件名，options 为原因载荷。
        // 返回值：事件实例。
        constructor(type, options) {
          this.type = type
          this.detail = options.detail
        }
      },
      BroadcastChannel: class {
        // constructor 注册同源广播端点。
        // 参数：无。
        // 返回值：广播端点实例。
        constructor() { channels.add(this) }
        // postMessage 将显式退出载荷交给其他窗口。
        // 参数：data 为广播载荷。
        // 返回值：无。
        postMessage(data) {
          calls.broadcasts++
          channels.forEach(channel => {
            if (channel !== this) channel.onmessage?.({ data })
          })
        }
        // close 解除当前广播端点。
        // 参数：无。
        // 返回值：无。
        close() { channels.delete(this) }
      },
      AuthError: class extends Error {
        // constructor 构造认证失败边界。
        // 参数：status 为认证接口状态码。
        // 返回值：认证错误实例。
        constructor(status) {
          super('auth')
          this.status = status
        }
      },
      getCurrentPrincipal: async () => {
        calls.reads++
        return state.read ? state.read() : {
          ...identity, idle_timeout_seconds: state.timeout / 1000,
          idle_remaining_ms: Math.max(0, Math.min(lastInteractive + state.timeout, state.fixedExpiry) - now),
        }
      },
      logoutCurrentSession: async () => { calls.logout++ },
      recordSessionActivity: async () => {
        calls.activity++
        if (state.activity) return state.activity()
        lastInteractive = now
        return { ...identity, idle_timeout_seconds: state.timeout / 1000 }
      },
      refreshCurrentSession: async () => { calls.refresh++ },
      clearRememberedAccount: () => { calls.cleanup++ },
      clearSessionScopedStorage: () => {},
    })
    vm.runInContext(source, context)
    const lifecycle = context.createSessionLifecycle({
      onSessionEnded: reason => ended.push(reason), onSessionError: error => errors.push(error),
    })
    lifecycle.start({ ...principal, idle_timeout_seconds: 1800 })
    return { lifecycle, ended, errors, activity: () => window.dispatchEvent({ type: 'pointerdown' }), context }
  }
  return { advance, createTab, calls, state, timers }
}

// flush 排空生命周期网络替身对应的 Promise 链。
// 参数：无。
// 返回值：异步任务完成的 Promise。
async function flush() {
  for (let index = 0; index < 12; index++) await Promise.resolve()
}

test('active A at minute 29 keeps idle B alive at 30; both locally end at 59 without global logout', async () => {
  const h = createHarness()
  const a = h.createTab()
  const b = h.createTab()
  await h.advance(29 * minute)
  a.activity()
  await flush()
  await h.advance(30 * minute)
  assert.deepEqual(b.ended, [])
  assert.equal(h.calls.reads, 1)
  assert.equal(h.calls.activity, 1)
  await h.advance(59 * minute)
  assert.deepEqual(a.ended, ['idle-timeout'])
  assert.deepEqual(b.ended, ['idle-timeout'])
  assert.equal(h.calls.logout, 0)
  assert.equal(h.calls.activity, 1)
})

test('idle read subtracts full monotonic RTT and respects absolute expiry', async () => {
  const h = createHarness()
  const tab = h.createTab()
  let resolve
  h.state.read = () => new Promise(done => { resolve = done })
  await h.advance(30 * minute)
  assert.equal(h.calls.reads, 1)
  await h.advance(30 * minute + 2000)
  resolve({ ...identity, idle_timeout_seconds: 1800, idle_remaining_ms: 3000 })
  await flush()
  h.state.read = () => ({ ...identity, idle_timeout_seconds: 1800, idle_remaining_ms: 0 })
  await h.advance(30 * minute + 2999)
  assert.deepEqual(tab.ended, [])
  await h.advance(30 * minute + 3000)
  assert.deepEqual(tab.ended, ['idle-timeout'])
  assert.equal(h.calls.logout, 0)

  const absolute = createHarness()
  const fixed = absolute.createTab()
  absolute.state.fixedExpiry = 31 * minute
  await absolute.advance(29 * minute)
  fixed.activity()
  await flush()
  // 本页真实交互计时到59分钟后读取权威的固定到期，不能续到89分钟。
  await absolute.advance(59 * minute)
  assert.deepEqual(fixed.ended, ['idle-timeout'])
  assert.equal(absolute.calls.logout, 0)
})

for (const [name, read] of [
  ['zero', () => ({ ...identity, idle_remaining_ms: 0 })],
  ['negative', () => ({ ...identity, idle_remaining_ms: -1 })],
  ['NaN', () => ({ ...identity, idle_remaining_ms: NaN })],
  ['Infinity', () => ({ ...identity, idle_remaining_ms: Infinity })],
  ['null', () => ({ ...identity, idle_remaining_ms: null })],
  ['string', () => ({ ...identity, idle_remaining_ms: '1000' })],
  ['above policy', () => ({ ...identity, idle_timeout_seconds: 60, idle_remaining_ms: 60001 })],
  ['malformed', () => null],
  ['changed tenant', () => ({ ...identity, tenant: { id: 't2' }, idle_remaining_ms: 1000 })],
  ['changed user', () => ({ ...identity, user: { id: 'u2' }, idle_remaining_ms: 1000 })],
  ['changed account', () => ({ ...identity, account: { id: 'a2' }, idle_remaining_ms: 1000 })],
  ['401', () => { throw Object.assign(new Error('unauthenticated'), { status: 401 }) }],
  ['5xx', () => { throw Object.assign(new Error('unavailable'), { status: 503 }) }],
  ['network', () => { throw new Error('offline') }],
]) {
  test(`idle probe ${name} ends this page without revoking other tabs`, async () => {
    const h = createHarness()
    const tab = h.createTab()
    h.state.read = read
    await h.advance(30 * minute)
    assert.deepEqual(tab.ended, ['idle-timeout'])
    assert.equal(h.calls.logout, 0)
    assert.equal(h.calls.activity, 0)
    assert.equal(h.calls.refresh, 0)
  })
}

test('missing remaining field explicitly retains legacy logout fallback', async () => {
  const h = createHarness()
  const tab = h.createTab()
  h.state.read = () => ({ ...identity, idle_timeout_seconds: 1800 })
  await h.advance(30 * minute)
  assert.deepEqual(tab.ended, ['idle-timeout'])
  assert.equal(h.calls.reads, 1)
  assert.equal(h.calls.logout, 1)
})

for (const transition of ['activity', 'start', 'stop', 'destroy']) {
  test(`late idle probe cannot override ${transition}`, async () => {
    const h = createHarness()
    const tab = h.createTab()
    let reject
    h.state.read = () => new Promise((_, fail) => { reject = fail })
    await h.advance(30 * minute)
    assert.equal(h.calls.reads, 1)
    if (transition === 'activity') tab.activity()
    else if (transition === 'start') tab.lifecycle.start({ ...identity, account: { id: 'new' } })
    else tab.lifecycle[transition]()
    reject(new Error('old request failed'))
    await flush()
    assert.deepEqual(tab.ended, [])
    assert.equal(h.calls.logout, 0)
  })
}

test('explicit logout still broadcasts to both windows', () => {
  const h = createHarness()
  const a = h.createTab()
  const b = h.createTab()
  a.context.broadcastSessionEnded('manual-logout')
  assert.deepEqual(a.ended, ['manual-logout'])
  assert.deepEqual(b.ended, ['manual-logout'])
})

for (const transition of ['activity', 'start', 'stop', 'destroy']) {
  test(`late successful idle probe cannot override ${transition}`, async () => {
    const h = createHarness()
    const tab = h.createTab()
    let resolve
    h.state.read = () => new Promise(done => { resolve = done })
    await h.advance(30 * minute)
    if (transition === 'activity') tab.activity()
    else if (transition === 'start') tab.lifecycle.start({ ...identity, account: { id: 'new' } })
    else tab.lifecycle[transition]()
    resolve({ ...identity, idle_remaining_ms: 0 })
    await flush()
    assert.deepEqual(tab.ended, [])
    assert.equal(h.calls.logout, 0)
    if (['activity', 'start'].includes(transition)) {
      h.state.read = () => ({ ...identity, idle_remaining_ms: 0 })
      await h.advance(59 * minute)
      assert.deepEqual(tab.ended, [])
      await h.advance(60 * minute)
      assert.deepEqual(tab.ended, ['idle-timeout'])
    }
  })
}

test('an invalidated pending probe cannot replace the single current probe', async () => {
  const h = createHarness()
  const tab = h.createTab()
  const pending = []
  h.state.read = () => new Promise(done => pending.push(done))
  await h.advance(30 * minute)
  tab.activity()
  await flush()
  await h.advance(60 * minute)
  assert.equal(pending.length, 2)
  pending[0]({ ...identity, idle_remaining_ms: 0 })
  await flush()
  assert.deepEqual(tab.ended, [])
  pending[1]({ ...identity, idle_timeout_seconds: 1800, idle_remaining_ms: 1000 })
  await flush()
  h.state.read = () => ({ ...identity, idle_remaining_ms: 0 })
  await h.advance(60 * minute + 1000)
  assert.deepEqual(tab.ended, ['idle-timeout'])
  assert.equal(h.calls.reads, 3)
  assert.equal(h.calls.logout, 0)
})

test('ordinary reads do not restart the server idle window', async () => {
  const h = createHarness()
  const tab = h.createTab()
  h.state.read = () => ({ ...identity, idle_timeout_seconds: 1800, idle_remaining_ms: 1000 })
  await h.advance(30 * minute)
  assert.deepEqual(tab.ended, [])
  h.state.read = () => ({ ...identity, idle_remaining_ms: 0 })
  await h.advance(30 * minute + 1000)
  assert.deepEqual(tab.ended, ['idle-timeout'])
  assert.equal(h.calls.activity, 0)
  assert.equal(h.calls.refresh, 0)
  assert.equal(h.calls.logout, 0)
})

test('local idle cleanup sends no session end event to another live window', async () => {
  const h = createHarness()
  const a = h.createTab()
  await h.advance(minute)
  const b = h.createTab()
  h.state.read = () => ({ ...identity, idle_remaining_ms: 0 })
  await h.advance(30 * minute)
  assert.deepEqual(a.ended, ['idle-timeout'])
  assert.deepEqual(b.ended, [])
  assert.equal(h.calls.cleanup, 1)
  assert.equal(h.calls.logout, 0)
})


test('repeated real events preserve the current activity response and cookie refresh', async () => {
  const h = createHarness()
  const tab = h.createTab()
  let resolve
  h.state.activity = () => new Promise(done => { resolve = done })
  await h.advance(minute)
  tab.activity()
  tab.activity()
  resolve({ ...identity, idle_timeout_seconds: 1800 })
  await flush()
  assert.equal(h.calls.activity, 1)
  assert.equal(h.calls.refresh, 1)
  assert.deepEqual(tab.ended, [])
})

for (const transition of ['start', 'stop', 'destroy']) {
  test(`late activity rejection cannot end session after ${transition}`, async () => {
    const h = createHarness()
    const tab = h.createTab()
    let reject
    h.state.activity = () => new Promise((_, fail) => { reject = fail })
    await h.advance(minute)
    tab.activity()
    if (transition === 'start') tab.lifecycle.start({ ...identity, account: { id: 'new' } })
    else tab.lifecycle[transition]()
    reject(new tab.context.AuthError(401))
    await flush()
    assert.deepEqual(tab.ended, [])
    assert.equal(h.calls.refresh, 0)
    assert.equal(h.calls.logout, 0)
  })
}


test('pending idle read ends only this page at the 10 second deadline', async () => {
  const h = createHarness()
  const tab = h.createTab()
  h.state.read = () => new Promise(() => {})
  await h.advance(30 * minute)
  await h.advance(30 * minute + 9999)
  assert.deepEqual(tab.ended, [])
  await h.advance(30 * minute + 10000)
  assert.deepEqual(tab.ended, ['idle-timeout'])
  await h.advance(24 * 60 * minute)
  assert.equal(h.calls.reads, 1)
  assert.equal(h.calls.logout, 0)
  assert.equal(h.calls.activity, 0)
  assert.equal(h.calls.refresh, 0)
  assert.equal(h.timers.size, 0)
  assert.equal(h.calls.broadcasts, 0)
})

for (const transition of ['activity', 'start', 'stop', 'destroy']) {
  test(`pending probe watchdog is cancelled by ${transition}`, async () => {
    const h = createHarness()
    const tab = h.createTab()
    h.state.read = () => new Promise(() => {})
    await h.advance(30 * minute)
    await h.advance(30 * minute + 5000)
    if (transition === 'activity') tab.activity()
    else if (transition === 'start') tab.lifecycle.start({ ...identity, account: { id: 'new' } })
    else tab.lifecycle[transition]()
    await flush()
    assert.equal(h.timers.size, ['activity', 'start'].includes(transition) ? 1 : 0)
    await h.advance(30 * minute + 10000)
    assert.deepEqual(tab.ended, [])
    assert.equal(h.calls.logout, 0)
  })
}

for (const response of ['success', 'failure']) {
  test(`late ${response} after watchdog cannot affect a restarted page`, async () => {
    const h = createHarness()
    const tab = h.createTab()
    let resolve, reject
    h.state.read = () => new Promise((done, fail) => { resolve = done; reject = fail })
    await h.advance(30 * minute + 10000)
    assert.deepEqual(tab.ended, ['idle-timeout'])
    tab.lifecycle.start({ ...identity, account: { id: 'new' } })
    if (response === 'success') resolve({ ...identity, idle_remaining_ms: 1000 })
    else reject(new Error('late failure'))
    await flush()
    assert.deepEqual(tab.ended, ['idle-timeout'])
    assert.equal(h.timers.size, 1)
    assert.equal(h.calls.logout, 0)
    await h.advance(31 * minute)
    assert.equal(h.calls.reads, 1)
  })
}

test('successful probe removes its watchdog while retaining the next idle check', async () => {
  const h = createHarness()
  const tab = h.createTab()
  h.state.read = () => ({ ...identity, idle_timeout_seconds: 1800, idle_remaining_ms: minute })
  await h.advance(30 * minute)
  assert.equal(h.timers.size, 1)
  await h.advance(30 * minute + 10000)
  assert.deepEqual(tab.ended, [])
  assert.equal(h.calls.reads, 1)
})
