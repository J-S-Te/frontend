import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// 合同子系统接入深色主题后的不变量。这里只锁四件事，不重复“某个类长什么样”：
//   1. 深色入口唯一：<html data-theme="dark">，只补一个 [data-theme="dark"] 块，
//      不引入 prefers-color-scheme 分叉；
//   2. 浅色零回归：所有 var(--token, 原字面量) 别名的 fallback 就是改造前的字面量，
//      浅色下 token 未定义或同值时，渲染结果与改造前一致；
//   3. 结构性表面（外壳、页头、筛选、台账、分页、弹窗、表单、建设中页）真的有覆盖；
//   4. 深色块只引用 main.css 的 token，不新造十六进制颜色。
const read = (relativePath) => readFileSync(new URL(relativePath, import.meta.url), 'utf8')

const CONTRACT = read('./styles/contract-management.css')
const MAIN = read('../platform/shared/styles/main.css')
const GLOBAL_UX = read('../shared/styles/global-ux.css')
const IMPORT_PANEL = read('./components/ContractImportPanel.vue')
const REPORTS_PANEL = read('./components/ContractReportsPanel.vue')
const LOCAL_CATALOG = read('./components/LocalContractCatalogPanel.vue')
const SOURCE_PICKER = read('./components/LocalContractSourcePicker.vue')
const PDF_PREVIEW = read('./components/ContractPDFPreview.vue')
const OUTBOX_PANEL = read('./components/ContractIntegrationOutboxPanel.vue')
const TOAST = read('../shared/components/OperationToast.vue')

const RULE = /([^{}]+)\{([^{}]*)\}/g
const squeeze = (value) => value.replace(/\s+/g, ' ').trim()
// 选择器比较：统一空白，并抹平 > + ~ 两侧的空格（样式表里两种写法混用）。
const normalize = (selector) => squeeze(selector).replace(/\s*([>+~])\s*/g, '$1')

// .vue 文件只在 <style> 块里找规则：模板/脚本里的花括号会打乱规则切分。
function styleOf(vue) {
  const index = vue.indexOf('<style')
  assert.ok(index !== -1, '组件缺少 <style> 块')
  const openEnd = vue.indexOf('>', index)
  return vue.slice(openEnd + 1)
}

