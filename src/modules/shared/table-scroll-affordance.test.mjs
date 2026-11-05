import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  TABLE_SCROLL_CLASS,
  TABLE_SCROLL_SCROLLERS,
  TABLE_SCROLL_SELECTOR,
} from './composables/useTableScrollAffordance.js'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')

// 回归锁定（替换旧的 background-attachment: local, scroll 方案）：
// 旧方案把渐隐画在滚动容器自身的 background-image 上，表头 th 的不透明底色会整行盖住它，
// 所以渐隐看上去从表头下方才开始；而且背景层不知道滚动位置，滚到尽头仍然显示。
// 新方案是“宿主覆盖层 + 滚动状态”：
//   1) 覆盖层是滚动容器父元素上的 ::before/::after（position: absolute + z-index），
//      画在不透明、sticky 的表头之上；
//   2) 是否可见只由 is-table-scroll-left / -right 决定，滚到尽头即隐藏；
//   3) 容器自身的 background 版本只作为增强执行前的降级表现，并继续承载深色 token 约定。
test('边缘提示是宿主上的覆盖层：绝对定位、高于粘性表头、位置由滚动容器内容盒变量给出', () => {
  const css = read('./styles/global-ux.css')
  const overlay = /\.table-scroll-host::before,\s*\n?\.table-scroll-host::after\s*\{([^}]*)\}/.exec(css)
  assert.ok(overlay, '缺少 .table-scroll-host::before/::after 覆盖层规则')
  assert.match(overlay[1], /position:\s*absolute/, '覆盖层必须脱离文档流，不能改动表格布局')
  assert.match(overlay[1], /z-index:\s*var\(--table-scroll-edge-z,\s*21\)/,
    '覆盖层 z-index 必须高于 PM 粘性表头的 --pm-z-sticky(20)')
  assert.match(overlay[1], /top:\s*var\(--table-scroll-edge-top/)
  assert.match(overlay[1], /height:\s*var\(--table-scroll-edge-height/)
  assert.match(overlay[1], /pointer-events:\s*none/, '覆盖层不能挡住单元格里的点击')
  assert.match(overlay[1], /opacity:\s*0/, '默认不可见：不溢出时视觉完全不变')
  assert.match(overlay[1], /transition:\s*opacity/)
  // 左右两条渐隐带各自贴合容器内容盒的左右边缘。
  assert.match(css, /\.table-scroll-host::after\s*\{[^}]*right:\s*var\(--table-scroll-edge-right/)
  assert.match(css, /\.table-scroll-host::before\s*\{[^}]*left:\s*var\(--table-scroll-edge-left/)

  // 状态驱动：只有还能往那一侧滚时才显示。
  assert.match(css, /\.table-scroll-host\.is-table-scroll-right::after\s*\{\s*opacity:\s*1;\s*\}/)
  assert.match(css, /\.table-scroll-host\.is-table-scroll-left::before\s*\{\s*opacity:\s*1;\s*\}/)
  // 左缘也要能提示“还能往左滚”，不只是右侧。
  assert.match(css, /linear-gradient\(to right,\s*var\(--surface-card, #fff\)/)
})

test('覆盖层颜色走 token，浅色回退到 #fff / rgba(15,23,42,.14)，深色不会出现白条', () => {
  const css = read('./styles/global-ux.css')
  // 注意：文件里先出现的是 ::before/::after 共用的尺寸规则，这里要取带 right 的独立规则。
  const right = /\.table-scroll-host::after\s*\{\s*(right:[^}]*)\}/.exec(css)
  assert.ok(right, '缺少右缘覆盖层规则')
  assert.match(right[1], /var\(--surface-card, #fff\)/)
  assert.match(right[1], /var\(--table-scroll-edge, rgba\(15, 23, 42, \.14\)\)/)
  // 写死白色的渐变停靠点会让深色表格出现白条。
  assert.doesNotMatch(right[1], /linear-gradient\(to left, #fff\b/)
  const main = read('../platform/shared/styles/main.css')
  assert.ok(main.includes('--table-scroll-edge:'), 'main.css 深色主题必须定义 --table-scroll-edge')
  assert.ok(main.includes('--surface-card:'), 'main.css 必须定义 --surface-card')
})

// 旧方案保留为“增强执行前”的降级层（未执行 JS / 首帧）：它仍然是深色 token 的约定位置，
// 但增强完成后由 .table-scroll-enhanced 关掉，避免两层渐隐叠加。
test('容器背景降级层保留 token 约定，并在覆盖层接管后关闭', () => {
  const css = read('./styles/global-ux.css')
  const fallback = /:where\([^)]*\.table-panel[^)]*\)\s*\{([^}]*)\}/.exec(css)
  assert.ok(fallback, '缺少含 .table-panel 的降级 :where() 规则')
  assert.match(fallback[1], /background-attachment:\s*local,\s*scroll/)
  assert.match(fallback[1], /var\(--surface-card, #fff\)/)
  assert.match(fallback[1], /var\(--table-scroll-edge/)
  assert.match(css, /\.table-scroll-enhanced\s*\{\s*background-image:\s*none;\s*\}/)
})

test('滚动条仍是 8px 常驻细条，Firefox 走 scrollbar-width', () => {
  const css = read('./styles/global-ux.css')
  // 同一份选择器列表还要提供 8px 常驻滚动条尺寸（macOS 覆盖式滚动条默认不可见）。
  assert.match(
    css,
    /:where\([^)]*\.table-panel[^)]*\)::-webkit-scrollbar\s*\{\s*width:\s*8px;?\s*height:\s*8px;?\s*\}/,
    '缺少 .table-panel 的 :webkit-scrollbar 尺寸规则',
  )
  assert.match(css, /::-webkit-scrollbar-thumb\s*\{\s*border-radius:\s*999px;\s*background:\s*var\(--scrollbar-thumb/)
  assert.match(css, /@supports \(-moz-appearance: none\)/)
})

test('滚动容器登记覆盖全部宽表：合同/控制台/结算/数析/CRM/项目(含 pm 1360px 表)与既有遗漏容器', () => {
  for (const selector of ['.contract-table-scroll', '.console-table-scroll',
    '.settlement-table-scroll', '.da-table-scroll', '.pm-table-scroll', '.table-panel',
    '.filetask-table-wrap', '.iam-mini-table']) {
    assert.ok(TABLE_SCROLL_SCROLLERS.includes(selector), `缺少 ${selector}`)
    assert.ok(TABLE_SCROLL_SELECTOR.includes(selector), `选择器未包含 ${selector}`)
  }
})

// 直接子元素选择器（.table-panel > h2/h3/p、.pm-table-panel > header/footer）
// 之所以仍然成立，是因为增强只加 class / CSS 变量，从不插节点、不包 wrapper。
test('增强只加 class 与 CSS 变量，不重构滚动容器 DOM（直接子元素选择器继续命中）', () => {
  const source = read('./composables/useTableScrollAffordance.js')
  assert.doesNotMatch(source, /insertBefore|appendChild|replaceChild|replaceWith|innerHTML|outerHTML/)
  assert.doesNotMatch(source, /createElement/)
  assert.match(source, /classList\.add/, '增强应通过 classList 标记')
  assert.match(source, /style\.setProperty/, '覆盖层矩形应通过 CSS 变量下发')
  const crm = read('../customer_opportunity/styles/customer-opportunity.css')
  assert.match(crm, /\.table-panel > h2,/)
  const pm = read('../project_management/styles/project-management.css')
  assert.match(pm, /\.pm-table-panel\s*>\s*(header|footer)/)
  assert.match(pm, /--pm-z-sticky:\s*20/)
})

test('全局只安装一次，并在应用卸载时拆除', () => {
  const app = read('../platform/app/App.vue')
  assert.match(app, /import \{ installTableScrollAffordance \} from '@\/modules\/shared\/composables\/useTableScrollAffordance'/)
  assert.match(app, /const disposeTableScrollAffordance = installTableScrollAffordance\(\)/)
  assert.match(app, /onBeforeUnmount\(\(\) => \{[\s\S]*disposeTableScrollAffordance\(\)/, '卸载时必须拆除监听与 class')
  const source = read('./composables/useTableScrollAffordance.js')
  assert.match(source, /return \(\) => \{[\s\S]*removeEventListener\('scroll', onScroll/)
  assert.match(source, /mutationObserver\?\.disconnect\(\)/)
  assert.match(source, /for \(const entry of \[\.\.\.scrollers\.values\(\)\]\) release\(entry\)/)
  assert.equal(TABLE_SCROLL_CLASS.host, 'table-scroll-host')
  assert.equal(TABLE_SCROLL_CLASS.staticHost, 'table-scroll-host--static')
  assert.equal(TABLE_SCROLL_CLASS.canRight, 'is-table-scroll-right')
})

// 回归锁定：`.crm-toolbar, .crm-panel { background: ... }` 简写会在 0-1-0 权重上重置
// 降级层的 background-image（覆盖层接管前的那一帧）。必须只用 background-color 上色。
// 台账/客户列表把 .table-panel 与 .crm-panel 用在同一个节点上，覆盖层按 .table-panel 命中。
test('CRM 面板与工具栏只用 background-color，不用 background 简写覆盖降级层', () => {
  const css = read('../customer_opportunity/styles/customer-opportunity.css')
  const matched = /\.crm-toolbar,\s*\n?\.crm-panel\s*\{([^}]*)\}/.exec(css)
  assert.ok(matched, '缺少 .crm-toolbar / .crm-panel 共用规则')
  assert.match(matched[1], /background-color:\s*#fff/)
  assert.doesNotMatch(matched[1], /\bbackground:/, 'background 简写会清掉 background-image 降级层')
  const view = read('../customer_opportunity/views/CustomerOpportunityView.vue')
  assert.match(view, /class="crm-panel table-panel"/)
})
