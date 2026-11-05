import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import * as Vue from 'vue'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
import { renderToString } from '@vue/server-renderer'
import { formatUserError, userErrorDiagnostics } from '../shared/utils/userError.js'

function templateRender(descriptor, bindings) {
  const compiled = compileTemplate({ source: descriptor.template.content, filename: descriptor.filename, id: 'scope-error-view', compilerOptions: { bindingMetadata: bindings } })
  assert.deepEqual(compiled.errors, [])
  const code = compiled.code
    .replace(/import \{([^}]+)\} from "vue"/g, (_, imports) => `const { ${imports.replace(/ as /g, ': ')} } = Vue`)
    .replace('export function render', 'return function render')
  return new Function('Vue', code)(Vue)
}

const shell = parse(await readFile(new URL('./views/DashboardShellView.vue', import.meta.url), 'utf8')).descriptor
const errorDescriptor = parse(await readFile(new URL('../shared/components/ErrorState.vue', import.meta.url), 'utf8')).descriptor
const errorScript = compileScript(errorDescriptor, { id: 'scope-error-state' })
const icon = { render: () => null }
const ErrorState = new Function('computed', 'ConsoleIcon', 'formatUserError', 'userErrorDiagnostics', errorScript.content.replace(/^import .*$/gm, '').replace('export default', 'return'))(Vue.computed, icon, formatUserError, userErrorDiagnostics)
ErrorState.render = templateRender(errorDescriptor, errorScript.bindings)
const render = templateRender(shell)
const sections = ['overview', 'contract', 'project', 'report', 'finance']
const scopeMessage = '当前数据范围无法读取此统计；报告与财务看板暂仅支持经授权的全租户范围。'

// 用途：渲染真实外壳模板与错误组件，不挂载会话或网络生命周期。
// 参数：section 为看板分区，summaryError 为摘要错误，overrides 为场景状态。
// 返回值：服务端渲染的 HTML。
async function renderSummary(section, summaryError, overrides = {}) {
  const noop = () => {}
  const app = Vue.createSSRApp({
    render,
    setup: () => ({
      section, summaryError, summaryLoading: false, loadError: '', mobileMenuOpen: false,
      currentMeta: ['业务看板', '统计'], currentUserInitial: '测', currentUserName: '测试', currentUserRole: '总监',
      dataScopeLabel: '管辖团队', scopeModeLabel: '团队', scopeEmptyHint: '', navGroups: [], statusOptions: [], statusFilter: '全部', isLoggingOut: false,
      DASHBOARD_SECTIONS: sections, DASHBOARD_CODES: Object.fromEntries(sections.map(value => [value, value])),
      EMBEDDED_DASHBOARD_SECTIONS: [], dashboardEmbedEnabled: true, iframeLoading: false,
      overviewSummary: {}, dashboardSummary: null, contractDetails: {}, dashboardTrend: [], alertSummary: null, detailError: '',
      // 外壳把 /auth/me 的 tenant_id/user_id 传给原生看板做「租户+用户」级指标卡偏好，渲染前需有 me。
      me: null,
      hasPermission: () => true, canViewDashboard: () => true,
      navigate: noop, returnToUnifiedPortal: noop, logoutSystem: noop, refreshCurrentDashboard: noop, loadMe: noop, loadSummary: noop,
      ...overrides,
    }),
  })
  app.component('ConsoleIcon', icon)
  app.component('ErrorState', ErrorState)
  app.component('LoadingState', { render: () => null })
  app.component('NativeDashboardView', { render: () => null })
  app.component('ContractImportHistoryPanel', { render: () => null })
  app.component('AlertsCenterView', { render: () => null })
  app.component('DictionaryView', { render: () => null })
  app.component('AdminSourcesView', { render: () => null })
  app.component('AlertRulesView', { render: () => null })
  return renderToString(app)
}

test('report and finance display the actual scope denial instead of hiding it as missing statistics', async () => {
  for (const section of ['report', 'finance']) {
    const html = await renderSummary(section, scopeMessage)
    assert.ok(html.includes(scopeMessage), `${section}: missing readable scope denial`)
    assert.match(html, /role="alert"/)
  }
})

test('authorized report and finance summaries do not display a stale scope error', async () => {
  for (const section of ['report', 'finance']) {
    const html = await renderSummary(section, '')
    assert.ok(!html.includes(scopeMessage))
    assert.doesNotMatch(html, /role="alert"/)
  }
})

// —— DATA-09：当前数据范围标签与空范围提示 ——
const shellSource = readFileSync(new URL('./views/DashboardShellView.vue', import.meta.url), 'utf8')

// 用途：执行视图里真实的数据范围 computed，验证标签与空范围判定。
// 参数：meValue 为 /auth/me 返回值；返回值：范围相关 ref（访问时重新计算，不做缓存）。
function scopeState(meValue) {
  const start = shellSource.indexOf('const SCOPE_MODE_LABELS = {')
  const hintStart = shellSource.indexOf('const scopeEmptyHint = computed')
  assert.ok(start >= 0 && hintStart > start, '外壳必须保留数据范围标签与空范围提示')
  const end = shellSource.indexOf('\n', hintStart) + 1
  const block = shellSource.slice(start, end)
  return vm.runInNewContext(
    `${block}\n;({ scopeMode, scopeModeLabel, scopeCollectionEmpty, scopeEmptyHint })`,
    { me: { value: meValue }, computed: (fn) => ({ get value() { return fn() } }) },
  )
}

