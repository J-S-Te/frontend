import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

test('手动阶段命令使用专用接口并携带服务端当前版本，不在客户端指定经理', async () => {
  const source = readFileSync(new URL('./projectManagement.js', import.meta.url), 'utf8')
  const start = source.indexOf('export function advanceManualReportStatus(')
  assert.ok(start >= 0)
  const body = source.slice(start, source.indexOf('\n}', start) + 2).replace('export ', '')
  const requests = []
  const request = async (...args) => { requests.push(args); return {status:'REVIEWED'} }
  const advance = new Function('request', `${body}; return advanceManualReportStatus`)(request)
  await advance('SI/手动', 'REVIEWED', 7)
  assert.equal(requests.length, 1)
  assert.equal(requests[0][0], '/service-items/SI%2F%E6%89%8B%E5%8A%A8/report-status/manual')
  assert.equal(requests[0][1].method, 'POST')
  assert.deepEqual(JSON.parse(requests[0][1].body), {phase:'REVIEWED',expected_version:7})
})
