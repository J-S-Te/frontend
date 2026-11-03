import assert from 'node:assert/strict'
import test from 'node:test'
import { createSubsystemSessionLifecycle } from './subsystemSessionLifecycle.js'

const MINUTE = 60 * 1000

// fakeEnvironment 提供可推进的定时器与可触发的事件目标，避免测试依赖真实时钟。
function fakeEnvironment() {
  let current = 0
  let sequence = 0
  const timers = new Map()
  const listeners = new Map()
  return {
    now: () => current,
    calls: [],
    listeners,
    window: {
      setTimeout(callback, delay) {
        const id = ++sequence
        timers.set(id, { callback, at: current + Math.max(0, Number(delay) || 0) })
        return id
      },
      clearTimeout(id) { timers.delete(id) },
      addEventListener(type, callback) {
        if (!listeners.has(type)) listeners.set(type, new Set())
        listeners.get(type).add(callback)
      },
      removeEventListener(type, callback) { listeners.get(type)?.delete(callback) },
    },
    advance(ms) {
      const target = current + Math.max(0, ms)
      let guard = 0
      while (guard < 500) {
        guard += 1
        const next = [...timers.entries()]
          .filter(([, timer]) => timer.at <= target)
          .sort((left, right) => left[1].at - right[1].at)[0]
        if (!next) break
        timers.delete(next[0])
        current = next[1].at
        next[1].callback()
      }
      current = target
    },
    pendingTimers: () => timers.size,
    emit(type) { [...(listeners.get(type) || [])].forEach((callback) => callback({ type })) },
    listenerCount: (type) => (listeners.get(type) || new Set()).size,
  }
}

async function flush() { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() }

// harness 组装可注入的活动/探测桩与控制器。
function harness({ touch, probe } = {}) {
  const env = fakeEnvironment()
  const ended = []
  const errors = []
  const touches = []
  const probes = []
  const lifecycle = createSubsystemSessionLifecycle({
    environment: env.window,
    now: env.now,
    touch: async () => { touches.push('touch'); return touch ? touch() : {} },
    probe: async () => { probes.push('probe'); return probe ? probe() : { idle_timeout_seconds: 1800, idle_remaining_ms: 1800 * 1000 } },
    onIdle: (reason) => ended.push(reason),
    onError: (error) => errors.push(error),
  })
  return { env, lifecycle, ended, errors, touches, probes }
}

test('start 按服务端剩余窗口安排首次只读探测', async () => {
  const h = harness()
  h.lifecycle.start({ idleTimeoutSeconds: 1800, idleRemainingMs: 10 * 1000 })
  assert.equal(h.env.listenerCount('pointerdown'), 1)
  assert.equal(h.env.listenerCount('keydown'), 1)
  h.env.advance(10 * 1000 - 1)
  await flush()
  assert.equal(h.probes.length, 0)
  h.env.advance(1)
  await flush()
  assert.equal(h.probes.length, 1)
  assert.deepEqual(h.ended, [])
})

test('真实鼠标/键盘活动立即上报并重排窗口，节流期内不重复上报', async () => {
  const h = harness()
  h.lifecycle.start({ idleTimeoutSeconds: 1800, idleRemainingMs: 10 * 1000 })
  h.env.emit('keydown')
  await flush()
  assert.equal(h.touches.length, 1)
  h.env.emit('pointerdown')
  await flush()
  assert.equal(h.touches.length, 1, '节流窗口内不重复上报')
  h.env.advance(60 * 1000)
  h.env.emit('pointerdown')
  await flush()
  assert.equal(h.touches.length, 2)
  assert.deepEqual(h.ended, [])
})

test('活动把本地探测推迟到新的空闲窗口', async () => {
  const h = harness({ touch: async () => ({ idle_timeout_seconds: 120, idle_remaining_ms: 120 * 1000 }) })
  h.lifecycle.start({ idleTimeoutSeconds: 120, idleRemainingMs: 30 * 1000 })
  h.env.advance(20 * 1000)
  h.env.emit('keydown')
  await flush()
  h.env.advance(119 * 1000)
  await flush()
  assert.equal(h.probes.length, 0)
  h.env.advance(1000)
  await flush()
  assert.equal(h.probes.length, 1)
})

