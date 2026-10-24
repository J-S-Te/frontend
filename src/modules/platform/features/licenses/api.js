import { createRequest } from '../../shared/api/request.js'

export const MAX_LICENSE_BYTES = 256 * 1024

export class LicenseError extends Error {
  constructor(message, options = {}) {
    super(message)
    this.name = 'LicenseError'
    this.status = options.status || 0
    this.code = options.code || ''
  }
}

const request = createRequest({ ErrorClass: LicenseError, networkMessage: '商业授权服务暂时无法连接，请重试。', failureMessage: '商业授权操作失败。', feature: 'licenses' })
export const getLicenseStatus = () => request('/licenses/status').then(data => ({ ...data.deployment, initialized: data.initialized, systems: data.systems, server_time: data.server_time, runtime_enforcement: data.runtime_enforcement, configured_environment: data.configured_environment }))
export const initializeLicense = (customerID, environment) => request('/licenses/initialize', { method: 'POST', body: JSON.stringify({ customer_id: customerID, environment }) })
export const getLicenseRequest = () => request('/licenses/request')
export const getLicenseEvents = (page = 1) => request(`/licenses/events?page=${page}&page_size=20`)

export function validateLicenseInput(raw) {
  if (!raw.trim()) throw new LicenseError('请选择或粘贴供应商签发的许可证。')
  if (new TextEncoder().encode(raw).length > MAX_LICENSE_BYTES) throw new LicenseError('许可证不能超过 256 KiB。')
  if (/-----BEGIN [^-]*PRIVATE KEY-----/.test(raw)) throw new LicenseError('此处仅接受签发后的许可证，不接受私钥。')
}

export function previewLicense(raw) {
  validateLicenseInput(raw)
  return request('/licenses/imports/preview', { method: 'POST', body: JSON.stringify({ raw_jws: raw }) })
}

export function commitLicense(raw, preview, confirmChanges, confirmReplacePending) {
  validateLicenseInput(raw)
  return request('/licenses/imports/commit', { method: 'POST', body: JSON.stringify({ raw_jws: raw, digest: preview.digest, expected_revision: preview.revision, expected_current_version: preview.current_version, expected_pending_digest: preview.pending_digest, confirm_changes: confirmChanges, confirm_replace_pending: confirmReplacePending }) })
}
