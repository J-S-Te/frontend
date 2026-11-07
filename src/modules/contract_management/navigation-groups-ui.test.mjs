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

// 行为有意变更（客户查询暂不上线，2026-11-07）：客户查询入口已从两个侧栏注释下线，
// 不再是“可见入口 + 建设中标记”；页面本身也一并下线，避免留下可进入的空白页。
test('contract navigation no longer exposes the customer lookup entry', () => {
  const navigationDefinitions = source.slice(
    source.indexOf('const adminNavGroupDefinitions'),
    source.indexOf('const contracts = ref([])'),
  )
  const adminGroup = navigationDefinitions.slice(0, navigationDefinitions.indexOf('const userNavGroupDefinitions'))
  const userGroup = navigationDefinitions.slice(navigationDefinitions.indexOf('const userNavGroupDefinitions'))
  assert.doesNotMatch(adminGroup, /^\s*\{ key: 'customers'/m)
  assert.doesNotMatch(userGroup, /^\s*\{ key: 'customers'/m)
  // 注释保留原入口，恢复时放开这两行即可；标记渲染模板仍留在视图里。
  assert.match(adminGroup, /\/\/ \{ key: 'customers', label: '客户查询', icon: 'user', badge: '建设中' \},/)
  assert.match(userGroup, /\/\/ \{ key: 'customers', label: '客户查询', icon: 'user', badge: '建设中' \},/)
  assert.match(source, /<i v-if="item\.badge">\{\{ item\.badge \}\}<\/i>/)
})

// 回归锁定：入口移除后原分组不能变空——空分组虽被过滤，但会让整个分组从侧栏消失。
test('removing the customer entry leaves no empty navigation group', () => {
  const adminGroup = source.slice(source.indexOf('const adminNavGroupDefinitions'), source.indexOf('const userNavGroupDefinitions'))
  const userGroup = source.slice(source.indexOf('const userNavGroupDefinitions'), source.indexOf('const contracts = ref([])'))
  const lookupGroup = adminGroup.slice(adminGroup.indexOf(`label: '查询台账'`), adminGroup.indexOf(`label: '配置管理'`))
  assert.match(lookupGroup, /^\s*\{ key: 'signing'/m)
  const businessGroup = userGroup.slice(userGroup.indexOf(`label: '合同业务'`), userGroup.indexOf(`label: '审批协同'`))
  for (const key of ['intakes', 'contracts', 'imports', 'templates', 'signing']) {
    assert.match(businessGroup, new RegExp(`^\\s*\\{ key: '${key}'`, 'm'), `非管理员「合同业务」组缺少 ${key}`)
  }
  assert.doesNotMatch(businessGroup, /^\s*\{ key: 'customers'/m)
})

test('contract navigation returns to the portal while the user control revokes the application session', () => {
  assert.match(source, /logoutCurrentSession\(\)/)
  assert.match(source, /router\.replace\(\{ name: 'login', query: \{ reason: 'session-ended' \} \}\)/)
  assert.equal((source.match(/@click="logoutSystem"/g) || []).length, 1)
  assert.equal((source.match(/@click="returnToUnifiedPortal"/g) || []).length, 1)
  assert.match(source, /返回子系统门户/)
  assert.match(source, /aria-label="退出应用系统"/)
})
