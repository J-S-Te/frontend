import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify({ code: status === 200 ? 'OK' : 'ERROR', message: status === 200 ? 'success' : 'failed', data }), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

test('Portal capabilities use the session API and normalize fail-closed values', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })
  let call
  globalThis.fetch = async (url, options = {}) => {
    call = { url, options }
    return jsonResponse({
	  report_request_submission: { available: false, mode: 'UNAVAILABLE', reason_code: 'PORTAL_REPORT_DELIVERY_WORKER_UNAVAILABLE' },
	  project_export: { available: false, mode: 'UNAVAILABLE', reason_code: 'PORTAL_PROJECT_EXPORT_WORKER_UNAVAILABLE' },
      report_download: { available: false, mode: 'UNAVAILABLE', reason_code: 'REPORT_SECURITY_PROVIDERS_NOT_CONFIGURED', ignored: 'secret' },
      filing_material_upload: { available: true, mode: 'READY' },
      filing_export: { available: 1, mode: 'UNAVAILABLE' },
      filing_police_submission: { available: false, mode: 'CRM_MANUAL_REVIEW', reason_code: 'FILING_CRM_REVIEW_REQUIRED' },
    })
  }
  const api = await import(`./portal.js?capabilities=${Date.now()}`)
  const value = await api.getPortalCapabilities()
  assert.equal(call.url, '/customer-portal/api/v1/capabilities')
  assert.equal(call.options.credentials, 'include')
	assert.equal(value.report_request_submission.available, false)
	assert.equal(value.project_export.available, false)
  assert.deepEqual(value.report_download, { available: false, mode: 'UNAVAILABLE', reason_code: 'REPORT_SECURITY_PROVIDERS_NOT_CONFIGURED' })
  assert.deepEqual(value.filing_material_upload, { available: true, mode: 'READY', reason_code: '' })
  assert.equal(value.filing_export.available, false)
  assert.equal('ignored' in value.report_download, false)
})

test('Portal views load capabilities once and fail closed dependency-backed actions', async () => {
  const view = await readFile(new URL('../views/CustomerPortalView.vue', import.meta.url), 'utf8')
  const filing = await readFile(new URL('../components/FilingWizard.vue', import.meta.url), 'utf8')
  assert.match(view, /if \(!capabilitiesLoaded\)/)
  assert.match(view, /await getPortalCapabilities\(\)/)
  assert.match(view, /Keep dependency-backed actions closed/)
  assert.match(view, /!capabilityAvailable\('report_download'\)/)
	assert.match(view, /!capabilityAvailable\('report_request_submission'\)/)
	assert.match(view, /!capabilityAvailable\('project_export'\)/)
	assert.match(view, /:disabled="projectExportLoading \|\| !capabilityAvailable\('project_export'\)"/)
  assert.match(view, /:capabilities="capabilities"/)
  assert.match(filing, /!materialUploadAvailable/)
  assert.match(filing, /!filingExportAvailable/)
  assert.match(filing, /!policeSubmissionAvailable/)
  assert.match(filing, /正式公安提交契约尚未启用，不会显示为已向公安提交/)
})
