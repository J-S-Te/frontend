// 平台导览 + 上手清单的隔离浏览器夹具（手工证据脚本，不进 CI）。
//
// 用真实 Vue 组件、真实 first-run CSS、真实 localStorage 与真实键盘/焦点行为验证：
//   · 600ms 启动、层级 9000、焦点锁、滚动锁、Esc/跳过终态、遮罩点击不关闭、关闭还焦点；
//   · 缺锚步骤跳过、header 缺锚不启动；
//   · 清单 5 项、权限可见性、第 ④ 项只读探测 total>=1、探测后进度更新；
//   · 窄屏（≤640px）底部面板、深色只使用 token 的渲染结果。
//
// 所有请求都在浏览器内以合成响应处理，不访问业务 API、不写业务数据。
// 运行：CHROMIUM_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
//   node src/test/ui-harness/first-run-browser.mjs

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { parse, compileScript } from '@vue/compiler-sfc'
import { chromium } from 'playwright-core'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const label = process.env.FIRST_RUN_RUN_LABEL || 'latest'
assert.match(label, /^[A-Za-z0-9_-]{1,48}$/, 'label must stay inside the evidence directory')
const outputDir = process.env.FIRST_RUN_OUTPUT_DIR
  ? (process.env.FIRST_RUN_OUTPUT_DIR.endsWith('/') ? process.env.FIRST_RUN_OUTPUT_DIR : `${process.env.FIRST_RUN_OUTPUT_DIR}/`)
  : fileURLToPath(new URL(`../../../../.ai/qa/first-run-guide-20261107/browser/${label}/`, import.meta.url))
const chromiumPath = process.env.CHROMIUM_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const ORIGIN = 'http://first-run.invalid'

const checks = []
function record(name, detail = '') {
  checks.push({ name, detail, at: new Date().toISOString() })
}

