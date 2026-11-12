import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const panel = await readFile(new URL('./ContractAuditOutboxPanel.vue', import.meta.url), 'utf8')

test('审计死信面板需要 approval.manage，权限错误不回显服务端原始错误', () => {
  assert.match(panel, /import \{\s*listFailedAuditOutboxEvents,\s*retryFailedAuditOutboxEvent\s*\} from '\.\.\/api\/contract'/)
  assert.match(panel, /if \(described\.status === 401 \|\| described\.status === 403\) \{\s*permissionStatus\.value = described\.status/)
  assert.match(panel, /当前账号没有审计死信运维权限（需要 approval\.manage）/)
  assert.match(panel, /没有查看审计死信的权限/)
  const permissionBlock = panel.slice(panel.indexOf('permissionStatus === 401'), panel.indexOf('actionError'))
  assert.doesNotMatch(permissionBlock, /\{\{ error \}\}/)
})

test('审计死信重试先人工确认，成功后重读列表，不伪造送达', () => {
  assert.match(panel, /await askConfirm\(/)
  assert.match(panel, /await retryFailedAuditOutboxEvent\(item\.id\)/)
  assert.match(panel, /await load\(\)/)
  assert.match(panel, /重置不代表已经送达/)
  assert.match(panel, /重试未完成：/)
})

test('审计死信按北京业务时间展示，列表缺数据时给出明确空态', () => {
  assert.match(panel, /return formatBusinessDateTime\(value, \{ seconds: true \}\) \|\| String\(value\)/)
  assert.match(panel, /当前没有审计死信/)
  assert.match(panel, /审计死信列表加载失败/)
  assert.match(panel, /共 \{\{ items\.length \}\} 条审计死信/)
})
