import assert from 'node:assert/strict'
import test from 'node:test'
import { execFileSync } from 'node:child_process'
import { customerAPIParams } from './customerQuery.js'

const QUERY_MODULE_URL = new URL('./customerQuery.js', import.meta.url).href

// 客户列表的日期过滤是 type="date" 的纯日期：它是北京日历日，不是浏览器本地的瞬间。
// 历史缺陷：new Date(`${value}T00:00:00`).toISOString() 按浏览器本地零点换算，
// 浏览器在 UTC+8 时“2026-01-01”会变成 2025-12-31T16:00:00Z，与其后端的北京日历日口径混用。
test('日期过滤按北京墙钟换算成 UTC 半开区间，不受浏览器时区影响', () => {
  const params = customerAPIParams({ created_from: '2026-01-01', created_to: '2026-01-31' }, 1, 20)
  // 北京 2026-01-01 00:00 = UTC 2025-12-31T16:00Z；北京 2026-02-01 00:00 = UTC 2026-01-31T16:00Z。
  assert.equal(params.created_from, '2025-12-31T16:00:00.000Z')
  assert.equal(params.created_to, '2026-01-31T16:00:00.000Z')
  assert.ok(new Date(params.created_from) < new Date(params.created_to), '起点必须早于不含上界')
  assert.equal(params.page, '1')
  assert.equal(params.page_size, '20')
})

test('最近跟进区间与创建区间使用同一口径', () => {
  const params = customerAPIParams({ last_followup_from: '2026-03-01', last_followup_to: '2026-03-31' }, 2, 50)
  assert.equal(params.last_followup_from, '2026-02-28T16:00:00.000Z')
  assert.equal(params.last_followup_to, '2026-03-31T16:00:00.000Z')
})

test('跨月、跨年与闰日边界的次日零点正确进位', () => {
  // 2026-01-31 的次日是 2026-02-01（北京）→ UTC 2026-01-31T16:00Z。
  assert.equal(customerAPIParams({ created_to: '2026-01-31' }, 1, 20).created_to, '2026-01-31T16:00:00.000Z')
  // 2026-12-31 的次日是 2027-01-01（北京）→ UTC 2026-12-31T16:00Z。
  assert.equal(customerAPIParams({ created_to: '2026-12-31' }, 1, 20).created_to, '2026-12-31T16:00:00.000Z')
  // 2028 是闰年：2028-02-28 的次日是 2028-02-29（北京）→ UTC 2028-02-28T16:00Z。
  assert.equal(customerAPIParams({ created_to: '2028-02-28' }, 1, 20).created_to, '2028-02-28T16:00:00.000Z')
  assert.equal(customerAPIParams({ created_to: '2028-02-29' }, 1, 20).created_to, '2028-02-29T16:00:00.000Z')
})

test('单边区间、缺省区间与非法日期不产生伪边界', () => {
  const onlyFrom = customerAPIParams({ created_from: '2026-05-01' }, 1, 20)
  assert.equal(onlyFrom.created_from, '2026-04-30T16:00:00.000Z')
  assert.equal('created_to' in onlyFrom, false, '未填写结束日期时不能凭空加上界')

  const empty = customerAPIParams({}, 1, 20)
  assert.equal('created_from' in empty, false)
  assert.equal('created_to' in empty, false)
  assert.equal('last_followup_from' in empty, false)
  assert.equal('last_followup_to' in empty, false)

  // 非法日期无法换算成瞬间：保留原值交给服务端校验，不静默丢弃过滤条件（否则会放宽数据范围）。
  const invalid = customerAPIParams({ created_from: 'not-a-date', created_to: 'not-a-date' }, 1, 20)
  assert.equal(invalid.created_from, 'not-a-date')
  assert.equal(invalid.created_to, 'not-a-date')
  const impossible = customerAPIParams({ created_from: '2026-02-30', created_to: '2026-02-30' }, 1, 20)
  assert.equal(impossible.created_from, '2026-02-30')
  assert.equal(impossible.created_to, '2026-02-30')
})

test('换算结果与浏览器本地时区无关：换个 TZ 子进程得到同一 UTC 边界', () => {
  const script = `import { customerAPIParams } from ${JSON.stringify(QUERY_MODULE_URL)}
    const params = customerAPIParams({ created_from: '2026-01-01', created_to: '2026-01-31' }, 1, 20)
    process.stdout.write(JSON.stringify({ from: params.created_from, to: params.created_to }))`
  const run = (timeZone) => JSON.parse(execFileSync(
    process.execPath,
    ['--input-type=module', '-e', script],
    { env: { ...process.env, TZ: timeZone }, encoding: 'utf8' },
  ))
  const utc = run('UTC')
  const shanghai = run('Asia/Shanghai')
  const newYork = run('America/New_York')
  assert.deepEqual(utc, shanghai)
  assert.deepEqual(utc, newYork)
  assert.deepEqual(utc, { from: '2025-12-31T16:00:00.000Z', to: '2026-01-31T16:00:00.000Z' })
})
