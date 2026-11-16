// 本轮UI隔离回归：真实Vue视图/共享组件/CSS，只有会话及HTTP边界使用合成数据。
// 默认只访问内存内联夹具；所有其他浏览器请求均中止，禁止接业务API或业务库。
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build, transform } from 'esbuild'
import { compileScript, compileStyle, parse } from '@vue/compiler-sfc'
import { chromium } from 'playwright-core'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const output = process.env.LOCAL_UI_OUTPUT_DIR || '/private/tmp/metrics-local-ui-browser'
const origin = 'http://local-ui-fixture.invalid/'
const styles = new Map()
const apiFiles = {
  analysis: join(root, 'src/modules/data_analysis/api/dataAnalysis.js'),
  portal: join(root, 'src/modules/customer_portal/api/portal.js'),
}

const fixtureEntry = `
import {createApp,h,nextTick,ref} from 'vue';
import {createMemoryHistory,createRouter} from 'vue-router';
import AppShell from './src/modules/shared/components/AppShell.vue';
import ConfirmDialog from './src/modules/shared/components/ConfirmDialog.vue';
import ShellPreferences from './src/modules/shared/components/ShellPreferences.vue';
import AnalysisView from './src/modules/data_analysis/views/DashboardShellView.vue';
import PortalView from './src/modules/customer_portal/views/CustomerPortalView.vue';
import {installDocumentThemeSync,syncDocumentTheme} from './src/modules/platform/shared/composables/useDocumentTheme.js';
installDocumentThemeSync();
window.__fixtureApiCalls=[];
window.__unexpectedApiCalls=[];
window.__notificationsRecovered=false;
window.__fixtureMetrics=Array.from({length:45},(_,index)=>({
 code:'M'+String(index).padStart(3,'0'),name:'合成指标 '+index,dashboard:'合成项目看板',
 definition:'合成业务定义'.repeat(50),formula:index===43?'专属公式':'A'.repeat(240),
 source:'SOURCE_'+ 'B'.repeat(220),period:'月',status:'已确认',version:3,
 origin:'CUSTOM',enabled:false,can_enable:false,enable_block_reason:'CALCULATION_BINDING_MISSING'
}));
const feedback={id:'synthetic-feedback',feedback_no:'FB-HARNESS-1',title:'合成反馈主体',
 type:'SUGGESTION',description:'此数据仅用于隔离浏览器布局与键盘回归',status:'PROCESSING',
 first_response_due_at:'2026-11-12T02:00:00Z'};
window.__fixtureAPI={
 getAuthMe:async()=>({tenant_id:'fixture-tenant',user_id:'fixture-user',
  username:'合成用户',roles:['analyst'],permissions:['dictionary.view','dictionary.manage'],
  capabilities:{dashboard_embed_enabled:false}}),
 getDictionary:async()=>({metrics:window.__fixtureMetrics}),
 getDictionaryMetricVersions:async(code)=>[{metric:window.__fixtureMetrics.find(item=>item.code===code),
  operation:'UPDATE',actor_id:'fixture-user',created_at:'2026-11-12T00:00:00Z'}],
 getPortalSession:async()=>({username:'合成客户',display_name:'合成客户',tenant_id:'fixture-tenant',
  customer_id:1,roles:['customer'],permissions:['feedback.read','feedback.create','feedback.reply']}),
 getPortalCapabilities:async()=>({customer:{feedback_enabled:true}}),
 listFeedbacks:async()=>({items:[feedback],total:1}),
 getFeedback:async()=>({feedback,messages:[],status_logs:[]}),
 listFeedbackNotifications:async()=>{if(!window.__notificationsRecovered)throw new Error('合成通知暂时不可用');return {items:[]}},
 getFeedbackNotificationUnreadCount:async()=>{if(!window.__notificationsRecovered)throw new Error('合成通知计数不可用');return {count:0}},
};
let app;
const ContractTopbarFixture={render:()=>h('div',{class:'contract-app'},[
 h('main',{class:'contract-main'},[h('header',{class:'contract-topbar'},[
  h('div',{class:'contract-breadcrumb'},[h('span','合同管理系统'),h('strong','合成合同台账')]),
  h(ShellPreferences,{sidebarId:'fixture-contract-sidebar'})
 ])])
])};
const SharedShellFixture={setup(){
 const menuOpen=ref(false),confirmOpen=ref(false);
 return ()=>h(AppShell,{brandName:'隔离共享壳层',crumb:'键盘回归',menuOpen:menuOpen.value,
  'onUpdate:menuOpen':value=>{menuOpen.value=value},
  navGroups:[{label:'合成导航',items:[{key:'a',label:'第一个导航'},{key:'b',label:'第二个导航'}]}]},
  {default:()=>h('section',{},[
   h('button',{id:'open-fixture-confirm',type:'button',onClick:()=>{confirmOpen.value=true}},'打开确认框'),
   h('input',{'aria-label':'主区输入',id:'fixture-main-input'}),
   h('button',{id:'fixture-last-button',type:'button'},'主区末尾按钮')]),
   overlay:()=>h(ConfirmDialog,{open:confirmOpen.value,title:'合成确认框',description:'仅验证键盘及焦点恢复',
    confirmText:'确认',onCancel:()=>{confirmOpen.value=false},onConfirm:()=>{confirmOpen.value=false}})})
}};
// mountLocalUI 切换真实视图夹具，保持所有数据及会话边界在浏览器内。
// 参数：kind 为共享外壳、字典或客户反馈场景。
// 返回值：Promise完成；实际组件挂载错误向测试传播。
window.mountLocalUI=async(kind)=>{
 app?.unmount();
 localStorage.removeItem('basic-platform.sidebar-collapsed');
 localStorage.removeItem('basic-platform.portal-theme');
 window.__notificationsRecovered=false;
 syncDocumentTheme();
 document.querySelector('#app').replaceChildren();
 if(kind==='shell')app=createApp(SharedShellFixture);
 else if(kind==='contract-topbar')app=createApp(ContractTopbarFixture);
 else {
  const router=createRouter({history:createMemoryHistory(),routes:[
   {path:'/analysis/:section',name:'data_analysis',component:AnalysisView},
   {path:'/portal/:section',name:'customer_portal',component:PortalView},
  ]});
  await router.push(kind==='dictionary'?'/analysis/dictionary':'/portal/feedback');
  await router.isReady();
  app=createApp(kind==='dictionary'?AnalysisView:PortalView).use(router);
 }
 app.config.errorHandler=(error)=>{window.__unexpectedApiCalls.push('Vue:'+error.message);console.error(error)};
 app.mount('#app');
 await nextTick();
};
`

