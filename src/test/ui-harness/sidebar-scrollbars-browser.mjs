// 导航侧栏专项：真实共享组件、原生侧栏模板与模块 CSS，合成菜单，不访问业务接口。
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { compileScript, parse } from '@vue/compiler-sfc'
import * as Vue from 'vue'
import { chromium, firefox, webkit } from 'playwright-core'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const output = process.env.SIDEBAR_OUTPUT_DIR || '/tmp/frontend-sidebar-scrollbars'
const engine = process.env.SIDEBAR_BROWSER || 'chromium'
assert.ok(['chromium', 'firefox', 'webkit'].includes(engine))
const cases = [
  ['platform', 'platform/styles/console.css', 'console-page--platform', '', 'console-nav',
    'platform/views/PlatformConsoleView.vue'],
  ['crm', 'customer_opportunity/styles/customer-opportunity.css', 'crm-shell', 'crm-sidebar', 'console-nav',
    'customer_opportunity/views/CustomerOpportunityView.vue'],
  ['portal', 'customer_portal/styles/customer-portal.css', 'portal-shell', 'portal-sidebar', 'console-nav',
    'customer_portal/views/CustomerPortalView.vue'],
  ['settlement', 'settlement/styles/settlement.css', 'settlement-shell', 'settlement-sidebar', 'console-nav',
    'settlement/views/SettlementView.vue'],
  ['reimbursement', 'reimbursement/reimbursement.css', '', '', 'console-nav',
    'reimbursement/views/ReimbursementView.vue'],
  ['contract', 'contract_management/styles/contract-management.css', 'contract-app', '', 'contract-nav',
    'contract_management/views/ContractManagementView.vue'],
  ['project', 'project_management/styles/project-management.css', 'pm-shell', '', 'pm-nav',
    'project_management/views/ProjectManagementView.vue'],
  ['analysis', 'data_analysis/styles/data-analysis.css', 'console-page da-shell', '', 'da-nav',
    'data_analysis/views/DashboardShellView.vue'],
  ['iam', 'platform/iam/styles/iam-settings.css', 'iam-workspace', '', 'iam-panel-nav'],
  ['applications', 'platform/styles/console.css', 'application-registry-workspace', '',
    'application-registry-sidebar'],
  ['dictionaries', 'platform/dictionaries/styles/dictionary-management.css',
    'dictionary-workspace', '', 'dictionary-catalog__list'],
  ['project-queue', 'project_management/styles/project-management.css',
    'pm-operation-workspace', '', 'pm-picker-list'],
].filter(item => !process.env.SIDEBAR_CASE || item[0] === process.env.SIDEBAR_CASE)
assert.ok(cases.length, '没有匹配的导航侧栏场景')

// 用途：编译真实 AppShell 与图标，复用浏览器内同一份 Vue。
// 参数：无；依赖入口来自当前工作树。
// 返回值：隔离页面可加载的组件脚本。
async function componentBundle() {
  const result = await build({
    stdin: { contents: `import AppShell from './src/modules/shared/components/AppShell.vue';
      import ConsoleIcon from './src/modules/shared/components/ConsoleIcon.vue';
      import ServiceItemPicker from './src/modules/project_management/components/ServiceItemPicker.vue';
      window.sidebarComponents={AppShell,ConsoleIcon,ServiceItemPicker};`, resolveDir: root },
    bundle: true, write: false, format: 'iife', platform: 'browser',
    alias: { '@': root + 'src' },
    plugins: [{ name: 'sidebar-fixture',
      // 用途：把真实 SFC 与全局 Vue 接入隔离夹具。
      // 参数：builder 为本次打包接口。
      // 返回值：无；注册仅内存编译规则。
      setup(builder) {
        builder.onResolve({ filter: /^vue$/ }, () => ({ path: 'vue', namespace: 'fixture-vue' }))
        builder.onLoad({ filter: /.*/, namespace: 'fixture-vue' }, () => ({
          contents: Object.keys(Vue).filter(name => /^[A-Za-z_$][\w$]*$/.test(name) && name !== 'default')
            .map(name => `export const ${name}=window.Vue.${name};`).join('\n'),
        }))
        builder.onLoad({ filter: /\.vue$/ }, async ({ path }) => {
          const { descriptor } = parse(await readFile(path, 'utf8'))
          return { contents: compileScript(descriptor, { id: path, inlineTemplate: true }).content,
            loader: 'js', resolveDir: fileURLToPath(new URL('.', 'file://' + path)) }
        })
      },
    }],
  })
  return result.outputFiles[0].text
}

