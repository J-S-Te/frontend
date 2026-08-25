import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const root = new URL('.', import.meta.url)
test('Settlement API keeps a dedicated same-origin API and OIDC session boundary', async () => {
  const source = await readFile(new URL('./settlement.js', root), 'utf8')
  assert.match(source, /VITE_SETTLEMENT_PUBLIC_PATH_PREFIX/)
  assert.match(source, /\/settlement/)
  assert.match(source, /credentials:\s*["']include["']/)
  assert.match(source, /Idempotency-Key/)
  assert.match(source, /retryKeys\.get\(retryFingerprint\)/)
  assert.match(source, /registerManualInvoice/)
  assert.match(source, /\/auth\/me/)
  assert.match(source, /\/auth\/login/)
})