// mockAPIModule 仅为实际API模块提供合成会话/HTTP边界；未声明调用立即失败。
// 参数：path 为API源码位置，kind 区分数据分析与门户模块。
// 返回值：保留原导出名称的测试模块文本，不包含真实请求实现。
async function mockAPIModule(path, kind) {
  const source = await readFile(path, 'utf8')
  const names = [...source.matchAll(/^export\s+(?:async\s+)?(?:function|const|class)\s+(\w+)/gm)]
    .map(match => match[1])
  return names.map(name => {
    if (name === 'PortalAPIError') return 'export class PortalAPIError extends Error {}'
    if (name === 'isDashboardEmbedEnabled') return 'export const isDashboardEmbedEnabled=()=>false;'
    return `export const ${name}=(...args)=>{
      window.__fixtureApiCalls.push(${JSON.stringify(kind + ':' + name)});
      const handler=window.__fixtureAPI[${JSON.stringify(name)}];
      if(handler)return handler(...args);
      window.__unexpectedApiCalls.push(${JSON.stringify(kind + ':' + name)});
      throw new Error('Unexpected fixture API call: '+${JSON.stringify(name)});
    };`
  }).join('\n')
}

// bundleFixture 编译真实Vue视图、共享组件和样式，替换API外部边界。
// 参数：无。
// 返回值：内联浏览器脚本及实际样式；缺依赖或编译错误直接失败。
async function bundleFixture() {
  const bundled = await build({
    stdin: { contents: fixtureEntry, resolveDir: root },
    bundle: true, write: false, format: 'iife', platform: 'browser',
    alias: { '@': join(root, 'src') }, define: { 'import.meta.env': '{}' },
    plugins: [{ name: 'local-fixes-fixture',
      // setup 安装与现有布局harness相同的Vue编译及隔离边界。
      // 参数：builder 为esbuild插件注册对象。
      // 返回值：无。
      setup(builder) {
        builder.onLoad({ filter: /(?:dataAnalysis|portal)\.js$/ }, async ({ path }) => {
          const kind = Object.keys(apiFiles).find(key => apiFiles[key] === path)
          if (!kind) return undefined
          return { contents: await mockAPIModule(path, kind), loader: 'js', resolveDir: dirname(path) }
        })
        builder.onLoad({ filter: /\.css$/ }, async ({ path }) => {
          styles.set(path, await readFile(path, 'utf8'))
          return { contents: '', loader: 'js' }
        })
        builder.onLoad({ filter: /\.vue$/ }, async ({ path }) => {
          const { descriptor } = parse(await readFile(path, 'utf8'), { filename: path })
          const id = 'data-v-' + createHash('sha256').update(path).digest('hex').slice(0, 8)
          const script = compileScript(descriptor, { id, inlineTemplate: true,
            genDefaultAs: '__fixtureComponent', templateOptions: { compilerOptions: { scopeId: id } } })
          const compiledStyles = descriptor.styles.map(style => compileStyle({
            source: style.content, filename: path, id, scoped: style.scoped,
          }))
          for (const style of compiledStyles) assert.deepEqual(style.errors, [], path)
          styles.set(path, compiledStyles.map(style => style.code).join('\n'))
          const transpiled = await transform(script.content, { loader: 'ts' })
          return { contents: transpiled.code + `\n__fixtureComponent.__scopeId=${JSON.stringify(id)};export default __fixtureComponent;`,
            loader: 'js', resolveDir: dirname(path) }
        })
      },
    }],
  })
  const commonPaths = ['platform/shared/styles/main.css', 'shared/styles/global-ux.css',
    'platform/shared/styles/state.css', 'platform/styles/console.css',
    'data_analysis/styles/data-analysis.css', 'customer_portal/styles/customer-portal.css',
    'contract_management/styles/contract-management.css']
  const common = await Promise.all(commonPaths.map(path => readFile(join(root, 'src/modules', path), 'utf8')))
  return { script: bundled.outputFiles[0].text, css: common.join('\n') + '\n' + [...styles.values()].join('\n') }
}

