import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('./views/ContractManagementView.vue', import.meta.url), 'utf8')

test('admin navigation separates business, lookup, configuration and reporting functions', () => {
  assert.match(source, /const adminNavGroupDefinitions = \[[\s\S]*label: '业务办理'[\s\S]*label: '查询台账'[\s\S]*label: '配置管理'[\s\S]*label: '统计查看'/)
  assert.match(source, /label: '配置管理'[\s\S]*key: 'templates'[\s\S]*key: 'rules'/)
})

test('non-admin navigation is grouped by available business capabilities', () => {
  assert.match(source, /const userNavGroupDefinitions = \[[\s\S]*label: '合同业务'[\s\S]*label: '审批协同'[\s\S]*label: '数据分析'/)
})

test('navigation selects role-specific groups and removes unavailable or empty groups', () => {
  assert.match(source, /isAdmin\.value \? adminNavGroupDefinitions : userNavGroupDefinitions/)
  assert.match(source, /items: group\.items\.filter\(\(item\) => canAccessContractSection\(session\.value, item\.key\)\)/)
  assert.match(source, /\.filter\(\(group\) => group\.items\.length\)/)
})

// 行为有意变更（客户查询建设中）：旧断言要求侧边栏完全隐藏客户查询入口，导致该页只能
// 手敲 URL 进入、看起来像坏页。产品决定改为如实暴露入口并标注“建设中”。
test('contract navigation exposes the customer lookup entry with a building marker', () => {
  const navigationDefinitions = source.slice(
    source.indexOf('const adminNavGroupDefinitions'),
    source.indexOf('const contracts = ref([])'),
  )
  const adminGroup = navigationDefinitions.slice(0, navigationDefinitions.indexOf('const userNavGroupDefinitions'))
  const userGroup = navigationDefinitions.slice(navigationDefinitions.indexOf('const userNavGroupDefinitions'))
  assert.match(adminGroup, /\{ key: 'customers', label: '客户查询', icon: 'user', badge: '建设中' \}/)
  assert.match(userGroup, /\{ key: 'customers', label: '客户查询', icon: 'user', badge: '建设中' \}/)
  assert.match(source, /<i v-if="item\.badge">\{\{ item\.badge \}\}<\/i>/)
})

test('contract navigation returns to the portal while the user control revokes the application session', () => {
  assert.match(source, /logoutCurrentSession\(\)/)
  assert.match(source, /router\.replace\(\{ name: 'login', query: \{ reason: 'session-ended' \} \}\)/)
  assert.equal((source.match(/@click="logoutSystem"/g) || []).length, 1)
  assert.equal((source.match(/@click="returnToUnifiedPortal"/g) || []).length, 1)
  assert.match(source, /返回子系统门户/)
  assert.match(source, /aria-label="退出应用系统"/)
})
