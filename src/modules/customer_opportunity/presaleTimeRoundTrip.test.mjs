import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { businessWallClockToInstant, instantToBusinessWallClock } from '../shared/utils/businessTime.js'
import { presaleAPIParams, presaleStateFromQuery, presaleStateToQuery } from './presaleQuery.js'

// 关键回归：预计开始/结束时间必须“回填 → 原样提交 → 再回填”值不变。
// 历史缺陷：回填用 new Date(iso).toISOString().slice(0,16)（UTC 墙钟），提交却按浏览器本地解释，
// 浏览器时区不是 UTC 时，重新打开再提交会把同一个期望开始时间静默平移。
const viewSource = await readFile(new URL('./views/CustomerOpportunityView.vue', import.meta.url), 'utf8')

function fillExpression(field) {
  const match = viewSource.match(new RegExp(`expected_${field}: (instantToBusinessWallClock\\(request\\.expected_${field}\\))`))
  assert.ok(match, `回填侧必须使用 instantToBusinessWallClock：expected_${field}`)
  return match[1]
}

function submitExpression(field) {
  const match = viewSource.match(new RegExp(`businessWallClockToInstant\\(presaleForm\\.expected_${field}\\)`))
  assert.ok(match, `提交侧必须使用 businessWallClockToInstant：expected_${field}`)
  return match[0]
}

// 用页面里的真实表达式做往返，而不是在测试里另写一份换算逻辑。
const fillStart = new Function('request', 'instantToBusinessWallClock', `return ${fillExpression('start')}`)
const fillEnd = new Function('request', 'instantToBusinessWallClock', `return ${fillExpression('end')}`)
const submitStart = new Function('presaleForm', 'businessWallClockToInstant', `return ${submitExpression('start')}`)
const submitEnd = new Function('presaleForm', 'businessWallClockToInstant', `return ${submitExpression('end')}`)

function submitAsInstant(fn, wallClock) {
  // 页面提交时把 businessWallClockToInstant 的结果包成 Date 再 toISOString()，这里保持同一链路。
  const instant = fn({ expected_start: wallClock, expected_end: wallClock }, businessWallClockToInstant)
  return new Date(instant).toISOString()
}

test('预计开始/结束时间回填与提交严格对称：回填 → 原样提交 → 再回填值不变', () => {
  const instants = [
    '2026-10-25T16:30:00.000Z', // 北京 2026-10-26 00:30（UTC 仍是 10-25）
    '2026-10-25T15:59:00.000Z', // 北京 2026-10-25 23:59
    '2026-10-26T00:00:00.000Z', // 北京 2026-10-26 08:00
    '2026-01-31T16:00:00.000Z', // 北京 2026-02-01 00:00（跨月）
    '2026-12-31T15:59:00.000Z', // 北京 2026-12-31 23:59（跨年边界前一刻）
    '2027-01-01T00:01:00.000Z',
  ]
  for (const instant of instants) {
    const firstFillStart = fillStart({ expected_start: instant }, instantToBusinessWallClock)
    const firstFillEnd = fillEnd({ expected_end: instant }, instantToBusinessWallClock)
    assert.equal(firstFillStart, firstFillEnd, '开始与结束用同一规则')
    assert.match(firstFillStart, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, `${instant} 回填必须是 datetime-local 可接受的北京墙钟`)

    // 用户原样提交：不修改输入框内容。
    const submitted = submitAsInstant(submitStart, firstFillStart)
    assert.equal(submitted, new Date(instant).toISOString(), `${instant} 原样提交必须还原同一瞬间`)

    // 再次打开：回填值必须与第一次完全一致。
    const secondFillStart = fillStart({ expected_start: submitted }, instantToBusinessWallClock)
    assert.equal(secondFillStart, firstFillStart, `${instant} 二次回填必须与首次回填一致`)
  }
})

test('北京凌晨窗口回填仍是北京日历日，不会被 UTC 墙钟退到前一天', () => {
  // 北京 2026-10-26 00:30 的瞬间；旧实现 slice(0,16) 会回填成 2026-10-25T16:30。
  const beijingAfterMidnight = '2026-10-25T16:30:00.000Z'
  assert.equal(fillStart({ expected_start: beijingAfterMidnight }, instantToBusinessWallClock), '2026-10-26T00:30')
  assert.equal(submitAsInstant(submitStart, '2026-10-26T00:30'), beijingAfterMidnight)
})

test('源文件不再保留 UTC 墙钟回填写法，两侧引用同一对共享函数', () => {
  assert.doesNotMatch(viewSource, /toISOString\(\)\.slice\(0, 16\)/)
  assert.match(viewSource, /import \{ businessWallClockToInstant, instantToBusinessWallClock \} from '@\/modules\/shared\/utils\/businessTime\.js'/)
  // 重开审批与新建申请都提交瞬间，不再把浏览器本地解释的墙钟交给幂等键规范化。
  assert.match(viewSource, /expected_start: expectedStart\.toISOString\(\)/)
  assert.match(viewSource, /expected_end: expectedEnd\.toISOString\(\)/)
  assert.match(viewSource, /const expectedStart = new Date\(businessWallClockToInstant\(presaleForm\.expected_start\)\)/)
  assert.match(viewSource, /const expectedEnd = new Date\(businessWallClockToInstant\(presaleForm\.expected_end\)\)/)
})

test('售前筛选时间边界同样按北京墙钟提交，并与 URL 往返一致', () => {
  const wall = '2026-10-26T00:30'
  const params = presaleAPIParams({ created_from: wall, expected_to: wall })
  assert.equal(params.created_from, '2026-10-25T16:30:00.000Z')
  assert.equal(params.expected_to, '2026-10-25T16:30:00.000Z')
  // 回填侧（URL 原样保存墙钟）与提交侧对称：同一个瞬间再回填仍是原值。
  assert.equal(instantToBusinessWallClock(params.created_from), wall)

  const state = { ...presaleStateFromQuery({}).filters, created_from: wall, expected_to: wall }
  const query = presaleStateToQuery(state, 'list', 1, 20, 20)
  assert.equal(query.created_from, wall, 'URL 只保存北京墙钟，读取时不解释成瞬间')
  assert.equal(query.expected_to, wall)
  assert.equal(instantToBusinessWallClock(presaleAPIParams({ created_from: query.created_from }).created_from), wall)
  assert.equal(presaleAPIParams({ created_from: 'not-a-date' }).created_from, undefined, '非法边界不发送')
})
