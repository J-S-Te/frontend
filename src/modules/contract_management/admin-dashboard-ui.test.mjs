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
