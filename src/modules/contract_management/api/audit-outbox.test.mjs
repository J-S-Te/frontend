import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('./contract.js', import.meta.url), 'utf8')

test('审计死信列表使用租户范围端点，结构不完整时失败关闭', () => {
  assert.match(source, /export async function listFailedAuditOutboxEvents/)
  assert.match(source, /\`\/audit-outbox\/failed\?limit=\$\{size\}\`/)
  // 缺字段不能当作“暂无死信”：逐条校验 id/event_id/action/attempts 等。
  assert.match(source, /value\.items\.every\(auditOutboxItemResource\)/)
  assert.match(source, /typeof value\.last_error === 'string'/)
  assert.match(source, /Number\.isSafeInteger\(value\.attempts\) && value\.attempts >= 0/)
})

test('审计死信重试提交编码后的标识，只接受服务端 retry 回执', () => {
  assert.match(source, /\`\/audit-outbox\/failed\/\$\{encodeURIComponent\(eventID\)\}\/retry\`/)
  assert.match(source, /data\.id === eventID && data\.status === 'retry'/)
  // 空标识/超长标识在发请求前拒绝，避免把用户输入拼进运维路由。
  assert.match(source, /审计死信标识不合法，无法重试。/)
  assert.match(source, /!resourceID\(eventID\) \|\| eventID\.length > 64/)
})
