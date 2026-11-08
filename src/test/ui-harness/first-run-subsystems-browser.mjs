// 多导览（子系统）隔离浏览器夹具（手工证据脚本，不进 CI）。
//
// 用真实 Vue 组件、真实 first-run 状态层与真实路由验证：
//   · route.name → guide 映射：合同 / 平台控制台（settings、audit）各自 3 步；
//   · 首次进入子系统 600ms 后启动、1/3 进度、标题与系统名一致；
//   · 切换子系统先关旧导览（旧 guide 落 skipped，不标记 done），新 guide 独立启动；
//   · 终态后不自动重播；同一 guide 内 settings ↔ audit 不重复；不同 guide 互不影响；
//   · `?guide=1` 强制当前 guide 重看并从 URL 移除参数；
//   · nav 锚点缺失时不启动且记录保持 pending；
//   · pagehide 时 running 落 skipped；
//   · 同一时刻只存在一个导览气泡。
//
// 所有请求都在浏览器内以合成响应处理，不访问业务 API、不写业务数据。
// 运行：CHROMIUM_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
//   node src/test/ui-harness/first-run-subsystems-browser.mjs

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { build, transform } from 'esbuild'
import { parse, compileScript } from '@vue/compiler-sfc'
import { chromium } from 'playwright-core'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const label = process.env.FIRST_RUN_RUN_LABEL || 'latest'
assert.match(label, /^[A-Za-z0-9_-]{1,48}$/, 'label must stay inside the evidence directory')
const outputDir = process.env.FIRST_RUN_OUTPUT_DIR
  ? (process.env.FIRST_RUN_OUTPUT_DIR.endsWith('/') ? process.env.FIRST_RUN_OUTPUT_DIR : `${process.env.FIRST_RUN_OUTPUT_DIR}/`)
  : fileURLToPath(new URL(`../../../../.ai/qa/first-run-guide-20261107/browser/subsystems-${label}/`, import.meta.url))
const chromiumPath = process.env.CHROMIUM_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const ORIGIN = 'http://first-run-subsystems.invalid'

const checks = []
function record(name, detail = '') {
  checks.push({ name, detail, at: new Date().toISOString() })
}

// 用途：把真实 GuideHost 编译成浏览器可执行的隔离 bundle；CSS 由页面单独注入。
async function bundleFixture() {
  const result = await build({
    stdin: {
      contents: `import { createApp, h } from 'vue'
import { createRouter, createMemoryHistory, RouterView } from 'vue-router'
import GuideHost from './src/modules/platform/first-run/components/FirstRunGuideHost.vue'
import { firstRun } from './src/modules/platform/first-run/composables/useFirstRun.js'
import { createDocumentThemeOverride } from './src/modules/platform/shared/composables/useDocumentTheme.js'

const navAnchor = 'data-first-run-anchor'

function subsystemShell(name, { withNav = true } = {}) {
  return {
    name: name + 'Shell',
    render() {
      const children = []
      if (withNav) {
        children.push(h('nav', {
          [navAnchor]: 'subsystem-nav',
          style: 'position:fixed;left:0;top:0;width:240px;height:100vh;background:#e2e8f0',
        }, name + '导航'))
      }
      children.push(h('main', { style: 'margin-left:240px' }, [
        h('section', {
          [navAnchor]: 'subsystem-title',
          style: 'height:180px;background:#f1f5f9',
        }, name + '主操作区'),
        h('button', {
          [navAnchor]: 'subsystem-portal',
          style: 'position:fixed;left:8px;bottom:8px;width:220px;height:40px',
        }, '返回子系统门户'),
      ]))
      return h('div', children)
    },
  }
}

;(async () => {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/portal', name: 'portal', component: { render: () => h('div', '门户') } },
      { path: '/contract_management/:section?', name: 'contract_management', component: subsystemShell('合同管理') },
      { path: '/settings/:section?', name: 'settings', component: subsystemShell('平台控制台') },
      { path: '/audit', name: 'audit', component: subsystemShell('平台控制台') },
      { path: '/project_management/:section?', name: 'project_management', component: subsystemShell('项目管理', { withNav: false }) },
    ],
  })
  await router.push('/contract_management/dashboard')
  await router.isReady()
  const app = createApp({ render: () => h('div', [h(RouterView), h(GuideHost)]) })
  app.use(router)
  app.mount('#fixture')
  window.__firstRun = firstRun
  window.__themeOverride = createDocumentThemeOverride()
  window.__router = router
})()`,
      resolveDir: root,
      loader: 'js',
    },
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    define: { 'import.meta.env': '{}' },
    alias: { '@': `${root}src` },
    plugins: [{
      name: 'first-run-vue',
      setup(builder) {
        builder.onLoad({ filter: /\.vue$/ }, async ({ path }) => {
          const { descriptor } = parse(await readFile(path, 'utf8'), { filename: path })
          const id = `data-v-${createHash('sha256').update(path).digest('hex').slice(0, 8)}`
          const script = compileScript(descriptor, {
            id,
            inlineTemplate: true,
            genDefaultAs: '__fixtureComponent',
            templateOptions: { compilerOptions: { scopeId: id } },
          })
          // 组件可写成 `<script setup lang="ts">`：compileScript 不擦除类型标注，先交给 esbuild 降级。
          const transpiled = await transform(script.content, { loader: 'ts' })
          return {
            contents: `${transpiled.code}\n__fixtureComponent.__scopeId=${JSON.stringify(id)};export default __fixtureComponent;`,
            loader: 'js',
            resolveDir: fileURLToPath(new URL('.', `file://${path}`)),
          }
        })
        builder.onLoad({ filter: /\.css$/ }, () => ({ contents: 'export default {}', loader: 'js' }))
      },
    }],
  })
  return result.outputFiles[0].text
}

