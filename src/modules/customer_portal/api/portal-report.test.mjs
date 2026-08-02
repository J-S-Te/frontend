import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

function jsonResponse(data, status = 200, code = 'OK') {
  return new Response(JSON.stringify({ code, message: status >= 400 ? 'request failed' : 'success', data }), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

test('Portal report API normalizes detail and orders the immutable timeline by sequence', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })
  let requestURL = ''
  globalThis.fetch = async (url) => {
    requestURL = url
    return jsonResponse({
      id: 7,
      request_no: 'RP-007',
      status: 'APPROVING',
      events: [
        { event_type: 'APPROVAL_STARTED', sequence: 2, from_status: 'SUBMITTED', to_status: 'APPROVING', occurred_at: '2026-08-01T02:00:00Z' },
        { event_type: 'REPORT_SUBMITTED', sequence: 1, to_status: 'SUBMITTED', occurred_at: '2026-08-01T01:00:00Z' },
      ],
    })
  }

  const api = await import(`./portal.js?report-detail-test=${Date.now()}`)
  const detail = await api.getReportRequest('7/unsafe')
  assert.equal(requestURL, '/customer-portal/api/v1/reports/7%2Funsafe')
  assert.equal(detail.request_no, 'RP-007')
  assert.deepEqual(detail.events.map((item) => item.sequence), [1, 2])
  assert.deepEqual(Object.keys(detail.events[0]).sort(), ['event_type', 'from_status', 'occurred_at', 'sequence', 'to_status'])
})

test('Portal report create accepts an explicit retry key and sends a canonical payload', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })
  let request
  globalThis.fetch = async (url, options) => {
    request = { url, options }
    return jsonResponse({ id: 9, status: 'SUBMITTED' }, 201)
  }

  const api = await import(`./portal.js?report-create-test=${Date.now()}`)
  const raw = { project_id: ' P-1 ', report_type: ' FINAL ', reason: ' 验收 ', receive_email: ' User@Example.COM ' }
  const fingerprint = api.reportRequestFingerprint(raw)
  await api.createReportRequest(raw, 'stable-retry-key')

  assert.equal(request.url, '/customer-portal/api/v1/reports')
  assert.equal(request.options.headers['Idempotency-Key'], 'stable-retry-key')
  assert.equal(request.options.headers['X-CSRF-Token'], '1')
  assert.deepEqual(JSON.parse(request.options.body), { project_id: 'P-1', report_type: 'FINAL', reason: '验收', receive_email: 'user@example.com' })
  assert.equal(fingerprint, api.reportRequestFingerprint({ project_id: 'P-1', report_type: 'FINAL', reason: '验收', receive_email: 'user@example.com' }))
  assert.notEqual(fingerprint, api.reportRequestFingerprint({ project_id: 'P-2', report_type: 'FINAL', reason: '验收', receive_email: 'user@example.com' }))
})

test('Portal report station messages use personal list, count and CSRF-protected read APIs', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })
  const calls = []
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url, options })
    if (url.endsWith('/unread-count')) return jsonResponse({ count: 2 })
    if (url.endsWith('/read')) return jsonResponse({ read: true })
    return jsonResponse({ items: [{ id: 3, request_id: 7, request_no: 'RP-7', kind: 'REPORT_ISSUED', status: 'UNREAD' }], page: 1, page_size: 20, total: 1 })
  }
  const api = await import(`./portal.js?report-notification-test=${Date.now()}`)
  const list = await api.listReportNotifications({ unread_only: true, page: 1, page_size: 20 })
  const count = await api.getReportNotificationUnreadCount()
  await api.readReportNotification(3)
  assert.equal(list.items[0].request_id, 7)
  assert.equal(count.count, 2)
  assert.equal(calls[0].url, '/customer-portal/api/v1/report-notifications?unread_only=true&page=1&page_size=20')
  assert.equal(calls[1].url, '/customer-portal/api/v1/report-notifications/unread-count')
  assert.equal(calls[2].url, '/customer-portal/api/v1/report-notifications/3/read')
  assert.equal(calls[2].options.method, 'POST')
  assert.equal(calls[2].options.headers['X-CSRF-Token'], '1')
})

test('Portal report risk alerts use the current account scoped endpoint only', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })
  let call
  globalThis.fetch = async (url, options = {}) => {
    call = { url, options }
    return jsonResponse({ items: [{ alert_id: 'risk-1', request_id: 7, request_no: 'RP-7', risk_code: 'MULTI_DEVICE', status: 'OPEN' }], page: 1, page_size: 20, total: 1 })
  }
  const api = await import(`./portal.js?report-risk-alert-test=${Date.now()}`)
  const result = await api.listReportRiskAlerts({ open_only: true, page: 1, page_size: 20 })
  assert.equal(call.url, '/customer-portal/api/v1/report-risk-alerts?open_only=true&page=1&page_size=20')
  assert.equal(call.options.method, undefined)
  assert.equal(result.items[0].risk_code, 'MULTI_DEVICE')
  assert.equal('account_id' in result.items[0], false)
})

