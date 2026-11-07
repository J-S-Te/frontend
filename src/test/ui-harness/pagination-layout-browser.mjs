// 隔离分页条布局回归：真实 PaginationBar 组件 + 真实模块 CSS + 合成数据，全部在浏览器内渲染。
//
// 背景：共享分页条在合同 / 客户 / 商机 / 审计 / 售前申请等列表页出现「跳至 / 每页 / 跳转」
// 与页大小下拉错位、按钮换行。根因不是分页条自己的规则，而是各模块的通用按钮 / 输入框规则
// （.crm-content button、.settlement-panel button、.contract-table-footer button……）按懒加载
// 顺序改写了分页条内部控件的宽高。这个脚本用真实模块容器把分页条渲染进去，锁定：
//   1) 桌面单行、右对齐、控件同高、跳页输入固定 60px、页大小下拉宽度受控；
//   2) 窄屏可换行但不重叠、不孤字，跳至组与每页组内部不拆行；
//   3) 主次与禁用态一致（当前页唯一主按钮；禁用半透明且禁用光标）；
//   4) 模块通用规则没有把按钮尺寸 / 底色改回模块自己的样子。
//
// 只读：不访问业务 API、不写业务数据。用法：
//   CHROMIUM_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
//     node src/test/ui-harness/pagination-layout-browser.mjs
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { parse, compileScript, compileStyle } from '@vue/compiler-sfc'
import { chromium } from 'playwright-core'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const run = process.env.PAGINATION_RUN_LABEL || 'latest'
assert.match(run, /^[A-Za-z0-9_-]{1,48}$/, 'layout result label must remain inside the evidence directory')
const output = process.env.PAGINATION_OUTPUT_DIR
  ? (process.env.PAGINATION_OUTPUT_DIR.endsWith('/') ? process.env.PAGINATION_OUTPUT_DIR : process.env.PAGINATION_OUTPUT_DIR + '/')
  : fileURLToPath(new URL(`../../../../.ai/qa/pagination-bar-layout-20261107/${run}/`, import.meta.url))

// 1440 / 1024 检查桌面单行；561–900 是项目页脚与登录目标页夹在卡片里的真实宽度段；
// 390 检查小屏换行与控件不重叠。
const widths = [1440, 1024, 900, 820, 768, 700, 640, 600, 561, 390]

// 每个容器都取真实模块外壳类：通用 button / input / select 规则只有在这里才会命中分页条。
const CONTEXTS = [
  {
    name: 'crm',
    title: '客户 / 商机 / 售前申请列表（.crm-panel）',
    css: 'customer_opportunity/styles/customer-opportunity.css',
    moduleClass: 'crm-pagination',
    shell: '<main class="crm-content"><section class="crm-panel table-panel" id="mount"></section></main>',
    // 一段比视口宽的表格，模拟真实宽表格的横向滚动，用来验证分页条 sticky 不被带走。
    // 不能用 div：global-ux.css 的 .crm-panel > :not(table) 会把块级子元素压到 100%。
    prepend: '<table style="width:2000px"><tbody><tr><td style="height:40px">宽表格占位</td></tr></tbody></table>',
  },
  {
    name: 'contract',
    title: '合同台账（.contract-table-footer）',
    css: 'contract_management/styles/contract-management.css',
    moduleClass: '',
    shell: '<main class="contract-app"><div class="contract-content"><div class="contract-table-card"><footer class="contract-table-footer contract-table-footer--pager" id="mount"></footer></div></div></main>',
  },
  {
    name: 'settlement',
    title: '结算列表页脚（.settlement-panel）',
    css: 'settlement/styles/settlement.css',
    moduleClass: '',
    shell: '<main class="settlement-content"><section class="settlement-panel settlement-list-pager" id="mount"></section></main>',
  },
  {
    name: 'console',
    title: '平台审计日志（.console-table-footer）',
    css: 'platform/styles/console.css',
    moduleClass: '',
    shell: '<main class="console-content"><footer class="console-table-footer audit-table-footer" id="mount"></footer></main>',
    prepend: '<span>审计事件为只读记录</span>',
  },
  {
    name: 'project',
    title: '项目列表页脚（.pm-table-panel > .pm-table-footer）',
    css: 'project_management/styles/project-management.css',
    moduleClass: '',
    // 真实结构：页脚在 overflow: hidden 的 .pm-table-panel 卡片内，分页条不得被右缘裁掉。
    shell: '<main class="pm-page"><section class="pm-table-panel"><footer class="pm-table-footer" id="mount"></footer></section></main>',
    prepend: '<span>已选择 0 项</span>',
  },
  {
    name: 'login-target',
    title: '应用登录目标页脚（≤720px 不得改为 column）',
    css: 'platform/login-targets/styles/application-login-target.css',
    moduleClass: '',
    shell: '<main class="login-target-module"><footer class="login-target-module__pagination" id="mount"></footer></main>',
  },
  {
    name: 'portal',
    title: '客户门户项目动态（.portal-card）',
    css: 'customer_portal/styles/customer-portal.css',
    moduleClass: 'portal-pagination',
    shell: '<main class="portal-content"><section class="portal-card" id="mount"></section></main>',
  },
]