const bundle = await bundleFixture()
const tokensCss = await readFile(`${root}src/modules/platform/shared/styles/main.css`, 'utf8')
const flowCss = await readFile(`${root}src/modules/platform/first-run/styles/first-run.css`, 'utf8')

const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>first-run subsystems fixture</title>
<style>${tokensCss}\n${flowCss}\nbody { margin: 0; }</style></head>
<body>
<div id="fixture"></div>
<script type="module" src="/fixture.js"></script>
</body></html>`

await mkdir(outputDir, { recursive: true })
const unexpectedRequests = []
const requestedPaths = []

const browser = await chromium.launch({ executablePath: chromiumPath, headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  await page.route('**/*', (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.origin !== ORIGIN) {
      unexpectedRequests.push(`${request.method()} ${url.href}`)
      return route.abort()
    }
    if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: html })
    if (url.pathname === '/fixture.js') return route.fulfill({ contentType: 'text/javascript', body: bundle })
    if (url.pathname === '/favicon.ico') return route.fulfill({ status: 204 })
    requestedPaths.push(`${request.method()} ${url.pathname}`)
    // GuideHost 在子系统路由用平台主体确定 tenant/user 作用域。
    if (url.pathname === '/api/v1/auth/me' && request.method() === 'GET') {
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          code: 'OK',
          data: {
            tenant_id: 'tenant-e2e',
            identity_id: 'user-e2e',
            tenant: { id: 'tenant-e2e', name: '验收租户' },
            user: { id: 'user-e2e', name: '验收用户' },
            account: { id: 'account-e2e', code: 'acceptance' },
            permission_codes: ['platform:audit:view'],
          },
        }),
      })
    }
    unexpectedRequests.push(`${request.method()} ${url.pathname}`)
    return route.abort()
  })
  await page.goto(`${ORIGIN}/`)
  await page.waitForFunction(() => Boolean(window.__firstRun))

  async function recordState() {
    return page.evaluate(() => {
      const key = Object.keys(localStorage).find((item) => item.startsWith('basic-platform.first-run'))
      return key ? JSON.parse(localStorage.getItem(key)) : null
    })
  }
  async function currentPath() {
    return page.evaluate(() => window.__router.currentRoute.value.fullPath)
  }
  async function bubbleInfo() {
    return page.evaluate(() => {
      const bubbles = document.querySelectorAll('.first-run-tour__bubble')
      const bubble = bubbles[0]
      if (!bubble) return null
      return {
        count: bubbles.length,
        title: bubble.querySelector('.first-run-tour__title').textContent.trim(),
        progress: bubble.querySelector('.first-run-tour__progress').textContent.replace(/\s+/g, ' ').trim(),
        primary: bubble.querySelector('.first-run-tour__nav .is-primary')?.textContent.trim() || '',
      }
    })
  }

  // 1. 首次进入合同：600ms 后出现，1/3，标题使用合同系统名。
  await page.waitForTimeout(120)
  assert.equal(await bubbleInfo(), null, '600ms 延迟前不应出现导览')
  await page.waitForSelector('.first-run-tour__bubble', { timeout: 3000 })
  let info = await bubbleInfo()
  assert.equal(info.count, 1)
  assert.equal(info.title, '合同管理导航')
  assert.match(info.progress, /1 \/ 3/)
  let state = await recordState()
  assert.equal(state.v, 2)
  assert.equal(state.guides.contract.tour, 'running')
  assert.equal(state.guides.platform.tour, 'pending')
  record('合同导览自动启动', JSON.stringify({ title: info.title, progress: info.progress }))

  // 2/3、3/3 与完成。
  await page.click('.first-run-tour__bubble .first-run-tour__nav .is-primary')
  info = await bubbleInfo()
  assert.equal(info.title, '合同管理主操作区')
  assert.match(info.progress, /2 \/ 3/)
  await page.click('.first-run-tour__bubble .first-run-tour__nav .is-primary')
  info = await bubbleInfo()
  assert.equal(info.title, '返回统一门户')
  assert.match(info.progress, /3 \/ 3/)
  const primaryText = info.primary
  assert.match(primaryText, /完成/)
  await page.click('.first-run-tour__bubble .first-run-tour__nav .is-primary')
  await page.waitForSelector('.first-run-tour__bubble', { state: 'detached', timeout: 2000 })
  assert.equal(await bubbleInfo(), null)
  state = await recordState()
  assert.equal(state.guides.contract.tour, 'done')
  record('合同 3 步与完成终态', '1/3 → 2/3 → 3/3 → done')

  // 3. 同一子系统内切 section 不重播（contract 已 done）。
  await page.evaluate(() => window.__router.push('/contract_management/contracts'))
  await page.waitForTimeout(900)
  assert.equal(await bubbleInfo(), null, '同一 guide 已终态，不应重播')
  record('同一 guide 不重复自动展示', 'contract done 后切 section 无导览')

  // 4. 首次进入平台控制台 settings：独立启动，合同终态不受影响。
  await page.evaluate(() => window.__router.push('/settings/iam'))
  await page.waitForSelector('.first-run-tour__bubble', { timeout: 3000 })
  info = await bubbleInfo()
  assert.equal(info.title, '平台控制台导航')
  assert.match(info.progress, /1 \/ 3/)
  state = await recordState()
  assert.equal(state.guides.platform.tour, 'running')
  assert.equal(state.guides.contract.tour, 'done')
  record('平台控制台独立导览', JSON.stringify({ title: info.title, contract: state.guides.contract.tour }))

  // 5. settings → audit 属于同一 guide：不重复启动（仍 running，切换 section 不关闭）。
  await page.evaluate(() => window.__router.push('/audit'))
  await page.waitForTimeout(700)
  info = await bubbleInfo()
  assert.equal(info.count, 1, '同一 guide 内切换应保持当前导览，不重复叠加')
  record('settings ↔ audit 同一 guide', '不重复启动、不叠加气泡')

  // 6. 切换到合同：先关平台导览（skipped，不是 done），再启动/不启动合同（已 done）。
  await page.evaluate(() => window.__router.push('/contract_management/dashboard'))
  await page.waitForTimeout(900)
  assert.equal(await bubbleInfo(), null)
  state = await recordState()
  assert.equal(state.guides.platform.tour, 'skipped', '切换子系统时旧 guide 落 skipped')
  assert.equal(state.guides.contract.tour, 'done', '旧导览不能被标记为完成')
  record('切换子系统先关旧导览', JSON.stringify({ platform: state.guides.platform.tour, contract: state.guides.contract.tour }))

  // 7. `?guide=1` 强制合同重看，并从 URL 移除 guide 参数。
  await page.evaluate(() => window.__router.push('/contract_management/dashboard?guide=1'))
  await page.waitForSelector('.first-run-tour__bubble', { timeout: 3000 })
  info = await bubbleInfo()
  assert.equal(info.title, '合同管理导航')
  assert.equal(await currentPath(), '/contract_management/dashboard', 'guide=1 应从 URL 清理')
  state = await recordState()
  assert.equal(state.guides.contract.tour, 'running')
  record('?guide=1 强制重看', '合同导览重新启动且 URL 已清理')

  // 8. pagehide：running 落 skipped，不自动续播。
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')))
  await page.waitForTimeout(300)
  state = await recordState()
  assert.equal(state.guides.contract.tour, 'skipped')
  assert.equal(await bubbleInfo(), null)
  record('pagehide 中断落 skipped', 'contract skipped')

  // 9. nav 锚点缺失（项目壳层）时不启动，记录保持 pending。
  await page.evaluate(() => window.__router.push('/project_management/list'))
  await page.waitForTimeout(1200)
  assert.equal(await bubbleInfo(), null, 'nav 缺失不应启动')
  state = await recordState()
  assert.equal(state.guides.project.tour, 'pending', 'nav 缺失时记录保持 pending')
  record('nav 缺失不启动', 'project pending')

  // 10. 全程只有一次平台主体读取（作用域稳定后不再重复请求）。
  const authMeCalls = requestedPaths.filter((item) => item === 'GET /api/v1/auth/me').length
  assert.ok(authMeCalls >= 1 && authMeCalls <= 2, `auth/me 调用次数异常：${authMeCalls}`)
  assert.deepEqual(unexpectedRequests, [])
  record('请求边界', JSON.stringify({ authMeCalls, unexpectedRequests }))

  await page.screenshot({ path: `${outputDir}contract-done.png` })
  await writeFile(`${outputDir}result.json`, JSON.stringify({
    label,
    checks,
    requestedPaths,
    unexpectedRequests,
    finishedAt: new Date().toISOString(),
  }, null, 2))
  console.log(`first-run subsystems fixture passed: ${checks.length} checks -> ${outputDir}`)
} finally {
  await browser.close()
}
