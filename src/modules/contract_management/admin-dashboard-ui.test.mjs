import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('./views/ContractManagementView.vue', import.meta.url), 'utf8')

test('admin dashboard shows five tenant contract metrics', () => {
  assert.match(source, /v-if="isAdmin" class="contract-stat-grid contract-admin-stat-grid"/)
  for (const label of ['当前企业合同总额', '当前企业合同份数', '当前处于审批流程中的合同', '已生效未到期的合同', '已超期的合同']) {
    assert.match(source, new RegExp(label))
  }
  assert.match(source, /getContractDashboard\(\)/)
})

test('admin metric cards open filtered contract details', () => {
  assert.match(source, /@click="openDashboardDetail\('approval'\)"/)
  assert.match(source, /adminDashboardContracts\.value\.filter\(\(item\) => item\.inApproval\)/)
  assert.match(source, /dashboardDetailContracts[\s\S]*openDashboardContract\(contract\)/)
  assert.match(source, /contract_detail_limited/)
})

test('admin dashboard opens the matching contract and requests persisted DOCX for every source', () => {
  assert.match(source, /function openDashboardContract\(contract\) \{[\s\S]*contracts\.value\.find\(\(item\) => item\.recordId === contract\.recordId\)[\s\S]*openContract/)
  assert.match(source, /async function openContract\(contract\)[\s\S]*previewContractDocument\(contract\.recordId\)/)
  assert.doesNotMatch(source, /if \(contract\.templateId\)/)
})

test('dashboard header and todo list follow the prototype information density', () => {
  assert.ok(source.includes('const pageDescription = computed(() => {'))
  assert.ok(source.includes('您好，${currentUserLabel.value} · 当前角色：${currentRoleLabel.value} · 您有 ${approvals.value.length} 项审批待处理'))
  assert.ok(source.includes('<p>{{ pageDescription }}</p>'))
  assert.ok(source.includes('class="contract-card contract-dashboard-todo"'))
  assert.ok(source.includes('我的待办'))
  assert.ok(source.includes('approvals.slice(0, 5)'))
  assert.ok(source.includes('@click="openApproval(approval)"'))
  assert.ok(source.includes("can('approval.process') ? '处理' : '查看'"))
  // 原型的问候信息由页头承载；旧的整块欢迎横幅不再保留。
  assert.equal(source.includes('class="contract-welcome"'), false)
})
