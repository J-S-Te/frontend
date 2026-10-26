import assert from 'node:assert/strict'
import test from 'node:test'
import { ref } from 'vue'
import { useReportExport } from './useReportExport.js'

// 轮询间隔经 window.setTimeout(resolve, 1000)：桩记录延迟并立即放行，避免真实等待。
const timers = []
globalThis.window = { setTimeout: (handler, delay) => { timers.push(delay); handler(); return timers.length } }

function harness({ created = { id: 'JOB-1', status: 'READY' }, polls = [], createError = null, pollError = null, downloadError = null } = {}) {
  const calls = { create: 0, aging: 0, poll: [], download: [], notify: [] }
  const queue = [...polls]
  const deps = {
    saving: ref(false),
    notify: (value) => calls.notify.push(value),
    formatSettlementError: (cause, options) => {
      const code = typeof cause === 'string' ? cause : cause?.code
      return options ? `${options.fallback}|${code}` : `fmt:${code}`
    },
    createInvoicedReceivablesExport: async () => { calls.create++; if (createError) throw createError; return created },
    createAgingReceivablesExport: async () => { calls.aging++; if (createError) throw createError; return created },
    getReportExport: async (id) => { calls.poll.push(id); if (pollError) throw pollError; return queue.length ? queue.shift() : { id, status: 'PENDING' } },
    downloadReportExport: async (id) => { calls.download.push(id); if (downloadError) throw downloadError },
  }
  return { deps, calls, ...useReportExport(deps) }
}

test('导出任务立即 READY：不轮询，提示可下载，exportJob 持有任务，saving 复位', async () => {
  const h = harness()
  await h.exportInvoicedReceivables()
  assert.equal(h.calls.create, 1)
  assert.deepEqual(h.calls.poll, [])
  assert.deepEqual(h.exportJob.value, { id: 'JOB-1', status: 'READY' })
  assert.deepEqual(h.calls.notify, ['CSV 已生成，可下载。'])
  assert.equal(h.deps.saving.value, false)
})

test('账龄导出 PENDING 后每秒轮询直至 READY：按任务 id 查询，提示账龄文案', async () => {
  timers.length = 0
  const h = harness({ created: { id: 'JOB-2', status: 'PENDING' }, polls: [{ id: 'JOB-2', status: 'PENDING' }, { id: 'JOB-2', status: 'READY' }] })
  await h.exportAgingReceivables()
  assert.equal(h.calls.aging, 1)
  assert.deepEqual(h.calls.poll, ['JOB-2', 'JOB-2'])
  assert.deepEqual(timers, [1000, 1000])
  assert.equal(h.exportJob.value.status, 'READY')
  assert.deepEqual(h.calls.notify, ['账龄表已生成，可下载。'])
})

test('任务 FAILED：带服务端 error_message 的格式化提示，停止轮询', async () => {
  const h = harness({ created: { id: 'JOB-3', status: 'PENDING' }, polls: [{ id: 'JOB-3', status: 'FAILED', error_message: 'E_GEN' }] })
  await h.exportInvoicedReceivables()
  assert.equal(h.calls.poll.length, 1)
  assert.deepEqual(h.calls.notify, ['报表生成失败，请稍后重新发起；仍失败时请联系管理员。|E_GEN'])
  assert.equal(h.deps.saving.value, false)
})

test('30 次轮询仍未就绪：提示后台继续生成，不再继续轮询', async () => {
  const h = harness({ created: { id: 'JOB-4', status: 'PENDING' } })
  await h.exportInvoicedReceivables()
  assert.equal(h.calls.poll.length, 30)
  assert.deepEqual(h.calls.notify, ['导出仍在后台生成，可稍后继续查询并下载。'])
  assert.equal(h.deps.saving.value, false)
})

test('提交失败与"已提交但查询失败"区分提示；后者明确告诫勿重复提交', async () => {
  const notSubmitted = harness({ createError: Object.assign(new Error('x'), { code: 'E_SUBMIT' }) })
  await notSubmitted.exportInvoicedReceivables()
  assert.deepEqual(notSubmitted.calls.notify, ['导出任务提交失败，请稍后重试。|E_SUBMIT'])
  assert.equal(notSubmitted.exportJob.value, null)

  const submitted = harness({ created: { id: 'JOB-5', status: 'PENDING' }, pollError: Object.assign(new Error('x'), { code: 'E_POLL' }) })
  await submitted.exportInvoicedReceivables()
  assert.equal(submitted.calls.notify.length, 1)
  assert.match(submitted.calls.notify[0], /^导出任务已提交，但状态查询失败。请稍后查询当前任务，勿重复提交。fmt:E_POLL$/)
  assert.equal(submitted.exportJob.value.id, 'JOB-5', '已提交的任务保留供用户稍后查询')
  assert.equal(submitted.deps.saving.value, false)
})

test('进行中不重入：saving 为真时直接返回，不提交', async () => {
  const h = harness()
  h.deps.saving.value = true
  await h.exportInvoicedReceivables()
  await h.exportAgingReceivables()
  assert.equal(h.calls.create + h.calls.aging, 0)
  assert.equal(h.deps.saving.value, true)
})

test('downloadExport：按 id 下载；失败提示格式化文案', async () => {
  const ok = harness()
  await ok.downloadExport('JOB-1')
  assert.deepEqual(ok.calls.download, ['JOB-1'])
  assert.deepEqual(ok.calls.notify, [])
  const failed = harness({ downloadError: Object.assign(new Error('x'), { code: 'E_DL' }) })
  await failed.downloadExport('JOB-1')
  assert.deepEqual(failed.calls.notify, ['报表下载失败，请稍后重试。|E_DL'])
})
