import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { ref } from 'vue'
import { formatBusinessDate, todayBusinessDate } from '../../shared/utils/businessTime.js'

// 业务日一律按北京时间：后端返回 RFC3339（UTC），前端不能直接 slice 取 UTC 日历日。
// 这里直接从真实 SFC 抽取设备可用性过滤函数执行，验证“今天/日历日”的来源而不是复述实现。
const viewSource = readFileSync(new URL('./ProjectManagementView.vue', import.meta.url), 'utf8')

function functionBody(name) {
  const start = viewSource.search(new RegExp(`function ${name}\\(`))
  assert.ok(start >= 0, `missing ${name}`)
  return viewSource.slice(start, viewSource.indexOf('\n}', start) + 2)
}

function equipmentAvailability({ today, item, plannedStart = '', plannedEnd = '' }) {
  const body = functionBody('isEquipmentValidForPreparation')
  const selectedServiceItem = ref({ id: 'SI-1', planned_start: plannedStart, planned_end: plannedEnd })
  return new Function('selectedServiceItem', 'formatBusinessDate', 'todayBusinessDate', `${body}\nreturn isEquipmentValidForPreparation`)(
    selectedServiceItem,
    formatBusinessDate,
    () => today,
  )(item)
}

// 北京 2026-10-22 00:00 整点：UTC 仍是 10-21，任何“取 UTC 日历日”的写法都会早一天。
const BEIJING_MIDNIGHT_UTC_DAY_BEFORE = '2026-10-21T16:00:00Z'

test('北京凌晨窗口下 formatBusinessDate 取北京日历日而不是 UTC 日历日', () => {
  assert.equal(formatBusinessDate(BEIJING_MIDNIGHT_UTC_DAY_BEFORE), '2026-10-22')
  assert.equal(formatBusinessDate('2026-10-21T15:59:59Z'), '2026-10-21')
  assert.equal(formatBusinessDate('2026-10-21T17:30:00Z'), '2026-10-22')
  // 纯日期字段不平移：共享模块按日历日原样返回。
  assert.equal(formatBusinessDate('2026-10-22'), '2026-10-22')
  assert.equal(formatBusinessDate(''), '')
})

test('设备可用性过滤用北京日：UTC 前一天的检定到期日不再被提前判定为过期', () => {
  // valid_until 恰为北京 10-22 零点；计划窗口在北京 10-22 当天。
  const item = { status: 'ACTIVE', valid_from: '2026-10-01T00:00:00Z', valid_until: BEIJING_MIDNIGHT_UTC_DAY_BEFORE }
  assert.equal(equipmentAvailability({
    today: '2026-10-22',
    item,
    plannedStart: '2026-10-22T00:30:00Z',
    plannedEnd: '2026-10-22T10:00:00Z',
  }), true)
  // 北京 10-21 23:59 到期则真的覆盖不到 10-22 的计划窗口。
  assert.equal(equipmentAvailability({
    today: '2026-10-21',
    item: { ...item, valid_until: '2026-10-21T15:59:00Z' },
    plannedStart: '2026-10-22T00:30:00Z',
    plannedEnd: '2026-10-22T10:00:00Z',
  }), false)
})

test('设备可用性过滤的“今天”取北京日：计划窗口缺失时按北京今天而非 UTC 今天兜底', () => {
  // 检定自北京 10-22 起生效；若用 UTC 日历日（10-21）兜底会把该设备误判为“未生效”。
  const item = { status: 'ACTIVE', valid_from: '2026-10-22', valid_until: '2026-12-31' }
  assert.equal(equipmentAvailability({ today: '2026-10-22', item }), true)
  assert.equal(equipmentAvailability({ today: '2026-10-21', item }), false)
})

test('项目管理视图不再用 UTC 日历日或本地时间格式化业务时间字段', () => {
  const body = functionBody('isEquipmentValidForPreparation')
  assert.match(body, /todayBusinessDate\(\)/, '“今天”必须来自北京口径工具')
  assert.doesNotMatch(body, /toISOString\(\)\.slice/)
  assert.doesNotMatch(viewSource, /\.slice\(0, 16\)/)
  assert.doesNotMatch(viewSource, /toISOString\(\)\.slice\(0, 10\)/)
  assert.doesNotMatch(viewSource, /toLocaleString/)
  assert.doesNotMatch(viewSource, /planned_(?:start|end)\??\.slice\(0, 10\)/)
})

test('同模块的组件与导出文件名同样不走浏览器本地时间/UTC 日历日', () => {
  const files = [
    '../components/ProjectNotificationCenter.vue',
    '../components/PenetrationWorkPackageCard.vue',
    '../api/projectManagement.js',
  ]
  for (const file of files) {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8')
    assert.doesNotMatch(source, /\.toLocaleString\(/, `${file} 不得使用浏览器本地时间展示`)
    assert.doesNotMatch(source, /toISOString\(\)\.slice\(0, 10\)/, `${file} 不得用 UTC 日历日做业务日期`)
  }
  const apiSource = readFileSync(new URL('../api/projectManagement.js', import.meta.url), 'utf8')
  assert.match(apiSource, /capabilities-\$\{todayBusinessDate\(\)\}\.csv/)
  // 展示层 formatDateTime 必须委托共享北京口径工具，非法入参保留原文而不是崩溃。
  const displaySource = readFileSync(new URL('../projectDisplay.js', import.meta.url), 'utf8')
  const formatDateTimeBody = displaySource.slice(displaySource.indexOf('export function formatDateTime('))
  assert.match(formatDateTimeBody.slice(0, 200), /formatBusinessDateTime\(value\)/)
})
