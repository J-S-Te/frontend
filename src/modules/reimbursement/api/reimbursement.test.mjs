import test from 'node:test'
import assert from 'node:assert/strict'

// 用途：读取报销客户端，缺实现时明确失败。
// 参数：无。
// 返回值：客户端导出；缺文件时测试失败。
async function tools() { return import('./client.js') }

test('金额用十进制字符串和BigInt保留超大整数精度，拒绝小数分及负数', async () => {
  const { toMinor, formatMinor, validateItems } = await tools()
  assert.equal(toMinor('90071992547409.93'), '9007199254740993')
  assert.equal(formatMinor('9007199254740993'), '90071992547409.93')
  for (const value of ['1.001', '-1', '1e3', 'NaN']) assert.throws(() => toMinor(value))
  assert.throws(() => validateItems([{ requested_minor: '101', allocations: [{ amount_minor: '100' }], invoice_usages: [] }]), /分摊/)
})

test('网络未知结果重试先查原命令，不生成新command_id；已完成直接返回', async () => {
  const { createClient, createCommandRunner } = await tools()
  const calls = []
  const client = createClient({ fetcher: async (url, options) => {
    calls.push([url, options])
    if (calls.length === 1) throw new Error('connection lost')
    return new Response(JSON.stringify({ data: { id: 'payment-1' } }), { headers: { 'content-type': 'application/json' } })
  } })
  const runner = createCommandRunner(client, () => 'cmd-1')
  await assert.rejects(runner.execute('payment', '/claims/c/payments', { expected_version: 1, amount_minor: '100' }), { outcomeUnknown: true })
  assert.equal(runner.pending().command_id, 'cmd-1')
  assert.deepEqual(await runner.execute('payment', '/claims/c/payments', { expected_version: 1, amount_minor: '100' }), { id: 'payment-1' })
  assert.match(calls[1][0], /\/commands\/cmd-1$/)
  assert.equal(calls.length, 2)
})

test('结果未知时阻止修改内容或另起命令；查询404后仅可原命令原内容重试', async () => {
  const { createClient, createCommandRunner } = await tools()
  const calls = []
  const client = createClient({ fetcher: async (url, options) => {
    calls.push([url, options])
    if (calls.length === 1) throw new Error('offline')
    if (url.includes('/commands/')) return new Response(JSON.stringify({ code: 'RESOURCE_NOT_FOUND', message: '未提交' }), { status: 404 })
    return new Response(JSON.stringify({ data: { id: 'c' } }), { headers: { 'content-type': 'application/json' } })
  } })
  const runner = createCommandRunner(client, () => 'same')
  await assert.rejects(runner.execute('save', '/claims', { title: 'a' }))
  await assert.rejects(runner.execute('save', '/claims', { title: 'b' }), /原命令/)
  await runner.execute('save', '/claims', { title: 'a' })
  assert.equal(JSON.parse(calls[2][1].body).command_id, 'same')
})

test('HTML成功响应不能冒充写成功；403/409/422/503保留语义与request_id', async () => {
  const { createClient } = await tools()
  const broken = createClient({ fetcher: async () => new Response('<html>gateway</html>') })
  await assert.rejects(broken.request('/claims', { method: 'POST', body: '{}' }), { outcomeUnknown: true })
  for (const status of [401, 403, 409, 422, 503]) {
    const client = createClient({ fetcher: async () => new Response(JSON.stringify({ code: 'TEST', message: '操作被拒绝', request_id: 'req' }), { status }) })
    await assert.rejects(client.request('/claims'), { status, code: 'TEST', requestID: 'req' })
  }
})

test('空写入回执必须保留未知结果，不能解除重复付款保护', async () => {
  const { createClient, createCommandRunner } = await tools()
  const client = createClient({ fetcher: async () => new Response(JSON.stringify({ data: {} })) })
  const runner = createCommandRunner(client, () => 'empty-result')
  await assert.rejects(runner.execute('payment.record', '/claims/c/payments', { amount_minor: '100' }), { outcomeUnknown: true })
  assert.equal(runner.pending().command_id, 'empty-result')
})

test('显式重试使用保存的原内容，不读取被编辑的表单', async () => {
  const { createClient, createCommandRunner } = await tools()
  const calls = []
  const client = createClient({ fetcher: async (url, options) => {
    calls.push([url, options])
    if (calls.length === 1) throw new Error('offline')
    if (url.includes('/commands/')) return new Response(JSON.stringify({ code: 'RESOURCE_NOT_FOUND' }), { status: 404 })
    return new Response(JSON.stringify({ data: { id: 'paid' } }))
  } })
  const runner = createCommandRunner(client, () => 'original')
  const form = { amount_minor: '100', transaction_no: 'first' }
  await assert.rejects(runner.execute('payment.record', '/claims/c/payments', form))
  form.transaction_no = 'edited'
  await runner.retry()
  assert.equal(JSON.parse(calls[2][1].body).transaction_no, 'first')
  assert.equal(JSON.parse(calls[2][1].body).command_id, 'original')
})

test('原命令查询空结果仍保留未知状态', async () => {
  const { createClient, createCommandRunner } = await tools()
  let count = 0
  const runner = createCommandRunner(createClient({ fetcher: async () => {
    if (!count++) throw new Error('offline')
    return new Response(JSON.stringify({ data: {} }))
  } }), () => 'unresolved')
  await assert.rejects(runner.execute('claim.create', '/claims', { title: 'a' }))
  await assert.rejects(runner.resolve(), { outcomeUnknown: true })
  assert.equal(runner.pending().command_id, 'unresolved')
})
