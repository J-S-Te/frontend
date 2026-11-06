// 隔离布局回归：实际Vue组件、实际模块CSS、合成数据；全部请求在浏览器内处理。
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
const output = fileURLToPath(new URL(
  `../../../../.ai/qa/responsive-boundaries-20261103/${run}/`, import.meta.url))
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
    stdin: { contents: `import {createApp} from 'vue';
      import Wizard from './src/modules/platform/applications/components/SubsystemAccessWizard.vue';
      import Confirm from './src/modules/shared/components/ConfirmDialog.vue';
      window.mountWizard=props=>createApp(Wizard,props).mount('#fixture');
      window.mountConfirm=props=>createApp(Confirm,props).mount('#fixture');`, resolveDir: root },
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
const licenseScope = 'data-v-layout-license'
moduleCss.push(parse(licenseSource).descriptor.styles.map(style => compileStyle({
  source: style.content, id: licenseScope, scoped: style.scoped,
}).code).join('\n'))
const scoped = [...componentStyles.values()].join('\n')
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
        'license-facts', 'license-app-facts', 'license-field-row', 'iam-person-summary-grid']) {
        const page = await browser.newPage({ viewport: { width, height }, reducedMotion: 'reduce' })
        const scope = grid.startsWith('license-') ? licenseScope : ''
        await page.setContent(`<style>${css}</style><section class="console-card" style="width:min(220px,100%);padding:20px" data-boundary>
          <div class="${grid}" ${scope} data-boundary><article ${scope}>${longText}</article><article ${scope}>${token}</article></div></section>`)
        results.push({ module: grid, width, height, order, errors: await violations(page) })
        await page.close()
      }
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
  }
} finally {
  await browser.close()
}
await writeFile(output + 'results.json', JSON.stringify(results, null, 2))
const failures = results.filter(item => item.errors.length)
console.log(JSON.stringify({ cases: results.length, failures: failures.length, examples: failures.slice(0, 8) }, null, 2))
assert.equal(failures.length, 0, 'long content must remain within each module and dialog boundary')