test('Portal report download keeps the grant token out of URLs, bodies and returned view state', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })
  const calls = []
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options })
    if (url.endsWith('/download-grants')) {
      return jsonResponse({ grant_id: 'grant-1', status: 'ACTIVE', expires_at: '2026-08-04T00:00:00Z', download_token: 'secret-download-token-value-at-least-32-characters' }, 201)
    }
    return new Response(new Blob(['%PDF-safe']), {
      status: 200,
      headers: { 'content-type': 'application/pdf', 'content-disposition': "attachment; filename*=UTF-8''final%20report.pdf" },
    })
  }

  const api = await import(`./portal.js?report-download-test=${Date.now()}`)
  const result = await api.downloadIssuedReport('7/unsafe', { idempotencyKey: 'fresh-click-key' })

  assert.equal(calls.length, 2)
  assert.equal(calls[0].url, '/customer-portal/api/v1/reports/7%2Funsafe/download-grants')
  assert.equal(calls[0].options.headers['Idempotency-Key'], 'fresh-click-key')
  assert.equal(calls[0].options.headers['X-CSRF-Token'], '1')
  assert.equal(calls[1].url, '/customer-portal/api/v1/reports/7%2Funsafe/downloads')
  assert.equal(calls[1].options.headers['X-Report-Download-Token'], 'secret-download-token-value-at-least-32-characters')
  assert.equal(calls[1].options.headers.Authorization, undefined)
  assert.equal(calls[1].options.body, undefined)
  assert.doesNotMatch(calls[1].url, /secret-download-token/)
  assert.equal(result.filename, 'final report.pdf')
  assert.equal(result.expires_at, '2026-08-04T00:00:00Z')
  assert.equal(result.blob.type, 'application/pdf')
  assert.deepEqual(Object.keys(result).sort(), ['blob', 'expires_at', 'filename'])
})

test('Portal report download rejects disguised files and preserves structured dependency errors', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })
  let phase = 'disguised'
  globalThis.fetch = async (url) => {
    if (url.endsWith('/download-grants')) return jsonResponse({ download_token: 'another-secret-download-token-value-123456', expires_at: '2026-08-04T00:00:00Z' }, 201)
    if (phase === 'disguised') return new Response('<html>not pdf</html>', { status: 200, headers: { 'content-type': 'text/html', 'content-disposition': 'attachment; filename=evil.pdf' } })
    return jsonResponse(null, 503, 'PORTAL_REPORT_DOWNLOAD_UNAVAILABLE')
  }

  const api = await import(`./portal.js?report-download-error-test=${Date.now()}`)
  await assert.rejects(api.downloadIssuedReport(8, { idempotencyKey: 'click-1' }), (error) => error.code === 'PORTAL_REPORT_DOWNLOAD_CONTENT_TYPE_INVALID')
  phase = 'unavailable'
  await assert.rejects(api.downloadIssuedReport(8, { idempotencyKey: 'click-2' }), (error) => error.status === 503 && error.code === 'PORTAL_REPORT_DOWNLOAD_UNAVAILABLE')
})

test('Portal report view gates read/request/download independently and cancels stale downloads', async () => {
  const view = await readFile(new URL('../views/CustomerPortalView.vue', import.meta.url), 'utf8')
  assert.match(view, /hasPermission\('report\.read'\) \|\| hasPermission\('report\.request'\)/)
  assert.match(view, /v-if="hasPermission\('report\.request'\)"/)
  assert.match(view, /v-if="!hasPermission\('report\.read'\)"/)
  assert.match(view, /v-else-if="section === 'reports'" class="portal-empty">当前账号没有报告读取或申请权限/)
  assert.match(view, /listProjects\(\{ page: 1, page_size: 100 \}\)/)
  assert.match(view, /getReportRequest\(item\.id\)/)
  assert.match(view, /item\.event_type/)
  assert.match(view, /item\.sequence/)
  assert.match(view, /item\.from_status/)
  assert.match(view, /item\.to_status/)
  assert.match(view, /item\.occurred_at/)
  assert.match(view, /reportLoadGeneration/)
  assert.match(view, /reportDetailGeneration/)
  assert.match(view, /fingerprint !== reportRetryFingerprint/)
  assert.match(view, /提交发生冲突/)
  assert.match(view, /selectedReport\.status !== 'ISSUED'/)
  assert.match(view, /!hasPermission\('report\.download'\)/)
  assert.match(view, /downloadIssuedReport\(reportID, \{ idempotencyKey: createIdempotencyKey\(\), signal: controller\.signal \}\)/)
  assert.match(view, /reportDownloadGeneration/)
  assert.match(view, /reportDownloadController\?\.abort\(\)/)
	assert.match(view, /listReportNotifications/)
	assert.match(view, /getReportNotificationUnreadCount/)
	assert.match(view, /readReportNotification/)
  assert.match(view, /listReportRiskAlerts/)
  assert.match(view, /下载安全提醒/)
  assert.match(view, /reportDownloadLoading/)
  assert.match(view, /URL\.revokeObjectURL\(objectURL\)/)
  assert.match(view, /PORTAL_REPORT_GRANT_FROZEN/)
  assert.match(view, /PORTAL_REPORT_LINK_EXPIRED/)
  assert.match(view, /PORTAL_REPORT_DOWNLOAD_UNAVAILABLE/)
  assert.doesNotMatch(view, /download_token|X-Report-Download-Token/)
})

test('Portal report download source does not persist or disclose the plaintext credential', async () => {
  const api = await readFile(new URL('./portal.js', import.meta.url), 'utf8')
  const downloadSource = api.slice(api.indexOf('export async function downloadIssuedReport'), api.indexOf('export const getAccountSecurity'))
  assert.match(downloadSource, /'X-Report-Download-Token': downloadToken/)
  assert.doesNotMatch(downloadSource, /Authorization/)
  assert.doesNotMatch(downloadSource, /localStorage|sessionStorage|console\.|window\.location|download_url/)
  assert.doesNotMatch(downloadSource, /body:\s*JSON\.stringify\([^)]*downloadToken/)
})
