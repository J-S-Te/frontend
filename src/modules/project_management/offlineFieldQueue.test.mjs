import test from 'node:test'
import assert from 'node:assert/strict'
import { processFieldQueue } from './offlineFieldQueue.js'

test('offline retry preserves upload receipt and continues after one failure', async () => {
  const saved = []
  const removed = []
  const operations = [
    { id: 'op-1', kind: 'record', payload: { note: 'a' } },
    { id: 'op-2', kind: 'record', payload: { note: 'b' } },
  ]
  const result = await processFieldQueue({
    operations,
    submit: async (operation, holder) => {
      // 第一次操作已上传证据，随后事件请求失败。
      holder.current = { ...holder.current, artifact: { file_id: 'file-1' }, file: null }
      if (operation.id === 'op-1') throw new Error('event request failed')
    },
    remove: async (id) => removed.push(id),
    save: async (operation) => saved.push(operation),
    formatError: () => 'event request failed',
  })
  assert.deepEqual(result, { synced: 1, failed: 1 })
  assert.deepEqual(removed, ['op-2'])
  assert.equal(saved.length, 1)
  assert.equal(saved[0].id, 'op-1')
  assert.equal(saved[0].artifact.file_id, 'file-1')
  assert.equal(saved[0].file, null)
  assert.equal(saved[0].lastError, 'event request failed')
})

test('one permanently failing queue item does not block the next', async () => {
  let calls = 0
  const result = await processFieldQueue({
    operations: [{ id: 'a' }, { id: 'b' }],
    submit: async () => { calls += 1; throw new Error('permanent') },
    remove: async () => {},
    save: async () => {},
  })
  assert.equal(calls, 2)
  assert.deepEqual(result, { synced: 0, failed: 2 })
})

test('签到同步失败保留服务端拒绝状态，网络未知结果不误记为拒绝', async () => {
  const saved = []
  await processFieldQueue({
    operations: [{ id: 'rejected' }, { id: 'unknown' }],
    submit: async operation => { throw Object.assign(new Error('签到未确认'), operation.id === 'rejected' ? { status: 422 } : {}) },
    remove: async () => {},
    save: async operation => saved.push(operation),
  })
  assert.equal(saved[0].lastErrorStatus, 422)
  assert.equal(saved[1].lastErrorStatus, 0)
})

test('二百响应损坏和请求超时的未知结果标记不能因状态码丢失', async () => {
  for (const status of [200, 201, 408]) {
    const saved = []
    await processFieldQueue({ operations: [{ id: 'unknown-' + status }],
      submit: async () => { throw Object.assign(new Error('结果未知'), { status, outcomeUnknown: true }) },
      remove: async () => {}, save: async operation => saved.push(operation) })
    assert.equal(saved[0].resultUncertain, true)
  }
})

test('升级前只存失败文本的签到继续按结果未知处理', async () => {
  const saved = []
  await processFieldQueue({ operations: [{ id: 'legacy', lastError: '旧版网络同步失败' }],
    submit: async () => { throw Object.assign(new Error('输入已不满足当前规则'), { status: 422 }) },
    remove: async () => {}, save: async operation => saved.push(operation) })
  assert.equal(saved[0].resultUncertain, true)
})
