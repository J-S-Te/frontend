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
// 顶层运行执行聚合字段（runtime_enforcement / runtime_enforcement_source）原样透传，
// systems[] 也原样保留 reason_code 与 enforcement：页面自己对缺失字段做“未知”处理。
export const getLicenseStatus = () => request('/licenses/status').then(data => ({ ...data.deployment, initialized: data.initialized, systems: data.systems, server_time: data.server_time, runtime_enforcement: data.runtime_enforcement, runtime_enforcement_source: data.runtime_enforcement_source, configured_environment: data.configured_environment }))
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

// 恢复凭据与许可证同属供应商签发的 compact JWS，使用同一份输入边界校验：
// 不写本地存储、不拼进 URL、不落日志，只在这一次请求体里出现。
export function restoreLicenseClock(rawJWS) {
  const raw = typeof rawJWS === 'string' ? rawJWS.trim() : ''
  if (!raw) throw new LicenseError('请粘贴供应商签发的时间恢复凭据。')
  if (new TextEncoder().encode(raw).length > MAX_LICENSE_BYTES) throw new LicenseError('时间恢复凭据不能超过 256 KiB。')
  if (/-----BEGIN [^-]*PRIVATE KEY-----/.test(raw)) throw new LicenseError('此处仅接受时间恢复凭据，不接受私钥。')
  return request('/licenses/clock-recoveries', { method: 'POST', body: JSON.stringify({ raw_jws: raw }) })
}

export function commitLicense(raw, preview, confirmChanges, confirmReplacePending) {
  validateLicenseInput(raw)
  return request('/licenses/imports/commit', { method: 'POST', body: JSON.stringify({ raw_jws: raw, digest: preview.digest, expected_revision: preview.revision, expected_current_version: preview.current_version, expected_pending_digest: preview.pending_digest, confirm_changes: confirmChanges, confirm_replace_pending: confirmReplacePending }) })
}
