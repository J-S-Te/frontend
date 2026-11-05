import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// 全局深色主题的结构不变量。这里不重复“某个类长什么样”，只锁定四件事：
//   1. 深色唯一来源是 <html data-theme="dark">，不许出现 prefers-color-scheme 分叉；
//   2. 浅色 token 的取值没有被改动（浅色必须逐像素一致）；
//   3. 五个业务外壳 + 共享层各自真的有深色覆盖，且覆盖到结构性表面；
//   4. 深色调色板在深色表面上的对比度仍然达标。
const read = (relativePath) => readFileSync(new URL(relativePath, import.meta.url), 'utf8')

const SHARED = {
  main: read('../platform/shared/styles/main.css'),
  console: read('../platform/styles/console.css'),
  settings: read('../platform/styles/settings-showcase.css'),
  settlement: read('../settlement/styles/settlement.css'),
  dashboard: read('../data_analysis/styles/data-analysis.css'),
  project: read('../project_management/styles/project-management.css'),
  crm: read('../customer_opportunity/styles/customer-opportunity.css'),
  globalUx: read('./styles/global-ux.css'),
}
const APP_VUE = read('../platform/app/App.vue')
const INDEX_HTML = read('../../../index.html')

function ruleBody(css, selector) {
  const match = css.match(new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`))
  assert.ok(match, `缺少规则 ${selector}`)
  return match[1]
}

function declaration(body, property) {
  const match = body.match(new RegExp(`(?:^|[;{\\s])${property}\\s*:\\s*([^;]+);`))
  return match ? match[1].trim() : ''
}

// 深色规则：选择器里带 [data-theme="dark"] 的整条规则（选择器 + 规则体）。
function darkRules(css) {
  return [...css.matchAll(/([^{}]*\[data-theme="dark"\][^{}]*)\{([^}]*)\}/g)]
    .map((match) => `${match[1].trim()} {${match[2]}}`)
}

// 只取规则体：给"不允许出现新十六进制颜色"这类断言用。
function darkBlocks(css) {
  return [...css.matchAll(/[^{}]*\[data-theme="dark"\][^{}]*\{([^}]*)\}/g)].map((match) => match[1])
}

function darkText(css) {
  return darkRules(css).join('\n')
}

function normalizeHex(value) {
  const hex = value.trim().toLowerCase()
  if (!hex.startsWith('#')) return hex
  if (hex.length === 4) return `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`
  return hex
}

function luminance(hex) {
  const value = normalizeHex(hex).slice(1)
  const channels = [0, 2, 4].map((offset) => parseInt(value.slice(offset, offset + 2), 16) / 255)
  const [r, g, b] = channels.map((channel) => (
    channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  ))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(foreground, background) {
  const [high, low] = [luminance(foreground), luminance(background)].sort((a, b) => b - a)
  return (high + 0.05) / (low + 0.05)
}

test('main.css 用 :root[data-theme="dark"] 统一给出共享 token 的深色取值', () => {
  const body = ruleBody(SHARED.main, ':root[data-theme="dark"]')
  for (const token of [
    '--text', '--text-secondary', '--text-muted', '--text-faint',
    '--border', '--line-soft', '--line-strong',
    '--surface-content', '--surface-card', '--surface-muted',
    '--primary-soft', '--primary-border',
    '--success-soft', '--warning-soft', '--danger-soft',
    '--shadow-card', '--overlay-scrim', '--scrollbar-thumb',
    // 统一三态（state.css 通过 var(--ui-state-*, fallback) 读取）
    '--ui-state-title', '--ui-state-muted', '--ui-state-retry-border',
  ]) {
    assert.ok(declaration(body, token), `深色 token 缺少 ${token}`)
  }

  const lightRoot = ruleBody(SHARED.main, ':root')
  // 深色覆盖必须真的换了底色与文字，否则等于没实现。
  assert.notEqual(
    normalizeHex(declaration(body, '--surface-card')),
    normalizeHex(declaration(lightRoot, '--surface-card')),
  )
  assert.notEqual(
    normalizeHex(declaration(body, '--text')),
    normalizeHex(declaration(lightRoot, '--text')),
  )
  // 深色下才生效：深色块必须是 :root[data-theme="dark"]，不能是裸 :root。
  assert.match(SHARED.main, /:root\[data-theme="dark"\]\s*\{/)
})

test('浅色 token 的取值保持改造前的原样', () => {
  const lightRoot = ruleBody(SHARED.main, ':root')
  const expected = {
    '--primary': '#2563eb',
    '--primary-dark': '#1d4ed8',
    '--primary-soft': '#eff6ff',
    '--primary-border': '#bfdbfe',
    '--text': '#0f172a',
    '--text-secondary': '#475569',
    '--text-muted': '#64748b',
    '--text-faint': '#94a3b8',
    '--border': '#e2e8f0',
    '--line-soft': '#edf0f5',
    '--line-strong': '#cbd5e1',
    '--surface-content': '#f1f5f9',
    '--surface-card': '#ffffff',
    '--surface-muted': '#f8fafc',
    '--sidebar': '#0f172a',
    '--success-soft': '#ecfdf5',
    '--warning-soft': '#fef3c7',
    '--danger-soft': '#fef2f2',
  }
  for (const [token, value] of Object.entries(expected)) {
    assert.equal(normalizeHex(declaration(lightRoot, token)), value, `浅色 ${token} 被改动`)
  }
  // 深色块之后不允许再有第二个 :root 覆盖浅色。
  const rootBlocks = [...SHARED.main.matchAll(/(^|\n):root\s*\{/g)]
  assert.equal(rootBlocks.length, 1, 'main.css 只应有一个裸 :root 浅色块')
})

test('深色下正文与次要文字在每一种深色表面上都达到 WCAG AA', () => {
  const dark = ruleBody(SHARED.main, ':root[data-theme="dark"]')
  const values = {}
  for (const token of ['--text', '--text-secondary', '--text-muted', '--text-faint', '--primary-ink',
    '--surface-content', '--surface-card', '--surface-muted', '--surface-head', '--surface-raised']) {
    values[token] = normalizeHex(declaration(dark, token))
  }
  const surfaces = ['--surface-content', '--surface-card', '--surface-muted', '--surface-head', '--surface-raised']
  for (const ink of ['--text', '--text-secondary', '--text-muted', '--primary-ink']) {
    for (const surface of surfaces) {
      const ratio = contrast(values[ink], values[surface])
      assert.ok(ratio >= 4.5, `${ink} 在 ${surface} 上只有 ${ratio.toFixed(2)}:1`)
    }
  }
  // 主按钮仍是浅色方案里的实心蓝 + 白字，深色下不能把 --primary 改浅。
  assert.equal(normalizeHex(declaration(dark, '--primary')), '#2563eb')
  assert.ok(contrast('#ffffff', '#2563eb') >= 4.5)
})

test('主题只由 data-theme 属性驱动，不引入 prefers-color-scheme 的分叉样式', () => {
  for (const [name, css] of Object.entries(SHARED)) {
    assert.doesNotMatch(css, /@media[^{]*prefers-color-scheme/, `${name} 不得用系统深色媒体查询分叉样式`)
  }
  // App.vue 安装同步器，并在路由切换时重读偏好。
  assert.match(APP_VUE, /installDocumentThemeSync/)
  assert.match(APP_VUE, /disposeDocumentTheme\(\)/)
  // 首帧脚本与运行期共用同一个存储键。
  assert.match(INDEX_HTML, /'basic-platform\.portal-theme'/)
  assert.match(INDEX_HTML, /setAttribute\('data-theme'/)
})

test('平台控制台外壳：侧栏、卡片、表格、弹窗、控件与提示条都有深色覆盖', () => {
  const dark = darkText(SHARED.console)
  for (const fragment of [
    '.console-data-table th',
    '--surface-head',
    '--surface-input',
    '.console-modal-backdrop',
    '--overlay-scrim',
    '.console-card',
    '.console-toast',
    '.console-switch',
  ]) {
    assert.ok(dark.includes(fragment), `console.css 深色块缺少 ${fragment}`)
  }
  // 深色卡片靠阴影分层；侧栏底部与深色侧栏同层。
  assert.match(dark, /\.console-card[^{]*\{[^}]*box-shadow/)
  assert.match(dark, /\.console-sidebar-user\s*\{[^}]*var\(--sidebar-hover\)/)
  assert.ok(darkRules(SHARED.console).length >= 8, 'console.css 的深色覆盖太少')
})

test('结算：品牌色别名与浅色渐变卡面在深色下换成 token', () => {
  const dark = darkText(SHARED.settlement)
  assert.match(dark, /\.settlement-shell\s*\{[^}]*--settlement-blue:\s*var\(--primary-ink\)/)
  assert.match(dark, /\.settlement-operation-card[\s\S]*?linear-gradient\([^)]*var\(--surface-tint\)/)
  assert.ok(dark.includes('.settlement-operation-form'))
})

test('数据看板：看板外壳、表格、开关与错误条在深色下不留白底', () => {
  const dark = darkText(SHARED.dashboard)
  for (const fragment of [
    '--da-surface: var(--surface-card)',
    '--da-border: var(--border)',
    '.da-switch',
    '.da-table th',
    '.da-native-inline-error',
    '--surface-input',
  ]) {
    assert.ok(dark.includes(fragment), `data-analysis.css 深色块缺少 ${fragment}`)
  }
})

test('项目管理：深色只重写 --pm-* 令牌层，且不引入规范外的颜色', () => {
  const blocks = darkBlocks(SHARED.project)
  assert.ok(blocks.length > 0, 'project-management.css 缺少深色块')
  const body = blocks.join('\n')
  for (const token of ['--pm-ink', '--pm-body', '--pm-muted', '--pm-content', '--pm-card',
    '--pm-sunken', '--pm-line', '--pm-sidebar', '--pm-primary-soft']) {
    assert.match(body, new RegExp(`${token}:\\s*var\\(--`), `深色块缺少 ${token} → 全局 token 的映射`)
  }
  // UniLab 规范：本文件只允许规范调色板里的十六进制颜色，深色块必须只引用 token。
  for (const block of blocks) {
    assert.doesNotMatch(block, /#[0-9a-fA-F]{3,8}\b/, '项目管理的深色块里不允许出现新的十六进制颜色')
  }
  // 表格三档底色要覆盖（选择器在规则头，取值在规则体，分开断言）。
  const rules = darkText(SHARED.project)
  assert.match(rules, /\.pm-table th\s*\{[^}]*--surface-head/)
  assert.match(rules, /\.pm-table tbody tr:hover\s*\{[^}]*--surface-hover/)
})

test('客户与商机：面板、弹窗、渐变卡面与时间轴在深色下有覆盖，且保留渐隐层写法', () => {
  const dark = darkText(SHARED.crm)
  for (const fragment of [
    '.crm-panel',
    '--surface-card',
    '.crm-modal',
    '--overlay-scrim',
    '--surface-input',
    '.crm-timeline-rail span',
    '.crm-catalog-header',
    '.crm-approval-rule-dot',
  ]) {
    assert.ok(dark.includes(fragment), `customer-opportunity.css 深色块缺少 ${fragment}`)
  }
  // .crm-toolbar/.crm-panel 的深色覆盖必须继续只用 background-color：
  // background 简写会清掉 global-ux.css 的右缘渐隐背景层。
  const darkPanel = dark.match(/\[data-theme="dark"\] \.crm-toolbar,\s*\n?\[data-theme="dark"\] \.crm-panel\s*\{([^}]*)\}/)
  assert.ok(darkPanel, '缺少 .crm-toolbar / .crm-panel 的深色规则')
  assert.match(darkPanel[1], /background-color:\s*var\(--surface-card\)/)
  assert.doesNotMatch(darkPanel[1], /\bbackground:/)
})

test('共享表格右缘渐隐与滚动条改用 token，深色下不会出现白边', () => {
  const fade = /:where\([^)]*\.table-panel[^)]*\)\s*\{([^}]*)\}/.exec(SHARED.globalUx)
  assert.ok(fade, '缺少表格滚动渐隐规则')
  assert.match(fade[1], /var\(--surface-card/)
  // 遮罩第一层必须走 token（fallback 可以是浅色 #fff，但不能直接写死白色停靠点）。
  assert.doesNotMatch(fade[1], /linear-gradient\(to left, #fff\b/, '渐隐遮罩不能写死白色')
  assert.match(SHARED.globalUx, /::-webkit-scrollbar-thumb\s*\{\s*border-radius: 999px; background: var\(--scrollbar-thumb/)
  assert.match(SHARED.globalUx, /:root\[data-theme="dark"\] ::-webkit-scrollbar-thumb/)
})

test('设置页展示样式与共享三态没有留下浅色孤岛', () => {
  // 设置页展示样式走 token，深色下自动跟随；这里锁定它不含写死的表面色。
  assert.doesNotMatch(SHARED.settings, /background:\s*#fff/i)
  assert.match(SHARED.main, /:root\[data-theme="dark"\] \.ui-state__retry/)
})

// ============================================================================
// 浅色回退类（var(--token, 字面量)）的类守护
// ----------------------------------------------------------------------------
// 回退只在 token 未定义时生效。token 一旦在 main.css 的浅色 :root 里定义，
// 浅色拿到的就是 token 的值——此时字面量必须与 token 的浅色取值一致（大小写 /
// #fff ↔ white / 三位十六进制归一后比较），否则改造前的浅色会被 token 悄悄顶掉。
// ============================================================================

const SRC_ROOT = fileURLToPath(new URL('../../../src/', import.meta.url))

function sourceSheets(directory, collected = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) sourceSheets(path, collected)
    else if (/\.(css|vue)$/.test(entry.name)) collected.push(path)
  }
  return collected
}

// .vue 只看 <style> 块；模板与脚本里的字符串不参与样式判定。
function styleText(file, source) {
  if (!file.endsWith('.vue')) return source
  return [...source.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((match) => match[1]).join('\n')
}

// 注释里会写“不能写成 var(--x, #fff)”这类反例，扫描前必须去掉。
function withoutComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, ' ')
}

// 抽出所有 var(--token, 回退值)。回退值允许含括号（rgba()/calc()/渐变），
// 只有最外层逗号才是分隔符；回退值本身是另一个 var() 的声明由 main.css 层统一管。
function varFallbacks(css) {
  const found = []
  for (let index = 0; index < css.length; index += 1) {
    if (!css.startsWith('var(', index)) continue
    let depth = 1
    let cursor = index + 4
    for (; cursor < css.length && depth > 0; cursor += 1) {
      if (css[cursor] === '(') depth += 1
      else if (css[cursor] === ')') depth -= 1
    }
    const inner = css.slice(index + 4, cursor - 1)
    let nested = 0
    let comma = -1
    for (let k = 0; k < inner.length; k += 1) {
      if (inner[k] === '(') nested += 1
      else if (inner[k] === ')') nested -= 1
      else if (inner[k] === ',' && nested === 0) { comma = k; break }
    }
    const token = (comma === -1 ? inner : inner.slice(0, comma)).trim()
    const fallback = comma === -1 ? '' : inner.slice(comma + 1).trim()
    if (fallback) found.push({ token, fallback })
    index = cursor - 1
  }
  return found
}

function normalizeFallback(value) {
  const text = value.trim().toLowerCase().replace(/\s+/g, ' ')
  if (text === 'white') return '#ffffff'
  if (text === 'black') return '#000000'
  return normalizeHex(text)
}

// 浅色 :root 的 token 表：token → 规范化取值。
function lightRootTokenMap() {
  const tokens = new Map()
  for (const part of ruleBody(SHARED.main, ':root').split(';')) {
    const colon = part.indexOf(':')
    if (colon === -1) continue
    const property = part.slice(0, colon).trim()
    if (property.startsWith('--')) tokens.set(property, part.slice(colon + 1).trim())
  }
  return tokens
}

function fallbackMismatches(css, tokens) {
  return varFallbacks(css)
    .filter(({ token, fallback }) => tokens.has(token) && !fallback.includes('var('))
    .filter(({ token, fallback }) => normalizeFallback(fallback) !== normalizeFallback(tokens.get(token)))
    .map(({ token, fallback }) => ({ token, fallback, lightValue: tokens.get(token) }))
}

test('浅色已定义的 token 不得用不一致的字面量兜底：这一类回退在浅色永不生效', () => {
  const tokens = lightRootTokenMap()
  const files = sourceSheets(SRC_ROOT)
  const offenders = []
  let checked = 0
  for (const file of files) {
    const css = withoutComments(styleText(file, readFileSync(file, 'utf8')))
    for (const { token, fallback } of varFallbacks(css)) {
      if (!tokens.has(token) || fallback.includes('var(')) continue
      checked += 1
      if (normalizeFallback(fallback) === normalizeFallback(tokens.get(token))) continue
      offenders.push(`${file.slice(SRC_ROOT.length)} → var(${token}, ${fallback})，而浅色 ${token}=${tokens.get(token)}`)
    }
  }
  assert.deepEqual(offenders, [], `浅色下这些声明会被 token 的取值顶掉：\n${offenders.join('\n')}`)

  // 非空转：确认真的扫到了全量样式表与足够多的回退声明。
  assert.ok(files.length >= 130, `只扫到 ${files.length} 个 css/vue 文件，扫描范围不完整`)
  assert.ok(checked >= 600, `只校验到 ${checked} 条 var(--token, 字面量) 声明，扫描逻辑可能失效`)

  // 扫描器自检：被修复掉的旧形态必须能被识别，否则这条用例就是空转的。
  assert.deepEqual(
    fallbackMismatches('color: var(--danger-text, #7f1d1d);', tokens).map((problem) => problem.token),
    ['--danger-text'],
  )
  // 归一化自检：#fff 与 white 视为同色，不能被误报。
  assert.deepEqual(fallbackMismatches('background: var(--surface-card, white);', tokens), [])
})

test('客户侧浅色描边继续走 var(--border-soft, #e4ecfc)，--border-soft 保持深色专属', () => {
  const lightRoot = ruleBody(SHARED.main, ':root')
  // --border-soft 只在深色 :root 定义，浅色才会真正回落到 #e4ecfc。
  assert.ok(!/--border-soft\s*:/.test(lightRoot), '--border-soft 写进浅色 :root 后回退就失效了')
  assert.match(SHARED.main, /:root\[data-theme="dark"\][\s\S]*--border-soft\s*:/)
  for (const file of [
    '../customer_opportunity/styles/customer-opportunity.css',
    '../customer_portal/styles/project-export.css',
  ]) {
    assert.ok(
      read(file).includes('var(--border-soft, #e4ecfc)'),
      `${file} 缺少 var(--border-soft, #e4ecfc)：浅色描边 #e4ecfc 会被深色 token 顶掉`,
    )
  }
})

test('合同导入面板与 PDF 预览：浅色保留原字面量，深色只走 token', () => {
  const importPanel = read('../contract_management/components/ContractImportPanel.vue')
  // 旧写法 var(--danger-text, #7f1d1d)：--danger-text 在浅色已定义，浅色会被顶成 #b91c1c。
  assert.doesNotMatch(importPanel, /var\(--danger-text, #7f1d1d\)/, '浅色危险色又退回 var(--danger-text, …) 了')
  assert.doesNotMatch(importPanel, /var\(--warning-text, #92400e\)/, '浅色警示色又退回 var(--warning-text, …) 了')
  assert.match(importPanel, /var\(--danger-ink, #7f1d1d\)/)
  assert.match(importPanel, /var\(--warning-ink, #92400e\)/)
  // 这两个“墨色”只在深色定义，浅色才真的取回退值。
  const lightRoot = ruleBody(SHARED.main, ':root')
  for (const token of ['--danger-ink', '--warning-ink']) {
    assert.ok(!lightRoot.includes(`${token}:`), `${token} 不能出现在浅色 :root`)
    assert.ok(SHARED.main.includes(`${token}:`), `${token} 缺少深色定义`)
  }

  const pdfPreview = read('../contract_management/components/ContractPDFPreview.vue')
  // 工具条浅色底 #f5f7fb 与 --surface-muted 的浅色值不同，只能保留字面量。
  assert.match(pdfPreview, /\.contract-pdf-preview header\s*\{[^}]*background:\s*#f5f7fb/)
  // 深色用同文件的 [data-theme="dark"] 规则覆盖，不靠 token 回退。
  assert.match(pdfPreview, /\[data-theme="dark"\] \.contract-pdf-preview header\s*\{[^}]*var\(--surface-muted\)/)
})
