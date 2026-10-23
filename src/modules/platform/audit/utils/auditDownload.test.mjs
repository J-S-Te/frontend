import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { AuditEventsError, downloadAuditExportFile } from '../api/auditEvents.js'

const originalFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = originalFetch })

test('audit CSV download uses authenticated fetch and a safe filename instead of raw navigation', async () => {
  let calls = 0
  globalThis.fetch = async (url, options) => {
    calls++
    assert.equal(url, '/api/v1/audit/export-jobs/fixture%2Fjob/download')
    assert.equal(options.credentials, 'include')
    assert.equal(options.cache, 'no-store')
    return new Response('操作,结果\n查询,通过\n', { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': "attachment; filename*=UTF-8''%E5%AE%A1%E8%AE%A1.csv" } })
  }
  const result = await downloadAuditExportFile('fixture/job')
  assert.equal(result.filename, '审计.csv')
  assert.match(await result.blob.text(), /查询,通过/)
  assert.equal(calls, 1)
  globalThis.fetch = async () => new Response('header\n', { headers: { 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment; filename="../../export.exe"' } })
  assert.equal((await downloadAuditExportFile('fixture')).filename, 'audit-export.csv')
})

test('audit download keeps denied status and diagnostics but does not expose a raw error page', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ code: 'FORBIDDEN', message: 'forbidden SQLSTATE private_value', request_id: 'fixture-request', details: { reason: 'fixture' } }), { status: 403, headers: { 'Content-Type': 'application/json' } })
  await assert.rejects(downloadAuditExportFile('fixture'), error => {
    assert.ok(error instanceof AuditEventsError)
    assert.equal(error.code, 'FORBIDDEN')
    assert.equal(error.status, 403)
    assert.equal(error.requestID, 'fixture-request')
    assert.equal(error.details.reason, 'fixture')
    assert.match(error.message, /权限/)
    assert.doesNotMatch(error.message, /SQLSTATE|private_value/)
    return true
  })
  globalThis.fetch = async () => new Response('<html>upstream private</html>', { status: 502, headers: { 'Content-Type': 'text/html' } })
  await assert.rejects(downloadAuditExportFile('fixture'), error => error.status === 502 && /暂时/.test(error.message) && !/private|html/.test(error.message))
})

test('audit download rejects 200 HTML, error JSON, empty and interrupted files without automatic retry', async () => {
  for (const fixture of [
    () => new Response('<html>private</html>', { headers: { 'Content-Type': 'text/html' } }),
    () => new Response('{"code":"DENIED"}', { headers: { 'Content-Type': 'application/json' } }),
    () => new Response('', { headers: { 'Content-Type': 'text/csv' } }),
    () => ({ ok: true, status: 200, headers: new Headers({ 'Content-Type': 'text/csv' }), blob: async () => { throw new Error('private socket') } }),
  ]) {
    let calls = 0
    globalThis.fetch = async () => { calls++; return fixture() }
    await assert.rejects(downloadAuditExportFile('fixture'), error => /INVALID_DOWNLOAD_RESPONSE|NETWORK_ERROR/.test(error.code) && !/private|html/.test(error.message))
    assert.equal(calls, 1)
  }
})
