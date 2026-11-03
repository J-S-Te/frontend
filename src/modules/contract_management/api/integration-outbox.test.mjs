import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

// contract.js 依赖 Vite 的 import.meta.env 与浏览器导航，不能在 Node 直接导入；
// 这里沿用仓库既有的源码契约断言，只锁定死信接口的路径、方法、枚举与失败关闭校验。
const source = await readFile(new URL('./contract.js', import.meta.url), 'utf8')

test('integration outbox list uses the managed kind enum and server limit', () => {
  assert.match(source, /const INTEGRATION_OUTBOX_KINDS = \['financial', 'responsibility', 'project', 'link'\]/)
  assert.match(source, /export async function listFailedIntegrationOutboxEvents\(kind, \{ limit = 100 \} = \{\}\)/)
  assert.match(source, /const queue = integrationOutboxKind\(kind\)/)
  assert.match(source, /new URLSearchParams\(\{ kind: queue, limit: String\(size\) \}\)\.toString\(\)/)
  assert.match(source, /request\(`\/integration-outbox\/failed\?\$\{search\}`/)
})

test('integration outbox list fails closed on malformed items instead of claiming an empty queue', () => {
  assert.match(source, /validateData: \(value\) => collectionPage\(value\) && Array\.isArray\(value\.items\)[\s\S]*value\.items\.every\(integrationOutboxItemResource\)/)
  const itemContract = source.slice(
    source.indexOf('function integrationOutboxItemResource'),
    source.indexOf('export async function listFailedIntegrationOutboxEvents'),
  )
  for (const field of ['value.id', 'value.kind', 'value.event', 'value.aggregate_id', 'value.attempts', 'value.last_error', 'value.created_at', 'value.updated_at']) {
    assert.match(itemContract, new RegExp(field.replace(/\./g, '\\.')), field)
  }
})

test('integration outbox retry posts to the kind/id route with an encoded id and no forged success', () => {
  assert.match(source, /export async function retryFailedIntegrationOutboxEvent\(kind, id\)/)
  assert.match(source, /const eventID = String\(id \?\? ''\)\.trim\(\)/)
  assert.match(source, /!resourceID\(eventID\) \|\| eventID\.length > 64/)
  assert.match(source, /`\/integration-outbox\/failed\/\$\{queue\}\/\$\{encodeURIComponent\(eventID\)\}\/retry`/)
  assert.match(source, /method: 'POST'/)
  assert.match(source, /validateData: \(data\) => resourceObject\(data\) && data\.id === eventID[\s\S]*data\.kind === queue && data\.status === 'retry'/)
})

test('unknown integration outbox kinds are rejected before any request', () => {
  assert.match(source, /function integrationOutboxKind\(kind\) \{[\s\S]*?if \(!INTEGRATION_OUTBOX_KINDS\.includes\(kind\)\) throw new Error\('集成死信类型不合法。'\)[\s\S]*?return kind/)
  for (const kind of ['financial', 'responsibility', 'project', 'link']) {
    assert.ok(source.includes(`'${kind}'`), kind)
  }
})
