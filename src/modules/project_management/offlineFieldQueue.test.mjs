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
