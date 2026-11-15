import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const files = [
  '../customer_opportunity/views/CustomerOpportunityView.vue',
  '../platform/notifications/components/NotificationCenterModule.vue',
  '../project_management/components/ProjectNotificationCenter.vue',
  './components/PlatformNotificationInbox.vue',
  '../reimbursement/components/ExpenseInbox.vue',
  '../reimbursement/views/ReimbursementView.vue',
]

test('六处删除已读/放弃草稿不再直接调用原生 window.confirm', () => {
  for (const file of files) {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8')
    assert.doesNotMatch(source, /window\.confirm\s*\(/, file)
    assert.match(source, /useConfirmDialog/, file)
    assert.match(source, /<ConfirmDialog/, file)
  }
})
