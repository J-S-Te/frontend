import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

// 逐页影响面矩阵：每个可写页面必须明确采用一种“写后局部同步”策略。
// - background: 后台重取，保留列表/详情
// - context: 后台重取并保留当前选择/表单
// - initialOnly: 仅首屏骨架，后续同步不替换内容
// - localPatch: 直接用接口返回值更新当前记录
// - targeted: 命令成功后刷新明确受影响的多个区域
const MATRIX = {
  project: { file: 'project_management/views/ProjectManagementView.vue', marker: /background: true/ },
  contract: { file: 'contract_management/views/ContractManagementView.vue', marker: /refreshApprovalMutation/ },
  customer: { file: 'customer_opportunity/views/CustomerOpportunityView.vue', marker: /background: true/ },
  alertsCenter: { file: 'data_analysis/views/AlertsCenterView.vue', marker: /await load\(\{ background: true \}\)/ },
  adminSources: { file: 'data_analysis/views/AdminSourcesView.vue', marker: /await load\(\{ background: true \}\)/ },
  alertRules: { file: 'data_analysis/views/AlertRulesView.vue', marker: /rules\.value = saved/ },
  dictionary: { file: 'data_analysis/views/DictionaryView.vue', marker: /replaceMetric\(/ },
  portal: { file: 'customer_portal/views/CustomerPortalView.vue', marker: /background: true/ },
  reimbursement: { file: 'reimbursement/views/ReimbursementView.vue', marker: /preserveContext/ },
  settlement: { file: 'settlement/views/SettlementView.vue', marker: /initialized/ },
  notifications: { file: 'platform/notifications/components/NotificationCenterModule.vue', marker: /await reload\(\)/ },
  platformSettings: { file: 'platform/views/PlatformConsoleView.vue', marker: /await refreshPrincipal\(\)\.catch/ },
}

test('逐页影响面矩阵：所有可写业务页都有局部同步策略', async () => {
  for (const [name, entry] of Object.entries(MATRIX)) {
    const source = await read(entry.file)
    assert.match(source, entry.marker, `${name} 缺少写后局部同步策略`)
    assert.doesNotMatch(source, /location\.reload\(|window\.location\.reload\(/, `${name} 不得以整页刷新作为常规更新`)
  }
})

test('可写页面不得在已有数据时把整页替换成骨架', async () => {
  const guarded = [
    'project_management/views/ProjectManagementView.vue',
    'reimbursement/views/ReimbursementView.vue',
    'settlement/views/SettlementView.vue',
  ]
  for (const path of guarded) {
    const source = await read(path)
    assert.doesNotMatch(source, /<LoadingState v-if="loading" title="正在读取结算数据…" \/>/, path)
    assert.doesNotMatch(source, /<ListState v-if="loading \|\| sectionExtrasLoading"/, path)
  }
})
