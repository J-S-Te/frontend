import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify({ data }), { status, headers: { 'content-type': 'application/json' } })
}

test('project export keeps opaque ids encoded and token only in dedicated header', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })
  const requests = []
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url, options })
    if (url.endsWith('/download-grants')) return jsonResponse({ download_token: 'secret-token' }, 201)
    if (url.endsWith('/downloads')) return new Response(new Blob(['%PDF-1.7'], { type: 'application/pdf' }), { status: 200, headers: { 'content-type': 'application/pdf', 'content-disposition': 'attachment; filename=project.pdf' } })
    return jsonResponse({ export_id: 'export-1', status: 'PENDING' }, 201)
  }
  const api = await import(`./portal.js?project-export=${Date.now()}`)
  await api.createProjectExport('P/1', 'idem')
  await api.downloadProjectExport('export-1')
  assert.equal(requests[0].url, '/customer-portal/api/v1/projects/P%2F1/exports')
  assert.equal(requests[0].options.headers['Idempotency-Key'], 'idem')
  assert.equal(requests[2].options.headers['X-Project-Export-Download-Token'], 'secret-token')
  assert.doesNotMatch(requests[2].url, /secret-token/)
  assert.equal(requests[2].options.body, undefined)
})

test('project export UI is permission-gated and exposes loading/error states', async () => {
  const view = await readFile(new URL('../views/CustomerPortalView.vue', import.meta.url), 'utf8')
  assert.match(view, /hasPermission\('project\.export'\)/)
  assert.match(view, /@click="exportProjectPDF"/)
  assert.match(view, /projectExportLoading/)
  assert.match(view, /projectExportError/)
  assert.match(view, /projectExportJobs\.get\(projectId\)/)
  assert.match(view, /projectExportJobs\.set\(projectId, job\)/)
  assert.match(view, /projectExportRetryKeys\.get\(projectId\)/)
  assert.match(view, /projectExportController\?\.abort\(\)/)
  assert.match(view, /manager_message_available/)
  assert.match(view, /站内联系项目经理/)
})
