import test from 'node:test'
import assert from 'node:assert/strict'
import { createToastQueue, normalizeToastLimits, DEFAULT_TOAST_LIMITS } from './toastQueue.js'

// 全局兜底提示的队列策略（纯函数层）。
//
// 为什么这一层必须单独测：unhandledrejection / window 'error' / 路由 chunk 失败
// 在真实浏览器里是成串出现的（一次断网能连发十几条）。如果去重、节流、可见条数
// 和自动消失没有独立可测的策略层，就只能靠“打开页面看看”来验证，而这类问题
// 恰恰只在故障态才出现。

test('默认限额：4s 去重、10s 内最多 3 条、最多同时 3 条、6s 自动消失', () => {
  assert.deepEqual({ ...DEFAULT_TOAST_LIMITS }, {
    dedupeMs: 4000,
    windowMs: 10000,
    maxPerWindow: 3,
    maxVisible: 3,
    ttlMs: 6000,
  })
})

test('非法配置回落到默认值，不能被 0 / 负数 / NaN 关掉闸门', () => {
  const limits = normalizeToastLimits({
    dedupeMs: -1,
    windowMs: Number.NaN,
    maxPerWindow: 0,
    maxVisible: -3,
    ttlMs: '6000',
  })
  assert.deepEqual(limits, { ...DEFAULT_TOAST_LIMITS })
})

test('同一消息在去重窗口内只入列一次，窗口滑过后可再次提示', () => {
  const queue = createToastQueue()
  const t0 = 1_000_000
  const first = queue.push({ message: '页面遇到错误，操作未完成。' }, t0)
  assert.equal(first.accepted, true)
  assert.equal(first.reason, 'accepted')
  assert.equal(first.items.length, 1)

  const duplicate = queue.push({ message: '页面遇到错误，操作未完成。' }, t0 + 1200)
  assert.equal(duplicate.accepted, false, '同一文案在 4s 内必须被去重')
  assert.equal(duplicate.reason, 'duplicate')
  assert.equal(duplicate.items.length, 1, '被去重时可见列表不能变长')

  // 不同来源但同一文案（例如 error 事件与 unhandledrejection 同时报同一个错）走同一张去重表。
  const sameTextOtherKey = queue.push({ message: '页面遇到错误，操作未完成。', key: 'other-source' }, t0 + 2000)
  assert.equal(sameTextOtherKey.accepted, false, '去重键默认取文案，不同来源的同文案也只提示一次')

  const later = queue.push({ message: '页面遇到错误，操作未完成。' }, t0 + 4001)
  assert.equal(later.accepted, true, '超出去重窗口后允许重新提示')
})

test('10s 窗口内最多 3 条，超出部分被节流且窗口滑过后恢复', () => {
  const queue = createToastQueue()
  const t0 = 0
  for (let index = 1; index <= 3; index += 1) {
    const result = queue.push({ message: `第 ${index} 个失败` }, t0 + index)
    assert.equal(result.accepted, true, `第 ${index} 条应当入列`)
  }
  const throttled = queue.push({ message: '第 4 个失败' }, t0 + 5000)
  assert.equal(throttled.accepted, false)
  assert.equal(throttled.reason, 'throttled')
  assert.equal(throttled.items.length, 3)

  const recovered = queue.push({ message: '第 5 个失败' }, t0 + 10001)
  assert.equal(recovered.accepted, true, '窗口滑过之后必须恢复，不能永久闭锁')
})

test('同时可见条数封顶，超出时丢弃最旧的一条并如实报告', () => {
  const queue = createToastQueue({ maxVisible: 2, maxPerWindow: 10 })
  queue.push({ message: '失败一' }, 0)
  queue.push({ message: '失败二' }, 1)
  const third = queue.push({ message: '失败三' }, 2)
  assert.equal(third.accepted, true)
  assert.equal(third.items.length, 2)
  assert.deepEqual(third.items.map((item) => item.message), ['失败二', '失败三'])
  assert.deepEqual(third.dropped.map((item) => item.message), ['失败一'])
})

test('到点自动消失：sweep 清掉过期提示，未到期的保留', () => {
  const queue = createToastQueue({ ttlMs: 6000 })
  const t0 = 500
  const { item } = queue.push({ message: '失败一' }, t0)
  assert.equal(item.expiresAt, t0 + 6000)
  assert.equal(queue.sweep(t0 + 5999).length, 1)
  assert.equal(queue.sweep(t0 + 6000).length, 0, '到期即消失，不依赖用户手动关闭')
})

test('可以手动关闭单条，也可以整表清空', () => {
  const queue = createToastQueue({ maxPerWindow: 10 })
  const first = queue.push({ message: '失败一' }, 0).item
  queue.push({ message: '失败二' }, 1)
  assert.deepEqual(queue.dismiss(first.id).map((item) => item.message), ['失败二'])
  assert.equal(queue.list().length, 1)
  queue.clear()
  assert.equal(queue.list().length, 0)
})

test('空文案不产生提示（调用方拼错字段时不能弹出空条）', () => {
  const queue = createToastQueue()
  const result = queue.push({ message: '   ' }, 0)
  assert.equal(result.accepted, false)
  assert.equal(result.reason, 'empty')
  assert.equal(result.items.length, 0)
})

test('每条提示都有稳定自增 id 与 tone，便于列表渲染和同文案区分', () => {
  const queue = createToastQueue({ maxPerWindow: 10 })
  const first = queue.push({ message: '失败一' }, 0).item
  const second = queue.push({ message: '失败二' }, 1).item
  assert.ok(second.id > first.id)
  assert.equal(first.tone, 'error', '兜底提示默认是错误态')
  assert.equal(queue.push({ message: '提醒', tone: 'warning' }, 2).item.tone, 'warning')
})
