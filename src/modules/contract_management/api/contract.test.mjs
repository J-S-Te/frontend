import assert from 'node:assert/strict'
import test from 'node:test'

// The source module depends on Vite's import.meta.env and browser navigation, so these focused
// source assertions protect the contract that every API request—not only /auth/me—handles 401.
const source = await import('node:fs/promises').then(({ readFile }) => readFile(new URL('./contract.js', import.meta.url), 'utf8'))

test('contract API starts one shared OIDC redirect only for an expired session', () => {
  assert.match(source, /if \(response\.status === 401\)[\s\S]*startContractLogin\(\)/)
  // 只有未显式关闭跳转的调用方才重新走登录；跨子系统调用方会传 suppressLoginRedirect。
  assert.match(source, /if \(!suppressLoginRedirect && shouldStartSubsystemLogin\(authError\)\) startContractLogin\(\)/)
  assert.match(source, /if \(loginRedirectStarted\) return/)
  assert.match(source, /window\.location\.replace\(`\$\{CONTRACT_PUBLIC_PATH_PREFIX\}\/auth\/login\$\{prompt\}`\)/)
})

test('contract session cache is cleared before reauthentication', () => {
  assert.match(source, /function startContractLogin\(\{ force = false \} = \{\}\)[\s\S]*clearContractSessionCache\(\)/)
})

test('contract session is replaced when the platform browser switches users', () => {
  assert.match(source, /const platformUserID = principalIdentityID\(platformPrincipal\)/)
  assert.match(source, /const contractIdentityID = principalIdentityID\(contractSession\)/)
  assert.match(source, /platformUserID !== contractIdentityID/)
  assert.match(source, /platformPrincipal\?\.tenant_id \|\| platformPrincipal\?\.tenant\?\.id/)
  assert.match(source, /await clearContractLocalSession\(\)[\s\S]*startContractLogin\(\)/)
  assert.match(source, /\/auth\/local-logout/)
})

test('contract template upload preserves browser multipart boundary', () => {
  assert.match(source, /fetchOptions\.body instanceof FormData/)
  assert.match(source, /!hasFormDataBody \? \{ 'Content-Type': 'application\/json' \}/)
  assert.match(source, /request\('\/contract-templates',[\s\S]*method: 'POST',[\s\S]*body: form/)
})

test('contract template preview submits the generated field values', () => {
  assert.match(source, /previewContractTemplate\(templateId, values\)/)
  assert.match(source, /`\/contract-templates\/\$\{encodeURIComponent\(templateId\)\}\/preview`/)
  assert.match(source, /body: JSON\.stringify\(\{ values \}\)/)
})

test('contract template management uses tenant-scoped resource routes', () => {
  assert.match(source, /updateContractTemplate\(templateId, payload\)[\s\S]*method: 'PUT'/)
  assert.match(source, /deleteContractTemplate\(templateId\)[\s\S]*method: 'DELETE'/)
  assert.match(source, /encodeURIComponent\(templateId\)/)
})

test('saved contracts expose their formatted document preview', () => {
  assert.match(source, /previewContractDocument\(contractId\)/)
  assert.match(source, /`\/contracts\/\$\{encodeURIComponent\(contractId\)\}\/preview`/)
})

test('contract details load the persisted lifecycle timeline', () => {
  assert.match(source, /listContractLifecycle\(contractId\)/)
  assert.match(source, /`\/contracts\/\$\{encodeURIComponent\(contractId\)\}\/lifecycle`/)
})

test('admin dashboard reads the tenant contract summary endpoint', () => {
  assert.match(source, /getContractDashboard\(\)[\s\S]*request\('\/dashboard'\)/)
})

test('approval participants can request the formatted contract preview', () => {
  assert.match(source, /previewApprovalContract\(approvalId\)/)
  assert.match(source, /`\/approvals\/\$\{encodeURIComponent\(approvalId\)\}\/contract-preview`/)
})

test('合同授权在新标签页建立会话，不劫持当前页面', () => {
  // 合同登录固定回跳合同首页（ReturnPath 硬编码为合同根路径），
  // 所以跨子系统调用方只能用新标签页补授权，不能整页跳转。
  assert.match(source, /export function openContractAuthorizationInNewTab\(\)/)
  assert.match(source, /window\.open\(`\$\{CONTRACT_PUBLIC_PATH_PREFIX\}\/auth\/login`, '_blank', 'noopener'\)/)
})
