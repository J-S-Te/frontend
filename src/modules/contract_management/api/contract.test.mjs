import assert from 'node:assert/strict'
import test from 'node:test'

// The source module depends on Vite's import.meta.env and browser navigation, so these focused
// source assertions protect the contract that every API request—not only /auth/me—handles 401.
const source = await import('node:fs/promises').then(({ readFile }) => readFile(new URL('./contract.js', import.meta.url), 'utf8'))

test('contract API starts one shared OIDC redirect for any 401 response', () => {
  assert.match(source, /if \(response\.status === 401\)[\s\S]*startContractLogin\(\)/)
  assert.match(source, /if \(loginRedirectStarted\) return/)
  assert.match(source, /window\.location\.replace\(`\$\{CONTRACT_PUBLIC_PATH_PREFIX\}\/auth\/login`\)/)
})

test('contract session cache is cleared before reauthentication', () => {
  assert.match(source, /function startContractLogin\(\)[\s\S]*clearContractSessionCache\(\)/)
})

test('contract session is replaced when the platform browser switches users', () => {
  assert.match(source, /const platformUserID = String\(platformPrincipal\?\.user\?\.id \|\| ''\)/)
  assert.match(source, /platformUserID !== String\(contractSession\?\.user_id \|\| ''\)/)
  assert.match(source, /await clearContractLocalSession\(\)[\s\S]*startContractLogin\(\)/)
  assert.match(source, /\/auth\/local-logout/)
})

test('contract template upload preserves browser multipart boundary', () => {
  assert.match(source, /options\.body instanceof FormData/)
  assert.match(source, /!hasFormDataBody \? \{ 'Content-Type': 'application\/json' \}/)
  assert.match(source, /request\('\/contract-templates',[\s\S]*method: 'POST',[\s\S]*body: form/)
})

test('contract template preview submits the generated field values', () => {
  assert.match(source, /previewContractTemplate\(templateId, values\)/)
  assert.match(source, /`\/contract-templates\/\$\{encodeURIComponent\(templateId\)\}\/preview`/)
  assert.match(source, /body: JSON\.stringify\(\{ values \}\)/)
})

test('saved contracts expose their formatted document preview', () => {
  assert.match(source, /previewContractDocument\(contractId\)/)
  assert.match(source, /`\/contracts\/\$\{encodeURIComponent\(contractId\)\}\/preview`/)
})