// pageSizeOptions 必须显式传：共享分页条的「每页」下拉默认不渲染（opt-in）。
const PROPS = { page: 5, total: 200, pageSize: 20, pageSizeOptions: [20, 50, 100], label: '布局回归分页' }

// 用途：编译真实分页条组件，保留 scoped 样式，不启动应用或业务服务。
// 参数：无。
// 返回值：浏览器脚本 + scoped CSS；编译错误直接失败。
async function componentBundle() {
  const styles = new Map()
  const result = await build({
    stdin: {
      contents: `import {createApp} from 'vue';
        import Pager from './src/modules/shared/components/PaginationBar.vue';
        window.mountPager=(selector,props)=>{ if(window.__pagerApp){window.__pagerApp.unmount();window.__pagerApp=null;}
          const app=createApp(Pager,props); window.__pagerApp=app;
          app.mount(document.querySelector(selector)); return true };`,
      resolveDir: root,
    },
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    define: { 'import.meta.env': '{}' },
    alias: { '@': root + 'src' },
    plugins: [{
      name: 'pagination-layout-vue',
      // 用途：只为布局夹具接入当前 Vue 单文件组件编译器。
      // 参数：builder 为本次隔离打包的 esbuild 插件接口。
      // 返回值：无；注册单文件组件转换规则。
      setup(builder) {
        builder.onLoad({ filter: /\.vue$/ }, async ({ path }) => {
          const { descriptor } = parse(await readFile(path, 'utf8'), { filename: path })
          const id = 'data-v-' + createHash('sha256').update(path).digest('hex').slice(0, 8)
          const script = compileScript(descriptor, {
            id,
            inlineTemplate: true,
            genDefaultAs: '__fixtureComponent',
            templateOptions: { compilerOptions: { scopeId: id } },
          })
          styles.set(path, descriptor.styles.map((style) => compileStyle({
            source: style.content, filename: path, id, scoped: style.scoped,
          }).code).join('\n'))
          return {
            contents: script.content + `\n__fixtureComponent.__scopeId=${JSON.stringify(id)};export default __fixtureComponent;`,
            loader: 'js',
            resolveDir: fileURLToPath(new URL('.', 'file://' + path)),
          }
        })
      },
    }],
  })
  return { script: result.outputFiles[0].text, styles: [...styles.values()].join('\n') }
}

