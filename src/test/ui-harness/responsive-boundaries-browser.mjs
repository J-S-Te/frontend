// 隔离布局回归：实际Vue组件、实际模块CSS、合成数据；全部请求在浏览器内处理。
// CI 入口：npm run test:layout（无需 dev server；用 CHROMIUM_PATH 指定本机 Chrome/Chromium）。
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { parse, compileScript, compileStyle } from '@vue/compiler-sfc'
import { chromium } from 'playwright-core'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const run = process.env.LAYOUT_RUN_LABEL || 'latest'
assert.match(run, /^[A-Za-z0-9_-]{1,48}$/, 'layout result label must remain inside the evidence directory')
const output = process.env.LAYOUT_OUTPUT_DIR ? (process.env.LAYOUT_OUTPUT_DIR.endsWith('/') ? process.env.LAYOUT_OUTPUT_DIR : process.env.LAYOUT_OUTPUT_DIR + '/') : fileURLToPath(new URL(`../../../../.ai/qa/responsive-boundaries-20261103/${run}/`, import.meta.url))
const token = 'A'.repeat(240)
const longText = '超长业务名称与说明'.repeat(24)
const modules = [
  ['platform', 'platform/styles/console.css',
    'console-content', 'console-card', 'console-page-head', 'console-table-scroll',
    'console-data-table', 'console-form-grid', 'console-button'],
  ['contract', 'contract_management/styles/contract-management.css',
    'contract-content', 'contract-card', 'contract-page-head', 'contract-table-scroll',
    'contract-data-table', 'contract-form-grid', 'contract-button'],
  ['project', 'project_management/styles/project-management.css',
    'pm-page', 'pm-panel', 'pm-page-head', 'pm-table-scroll', 'pm-table', 'pm-form', 'pm-button'],
  ['crm', 'customer_opportunity/styles/customer-opportunity.css',
    'crm-content', 'crm-panel', 'crm-page-head', 'console-table-scroll',
    'console-data-table', 'console-form-grid', 'console-button'],
  ['portal', 'customer_portal/styles/customer-portal.css',
    'portal-content', 'portal-card', 'portal-title', 'console-table-scroll',
    'console-data-table', 'console-form-grid', 'console-button'],
  ['settlement', 'settlement/styles/settlement.css',
    'settlement-content', 'settlement-panel', 'settlement-panel-head', 'settlement-table-scroll',
    'settlement-plan-table', 'console-form-grid', 'console-button'],
  ['analysis', 'data_analysis/styles/data-analysis.css',
    'da-page', 'da-panel', 'da-page-head', 'da-table-scroll', 'da-table', 'da-modal', 'da-button'],
]
const componentStyles = new Map()

// 用途：编译真实单文件组件，保留作用域样式，不启动应用或业务服务。
// 参数：无；组件入口和依赖取当前源码树。
// 返回值：浏览器脚本与编译后的样式；编译错误直接失败。
async function componentBundle() {
  const result = await build({
    stdin: { contents: `import {createApp, h} from 'vue';
      import Wizard from './src/modules/platform/applications/components/SubsystemAccessWizard.vue';
      import Confirm from './src/modules/shared/components/ConfirmDialog.vue';
      import LicenseEventsSheet from './src/modules/platform/features/licenses/LicenseEventsSheet.vue';
      import LicenseAppCard from './src/modules/platform/features/licenses/LicenseAppCard.vue';
      window.mountWizard=props=>createApp(Wizard,props).mount('#fixture');
      window.mountConfirm=props=>createApp(Confirm,props).mount('#fixture');
      window.mountLicenseEventsSheet=props=>createApp(LicenseEventsSheet,props).mount('#fixture');
      window.mountLicenseCards=(rows,el)=>createApp({render:()=>rows.map(row=>h(LicenseAppCard,{row, busy:false, loading:false}))}).mount(el);`, resolveDir: root },
    bundle: true, write: false, format: 'iife', platform: 'browser',
    define: { 'import.meta.env': '{}' }, alias: { '@': root + 'src' },
    plugins: [{ name: 'layout-vue',
      // 用途：只为布局夹具接入当前Vue组件编译器。
      // 参数：builder 为本次隔离打包的esbuild插件接口。
      // 返回值：无；注册单文件组件转换规则。
      setup(builder) {
      builder.onLoad({ filter: /\.vue$/ }, async ({ path }) => {
        const { descriptor } = parse(await readFile(path, 'utf8'), { filename: path })
        const id = 'data-v-' + createHash('sha256').update(path).digest('hex').slice(0, 8)
        const script = compileScript(descriptor, { id, inlineTemplate: true,
          genDefaultAs: '__fixtureComponent', templateOptions: { compilerOptions: { scopeId: id } } })
        componentStyles.set(path, descriptor.styles.map(style => compileStyle({
          source: style.content, filename: path, id, scoped: style.scoped,
        }).code).join('\n'))
        return { contents: script.content + `\n__fixtureComponent.__scopeId=${JSON.stringify(id)};export default __fixtureComponent;`,
          loader: 'js', resolveDir: fileURLToPath(new URL('.', 'file://' + path)) }
      })
    } }],
  })
  return result.outputFiles[0].text
}

