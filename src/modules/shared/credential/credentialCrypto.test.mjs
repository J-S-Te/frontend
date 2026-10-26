import assert from 'node:assert/strict'
import test from 'node:test'
import { generateKeyPairSync, privateDecrypt, constants, createDecipheriv, createCipheriv, randomBytes } from 'node:crypto'
import { encryptCredentialRequest, decryptCredentialResponse } from './credentialCrypto.js'
import { PROTOCOL, OAEP_LABEL, buildAAD, bytesToBase64URL, base64URLToBytes } from './credentialProtocol.js'

function keypair() {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  return { publicPem: publicKey.export({ type: 'spki', format: 'pem' }), privateKey }
}

test('frontend RSA-OAEP + AES-GCM request decrypts with backend-equivalent crypto', async () => {
  const { publicPem, privateKey } = keypair()
  const plaintext = JSON.stringify({ account: '中文账号', password: 'p@ss-口令' })
  const result = await encryptCredentialRequest({
    publicKeyPem: publicPem, kid: 'kid-1', challengeId: 'challenge-1', purpose: 'LOGIN',
    resourceId: '', contentType: 'application/json', plaintext,
  })
  const encryptedKey = base64URLToBytes(result.envelope.encrypted_key)
  const material = privateDecrypt({ key: privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256', oaepLabel: Buffer.from(OAEP_LABEL) }, encryptedKey)
  assert.equal(material.length, 64)
  assert.equal(result.envelope.protocol, PROTOCOL)
  const reqKey = material.subarray(0, 32)
  const respKey = material.subarray(32)
  assert.deepEqual(Buffer.from(result.responseKey), respKey)
  const aad = buildAAD({ direction: 'request', kid: 'kid-1', challengeId: 'challenge-1', purpose: 'LOGIN', resourceId: '', contentType: 'application/json' })
  const decipher = createDecipheriv('aes-256-gcm', reqKey, base64URLToBytes(result.envelope.iv))
  decipher.setAAD(Buffer.from(aad))
  decipher.setAuthTag(base64URLToBytes(result.envelope.tag))
  const decrypted = Buffer.concat([decipher.update(base64URLToBytes(result.envelope.ciphertext)), decipher.final()]).toString('utf8')
  assert.equal(decrypted, plaintext)
})

test('frontend decrypts backend response envelope and rejects tampering', async () => {
  const key = randomBytes(32)
  const iv = randomBytes(12)
  const plaintext = JSON.stringify({ code: 'OK', data: { must_change_password: false } })
  const aad = buildAAD({ direction: 'response', kid: 'kid-1', challengeId: 'challenge-1', purpose: 'LOGIN', resourceId: '', contentType: 'application/json' })
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(Buffer.from(aad))
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const envelope = {
    protocol: PROTOCOL, kid: 'kid-1', challenge_id: 'challenge-1', purpose: 'LOGIN', resource_id: '',
    content_type: 'application/json', iv: bytesToBase64URL(iv), ciphertext: bytesToBase64URL(ciphertext), tag: bytesToBase64URL(cipher.getAuthTag()),
  }
  const decrypted = await decryptCredentialResponse({ envelope, responseKey: new Uint8Array(key), kid: 'kid-1', challengeId: 'challenge-1', purpose: 'LOGIN' })
  assert.deepEqual(decrypted, JSON.parse(plaintext))
  const tampered = { ...envelope, tag: envelope.tag.slice(0, -2) + 'AA' }
  await assert.rejects(() => decryptCredentialResponse({ envelope: tampered, responseKey: new Uint8Array(key), kid: 'kid-1', challengeId: 'challenge-1', purpose: 'LOGIN' }), /解密失败/)
})

test('missing secure random source fails closed', async () => {
  const original = globalThis.crypto
  try {
    Object.defineProperty(globalThis, 'crypto', { value: {}, configurable: true })
    const { publicPem } = keypair()
    await assert.rejects(() => encryptCredentialRequest({
      publicKeyPem: publicPem, kid: 'kid-1', challengeId: 'challenge-1', purpose: 'LOGIN',
      contentType: 'application/json', plaintext: '{}',
    }), /安全随机数/)
  } finally {
    Object.defineProperty(globalThis, 'crypto', { value: original, configurable: true })
  }
})
