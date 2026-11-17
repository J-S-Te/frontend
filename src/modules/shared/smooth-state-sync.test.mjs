import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

// 写后状态同步的总门禁：重点不是“有没有刷新”，而是刷新时不能重新挂载整页骨架。
// 各模块必须把写后同步与首屏加载分开：数据区保持挂载，后台取回后原地替换。
test('项目工作区写后后台同步，不使用整页骨架', async () => {
  const source = await read('project_management/views/ProjectManagementView.vue')
  assert.match(source, /async function loadWorkspace\(\{ reportError = true, background = false \} = \{\}\)/)
  assert.match(source, /if \(background\) \{ refreshing\.value = true; loadError\.value = '' \}/)
  assert.match(source, /await loadWorkspace\(\{ reportError: false, background: true \}\)/)
  assert.match(source, /<ListState v-if="!workspaceReady && \(loading \|\| sectionExtrasLoading\)"/)
  assert.match(source, /class="pm-sync-status"/)
})

test('客户与商机写后同步保留列表，不在后台请求时清空旧行', async () => {
  const source = await read('customer_opportunity/views/CustomerOpportunityView.vue')
  assert.match(source, /async function loadCurrent\(\{ reportError = true, background = false \} = \{\}\)/)
  assert.match(source, /if \(background\) refreshing\.value = true/)
  assert.match(source, /if \(!background\) \{ customers\.value = \[\]; page\.total = 0 \}/)
  assert.match(source, /await loadCurrent\(\{ background: true \}\)/)
  assert.match(source, /if \(sequence === currentLoadSequence\.value\) \{\s*if \(background\) refreshing\.value = false/)
})

test('数据看板与数据源写后同步不进入首屏加载态', async () => {
  const alerts = await read('data_analysis/views/AlertsCenterView.vue')
  const admin = await read('data_analysis/views/AdminSourcesView.vue')
  for (const source of [alerts, admin]) {
    assert.match(source, /async function load\(\{ background = false \} = \{\}\)/)
    assert.match(source, /if \(background\) refreshing\.value = true/)
    assert.match(source, /if \(background\) refreshing\.value = false/)
    assert.match(source, /await load\(\{ background: true \}\)/)
  }
})

test('客户门户反馈写后同步保留成功提示和列表', async () => {
  const source = await read('customer_portal/views/CustomerPortalView.vue')
  assert.match(source, /async function load\(\{ background = false \} = \{\}\)/)
  assert.match(source, /if \(background\) \{ refreshing\.value = true; error\.value = '' \}/)
  assert.match(source, /if \(hasPermission\('feedback\.read'\)\) await load\(\{ background: true \}\)/)
})

test('报销与结算只有首屏展示骨架，后续刷新保留当前分区', async () => {
  const reimbursement = await read('reimbursement/views/ReimbursementView.vue')
  const settlement = await read('settlement/views/SettlementView.vue')
  assert.match(reimbursement, /const initialized = ref\(false\)/)
  assert.match(reimbursement, /<LoadingState v-if="loading && !initialized"/)
  assert.match(settlement, /initialized = ref\(false\)/)
  assert.match(settlement, /<LoadingState v-if="loading && !initialized"/)
})

test('合同审批成功后同步台账与统计，而不只更新审批弹窗', async () => {
  const source = await read('contract_management/views/ContractManagementView.vue')
  assert.match(source, /refreshApprovalRealtime: refreshApprovalMutation/)
  assert.match(source, /async function refreshApprovalMutation\(\) \{\s*await refreshApprovalRealtime\(\)\s*void loadBusinessData\(\)/)
})

test('状态同步样式使用轻量指示和行过渡，不引入整页闪烁', async () => {
  const styles = await read('project_management/styles/project-management.css')
  assert.match(styles, /\.pm-sync-status \{/)
  assert.match(styles, /\.pm-table tbody tr \{\s*transition: background-color \.24s ease/)
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/)
})
