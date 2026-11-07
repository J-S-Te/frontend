import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { formatLicenseTime, licenseEventName, licenseEventTimestamp, shortenDigest } from './presentation.js'
import { formatBusinessDateTime } from '../../../shared/utils/businessTime.js'

const consoleView = readFileSync(new URL('../../views/PlatformConsoleView.vue', import.meta.url), 'utf8')
const viewSource = readFileSync(new URL('./CommercialLicenseView.vue', import.meta.url), 'utf8')
const rowSource = readFileSync(new URL('./LicenseEventRow.vue', import.meta.url), 'utf8')
const sheetSource = readFileSync(new URL('./LicenseEventsSheet.vue', import.meta.url), 'utf8')

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

// ===========================================================================
// 页面契约：页内只留「最近几条单行摘要」，完整列表进右侧抽屉。
// ---------------------------------------------------------------------------
// 旧契约（eventsExpanded / 展开本页全部 / 页内 max-height 内滚动 / 页内分页条）
// 全部作废：它们既是挤占页面的原因，也让「看到的是最近几条」这件事说起来含糊。
// 这里锁住新契约：条数默认 ≤5（窄屏 3 且计数文案跟着变）、没有内滚动、页内没有
// PaginationBar，分页只在抽屉里；同时锁住抽屉的无障碍与焦点回位。
// ===========================================================================

test('页内摘要最多 5 行（≤720px 3 行），条数由 matchMedia 派生而不是 CSS 隐藏', () => {
  assert.match(viewSource, /matchMedia\('\(max-width:720px\)'\)/)
  assert.match(viewSource, /const narrowViewport = ref\(Boolean\(narrowMedia\?\.matches\)\)/)
  assert.match(viewSource, /const recentLimit = computed\(\(\) => \(narrowViewport\.value \? 3 : 5\)\)/)
  assert.match(viewSource, /events\.value\.items\.slice\(0, recentLimit\.value\)/)
  assert.match(viewSource, /v-for="event in recentEvents"/)
  // 计数文案与实际渲染行数共用同一份 computed，不会出现「说 5 条只看到 3 行」。
  assert.match(viewSource, /显示最近 \{\{ recentEvents\.length \}\} 条，共 \{\{ eventsTotalLabel \}\} 条/)
})

test('页内摘要区没有折叠开关、没有内滚动、没有页内分页', () => {
  // 旧契约的四个具体形态逐个断言不存在，避免只删一半。
  assert.doesNotMatch(viewSource, /eventsExpanded/)
  assert.doesNotMatch(viewSource, /展开本页全部/)
  assert.doesNotMatch(viewSource, /class="license-timeline"/)
  assert.doesNotMatch(viewSource, /max-height: 340px/)
  assert.doesNotMatch(viewSource, /overscroll-behavior/)
  assert.doesNotMatch(viewSource, /tabindex="0" aria-label="授权事件列表"/)
  assert.doesNotMatch(viewSource, /<PaginationBar/)
  assert.doesNotMatch(viewSource, /visibleEvents/)
})

test('「查看全部」入口打开抽屉；事件行组件在页内与抽屉里复用同一份实现', () => {
  assert.match(viewSource, /import LicenseEventRow from '\.\/LicenseEventRow\.vue'/)
  assert.match(viewSource, /import LicenseEventsSheet from '\.\/LicenseEventsSheet\.vue'/)
  assert.match(viewSource, /查看全部 \{\{ eventsTotalLabel \}\} 条/)
  assert.match(viewSource, /ref="eventsTrigger"/)
  assert.match(viewSource, /:aria-expanded="eventsSheetOpen"/)
  assert.match(viewSource, /<LicenseEventsSheet[\s\S]{0,400}@close="closeEventsSheet"/)
  // 两处都渲染 LicenseEventRow，只是 id 前缀不同（同一事件可能在两处同时可见）。
  assert.match(viewSource, /<LicenseEventRow v-for="event in recentEvents"[\s\S]{0,120}id-prefix="license-event"/)
  assert.match(sheetSource, /<LicenseEventRow v-for="event in items"[\s\S]{0,120}id-prefix="license-sheet-event"/)
})

