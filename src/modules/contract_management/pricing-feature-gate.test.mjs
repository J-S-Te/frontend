import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { standardPriceCatalogEnabled } from './features.js'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')

test('版本化标准价格目录当前关闭，保留恢复开关', () => {
  assert.equal(standardPriceCatalogEnabled, false)
})

test('目录入口、新建合同定价区和重选基准入口都由同一个开关控制', () => {
  const view = read('./views/ContractManagementView.vue')
  const draft = read('./components/ContractDraftFields.vue')
  const revision = read('./components/ContractPricingRevisionPanel.vue')
  assert.match(view, /standardPriceCatalogEnabled && \(can\('contract\.pricing\.manage'\)/)
  assert.match(view, /StandardPricePanel v-if="standardPriceCatalogEnabled && standardPricesOpen"/)
  assert.match(draft, /ContractPricingFields v-if="standardPriceCatalogEnabled"/)
  assert.match(revision, /ContractPricingFields v-if="standardPriceCatalogEnabled"/)
  assert.match(revision, /v-if="standardPriceCatalogEnabled && form\.pricing && !record\.pricing"/)
})

test('关闭状态合同详情、变更面板和审批快照都不展示定价信息', () => {
  const view = read('./views/ContractManagementView.vue')
  assert.match(view, /ContractPricingRevisionPanel v-if="standardPriceCatalogEnabled"/)
  assert.match(view, /PricingSnapshotSummary v-if="standardPriceCatalogEnabled"/)
})
