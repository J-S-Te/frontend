import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { CONTRACT_SECTION_PERMISSIONS, canAccessContractSection } from '../shared/authz/sys004.js'

// 客户查询模块暂不上线（2026-11-07）：本文件语义整体反转——旧断言要求“入口必须可见、
// 页面必须存在、权限可进”，现在锁定“三处同时下线、无法通过 URL 或侧栏进入”。
// 恢复客户查询时，把本文件与三处源码注释一起回退。
const source = await readFile(new URL('./views/ContractManagementView.vue', import.meta.url), 'utf8')
const routerSource = await readFile(new URL('../../router/index.js', import.meta.url), 'utf8')
const apiSource = await readFile(new URL('./api/contract.js', import.meta.url), 'utf8')

// activeLines 只保留真正生效的源码行，注释保留的代码不算“仍在上线”。
// 参数：text 为文件全文。
// 返回值：既不是 // 也不是 <!-- --> 注释、且非空的行。
function activeLines(text) {
  return text.split('\n').filter((line) => {
    const trimmed = line.trim()
    return trimmed !== '' && !trimmed.startsWith('//') && !trimmed.startsWith('<!--')
  })
}

// 回归锁定：路由分区清单不再登记 customers，否则 URL 仍能进入一个空白页。
test('contract route sections no longer include the customer lookup section', () => {
  const sectionsLine = routerSource
    .split('\n')
    .find((line) => line.startsWith('const contractSections = ['))
  assert.ok(sectionsLine, '缺少 contractSections 定义')
  assert.doesNotMatch(sectionsLine, /'customers'/)
  // 其余分区与顺序保持不变，避免顺手打乱首个允许分区的回落顺序。
  assert.match(sectionsLine, /const contractSections = \['dashboard', 'intakes', 'contracts', 'imports', 'templates', 'approvals', 'rules', 'signing', 'reports', 'outbox'\]/)
  // 注释保留原入口，便于日后恢复时不必重写清单。
  assert.match(routerSource, /^\/\/ 'customers',$/m)
  // 守卫仍以 contractSections 作为回落范围。
  assert.match(routerSource, /const firstAllowedSection = contractSections\.find\(\(section\) => canAccessContractSection\(session, section\)\)/)
})

// 回归锁定：权限层同时移除分区键与总监白名单项，三个总监角色不能再穿过守卫。
test('authz layer no longer registers or whitelists the customer section', () => {
  assert.equal(Object.hasOwn(CONTRACT_SECTION_PERMISSIONS, 'customers'), false)
  for (const session of [
    { role: { code: 'admin' }, permissions: ['customer.read'] },
    { roles: ['admin'], permissions: ['all'] },
    { roles: ['sales_director'], permissions: ['customer.read'] },
    { roles: ['tech_director'], permissions: ['customer.read'] },
    { roles: ['finance_director'], permissions: ['customer.read'] },
    { roles: ['sales'], permissions: ['customer.read'] },
  ]) {
    assert.equal(canAccessContractSection(session, 'customers'), false, JSON.stringify(session))
  }
})

// 回归锁定：两个侧栏入口都已注释下线，且没有留下空分组。
test('admin and non-admin sidebars no longer expose the customer section', () => {
  const definitions = source.slice(
    source.indexOf('const adminNavGroupDefinitions'),
    source.indexOf('const contracts = ref([])'),
  )
  const admin = definitions.slice(0, definitions.indexOf('const userNavGroupDefinitions'))
  const user = definitions.slice(definitions.indexOf('const userNavGroupDefinitions'))
  for (const [name, block] of [['管理员', admin], ['非管理员', user]]) {
    assert.doesNotMatch(block, /^\s*\{ key: 'customers'/m, `${name}侧栏仍暴露客户查询入口`)
  }
  // 注释保留原入口行，恢复时放开即可。
  assert.match(admin, /\/\/ \{ key: 'customers', label: '客户查询', icon: 'user', badge: '建设中' \},/)
  assert.match(user, /\/\/ \{ key: 'customers', label: '客户查询', icon: 'user', badge: '建设中' \},/)
  // 空分组会被过滤掉，但入口移除后原分组仍有其它条目，不依赖该过滤兜底。
  const lookupGroup = admin.slice(admin.indexOf(`label: '查询台账'`), admin.indexOf(`label: '配置管理'`))
  assert.match(lookupGroup, /^\s*\{ key: 'signing'/m)
  const businessGroup = user.slice(user.indexOf(`label: '合同业务'`), user.indexOf(`label: '审批协同'`))
  assert.match(businessGroup, /^\s*\{ key: 'contracts'/m)
  assert.match(businessGroup, /^\s*\{ key: 'imports'/m)
})

// 回归锁定：分区模板、分区说明与申请说明逻辑都以注释保留，不参与渲染。
test('customer section template, metadata and copy helpers are commented out', () => {
  const active = activeLines(source)
  for (const line of active) {
    assert.doesNotMatch(line, /activeSection === 'customers'/, `仍有生效的客户查询模板：${line}`)
    assert.doesNotMatch(line, /^\s*customers: \{ title: '客户查询'/, `仍有生效的分区说明：${line}`)
    assert.doesNotMatch(line, /customerQuery(CopyHint|ApplicationText)/, `仍有生效的申请说明引用：${line}`)
    assert.doesNotMatch(line, /copyCustomerQueryApplication/, `仍有生效的复制处理函数：${line}`)
    assert.doesNotMatch(line, /copyTextToClipboard/, `仍有生效的剪贴板 import：${line}`)
  }
  // 注释保留完整模板块，恢复时整块放开即可。
  assert.match(source, /<!--\s*<template v-else-if="activeSection === 'customers'">/)
  assert.match(source, /<!--\s*<h3>客户查询建设中<\/h3>/)
  assert.match(source, /\/\/ customers: \{ title: '客户查询', description: '查询客户主数据与历史合作情况' \},/)
  // 回落：activeSection 用 sectionMeta 校验，键移除后落回 dashboard。
  assert.match(source, /return sectionMeta\[section\] \? section : 'dashboard'/)
})

// 红线：下线的只是“建设中”占位页，新建合同/Excel 导入/提交前核验仍依赖 CRM 客户查询接口。
test('customer lookup removal keeps the CRM lookup used by contract creation intact', () => {
  assert.match(apiSource, /const CUSTOMER_API_BASE_URL = /)
  assert.match(apiSource, /export async function listMyCustomers/)
  assert.match(apiSource, /export async function listMyOpportunities/)
  const active = activeLines(source)
  assert.ok(active.some((line) => /await listMyCustomers\(/.test(line)), '新建合同的客户核验仍必须调用 listMyCustomers')
})