// 用途：按真实模块结构组织长文本、原生控件、表格和格式化内容。
// 参数：item 为模块既有样式类集合。
// 返回值：仅包含合成内容的HTML；不创建业务对象。
function moduleMarkup(item) {
  const [, , content, card, heading, scroll, table, form, button] = item
  return `<main class="${content}" data-boundary="page">
    <header class="${heading}" data-boundary="heading"><div><h1>${longText}</h1><p>https://example.invalid/${token}</p></div>
      <button class="${button}" data-action>查看${longText}</button></header>
    <section class="${card}" data-boundary="card"><h2>${token}</h2>
      <form class="${form}" data-boundary="form"><label>${longText}<input value="${token}"></label>
        <label>系统<select><option>${longText}${token}</option></select></label>
        <fieldset data-boundary="fieldset"><legend>${longText}</legend><textarea>${token}</textarea></fieldset></form>
      <div class="${scroll}" data-scroll><table class="${table}"><thead><tr><th>编号</th><th>说明</th><th>操作</th></tr></thead>
        <tbody><tr><td>${token}</td><td>${longText}</td><td><button>查看详情</button></td></tr></tbody></table></div>
      <pre data-scroll>${token.repeat(3)}\n  第二行保留缩进</pre>
    </section></main>`
}

// 用途：拼出真实组件要的六行许可事实，交给浏览器里挂载的 LicenseAppCard 渲染。
// 参数：无；数值均为合成事实，不含真实许可证或凭据。
// 返回值：行对象数组；第一张卡同时带原因码与执行计数，代表内容最高的情况。
function licenseCardRows() {
  const expiry = days => Math.floor(Date.now() / 1000) + days * 86400
  const summary = { available: true, revision: 7, deploymentRevision: 42, memberCount: 2, ready: 2, acknowledged: 1, latestReadyAt: '2026-10-27T05:54:38Z', latestAckAt: '2026-10-26T01:02:03Z' }
  const license = (label, tone) => ({ key: 'IMPORTED', label, tone })
  const counters = true
  return [
    { name: '结算管理', code: 'settlement', tone: 'danger', application: { kind: 'FULL', expires_at: expiry(-12) }, license: license('已过期', 'danger'), enforcement: { key: 'ENFORCED', label: '已强制执行', tone: 'success', note: '' }, summary, showEnforcementCounters: counters, reasonCode: 'EXPIRED', action: { key: 'REIMPORT', label: '重新导入', target: 'import', hint: '已过期，需要供应商签发更高版本后再导入' } },
    { name: '客户与商机', code: 'customer_and_opportunity', tone: 'success', application: { kind: 'FULL', expires_at: expiry(268) }, license: license('已导入', 'success'), enforcement: { key: 'ENFORCED', label: '已强制执行', tone: 'success', note: '' }, summary, showEnforcementCounters: counters, reasonCode: '', action: { key: 'DETAIL', label: '查看运行详情', target: 'runtime', hint: '已强制执行，不提供重复激活' } },
    { name: '客户门户', code: 'customer_portal', tone: 'info', application: { kind: 'TRIAL', expires_at: expiry(252) }, license: license('待生效', 'info'), enforcement: { key: 'APPLYING', label: '激活中', tone: 'info', note: '' }, summary, showEnforcementCounters: counters, reasonCode: 'NOT_EFFECTIVE', action: { key: 'PROGRESS', label: '查看激活进度', target: 'runtime', hint: '激活已提交，等待组件准备并确认当前修订' } },
    { name: '合同管理', code: 'contract_management', tone: 'warning', application: { kind: 'FULL', expires_at: expiry(237) }, license: license('已导入', 'success'), enforcement: { key: 'PENDING_ENFORCEMENT', label: '待激活', tone: 'warning', note: '' }, summary, showEnforcementCounters: counters, reasonCode: '', action: { key: 'ACTIVATE', label: '去激活', target: 'runtime', hint: '在下方运行详情中核对执行修订并勾选确认后启用' } },
    { name: '项目管理', code: 'project_management', tone: 'neutral', application: { kind: 'FULL', expires_at: expiry(208) }, license: license('已导入', 'success'), enforcement: { key: 'UNREGISTERED', label: '未纳管', tone: 'neutral', note: '运行组件尚未登记，运行执行事实不存在' }, summary: null, showEnforcementCounters: false, reasonCode: '', action: { key: 'ENROLL', label: '查看运行详情', target: 'runtime', hint: '运行组件尚未登记，未接入运行时授权执行' } },
    { name: '数据分析', code: 'data_analysis', tone: 'neutral', application: { kind: 'TRIAL', expires_at: expiry(206) }, license: license('已导入', 'success'), enforcement: { key: 'UNKNOWN', label: '状态未知', tone: 'neutral', note: longText }, summary: null, showEnforcementCounters: false, reasonCode: '', action: { key: 'CONTACT', label: '联系授权管理员', target: 'none', hint: '需要商业授权管理权限才能发起激活' } },
  ]
}

