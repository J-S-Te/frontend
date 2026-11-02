import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const contract = await readFile(new URL('../../contract_management/api/contract.js', import.meta.url), 'utf8')
const crm = await readFile(new URL('../../customer_opportunity/api/client.js', import.meta.url), 'utf8')
const project = await readFile(new URL('../../project_management/api/projectManagement.js', import.meta.url), 'utf8')
const dataAnalysis = await readFile(new URL('../../data_analysis/api/dataAnalysis.js', import.meta.url), 'utf8')
const app = await readFile(new URL('../../platform/app/App.vue', import.meta.url), 'utf8')
const router = await readFile(new URL('../../../router/index.js', import.meta.url), 'utf8')

test('四个业务子系统客户端都提供活动上报与只读空闲探测', () => {
  for (const [name, source, activity, probe] of [
    ['contract', contract, 'recordContractSessionActivity', 'getContractSession'],
    ['crm', crm, 'recordCRMSessionActivity', 'probeCRMSession'],
    ['project', project, 'recordProjectSessionActivity', 'probeProjectSession'],
    ['data_analysis', dataAnalysis, 'recordDataAnalysisSessionActivity', 'probeDataAnalysisSession'],
  ]) {
    assert.match(source, new RegExp('export (async )?function ' + activity), name + ' 活动上报入口')
    assert.match(source, /\/auth\/activity/, name + ' 活动接口路径')
    assert.match(source, new RegExp(probe), name + ' 探测入口')
  }
  // 合同/项目客户端自行拼装写请求头；CRM/数析请求包装器按方法自动加 CSRF。
  assert.match(contract, /headers: \{ Accept: 'application\/json', 'X-CSRF-Token': '1' \}/)
  assert.match(project, /headers: \{ Accept: 'application\/json', 'X-CSRF-Token': '1' \}/)
  assert.match(crm, /requiresCSRF \? \{ 'X-CSRF-Token': '1' \}/)
  assert.match(dataAnalysis, /requiresCSRF \? \{ 'X-CSRF-Token': '1' \}/)
})

test('探测请求不得自行触发子系统登录跳转（由生命周期统一收口）', () => {
  assert.match(contract, /suppressLoginRedirect: true/)
  assert.match(crm, /const suppressLoginRedirect = options\.suppressLoginRedirect === true/)
  assert.match(crm, /if \(!suppressLoginRedirect && shouldStartSubsystemLogin\(error\)\) redirectToLogin\(\)/)
  assert.match(project, /if \(options\.suppressLoginRedirect\) throw error/)
  assert.match(dataAnalysis, /const suppressLoginRedirect = options\.suppressLoginRedirect === true/)
  assert.match(dataAnalysis, /if \(!suppressLoginRedirect && shouldStartSubsystemLogin\(error\)\) startDataAnalysisLogin\(\)/)
})

test('各子系统登录入口可被空闲生命周期复用', () => {
  assert.match(contract, /export function startContractLogin/)
  assert.match(crm, /export function startCRMLogin/)
  assert.match(project, /export function startProjectLogin/)
  assert.match(dataAnalysis, /export function startDataAnalysisLogin/)
})

test('根组件按路由挂载对应子系统的空闲生命周期', () => {
  assert.match(app, /createSubsystemSessionLifecycle/)
  assert.match(app, /requiresContractSession/)
  assert.match(app, /requiresCRMSession/)
  assert.match(app, /requiresProjectSession/)
  assert.match(app, /requiresDataAnalysisSession/)
  assert.match(app, /subsystemLifecycle\.start\(/)
  assert.match(app, /subsystemLifecycle\.stop\(\)/)
  assert.match(app, /onIdle: \(\) => \{ activeSubsystemAdapter\.current\?\.login\?\.\(\) \}/)
  assert.match(app, /watch\(subsystemSessionAdapter/)
  assert.match(app, /subsystemLifecycle\.refresh\(\)/)
  assert.match(app, /Number\(error\?\.status\) === 401\) adapter\.login\?\.\(\)/)
})

test('路由 meta 与适配器选择使用同一组会话标记', () => {
  for (const flag of ['requiresContractSession', 'requiresCRMSession', 'requiresProjectSession', 'requiresDataAnalysisSession']) {
    assert.match(router, new RegExp(flag))
  }
})