test('scope_mode 映射为团队/组织/个人/全租户标签', () => {
  assert.equal(scopeState({ scope_mode: 'TEAM' }).scopeModeLabel.value, '团队')
  assert.equal(scopeState({ scope_mode: 'ORG' }).scopeModeLabel.value, '组织')
  assert.equal(scopeState({ scope_mode: 'SELF' }).scopeModeLabel.value, '个人')
  assert.equal(scopeState({ scope_mode: 'TENANT' }).scopeModeLabel.value, '全租户')
  // 小写与多余空格同样识别。
  assert.equal(scopeState({ scope_mode: ' team ' }).scopeModeLabel.value, '团队')
})

test('会话未暴露 scope_mode 时不猜测范围，也不提示可能无数据', () => {
  for (const meValue of [null, {}, { roles: ['tech_director'] }, { scope_mode: 'UNKNOWN_MODE' }]) {
    const state = scopeState(meValue)
    assert.equal(state.scopeModeLabel.value, '', '未知或缺失的范围模式不得显示标签')
    assert.equal(state.scopeCollectionEmpty.value, false)
    assert.equal(state.scopeEmptyHint.value, '')
  }
})

test('仅当范围集合明确为空时提示可能无数据，字段未上线不误报', () => {
  // 明确返回空数组：团队/组织视角都提示可能无数据。
  assert.equal(scopeState({ scope_mode: 'TEAM', team_ids: [] }).scopeCollectionEmpty.value, true)
  assert.match(scopeState({ scope_mode: 'TEAM', team_ids: [] }).scopeEmptyHint.value, /可能看不到任何数据/)
  assert.match(scopeState({ scope_mode: 'TEAM', team_ids: [] }).scopeEmptyHint.value, /不代表系统故障/)
  assert.equal(scopeState({ scope_mode: 'ORG', organization_ids: [], team_ids: [] }).scopeCollectionEmpty.value, true)
  assert.equal(scopeState({ scope_mode: 'NONE' }).scopeCollectionEmpty.value, true)
  // 有范围、全租户、个人范围都不是“空范围”。
  assert.equal(scopeState({ scope_mode: 'TEAM', team_ids: ['t1'] }).scopeEmptyHint.value, '')
  assert.equal(scopeState({ scope_mode: 'ORG', organization_ids: ['o1'] }).scopeEmptyHint.value, '')
  assert.equal(scopeState({ scope_mode: 'TENANT' }).scopeEmptyHint.value, '')
  assert.equal(scopeState({ scope_mode: 'SELF' }).scopeEmptyHint.value, '')
  // 字段未上线（undefined）不能当成空集合，否则会把接口未就绪误判成系统故障。
  assert.equal(scopeState({ scope_mode: 'TEAM' }).scopeEmptyHint.value, '')
  // ORG 视角的授权是组织与团队范围的并集：已返回的集合全部为空时才提示，任一非空即不提示。
  assert.match(scopeState({ scope_mode: 'ORG', organization_ids: [] }).scopeEmptyHint.value, /可能看不到任何数据/)
  assert.equal(scopeState({ scope_mode: 'ORG', organization_ids: [], team_ids: ['t1'] }).scopeEmptyHint.value, '')
})

test('范围标签与空范围提示以非错误样式渲染', async () => {
  const hint = '当前账号的数据范围集合为空，看板可能看不到任何数据；这不代表系统故障，请联系管理员补齐团队/组织授权。'
  const withScope = await renderSummary('overview', '', { scopeModeLabel: '团队', scopeEmptyHint: hint })
  assert.ok(withScope.includes('数据范围：团队'), '页面头必须显示当前数据范围标签')
  assert.ok(withScope.includes(hint), '空范围时必须提示可能无数据')
  assert.match(withScope, /role="status"/, '范围提示是状态说明，不用 alert 语义')
  assert.match(withScope, /class="da-native-note"/)
  const withoutScope = await renderSummary('overview', '', { scopeModeLabel: '', scopeEmptyHint: '' })
  assert.ok(!withoutScope.includes(hint))
  assert.doesNotMatch(withoutScope, /数据范围：/)
  assert.doesNotMatch(withoutScope, /role="status"/)
})


test('原生模式不渲染嵌入区域，启用模式保留临时不可达错误', async () => {
  const overrides = {
    EMBEDDED_DASHBOARD_SECTIONS: ['overview', 'report', 'finance'],
    iframeError: '嵌入服务暂不可达', iframeSrc: '', embedFrame: null,
    embedActivity: {}, loadDashboard: () => {},
  }
  const nativeHtml = await renderSummary('finance', '', { ...overrides, dashboardEmbedEnabled: false })
  assert.doesNotMatch(nativeHtml, /da-frame-panel|嵌入服务暂不可达|<iframe/)
  const embeddedHtml = await renderSummary('finance', '', { ...overrides, dashboardEmbedEnabled: true })
  assert.match(embeddedHtml, /da-frame-panel/)
  assert.match(embeddedHtml, /嵌入服务暂不可达/)
})
