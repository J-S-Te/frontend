import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('Settlement view exposes the first-phase financial workflow without mock records', async () => {
  const source = await readFile(new URL('./views/SettlementView.vue', import.meta.url), 'utf8')
  for (const section of ['dashboard', 'receivables', 'invoices', 'receipts', 'allocations', 'dunning', 'tasks']) assert.match(source, new RegExp(`'${section}'`))
  assert.match(source, /confirmReceivablePlan/)
  assert.match(source, /createReceiptAllocation/)
  assert.match(source, /registerManualInvoice/)
  assert.match(source, /logoutCurrentSession/)
  assert.match(source, /closeSubsystemTabOrFallback/)
  assert.match(source, /reason: "session-ended"/)
  assert.match(source, /:disabled="isLoggingOut"/)
  assert.match(source, /modules\/platform\/styles\/console\.css/)
  assert.match(source, /console-page settlement-shell/)
  assert.match(source, /console-sidebar settlement-sidebar/)
  assert.match(source, /console-topbar settlement-topbar/)
  assert.match(source, /console-content settlement-content/)
  assert.match(source, /navigationGroups/)
  assert.match(source, /dashboardKpis/)
  assert.match(source, /workItems/)
  assert.match(source, /agingBuckets/)
  assert.match(source, /loadGeneration/)
  assert.match(source, /generation !== loadGeneration/)
  assert.doesNotMatch(source, /示例客户|mockReceivable|演示数据/)
})
