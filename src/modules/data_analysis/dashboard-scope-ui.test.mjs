import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
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
const errorDescriptor = parse(await readFile(new URL('../platform/shared/components/ErrorState.vue', import.meta.url), 'utf8')).descriptor
const errorScript = compileScript(errorDescriptor, { id: 'scope-error-state' })
const icon = { render: () => null }
const ErrorState = new Function('computed', 'ConsoleIcon', 'formatUserError', 'userErrorDiagnostics', errorScript.content.replace(/^import .*$/gm, '').replace('export default', 'return'))(Vue.computed, icon, formatUserError, userErrorDiagnostics)
ErrorState.render = templateRender(errorDescriptor, errorScript.bindings)
const render = templateRender(shell)
const sections = ['overview', 'contract', 'project', 'report', 'finance']
const scopeMessage = '当前数据范围无法读取此统计；报告与财务看板暂仅支持经授权的全租户范围。'

// 验证生产模板与 ErrorState 渲染，不挂载外壳的会话或网络
// 生命周期，也不替换其错误分支逻辑。
async function renderSummary(section, summaryError) {
  const noop = () => {}
  const app = Vue.createSSRApp({
    render,
    setup: () => ({
      section, summaryError, summaryLoading: false, loadError: '', mobileMenuOpen: false,
      currentMeta: ['业务看板', '统计'], currentUserInitial: '测', currentUserName: '测试', currentUserRole: '总监',
      dataScopeLabel: '管辖团队', navGroups: [], statusOptions: [], statusFilter: '全部', isLoggingOut: false,
      DASHBOARD_SECTIONS: sections, DASHBOARD_CODES: Object.fromEntries(sections.map(value => [value, value])),
      EMBEDDED_DASHBOARD_SECTIONS: [], iframeLoading: false,
      overviewSummary: {}, dashboardSummary: null, contractDetails: {}, dashboardTrend: [], alertSummary: null, detailError: '',
      hasPermission: () => true, canViewDashboard: () => true,
      navigate: noop, returnToUnifiedPortal: noop, logoutSystem: noop, refreshCurrentDashboard: noop, loadMe: noop, loadSummary: noop,
    }),
  })
  app.component('ConsoleIcon', icon)
  app.component('ErrorState', ErrorState)
  app.component('LoadingState', { render: () => null })
  app.component('NativeDashboardView', { render: () => null })
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
