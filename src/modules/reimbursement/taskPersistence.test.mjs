import test from 'node:test'
import assert from 'node:assert/strict'
import { forgetTask, recallTask, rememberTask, savedAtLabel, TASK_KINDS } from './taskPersistence.js'

// 用途：构造与 localStorage 同形的最小替身，便于在 node 中验证记忆行为。
// 参数：无。
// 返回值：带 setItem/getItem/removeItem 与写读记录的内存存储。
function memoryStore() {
  const data = new Map()
  return {
    data,
    setItem(key, value) { data.set(key, String(value)) },
    getItem(key) { return data.has(key) ? data.get(key) : null },
    removeItem(key) { data.delete(key) },
  }
}

test('任务坐标按种类记忆，刷新后仍能取回同一任务号与坐标', () => {
  const store = memoryStore()
  assert.equal(rememberTask('parse', { task_id: 'run-1', document_id: 'doc-1', status: 'RUNNING' }, { store, now: 1000 }), true)
  assert.deepEqual(recallTask('parse', { store, now: 2000 }), { task_id: 'run-1', document_id: 'doc-1', status: 'RUNNING', saved_at: 1000 })
  assert.deepEqual([...store.data.keys()], ['reimbursement.task.parse'])
  // 不同种类互不覆盖，导出任务不应冲掉解析任务。
  rememberTask('export', { task_id: 'export-1', claim_ids: ['a', 'b'] }, { store, now: 3000 })
  assert.equal(recallTask('parse', { store, now: 4000 }).task_id, 'run-1')
  assert.deepEqual(recallTask('export', { store, now: 4000 }).claim_ids, ['a', 'b'])
})

test('过期、损坏与未来时间的记录都被丢弃，不留错误的任务号', () => {
  const store = memoryStore()
  rememberTask('parse', { task_id: 'run-1' }, { store, now: 0 })
  const week = 7 * 24 * 60 * 60 * 1000
  assert.equal(recallTask('parse', { store, now: week + 1 }), null)
  assert.equal(store.data.has('reimbursement.task.parse'), false)
  store.setItem('reimbursement.task.export', '{不是JSON')
  assert.equal(recallTask('export', { store }), null)
  // 保存时间明显晚于当前时间说明本机时钟异常或记录被改写，不能当作有效记忆。
  rememberTask('archive', { task_id: 'job-1' }, { store, now: 100000 })
  assert.equal(recallTask('archive', { store, now: 1000 }), null)
})

test('未登记种类、空对象与不可用存储都安全降级，不写脏记录', () => {
  const store = memoryStore()
  assert.equal(rememberTask('unknown', { task_id: 'x' }, { store }), false)
  assert.equal(rememberTask('parse', {}, { store }), false)
  assert.equal(rememberTask('parse', null, { store }), false)
  assert.equal(rememberTask('parse', { task_id: 'run-1' }, { store: null }), false)
  assert.equal(recallTask('parse', { store: null }), null)
  // 名字未登记的种类即使被人工写入也不读取。
  store.setItem('reimbursement.task.unknown', JSON.stringify({ task_id: 'x', saved_at: 1 }))
  assert.equal(recallTask('unknown', { store, now: 1 }), null)
  assert.deepEqual(Object.keys(TASK_KINDS), ['parse', 'export', 'archive', 'document'])
})

test('写过的任务可以显式清除，保存时间给出中文相对说明', () => {
  const store = memoryStore()
  rememberTask('document', { document_id: 'doc-1' }, { store, now: 5000 })
  forgetTask('document', { store })
  assert.equal(recallTask('document', { store, now: 6000 }), null)
  assert.equal(savedAtLabel(5000, 5000 + 30000), '刚刚')
  assert.equal(savedAtLabel(5000, 5000 + 25 * 60000), '25 分钟前')
  assert.equal(savedAtLabel(5000, 5000 + 5 * 3600000), '5 小时前')
  assert.equal(savedAtLabel(5000, 5000 + 3 * 86400000), '3 天前')
  assert.equal(savedAtLabel('不可能的时间'), '')
})
