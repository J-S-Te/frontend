import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { parse, compileScript } from '@vue/compiler-sfc'
import { sessionTargetForRoute } from './sessionTransport.js'

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

test('根组件按路由使用统一会话生命周期，独立Cookie入口与活动代理由transport选择', () => {
  const { descriptor } = parse(app)
  const { bindings } = compileScript(descriptor, { id: 'root-session-contract' })
  for (const name of ['createUnifiedSessionLifecycle', 'createSessionTransport',
    'sessionTargetForRoute', 'lifecycle', 'transport']) {
    assert.ok(bindings[name], name + ' 必须在实际SFC作用域中定义')
  }
  assert.match(app, /read: transport\.read/)
  assert.match(app, /activity: transport\.activity/)
  assert.match(app, /watch\(\(\) => sessionTargetForRoute\(route\.meta\)\?\.key/)
  assert.match(app, /if \(platformSessionMode !== 'central'\) \{ lifecycle\.stop\(\); return \}/)
  assert.match(app, /if \(target\?\.key !== 'Platform'\) void lifecycle\.setTarget\(target\)/)
  assert.match(app, /provide\('central-session-record-activity', lifecycle\.recordEmbeddedActivity\)/)
  assert.match(app, /lifecycle\.destroy\(\)/)
  assert.doesNotMatch(app, /createSubsystemSessionLifecycle|subsystemLifecycle|subsystemSessionAdapter|activeSubsystemAdapter/)
  for (const name of ['Platform', 'Contract', 'Project', 'Settlement', 'CRM', 'Portal', 'DataAnalysis']) {
    const target = sessionTargetForRoute({ ['requires' + name + 'Session']: true }, {})
    assert.equal(target.key, name)
    assert.match(target.stateURL, /\/auth\/(me|session)$/)
    assert.match(target.activityURL, /\/auth\/activity$/)
  }
  assert.equal(sessionTargetForRoute({}, {}), null, '公开路由必须清除当前入口')
  assert.throws(() => sessionTargetForRoute({ requiresContractSession: true,
    requiresProjectSession: true }, {}), /冲突/, '禁止同时使用两个入口会话时钟')
})

test('平台滚动发布按权威响应互斥启用中央或legacy时钟，权限轮询不得重启旧空闲窗口', () => {
  assert.match(app, /if \(principal\.session_context\) \{\s*legacyLifecycle\?\.stop\(\)/)
  assert.match(app, /platformSessionMode = 'central'\s*void lifecycle\.setTarget\(sessionTargetForRoute\(route\.meta\)\)/)
  assert.match(app, /else if \(platformSessionMode !== 'legacy'\) \{\s*lifecycle\.stop\(\)/)
  assert.match(app, /platformSessionMode = 'legacy'\s*legacyLifecycle\.start\(principal\)/)
  assert.match(app, /legacyLifecycle\?\.destroy\(\)/)
})

test('路由 meta 与适配器选择使用同一组会话标记', () => {
  for (const flag of ['requiresContractSession', 'requiresCRMSession', 'requiresProjectSession', 'requiresDataAnalysisSession']) {
    assert.match(router, new RegExp(flag))
  }
})
