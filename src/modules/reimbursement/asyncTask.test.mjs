import test from 'node:test'
import assert from 'node:assert/strict'
import { pollTask, taskSettled } from './asyncTask.js'

test('任务状态只有完成、失败或过期才算终态', () => {
  assert.equal(taskSettled('DONE'), true)
  assert.equal(taskSettled('FAILED'), true)
  assert.equal(taskSettled('EXPIRED'), true)
  assert.equal(taskSettled('PENDING'), false)
  assert.equal(taskSettled('PROCESSING'), false)
  assert.equal(taskSettled(undefined), false)
})

test('自动轮询若干次后停止，并把最后一次状态交给回调', async () => {
  const statuses = ['PENDING', 'PROCESSING', 'PROCESSING', 'DONE']
  const seen = []
  let reads = 0
  const value = await pollTask(async () => {
    const status = statuses[Math.min(reads, statuses.length - 1)]
    reads += 1
    return { id: 'job', status }
  }, { attempts: 5, wait: async () => {}, onValue: (job) => seen.push(job.status) })
  assert.equal(value.status, 'DONE')
  assert.equal(reads, 4)
  assert.deepEqual(seen, statuses)
})

test('达到次数上限后停止，不无限刷新', async () => {
  let reads = 0
  const value = await pollTask(async () => { reads += 1; return { status: 'PROCESSING' } },
    { attempts: 3, wait: async () => {} })
  assert.equal(reads, 3)
  assert.equal(value.status, 'PROCESSING')
})

test('页面切换后停止读取，避免迟到结果覆盖新任务', async () => {
  let reads = 0
  let active = true
  const result = await pollTask(async () => { reads += 1; active = false; return { status: 'PENDING' } },
    { attempts: 5, wait: async () => {}, shouldContinue: () => active })
  assert.equal(reads, 1)
  assert.equal(result.status, 'PENDING')
})
