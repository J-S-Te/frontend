import {
  OAEP_LABEL, PROTOCOL, buildAAD, base64URLToBytes, bytesToBase64URL, bytesToUtf8, utf8ToBytes,
  CredentialProtocolError,
} from './credentialProtocol.js'

let forgePromise = null
async function loadForge() {
  forgePromise ||= import('node-forge').then((module) => module.default || module)
  return forgePromise
}

function randomBytes(size) {
  if (!globalThis.crypto?.getRandomValues) {
    throw new CredentialProtocolError('CREDENTIAL_CRYPTO_UNAVAILABLE', '当前浏览器不支持安全随机数，已阻止提交。')
  }
  const bytes = new Uint8Array(size)
  globalThis.crypto.getRandomValues(bytes)
  return bytes
}

function requireValue(value, name) {
  if (!value) throw new CredentialProtocolError('CREDENTIAL_ENVELOPE_INVALID', `${name} 缺失。`)
}

function forgeBytes(bytes) {
  let binary = ''
  for (let index = 0; index < bytes.length; index += 8192) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 8192))
  }
  return binary
}

function toUint8(binary) {
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

async function aesEncrypt(key, iv, plaintext, aad) {
  const forge = await loadForge()
  const cipher = forge.cipher.createCipher('AES-GCM', forgeBytes(key))
  cipher.start({ iv: forgeBytes(iv), additionalData: forgeBytes(aad), tagLength: 128 })
  cipher.update(forge.util.createBuffer(forgeBytes(plaintext)))
  if (!cipher.finish()) throw new CredentialProtocolError('CREDENTIAL_ENCRYPTION_FAILED', '凭据加密失败。')
  return {
    ciphertext: toUint8(cipher.output.getBytes()),
    tag: toUint8(cipher.mode.tag.getBytes()),
  }
}

async function aesDecrypt(key, iv, ciphertext, tag, aad) {
  const forge = await loadForge()
  const decipher = forge.cipher.createDecipher('AES-GCM', forgeBytes(key))
  decipher.start({ iv: forgeBytes(iv), additionalData: forgeBytes(aad), tagLength: 128, tag: forge.util.createBuffer(forgeBytes(tag)) })
  decipher.update(forge.util.createBuffer(forgeBytes(ciphertext)))
  if (!decipher.finish()) throw new CredentialProtocolError('CREDENTIAL_DECRYPT_FAILED', '响应解密失败，请刷新后重试。')
  return toUint8(decipher.output.getBytes())
}

export async function encryptCredentialRequest({
  publicKeyPem, kid, challengeId, purpose, resourceId = '', contentType, plaintext,
}) {
  requireValue(publicKeyPem, 'public_key')
  requireValue(kid, 'kid')
  requireValue(challengeId, 'challenge_id')
  requireValue(contentType, 'content_type')
  const material = randomBytes(64)
  const requestKey = material.slice(0, 32)
  const responseKey = material.slice(32)
  const forge = await loadForge()
  const publicKey = forge.pki.publicKeyFromPem(publicKeyPem)
  const encryptedKey = publicKey.encrypt(forgeBytes(material), 'RSA-OAEP', {
    md: forge.md.sha256.create(), mgf1: { md: forge.md.sha256.create() }, label: OAEP_LABEL,
  })
  const iv = randomBytes(12)
  const aad = utf8ToBytes(buildAAD({ direction: 'request', kid, challengeId, purpose, resourceId, contentType }))
  const body = typeof plaintext === 'string' ? utf8ToBytes(plaintext) : plaintext
  const { ciphertext, tag } = await aesEncrypt(requestKey, iv, body, aad)
  return {
    responseKey,
    envelope: {
      protocol: PROTOCOL, kid, challenge_id: challengeId, purpose, resource_id: resourceId,
      content_type: contentType,
      encrypted_key: bytesToBase64URL(Uint8Array.from(encryptedKey, (character) => character.charCodeAt(0))),
      iv: bytesToBase64URL(iv), ciphertext: bytesToBase64URL(ciphertext), tag: bytesToBase64URL(tag),
    },
  }
}

export async function decryptCredentialResponse({ envelope, responseKey, kid, challengeId, purpose, resourceId = '' }) {
  if (!envelope || envelope.protocol !== PROTOCOL || envelope.kid !== kid || envelope.challenge_id !== challengeId ||
      envelope.purpose !== purpose || envelope.resource_id !== resourceId || envelope.content_type !== 'application/json') {
    throw new CredentialProtocolError('CREDENTIAL_DECRYPT_FAILED', '响应凭据封套校验失败，请刷新后重试。')
  }
  const iv = base64URLToBytes(envelope.iv)
  const ciphertext = base64URLToBytes(envelope.ciphertext)
  const tag = base64URLToBytes(envelope.tag)
  const aad = utf8ToBytes(buildAAD({ direction: 'response', kid, challengeId, purpose, resourceId, contentType: envelope.content_type }))
  const plaintext = await aesDecrypt(responseKey, iv, ciphertext, tag, aad)
  const text = bytesToUtf8(plaintext)
  try { return JSON.parse(text) } catch { throw new CredentialProtocolError('CREDENTIAL_DECRYPT_FAILED', '响应解密后格式无效。') }
}
