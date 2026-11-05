import assert from 'node:assert/strict'
import test from 'node:test'

/** success 构造合成HTTP传输回执，不代表外部业务验收。
 * 参数：data为精确测试载荷。
 * 返回值：JSON成功响应。
 */
function success(data) { return new Response(JSON.stringify({ code: 'OK', data }), { headers: { 'Content-Type': 'application/json' } }) }

test('local management multipart preserves CSRF, credentials and browser boundary', async (t) => {
  const old = globalThis.fetch
  t.after(() => { globalThis.fetch = old })
  const calls = []
  globalThis.fetch = async (url, options) => { calls.push({ url, options }); return success({ operation: { operation_no: 'a'.repeat(32), customer_id: 7, kind: 'REPORT', status: 'COMPLETED', stage: 'INGEST_QUEUED' }, report_source: { namespace: 'portal-local', customer_id: 7, operation_no: 'a'.repeat(32), request_id: 9 }, report_request: { request_id: 9, status: 'INGEST_PENDING' } }) }
  const api = await import('./localIdentity.js')
  const file = new File(['%PDF-fixture'], 'original.pdf', { type: 'application/pdf' })
  const result = await api.createLocalReport({ customer_id: 7, project_id: 'P-7', account_id: 'subject' }, file, 'same-key')
  assert.equal(calls[0].url, '/customer-portal/api/v1/local-admin/reports')
  assert.equal(calls[0].options.credentials, 'include')
  assert.equal(calls[0].options.headers['X-CSRF-Token'], '1')
  assert.equal(calls[0].options.headers['Idempotency-Key'], 'same-key')
  assert.equal(calls[0].options.headers['Content-Type'], undefined)
  assert.equal(JSON.parse(calls[0].options.body.get('metadata')).namespace, 'portal-local')
  assert.equal(result.report_request.status, 'INGEST_PENDING')
  await assert.rejects(api.retryLocalReportFile('operation/unsafe', file), (error) => error.code === 'PORTAL_RESPONSE_INVALID')
  assert.equal(calls[1].url, '/customer-portal/api/v1/local-admin/operations/operation%2Funsafe/report-file')
  assert.equal(calls[1].options.body.has('metadata'), false)
})

test('local exact retry preserves unknown receipt as failure and carries durable operation error', async (t) => {
  const old = globalThis.fetch
  t.after(() => { globalThis.fetch = old })
  const api = await import('./localIdentity.js')
  globalThis.fetch = async () => new Response('broken', { status: 200, headers: { 'Content-Type': 'application/json' } })
  await assert.rejects(api.retryLocalOperation('operation'), (error) => error.code === 'PORTAL_RESPONSE_INVALID')
  globalThis.fetch = async () => new Response(JSON.stringify({ code: 'PORTAL_LOCAL_UNAVAILABLE', message: '待核实', details: { operation: { operation_no: 'original', stage: 'IDENTITY_READY' } } }), { status: 503, headers: { 'Content-Type': 'application/json' } })
  await assert.rejects(api.retryLocalOperation('original'), (error) => error.status === 503 && error.details.operation.operation_no === 'original')
  assert.throws(() => api.localPDF(new File(['x'], 'x.html')), /PDF/)
})


test('local known-HTTP200 receipt still requires complete exact operation and source', async () => {
  const api = await import('./localIdentity.js')
  const valid = { operation: { operation_no: 'b'.repeat(32), customer_id: 7, kind: 'REPORT', status: 'COMPLETED', stage: 'INGEST_QUEUED' }, report_source: { namespace: 'portal-local', customer_id: 7, operation_no: 'b'.repeat(32), request_id: 9 }, report_request: { request_id: 9, status: 'INGEST_PENDING' } }
  assert.equal(api.localOperationResponse(valid).report_request.status, 'INGEST_PENDING')
  for (const broken of [{}, { ...valid, operation: { ...valid.operation, status: 'UNKNOWN' } }, { ...valid, report_source: { ...valid.report_source, namespace: 'crm' } }, { ...valid, report_request: { ...valid.report_request, request_id: 10 } }]) assert.throws(() => api.localOperationResponse(broken), (error) => error.code === 'PORTAL_RESPONSE_INVALID')
})


test('portal directory metadata only enables exact local mode', async (t) => {
  const previous = globalThis.fetch
  t.after(() => { globalThis.fetch = previous })
  const api = await import('./portal.js')
  for (const mode of [undefined, 'crm', 'local', 'LOCAL', 'mixed', true]) {
    globalThis.fetch = async () => success({ customer_directory_mode: mode })
    assert.equal((await api.getPortalCapabilities()).customer_directory_mode, mode === 'local' ? 'local' : 'crm')
  }
})