// mountScenario 挂载合成场景并固定视口，不启动业务服务。
// 参数：page 为隔离浏览器页，kind 为场景名，width 为视口宽度。
// 返回值：Promise完成。
async function mountScenario(page, kind, width) {
  await page.setViewportSize({ width, height: 900 })
  await page.evaluate(kind => window.mountLocalUI(kind), kind)
}

// assertPageWidth 核对页面横向溢出由局部表格容器承接。
// 参数：page 为当前页面，label 为失败时使用的场景描述。
// 返回值：Promise完成；页面撑宽时失败。
async function assertPageWidth(page, label) {
  const metrics = await page.evaluate(() => ({
    viewport: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth,
  }))
  assert.ok(metrics.document <= metrics.viewport + 1 && metrics.body <= metrics.viewport + 1,
    label + ': ' + JSON.stringify(metrics))
}

// assertFocusLoop 检查实际DOM焦点首尾在Tab及ShiftTab之间循环。
// 参数：page 为当前页面，selector 为当前活动浮层或侧栏选择器。
// 返回值：Promise完成；焦点逃逸或未形成循环时失败。
async function assertFocusLoop(page, selector) {
  const firstAndLast = await page.locator(selector).evaluate(element => {
    const items = [...element.querySelectorAll('button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')]
      .filter(item => item.offsetParent !== null)
    if (!items.length) throw new Error('fixture layer has no focusable controls')
    items.forEach((item, index) => { item.dataset.fixtureFocusIndex = String(index) })
    items[0].focus()
    return { first: '0', last: String(items.length - 1) }
  })
  await page.keyboard.press('Shift+Tab')
  assert.equal(await page.evaluate(() => document.activeElement.dataset.fixtureFocusIndex), firstAndLast.last)
  await page.keyboard.press('Tab')
  assert.equal(await page.evaluate(() => document.activeElement.dataset.fixtureFocusIndex), firstAndLast.first)
}

