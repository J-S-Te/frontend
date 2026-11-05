import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { canAccessContractSection } from '../shared/authz/sys004.js'

const source = await readFile(new URL('./views/ContractManagementView.vue', import.meta.url), 'utf8')

// customersSection 截取客户查询分区的模板片段，供结构与文案断言使用。
function customersSection() {
  const start = source.indexOf(`<template v-else-if="activeSection === 'customers'">`)
  assert.ok(start >= 0, '缺少客户查询分区模板')
  const end = source.indexOf('</template>', start)
  assert.ok(end > start)
  return source.slice(start, end)
}

// 回归锁定 L3：客户查询必须在两个侧边栏都可见并带“建设中”标记，
// 不能只靠手敲 URL 进入。
test('admin and non-admin sidebars expose the customer section with a building marker', () => {
  const definitions = source.slice(
    source.indexOf('const adminNavGroupDefinitions'),
    source.indexOf('const contracts = ref([])'),
  )
  const admin = definitions.slice(0, definitions.indexOf('const userNavGroupDefinitions'))
  const user = definitions.slice(definitions.indexOf('const userNavGroupDefinitions'))
  assert.match(admin, /\{ key: 'customers', label: '客户查询', icon: 'user', badge: '建设中' \}/)
  assert.match(user, /\{ key: 'customers', label: '客户查询', icon: 'user', badge: '建设中' \}/)
  // 导航模板把正式字段渲染成可见标记，而不是隐藏字段。
  assert.match(source, /<i v-if="item\.badge">\{\{ item\.badge \}\}<\/i>/)
})

// 回归锁定：入口可见性仍由既有权限决定，不因补充导航而放宽。
test('customer section visibility still follows the existing customer.read permission', () => {
  const granted = { permissions: ['customer.read'] }
  const denied = { permissions: ['contract.read'] }
  assert.equal(canAccessContractSection(granted, 'customers'), true)
  assert.equal(canAccessContractSection(denied, 'customers'), false)
  assert.equal(canAccessContractSection({ roles: ['admin'] }, 'customers'), true)
})

// 回归锁定：页面是明确的“建设中”状态，而不是看起来像坏页的“暂无客户数据”。
test('customer page is an explicit in-progress state, not an empty data page', () => {
  const section = customersSection()
  assert.match(section, /<h3>客户查询建设中<\/h3>/)
  assert.match(section, /客户查询尚未开放：本页不读取、不展示客户数据/)
  assert.doesNotMatch(section, /暂无客户数据/)
  // 说明将要提供的能力，不承诺上线时间、不提供假数据。
  assert.match(section, /该能力上线后，可按客户名称或客户编号查询客户主数据/)
  assert.match(section, /历史合作合同、签约金额与履约进展/)
  assert.match(section, /不承诺上线时间/)
  assert.doesNotMatch(section, /v-for=/)
  assert.doesNotMatch(section, /listMyCustomers|客户列表/)
})

// 回归锁定：没有真实申请接口时，只提供可执行的真实替代动作与可复制的申请说明，
// 不出现点了没反应的按钮，也不虚构外部系统或联系方式。
test('customer page offers real alternative actions and copyable guidance', () => {
  const section = customersSection()
  assert.match(section, /<div class="contract-info-banner"><ConsoleIcon name="account" \/><span>查看某个客户的合同：进入「合同台账」/)
  assert.match(section, /<button v-if="can\('contract\.read'\)" class="contract-button primary" type="button" @click="navigate\('contracts'\)">去合同台账按客户名称查找<\/button>/)
  assert.match(section, /<button class="contract-button secondary" type="button" @click="copyCustomerQueryApplication">复制申请说明<\/button>/)
  assert.match(section, /<p class="contract-approval-summary">\{\{ customerQueryApplicationText \}\}<\/p>/)
  assert.match(section, /role="status"/)
  // 申请说明是页面可见文本，复制失败也能手动选取；复制走共享剪贴板工具。
  assert.match(source, /import \{ copyTextToClipboard \} from '@\/modules\/shared\/utils\/clipboard\.js'/)
  assert.match(source, /await copyTextToClipboard\(customerQueryApplicationText\.value\)/)
  assert.match(source, /申请说明已复制，可粘贴到工单或消息中发送给系统管理员。/)
  assert.match(source, /浏览器未允许自动复制，请手动选择页面上的申请说明文本复制。/)
  // 不新增申请/审批接口调用。
  assert.doesNotMatch(section, /fetch\(|axios|api\//)
})

// 回归锁定：分区说明保持既有业务描述，供面包屑与页面标题继续使用。
test('section metadata keeps the customer lookup description', () => {
  assert.match(source, /customers: \{ title: '客户查询', description: '查询客户主数据与历史合作情况' \}/)
})