test('服务端返回仍有剩余窗口时重新排期而不是退出', async () => {
  let call = 0
  const h = harness({ probe: async () => { call += 1; return { idle_timeout_seconds: 120, idle_remaining_ms: 60 * 1000 } } })
  h.lifecycle.start({ idleTimeoutSeconds: 120, idleRemainingMs: 5 * 1000 })
  h.env.advance(5 * 1000)
  await flush()
  assert.equal(call, 1)
  assert.deepEqual(h.ended, [])
  h.env.advance(60 * 1000)
  await flush()
  assert.equal(call, 2)
})

test('探测确认剩余为空或 401 时只结束本页一次并移除监听', async () => {
  for (const probe of [
    async () => ({ idle_timeout_seconds: 120, idle_remaining_ms: 0 }),
    async () => { const error = new Error('expired'); error.status = 401; throw error },
  ]) {
    const h = harness({ probe })
    h.lifecycle.start({ idleTimeoutSeconds: 120, idleRemainingMs: 1000 })
    h.env.advance(1000)
    await flush()
    assert.deepEqual(h.ended, ['idle-timeout'])
    assert.equal(h.env.listenerCount('pointerdown'), 0)
    h.env.emit('keydown')
    await flush()
    assert.deepEqual(h.ended, ['idle-timeout'])
  }
})

test('活动上报返回 401 说明会话已被撤销，立即结束本页', async () => {
  const h = harness({ touch: async () => { const error = new Error('revoked'); error.status = 401; throw error } })
  h.lifecycle.start({ idleTimeoutSeconds: 120, idleRemainingMs: 60 * 1000 })
  h.env.emit('keydown')
  await flush()
  assert.deepEqual(h.ended, ['server-revoked'])
})

test('探测连续失败最多重试三次后结束本页，网络抖动不立刻登出', async () => {
  let calls = 0
  const h = harness({ probe: async () => { calls += 1; throw new Error('network down') } })
  h.lifecycle.start({ idleTimeoutSeconds: 120, idleRemainingMs: 1000 })
  h.env.advance(1000)
  await flush()
  assert.equal(calls, 1)
  assert.equal(h.ended.length, 0)
  h.env.advance(15 * 1000)
  await flush()
  assert.equal(calls, 2)
  h.env.advance(15 * 1000)
  await flush()
  assert.equal(calls, 3)
  assert.deepEqual(h.ended, ['probe-failed'])
})

test('探测超时按失败重试，避免请求悬挂导致永不退出', async () => {
  let calls = 0
  const h = harness({ probe: () => { calls += 1; return new Promise(() => {}) } })
  h.lifecycle.start({ idleTimeoutSeconds: 120, idleRemainingMs: 1000 })
  h.env.advance(1000)
  await flush()
  assert.equal(calls, 1)
  h.env.advance(10 * 1000)
  await flush()
  assert.equal(h.ended.length, 0)
  assert.equal(h.lifecycle.getState().probeFailures, 1)
})

test('探测在途时发生真实活动会作废旧探测结果', async () => {
  let resolveProbe
  const pending = new Promise((resolve) => { resolveProbe = resolve })
  const h = harness({ probe: () => pending })
  h.lifecycle.start({ idleTimeoutSeconds: 120, idleRemainingMs: 1000 })
  h.env.advance(1000)
  await flush()
  h.env.emit('keydown')
  await flush()
  resolveProbe({ idle_timeout_seconds: 120, idle_remaining_ms: 0 })
  await flush()
  assert.deepEqual(h.ended, [])
})

test('stop 取消计时与监听且不再触发空闲回调', async () => {
  const h = harness()
  h.lifecycle.start({ idleTimeoutSeconds: 120, idleRemainingMs: 1000 })
  h.lifecycle.stop()
  assert.equal(h.env.listenerCount('keydown'), 0)
  assert.equal(h.env.pendingTimers(), 0)
  h.env.advance(10 * MINUTE)
  await flush()
  assert.deepEqual(h.ended, [])
  assert.equal(h.probes.length, 0)
})

test('旧后端缺少空闲字段时按较短周期只读探测而不立即退出', async () => {
  const h = harness({ probe: async () => ({ user_id: 'u1', tenant_id: 't1' }) })
  h.lifecycle.start({ idleTimeoutSeconds: 1800, idleRemainingMs: 5 * 1000 })
  h.env.advance(5 * 1000)
  await flush()
  assert.equal(h.probes.length, 1)
  assert.deepEqual(h.ended, [])
  h.env.advance(60 * 1000)
  await flush()
  assert.equal(h.probes.length, 2)
})
