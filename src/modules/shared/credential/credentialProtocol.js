export const PROTOCOL = 'uip-credential/v1'
export const OAEP_LABEL = 'uip-credential-v1'
export const PURPOSES = Object.freeze({
  LOGIN: 'LOGIN',
  CHANGE_PASSWORD: 'CHANGE_PASSWORD',
  CREATE_ACCOUNT: 'CREATE_ACCOUNT',
  CREATE_EMPLOYEE: 'CREATE_EMPLOYEE',
  CREATE_EMPLOYEES_BATCH: 'CREATE_EMPLOYEES_BATCH',
  INITIALIZE_PASSWORD: 'INITIALIZE_PASSWORD',
  RESET_PASSWORD: 'RESET_PASSWORD',
})
export const CONTENT_TYPES = Object.freeze({
  JSON: 'application/json',
  MULTIPART: 'multipart/form-data',
})

export function assertNoCRLF(value, name) {
  if (String(value).includes('\r') || String(value).includes('\n')) {
    throw new CredentialProtocolError('CREDENTIAL_ENVELOPE_INVALID', `${name} 不能包含换行符。`)
  }
}

export function buildAAD({ direction, kid, challengeId, purpose, resourceId = '', contentType }) {
  for (const [name, value] of Object.entries({ direction, kid, challengeId, purpose, resourceId, contentType })) {
    assertNoCRLF(value ?? '', name)
  }
  return [PROTOCOL, direction, kid, challengeId, purpose, resourceId, contentType].join('\n')
}

export function bytesToBase64URL(bytes) {
  let binary = ''
  for (let index = 0; index < bytes.length; index += 1) binary += String.fromCharCode(bytes[index])
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

export function base64URLToBytes(value) {
  if (typeof value !== 'string' || !value || value.includes('=') || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new CredentialProtocolError('CREDENTIAL_ENVELOPE_INVALID', '凭据编码格式不正确。')
  }
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4)
  let binary
  try { binary = atob(padded) } catch { throw new CredentialProtocolError('CREDENTIAL_ENVELOPE_INVALID', '凭据编码格式不正确。') }
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

export function utf8ToBytes(value) { return new TextEncoder().encode(value) }
export function bytesToUtf8(value) { return new TextDecoder().decode(value) }

export class CredentialProtocolError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'CredentialProtocolError'
    this.code = code
  }
}
