import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { businessWallClockToInstant, instantToBusinessWallClock } from '../shared/utils/businessTime.js'

// 关键回归：跟进/沟通时间与工时起止都是只有“提交”、没有“回填”的 datetime-local。
// 历史缺陷：new Date(value).toISOString() 把无时区的墙钟按**浏览器本地**解释，
// 浏览器时区不是 Asia/Shanghai 时，提交的瞬间会被静默平移（北京 09:00 变成别的小时）。
const viewSource = await readFile(new URL('./views/CustomerOpportunityView.vue', import.meta.url), 'utf8')

function extract(pattern, label) {
  const match = viewSource.match(pattern)
  assert.ok(match, `页面源文件必须保留该写法：${label}`)
  return match[1]
}

// 用页面里的真实表达式换算，而不是在测试里另写一份逻辑。
const followupBody = extract(
  /function followupInstant\(wallClock\) \{ return (.+?) \}\n/,
  'followupInstant 北京墙钟换算',
)
const submitFollowupInstant = new Function('wallClock', 'businessWallClockToInstant', `return ${followupBody}`)

function worklogDate(field) {
  const expression = extract(
    new RegExp(`const work${field} = (new Date\\(businessWallClockToInstant\\(operation\\.work_${field.toLowerCase()}\\)\\))`),
    `worklog 开始/结束按北京墙钟换算：${field}`,
  )
  return new Function('operation', 'businessWallClockToInstant', `return ${expression}`)
}
const worklogStart = worklogDate('Start')
const worklogEnd = worklogDate('End')

test('跟进时间按北京墙钟解释成瞬间：北京 2026-01-01T09:00 → UTC 2026-01-01T01:00:00Z', () => {
  assert.equal(
    submitFollowupInstant('2026-01-01T09:00', businessWallClockToInstant),
    '2026-01-01T01:00:00.000Z',
  )
  // 再次回填（同一共享函数）必须还原同一墙钟，口径与售前申请、报表边界一致。
  assert.equal(
    instantToBusinessWallClock(submitFollowupInstant('2026-01-01T09:00', businessWallClockToInstant)),
    '2026-01-01T09:00',
  )
  // 北京凌晨窗口：UTC 仍在前一天，不能被退到前一日。
  assert.equal(
    submitFollowupInstant('2026-01-01T00:30', businessWallClockToInstant),
    '2025-12-31T16:30:00.000Z',
  )
})

test('工时起止按北京墙钟解释成瞬间，起止比较与提交使用同一口径', () => {
  const start = worklogStart({ work_start: '2026-01-01T09:00' }, businessWallClockToInstant)
  const end = worklogEnd({ work_end: '2026-01-01T18:00' }, businessWallClockToInstant)
  assert.equal(start.toISOString(), '2026-01-01T01:00:00.000Z')
  assert.equal(end.toISOString(), '2026-01-01T10:00:00.000Z')
  assert.ok(end > start, '北京时间结束晚于开始，换算后同样成立')
  assert.equal(start.toISOString().endsWith('Z'), true, '提交的是带 Z 的 UTC 瞬间')
})

test('非法/空墙钟仍走原有失败路径（toISOString 抛错并入统一错误提示）', () => {
  assert.throws(() => submitFollowupInstant('', businessWallClockToInstant), RangeError)
  assert.throws(() => submitFollowupInstant('not-a-date', businessWallClockToInstant), RangeError)
  // 工时侧保持既有 Number.isNaN 校验可命中的 Invalid Date。
  assert.equal(Number.isNaN(worklogStart({ work_start: '' }, businessWallClockToInstant).getTime()), true)
})

test('页面不再用浏览器本地解释跟进时间与工时起止', () => {
  assert.doesNotMatch(viewSource, /new Date\(followupForm\.followed_at\)/)
  assert.doesNotMatch(viewSource, /new Date\(followupForm\.next_follow_at\)/)
  assert.doesNotMatch(viewSource, /new Date\(customerFollowupForm\.followed_at\)/)
  assert.doesNotMatch(viewSource, /new Date\(customerFollowupForm\.next_follow_at\)/)
  assert.doesNotMatch(viewSource, /new Date\(operation\.work_start\)/)
  assert.doesNotMatch(viewSource, /new Date\(operation\.work_end\)/)
  // 两处跟进提交都经由同一个北京墙钟换算入口。
  assert.match(viewSource, /followed_at: followupInstant\(followupForm\.followed_at\)/)
  assert.match(viewSource, /payload\.next_follow_at = followupInstant\(followupForm\.next_follow_at\)/)
  assert.match(viewSource, /followed_at: followupInstant\(customerFollowupForm\.followed_at\)/)
  assert.match(viewSource, /payload\.next_follow_at = followupInstant\(customerFollowupForm\.next_follow_at\)/)
})