function rules(css) {
  return [...css.matchAll(RULE)].map((match) => ({
    selector: normalize(match[1].replace(/\/\*[\s\S]*?\*\//g, ' ')),
    body: match[2],
  }))
}

// 按“选择器列表里的某一项”取规则体：合同样式表里有大量 .a,.b{...} 的合并写法。
function ruleBodies(css, selector) {
  const wanted = normalize(selector)
  return rules(css)
    .filter((rule) => rule.selector.split(',').some((item) => normalize(item) === wanted))
    .map((rule) => rule.body)
}

function declarations(body) {
  return body.split(';')
    .map((declaration) => declaration.trim())
    .filter(Boolean)
    .map((declaration) => {
      const index = declaration.indexOf(':')
      return index === -1
        ? { property: declaration, value: '' }
        : { property: declaration.slice(0, index).trim(), value: squeeze(declaration.slice(index + 1)) }
    })
}

// 某个选择器 + 属性在整张表里出现过的所有取值（后面的规则会覆盖前面的）。
function values(css, selector, property) {
  return ruleBodies(css, selector)
    .flatMap(declarations)
    .filter((declaration) => declaration.property === property)
    .map((declaration) => declaration.value)
}

function declaration(body, property) {
  const found = declarations(body).filter((item) => item.property === property)
  assert.ok(found.length, `缺少声明 ${property}`)
  return found[found.length - 1].value
}

function tokenBlock(css, selector) {
  const bodies = ruleBodies(css, selector)
  assert.ok(bodies.length, `缺少规则 ${selector}`)
  return bodies[bodies.length - 1]
}

function darkRules(css) {
  return rules(css).filter((rule) => rule.selector.includes('[data-theme="dark"]'))
}

function darkText(css) {
  return darkRules(css).map((rule) => `${rule.selector} {${rule.body}}`).join('\n')
}

// var(--token, 原字面量) → { token, fallback }；没有 token 或没有 fallback 都算不合格。
function aliasParts(declared) {
  const match = /^var\((--[\w-]+),\s*([\s\S]+)\)$/.exec(squeeze(declared))
  return match ? { token: match[1], fallback: squeeze(match[2]) } : null
}

function assertAlias(css, selector, property, token, fallback) {
  const declared = values(css, selector, property)
  assert.ok(declared.length, `缺少规则 ${selector} { ${property} }`)
  const hit = declared.map(aliasParts).filter(Boolean)
    .some((item) => item.token === token && item.fallback === fallback)
  assert.ok(
    hit,
    `${selector} { ${property} } 期望 var(${token}, ${fallback})，实际 ${declared.join(' / ')}`,
  )
}

function assertContains(css, selector, property, fragment) {
  const declared = values(css, selector, property)
  assert.ok(declared.length, `缺少规则 ${selector} { ${property} }`)
  assert.ok(
    declared.some((item) => item.includes(fragment)),
    `${selector} { ${property} } 期望包含 ${fragment}，实际 ${declared.join(' / ')}`,
  )
}

function normalizeHex(value) {
  const hex = String(value).trim().toLowerCase()
  if (!hex.startsWith('#')) return hex
  if (hex.length === 4) return `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`
  return hex
}

function luminance(hex) {
  const channels = [0, 2, 4].map((offset) => parseInt(normalizeHex(hex).slice(1).slice(offset, offset + 2), 16) / 255)
  const [r, g, b] = channels.map((channel) => (
    channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  ))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(foreground, background) {
  const [high, low] = [luminance(foreground), luminance(background)].sort((a, b) => b - a)
  return (high + 0.05) / (low + 0.05)
}

// main.css 的深色 token；深色块只能引用这些值，不允许新造颜色。
const MAIN_DARK = tokenBlock(MAIN, ':root[data-theme="dark"]')
const KNOWN_TOKENS = new Set([
  ...[...MAIN.matchAll(/(?:^|[;{\s])(--[\w-]+)\s*:/g)].map((match) => match[1]),
  ...[...CONTRACT.matchAll(/(?:^|[;{\s])(--[\w-]+)\s*:/g)].map((match) => match[1]),
])

test('合同样式表有唯一的 [data-theme="dark"] 块，接上页面底色与卡片阴影 token', () => {
  assert.doesNotMatch(CONTRACT, /@media[^{]*prefers-color-scheme/, '不得用系统深色媒体查询分叉样式')

  const app = tokenBlock(CONTRACT, ':root[data-theme="dark"] .contract-app')
  // 浅色下合同自己算页面底色和阴影（#f6f8fc / 两三层 rgba），全局没有同名令牌，
  // 深色下必须直接接上 main.css 的表面与阴影 token。
  assert.equal(declaration(app, '--cm-bg'), 'var(--surface-content)')
  assert.equal(declaration(app, '--cm-shadow'), 'var(--shadow-card)')
  assert.equal(declaration(app, '--cm-shadow-pop'), 'var(--shadow-raised)')
  assert.equal(declaration(app, '--cm-shadow-modal'), 'var(--shadow-modal)')

  for (const token of ['--surface-content', '--shadow-card', '--shadow-raised', '--shadow-modal']) {
    assert.ok(MAIN_DARK.includes(`${token}:`), `main.css 深色块缺少 ${token}`)
  }
  // 深色块必须挂在 data-theme 上，不能是裸 :root 或 .contract-app 单独成块。
  assert.match(CONTRACT, /:root\[data-theme="dark"\] \.contract-app\s*\{/)
})

test('模块令牌改成全局令牌别名，浅色回退到改造前的字面量', () => {
  const aliases = {
    '--cm-primary': ['--primary', '#2563eb'],
    '--cm-primary-dark': ['--primary-dark', '#1d4ed8'],
    '--cm-primary-soft': ['--primary-soft', '#eff6ff'],
    '--cm-text': ['--text', '#0f172a'],
    '--cm-secondary': ['--text-secondary', '#475569'],
    '--cm-muted': ['--text-muted', '#64748b'],
    '--cm-placeholder': ['--text-faint', '#94a3b8'],
    '--cm-border': ['--border', '#e2e8f0'],
    '--cm-green-soft': ['--success-soft', '#ecfdf5'],
    '--cm-green-text': ['--success-text', '#15803d'],
    '--cm-orange-soft': ['--warning-soft', '#fef3c7'],
    '--cm-orange-text': ['--warning-text', '#b45309'],
    '--cm-red-soft': ['--danger-soft', '#fef2f2'],
    '--cm-red-text': ['--danger-text', '#b91c1c'],
    '--cm-purple-soft': ['--violet-soft', '#f5f3ff'],
    '--cm-purple-text': ['--violet-ink', '#6d28d9'],
    '--cm-sky-soft': ['--sky-soft', '#e0f2fe'],
    '--cm-sky-text': ['--sky-ink', '#0369a1'],
    '--cm-card-border': ['--border', '#e2e8f0'],
  }
  for (const [name, [token, literal]] of Object.entries(aliases)) {
    const declared = values(CONTRACT, '.contract-app', name)
    assert.ok(declared.length, `缺少模块令牌 ${name}`)
    const hit = declared.map(aliasParts).filter(Boolean)
      .some((item) => item.token === token && item.fallback === literal)
    assert.ok(hit, `${name} 期望 var(${token}, ${literal})，实际 ${declared.join(' / ')}`)
  }

  // 语义纯色填充保持浅色方案取值（它们承载白字，不能跟着主题变亮）。
  for (const [name, token] of [['--cm-green', '--success'], ['--cm-orange', '--warning'], ['--cm-red', '--danger']]) {
    const declared = values(CONTRACT, '.contract-app', name)
    const parts = declared.map(aliasParts).filter(Boolean)
    assert.equal(parts.length, declared.length, `${name} 应全部是别名`)
    assert.ok(parts.every((item) => item.token === token), `${name} 应指向 --${token}`)
  }

  // --cm-bg 的浅色字面量原样保留（没有同名全局令牌），深色交给 dark 块。
  assert.ok(values(CONTRACT, '.contract-app', '--cm-bg').includes('#f6f8fc'))
  assert.ok(values(CONTRACT, '.contract-app', '--cm-bg').includes('#f1f5f9'))
})

test('外壳：侧栏、顶栏、页头、筛选栏与「建设中」角标都有深色落点', () => {
  // 侧栏在浅色里本来就是深蓝，深色下再压深一档并沿用侧栏墨色 token。
  assertAlias(CONTRACT, '.contract-sidebar', 'background', '--sidebar', '#0f172a')
  assertAlias(CONTRACT, '.contract-sidebar', 'color', '--sidebar-text', '#cbd5e1')
  assertAlias(CONTRACT, '.contract-nav button', 'color', '--sidebar-text', '#cbd5e1')
  assertAlias(CONTRACT, '.contract-nav button:hover', 'background', '--sidebar-hover', '#1e293b')
  assertAlias(CONTRACT, '.contract-nav button > em', 'color', '--sidebar-label', '#64748b')

  // 顶栏浅色是半透明白，深色块换成不透明卡片底。
  const dark = darkText(CONTRACT)
  assert.match(dark, /\[data-theme="dark"\] \.contract-topbar[^{]*\{[^}]*background: var\(--surface-card\)/)
  assertAlias(CONTRACT, '.contract-global-search', 'background', '--surface-muted', '#f8fafc')
  assertAlias(CONTRACT, '.contract-menu-button', 'background', '--surface-muted', '#f8fafc')

  // 页头与副按钮：标题/说明跟着 --cm-text / --cm-muted（上面已锁），副按钮抬一层。
  assertAlias(CONTRACT, '.contract-button.secondary', 'background', '--surface-raised', '#fff')

  // 「建设中」导航角标：浅色 #dc2626 改用语义色，深色换成加深档并补描边。
  assertAlias(CONTRACT, '.contract-nav button > i', 'background', '--danger', '#dc2626')
  assert.match(dark, /\[data-theme="dark"\] \.contract-nav button>i[^{]*\{[^}]*background: var\(--danger-strong\)/)
})

test('台账：卡片、表头、行分隔、悬停、徽标与分页条都被覆盖', () => {
  assertAlias(CONTRACT, '.contract-table-card', 'background', '--surface-card', '#fff')
  assertAlias(CONTRACT, '.contract-data-table th', 'background', '--surface-head', '#f8fafc')
  assertContains(CONTRACT, '.contract-data-table td', 'border-bottom', 'var(--border-soft, #f1f5f9)')
  assertContains(CONTRACT, '.contract-data-table tbody tr:hover td', 'background', 'var(--surface-hover')
  // 台账行本身没有斑马纹（只有 hover），行底色来自 .contract-table-card；
  // 这里锁住“表头 / 悬停 / 徽标 / 进度槽”四档，避免以后又写回 #fff、#f8fafc、#e2e8f0。
  assertAlias(CONTRACT, '.contract-badge', 'background', '--chip-neutral', '#f1f5f9')
  assertAlias(CONTRACT, '.contract-progress>i', 'background', '--border', '#e2e8f0')

  // 新增的分页条：底部边框走卡片描边，页码按钮抬一层，当前页保持品牌实心 + 白字。
  assertContains(CONTRACT, '.contract-table-footer', 'border-top', 'var(--cm-card-border)')
  assertAlias(CONTRACT, '.contract-table-footer button', 'background', '--surface-raised', '#fff')
  assertContains(CONTRACT, '.contract-table-footer button.active', 'background', 'var(--cm-primary)')
  assert.equal(values(CONTRACT, '.contract-table-footer button.active', 'color').at(-1), '#fff')
})

test('筛选栏与搜索框：输入类控件统一走 --surface-input', () => {
  assertAlias(CONTRACT, '.contract-filter-bar', 'background', '--surface-card', '#fff')
  assertAlias(CONTRACT, '.contract-search-field', 'background', '--surface-input', '#f8fafc')
  assertAlias(CONTRACT, '.contract-search-field:focus-within', 'background', '--surface-card', '#fff')
  assertAlias(CONTRACT, '.contract-filter-bar label:not(.contract-search-field) select', 'background', '--surface-input', '#fff')
  assertContains(CONTRACT, '.contract-filter-bar label:not(.contract-search-field) select', 'border', 'var(--cm-border)')
})

test('弹窗与表单：遮罩、弹窗头尾、详情网格、导入/审批/签署/模板/规则面板都跟着主题走', () => {
  assertAlias(CONTRACT, '.contract-modal-mask', 'background', '--overlay-scrim', 'rgba(15,23,42,.48)')
  assertAlias(CONTRACT, '.contract-detail-modal', 'background', '--surface-card', '#fff')
  assertAlias(CONTRACT, '.contract-detail-modal > header', 'background', '--surface-card', '#fff')
  assertAlias(CONTRACT, '.contract-detail-modal > footer', 'background', '--surface-card', '#fff')
  assertAlias(CONTRACT, '.contract-detail-modal > header > button', 'background', '--surface-muted', '#f8fafc')
  assertAlias(CONTRACT, '.contract-detail-modal dl > div:nth-child(odd)', 'background', '--surface-muted', '#f8fafc')
  assertAlias(CONTRACT, '.contract-detail-highlight', 'background', '--surface-tint', '#f8fbff')
  assertAlias(CONTRACT, '.contract-detail-highlight strong', 'color', '--primary-ink-strong', '#1e3a8a')

  for (const selector of [
    '.contract-form-grid input',
    '.contract-form-grid select',
    '.contract-intake-review select',
    '.contract-advanced-actions input',
    '.contract-rule-editor-list input',
    '.contract-rule-editor-list select',
    '.contract-service-item>label select',
    '.contract-template-field-grid input',
    '.contract-template-name-field>input',
    '.contract-signing-review > label:not(.contract-check-label) input',
    '.contract-number-rule-form input',
    '.contract-number-rule-form select',
  ]) {
    assertAlias(CONTRACT, selector, 'background', '--surface-input', '#fff')
  }

  // 没写背景的原生控件（导入面板查询框、行内输入等）由深色兜底规则接上输入底色，
  // 否则 UA 默认白底会在深色面板里留下一排白框。
  assert.match(
    darkText(CONTRACT),
    /:is\(\s*input:not\(\[type="checkbox"\]\)[^{]*\{[^}]*background: var\(--surface-input\)/,
  )
  // 必填星号在深底上提亮，避免 #dc2626 只有约 3:1。
  assert.match(darkText(CONTRACT), /label:has\(input\[required\]\)[\s\S]*?color: var\(--danger-text\)/)

  // 备注/边界说明的 textarea 与机会搜索框保持透明（铺在弹窗卡片上），但描边要走 token。
  assertContains(CONTRACT, '.contract-opportunity-search input', 'border', 'var(--cm-border)')
  assertContains(CONTRACT, '.contract-intake-review textarea', 'border', 'var(--cm-border)')
  assertContains(CONTRACT, '.contract-comment-label textarea', 'border', 'var(--cm-border)')

  // 审批 / 签署 / 模板 / 规则面板的卡片、预览块与提示条。
  assertAlias(CONTRACT, '.contract-sign-stats article', 'background', '--surface-card', '#fff')
  assertAlias(CONTRACT, '.contract-approval-list>article', 'background', '--surface-card', '#fff')
  assertAlias(CONTRACT, '.contract-rule-list article', 'background', '--surface-card', '#fff')
  assertContains(CONTRACT, '.contract-rule-list article', 'border', 'var(--cm-card-border)')
  assertAlias(CONTRACT, '.contract-template-grid article', 'background', '--surface-card', '#fff')
  assertAlias(CONTRACT, '.contract-number-rule-preview', 'background', '--surface-tint', '#f8fbff')
  assertAlias(CONTRACT, '.contract-number-rule-warning', 'background', '--warning-soft-strong', '#fffbeb')
  // 非法字段高亮的浅色规则被 contract-number-rule.test.mjs 逐字锁定，不能改成别名；
  // 深色改由 dark 块覆盖（见下一条断言）。
  assertContains(CONTRACT, '.contract-number-rule-form input.is-invalid', 'background', '#fef2f2')
  assert.match(darkText(CONTRACT), /\[data-theme="dark"\] \.contract-app \.contract-number-rule-form input\.is-invalid \{[^}]*background: var\(--danger-soft\)/)
  assertAlias(CONTRACT, '.contract-template-editor-row', 'background', '--surface-muted', '#f8fafc')
})

test('客户查询「建设中」页：提示条、建设卡、说明段与按钮走同一套语义色', () => {
  assertAlias(CONTRACT, '.contract-info-banner', 'background', '--primary-soft', '#eff6ff')
  assertContains(CONTRACT, '.contract-info-banner', 'border', 'var(--primary-border, #bfdbfe)')
  assertAlias(CONTRACT, '.contract-info-banner', 'color', '--primary-ink-strong', '#1d4ed8')
  assertAlias(CONTRACT, '.contract-session-info', 'background', '--primary-soft', '#eff6ff')
  assertContains(CONTRACT, '.contract-empty-state>svg', 'color', 'var(--cm-green)')
  assertAlias(CONTRACT, '.contract-card', 'background', '--surface-card', '#fff')
  assertAlias(CONTRACT, '.contract-approval-summary', 'background', '--surface-muted', '#f8fafc')
  // 两个兜底按钮：主按钮保持品牌实心 + 白字，副按钮抬一层。
  assertContains(CONTRACT, '.contract-button.primary', 'background', 'var(--cm-primary)')
  assert.equal(values(CONTRACT, '.contract-button.primary', 'color').at(-1), '#fff')
  assert.equal(values(CONTRACT, '.contract-button.danger', 'color').at(-1), '#fff')
})

test('深色块不新造十六进制颜色，引用的 token 都在 main.css 或本文件定义', () => {
  const darkBodies = darkRules(CONTRACT).map((rule) => rule.body)
  assert.ok(darkBodies.length >= 8, '深色块太少，覆盖不完整')
  for (const body of darkBodies) {
    assert.doesNotMatch(body, /#[0-9a-f]{3,8}\b/i, `深色块里出现了新的十六进制颜色：${body}`)
    // 也不允许用 rgba() 绕开 token 新造半透明色。
    assert.doesNotMatch(body, /rgba?\(/i, `深色块里出现了新的 rgb/rgba 颜色：${body}`)
  }
  for (const rule of darkRules(CONTRACT)) {
    for (const match of rule.body.matchAll(/var\((--[\w-]+)/g)) {
      assert.ok(KNOWN_TOKENS.has(match[1]), `${rule.selector} 引用了未定义的 token ${match[1]}`)
    }
  }
})

test('品牌色当文字在深色下提亮到 --primary-ink，语义色文字提亮到 -text 档', () => {
  const dark = darkText(CONTRACT)
  for (const fragment of [
    '.contract-text-button',
    '.contract-badge.info',
    '.contract-tabs button.active',
    '.contract-card>header>button',
    '.contract-template-cover>span',
    '.contract-info-banner',
  ]) {
    assert.ok(dark.includes(fragment), `深色块缺少 ${fragment} 的墨色补偿`)
  }
  assert.match(dark, /color: var\(--primary-ink\)/)
  // KPI 卡的强调色（左侧色条 + 图标）同样提亮，避免深色卡片上的蓝/橙/绿只有 3:1。
  for (const token of ['--primary-ink', '--warning-text', '--success-text', '--danger-text']) {
    assert.match(dark, new RegExp(`--accent: var\\(${token}\\)`))
  }
  assert.match(dark, /color: var\(--danger-text\)/)
  assert.match(dark, /color: var\(--warning-text\)/)
  assert.match(dark, /color: var\(--success-text\)/)
  // 深色下 --primary-ink 在卡片底上必须达到 AA。
  const ratio = contrast(declaration(MAIN_DARK, '--primary-ink'), declaration(MAIN_DARK, '--surface-card'))
  assert.ok(ratio >= 4.5, `--primary-ink 在深色卡片上只有 ${ratio.toFixed(2)}:1`)
})

test('操作结果条、空/载入/错误态与滚动容器都不留浅色孤岛', () => {
  const dark = darkText(CONTRACT)
  // 操作结果条是共享组件，在合同内容区里按语义色重绘；提示条本身是 Teleport 出来的深色条。
  assert.match(dark, /\.operation-result[^{]*\{[^}]*background: var\(--success-soft-strong\)/)
  assert.match(dark, /\.operation-result[^{]*\{[^}]*color: var\(--text-on-success\)/)
  assert.match(styleOf(TOAST), /\.shared-operation-toast \{[^}]*background: #0f172a/)

  // 空态 / 载入 / 错误条：文字走 --cm-muted / --cm-placeholder，底色走语义浅底。
  assertAlias(CONTRACT, '.contract-session-error', 'background', '--danger-soft', '#fef2f2')
  assertAlias(CONTRACT, '.contract-session-error', 'color', '--danger-text', '#b91c1c')
  assertAlias(CONTRACT, '.contract-template-preview-error', 'background', '--danger-soft', '#fef2f2')
  assertContains(CONTRACT, '.contract-empty', 'color', 'var(--cm-placeholder)')

  // 共享表格右缘渐隐：第一层是 --surface-card，深色下跟着卡片底色，不出现白边。
  const fade = /:where\(\.contract-table-scroll[^{]*\)\s*\{([^}]*)\}/.exec(GLOBAL_UX)
  assert.ok(fade, 'global-ux.css 缺少合同表格的右缘渐隐规则')
  assert.match(fade[1], /var\(--surface-card, #fff\)/)
  assert.match(fade[1], /var\(--table-scroll-edge/)
  assert.ok(MAIN_DARK.includes('--table-scroll-edge:'))
  assert.ok(MAIN_DARK.includes('--scrollbar-thumb:'))
  assert.match(GLOBAL_UX, /:root\[data-theme="dark"\] ::-webkit-scrollbar-thumb/)

  // 输入框焦点环与键盘焦点环在深色下换成共享 token。
  assert.match(dark, /:is\(input, select, textarea\):focus\s*\{[^}]*border-color: var\(--control-accent\)/)
  assert.match(dark, /outline-color: var\(--focus-ring\)/)
})

test('组件内嵌样式：导入/报表/本地目录/来源选择/PDF 预览的浅色字面量都带 token 回退', () => {
  assertContains(styleOf(IMPORT_PANEL), '.contract-import-panel', 'background', 'var(--surface-card, #fff)')
  assertContains(styleOf(IMPORT_PANEL), '.contract-import-excel-summary', 'background', 'var(--primary-soft, #eff6ff)')
  assertContains(styleOf(IMPORT_PANEL), '.contract-import-excel-issues', 'background', 'var(--danger-soft, #fef2f2)')
  assertContains(styleOf(IMPORT_PANEL), '.contract-import-warning', 'background', 'var(--warning-soft-strong, #fffbeb)')
  assertContains(styleOf(IMPORT_PANEL), '.contract-import-dropzone', 'background', 'var(--surface-tint, #f8fbff)')
  assertContains(styleOf(IMPORT_PANEL), '.contract-import-drawer textarea', 'border', 'var(--border, #e2e8f0)')
  assertContains(styleOf(IMPORT_PANEL), '.contract-import-customer-picker', 'background', 'var(--surface-muted, #f8fafc)')

  assertContains(styleOf(REPORTS_PANEL), '.contract-report-detail select', 'background', 'var(--surface-input, #fff)')
  assertContains(styleOf(REPORTS_PANEL), '.contract-report-breakdowns li i', 'background', 'var(--border, #e2e8f0)')
  assertContains(styleOf(LOCAL_CATALOG), '.local-catalog-panel', 'background', 'var(--surface-card, #fff)')
  assertContains(styleOf(LOCAL_CATALOG), '.local-catalog-panel th', 'border-bottom', 'var(--border-soft, #e5ebf1)')
  assertContains(styleOf(SOURCE_PICKER), '.local-source-picker', 'background', 'var(--surface-tint, #f8fbff)')
  assertContains(styleOf(PDF_PREVIEW), '.contract-pdf-preview', 'border', 'var(--border-soft, #d9e1ec)')
  // PDF 画布是文档纸面（白底），不跟随主题；只有外框/工具条跟随。
  assertContains(styleOf(PDF_PREVIEW), '.contract-pdf-preview canvas', 'background', 'white')

  // 合同集成发件箱面板（集成发件箱）本轮不在他人编辑中，直接改 scoped 样式：
  // 提示条底、行分隔与骨架屏渐变都带 token 回退。
  assertContains(styleOf(OUTBOX_PANEL), '.contract-outbox-notice', 'background', 'var(--surface-card, #fff)')
  assertContains(styleOf(OUTBOX_PANEL), '.contract-outbox-loading-row', 'border-bottom', 'var(--border-soft, #f1f5f9)')
  assertContains(styleOf(OUTBOX_PANEL), '.contract-outbox-loading-row i', 'background', 'var(--surface-hover, #eef2f8)')
})

test('文档内容保持纸面：docx 页面仍是白纸黑字，不跟随界面主题', () => {
  assert.equal(values(CONTRACT, '.contract-document-preview .docx-page', 'background').at(-1), '#fff')
  assert.equal(values(CONTRACT, '.contract-document-preview .docx-page', 'color').at(-1), '#111827')
  // 纸面外的台面才跟随主题。
  const dark = darkText(CONTRACT)
  assert.match(dark, /\[data-theme="dark"\] \.contract-document-preview__viewport[^{]*\{[^}]*background: var\(--surface-muted\)/)
})
