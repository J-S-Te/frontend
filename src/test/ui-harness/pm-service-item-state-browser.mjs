// 服务项状态同步的最小隔离验收：真实页面、路由、API 客户端和样式，HTTP 仅返回合成快照。
// 运行：PM_STATE_OUTPUT_DIR=/tmp/pm-service-item-state-ui node src/test/ui-harness/pm-service-item-state-browser.mjs
// 验证编制、归档、准备三份快照的刷新显示；拦截所有外部请求并拒绝业务写入，不连接数据库。
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { compileScript, compileStyle, parse } from '@vue/compiler-sfc'
import { build } from 'esbuild'
import { chromium } from 'playwright-core'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const output = process.env.PM_STATE_OUTPUT_DIR || '/tmp/pm-service-item-state-ui'
const origin = 'http://127.0.0.1:18191'
const styles = new Map()
const entry = `
import { createApp } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';
import View from './src/modules/project_management/views/ProjectManagementView.vue';
import './src/modules/platform/shared/styles/main.css';
import './src/modules/platform/shared/styles/state.css';
import './src/modules/shared/styles/global-ux.css';
const router = createRouter({ history: createMemoryHistory(), routes: [
  { path: '/project_management/:section', name: 'project_management', component: View },
] });
// 用途：挂载真实页面与内存路由，隔离浏览器历史。
// 参数：无。
// 返回值：页面就绪的 Promise；挂载失败时抛出错误。
window.__mountPMState = async function mountPMState() {
  await router.push('/project_management/reports');
  await router.isReady();
  createApp(View).use(router).mount('#app');
};
`
const plugin = {
  name: 'pm-state-real-components',
  // 用途：编译真实 Vue 组件及作用域样式，不替换产品逻辑。
  // 参数：builder 为 esbuild 插件接口。
  // 返回值：无；编译错误由构建向上抛出。
  setup(builder) {
    builder.onLoad({ filter: /\.vue$/ }, async ({ path: filename }) => {
      const { descriptor } = parse(await readFile(filename, 'utf8'), { filename })
      const id = `data-v-${createHash('sha256').update(filename).digest('hex').slice(0, 8)}`
      const script = compileScript(descriptor, { id, inlineTemplate: true,
        genDefaultAs: '__fixtureComponent', templateOptions: { compilerOptions: { scopeId: id } } })
      styles.set(filename, descriptor.styles.map(style => {
        const result = compileStyle({ source: style.content, filename, id, scoped: style.scoped })
        assert.deepEqual(result.errors, [])
        return result.code
      }).join('\n'))
      return { contents: `${script.content}\n__fixtureComponent.__scopeId=${JSON.stringify(id)};
        export default __fixtureComponent;`, loader: 'ts', resolveDir: path.dirname(filename) }
    })
  },
}
const bundle = await build({
  stdin: { contents: entry, resolveDir: root, sourcefile: 'pm-state-entry.js' },
  bundle: true, write: false, format: 'iife', platform: 'browser', outdir: 'out',
  define: { 'import.meta.env': '{}', __VUE_OPTIONS_API__: 'true',
    __VUE_PROD_DEVTOOLS__: 'false', __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false' },
  alias: { '@': root + 'src' },
  loader: { '.css': 'css' }, plugins: [plugin],
})
const js = bundle.outputFiles.find(file => file.path.endsWith('.js'))?.text
const css = bundle.outputFiles.find(file => file.path.endsWith('.css'))?.text
assert.ok(js && css, '真实页面构建不完整')
const shell = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>html,body{margin:0}${css}${[...styles.values()].join('\n')}</style></head>
  <body><div id="app"></div></body></html>`
const session = {
  tenant_id: 'tenant-state', user_id: 'manager-state', identity_id: 'manager-state',
  subject_id: 'manager-state', username: '合成项目经理', display_name: '合成项目经理',
  roles: ['project_manager'], permissions: ['project.read', 'project.report.prepare',
    'project.implementation.plan'], data_scopes: [{ type: 'TENANT', id: 'tenant-state' }],
  authorization_revision: 1, catalog_version: 'state-fixture', idle_timeout_seconds: 3600,
}
const project = { id: 'P-STATE', name: '合成状态同步项目', customer: '合成客户',
  customer_id: 'C-STATE', contract: 'HT-STATE', services: 1, version: 7,
  status: '报告编制', report_stage: 'COMPILING' }
const item = { id: 'SI-STATE', project_id: project.id, system: '合成办公系统',
  site: '合成场所', category: '软件测试', batch: '第一批', special: '否', test_mode: 'STANDARD',
  team_lead_id: 'lead-state', project_manager_id: session.user_id, engineer_ids: ['engineer-state'],
  conflict_status: 'PASSED', tech_review_status: 'NOT_REQUIRED', version: 7,
  status: '现场实施完成', report_status: 'COMPILING', report_revision: 1,
  implementation_plan: { planned_start: '2026-11-18T00:00:00Z',
    planned_end: '2026-11-18T16:30:00Z', site_plan: '合成实施计划', personnel: [], equipment: [] } }
let events = []

// 用途：给真实客户端提供明确的合成只读响应，未声明接口立即失败。
// 参数：url 为已限制到本机回环域的请求地址。
// 返回值：该接口的合成数据；未覆盖的路径抛出错误。
function fixture(url) {
  const route = url.pathname.replace('/project_management/api/v1', '')
  if (route === '/auth/me' || url.pathname === '/api/v1/auth/me') return session
  if (route === '/project-creation-capabilities') return { native_enabled: false }
  if (route === '/navigation') return { roles: session.roles,
    sections: ['reports', 'preparation'], default_section: 'reports' }
  if (route === '/projects' || route === '/service-items') {
    assert.equal(url.searchParams.get('all'), '1', '工作区应读取完整快照')
    return { items: [route === '/projects' ? project : item], total: 1, truncated: false }
  }
  if (['/rules', '/capabilities', '/detection-categories', '/delivery-events',
    '/equipment'].includes(route)) return route === '/delivery-events' ? events : []
  if (route === '/role-catalog') return { roles: [{ code: 'project_manager', name: '项目经理' }] }
  if (route === '/personnel' || route === '/qualified-personnel') return { items: [], total: 0 }
  if (route === '/personnel/names') return { names: { 'lead-state': '合成负责人',
    'manager-state': '合成项目经理', 'engineer-state': '合成工程师' } }
  if (route === '/service-items/SI-STATE/field-evidence') return {
    service_item_id: item.id, evidence_complete: false, state: 'MISSING',
    gaps: ['FIELD_RECORD'], missing: ['现场记录'], evidence: [], scanned_events: 0,
  }
  if (route === '/service-items/SI-STATE/equipment-reservations') return []
  if (route === '/service-items/SI-STATE/report-reviews'
    || route === '/service-items/SI-STATE/report-reviews/current') return []
  if (url.pathname === '/api/v1/notifications/inbox/unread-count') return { unread_count: 0 }
  throw new Error(`未声明的隔离接口：${url.pathname}`)
}

await mkdir(output, { recursive: true })
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH
  || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' })
const page = await browser.newPage({ viewport: { width: 1440, height: 1080 },
  reducedMotion: 'reduce' })
const requests = []
const errors = []
const unexpected = []
const writes = []
const snapshots = []
page.on('pageerror', error => errors.push(error.message))
page.on('console', message => { if (['error', 'warning'].includes(message.type())) errors.push(message.text()) })
await page.route('**/*', async route => {
  const request = route.request()
  const url = new URL(request.url())
  requests.push({ method: request.method(), path: url.pathname })
  try {
    assert.equal(url.origin, origin, '隔离场景不得访问外部来源')
    if (!['GET', 'HEAD'].includes(request.method())) {
      writes.push({ method: request.method(), path: url.pathname })
      throw new Error('只读验收不得发送业务写入')
    }
    if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: shell })
    if (url.pathname === '/favicon.ico') return route.fulfill({ status: 204 })
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ code: 'OK',
      message: 'ok', request_id: 'synthetic-state', data: fixture(url) }) })
  } catch (error) {
    unexpected.push(error.message)
    return route.fulfill({ status: 503, contentType: 'application/json',
      body: JSON.stringify({ code: 'UNEXPECTED_FIXTURE_REQUEST', message: error.message }) })
  }
})

// 用途：保存当前操作台截图和用户可见的状态进度证据。
// 参数：name 为当前验收检查点名称。
// 返回值：无；截图或 DOM 读取失败向上抛出。
async function capture(name) {
  const panel = page.locator('.pm-operation-panel')
  const geometry = await page.locator('.pm-operation-progress').evaluate(element => {
    const bounds = element.getBoundingClientRect()
    const steps = [...element.querySelectorAll('.pm-step')].map(node => {
      const rect = node.getBoundingClientRect()
      return { text: node.textContent.trim(), left: rect.left, right: rect.right }
    })
    const clippingParents = []
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      if (['hidden', 'clip', 'auto', 'scroll'].includes(getComputedStyle(parent).overflowX)) {
        const rect = parent.getBoundingClientRect()
        clippingParents.push({ className: parent.className,
          left: rect.left + parent.clientLeft,
          right: rect.left + parent.clientLeft + parent.clientWidth })
      }
    }
    return { left: bounds.left, right: bounds.right,
      wrap: getComputedStyle(element.querySelector('.pm-stepper')).flexWrap,
      documentWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth, steps, clippingParents }
  })
  await panel.screenshot({ path: path.join(output, `${name}.png`) })
  snapshots.push({ name, geometry, queue: await page.locator('.pm-picker-meta').allTextContents(),
    summary: await page.locator('.pm-operation-status').textContent(),
    steps: await page.locator('.pm-operation-progress .pm-step').evaluateAll(nodes =>
      nodes.map(node => ({ text: node.textContent.trim(), state: node.className }))) })
  assert.ok(geometry.steps.every(step => step.left >= geometry.left - 1
    && step.right <= geometry.right + 1), `交付进度文字超出面板：${JSON.stringify(geometry)}`)
  assert.ok(geometry.clippingParents.every(parent => geometry.steps.every(step =>
    step.left >= parent.left - 1 && step.right <= parent.right + 1)),
  `交付进度被父容器裁切：${JSON.stringify(geometry)}`)
}

try {
  await page.goto(origin, { waitUntil: 'load' })
  await page.addScriptTag({ content: js })
  await page.evaluate(() => window.__mountPMState())
  await page.getByRole('option', { name: /合成状态同步项目/ }).click()
  await page.locator('.pm-operation-status').getByText('报告编制中', { exact: true }).waitFor()
  assert.ok((await page.locator('.pm-picker-meta').textContent()).includes('报告编制中'))
  assert.equal(await page.locator('.pm-operation-progress .pm-step.done').count(), 7)
  assert.equal((await page.locator('.pm-operation-summary-meta').textContent()).includes('2026-11-19'), true)
  const report = page.locator('.pm-stepper-panel').filter({ has: page.getByRole('heading',
    { name: '报告阶段链', exact: true }) })
  assert.match(await report.locator('.pm-step.doing').textContent(), /2\s*报告编制/)
  await capture('compiling')

  Object.assign(project, { status: '已完成', report_stage: 'ARCHIVED', version: 8 })
  Object.assign(item, { report_status: 'ARCHIVED', version: 8 })
  await page.getByRole('button', { name: '刷新', exact: true }).click()
  await page.locator('.pm-operation-status').getByText('报告已归档', { exact: true }).waitFor()
  assert.ok((await page.locator('.pm-picker-meta').textContent()).includes('报告已归档'))
  assert.equal(await report.locator('.pm-step.done').count(), 5)
  assert.equal(await report.locator('.pm-step.doing').count(), 0)
  assert.equal(await page.getByRole('button', { name: '确认归档', exact: true }).count(), 0)
  await capture('archived')

  // 替换合成快照验证历史报告值的展示保护；快照替换不表示允许归档后业务回退。
  Object.assign(project, { status: '实施准备中', report_stage: '', version: 9 })
  Object.assign(item, { status: '实施准备中', version: 9 })
  events = [{ id: 'EV-ROLLBACK', project_id: project.id, service_item_id: item.id,
    type: 'ROLLBACK_APPROVED', created_at: '2026-11-18T08:00:00Z',
    payload: { kind: 'FIELD_TO_PREPARATION' } }]
  await page.getByRole('button', { name: '刷新', exact: true }).click()
  await page.getByText('当前节点暂无可操作服务项', { exact: true }).waitFor()
  assert.equal(await page.locator('.pm-operation-status').count(), 0)
  await page.getByRole('button', { name: '实施准备', exact: true }).click()
  await page.getByRole('option', { name: /合成状态同步项目/ }).click()
  await page.locator('.pm-operation-status').getByText('实施准备中', { exact: true }).waitFor()
  assert.match(await page.locator('.pm-operation-progress .pm-step.doing').textContent(), /5\s*实施准备/)
  assert.equal(await page.locator('.pm-operation-progress .pm-step.done').count(), 4)
  assert.ok(!(await page.locator('.pm-picker-meta').textContent()).includes('报告已归档'))
  assert.ok(!(await page.locator('.pm-operation-status').textContent()).includes('报告已归档'))
  await capture('preparation-snapshot')
  assert.deepEqual(unexpected, [])
  assert.deepEqual(writes, [])
  assert.deepEqual(errors, [])
} finally {
  await writeFile(path.join(output, 'results.json'), JSON.stringify({ scenario: '服务项状态刷新同步',
    snapshots, requests, unexpected, writes, errors }, null, 2))
  await browser.close()
}
console.log(JSON.stringify({ scenario: '服务项状态刷新同步', checkpoints: snapshots.length,
  requests: requests.length, unexpected, writes, errors, output }))
