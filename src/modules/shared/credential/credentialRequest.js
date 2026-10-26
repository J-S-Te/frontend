import { CredentialProtocolError } from './credentialProtocol.js'
import { fetchCredentialChallenge } from './credentialChallenge.js'
import { decryptCredentialResponse, encryptCredentialRequest } from './credentialCrypto.js'

function responseBody(payload) {
  if (payload?.credential_envelope) return payload.credential_envelope
  return null
}

async function submitEncrypted({ url, purpose, resourceId, challenge, plaintext, contentType, headers, fetchImpl, responseKey }) {
  const requestBody = JSON.stringify({ credential_envelope: challenge.envelope })
  let response
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      credentials: 'include',
      headers: { ...headers, Accept: 'application/json', 'Content-Type': 'application/json' },
      body: requestBody,
    })
  } catch (error) {
    throw new CredentialProtocolError('CREDENTIAL_RESPONSE_UNCONFIRMED', '无法确认操作结果，请先核对业务状态，勿自动重复提交。')
  }
  let payload = null
  try { payload = await response.json() } catch { /* handled below */ }
  const envelope = responseBody(payload)
  if (!envelope) {
    // Protocol/auth/permission rejections may be plaintext by contract; never
    // treat a missing envelope on a successful response as a plaintext fallback.
    if (response.ok) throw new CredentialProtocolError('CREDENTIAL_RESPONSE_ENCRYPTION_FAILED', '服务端未返回加密结果，请核对业务状态后重试。')
    throw new CredentialProtocolError(payload?.code || 'CREDENTIAL_ENVELOPE_INVALID', payload?.message || '凭据请求被拒绝。')
  }
  const body = await decryptCredentialResponse({
    envelope, responseKey, kid: challenge.kid, challengeId: challenge.challenge_id,
    purpose, resourceId,
  })
  if (!response.ok) {
    const error = new CredentialProtocolError(body?.code || 'CREDENTIAL_ENVELOPE_INVALID', body?.message || '凭据请求被拒绝。')
    error.status = response.status
    error.details = body?.details ?? null
    throw error
  }
  return { body, status: response.status, headers: response.headers }
}

export async function postCredentialJSON({ url, purpose, resourceId = '', body, headers = {}, fetchImpl = globalThis.fetch } = {}) {
  const challenge = await fetchCredentialChallenge({ purpose, resourceId, fetchImpl })
  const encrypted = await encryptCredentialRequest({
    publicKeyPem: challenge.public_key, kid: challenge.kid, challengeId: challenge.challenge_id,
    purpose, resourceId, contentType: 'application/json', plaintext: JSON.stringify(body),
  })
  return submitEncrypted({
    url, purpose, resourceId, headers, fetchImpl, responseKey: encrypted.responseKey,
    challenge: { ...challenge, envelope: encrypted.envelope }, plaintext: null, contentType: 'application/json',
  })
}

export async function postCredentialFormData({ url, purpose, resourceId = '', formData, headers = {}, fetchImpl = globalThis.fetch } = {}) {
  if (typeof Request === 'undefined') throw new CredentialProtocolError('CREDENTIAL_CRYPTO_UNAVAILABLE', '当前浏览器无法序列化上传内容。')
  const request = new Request('http://credential.invalid/', { method: 'POST', body: formData })
  const contentType = request.headers.get('content-type') || ''
  if (!contentType.startsWith('multipart/form-data; boundary=')) {
    throw new CredentialProtocolError('CREDENTIAL_ENVELOPE_INVALID', '批量导入内容类型无效。')
  }
  const plaintext = new Uint8Array(await request.arrayBuffer())
  const challenge = await fetchCredentialChallenge({ purpose, resourceId, fetchImpl })
  const encrypted = await encryptCredentialRequest({
    publicKeyPem: challenge.public_key, kid: challenge.kid, challengeId: challenge.challenge_id,
    purpose, resourceId, contentType, plaintext,
  })
  return submitEncrypted({
    url, purpose, resourceId, headers, fetchImpl, responseKey: encrypted.responseKey,
    challenge: { ...challenge, envelope: encrypted.envelope }, plaintext: null, contentType,
  })
}