// readTopbarContrast 读取实际渲染文字与叠加背景色，计算相对亮度对比度。
// 参数：page 为隔离浏览器页，selector 为使用真实模块CSS的顶栏。
// 返回值：颜色、对比度与几何；不从源码推断颜色。
async function readTopbarContrast(page, selector) {
  return page.locator(selector).evaluate(element => {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 1
    const context = canvas.getContext('2d', { willReadFrequently: true })
    const rgba = color => {
      context.clearRect(0, 0, 1, 1)
      context.fillStyle = color
      context.fillRect(0, 0, 1, 1)
      return [...context.getImageData(0, 0, 1, 1).data]
    }
    const blend = (foreground, background) => foreground.slice(0, 3)
      .map((value, index) => value * foreground[3] / 255 + background[index] * (1 - foreground[3] / 255))
    const parents = []
    for (let current = element; current; current = current.parentElement) parents.unshift(current)
    let background = [255, 255, 255]
    for (const parent of parents) background = blend(rgba(getComputedStyle(parent).backgroundColor), background)
    const foreground = blend(rgba(getComputedStyle(element.querySelector('strong')).color), background)
    const luminance = color => color.map(value => value / 255)
      .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
      .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0)
    const values = [luminance(foreground), luminance(background)].sort((a, b) => a - b)
    const rect = element.getBoundingClientRect()
    return { foreground, background, ratio: (values[1] + 0.05) / (values[0] + 0.05),
      geometry: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } }
  })
}

// checkTopbarThemes 核验数析真实外壳与合同真实CSS的顶栏在两种主题中可读。
// 参数：page 为隔离浏览器页；合同仅采用原外壳结构及公共控件，不装配业务API。
// 返回值：实际颜色、对比度及几何记录；普通字号小于4.5对比度时失败。
async function checkTopbarThemes(page) {
  const measurements = []
  for (const [kind, selector] of [['dictionary', '.da-topbar'], ['contract-topbar', '.contract-topbar']]) {
    await mountScenario(page, kind, 1440)
    if (kind === 'dictionary') await page.locator('.da-dict-item').first().waitFor()
    const light = await readTopbarContrast(page, selector)
    await page.getByRole('combobox', { name: '界面主题', exact: true }).selectOption('dark')
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark')
    const dark = await readTopbarContrast(page, selector)
    measurements.push({ module: kind, light, dark })
    await page.screenshot({ path: join(output, `${kind}-topbar-dark.png`), fullPage: true })
  }
  console.log(JSON.stringify({ topbarContrast: measurements }))
  for (const measurement of measurements) {
    assert.ok(measurement.light.ratio >= 4.5, `${measurement.module}浅色顶栏文字对比度不足：${measurement.light.ratio}`)
    assert.ok(measurement.dark.ratio >= 4.5, `${measurement.module}深色顶栏文字对比度不足：${measurement.dark.ratio}`)
    assert.deepEqual(measurement.dark.geometry, measurement.light.geometry, '主题切换不得改变顶栏几何')
  }
  return measurements
}