test('抽屉里保留服务端分页 20 条/页，页内不再出现分页条', () => {
  assert.match(sheetSource, /const pageSize = 20/)
  assert.match(sheetSource, /label="授权事件分页"/)
  assert.match(sheetSource, /:page="page"/)
  assert.match(sheetSource, /:total="total"/)
  assert.match(sheetSource, /:page-size="pageSize"/)
  assert.match(sheetSource, /@change="loadEvents\(\$event\)"/)
  // 抽屉自己取数：翻页不能改写页内「最近几条」那份快照。
  assert.match(sheetSource, /import \{ getLicenseEvents \} from '\.\/api\.js'/)
  assert.doesNotMatch(viewSource, /:items="events\.items"/)
  assert.doesNotMatch(viewSource, /<PaginationBar/)
})

test('单行摘要是「名 · 版本修订 · 时间 · chevron」+ <time datetime>，原始 kind 移进详情', () => {
  assert.match(rowSource, /<time[^>]*:datetime="datetimeAttr \|\| undefined"/)
  assert.match(rowSource, /版本 \{\{ event\.version \?\? '—' \}\} · 修订 \{\{ event\.revision \?\? '—' \}\}/)
  assert.match(rowSource, /<ConsoleIcon name="chevron" class="license-event-chevron" \/>/)
  // 整行是按钮：aria-expanded / aria-controls 成对挂在按钮上。
  assert.match(rowSource, /:aria-expanded="expanded"/)
  assert.match(rowSource, /:aria-controls="detailId"/)
  // 摘要本身不出现原始 code（它在详情里）。
  const summary = rowSource.slice(rowSource.indexOf('<button type="button" class="license-event-summary"'), rowSource.indexOf('</button>'))
  assert.doesNotMatch(summary, /\{\{ kind \}\}/)
  assert.match(rowSource, /<code class="license-event-code">\{\{ kind \|\| '—' \}\}<\/code>/)
  // 未知类型用原 code 兜底：只有完全没记录 kind 时才给一句人话，不把未知类型吞成「未知事件」。
  assert.match(rowSource, /licenseEventName\(kind\.value\)/)
  assert.match(rowSource, /kind\.value \? licenseEventName\(kind\.value\) : '未记录事件类型'/)
})

test('行内详情包含原始 code、RFC3339 时间、版本、修订说明、digest 与 tenant/user', () => {
  for (const label of ['事件类型', '发生时间', '许可证版本', '状态修订', '许可证摘要', '租户标识', '操作者', '事件 id']) {
    assert.ok(rowSource.includes(label), `详情缺少「${label}」`)
  }
  // 修订号必须点明不是事件序号，否则会被当成「第几条事件」。
  assert.match(rowSource, /授权状态修订号，不是事件序号/)
  // 空值只写「服务端未记录」，不允许推断成“系统自动”。
  assert.match(rowSource, /服务端未记录/)
  assert.doesNotMatch(rowSource, /系统自动/)
  // digest 截断 + 复制，反馈走 aria-live。
  assert.match(rowSource, /import \{ copyTextToClipboard \} from '@\/modules\/shared\/utils\/clipboard\.js'/)
  assert.match(rowSource, /shortenDigest\(digest\.value\)/)
  assert.match(rowSource, /复制完整 digest/)
  assert.match(rowSource, /aria-live="polite"/)
})

test('抽屉：右侧骨架 + 只读语义 + Escape 关闭 + 焦点回入口', () => {
  assert.match(viewSource, /class="console-card license-section license-events"/)
  assert.match(sheetSource, /class="console-sheet"/)
  assert.match(sheetSource, /role="dialog"/)
  assert.match(sheetSource, /aria-modal="true"/)
  assert.match(sheetSource, /aria-labelledby="license-events-sheet-title"/)
  assert.match(sheetSource, /共 \{\{ totalLabel \}\} 条 · 只读 · 按时间倒序/)
  // 只读：抽屉里不得出现任何写操作。
  assert.doesNotMatch(sheetSource, /编辑|删除|归档|重命名/)
  // Escape 只在自己是顶层时消费，下层弹窗不会跟着关。
  assert.match(sheetSource, /if \(!isTopDialogLayer\(layerElement\)\) return/)
  assert.match(sheetSource, /if \(event\.key === 'Escape'\)[\s\S]{0,120}emit\('close'\)/)
  // 背景滚动锁与层级都复用共享工具。
  assert.match(sheetSource, /acquireBodyScrollLock\(\)/)
  assert.match(sheetSource, /registerDialogLayer\(layerElement\)/)
  // 关闭后焦点回到「查看全部」按钮：抽屉自己还给 previousFocus，页面再显式兜底一次。
  assert.match(sheetSource, /previousFocus\.focus\(\{ preventScroll: true \}\)/)
  assert.match(viewSource, /async function closeEventsSheet\(\)[\s\S]{0,160}eventsTrigger\.value\?\.focus\?\./)
})

