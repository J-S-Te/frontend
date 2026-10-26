import { PROTOCOL, PURPOSES, CredentialProtocolError } from './credentialProtocol.js'

const VALID_PURPOSES = new Set(Object.values(PURPOSES))

export async function fetchCredentialChallenge({ purpose, resourceId = '', fetchImpl = globalThis.fetch } = {}) {
  if (!VALID_PURPOSES.has(purpose)) {
    throw new CredentialProtocolError('CREDENTIAL_ENVELOPE_INVALID', '凭据用途无效。')
  }
  if (typeof fetchImpl !== 'function') throw new CredentialProtocolError('CREDENTIAL_CRYPTO_UNAVAILABLE', '当前环境无法获取加密参数。')
  const response = await fetchImpl('/api/v1/auth/credential-challenges', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ purpose, resource_id: resourceId }),
  })
  let payload = null
  try { payload = await response.json() } catch { /* normalized below */ }
  if (!response.ok) {
    throw new CredentialProtocolError(payload?.code || 'CREDENTIAL_ENVELOPE_INVALID', payload?.message || '无法获取凭据加密参数，请刷新页面后重试。')
  }
  const data = payload?.data
  if (!data || data.protocol !== PROTOCOL || !data.kid || !data.public_key || !data.challenge_id || data.purpose !== purpose) {
    throw new CredentialProtocolError('CREDENTIAL_CRYPTO_UNAVAILABLE', '凭据加密参数无效，已阻止提交。')
  }
  return data
}