// 用途：读取当前模块的真实侧栏模板，内层导航使用相同结构的合成菜单。
// 参数：item 为模块标识、样式和原生视图入口。
// 返回值：隔离渲染模板及实际共享壳层的静态属性。
async function sidebarTemplate(item) {
  if (item[5]) {
    const { descriptor } = parse(await readFile(root + 'src/modules/' + item[5], 'utf8'))
    const shell = descriptor.template.ast.children.find(node => node.tag === 'AppShell')
    if (shell) return {
      template: `<AppShell v-bind="shellProps" v-model:menu-open="mobileMenuOpen"
        :nav-groups="shellGroups" user-name="sidebar.reader" user-role="管理员" @navigate="navigate" />`,
      shellProps: Object.fromEntries(shell.props.filter(prop => prop.type === 6 && prop.value)
        .map(prop => [prop.name, prop.value.content])),
    }
    const node = descriptor.template.ast.children.flatMap(node => node.children || [])
      .find(node => node.tag === 'aside')
    assert.ok(node, item[0] + ' 缺少实际侧栏')
    return { template: `<div class="${item[2]}">${node.loc.source}</div>`, shellProps: {} }
  }
  if (item[0] === 'dictionaries') return {
    template: `<section class="dictionary-module"><div class="dictionary-workspace">
      <aside class="so-card dictionary-catalog" aria-label="字典目录" style="max-height:620px">
        <header class="dictionary-section-head"><h3>字典目录</h3></header>
        <div class="dictionary-catalog__list">
          <button v-for="item in items" :key="item.key" type="button" class="dictionary-card"
            :class="{active:activeSection===item.key}" @click="navigate(item.key)">
            <span class="dictionary-card__top"><code>{{ item.key }}</code></span>
            <strong>{{ item.label }}</strong><small>隔离字典目录说明</small>
          </button>
        </div>
      </aside><main>隔离内容</main></div></section>`,
    shellProps: {},
  }
  if (item[0] === 'project-queue') return {
    template: `<div class="pm-shell"><div class="pm-operation-workspace">
      <aside class="pm-operation-queue" aria-label="服务项队列">
        <div class="pm-operation-queue-head"><b>服务项队列</b><span>{{ items.length }} 项</span></div>
        <ServiceItemPicker :items="items" :selected-ids="[activeSection]" @select="navigate" />
      </aside><main>隔离内容</main></div></div>`,
    shellProps: {},
  }
  const applicationClass = item[0] === 'applications' ? 'application-registry-list-item' : ''
  return {
    template: `<div class="${item[2]}"><aside class="${item[4]}" style="max-height:260px;overflow:auto">
      <button v-for="item in items" :key="item.key" type="button"
        class="${applicationClass}" :class="{active:activeSection===item.key}" @click="navigate(item.key)">
        <span>{{ item.label }}</span></button></aside><main>隔离内容</main></div>`,
    shellProps: {},
  }
}

// 用途：检查侧栏及其后代没有可见滚动条，记录真实可滚动范围。
// 参数：page 为实际浏览器页面，selector 为当前导航区域。
// 返回值：滚动范围及所有可见滚动条诊断。
async function scrollbarMetrics(page, selector) {
  return page.locator(selector).evaluate(element => {
    const aside = element.closest('aside')
    const errors = []
    for (const node of [aside, ...aside.querySelectorAll('*')]) {
      if (!node.clientWidth || !node.clientHeight) continue
      const style = getComputedStyle(node)
      const scrollsX = /auto|scroll/.test(style.overflowX) && node.scrollWidth > node.clientWidth
      const scrollsY = /auto|scroll/.test(style.overflowY) && node.scrollHeight > node.clientHeight
      if (!scrollsX && !scrollsY) continue
      if (style.scrollbarWidth !== 'none'
          && getComputedStyle(node, '::-webkit-scrollbar').display !== 'none') {
        errors.push(node.className || node.tagName)
      }
    }
    if (document.documentElement.scrollWidth > innerWidth + 1) errors.push('document horizontal overflow')
    return { errors, scrollTop: element.scrollTop, scrollLeft: element.scrollLeft,
      clientHeight: element.clientHeight, scrollHeight: element.scrollHeight,
      clientWidth: element.clientWidth, scrollWidth: element.scrollWidth,
      overflowY: getComputedStyle(element).overflowY }
  })
}

