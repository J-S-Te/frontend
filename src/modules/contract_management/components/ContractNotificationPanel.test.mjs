import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

test('合同铃铛仅显示平台收件箱，审批待办使用独立入口', () => {
  const panel = readFileSync(new URL('./ContractNotificationPanel.vue', import.meta.url), 'utf8')
  const view = readFileSync(new URL('../views/ContractManagementView.vue', import.meta.url), 'utf8')
  assert.match(panel, /PlatformNotificationInbox app-code="contract_management"/)
  assert.match(panel, /@unread-change="\$emit\('unread-change', \$event\)"/)
  assert.doesNotMatch(panel, /审批待办|open-approval|canProcess/)
  assert.match(view, /title="审批待办" @click="navigate\('approvals'\)"/)
  assert.match(view, /name="bell" \/><i v-if="notificationUnread"/)
  assert.match(view, /<ContractNotificationPanel v-if="notificationOpen"/)
})
