import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { readFileSync } from 'node:fs'
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc'
import { MAX_LICENSE_BYTES, commitLicense, getLicenseEvents, getLicenseRequest, getLicenseStatus, initializeLicense, previewLicense, validateLicenseInput } from './api.js'
import { licenseRows, previewCanCommit, riskyChange, statusRows } from './presentation.js'

const originalFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = originalFetch })
function respond(data, status = 200) {
  return { ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => ({ data, message: '授权状态冲突' }) }
}
test('all license requests use shared authenticated no-store transport and exact contract', async () => {
  const requests = []
  globalThis.fetch = async (url, options) => { requests.push({ url, options }); return respond({ deployment: { revision: 3 }, initialized: true, systems: [], server_time: 'now', runtime_enforcement: 'NOT_CONNECTED', configured_environment: 'production' }) }
  assert.deepEqual(await getLicenseStatus(), { revision: 3, initialized: true, systems: [], server_time: 'now', runtime_enforcement: 'NOT_CONNECTED', configured_environment: 'production' })
  await initializeLicense('customer-a', 'production')
  await getLicenseRequest()
  await previewLicense('signed.token.value')
  await commitLicense('signed.token.value', { digest: 'digest', revision: 3, current_version: 2, pending_digest: 'pending' }, true, false)
  await getLicenseEvents(2)
  assert.deepEqual(requests.map(item => item.url), ['/api/v1/licenses/status', '/api/v1/licenses/initialize', '/api/v1/licenses/request', '/api/v1/licenses/imports/preview', '/api/v1/licenses/imports/commit', '/api/v1/licenses/events?page=2&page_size=20'])
  for (const { options } of requests) { assert.equal(options.credentials, 'include'); assert.equal(options.cache, 'no-store') }
  assert.deepEqual(JSON.parse(requests[1].options.body), { customer_id: 'customer-a', environment: 'production' })
  assert.deepEqual(JSON.parse(requests[4].options.body), { raw_jws: 'signed.token.value', digest: 'digest', expected_revision: 3, expected_current_version: 2, expected_pending_digest: 'pending', confirm_changes: true, confirm_replace_pending: false })
})
test('input validation bounds UTF-8 byte size and rejects private keys without requesting', () => {
  assert.throws(() => validateLicenseInput(' '), /请选择/)
  assert.throws(() => validateLicenseInput('-----BEGIN PRIVATE KEY-----'), /私钥/)
  assert.throws(() => validateLicenseInput('界'.repeat(MAX_LICENSE_BYTES / 3 + 1)), /256 KiB/)
  assert.doesNotThrow(() => validateLicenseInput('a'.repeat(MAX_LICENSE_BYTES)))
})
test('six system rows retain unpurchased systems and exclusive expiry boundaries', () => {
  const rows = licenseRows({ not_before: 50, applications: [{ code: 'settlement', not_before: 80, expires_at: 100, kind: 'FULL' }, { code: 'data_analysis', not_before: 120, expires_at: 150, kind: 'TRIAL' }] }, 100)
  assert.equal(rows.length, 6)
  assert.equal(rows.find(row => row.code === 'settlement').state, '已到期')
  assert.equal(rows.find(row => row.code === 'data_analysis').state, '尚未生效')
  assert.equal(rows.find(row => row.code === 'project_management').state, '未购买')
})
test('display uses authoritative server statuses, including clock and integrity failures', () => {
  const rows = statusRows({ systems: [{ code: 'settlement', status: 'CLOCK_ABNORMAL', kind: 'FULL', expires_at: 100 }, { code: 'customer_portal', status: 'VALIDATION_ERROR' }] })
  assert.equal(rows.length, 6)
  assert.equal(rows.find(row => row.code === 'settlement').state, '时钟异常')
  assert.equal(rows.find(row => row.code === 'customer_portal').state, '校验异常')
})
test('removed, shortened, delayed and downgraded grants require explicit confirmation', () => {
  for (const change of [{ kind: 'REMOVED' }, { kind: 'UPDATED', old: { expires_at: 100 }, new: { expires_at: 90 } }, { kind: 'UPDATED', old: { not_before: 20 }, new: { not_before: 30 } }, { kind: 'UPDATED', old: { kind: 'FULL' }, new: { kind: 'TRIAL' } }]) {
    assert.equal(riskyChange(change), true)
    assert.equal(previewCanCommit({ changes: [change] }, false, true), false)
    assert.equal(previewCanCommit({ changes: [change] }, true, true), true)
  }
  assert.equal(previewCanCommit(null, true, true), false)
  assert.equal(previewCanCommit({ requires_pending_replacement: true }, true, false), false)
})
test('transport preserves conflict status for invalidating stale preview', async () => {
  globalThis.fetch = async () => respond({}, 409)
  await assert.rejects(getLicenseStatus(), error => error.status === 409)
})
test('commercial authorization Vue view compiles with actual script bindings', () => {
  const filename = new URL('./CommercialLicenseView.vue', import.meta.url)
  const source = readFileSync(filename, 'utf8')
  const { descriptor, errors } = parse(source, { filename: filename.pathname })
  assert.deepEqual(errors, [])
  const script = compileScript(descriptor, { id: 'license-view' })
  const template = compileTemplate({ source: descriptor.template.content, filename: filename.pathname, id: 'license-view', compilerOptions: { bindingMetadata: script.bindings } })
  assert.deepEqual(template.errors, [])
})
test('valid license never claims business activation or disconnected implementation', () => {
  const source = readFileSync(new URL('./CommercialLicenseView.vue', import.meta.url), 'utf8')
  assert.match(source, /不代表业务系统已开放/)
  assert.match(source, /运行时登记与执行确认状态为准/)
  assert.doesNotMatch(source, /业务系统的运行时授权检查尚未接入/)
})