await mkdir(output, { recursive: true })
const baseFiles = ['platform/shared/styles/main.css', 'shared/styles/global-ux.css',
  'shared/styles/ui-refresh.css', 'shared/styles/component-experience.css', 'platform/styles/console.css']
const baseCSS = (await Promise.all(baseFiles.map(file => readFile(root + 'src/modules/' + file, 'utf8')))).join('\n')
const vue = await readFile(root + 'node_modules/vue/dist/vue.global.prod.js', 'utf8')
const components = await componentBundle()
const browser = await ({ chromium, firefox, webkit }[engine]).launch({ headless: true,
  ...(engine === 'chromium' ? { executablePath: process.env.CHROMIUM_PATH
    || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' } : {}) })
const results = []
let activeCase = null
try {
  for (const item of cases) {
    let css = await readFile(root + 'src/modules/' + item[1], 'utf8')
    if (item[0] === 'platform') css += await readFile(root + 'src/modules/platform/styles/platform-console.css', 'utf8')
    if (item[0] === 'applications') {
      const { descriptor } = parse(await readFile(root + 'src/modules/platform/applications/components/SubsystemOnboardingModule.vue', 'utf8'))
      css += descriptor.styles.map(style => style.content).join('\n')
    }
    const { template, shellProps } = await sidebarTemplate(item)
    for (const width of [1280, 760]) {
      activeCase = { module: item[0], width, browser: engine }
      const page = await browser.newPage({ viewport: { width, height: 560 }, reducedMotion: 'reduce' })
      page.setDefaultTimeout(4000)
      const errors = []
      page.on('pageerror', error => errors.push(error.message))
      await page.route('**/*', route => route.abort())
      await page.setContent(`<style>${baseCSS}\n${css.replace(/@import[^;]+;/g, '')}</style><div id="fixture"></div>`)
      await page.addScriptTag({ content: vue })
      await page.addScriptTag({ content: components })
      await page.evaluate(({ template, item, shellProps }) => {
        const { ref, computed, createApp } = Vue
        const activeSection = ref('item-0')
        const mobileMenuOpen = ref(true)
        const collapsed = ref(new Set())
        const items = Array.from({ length: 36 }, (_, index) => ({
          key: 'item-' + index, label: index ? '功能入口 ' + index : '身份、组织与授权功能导航',
          id: 'item-' + index, site: '隔离服务项场所 ' + index, status: '待处理',
          icon: 'nav-settings', groupLabel: '业务分区 ' + Math.floor(index / 9),
        }))
        const groups = [{ label: '业务导航', items }]
        // 用途：合成导航只更新选中状态，不触发任何业务请求。
        // 参数：key 为目标菜单标识或菜单对象。
        // 返回值：无。
        function navigate(key) { activeSection.value = key?.key || key || 'item-0' }
        // 用途：控制原生项目侧栏的分组展开状态。
        // 参数：group 为待切换分组。
        // 返回值：无。
        function toggleNavGroup(group) {
          const next = new Set(collapsed.value)
          if (next.has(group.label)) next.delete(group.label)
          else next.add(group.label)
          collapsed.value = next
        }
        // 用途：查询原生项目菜单的分组折叠状态。
        // 参数：group 为待查询分组。
        // 返回值：该分组当前是否折叠。
        function isNavGroupCollapsed(group) { return collapsed.value.has(group.label) }
        // 用途：查询合成入口是否为当前导航目标。
        // 参数：entry 为待查询入口。
        // 返回值：该入口当前是否选中。
        function isNavItemActive(entry) { return activeSection.value === entry.key }
        // 用途：让隔离夹具展示全部合成入口，不参与业务权限判断。
        // 参数：无。
        // 返回值：固定允许渲染合成入口。
        function allowFixtureAction() { return true }
        const shellGroups = computed(() => [{ label: '系统管理', items: [{
          key: 'settings', label: '系统设置', icon: 'nav-settings', expanded: true,
          children: items.map(entry => ({ ...entry, active: activeSection.value === entry.key })),
        }] }])
        window.sidebarFixture = { mobileMenuOpen, activeSection }
        createApp({ template, components: window.sidebarComponents,
          // 用途：为实际侧栏模板提供隔离的响应式菜单状态。
          // 参数：无。
          // 返回值：真实模板依赖的合成状态及导航回调。
          setup() { return { items, navGroups: groups, visibleNavGroups: groups, shellGroups,
            shellProps, activeSection, section: activeSection,
            mobileMenuOpen, sidebarHidden: false, sidebarElement: ref(null),
            currentUserInitial: 'S', currentLoginUsername: 'sidebar.reader',
            currentUserName: 'sidebar.reader', currentRoleLabel: '管理员',
            currentUserRoleLabel: '管理员', currentUserRole: '管理员', isLoggingOut: false,
            navigate, navigateNavItem: navigate, navigatePlatform: navigate,
            returnToUnifiedPortal: navigate, logoutSystem: navigate, toggleNavGroup,
            isNavGroupCollapsed, isNavItemActive,
            can: allowFixtureAction, hasPermission: allowFixtureAction,
          } },
        }).mount('#fixture')
      }, { template, item, shellProps })
      const selector = '.' + item[4]
      const states = []
      for (const theme of ['light', 'dark']) {
        await page.evaluate(theme => { document.documentElement.dataset.theme = theme }, theme)
        const toggles = page.locator('aside button[aria-expanded]')
        if (await toggles.count()) { await toggles.first().click(); await toggles.first().click() }
        const buttons = page.locator(selector + ' button:not([aria-expanded]):visible')
        await buttons.first().hover()
        await buttons.first().click()
        await page.evaluate(() => { window.sidebarFixture.mobileMenuOpen.value = true })
        await page.keyboard.press('Tab')
        await buttons.last().focus()
        states.push({ theme, phase: 'clicked-and-keyboard-focused', ...await scrollbarMetrics(page, selector) })
      }
      const nav = page.locator(selector)
      await nav.evaluate(element => { element.scrollTop = 0; element.scrollLeft = 0 })
      const box = await nav.boundingBox()
      const visibleTop = Math.max(0, box.y)
      const visibleBottom = Math.min(560, box.y + box.height)
      assert.ok(visibleBottom > visibleTop, item[0] + ' 导航滚动区域不在视口内')
      await page.mouse.move(box.x + box.width / 2,
        visibleTop + Math.min((visibleBottom - visibleTop) / 2, 120))
      if (item[0] === 'iam' && width === 760) {
        await page.mouse.wheel(360, 0)
        await page.waitForFunction(selector => document.querySelector(selector).scrollLeft > 0,
          selector, { timeout: 2000 })
      } else {
        await page.mouse.wheel(0, 360)
        await page.waitForFunction(selector => document.querySelector(selector).scrollTop > 0,
          selector, { timeout: 2000 })
      }
      states.push({ phase: 'wheel', ...await scrollbarMetrics(page, selector) })
      assert.deepEqual(errors, [], item[0] + ' 夹具运行异常')
      results.push({ browser: engine, module: item[0], width, states })
      if (item[0] === 'platform' && width === 1280) {
        await page.locator('aside').screenshot({ path: `${output}/${engine}-platform.png` })
      }
      await page.close()
    }
  }
} catch (error) {
  console.error(JSON.stringify({ failedCase: activeCase }))
  throw error
} finally { await browser.close() }
await writeFile(`${output}/${engine}-results.json`, JSON.stringify(results, null, 2) + '\n')
const failures = results.flatMap(result => result.states.filter(state => state.errors.length)
  .map(state => `${result.module}/${result.width}/${state.phase}: ${state.errors.join(', ')}`))
assert.deepEqual(failures, [], '导航侧栏出现可见滚动条')
console.log(JSON.stringify({ browser: engine, cases: results.length, states: results.length * 3, result: 'PASS' }))