// checkSharedShell 验证共享侧栏的真实焦点树、关闭恢复及ConfirmDialog分层。
// 参数：page 为隔离页。
// 返回值：Promise完成；任一键盘契约不成立时失败。
async function checkSharedShell(page) {
  await mountScenario(page, 'shell', 390)
  await page.waitForFunction(() => document.querySelector('#app-shell-sidebar')?.inert === true)
  await page.locator('#open-fixture-confirm').focus()
  for (let index = 0; index < 12; index += 1) {
    await page.keyboard.press('Tab')
    assert.equal(await page.evaluate(() => Boolean(document.activeElement.closest('#app-shell-sidebar'))), false)
  }
  await page.getByRole('button', { name: '打开导航菜单', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('#app-shell-sidebar').contains(document.activeElement))
  await assertFocusLoop(page, '#app-shell-sidebar')
  await page.keyboard.press('Escape')
  await page.waitForFunction(() => document.querySelector('#app-shell-sidebar').inert && document.activeElement.classList.contains('console-menu-button'))
  await page.locator('#open-fixture-confirm').click()
  await page.getByRole('alertdialog', { name: '合成确认框' }).waitFor()
  await assertFocusLoop(page, '[role="alertdialog"]')
  await page.keyboard.press('Escape')
  await page.waitForFunction(() => document.activeElement.id === 'open-fixture-confirm')
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.getByRole('button', { name: '深色', exact: true }).click()
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark')
  await page.getByRole('button', { name: '收起侧栏', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('#app-shell-sidebar').inert === true)
  assert.equal(await page.locator('.console-main').evaluate(element => Math.round(element.getBoundingClientRect().left)), 0)
  await page.getByRole('button', { name: '展开侧栏', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('#app-shell-sidebar').inert === false)
  await page.screenshot({ path: join(output, 'shared-shell-desktop.png'), fullPage: true })
}

// checkDictionary 验证真实字典分组卡片、长字段、编辑及历史焦点。
// 参数：page 为隔离页，width 为窄屏或桌面视口。
// 返回值：Promise完成；布局、搜索或浮层行为回归时失败。
async function checkDictionary(page, width) {
  await mountScenario(page, 'dictionary', width)
  await page.locator('.da-dict-item').first().waitFor()
  assert.equal(await page.locator('.da-dict-item').count(), 45)
  await assertPageWidth(page, `dictionary-${width}-list`)
  assert.match(await page.locator('.da-dict-item').first().innerText(), /合成业务定义/)
  await assertPageWidth(page, `dictionary-${width}-details`)
  if (width === 1440) {
    await page.getByRole('combobox', { name: '界面主题', exact: true }).selectOption('dark')
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark')
    await page.getByRole('button', { name: '收起侧栏', exact: true }).click()
    await page.waitForFunction(() => document.querySelector('#da-sidebar').inert === true)
    assert.equal(await page.locator('.da-main').evaluate(element => Math.round(element.getBoundingClientRect().left)), 0)
    await page.getByRole('button', { name: '展开侧栏', exact: true }).click()
  }
  const editorTrigger = page.getByRole('button', { name: '编辑', exact: true }).first()
  await editorTrigger.click()
  await page.getByRole('dialog', { name: '编辑指标口径', exact: true }).waitFor()
  await assertFocusLoop(page, 'form[role="dialog"]')
  await page.getByRole('dialog', { name: '编辑指标口径', exact: true }).getByLabel('名称', { exact: true }).fill('未保存的合成修改')
  await page.keyboard.press('Escape')
  await page.getByRole('alertdialog', { name: '放弃指标编辑？', exact: true }).waitFor()
  await assertFocusLoop(page, '.shared-confirm')
  await page.getByRole('button', { name: '放弃修改', exact: true }).click()
  await page.waitForFunction(() => !document.querySelector('form[role="dialog"]'))
  assert.equal(await editorTrigger.evaluate(element => element === document.activeElement), true)
  const historyTrigger = page.getByRole('button', { name: '版本历史', exact: true }).first()
  await historyTrigger.click()
  await page.getByRole('dialog', { name: '合成指标 0 · 版本历史', exact: true }).waitFor()
  await assertFocusLoop(page, '.da-dict-history')
  await page.keyboard.press('Escape')
  await page.waitForFunction(() => !document.querySelector('.da-dict-history'))
  assert.equal(await historyTrigger.evaluate(element => element === document.activeElement), true)
  await page.getByPlaceholder('检索指标名称 / 看板 / 关键词').fill('专属公式')
  await page.waitForFunction(() => document.querySelectorAll('.da-dict-item').length === 1)
  assert.match(await page.locator('.da-dict-item').innerText(), /M043/)
  await assertPageWidth(page, `dictionary-${width}-search`)
  await page.screenshot({ path: join(output, `dictionary-${width}.png`), fullPage: true })
}

// checkPortal 验证真实通知局部错误与反馈主体同屏及详情浮层焦点。
// 参数：page 为隔离页。
// 返回值：Promise完成；通知阻断主列表或详情焦点逃逸时失败。
async function checkPortal(page) {
  await mountScenario(page, 'portal', 390)
  await page.locator('.feedback-notifications [role="alert"]').waitFor()
  await page.getByRole('heading', { name: '我的反馈', exact: true }).waitFor()
  const detailTrigger = page.getByRole('button').filter({ hasText: 'FB-HARNESS-1' })
  assert.equal(await detailTrigger.count(), 1)
  assert.match(await page.locator('.feedback-notifications').innerText(), /未读数未知/)
  await assertPageWidth(page, 'portal-notification-error')
  await detailTrigger.click()
  await page.getByRole('dialog', { name: 'FB-HARNESS-1 · 合成反馈主体', exact: true }).waitFor()
  await assertFocusLoop(page, '.portal-dialog')
  await page.keyboard.press('Escape')
  await page.waitForFunction(() => !document.querySelector('.portal-dialog'))
  assert.equal(await detailTrigger.evaluate(element => element === document.activeElement), true)
  await page.evaluate(() => { window.__notificationsRecovered = true })
  await page.getByRole('button', { name: '重试通知', exact: true }).click()
  await page.waitForFunction(() => !document.querySelector('.feedback-notifications'))
  await page.getByRole('heading', { name: '我的反馈', exact: true }).waitFor()
  await page.screenshot({ path: join(output, 'portal-feedback-390.png'), fullPage: true })
}

const bundle = await bundleFixture()
if (process.argv.includes('--prepare')) {
  console.log(JSON.stringify({ prepared: true, componentAndStyleEntries: styles.size,
    scriptBytes: Buffer.byteLength(bundle.script), browserStarted: false }))
  process.exit(0)
}
const executablePath = process.env.CHROMIUM_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
await access(executablePath)
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ executablePath, headless: true,
  args: ['--disable-background-networking', '--disable-component-update'] })
const requests = [], errors = [], results = []
const selectedCase = process.argv.find(value => value.startsWith('--case='))?.slice('--case='.length)
  || 'shared-shell-keyboard-theme-collapse'
let page
try {
  const context = await browser.newContext()
  page = await context.newPage()
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/*', async route => {
    if (route.request().url() === origin) {
      await route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><head></head><body><div id="app"></div></body></html>' })
    } else {
      requests.push(route.request().url())
      await route.abort()
    }
  })
  await page.goto(origin)
  await page.addStyleTag({ content: bundle.css })
  await page.addScriptTag({ content: bundle.script })
  for (const [name, check] of [
    ['shared-shell-keyboard-theme-collapse', () => checkSharedShell(page)],
    ['dictionary-390', () => checkDictionary(page, 390)],
    ['dictionary-1440', () => checkDictionary(page, 1440)],
    ['portal-notification-details', () => checkPortal(page)],
    ['topbar-theme-contrast', () => checkTopbarThemes(page)],
  ]) {
    if (selectedCase && selectedCase !== name) continue
    const measurements = await check()
    results.push({ name, passed: true, ...(measurements ? { measurements } : {}) })
  }
  assert.equal(results.length, 1, '每次只运行一个已知的隔离浏览器场景')
  const unexpectedAPI = await page.evaluate(() => window.__unexpectedApiCalls)
  assert.deepEqual(unexpectedAPI, [], '夹具存在未声明的API调用或Vue运行错误')
  assert.deepEqual(requests, [], '夹具试图访问外部网络')
  assert.deepEqual(errors, [], '浏览器存在未捕获错误')
  await writeFile(join(output, selectedCase + '-results.json'), JSON.stringify({ results, errors, requests, unexpectedAPI }, null, 2))
  console.log(JSON.stringify({ passed: results.length, output }))
} catch (error) {
  const unexpectedAPI = await page?.evaluate(() => window.__unexpectedApiCalls).catch(() => [])
  await page?.screenshot({ path: join(output, 'failure.png'), fullPage: true }).catch(() => {})
  await writeFile(join(output, selectedCase + '-failure.json'), JSON.stringify({ results, errors, requests, unexpectedAPI, message: error.message }, null, 2))
  throw error
} finally {
  await browser.close()
}