// 用途：读取真实模块样式，拼出隔离页面。
// 参数：context 为本次容器定义；baseCss 为共享基础样式；scopedCss 为组件 scoped 样式。
// 返回值：完整 HTML。
function fixtureHtml(context, baseCss, scopedCss) {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
    <style>${baseCss}</style><style>${scopedCss}</style><style>${context.cssText}</style>
    </head><body>${context.shell}</body></html>`
}

// 用途：在真实渲染结果上量布局，返回可读的违规项。
// 参数：检查项全部来自浏览器几何与计算样式，不比对源码字符串。
// 返回值：违规描述数组；空数组表示通过。
function audit() {
  const failures = []
  const box = (element) => element.getBoundingClientRect()
  const round = (value) => Math.round(value)
  const centerY = (rect) => (rect.top + rect.bottom) / 2
  const viewport = document.documentElement.clientWidth
  const nav = document.querySelector('.ui-pager')
  if (!nav) return ['pager not rendered']
  if (document.documentElement.scrollWidth > viewport + 1) failures.push('document horizontal overflow')
  const navRect = box(nav)
  if (navRect.left < -1 || navRect.right > viewport + 1) failures.push('pager outside viewport')
  const container = nav.parentElement
  const containerStyle = getComputedStyle(container)
  const contentRight = box(container).right - (parseFloat(containerStyle.paddingRight) || 0)
  if (navRect.right > contentRight + 2) failures.push('pager wider than its container')

  const controls = [...nav.querySelectorAll('.ui-pager__button, .ui-pager__page, .ui-pager__jump, .ui-pager__size')]
  if (controls.length < 5) failures.push(`too few controls: ${controls.length}`)
  const heights = new Set(controls.map((element) => round(box(element).height)))
  if (heights.size > 1) failures.push('control heights differ: ' + [...heights].join(' / '))
  for (const element of controls) {
    const rect = box(element)
    if (rect.left < -1 || rect.right > viewport + 1) failures.push('control outside viewport: ' + element.className)
    if (element.scrollWidth > element.clientWidth + 1) failures.push('control content clipped: ' + element.className)
    if (element.scrollHeight > element.clientHeight + 1) failures.push('control content wrapped: ' + element.className)
  }

  // 跳页输入与页大小下拉的固定宽度：模块的 width:100% 必须失效。
  const jump = nav.querySelector('.ui-pager__jump')
  const size = nav.querySelector('.ui-pager__size')
  if (!jump || !size) failures.push('跳页输入或页大小下拉缺失')
  if (jump && Math.abs(box(jump).width - 60) > 1) failures.push('jump input width ' + box(jump).width.toFixed(1))
  if (size && (box(size).width < 66 || box(size).width > 90)) failures.push('page-size select width ' + box(size).width.toFixed(1))
  if (jump && getComputedStyle(jump).borderTopWidth !== '1px') failures.push('jump input lost its border')

  // 按钮与输入框必须同一底色：结算 / 合同等模块的实心按钮规则不能漏进分页条。
  const prev = nav.querySelector('.ui-pager__button')
  if (prev && jump && getComputedStyle(prev).backgroundColor !== getComputedStyle(jump).backgroundColor) {
    failures.push('button surface differs from input (module override leaked)')
  }

  // 标签不允许折行 / 拆字。
  for (const element of nav.querySelectorAll('.ui-pager__status, .ui-pager__label, .ui-pager__unit')) {
    const lineHeight = parseFloat(getComputedStyle(element).lineHeight) || 16
    if (element.getClientRects().length !== 1) failures.push('label split into boxes: ' + element.className)
    if (element.clientHeight > lineHeight * 1.8) failures.push('label wrapped: ' + element.className)
    if (element.textContent.trim().length && element.scrollWidth > element.clientWidth + 1) {
      failures.push('label overflow: ' + element.className)
    }
  }

  // 跳至组：标签 / 输入 / 单位 / 跳转按钮必须同处一行且不重叠。
  const group = nav.querySelector('.ui-pager__group')
  if (group) {
    const field = group.querySelector('.ui-pager__field')
    const button = group.querySelector('button')
    if (!field || !button) failures.push('jump group missing field or button')
    else {
      if (Math.abs(centerY(box(field)) - centerY(box(button))) > 2) failures.push('跳转按钮与输入框不在同一行')
      if (box(field).right > box(button).left + 1) failures.push('跳转按钮与输入框重叠')
    }
  }

  // 祖先裁切：页脚经常放在 overflow: hidden 的卡片里（项目 .pm-table-panel）。
  // 只看「分页条是否超出父页脚」不够，父页脚本身被卡片裁掉时右侧控件同样不可见。
  for (let node = nav.parentElement; node && node !== document.body; node = node.parentElement) {
    const style = getComputedStyle(node)
    const rect = box(node)
    if (!rect.width && !rect.height) continue
    const padLeft = parseFloat(style.paddingLeft) || 0
    const padRight = parseFloat(style.paddingRight) || 0
    const padTop = parseFloat(style.paddingTop) || 0
    const padBottom = parseFloat(style.paddingBottom) || 0
    if (style.overflowX === 'hidden' || style.overflowX === 'clip') {
      if (navRect.left < rect.left + padLeft - 1 || navRect.right > rect.right - padRight + 1) {
        failures.push('pager clipped horizontally by ancestor: ' + (node.className || node.tagName))
      }
    }
    if (style.overflowY === 'hidden' || style.overflowY === 'clip') {
      if (navRect.top < rect.top + padTop - 1 || navRect.bottom > rect.bottom - padBottom + 1) {
        failures.push('pager clipped vertically by ancestor: ' + (node.className || node.tagName))
      }
    }
  }

  // 顶层三块（页码组 / 总数 / 跳页与页大小）不能相互覆盖。
  const blocks = [...nav.children].map((element) => ({ element, rect: box(element) }))
  for (let index = 1; index < blocks.length; index += 1) {
    const previous = blocks[index - 1].rect
    const current = blocks[index].rect
    const overlaps = previous.right > current.left + 1 && previous.bottom > current.top + 1 && current.bottom > previous.top + 1
    if (overlaps) failures.push(`overlap: ${blocks[index - 1].element.className} / ${blocks[index].element.className}`)
  }

  // 桌面：单行右对齐；页脚里的左侧说明文字不能被分页条盖住。
  if (viewport >= 1024) {
    const last = blocks[blocks.length - 1].rect
    if (Math.abs(last.right - contentRight) > 2) failures.push('pager not flush right: ' + (last.right - contentRight).toFixed(1))
    // 用行盒中心而不是 top：总数文案在行内垂直居中，top 与按钮不相等不代表换行。
    const rowCenters = blocks.map((entry) => round(centerY(entry.rect)))
    if (Math.max(...rowCenters) - Math.min(...rowCenters) > 2) failures.push('desktop wraps into more than one row')
  }
  for (const sibling of container.children) {
    if (sibling === nav) continue
    const siblingRect = box(sibling)
    const navArea = box(nav)
    if (siblingRect.width && siblingRect.right > navArea.left + 1
      && siblingRect.bottom > navArea.top + 1 && navArea.bottom > siblingRect.top + 1) {
      failures.push('footer note overlaps pager')
    }
  }
  return failures
}

// 用途：检查主次与禁用态是否与全平台一致。
// 返回值：违规描述数组。
function auditStates() {
  const failures = []
  const nav = document.querySelector('.ui-pager')
  const prev = nav.querySelector('.ui-pager__button')
  const active = nav.querySelector('.ui-pager__page.is-active')
  const jump = nav.querySelector('.ui-pager__jump')
  const jumpButton = nav.querySelector('.ui-pager__button--small')
  if (!prev || !active || !jump || !jumpButton) return ['state controls missing']
  if (!prev.disabled) failures.push('首页上一页未禁用')
  const prevStyle = getComputedStyle(prev)
  if (Math.abs(parseFloat(prevStyle.opacity) - 0.45) > 0.01) failures.push('禁用按钮透明度不是 0.45')
  if (prevStyle.cursor !== 'not-allowed') failures.push('禁用按钮光标不是 not-allowed')
  const activeStyle = getComputedStyle(active)
  if (Math.abs(parseFloat(activeStyle.opacity) - 1) > 0.01) failures.push('当前页按钮不应半透明')
  if (activeStyle.backgroundColor === prevStyle.backgroundColor) failures.push('当前页按钮没有主色实心')
  if (!jumpButton.disabled) failures.push('跳页草稿为空时跳转按钮应禁用')
  if (jump.getBoundingClientRect().height !== active.getBoundingClientRect().height) failures.push('输入框与按钮不同高')
  return failures
}

await mkdir(output, { recursive: true })
const baseCss = await readFile(root + 'src/modules/platform/shared/styles/main.css', 'utf8')
const stateCss = await readFile(root + 'src/modules/platform/shared/styles/state.css', 'utf8')
const globalUx = await readFile(root + 'src/modules/shared/styles/global-ux.css', 'utf8')
const { script, styles } = await componentBundle()

const results = []
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
})
try {
  for (const definition of CONTEXTS) {
    const context = {
      ...definition,
      cssText: await readFile(root + 'src/modules/' + definition.css, 'utf8'),
    }
    const page = await browser.newPage()
    const pageErrors = []
    page.on('pageerror', (error) => pageErrors.push(String(error)))
    try {
      await page.setContent(fixtureHtml(context, baseCss + '\n' + stateCss + '\n' + globalUx, styles))
      await page.addScriptTag({ content: script })
      await page.evaluate((props) => window.mountPager('#mount', props), { ...PROPS, class: context.moduleClass })
      if (context.prepend) {
        await page.evaluate((markup) => document.querySelector('#mount').insertAdjacentHTML('afterbegin', markup), context.prepend)
      }
      for (const width of widths) {
        await page.setViewportSize({ width, height: 900 })
        const failures = await page.evaluate(audit)
        results.push({ context: context.name, width, failures })
        await page.screenshot({ path: `${output}${context.name}-${width}.png`, fullPage: false })
      }
      // 状态检查：固定 390 宽，换成「首页且只有一页」的受控数据。
      await page.setViewportSize({ width: 1024, height: 900 })
      await page.evaluate((props) => window.mountPager('#mount', props), { ...PROPS, page: 1, total: 5, class: context.moduleClass })
      if (context.prepend) {
        await page.evaluate((markup) => document.querySelector('#mount').insertAdjacentHTML('afterbegin', markup), context.prepend)
      }
      const stateFailures = await page.evaluate(auditStates)
      results.push({ context: context.name, width: 'states', failures: stateFailures })
      if (context.name === 'crm') {
        // P2④：分页条必须在 .table-panel 的横向滚动里吸左，而不是被表格带走。
        const stickyFailures = await page.evaluate(() => {
          const nav = document.querySelector('.ui-pager')
          const panel = nav?.closest('.table-panel')
          if (!nav || !panel) return ['sticky: missing .ui-pager or .table-panel']
          const failures = []
          if (panel.scrollWidth <= panel.clientWidth + 1) failures.push('sticky: panel does not overflow')
          const before = nav.getBoundingClientRect()
          panel.scrollLeft = 600
          const after = nav.getBoundingClientRect()
          const panelRect = panel.getBoundingClientRect()
          panel.scrollLeft = 0
          if (getComputedStyle(nav).position !== 'sticky') failures.push('sticky: pager is not position: sticky')
          if (Math.abs(after.left - before.left) > 2) failures.push('sticky: pager moved with horizontal scroll')
          if (after.left < panelRect.left - 1 || after.right > panelRect.right + 1) failures.push('sticky: pager left the scroll viewport')
          return failures
        })
        results.push({ context: context.name, width: 'sticky', failures: stickyFailures })
      }
      if (pageErrors.length) results.push({ context: context.name, width: 'errors', failures: pageErrors })
    } finally {
      await page.close()
    }
  }
} finally {
  await browser.close()
}

const failures = results.filter((entry) => entry.failures.length)
await writeFile(`${output}results.json`, JSON.stringify({ generatedAt: new Date().toISOString(), contexts: CONTEXTS.map((item) => item.name), widths, results }, null, 2))
for (const entry of results) {
  if (entry.failures.length) {
    console.error(`FAIL ${entry.context} @ ${entry.width}`)
    for (const failure of entry.failures) console.error('  - ' + failure)
  }
}
assert.deepEqual(failures, [], `${failures.length} layout checks failed; see ${output}results.json`)
console.log(`pagination layout OK: ${CONTEXTS.length} contexts x ${widths.length} widths + states → ${output}`)
