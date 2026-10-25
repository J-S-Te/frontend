import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const source = await readFile(new URL('./views/ContractManagementView.vue', import.meta.url), 'utf8')
const displaySource = await readFile(new URL('./utils/contractDisplay.js', import.meta.url), 'utf8')
const approvalDetailSource = await readFile(new URL('./composables/useApprovalDetail.js', import.meta.url), 'utf8')

test('approval center switches between tasks and initiated approvals', () => {
  assert.match(source, /const approvalTab = ref\('tasks'\)/)
  assert.match(source, /@click="approvalTab = 'initiated'"/)
  assert.match(source, /:class="\{ active: approvalTab === 'initiated' \}"/)
  assert.match(source, /v-if="approvalTab === 'tasks'"/)
  assert.match(source, /<section v-else class="contract-approval-list" role="tabpanel">/)
})

test('submitted approvals remain visible while the workflow instance is materializing', () => {
  assert.match(source, /const started = await submitContract/)
  assert.match(source, /initiatedApprovals\.value = \[pendingApproval,/)
  assert.match(source, /approvalTab\.value = 'initiated'/)
  assert.match(source, /waitForInitiatedApproval\(started\.approval_id\)/)
  assert.match(source, /const initializing = initiatedApprovals\.value\.filter/)
  assert.match(source, /:disabled="approval\.initializing"/)
  assert.match(source, /approval\.initializing \? '正在初始化' : '查看进度'/)
})

test('approval center continuously synchronizes visible workflow state and confirms commands durably', () => {
  assert.match(source, /activeSection\.value !== 'approvals' \|\| document\.visibilityState !== 'visible'/)
  assert.match(source, /scheduleApprovalRealtime\(\)/)
  assert.match(source, /immediate \? 0 : 1000/)
  assert.match(source, /document\.addEventListener\('visibilitychange'/)
  assert.match(source, /document\.removeEventListener\('visibilitychange'/)
  assert.match(approvalDetailSource, /const accepted = await commandApproval/)
  assert.match(approvalDetailSource, /waitForApprovalCommand\(accepted\.command_id, action, target\.id\)/)
  assert.match(approvalDetailSource, /detail\?\.actions\?\.some\(\(item\) => item\.command_id === commandID\)/)
  assert.match(source, /const currentTask = approvals\.value\.find/)
  assert.match(source, /selectedApproval\.value = \{ \.\.\.selectedApproval\.value, \.\.\.currentTask \}/)
  assert.match(approvalDetailSource, /操作已受理，流程仍在处理，状态将自动更新/)
})

test('approval history distinguishes missing snapshots and exposes controlled recovery', () => {
  assert.match(source, /approvalDetail\.snapshot_available === false/)
  assert.match(source, /未保存提交快照/)
  assert.match(source, /await recoverApproval\(target\.id\)/)
  assert.match(source, />修复审批状态</)
})

test('approval center presents workflow statuses in Chinese', () => {
  assert.match(displaySource, /running: '审批中'/)
  assert.match(displaySource, /rejected: '已驳回'/)
  assert.match(displaySource, /withdrawn: '已撤回'/)
  assert.match(displaySource, /active: '处理中'/)
  assert.match(displaySource, /skipped: '已跳过'/)
  assert.match(source, /approvalStatusLabel\(approval\.status\)/)
  assert.match(source, /approvalStatusLabel\(runtime\.status\)/)
  assert.match(source, /contractStatusLabel\(approvalDetail\.meta\.from_status\)/)
})

test('pending assigned approvals are viewable but cannot be processed early', () => {
  assert.match(approvalDetailSource, /const requiresActiveTask = \['approve', 'reject', 'sign', 'transfer', 'return'\]\.includes\(action\)/)
  assert.match(approvalDetailSource, /can\('approval\.process'\) && selectedApproval\.value\?\.status === 'active'/)
  assert.match(approvalDetailSource, /该审批尚未流转到当前节点，暂时只能查看/)
})

test('add-sign candidates are limited to users with contract approval permission', () => {
  assert.match(source, /const approvalTargetUsers = computed/)
  assert.match(source, /contractRole\(roleCode\)\?\.permissions\?\.includes\('approval\.process'\)/)
  assert.match(source, /!assigned\.has\(user\.user_id\)/)
  assert.match(source, /v-for="user in approvalTargetUsers"/)
  assert.match(source, /请选择具有合同审批权限的人员/)
  assert.match(source, /state_unavailable/)
  assert.match(source, /审批工作流历史已不可查询/)
})
