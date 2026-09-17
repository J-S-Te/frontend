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
  assert.match(source, /rejectInvoiceRequest/)
  assert.match(source, /listReceiptMatches/)
  assert.match(source, /uploadTaxInvoiceDocument/)
  assert.match(source, /downloadTaxInvoiceDocument/)
  assert.match(source, /requestTaxInvoiceRedFlush/)
  assert.match(source, /approveInvoiceRedFlush/)
  assert.match(source, /rejectInvoiceRedFlush/)
  assert.match(source, /invoice-red-flush-requests/)
  assert.match(source, /createAgingReceivablesExport/)
  assert.match(source, /options\.body instanceof FormData/)
  assert.match(source, /\/auth\/me/)
  assert.match(source, /\/auth\/login/)
  assert.match(source, /normalizeAuthorizationSession/)
  assert.match(source, /principalIdentityID/)
  assert.match(source, /getCurrentPrincipal/)
  assert.match(source, /clearSettlementLocalSession/)
  assert.match(source, /prompt=login/)
  // 修复：未鉴权（401 普通会话失效）时必须主动发起 OIDC 跳转，
  // 不能仅返回 null，否则路由守卫会静默中止跳转、卡片点击无效。
  assert.match(source, /if \(shouldStartSubsystemLogin\(error\)\) \{\s*\n\s*beginLogin\(\);\s*\n\s*return null;\s*\n\s*\}/)
})

test('ensureSettlementSession on plain 401 must trigger OIDC login, not silently return null', async () => {
  // 修复前：ensureSettlementSession 对 401 仅返回 null，不发起跳转 → 路由守卫
  // 静默中止跳转、用户点击结算卡片后看不到任何反馈。
  // 修复后：必须复用 shouldStartSubsystemLogin 分类器，仅对 UNAUTHENTICATED
  // 发起 beginLogin()；其他非鉴权类错误仍向上抛出，由上层处理。
  const source = await readFile(new URL('./settlement.js', root), 'utf8')
  assert.match(source, /if \(shouldStartSubsystemLogin\(error\)\) \{\s*\n\s*beginLogin\(\);\s*\n\s*return null;\s*\n\s*\}/)
  assert.doesNotMatch(source, /if \(shouldStartSubsystemLogin\(error\)\) return null;/)
})

test('development auth session must not enter the platform identity reconciliation loop', async () => {
  const source = await readFile(new URL('./settlement.js', root), 'utf8')
  assert.match(source, /function isSettlementDevelopmentSession\(value\)/)
  assert.match(source, /catalog_version[^\n]+development/)
  assert.match(source, /tenant_id[^\n]+dev/)
  assert.match(source, /if \(isSettlementDevelopmentSession\(settlementSession\)\) \{\s*return settlementSession;\s*\}/)
})
