import assert from 'node:assert/strict'
import test from 'node:test'
import { createUnifiedSessionLifecycle } from './unifiedSessionLifecycle.js'

// harness 构造可控单调时钟与页面事件，用真实协调器验证活动来源和异步边界。
// 参数：overrides为各用例注入的状态或活动服务。
// 返回值：协调器、事件入口、定时推进器及实际调用记录。
function harness(overrides = {}) {
  let instant = 0
  let nextTimer = 0
  const timers = new Map()
  const handlers = new Map()
  const doc = { visibilityState: 'visible' }
  const counts = { reads: 0, activities: 0, ended: [], errors: [] }
  const context = { session_id: 'canonical-a', tenant_id: 'tenant', subject_id: 'user',
    policy_version: 1, idle_timeout_seconds: 1800, idle_remaining_ms: 1800000,
    absolute_remaining_ms: 28800000, absolute_expires_at: '2026-11-01T08:00:00Z' }
  const clock = {
    now: () => instant,
    setTimeout(callback, delay) { const id = ++nextTimer; timers.set(id, { at: instant + delay, callback }); return id },
    clearTimeout(id) { timers.delete(id) },
  }
  const win = {
    addEventListener(name, fn, options) { handlers.set(name, { fn, options }) },
    removeEventListener(name, fn) { if (handlers.get(name)?.fn === fn) handlers.delete(name) },
  }
  const lifecycle = createUnifiedSessionLifecycle({
    clock, windowRef: win, documentRef: doc,
    read: async (...args) => { counts.reads += 1; return overrides.read ? overrides.read(...args) : { ...context } },
    activity: async (...args) => { counts.activities += 1; return overrides.activity ? overrides.activity(...args) : { ...context } },
    onEnded: (...args) => counts.ended.push(args),
    onError: (...args) => counts.errors.push(args),
    onIdentityChanged: overrides.onIdentityChanged,
  })
  // settle 等待真实Promise微任务完成，不能用睡眠代替可控时钟断言。
  // 参数：无。
  // 返回值：当前异步队列稳定后的Promise。
  async function settle() { for (let i = 0; i < 20; i += 1) await Promise.resolve() }
  // advance 逐个执行到目标时刻应触发的定时器。
  // 参数：amount为单调时钟推进毫秒数。
  // 返回值：定时器及Promise队列稳定后的Promise。
  async function advance(amount) {
    const deadline = instant + amount
    for (;;) {
      const next = [...timers].filter(([, timer]) => timer.at <= deadline).sort((a, b) => a[1].at - b[1].at)[0]
      if (!next) break
      timers.delete(next[0]); instant = next[1].at; next[1].callback(); await settle()
    }
    instant = deadline; await settle()
  }
  return { lifecycle, doc, counts, handlers, context, advance, settle,
    emit(name, isTrusted = true) { handlers.get(name)?.fn({ type: name, isTrusted }) } }
}

test('only visible human input advances the window; autonomous scroll is not activity', async () => {
  const h = harness()
  await h.lifecycle.setTarget({ key: 'contract' })
  h.emit('pointerdown', false); h.emit('focus'); h.emit('visibilitychange')
  await h.settle(); assert.equal(h.counts.activities, 0)
  h.emit('scroll'); await h.settle(); assert.equal(h.counts.activities, 0)
  h.emit('wheel'); await h.settle(); assert.equal(h.counts.activities, 1)
  assert.equal(h.handlers.get('wheel').options.capture, true)
  h.doc.visibilityState = 'hidden'; h.emit('keydown'); await h.advance(30000)
  assert.equal(h.counts.activities, 1)
  h.doc.visibilityState = 'visible'; h.emit('keydown'); await h.settle()
  assert.equal(h.counts.activities, 2)
  h.lifecycle.destroy()
})

test('polling and focus calibrate shared authority without activity or browser expiry guesses', async () => {
  const h = harness()
  await h.lifecycle.setTarget({ key: 'crm' })
  await h.advance(65000)
  assert.ok(h.counts.reads >= 3); assert.equal(h.counts.activities, 0)
  assert.deepEqual(h.counts.ended, [])
  h.lifecycle.destroy()
})

test('temporary failures and hung activity release the request slot and preserve the session', async () => {
  let hang = true
  const h = harness({ activity: async () => {
    if (hang) return new Promise(() => {})
    return { ...h.context }
  } })
  await h.lifecycle.setTarget({ key: 'project' })
  h.emit('input'); await h.settle(); await h.advance(9000)
  assert.equal(h.counts.activities, 1); assert.deepEqual(h.counts.ended, [])
  hang = false; h.emit('input'); await h.advance(30000)
  assert.ok(h.counts.activities >= 2); assert.deepEqual(h.counts.ended, [])
  h.lifecycle.destroy()
})

test('late responses from a previous route cannot end or overwrite the new session', async () => {
  let rejectOld
  const h = harness({ read: (target) => target.key === 'old'
    ? new Promise((_, reject) => { rejectOld = reject }) : Promise.resolve({ ...h.context, session_id: 'new' }) })
  const first = h.lifecycle.setTarget({ key: 'old' })
  await h.lifecycle.setTarget({ key: 'new' })
  rejectOld(Object.assign(new Error('old expired'), { status: 401 })); await first; await h.settle()
  assert.deepEqual(h.counts.ended, [])
  h.lifecycle.destroy()
})

test('the authoritative absolute boundary ends a continuously active session without extending eight hours', async () => {
  const h = harness()
  h.context.idle_remaining_ms = 1000; h.context.absolute_remaining_ms = 1000
  await h.lifecycle.setTarget({ key: 'settlement' })
  h.emit('pointerdown'); await h.settle()
  h.context.idle_remaining_ms = 0; h.context.absolute_remaining_ms = 0
  await h.advance(1000)
  assert.equal(h.counts.ended.length, 1)
  h.lifecycle.destroy()
})

test('503 does not terminate forms, while a confirmed 401 ends only the current route session', async () => {
  let status = 503
  const h = harness({ read: async () => { throw Object.assign(new Error('session dependency failed'), { status }) } })
  await h.lifecycle.setTarget({ key: 'portal' }); await h.advance(4000)
  assert.deepEqual(h.counts.ended, [])
  status = 401; await h.advance(30000)
  assert.equal(h.counts.ended.length, 1)
  h.lifecycle.destroy()
})
