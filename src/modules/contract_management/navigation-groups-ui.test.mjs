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

test('contract navigation does not expose the customer lookup entry', () => {
  const navigationDefinitions = source.slice(
    source.indexOf('const adminNavGroupDefinitions'),
    source.indexOf('const contracts = ref([])'),
  )
  assert.doesNotMatch(navigationDefinitions, /key: 'customers'|label: '客户查询'/)
})

test('contract system exit revokes the session instead of returning to the portal', () => {
  assert.match(source, /logoutCurrentSession\(\)/)
  assert.match(source, /router\.replace\(\{ name: 'login', query: \{ reason: 'session-ended' \} \}\)/)
  assert.equal((source.match(/@click="logoutSystem"/g) || []).length, 2)
  assert.match(source, /退出系统/)
})
