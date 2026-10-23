import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { formatLicenseTime, licenseEventName } from './presentation.js'

test('event RFC3339 and license Unix timestamps show the same Beijing time', () => {
  const expected = '2026/10/13 12:34:56'
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
