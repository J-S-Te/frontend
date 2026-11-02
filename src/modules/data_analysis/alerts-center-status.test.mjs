// 预警中心状态列（DATA-07）：自动关闭原因、人工关闭、复开次数与 ACK 确认信息。
// 后端 ClosedReason/ReopenCount/AcknowledgedAt/AcknowledgedBy 可能尚未上线，
// 因此这里既验证真实视图函数的防御性行为，也锁定模板只在有值时渲染。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const source = readFileSync(new URL('./views/AlertsCenterView.vue', import.meta.url), 'utf8')

// 用途：截取视图中的纯展示函数块（不依赖 Vue 运行时）用于隔离执行。
// 返回值：alertStatusNotes 及其依赖函数。
function displayFunctions() {
  const start = source.indexOf('const CLOSED_REASON_LABELS = {')
  const notesStart = source.indexOf('function alertStatusNotes(')
  assert.ok(start >= 0 && notesStart > start, '视图必须保留关闭原因与状态说明函数')
  const end = source.indexOf('\n}', notesStart) + 2
  const block = source.slice(start, end)
  return vm.runInNewContext(`${block}\n;({ alertStatusNotes, closedReasonText, reopenCountText })`, {})
}

const { alertStatusNotes, closedReasonText, reopenCountText } = displayFunctions()
// vm 里的数组来自另一个 realm，deepStrictEqual 会比较原型，统一转成本 realm 数组。
const notesOf = (item) => [...alertStatusNotes(item)]

test('关闭原因：自动收敛与人工关闭区分展示', () => {
  assert.match(closedReasonText({ status: 'CLOSED', closed_reason: 'AUTO_CONDITION_CLEARED' }), /条件消失/)
  assert.match(closedReasonText({ status: 'CLOSED', closed_reason: 'AUTO_WINDOW_EXIT' }), /离开窗口/)
  assert.equal(closedReasonText({ status: 'CLOSED', closed_reason: 'MANUAL' }), '人工关闭')
  // 大小写与前后空格不应影响识别。
  assert.equal(closedReasonText({ closed_reason: ' manual ' }), '人工关闭')
})

test('未知 closed_reason 保留原文，绝不显示“未知错误”', () => {
  const text = closedReasonText({ status: 'CLOSED', closed_reason: 'LEGACY_PURGE' })
  assert.ok(text.includes('LEGACY_PURGE'), '未知关闭原因必须保留后端原文')
  assert.doesNotMatch(text, /未知错误/)
  assert.doesNotMatch(source, /未知错误/)
})

test('缺失的关闭原因与复开字段不产生空标签', () => {
  assert.equal(closedReasonText({ status: 'CLOSED' }), '')
  assert.equal(closedReasonText({ status: 'CLOSED', closed_reason: '   ' }), '')
  assert.equal(reopenCountText({}), '')
  assert.equal(reopenCountText({ reopen_count: 0 }), '')
  assert.equal(reopenCountText({ reopen_count: null }), '')
  assert.deepEqual(notesOf({ status: 'CLOSED' }), [])
  assert.deepEqual(notesOf({ status: 'OPEN' }), [])
  assert.deepEqual(notesOf(undefined), [])
})

test('复开次数按次展示，兼容 snake_case 与 PascalCase', () => {
  assert.equal(reopenCountText({ reopen_count: 3 }), '已复开 3 次')
  assert.equal(reopenCountText({ ReopenCount: '2' }), '已复开 2 次')
  assert.ok(notesOf({ status: 'OPEN', reopen_count: 1 }).includes('已复开 1 次'))
})

test('ACK 显示确认人与确认时间；任一字段缺失只显示存在的那个', () => {
  assert.deepEqual(
    notesOf({ status: 'ACK', acknowledged_by: '张三', acknowledged_at: '2026-10-08 09:30' }),
    ['确认人：张三', '确认时间：2026-10-08 09:30'],
  )
  assert.deepEqual(notesOf({ status: 'ACK', AcknowledgedBy: '李四' }), ['确认人：李四'])
  assert.deepEqual(notesOf({ status: 'ACK', acknowledged_at: '2026-10-08 09:30' }), ['确认时间：2026-10-08 09:30'])
  // 未受理（OPEN）的记录即便带上字段也不在状态列展示确认信息。
  assert.deepEqual(notesOf({ status: 'OPEN', acknowledged_by: '张三' }), [])
})

test('自动关闭记录同时展示关闭原因与复开次数', () => {
  assert.deepEqual(
    notesOf({ status: 'CLOSED', closed_reason: 'AUTO_WINDOW_EXIT', reopen_count: 2 }),
    ['自动关闭：离开窗口（历史）', '已复开 2 次'],
  )
  assert.deepEqual(
    notesOf({ status: 'CLOSED', closed_reason: 'MANUAL', acknowledged_by: '王五' }),
    ['确认人：王五', '人工关闭'],
  )
})

test('模板只在有说明时渲染状态补充行，加载时预先算好说明', () => {
  assert.match(source, /statusNotes: alertStatusNotes\(item\)/)
  assert.match(source, /v-if="item\.statusNotes\?\.length"/)
  assert.match(source, /item\.statusNotes\.join\(' · '\)/)
  // 沿用既有 da-alert-meta 排版，不引入新样式依赖。
  assert.match(source, /class="da-alert-meta da-alert-status"/)
})