// 用途：用可观察几何边界检查页面、控件与局部滚动，不依赖具体CSS实现。
// 参数：page 为隔离页面；wizard 为是否检查真实向导弹层。
// 返回值：边界违规列表；局部滚动区域内部的宽表格不记作越界。
async function violations(page, wizard = false) {
  return page.evaluate(wizard => {
    const errors = []
    // 用途：读取元素实际边界，判定是否超出容器与视口。
    // 参数：e 为本次隔离页面中的DOM元素。
    // 返回值：浏览器布局产生的DOMRect。
    const box = e => e.getBoundingClientRect()
    const viewport = document.documentElement.clientWidth
    if (document.documentElement.scrollWidth > viewport + 1) errors.push('document horizontal overflow')
    const selector = wizard
      ? '.subsystem-access-wizard__dialog,.subsystem-access-wizard__header,.subsystem-access-wizard__fieldset,.subsystem-access-progress'
      : '[data-boundary],input,select,textarea,[data-action]'
    for (const element of document.querySelectorAll(selector)) {
      const r = box(element)
      if (r.width && (r.left < -1 || r.right > viewport + 1)) errors.push(element.className + ': outside viewport')
      if (element.matches('[data-boundary],.subsystem-access-wizard__dialog') && element.scrollWidth > element.clientWidth + 1) {
        errors.push((element.className || element.tagName) + ': child horizontal overflow')
      }
      if (element.matches('[data-action]') && (element.scrollWidth > element.clientWidth + 1
        || element.scrollHeight > element.clientHeight + 1)) errors.push('action text exceeds button')
    }
    if (wizard) {
      const dialog = document.querySelector('.subsystem-access-wizard__dialog')
      const close = document.querySelector('.subsystem-access-wizard__close')
      if (box(dialog).top < -1 || box(dialog).bottom > innerHeight + 1) errors.push('dialog exceeds viewport height')
      if (box(close).right > viewport + 1) errors.push('close action unreachable')
    }
    for (const dialog of document.querySelectorAll('[role="alertdialog"]')) {
      const r = box(dialog)
      if (r.left < -1 || r.right > viewport + 1 || r.top < -1 || r.bottom > innerHeight + 1) {
        errors.push('confirmation exceeds viewport')
      }
      if (dialog.scrollWidth > dialog.clientWidth + 1) errors.push('confirmation child horizontal overflow')
      // 字体墨迹可能超出关闭图标的行框；正文操作按钮应完整容纳文字。
      for (const button of dialog.querySelectorAll('footer button')) {
        if (button.scrollWidth > button.clientWidth + 1 || button.scrollHeight > button.clientHeight + 1) {
          errors.push('confirmation action text exceeds button')
        }
      }
    }
    for (const pre of document.querySelectorAll('pre')) {
      if (getComputedStyle(pre).whiteSpace !== 'pre') errors.push('pre formatting lost')
      if (!['auto', 'scroll'].includes(getComputedStyle(pre).overflowX)) errors.push('pre cannot scroll')
    }
    for (const region of document.querySelectorAll('[data-scroll]')) {
      if (region.scrollWidth > region.clientWidth + 1
        && !['auto', 'scroll'].includes(getComputedStyle(region).overflowX)) errors.push('wide content cannot scroll')
    }
    return errors
  }, wizard)
}

