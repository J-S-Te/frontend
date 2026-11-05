import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import * as Vue from 'vue'
import * as api from './api/dataAnalysis.js'

const source = await readFile(new URL('./views/DashboardShellView.vue', import.meta.url), 'utf8')

// 用途：执行真实外壳脚本并注入隔离网络边界，检查嵌入与原生摘要请求行为。
// 参数：session 为受认证会话返回值；failure 为可选嵌入请求异常。
// 返回值：外壳状态、挂载回调和接口调用记录。
function shellHarness(session, failure = null) {
  const calls = { embed: 0, summary: 0 }
  let mounted
  const summary = async () => { calls.summary++; return { available: false } }
  const context = {
    ...Vue, onMounted: (callback) => { mounted = callback }, onBeforeUnmount: () => {},
    inject: () => null,
    useRoute: () => ({ params: { section: 'finance' }, query: {} }),
    useRouter: () => ({ replace: async () => {}, push: () => {} }),
    useUrlFilterState: () => {}, loginUsername: () => 'test',
    createEmbedSessionActivity: () => ({ reset: () => {}, destroy: () => {} }),
    subscribeRelatedDataChanges: () => () => {}, RELATED_DATA: {},
    getAuthMe: async () => session,
    getEmbedToken: async () => { calls.embed++; if (failure) throw failure; return {} },
    getFinanceDashboardSummary: summary, getContractDashboardSummary: summary,
    getProjectDashboardSummary: summary, getReportDashboardSummary: summary,
    getContractDetails: summary, getDashboardTrend: summary, getAlertSummary: summary,
    isDashboardEmbedEnabled: api.isDashboardEmbedEnabled,
    isolatedEmbedUrl: () => 'https://charts.example.net/frame',
    formatDataAnalysisError: (error) => error.message,
    window: { clearTimeout, setTimeout, location: { origin: 'https://platform.example.org' } },
    document: { addEventListener: () => {}, removeEventListener: () => {}, visibilityState: 'visible' },
  }
  const script = source.match(/<script setup>([\s\S]*?)<\/script>/)[1].replace(/^import .*$/gm, '')
  const state = vm.runInNewContext(`${script}\n;({ me, iframeSrc, iframeError, iframeLoading, dashboardSummary, refreshCurrentDashboard, loadDashboard })`, context)
  return { calls, state, mount: () => mounted() }
}

test('explicit false disables embedding and legacy sessions keep embedding enabled', () => {
  assert.equal(typeof api.isDashboardEmbedEnabled, 'function', 'capability reader is missing')
  assert.equal(api.isDashboardEmbedEnabled({ capabilities: { dashboard_embed_enabled: false } }), false)
  assert.equal(api.isDashboardEmbedEnabled({ capabilities: { dashboard_embed_enabled: true } }), true)
  assert.equal(api.isDashboardEmbedEnabled({ permissions: [] }), true)
})

test('native mode mounts and refreshes real summaries without issuing an embed grant', async () => {
  const h = shellHarness({ permissions: ['dashboard.finance.view'], capabilities: { dashboard_embed_enabled: false } })
  await h.mount()
  await h.state.refreshCurrentDashboard()
  assert.equal(h.calls.embed, 0)
  assert.equal(h.calls.summary, 2)
  assert.equal(h.state.dashboardSummary.value.available, false)
  assert.equal(h.state.iframeError.value, null)
  assert.equal(h.state.iframeSrc.value, '')
})

test('temporary embed outage stays visible when embedding is enabled', async () => {
  const h = shellHarness({ permissions: ['dashboard.finance.view'] }, new Error('嵌入服务暂不可达'))
  await h.mount()
  assert.equal(h.calls.embed, 1)
  assert.equal(h.calls.summary, 1)
  assert.equal(h.state.iframeError.value, '嵌入服务暂不可达')
})


test('server capability change discards an old iframe and prevents later embed refresh', async () => {
  const h = shellHarness({ permissions: ['dashboard.finance.view'] })
  await h.mount()
  assert.equal(h.state.iframeSrc.value, 'https://charts.example.net/frame')
  h.state.me.value = {
    permissions: ['dashboard.finance.view'], capabilities: { dashboard_embed_enabled: false },
  }
  await Vue.nextTick()
  assert.equal(h.state.iframeSrc.value, '')
  assert.equal(h.state.iframeError.value, null)
  await h.state.refreshCurrentDashboard()
  assert.equal(h.calls.embed, 1)
  assert.equal(h.calls.summary, 2)
})
