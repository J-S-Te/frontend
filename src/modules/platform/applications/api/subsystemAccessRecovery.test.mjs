import test, { afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { previewSubsystemAccessRecovery, abandonSubsystemAccessRecovery } from './subsystemAccessRecovery.js'

const originalFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = originalFetch })

test('恢复预检使用固定原操作及现有会话请求管道', async () => {
  let captured
  globalThis.fetch = async (url, options) => {
    captured = { url, options }
    return new Response(JSON.stringify({ code: 'OK', data: { operation_id: 'op-1', generation: 7 } }),
      { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
  const result = await previewSubsystemAccessRecovery(' op-1 ')
  assert.equal(captured.url, '/api/v1/subsystem-access/operations/op-1/recovery-preview')
  assert.equal(captured.options.credentials, 'include')
  assert.equal(result.generation, 7)
})

test('人工终止仅提交明确白名单并保留失败状态', async () => {
  let captured
  globalThis.fetch = async (url, options) => {
    captured = { url, options }
    return new Response(JSON.stringify({ code: 'OK', data: { operation_id: 'op-1', status: 'FAILED', error_code: 'OPERATOR_ABANDONED' } }),
      { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
  const body = { expected_version: 5, generation: 7, evidence_digest: 'a'.repeat(64), reason: '已核对当前实际运行文件及容器事实。' }
  const result = await abandonSubsystemAccessRecovery('op-1', body)
  assert.equal(captured.url, '/api/v1/subsystem-access/operations/op-1/abandon')
  assert.equal(captured.options.method, 'POST')
  assert.deepEqual(JSON.parse(captured.options.body), body)
  assert.equal(result.status, 'FAILED')
})