// 用途：用真实 console.css 骨架检查授权事件抽屉的几何契约。
// 参数：page 为挂载了真实 LicenseEventsSheet 的页面；width/height 为当前视口。
// 返回值：违规列表；≤720px 要求整屏，>720px 要求右贴边且不超过 560px。
async function sheetViolations(page, width, height) {
  return page.evaluate(({ width, height }) => {
    const errors = []
    const box = element => element.getBoundingClientRect()
    const sheet = document.querySelector('.console-sheet')
    if (!sheet) return ['event sheet missing']
    const rect = box(sheet)
    const fullScreen = width <= 720
    if (fullScreen) {
      if (Math.abs(rect.left) > 1 || Math.abs(rect.top) > 1
        || Math.abs(rect.right - width) > 1 || Math.abs(rect.bottom - height) > 1) {
        errors.push('mobile sheet must cover viewport: ' + JSON.stringify(rect))
      }
    } else {
      if (Math.abs(rect.right - width) > 1) errors.push('desktop sheet must stick to the right edge')
      if (rect.width > 561 || rect.width < 200) errors.push('desktop sheet width out of range: ' + rect.width)
      if (Math.abs(rect.height - height) > 1) errors.push('desktop sheet must be full height')
    }
    const close = box(document.querySelector('.console-sheet__close'))
    if (close.width < (fullScreen ? 44 : 36)) errors.push('close target too small: ' + close.width)
    if (close.left < -1 || close.right > width + 1 || close.top < -1 || close.bottom > height + 1) errors.push('close action unreachable')
    const body = document.querySelector('.console-sheet__body')
    if (body.scrollWidth > body.clientWidth + 1) errors.push('event sheet body horizontal overflow')
    const footer = box(document.querySelector('.console-sheet__footer'))
    if (footer.bottom > height + 1) errors.push('sheet pagination unreachable')
    if (document.documentElement.scrollWidth > width + 1) errors.push('document horizontal overflow (sheet)')
    // 行高契约：桌面 48px、移动 64px；摘要行内部不允许横向溢出。
    const summary = document.querySelector('.license-event-summary')
    if (summary) {
      const measured = box(summary)
      const expected = fullScreen ? 64 : 48
      if (measured.height < expected - 1) errors.push(`event summary height ${measured.height} < ${expected}`)
      if (summary.scrollWidth > summary.clientWidth + 1) errors.push('event summary horizontal overflow')
    }
    return errors
  }, { width, height })
}