// 用途：把真实单文件组件编译成浏览器可执行的隔离 bundle；CSS 由页面单独注入。
async function bundleFixture() {
  const result = await build({
    stdin: {
      contents: `import { createApp, h } from 'vue'
import { createRouter, createMemoryHistory } from 'vue-router'
import GuideHost from './src/modules/platform/first-run/components/FirstRunGuideHost.vue'
import { firstRun } from './src/modules/platform/first-run/composables/useFirstRun.js'
import { createDocumentThemeOverride } from './src/modules/platform/shared/composables/useDocumentTheme.js'

;(async () => {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/portal', name: 'portal', component: { render: () => h('div') } },
      { path: '/audit', name: 'audit', component: { render: () => h('div') } },
    ],
  })
  await router.push('/portal')
  await router.isReady()
  const app = createApp({ render: () => h(GuideHost) })
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
          return {
            contents: `${script.content}\n__fixtureComponent.__scopeId=${JSON.stringify(id)};export default __fixtureComponent;`,
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
<html lang="zh-CN"><head><meta charset="utf-8"><title>first-run fixture</title>
<style>${tokensCss}\n${flowCss}</style></head>
<body>
<div id="fixture-anchors">
  <header data-first-run-anchor="portal-header" style="height:72px;background:#e2e8f0">平台页头</header>
  <div data-first-run-anchor="subsystem-cards" style="height:220px;margin-top:12px;background:#f1f5f9">子系统卡片区</div>
  <div data-first-run-anchor="theme-switcher" style="height:44px;margin-top:12px;background:#eef2ff">主题切换</div>
  <div data-first-run-anchor="user-panel" style="height:44px;margin-top:12px;background:#eef2ff">用户面板</div>
  <button id="checklist-entry" data-first-run-anchor="checklist-entry" style="height:38px">上手清单</button>
</div>
<div id="fixture"></div>
<script type="module" src="/fixture.js"></script>
</body></html>`

await mkdir(outputDir, { recursive: true })
const unexpectedRequests = []
let usersRequest = null

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
    if (url.pathname === '/api/v1/users' && request.method() === 'GET') {
      usersRequest = { url: request.url(), method: request.method() }
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ code: 'OK', data: { items: [{ id: 'user-2' }], total: 1, page: 1, page_size: 1 } }),
      })
    }
    unexpectedRequests.push(`${request.method()} ${url.pathname}`)
    return route.abort()
  })
  await page.goto(`${ORIGIN}/`)
  await page.waitForFunction(() => Boolean(window.__firstRun))

  const principal = {
    tenant: { id: 'tenant-e2e', name: '验收租户' },
    user: { id: 'user-e2e', name: '验收用户' },
    account: { id: 'account-e2e', code: 'acceptance' },
    permission_codes: ['platform:user:read', 'platform:audit:view'],
  }

  // 清理上一轮夹具留下的本地记录，聚焦入口按钮（用于验证关闭后还原焦点）。
  await page.evaluate(() => {
    localStorage.clear()
    document.documentElement.removeAttribute('data-theme')
    document.getElementById('checklist-entry').focus()
  })

  await page.evaluate((value) => {
    window.dispatchEvent(new CustomEvent('platform-auth:authorization-refreshed', { detail: { principal: value } }))
    window.__firstRun.markPortalReady(value)
    // 真实门户在目录 settled 后调用；夹具没有目录，直接视为就绪。
    window.__firstRun.setCatalogReady(true)
  }, principal)

  // 600ms 延迟：刚就绪时不应立刻出现。
  await page.waitForTimeout(120)
  assert.equal(await page.$('.first-run-tour__bubble'), null, '导览不应在 600ms 延迟前出现')
  record('600ms 延迟启动', '就绪后 120ms 未出现')

  await page.waitForSelector('.first-run-tour__bubble', { timeout: 3000 })
  await page.waitForFunction(() => {
    const bubble = document.querySelector('.first-run-tour__bubble')
    return Boolean(bubble && bubble.contains(document.activeElement))
  }, null, { timeout: 2000 })
  const tour = await page.evaluate(() => {
    const bubble = document.querySelector('.first-run-tour__bubble')
    const mask = document.querySelector('.first-run-tour__mask')
    const ring = document.querySelector('.first-run-tour__ring')
    const header = document.querySelector('[data-first-run-anchor="portal-header"]')
    const style = getComputedStyle(bubble)
    const key = Object.keys(localStorage).find((item) => item.startsWith('basic-platform.first-run'))
    return {
      role: bubble.getAttribute('role'),
      ariaModal: bubble.getAttribute('aria-modal'),
      title: bubble.querySelector('.first-run-tour__title').textContent.trim(),
      progress: bubble.querySelector('.first-run-tour__progress').textContent.replace(/\s+/g, ' ').trim(),
      zIndex: style.zIndex,
      position: style.position,
      focusInsideBubble: bubble.contains(document.activeElement),
      bodyOverflow: document.body.style.overflow,
      liveRegion: Boolean(bubble.querySelector('[aria-live="polite"]')),
      maskZ: getComputedStyle(mask.parentElement).zIndex,
      ringTop: ring.getBoundingClientRect().top,
      headerTop: header.getBoundingClientRect().top,
      storageKeyCount: Object.keys(localStorage).length,
      storageKey: key,
      record: key ? JSON.parse(localStorage.getItem(key)) : null,
    }
  })
  assert.equal(tour.role, 'dialog')
  assert.equal(tour.ariaModal, 'true')
  assert.equal(tour.title, '平台门户')
  assert.match(tour.progress, /1 \/ 5/)
  assert.equal(tour.zIndex, '9000')
  assert.equal(tour.position, 'fixed')
  assert.equal(tour.focusInsideBubble, true, '焦点必须锁在气泡内')
  assert.equal(tour.bodyOverflow, 'hidden', '导览打开时必须锁定页面滚动')
  assert.equal(tour.liveRegion, true)
  assert.ok(Math.abs(tour.ringTop - Math.max(0, tour.headerTop)) <= 2, `高亮环应贴合 header 锚点：ring ${tour.ringTop} / header ${tour.headerTop}`)
  assert.equal(tour.storageKeyCount, 1)
  assert.ok(tour.storageKey.includes('tenant-e2e'))
  assert.ok(tour.storageKey.includes('user-e2e'))
  assert.equal(tour.record.guides.portal.tour, 'running')
  assert.equal(tour.record.v, 2)
  record('导览启动与无障碍', JSON.stringify({ zIndex: tour.zIndex, role: tour.role, ariaModal: tour.ariaModal }))

  // 第 1 步锚点是整行页头：1366 / 1920 下环必须完全落在视口内，且只能用内描边，
  // 否则左右两侧的外扩阴影会被视口裁掉。
  const ringBounds = []
  for (const [width, height] of [[1366, 768], [1920, 1080]]) {
    await page.setViewportSize({ width, height })
    await page.waitForTimeout(120)
    const bounds = await page.evaluate(() => {
      const ring = document.querySelector('.first-run-tour__ring')
      const header = document.querySelector('[data-first-run-anchor="portal-header"]')
      const rect = ring.getBoundingClientRect()
      const headerRect = header.getBoundingClientRect()
      return {
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        headerLeft: headerRect.left,
        headerWidth: headerRect.width,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        boxShadow: getComputedStyle(ring).boxShadow,
      }
    })
    ringBounds.push({ width, ...bounds })
    assert.ok(Math.abs(bounds.left - Math.max(0, bounds.headerLeft)) <= 2, `${width} 宽下高亮环左边应与页头对齐：${JSON.stringify(bounds)}`)
    assert.ok(Math.abs((bounds.right - bounds.left) - bounds.headerWidth) <= 2, `${width} 宽下高亮环应覆盖整行页头：${JSON.stringify(bounds)}`)
    assert.ok(bounds.left >= 0, `${width} 宽下高亮环左侧被视口裁切：${JSON.stringify(bounds)}`)
    assert.ok(bounds.right <= bounds.viewportWidth, `${width} 宽下高亮环右侧被视口裁切：${JSON.stringify(bounds)}`)
    assert.ok(bounds.top >= 0 && bounds.bottom <= bounds.viewportHeight, `${width} 宽下高亮环上下被视口裁切：${JSON.stringify(bounds)}`)
    assert.match(bounds.boxShadow, /inset/, `${width} 宽下高亮环必须用内描边，外扩阴影会被视口裁掉：${JSON.stringify(bounds)}`)
  }
  assert.equal(ringBounds.length, 2)
  record('1366/1920 整行高亮环不裁切', JSON.stringify(ringBounds.map(({ width, left, right, boxShadow }) => ({ width, left, right, boxShadow }))))

  await page.setViewportSize({ width: 1440, height: 900 })
  await page.waitForTimeout(120)

  await page.screenshot({ path: `${outputDir}tour-desktop.png` })

  // 遮罩点击不关闭。
  await page.mouse.click(8, 420)
  await page.waitForTimeout(120)
  assert.ok(await page.$('.first-run-tour__bubble'), '点击遮罩不得关闭导览')
  record('遮罩点击不关闭')

  // Esc = 跳过终态，并把焦点还给启动前的入口按钮。
  await page.keyboard.press('Escape')
  await page.waitForSelector('.first-run-tour__bubble', { state: 'detached', timeout: 2000 })
  await page.waitForFunction(() => document.activeElement?.id === 'checklist-entry', null, { timeout: 2000 })
  const afterSkip = await page.evaluate(() => {
    const key = Object.keys(localStorage).find((item) => item.startsWith('basic-platform.first-run'))
    return {
      record: key ? JSON.parse(localStorage.getItem(key)) : null,
      activeId: document.activeElement?.id || '',
      bodyOverflow: document.body.style.overflow,
      dialogs: document.querySelectorAll('[role="alertdialog"]').length,
    }
  })
  assert.equal(afterSkip.record.guides.portal.tour, 'skipped')
  assert.equal(afterSkip.record.guides.portal.seenAt !== null, true)
  assert.equal(afterSkip.activeId, 'checklist-entry', '关闭导览后焦点应回到入口')
  assert.equal(afterSkip.bodyOverflow, '', '关闭导览后必须恢复页面滚动')
  assert.equal(afterSkip.dialogs, 0, '跳过不应触发二次确认')
  record('Esc 跳过为终态并还原焦点')

  // 显式“重新查看”会再次展示；此时用“跳过导览”按钮收尾。
  await page.evaluate(() => window.__firstRun.restartTour())
  await page.waitForSelector('.first-run-tour__bubble', { timeout: 3000 })
  await page.click('.first-run-tour__actions .first-run-button.is-ghost')
  await page.waitForSelector('.first-run-tour__bubble', { state: 'detached', timeout: 2000 })
  const afterRestartSkip = await page.evaluate(() => {
    const key = Object.keys(localStorage).find((item) => item.startsWith('basic-platform.first-run'))
    return JSON.parse(localStorage.getItem(key))
  })
  assert.equal(afterRestartSkip.guides.portal.tour, 'skipped')
  record('重新查看后可再次跳过，仍为终态')

  // 缺锚步骤跳过：移除主题切换锚点后，第二步的“下一步”应直接到用户面板。
  await page.evaluate(() => {
    document.querySelector('[data-first-run-anchor="theme-switcher"]').removeAttribute('data-first-run-anchor')
    window.__firstRun.restartTour()
  })
  await page.waitForSelector('.first-run-tour__bubble', { timeout: 3000 })
  await page.click('.first-run-tour__actions .first-run-button.is-primary')
  await page.waitForFunction(() => document.querySelector('.first-run-tour__title')?.textContent.includes('业务子系统'))
  await page.click('.first-run-tour__actions .first-run-button.is-primary')
  await page.waitForFunction(() => document.querySelector('.first-run-tour__title')?.textContent.includes('用户面板'))
  const skippedStep = await page.evaluate(() => document.querySelector('.first-run-tour__progress').textContent.replace(/\s+/g, ' ').trim())
  assert.match(skippedStep, /4 \/ 5/)
  await page.keyboard.press('Escape')
  await page.waitForSelector('.first-run-tour__bubble', { state: 'detached', timeout: 2000 })
  record('缺锚点步骤被跳过', skippedStep)

  // header 锚点缺失：整次不启动，记录保持 pending。
  await page.evaluate(() => {
    document.querySelector('[data-first-run-anchor="portal-header"]').removeAttribute('data-first-run-anchor')
    window.__firstRun.restartTour()
  })
  await page.waitForTimeout(1000)
  assert.equal(await page.$('.first-run-tour__bubble'), null, 'header 锚点缺失时不得启动导览')
  const pendingAfterHeaderMissing = await page.evaluate(() => window.__firstRun.state.record.guides.portal.tour)
  assert.equal(pendingAfterHeaderMissing, 'pending')
  await page.evaluate(() => {
    document.getElementById('fixture-anchors').firstElementChild.setAttribute('data-first-run-anchor', 'portal-header')
    window.__firstRun.restartTour()
  })
  record('header 缺锚不启动')

  // 锚点被推到视口外时，启动/切步前先 scrollIntoView 到中部再测量，
  // 气泡与高亮环都必须落在视口内。
  await page.evaluate(() => {
    const spacer = document.createElement('div')
    spacer.id = 'fixture-scroll-spacer'
    spacer.style.height = '1800px'
    spacer.style.background = '#f8fafc'
    document.body.insertBefore(spacer, document.body.firstChild)
    window.scrollTo(0, 0)
    window.__firstRun.restartTour()
  })
  await page.waitForSelector('.first-run-tour__bubble', { timeout: 3000 })
  const scrollPositioned = await page.evaluate(() => {
    const header = document.querySelector('[data-first-run-anchor="portal-header"]').getBoundingClientRect()
    const bubble = document.querySelector('.first-run-tour__bubble').getBoundingClientRect()
    return {
      scrollY: Math.round(window.scrollY),
      headerTop: Math.round(header.top),
      headerBottom: Math.round(header.bottom),
      bubbleTop: Math.round(bubble.top),
      bubbleBottom: Math.round(bubble.bottom),
      viewport: window.innerHeight,
    }
  })
  assert.ok(scrollPositioned.scrollY > 0, `启动前应滚动到锚点：${JSON.stringify(scrollPositioned)}`)
  assert.ok(scrollPositioned.headerTop >= 0 && scrollPositioned.headerBottom <= scrollPositioned.viewport,
    `锚点应进入视口：${JSON.stringify(scrollPositioned)}`)
  assert.ok(scrollPositioned.bubbleTop >= 0 && scrollPositioned.bubbleBottom <= scrollPositioned.viewport,
    `气泡不应指向视口外：${JSON.stringify(scrollPositioned)}`)
  record('切步前滚动到视口中部再测量', JSON.stringify(scrollPositioned))
  await page.keyboard.press('Escape')
  await page.waitForSelector('.first-run-tour__bubble', { state: 'detached', timeout: 2000 })
  await page.evaluate(() => document.getElementById('fixture-scroll-spacer')?.remove())

  // 清掉导览终态，进入清单验证。
  await page.evaluate(() => window.__firstRun.finishTour('skipped'))
  await page.evaluate(() => window.__firstRun.openChecklist())
  await page.waitForSelector('.first-run-checklist__panel')

  const checklist = await page.evaluate(() => {
    const panel = document.querySelector('.first-run-checklist__panel')
    return {
      role: panel.getAttribute('role'),
      ariaModal: panel.getAttribute('aria-modal'),
      items: [...panel.querySelectorAll('.first-run-checklist__item')].map((item) => ({
        title: item.querySelector('.first-run-checklist__item-title').textContent.replace(/\s+/g, ' ').trim(),
        done: item.classList.contains('is-done'),
      })),
      summary: panel.querySelector('.first-run-checklist__summary').textContent.trim(),
      buttons: [...panel.querySelectorAll('button')].map((button) => button.getAttribute('aria-label') || button.textContent.trim()),
      hasProbe: Boolean(panel.querySelector('.first-run-checklist__probe')),
      bodyOverflow: document.body.style.overflow,
    }
  })
  assert.equal(checklist.role, 'dialog')
  assert.equal(checklist.ariaModal, 'true')
  assert.equal(checklist.items.length, 5)
  assert.match(checklist.summary, /^已完成 [01] \/ 5 项$/)
  assert.equal(checklist.hasProbe, true)
  // 面板只提供关闭 + 探测失败时的重试，不代替用户完成清单项。
  assert.ok(checklist.buttons.includes('关闭上手清单'))
  for (const button of checklist.buttons) {
    assert.ok(['关闭上手清单', '重新检测'].includes(button), `清单面板出现非预期按钮：${button}`)
  }

  await page.waitForFunction(() => {
    const panel = document.querySelector('.first-run-checklist__panel')
    const summary = panel?.querySelector('.first-run-checklist__summary')?.textContent || ''
    return /1 \/ 5/.test(summary)
  }, { timeout: 3000 })
  const afterProbe = await page.evaluate(() => {
    const panel = document.querySelector('.first-run-checklist__panel')
    const firstAccount = [...panel.querySelectorAll('.first-run-checklist__item')]
      .find((item) => item.textContent.includes('创建首个业务账号'))
    return {
      summary: panel.querySelector('.first-run-checklist__summary').textContent.trim(),
      firstAccountDone: Boolean(firstAccount?.classList.contains('is-done')),
      probeText: panel.querySelector('.first-run-checklist__probe').textContent.replace(/\s+/g, ' ').trim(),
      record: window.__firstRun.state.record,
    }
  })
  assert.equal(afterProbe.firstAccountDone, true)
  assert.match(afterProbe.probeText, /检测到租户内已有业务账号/)
  assert.equal(afterProbe.record.tasks.firstAccount, true)
  assert.equal(usersRequest?.method, 'GET')
  assert.equal(new URL(usersRequest.url).pathname, '/api/v1/users')
  assert.equal(new URL(usersRequest.url).search, '?page=1&page_size=1')
  record('清单 5 项与只读探测', usersRequest.url)

  await page.screenshot({ path: `${outputDir}checklist.png` })

  // 门户默认深色：真实门户会把 resolvedTheme 临时覆盖到 <html data-theme>，
  // 这里用同一 createDocumentThemeOverride 验证 Teleport 到 body 的面板跟随深色，
  // 并在 restore 后回到挂载前的浅色。
  const lightBackground = await page.evaluate(() => (
    getComputedStyle(document.querySelector('.first-run-checklist__panel')).backgroundColor
  ))
  await page.evaluate(() => window.__themeOverride.apply('dark'))
  await page.screenshot({ path: `${outputDir}checklist-dark.png` })
  const colors = await page.evaluate(() => {
    const panel = document.querySelector('.first-run-checklist__panel')
    return {
      light: undefined,
      attribute: document.documentElement.getAttribute('data-theme'),
      dark: getComputedStyle(panel).backgroundColor,
      darkTitle: getComputedStyle(panel.querySelector('.first-run-checklist__title')).color,
    }
  })
  colors.light = lightBackground
  await page.evaluate(() => window.__themeOverride.restore())
  const restoredTheme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'))
  assert.equal(colors.attribute, 'dark', '门户覆盖应把 resolvedTheme 写到根元素')
  assert.equal(colors.light, 'rgb(255, 255, 255)')
  assert.equal(colors.dark, 'rgb(17, 26, 44)', '深色面板应取 --surface-card 深色 token')
  assert.equal(colors.darkTitle, 'rgb(231, 238, 249)', '深色标题应取 --text 深色 token')
  assert.equal(restoredTheme, 'light', '卸载/恢复后应按当前偏好重新同步（无偏好时默认浅色）')
  record('门户默认深色覆盖到根元素并恢复', JSON.stringify(colors))

  await page.keyboard.press('Escape')
  await page.waitForSelector('.first-run-checklist__panel', { state: 'detached', timeout: 2000 })
  const checklistClosed = await page.evaluate(() => ({
    bodyOverflow: document.body.style.overflow,
    activeId: document.activeElement?.id || '',
    record: window.__firstRun.state.record,
  }))
  assert.equal(checklistClosed.bodyOverflow, '')
  assert.equal(checklistClosed.record.tasks.firstAccount, true)
  record('清单关闭恢复滚动与焦点')

  // 窄屏 ≤640px：底部面板，且页面不产生横向溢出。
  await page.setViewportSize({ width: 390, height: 844 })
  await page.evaluate(() => window.__firstRun.restartTour())
  await page.waitForSelector('.first-run-tour__bubble', { timeout: 3000 })
  const narrow = await page.evaluate(() => {
    const bubble = document.querySelector('.first-run-tour__bubble')
    const rect = bubble.getBoundingClientRect()
    return {
      left: Math.round(rect.left),
      right: Math.round(innerWidth - rect.right),
      bottom: Math.round(innerHeight - rect.bottom),
      width: Math.round(rect.width),
      ringDisplay: getComputedStyle(document.querySelector('.first-run-tour__ring')).display,
      horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    }
  })
  assert.equal(narrow.left, 12)
  assert.equal(narrow.right, 12)
  assert.equal(narrow.bottom, 12)
  assert.equal(narrow.width, 366)
  assert.equal(narrow.ringDisplay, 'none')
  assert.ok(narrow.horizontalOverflow <= 1, '窄屏不应产生横向溢出')
  record('窄屏底部面板', JSON.stringify(narrow))
  await page.screenshot({ path: `${outputDir}tour-narrow.png` })

  assert.deepEqual(unexpectedRequests, [], `存在非预期外部请求：${unexpectedRequests.join(', ')}`)

  await writeFile(`${outputDir}result.json`, JSON.stringify({
    label,
    checks,
    usersRequest,
    screenshots: ['tour-desktop.png', 'checklist.png', 'checklist-dark.png', 'tour-narrow.png'],
  }, null, 2))
  console.log(`first-run browser fixture passed: ${checks.length} checks -> ${outputDir}`)
} finally {
  await browser.close()
}
