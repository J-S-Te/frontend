import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { formatLicenseTime, licenseEventName } from './presentation.js'
import { formatBusinessDateTime } from '../../../shared/utils/businessTime.js'

const consoleView = readFileSync(new URL('../../views/PlatformConsoleView.vue', import.meta.url), 'utf8')

// 从 PlatformConsoleView.vue 抽出真实 formatAuditTime 实现，避免测试复制一份格式化逻辑。
function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`)
  assert.ok(start >= 0, `PlatformConsoleView.vue 缺少 ${name}`)
  const bodyStart = source.indexOf('{', start)
  let depth = 0
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1
    else if (source[index] === '}') {
      depth -= 1
      if (depth === 0) return source.slice(start, index + 1)
    }
  }
  throw new Error(`${name} 函数体未闭合`)
}

const { formatAuditTime } = vm.runInNewContext(
  `${extractFunction(consoleView, 'formatAuditTime')};({ formatAuditTime })`,
  { formatBusinessDateTime },
)

test('授权页与审计页对同一时刻输出一致（UTC 2025-12-31T16:30Z → 2026-01-01 00:30）', () => {
  const instant = '2025-12-31T16:30:00Z'
  const license = formatLicenseTime(instant)
  const audit = formatAuditTime(instant)
  assert.equal(license, audit)
  assert.equal(license, formatBusinessDateTime(instant, { seconds: true }))
  assert.ok(license.startsWith('2026-01-01 00:30'), license)
  // 两边都不能再按浏览器时区渲染（UTC 下旧实现会显示 2025-12-31 16:30）。
  assert.doesNotMatch(license, /2025-12-31/)
  assert.doesNotMatch(audit, /2025-12-31/)
  // Unix 秒/毫秒与 RFC3339 指的是同一瞬间，展示必须一致。
  const seconds = Date.parse(instant) / 1000
  assert.equal(formatLicenseTime(seconds), audit)
  assert.equal(formatLicenseTime(seconds * 1000), audit)
  assert.equal(formatLicenseTime('2026-01-01T00:30:00+08:00'), audit)
})

test('两个页签都使用 24 小时制，不出现 12 小时制标记', () => {
  const instant = '2026-10-13T05:30:00Z'
  for (const rendered of [formatLicenseTime(instant), formatAuditTime(instant)]) {
    assert.equal(rendered, '2026-10-13 13:30:00')
    assert.doesNotMatch(rendered, /上午|下午|AM|PM/)
  }
})

test('审计时间格式化走共享业务时间入口，不再调用浏览器时区 API', () => {
  const auditBody = extractFunction(consoleView, 'formatAuditTime')
  assert.match(auditBody, /formatBusinessDateTime\(value, \{ seconds: true \}\)/)
  assert.doesNotMatch(auditBody, /toLocaleString|toLocaleDateString|toLocaleTimeString/)
  assert.match(consoleView, /from '@\/modules\/shared\/utils\/businessTime\.js'/)
})

test('event RFC3339 and license Unix timestamps show the same Beijing time', () => {
  const expected = '2026-10-13 12:34:56'
  const seconds = Date.parse('2026-10-13T04:34:56Z') / 1000
  for (const value of ['2026-10-13T04:34:56Z', '2026-10-13T12:34:56+08:00', seconds, String(seconds), seconds * 1000]) {
    assert.equal(formatLicenseTime(value), expected)
  }
})

test('missing, invalid and zero Go event timestamps never render Invalid Date', () => {
  for (const value of [null, undefined, '', 0, '0', NaN, Infinity, -1, true, {}, 'bad', '0001-01-01T00:00:00Z', '2026-10-13 12:00:00', '2026-10-13T12:00:00']) {
    assert.equal(formatLicenseTime(value), '—', String(value))
  }
})

test('known event codes have readable names and unknown codes remain identifiable', () => {
  assert.equal(licenseEventName('RUNTIME_SERVICE_REGISTERED'), '运行时服务已登记')
  assert.equal(licenseEventName('IMPORTED_CURRENT'), '当前许可证已导入')
  assert.equal(licenseEventName('FUTURE_EVENT'), 'FUTURE_EVENT')
  assert.equal(licenseEventName(null), '未知事件')
})

test('timeline is bounded, collapsed by default, and retains existing database pagination', () => {
  const source = readFileSync(new URL('./CommercialLicenseView.vue', import.meta.url), 'utf8')
  assert.match(source, /const eventsExpanded = ref\(false\)/)
  assert.match(source, /events\.value\.items\.slice\(0, 5\)/)
  assert.match(source, /events\.value = await getLicenseEvents\(page\); eventsExpanded\.value = false/)
  assert.match(source, /v-for="event in visibleEvents"/)
  assert.match(source, /aria-controls="license-event-list"/)
  assert.match(source, /:aria-expanded="eventsExpanded"/)
  assert.match(source, /max-height: 340px; overflow-y: auto/)
  assert.match(source, /grid-template-columns: minmax\(0, 1fr\) auto/)
  assert.doesNotMatch(source, /grid-template-columns: 14px 1fr auto/)
  assert.match(source, /license-event-meta[^}]*white-space: nowrap/)
  assert.match(source, /loadEvents\(events\.page \+ 1\)/)
})
