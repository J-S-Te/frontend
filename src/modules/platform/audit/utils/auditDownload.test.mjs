import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { AuditEventsError, downloadAuditExportFile } from '../api/auditEvents.js'

const originalFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = originalFetch })

const TICKET_PATH = '/api/v1/audit/export-jobs/fixture%2Fjob/download-tickets'
const DOWNLOAD_PATH = '/api/v1/audit/export-jobs/fixture%2Fjob/download'
const CSV = '操作,结果\n查询,通过\n'

function ticketResponse(ticket = 'ticket-fixture', status = 200) {
  return new Response(JSON.stringify({ code: status === 200 ? 'OK' : 'PLATFORM_AUDIT_EXPORT_TICKET_REQUIRED', message: 'ok', request_id: '', data: status === 200 ? { ticket, download_url: DOWNLOAD_PATH, expires_at: '2026-01-01T00:02:00Z' } : null }), { status, headers: { 'Content-Type': 'application/json' } })
}

function csvResponse(headers = {}) {
  return new Response(CSV, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': "attachment; filename*=UTF-8''%E5%AE%A1%E8%AE%A1.csv", ...headers } })
}

// 审计导出下载一次性票据：必须先 POST 申请票据，再用 X-Audit-Export-Ticket 头兑换文件。
test('audit CSV download issues a single-use ticket before fetching the file', async () => {
  const calls = []
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options })
    return calls.length === 1 ? ticketResponse('ticket-abc') : csvResponse()
  }

  const result = await downloadAuditExportFile('fixture/job')

  assert.equal(calls.length, 2, '下载必须先申请票据再取文件')
  assert.equal(calls[0].url, TICKET_PATH)
  assert.equal(calls[0].options.method, 'POST')
  assert.equal(calls[0].options.credentials, 'include')
  assert.equal(calls[0].options.cache, 'no-store')
  assert.equal(calls[1].url, DOWNLOAD_PATH)
  assert.equal(calls[1].options.credentials, 'include')
  assert.equal(calls[1].options.cache, 'no-store')
  assert.equal(calls[1].options.headers['X-Audit-Export-Ticket'], 'ticket-abc')
  assert.equal(result.filename, '审计.csv')
  assert.match(await result.blob.text(), /查询,通过/)
})

test('audit download reuses a preissued ticket without asking for a second one', async () => {
  const fileCalls = []
  globalThis.fetch = async (url, options) => { fileCalls.push({ url, options }); return new Response('header\n', { headers: { 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment; filename="../../export.exe"' } }) }

  const result = await downloadAuditExportFile('fixture/job', { ticket: 'ticket-preissued' })

  assert.equal(fileCalls.length, 1, '已有票据时不得重复签发')
  assert.equal(fileCalls[0].url, DOWNLOAD_PATH)
  assert.equal(fileCalls[0].options.headers['X-Audit-Export-Ticket'], 'ticket-preissued')
  // 非法文件名仍回退到安全默认名。
  assert.equal(result.filename, 'audit-export.csv')
})

test('audit download keeps denied status and diagnostics but does not expose a raw error page', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ code: 'FORBIDDEN', message: 'forbidden SQLSTATE private_value', request_id: 'fixture-request', details: { reason: 'fixture' } }), { status: 403, headers: { 'Content-Type': 'application/json' } })
  await assert.rejects(downloadAuditExportFile('fixture/job'), error => {
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
  await assert.rejects(downloadAuditExportFile('fixture/job'), error => error.status === 502 && /暂时/.test(error.message) && !/private|html/.test(error.message))
})

// 票据过期/无效由服务端给出 410/403：前端保留状态与错误码，交给页面提示重新申请。
test('audit download surfaces expired ticket as a retryable error', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ code: 'PLATFORM_AUDIT_EXPORT_TICKET_EXPIRED', message: '票据已过期', request_id: 'fixture-request' }), { status: 410, headers: { 'Content-Type': 'application/json' } })
  await assert.rejects(downloadAuditExportFile('fixture/job'), error => {
    assert.equal(error.status, 410)
    assert.equal(error.code, 'PLATFORM_AUDIT_EXPORT_TICKET_EXPIRED')
    return true
  })
  globalThis.fetch = async () => new Response(JSON.stringify({ code: 'PLATFORM_AUDIT_EXPORT_TICKET_INVALID', message: '票据无效' }), { status: 403, headers: { 'Content-Type': 'application/json' } })
  await assert.rejects(downloadAuditExportFile('fixture/job'), error => error.status === 403 && error.code === 'PLATFORM_AUDIT_EXPORT_TICKET_INVALID')
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
    // 传入票据时只验证文件兑换这一步；票据申请另有用例覆盖。
    await assert.rejects(downloadAuditExportFile('fixture', { ticket: 'ticket-fixture' }), error => /INVALID_DOWNLOAD_RESPONSE|NETWORK_ERROR/.test(error.code) && !/private|html/.test(error.message))
    assert.equal(calls, 1)
  }
})
