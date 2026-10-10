import test from 'node:test'
import assert from 'node:assert/strict'
import { isolatedEmbedUrl } from './embedOrigin.mjs'

test('isolated embed URL keeps capability in its restricted proxy path', () => {
  const token = 'a'.repeat(64)
  assert.equal(isolatedEmbedUrl(`http://127.0.0.2:18131/data_analysis/api/v1/embed-proxy/${token}`, token, 'http://127.0.0.1:18111'), `http://127.0.0.2:18131/data_analysis/api/v1/embed-proxy/${token}`)
  assert.equal(isolatedEmbedUrl(`http://localhost:18131/data_analysis/api/v1/embed-proxy/${token}`, token, 'http://127.0.0.1:18111'), `http://localhost:18131/data_analysis/api/v1/embed-proxy/${token}`)
})
test('reject platform host including another port, missing URL and unsafe paths', () => {
  const token = 'a'.repeat(64)
  for (const raw of [undefined, '/relative', `http://127.0.0.1:18131/data_analysis/api/v1/embed-proxy/${token}`, 'https://charts.example.net/admin', `https://user:secret@charts.example.net/data_analysis/api/v1/embed-proxy/${token}`, `https://charts.example.net/data_analysis/api/v1/embed-proxy/${token}?x=y`]) {
    assert.throws(() => isolatedEmbedUrl(raw, token, 'http://127.0.0.1:18111'))
  }
})
test('HTTPS platform never embeds HTTP, even loopback', () => {
  const token = 'a'.repeat(64)
  assert.throws(() => isolatedEmbedUrl(`http://127.0.0.2:18131/data_analysis/api/v1/embed-proxy/${token}`, token, 'https://platform.example.com'))
})
