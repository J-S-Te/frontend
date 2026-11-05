// 项目分区指标卡：真实执行 NativeDashboardView 的 script setup + 模板，验证整改中取数、
// 显示/隐藏开关、全部隐藏空态与「租户 + 用户」偏好持久化，不挂载网络或会话生命周期。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import * as Vue from 'vue'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
import { renderToString } from '@vue/server-renderer'
import { dashboardFreshnessItems, dashboardFreshnessStatus } from './utils/freshness.js'
import {
  PROJECT_CARD_KEYS,
  cardHiddenStorageKey,
  metricColumnCount,
  normalizeHiddenCardKeys,
  readHiddenCardKeys,
  reportStageCount,
  visibleDashboardCards,
  writeHiddenCardKeys,
} from './utils/dashboardCardVisibility.js'

const source = readFileSync(new URL('./views/NativeDashboardView.vue', import.meta.url), 'utf8')
const { descriptor, errors } = parse(source, { filename: 'NativeDashboardView.vue' })
assert.deepEqual(errors, [])
const compiledScript = compileScript(descriptor, { id: 'da-native-dashboard' })
const compiledTemplate = compileTemplate({
  source: descriptor.template.content,
  filename: 'NativeDashboardView.vue',
  id: 'da-native-dashboard',
  compilerOptions: { bindingMetadata: compiledScript.bindings },
})
assert.deepEqual(compiledTemplate.errors, [])
const render = new Function('Vue', compiledTemplate.code
  .replace(/import \{([^}]+)\} from "vue"/g, (_, imports) => `const { ${imports.replace(/ as /g, ': ')} } = Vue`)
  .replace('export function render', 'return function render'))(Vue)

// 用途：去掉 script setup 的 import 行，其余代码原样执行；重依赖由 vm 上下文注入。
function stripImports(script) {
  const lines = script.split('\n')
  const kept = []
  let skipping = false
  for (const line of lines) {
    if (!skipping && /^import\b/.test(line)) {
      skipping = !/from\s+["'][^"']+["']\s*$/.test(line)
      continue
    }
    if (skipping) {
      if (/from\s+["'][^"']+["']\s*$/.test(line)) skipping = false
      continue
    }
    kept.push(line)
  }
  return kept.join('\n')
}

const componentCode = stripImports(compiledScript.content).replace('export default {', 'const __component = {')
const ConsoleIcon = { render: () => null }

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial))
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => { data.set(key, String(value)) },
    removeItem: (key) => { data.delete(key) },
    dump: () => Object.fromEntries(data),
  }
}

// 用途：按组件 props 定义补齐默认值，模拟运行时的 props 解析。
// 参数：definitions 为组件 props 选项，raw 为调用方传入的 props。
// 返回值：补齐默认值后的普通对象。
function resolveProps(definitions, raw) {
  const resolved = {}
  for (const [name, definition] of Object.entries(definitions || {})) {
    if (raw[name] !== undefined) { resolved[name] = raw[name]; continue }
    const fallback = definition?.default
    resolved[name] = typeof fallback === 'function' && definition.type !== Function ? fallback() : fallback
  }
  return resolved
}

// 用途：执行真实组件 setup 并服务端渲染，返回 HTML 与可调用的 setup 绑定。
// 参数：props 为分区与摘要，storage 为浏览器存储替身。
// 返回值：{ html, ui }；ui 暴露开关函数与隐藏集合。
async function mount(props, storage = memoryStorage()) {
  const context = {
    localStorage: storage,
    window: { localStorage: storage },
    ...Vue,
    // 生命周期挂载不在本测试范围：事件监听留给浏览器，这里只跑 setup 与渲染。
    onMounted: () => {},
    onBeforeUnmount: () => {},
    ConsoleIcon,
    dashboardFreshnessItems,
    dashboardFreshnessStatus,
    PROJECT_CARD_KEYS,
    cardHiddenStorageKey,
    metricColumnCount,
    normalizeHiddenCardKeys,
    readHiddenCardKeys,
    reportStageCount,
    visibleDashboardCards,
    writeHiddenCardKeys,
  }
  const component = vm.runInNewContext(`${componentCode}\n;({ __component })`, context).__component
  const bindings = component.setup(resolveProps(component.props, props), { expose: () => {} })
  const app = Vue.createSSRApp({ props: component.props, render, setup: () => bindings }, props)
  const html = await renderToString(app)
  return { html, ui: Vue.reactive({ ...bindings }), storage }
}

const cardCount = (html) => (html.match(/class="da-native-metric(?: [a-z]+)?"/g) || []).length

const collectedProject = {
  available: true,
  project_count: 12,
  in_flight_projects: 7,
  risk_projects: 2,
  service_items: 30,
  status_counts: { 实施中: 5, 已完成: 7 },
  report_stage_counts: { rectifying: 3, COMPILING: 2 },
}
const legacyProject = {
  available: true,
  project_count: 12,
  in_flight_projects: 7,
  risk_projects: 2,
  service_items: 30,
  status_counts: { 实施中: 5, 已完成: 7 },
  report_stage_counts: null,
}

test('项目分区渲染 5 张卡，整改中取 report_stage_counts 并归一化大小写', async () => {
  const { html } = await mount({ section: 'project', projectSummary: collectedProject, tenantId: 't1', userId: 'u1' })
  assert.equal(cardCount(html), 5)
  assert.match(html, /整改中项目/)
  assert.match(html, /da-native-metric warn/)
  assert.match(html, /报告整改阶段/)
  // 数值来自 RECTIFYING=3，而不是同快照的其他阶段。
  assert.match(html, /<strong>3<\/strong>/)
  // 列数随可见卡数（5 张）重算，不留空列。
  assert.match(html, /da-native-metrics da-native-metrics-cols-5/)
  // 设置入口与开关语义就位，默认全部开启。
  assert.match(html, /aria-haspopup="dialog"/)
  assert.match(html, /aria-expanded="false"/)
})

