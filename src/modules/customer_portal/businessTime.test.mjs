import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { formatBusinessDate, formatBusinessDateTime } from '../shared/utils/businessTime.js'

// 客户门户展示时间统一按北京口径：时间戳用 formatBusinessDateTime（24 小时制），
// 纯日期用 formatBusinessDate（日历日，不平移）。历史实现走 Intl（不带 timeZone）+ 浏览器本地时区。
const viewSource = await readFile(new URL('./views/CustomerPortalView.vue', import.meta.url), 'utf8')
const wizardSource = await readFile(new URL('./components/FilingWizard.vue', import.meta.url), 'utf8')

// 直接抽取视图里的真实函数体执行，避免测试自写一份等价逻辑。
function viewFunction(name) {
  const start = viewSource.indexOf(`function ${name}(value)`)
  assert.ok(start >= 0, `missing ${name}`)
  const end = viewSource.indexOf('\n', start)
  return viewSource.slice(start, end)
}

const formatDate = new Function('formatBusinessDateTime', `${viewFunction('formatDate')}\nreturn formatDate`)(formatBusinessDateTime)
const formatDay = new Function('formatBusinessDate', `${viewFunction('formatDay')}\nreturn formatDay`)(formatBusinessDate)

test('门户时间戳按北京墙钟展示，纯日期按北京日历日展示', () => {
  // 2026-10-25T16:30:00Z = 北京 2026-10-26 00:30：不能显示成 UTC 的 10-25。
  assert.equal(formatDate('2026-10-25T16:30:00Z'), '2026-10-26 00:30')
  assert.equal(formatDay('2026-10-25T16:30:00Z'), '2026-10-26')
  // 纯日期是日历日：原样展示，不平移、不补 00:00。
  assert.equal(formatDay('2026-10-25'), '2026-10-25')
  assert.equal(formatDay('2026-01-01'), '2026-01-01')
  // 空值与非法值沿用原有占位语义。
  assert.equal(formatDate(''), '—')
  assert.equal(formatDay(''), '—')
  assert.equal(formatDate(null), '—')
  assert.equal(formatDate('not-a-date'), 'not-a-date')
  assert.equal(formatDay('not-a-date'), 'not-a-date')
})

test('门户视图与备案向导不再使用浏览器本地时区格式化时间', () => {
  assert.match(viewSource, /import \{ formatBusinessDate, formatBusinessDateTime \} from '@\/modules\/shared\/utils\/businessTime\.js'/)
  assert.doesNotMatch(viewSource, /new Intl\.DateTimeFormat\('zh-CN', \{ dateStyle: 'medium', timeStyle: 'short' \}\)/)
  assert.doesNotMatch(viewSource, /new Intl\.DateTimeFormat\('zh-CN', \{ dateStyle: 'medium' \}\)/)
  assert.match(wizardSource, /import \{ formatBusinessDateTime \} from '@\/modules\/shared\/utils\/businessTime\.js'/)
  assert.match(wizardSource, /更新于 \{\{ formatBusinessDateTime\(item\.updated_at\) \|\| '—' \}\}/)
  assert.doesNotMatch(wizardSource, /toLocaleString\('zh-CN'\)/)
})