test('打开抽屉默认回第 1 页并加载，首次未加载时是紧凑 loading 而不是 0 条', () => {
  // 每次打开都清零旧状态再拉第 1 页：上次翻到第几页、失败过没有都不该带进这一次。
  assert.match(sheetSource, /watch\(\(\) => props\.open, open => \{[\s\S]{0,260}page\.value = 1[\s\S]{0,80}loadEvents\(1\)/)
  assert.match(sheetSource, /if \(!open\) return[\s\S]{0,80}items\.value = \[\][\s\S]{0,80}total\.value = null/)
  // 抽屉的三态闸门与页内同优先级：loading > error > empty。
  assert.match(sheetSource, /const listState = computed\(\(\) => loading\.value \|\| Boolean\(error\.value\) \|\| !items\.value\.length\)/)
  assert.match(sheetSource, /<ListState[\s\S]{0,400}empty-title="暂无授权事件。"/)
  // 后台刷新保留旧行：只标 aria-busy，不把列表换回 loading。
  assert.match(viewSource, /:aria-busy="eventsRefreshing \? 'true' : 'false'"/)
  assert.match(sheetSource, /:aria-busy="busy \? 'true' : 'false'"/)
})

test('错误时不显示旧 total / 0，空态不渲染「查看全部」与计数', () => {
  // 失败先清快照：错误态旁边不能挂着上一页的 total，也不能显示「共 0 条」。
  assert.match(viewSource, /events\.value = \{ items: \[\], total: null, page: 1 \}/)
  assert.match(viewSource, /Number\.isFinite\(events\.value\.total\) \? events\.value\.total : '—'/)
  // 计数只在有数据且没失败时出现。
  assert.match(viewSource, /<span v-if="!eventsError && events\.items\.length" class="license-chip">共 \{\{ eventsTotalLabel \}\} 条<\/span>/)
  // 页脚（计数 + 查看全部）整体挂在 !eventsListState 上：空态/失败都不渲染入口。
  assert.match(viewSource, /<footer v-if="!eventsListState" class="license-event-foot">/)
})

test('事件区块移到了运行时执行之后（页面最底部），运行时锚点位置不变', () => {
  const runtime = viewSource.indexOf('class="license-runtime-anchor"')
  const events = viewSource.indexOf('class="console-card license-section license-events"')
  assert.ok(runtime > 0 && events > 0, '运行时锚点与事件区块都必须存在')
  assert.ok(events > runtime, '授权事件区块必须在运行时授权执行之后')
  assert.ok(events > viewSource.indexOf('id="license-import-title"'), '授权事件区块必须在导入区之后')
})

test('事件时间格式化：只有带时区的 RFC3339 才写 datetime 属性', () => {
  assert.equal(licenseEventTimestamp('2026-10-13T04:34:56Z'), '2026-10-13T04:34:56Z')
  assert.equal(licenseEventTimestamp('2026-10-13T12:34:56+08:00'), '2026-10-13T12:34:56+08:00')
  assert.equal(licenseEventTimestamp('2026-10-13T04:34:56.123456789Z'), '2026-10-13T04:34:56.123456789Z')
  for (const value of [null, undefined, '', 0, 1700000000, true, {}, '2026-10-13 12:00:00', '2026-10-13T12:00:00', '0001-01-01T00:00:00Z']) {
    assert.equal(licenseEventTimestamp(value), '', String(value))
  }
  // 能写 datetime 的值，展示仍然是同一时刻的北京时间。
  assert.equal(formatLicenseTime(licenseEventTimestamp('2026-10-13T04:34:56Z')), '2026-10-13 12:34:56')
})

test('digest 只截断可见文本：前 12 / 后 6，短值原样返回', () => {
  const digest = 'sha256:0123456789abcdef0123456789abcdef0123456789'
  assert.equal(shortenDigest(digest), 'sha256:01234…456789')
  assert.equal(shortenDigest('short'), 'short')
  assert.equal(shortenDigest(''), '')
  assert.equal(shortenDigest(null), '')
  assert.equal(shortenDigest(undefined), '')
})