test('旧快照没有 report_stage_counts 时显示 — 与未采集，不把未知写成 0', async () => {
  const { html } = await mount({ section: 'project', projectSummary: legacyProject, tenantId: 't1', userId: 'u1' })
  assert.match(html, /整改中项目/)
  assert.match(html, /<strong>—<\/strong><small>个<\/small>/)
  assert.match(html, /未采集/)
  assert.doesNotMatch(html, /报告整改阶段/)
})

test('经营总览的项目组同样展示整改中卡，口径与项目分区一致', async () => {
  const overview = await mount({ section: 'overview', projectSummary: collectedProject, canViewContract: false, tenantId: 't1', userId: 'u1' })
  assert.equal(cardCount(overview.html), 5)
  assert.match(overview.html, /整改中项目/)
  const legacy = await mount({ section: 'overview', projectSummary: legacyProject, canViewContract: false, tenantId: 't1', userId: 'u1' })
  assert.match(legacy.html, /未采集/)
})

test('开关即时生效并按「租户 + 用户」持久化，未知与跨分区 key 被丢弃', async () => {
  const storage = memoryStorage()
  const first = await mount({ section: 'project', projectSummary: collectedProject, tenantId: 't1', userId: 'u1' }, storage)
  first.ui.toggleProjectCard('risk')
  assert.equal(first.ui.isProjectCardVisible('risk'), false)
  assert.equal(first.ui.isProjectCardVisible('rectifying'), true)
  const key = cardHiddenStorageKey('t1', 'u1')
  assert.equal(storage.getItem(key), JSON.stringify(['risk']))
  // 重新挂载后偏好生效：少一张卡，列数同步变化。
  const second = await mount({ section: 'project', projectSummary: collectedProject, tenantId: 't1', userId: 'u1' }, storage)
  assert.equal(cardCount(second.html), 4)
  assert.doesNotMatch(second.html, /<span>风险项目<\/span>/)
  assert.match(second.html, /da-native-metrics-cols-4/)
  // 存储里的未知 key 与跨分区 key 在读取时丢弃，不影响渲染。
  storage.setItem(key, JSON.stringify(['risk', 'contract_amount', 'bogus']))
  const third = await mount({ section: 'project', projectSummary: collectedProject, tenantId: 't1', userId: 'u1' }, storage)
  assert.equal(cardCount(third.html), 4)
  // 别的账号不受影响。
  const other = await mount({ section: 'project', projectSummary: collectedProject, tenantId: 't2', userId: 'u2' }, storage)
  assert.equal(cardCount(other.html), 5)
})

test('允许全部隐藏并显示空态，恢复默认清空存储项', async () => {
  const storage = memoryStorage()
  const first = await mount({ section: 'project', projectSummary: collectedProject, tenantId: 't1', userId: 'u1' }, storage)
  for (const key of PROJECT_CARD_KEYS) first.ui.toggleProjectCard(key)
  assert.equal(first.ui.allProjectCardsHidden, true)
  const hidden = await mount({ section: 'project', projectSummary: collectedProject, tenantId: 't1', userId: 'u1' }, storage)
  assert.equal(cardCount(hidden.html), 0)
  assert.match(hidden.html, /已隐藏全部指标卡/)
  assert.match(hidden.html, /role="status"/)
  hidden.ui.resetProjectCards()
  assert.equal(storage.getItem(cardHiddenStorageKey('t1', 'u1')), null)
  const restored = await mount({ section: 'project', projectSummary: collectedProject, tenantId: 't1', userId: 'u1' }, storage)
  assert.equal(cardCount(restored.html), 5)
})

test('无身份时只保留内存态，不写本地存储', async () => {
  const storage = memoryStorage()
  const { ui, storage: used } = await mount({ section: 'project', projectSummary: collectedProject, tenantId: '', userId: '' }, storage)
  ui.toggleProjectCard('rectifying')
  assert.deepEqual([...ui.projectCardHiddenKeys], ['rectifying'])
  assert.deepEqual(Object.keys(used.dump()), [])
})

test('设置面板可展开收起，Escape 关闭且不切换任何卡片', async () => {
  const { ui } = await mount({ section: 'project', projectSummary: collectedProject, tenantId: 't1', userId: 'u1' })
  ui.openCardSettings()
  assert.equal(ui.cardSettingsOpen, true)
  ui.onCardSettingsKeydown({ key: 'Escape', stopPropagation: () => {} })
  assert.equal(ui.cardSettingsOpen, false)
  assert.deepEqual([...ui.projectCardHiddenKeys], [])
  ui.openCardSettings()
  ui.onCardSettingsKeydown({ key: 'Enter', stopPropagation: () => {} })
  assert.equal(ui.cardSettingsOpen, true)
})

test('其他分区不参与项目卡开关，仍展示全部指标', async () => {
  const storage = memoryStorage({ [cardHiddenStorageKey('t1', 'u1')]: JSON.stringify(['risk']) })
  const contract = await mount({ section: 'contract', contractSummary: { available: true, total_contracts: 4, approval_contracts: 1, active_contracts: 2, expired_contracts: 1, total_amount_minor: 120000000 }, tenantId: 't1', userId: 'u1' }, storage)
  assert.equal(cardCount(contract.html), 5)
  assert.doesNotMatch(contract.html, /da-native-metrics-toolbar/)
})