// 用途：拦截所有浏览器请求，用只读合成响应驱动真实向导恢复到结果步骤。
// 参数：page 为独立页面；errors 为收集非预期请求的数组。
// 返回值：无；禁止对外请求与任何业务写入。
async function fixtureNetwork(page, errors) {
  await page.route('**/*', route => {
    const request = route.request(), url = new URL(request.url())
    if (url.origin !== 'http://layout.invalid' || request.method() !== 'GET') {
      errors.push('unexpected network ' + request.method() + ' ' + url.pathname)
      return route.abort()
    }
    if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: '<div id="fixture"></div>' })
    const operation = { operation_id: '01H000000000000000000000001', application_code: 'project_management',
      environment: 'prod', status: 'SUCCEEDED', stage: 'ready', action: 'UPDATE',
      result_ref: 'sha256:' + token, attempt_count: 1,
      stages: [{ stage: 'ready', status: 'SUCCEEDED', attempt_count: 1, evidence_ref: 'https://example.invalid/' + token }] }
    const data = url.pathname.endsWith('/subsystem-capabilities')
      ? { supported_application_codes: ['project_management'] } : operation
    return route.fulfill({ json: { code: 'OK', data } })
  })
  await page.goto('http://layout.invalid/')
}

await mkdir(output, { recursive: true })
const bundle = await componentBundle()
// 用途：读取当前模块的真实样式文件，不写入业务目录。
// 参数：name 为src/modules下的相对样式路径。
// 返回值：样式文本Promise；缺文件时失败。
const load = name => readFile(root + 'src/modules/' + name, 'utf8')
const base = await load('platform/shared/styles/main.css')
const consoleCss = await load('platform/styles/console.css')
const sharedCss = await load('shared/styles/global-ux.css')
const moduleCss = await Promise.all(modules.slice(1).map(item => load(item[1])))
moduleCss.push(await load('platform/iam/styles/iam-settings.css'))
const licenseSource = await readFile(root + 'src/modules/platform/features/licenses/CommercialLicenseView.vue', 'utf8')
const licenseCardSource = await readFile(root + 'src/modules/platform/features/licenses/LicenseAppCard.vue', 'utf8')
const licenseScope = 'data-v-layout-license'
// 许可页与卡片分别编译、共用同一个作用域 id：夹具里两组规则都只认属性存在，与真实两份 scope 等价。
for (const source of [licenseSource, licenseCardSource]) {
  moduleCss.push(parse(source).descriptor.styles.map(style => compileStyle({
    source: style.content, id: licenseScope, scoped: style.scoped,
  }).code).join('\n'))
}
const scoped = [...componentStyles.values()].join('\n')
// 抽屉夹具单独用一份完整样式（含真实组件 scoped 样式），在宽度循环里只跑一次。
const sheetCss = base + consoleCss + sharedCss + moduleCss.join('\n') + scoped
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
})
const results = []
try {
  for (const [width, height] of [[1440, 900], [1024, 768], [800, 600], [640, 480], [375, 667], [320, 568]]) {
    for (const item of modules) {
      const page = await browser.newPage({ viewport: { width, height }, reducedMotion: 'reduce' })
      // 三个独立壳层不依赖console.css，避免其它模块规则掩盖首次直达的问题。
      const needsConsole = !['contract', 'project', 'analysis'].includes(item[0])
      const css = base + sharedCss + (needsConsole ? consoleCss : '')
        + (item[0] === 'platform' ? '' : await load(item[1]))
      await page.setContent(`<style>${css}</style><div id="app">${moduleMarkup(item)}</div>`)
      results.push({ module: item[0], width, height, order: 'module-only', errors: await violations(page) })
      await page.close()
    }
    for (const order of ['shared-first', 'shared-last']) {
      const css = base + consoleCss + (order === 'shared-first' ? sharedCss : '') + moduleCss.join('\n')
        + (order === 'shared-last' ? sharedCss : '') + scoped
      for (const item of modules) {
        const page = await browser.newPage({ viewport: { width, height }, reducedMotion: 'reduce' })
        await page.setContent(`<style>${css}</style><div id="app">${moduleMarkup(item)}</div>`)
        const errors = await violations(page)
        const control = await page.locator('input').inputValue()
        assert.equal(control, token, 'layout must preserve complete input values')
        results.push({ module: item[0], width, height, order, errors })
        await page.close()
      }
      for (const grid of ['crm-customer-cards', 'crm-stage-alert-grid', 'pm-detail-summary', 'project-list',
        'license-facts', 'license-app-grid', 'license-field-row', 'iam-person-summary-grid']) {
        const page = await browser.newPage({ viewport: { width, height }, reducedMotion: 'reduce' })
        const scope = grid.startsWith('license-') ? licenseScope : ''
        await page.setContent(`<style>${css}</style><section class="console-card" style="width:min(220px,100%);padding:20px" data-boundary>
          <div class="${grid}" ${scope} data-boundary><article ${scope}>${longText}</article><article ${scope}>${token}</article></div></section>`)
        results.push({ module: grid, width, height, order, errors: await violations(page) })
        await page.close()
      }
      // 逐应用卡片网格：挂载真实 LicenseAppCard 渲染六张卡，1440 下应 4 列 2 行、近方形、无横向溢出。
      const cardPage = await browser.newPage({ viewport: { width, height }, reducedMotion: 'reduce' })
      await cardPage.setContent(`<style>${css}</style><main class="console-content"><section class="license-page" ${licenseScope}>
        <section class="console-card license-section" ${licenseScope} data-boundary>
          <ul class="license-app-grid" ${licenseScope} data-boundary></ul>
        </section></section></main>`)
      await cardPage.addScriptTag({ content: bundle })
      await cardPage.evaluate(rows => window.mountLicenseCards(rows, document.querySelector('.license-app-grid')), licenseCardRows())
      const cardErrors = await violations(cardPage)
      const cardMetrics = await cardPage.evaluate(() => {
        const boxes = [...document.querySelectorAll('.license-app-card')].map(card => card.getBoundingClientRect())
        const columns = new Set(boxes.map(box => Math.round(box.left))).size
        const rows = new Set(boxes.map(box => Math.round(box.top))).size
        const widths = boxes.map(box => Math.round(box.width))
        const heights = boxes.map(box => Math.round(box.height))
        const ratio = Math.max(...boxes.map(box => box.height / box.width))
        return { cards: boxes.length, columns, rows, width: Math.min(...widths), maxWidth: Math.max(...widths), height: Math.max(...heights), ratio: Math.round(ratio * 1000) / 1000 }
      })
      if (width === 1440) {
        assert.equal(cardMetrics.cards, 6, '六张卡片必须全部渲染')
        assert.equal(cardMetrics.columns, 4, '≥1280 期望四列，实际 ' + JSON.stringify(cardMetrics))
        assert.ok(cardMetrics.rows <= 2, '六张卡在 1440 下不得超过两行：' + JSON.stringify(cardMetrics))
        assert.ok(cardMetrics.ratio <= 1.15, '卡片应接近方形（高/宽 ≤ 1.15）：' + JSON.stringify(cardMetrics))
      }
      if (width === 375 || width === 1440) {
        await cardPage.screenshot({ path: output + `license-app-cards-${width}-${order}.png`, fullPage: true })
      }
      results.push({ module: 'license-app-cards', width, height, order, errors: cardErrors, metrics: cardMetrics })
      await cardPage.close()
      const page = await browser.newPage({ viewport: { width, height }, reducedMotion: 'reduce' })
      const errors = []
      page.on('pageerror', error => errors.push(error.message))
      await fixtureNetwork(page, errors)
      await page.addStyleTag({ content: css })
      await page.addScriptTag({ content: bundle })
      await page.evaluate(({ name }) => window.mountWizard({ canPreview: true, canSubmit: true,
        reconnectOnOpen: true, defaultApplicationCode: 'project_management', defaultEnvironment: 'prod',
        applications: [{ code: 'project_management', name }] }), { name: longText })
      await page.locator('.subsystem-access-wizard__trigger').click()
      await page.locator('.subsystem-access-progress__stages').waitFor()
      errors.push(...await violations(page, true))
      const dialog = page.locator('.subsystem-access-wizard__dialog')
      await dialog.evaluate(e => { e.scrollTop = e.scrollHeight })
      assert.ok((await page.locator('.subsystem-access-progress__evidence').textContent()).includes(token))
      if (width === 1440 || width === 375) {
        await dialog.evaluate(e => { e.scrollTop = 0 })
        await page.screenshot({ path: output + `wizard-${width}-${order}.png`, fullPage: true })
      }
      results.push({ module: 'actual-access-wizard', width, height, order, errors })
      await page.close()
      const confirm = await browser.newPage({ viewport: { width, height }, reducedMotion: 'reduce' })
      const confirmationErrors = []
      confirm.on('pageerror', error => confirmationErrors.push(error.message))
      await fixtureNetwork(confirm, confirmationErrors)
      await confirm.addStyleTag({ content: css })
      await confirm.addScriptTag({ content: bundle })
      await confirm.evaluate(({ title, description }) => window.mountConfirm({ title, description,
        confirmText: title, cancelText: '取消' }), { title: longText, description: token.repeat(2) })
      await confirm.getByRole('alertdialog').waitFor()
      confirmationErrors.push(...await violations(confirm))
      await confirm.locator('.shared-confirm').evaluate(e => { e.scrollTop = 0 })
      const closeBox = await confirm.locator('.shared-confirm-close').boundingBox()
      if (!(closeBox && closeBox.x >= 0 && closeBox.x + closeBox.width <= width
        && closeBox.y >= 0 && closeBox.y + closeBox.height <= height)) {
        confirmationErrors.push('close action unreachable: ' + JSON.stringify(closeBox))
      }
      await confirm.locator('.shared-confirm').evaluate(e => { e.scrollTop = e.scrollHeight })
      const action = confirm.locator('.shared-confirm-button.primary')
      await action.scrollIntoViewIfNeeded()
      assert.ok(await action.isVisible(), 'long dialogs must retain a reachable confirmation action')
      results.push({ module: 'actual-shared-confirm', width, height, order, errors: confirmationErrors })
      await confirm.close()
    }
    // 授权事件抽屉：挂真实组件，用真实 console.css 骨架检查「移动端整屏 / 桌面 560px 右贴边」。
    {
      const sheetPage = await browser.newPage({ viewport: { width, height }, reducedMotion: 'reduce' })
      const sheetErrors = []
      sheetPage.on('pageerror', error => sheetErrors.push(error.message))
      await sheetPage.setContent('<div id="fixture"></div>')
      await sheetPage.addStyleTag({ content: sheetCss })
      await sheetPage.addScriptTag({ content: bundle })
      // 抽屉自己取数：只替换 fetch，注入 20 条合成事件，不发任何真实请求。
      await sheetPage.evaluate(({ longText, pageSize }) => {
        const items = Array.from({ length: pageSize }, (_, index) => ({
          id: '01H0000000000000000000' + String(index).padStart(4, '0'),
          kind: index === 0 ? 'FUTURE_EVENT' : 'IMPORTED_CURRENT',
          version: 3, revision: index + 1, created_at: '2026-10-13T04:34:56Z',
          digest: 'sha256:' + 'a'.repeat(40), tenant_id: '', user_id: '',
          note: longText,
        }))
        window.fetch = async () => ({
          ok: true, status: 200, headers: { get: () => 'application/json' },
          json: async () => ({ code: 'OK', data: { items, total: 120, page: 1 } }),
        })
        window.mountLicenseEventsSheet({ open: true })
      }, { longText, pageSize: 20 })
      await sheetPage.locator('.console-sheet').waitFor()
      await sheetPage.locator('.license-event-summary').first().waitFor()
      sheetErrors.push(...await sheetViolations(sheetPage, width, height))
      if (width === 1440 || width === 375) await sheetPage.screenshot({ path: output + `license-events-sheet-${width}.png` })
      results.push({ module: 'actual-license-events-sheet', width, height, order: 'sheet-only', errors: sheetErrors })
      await sheetPage.close()
    }
  }
} finally {
  await browser.close()
}
await writeFile(output + 'results.json', JSON.stringify(results, null, 2))
const failures = results.filter(item => item.errors.length)
console.log(JSON.stringify({ cases: results.length, failures: failures.length, examples: failures.slice(0, 8) }, null, 2))
assert.equal(failures.length, 0, 'long content must remain within each module and dialog boundary')
