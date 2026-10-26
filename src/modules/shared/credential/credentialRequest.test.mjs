import assert from 'node:assert/strict'
import test from 'node:test'
import { generateKeyPairSync, privateDecrypt, constants, createDecipheriv, createCipheriv, randomBytes } from 'node:crypto'
import { postCredentialJSON, postCredentialFormData } from './credentialRequest.js'
import { PROTOCOL, OAEP_LABEL, buildAAD, bytesToBase64URL, base64URLToBytes } from './credentialProtocol.js'

function encryptResponse(plaintext, responseKey, challengeId = 'challenge-1', purpose = 'LOGIN') {
  const iv = randomBytes(12)
  const aad = buildAAD({ direction: 'response', kid: 'kid-1', challengeId, purpose, resourceId: '', contentType: 'application/json' })
  const cipher = createCipheriv('aes-256-gcm', responseKey, iv)
  cipher.setAAD(Buffer.from(aad))
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return {
    protocol: PROTOCOL, kid: 'kid-1', challenge_id: challengeId, purpose, resource_id: '', content_type: 'application/json',
    iv: bytesToBase64URL(iv), ciphertext: bytesToBase64URL(ciphertext), tag: bytesToBase64URL(cipher.getAuthTag()),
  }
}

function challengeResponse(publicPem) {
  return { code: 'OK', data: { protocol: PROTOCOL, kid: 'kid-1', public_key: publicPem, challenge_id: 'challenge-1', purpose: 'LOGIN', resource_id: '', expires_at: '2026-10-26T12:01:00Z' } }
}

test('JSON credential request encrypts body, submits envelope, decrypts response', async () => {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const publicPem = publicKey.export({ type: 'spki', format: 'pem' })
  let captured
  const fetchImpl = async (url, options) => {
    if (url.endsWith('/credential-challenges')) return new Response(JSON.stringify(challengeResponse(publicPem)), { status: 200, headers: { 'content-type': 'application/json' } })
    captured = JSON.parse(options.body)
    const material = privateDecrypt({ key: privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256', oaepLabel: Buffer.from(OAEP_LABEL) }, base64URLToBytes(captured.credential_envelope.encrypted_key))
    const reqKey = material.subarray(0, 32), respKey = material.subarray(32)
    const aad = buildAAD({ direction: 'request', kid: 'kid-1', challengeId: 'challenge-1', purpose: 'LOGIN', resourceId: '', contentType: 'application/json' })
    const decipher = createDecipheriv('aes-256-gcm', reqKey, base64URLToBytes(captured.credential_envelope.iv))
    decipher.setAAD(Buffer.from(aad)); decipher.setAuthTag(base64URLToBytes(captured.credential_envelope.tag))
    const plain = Buffer.concat([decipher.update(base64URLToBytes(captured.credential_envelope.ciphertext)), decipher.final()]).toString('utf8')
    assert.equal(plain, JSON.stringify({ account: 'localadmin', password: 'secret-口令' }))
    const responseBody = JSON.stringify({ code: 'OK', data: { redirect_url: '/portal' } })
    return new Response(JSON.stringify({ credential_envelope: encryptResponse(responseBody, respKey) }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  const result = await postCredentialJSON({ url: '/api/v1/auth/login', purpose: 'LOGIN', body: { account: 'localadmin', password: 'secret-口令' }, fetchImpl })
  assert.equal(result.status, 200)
  assert.deepEqual(result.body, { code: 'OK', data: { redirect_url: '/portal' } })
  assert.equal(captured.credential_envelope.protocol, PROTOCOL)
  assert.equal(captured.password, undefined)
})

test('FormData is encrypted as raw multipart and preserves content type', async () => {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const publicPem = publicKey.export({ type: 'spki', format: 'pem' })
  let capturedContentType = ''
  let capturedBytes = null
  const fetchImpl = async (url, options) => {
    if (url.endsWith('/credential-challenges')) return new Response(JSON.stringify(challengeResponse(publicPem)), { status: 200, headers: { 'content-type': 'application/json' } })
    const envelope = JSON.parse(options.body).credential_envelope
    capturedContentType = envelope.content_type
    const material = privateDecrypt({ key: privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256', oaepLabel: Buffer.from(OAEP_LABEL) }, base64URLToBytes(envelope.encrypted_key))
    const aad = buildAAD({ direction: 'request', kid: 'kid-1', challengeId: 'challenge-1', purpose: 'LOGIN', resourceId: '', contentType: envelope.content_type })
    const decipher = createDecipheriv('aes-256-gcm', material.subarray(0, 32), base64URLToBytes(envelope.iv))
    decipher.setAAD(Buffer.from(aad)); decipher.setAuthTag(base64URLToBytes(envelope.tag))
    capturedBytes = Buffer.concat([decipher.update(base64URLToBytes(envelope.ciphertext)), decipher.final()])
    const responseBody = JSON.stringify({ code: 'OK', data: {} })
    return new Response(JSON.stringify({ credential_envelope: encryptResponse(responseBody, material.subarray(32)) }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  const form = new FormData()
  form.append('file', new Blob(['name,account\n张三,zhangsan\n'], { type: 'text/csv' }), 'users.csv')
  form.append('selected_rows', '[2]')
  const result = await postCredentialFormData({ url: '/api/v1/employees/batch', purpose: 'LOGIN', formData: form, fetchImpl })
  assert.equal(result.status, 200)
  assert.match(capturedContentType, /^multipart\/form-data; boundary=/)
  const text = capturedBytes.toString('utf8')
  assert.match(text, /name,account/)
  assert.match(text, /selected_rows/)
})
