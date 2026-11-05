import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// 组件级深色覆盖的结构不变量。
//
// 全局机制（main.css 的 :root[data-theme="dark"] token、useDocumentTheme、首帧脚本）
// 已由 dark-theme-styles.test.mjs 锁定；这里锁定“组件自己的 <style scoped> 不再留
// 浅色孤岛”：
//   1. 对这些文件，浅色声明里每个浅色表面/浅描边/深墨色，都必须在同一个文件里
//      有一条同名选择器的 [data-theme="dark"] 规则覆盖（不是靠别处兜底）。
//   2. 组件深色规则只允许引用 token（var(--…)）或透明/阴影关键字，不许再写十六进制。
//   3. 曾经的 global-ux.css 组件兜底段落已删除，避免同一修复两处维护。
// 浅色声明本身不在这里断言“没变”——由 git diff 证明只增不删；这里保证的是
// 覆盖关系真实存在（删掉任意一条深色规则，对应文件用例即失败）。

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')

const COMPONENTS = [
  { name: '人员变动中心', file: '../platform/iam/components/PersonnelChangeCenter.vue' },
  { name: '应用接入向导', file: '../platform/applications/components/SubsystemOnboardingModule.vue' },
  { name: '批量导入弹窗', file: '../platform/iam/components/BatchUserImportDialog.vue' },
  { name: '员工入职向导', file: '../platform/iam/components/EmployeeOnboardingModal.vue' },
  { name: '许可管理页', file: '../platform/features/licenses/CommercialLicenseView.vue' },
  { name: '运行时授权概览', file: '../platform/features/licenses/RuntimeEnforcementView.vue' },
  { name: '子系统不可用页', file: '../platform/auth/views/SubsystemAccessErrorView.vue' },
  { name: '403 页', file: '../platform/auth/views/ForbiddenView.vue' },
  { name: '子系统人工恢复面板', file: '../platform/applications/components/SubsystemAccessRecoveryPanel.vue' },
  { name: '结算时间轴', file: '../settlement/components/SettlementTimeline.vue' },
  { name: '结算合同修订挂起面板', file: '../settlement/components/ContractRevisionHoldPanel.vue' },
  { name: '字典（指标口径）页', file: '../data_analysis/views/DictionaryView.vue' },
  { name: '范围变更面板', file: '../project_management/components/NativeScopeChangePanel.vue' },
  { name: '渗透工作包卡片', file: '../project_management/components/PenetrationWorkPackageCard.vue' },
  { name: '检测类别导入弹窗', file: '../project_management/components/DetectionCategoryImportDialog.vue' },
  { name: '资质导入弹窗', file: '../project_management/components/QualificationImportDialog.vue' },
  { name: '项目创建弹窗', file: '../project_management/components/NativeProjectCreateDialog.vue' },
  { name: '共享确认弹窗', file: './components/ConfirmDialog.vue' },
  { name: '共享输入弹窗', file: './components/PromptDialog.vue' },
  { name: '操作结果提示条', file: './components/OperationResultBanner.vue' },
  { name: '通知抽屉', file: './components/OperationInboxPanel.vue' },
  { name: 'CRM 登录完成页', file: '../customer_opportunity/views/CRMLoginCompleteView.vue' },
  { name: '配置中心', file: '../platform/configuration/components/ConfigurationCenterModule.vue' },
  { name: '通知中心', file: '../platform/notifications/components/NotificationCenterModule.vue' },
]

// 浅色表面色（浅色模式下是“白/极浅底”，深色下必须换掉）
const LIGHT_SURFACES = new Set([
  '#fff', '#ffffff', '#f1f5f9', '#f8fafc', '#f8fbff', '#fbfdff', '#f7faff', '#eff6ff',
  '#eaf2ff', '#f8faff', '#faf8ff', '#f0fdf4', '#fef2f2', '#fff7f7', '#fff7ed', '#fff8f8',
  '#f5f8fc', '#f5f8fd', '#f6f9fe', '#fafbfd', '#f5f3ff', '#dfe9ff', '#dfeaff', '#dbeafe',
  '#e4edff', '#e3edff', '#eee9ff', '#fff0dc', '#e4efff', '#e2f6eb', '#f1f6ff', '#edf4ff',
  '#eef5ff', '#f3f7fd', '#f7fbff', '#e8f1ff', '#f3f7fc', '#dcfce7', '#fee2e2', '#fffbeb',
  '#fffcf5', '#fff2ef', '#e2e8f0', '#f5f7fb', '#eef1f7', '#f4f7fb', '#eaf0f8', '#f8fbfe',
])

// 浅色模式里的浅描边（深色下这类描边几乎看不见）
const LIGHT_BORDERS = new Set([
  '#e2e8f0', '#eef2f7', '#dce7f5', '#e1eaf5', '#dce8f7', '#dbeafe', '#bfdbfe', '#c7d2fe',
  '#e0e7ff', '#fecaca', '#cbd5e1', '#dbe3ee', '#dce5f1', '#dfe8f4', '#e3ebf6', '#b9cce7',
  '#d5e3fb', '#d7e4f7', '#dbe7f7', '#fde68a', '#dbe4f0', '#ccd4df', '#dce3ed', '#dde7f2',
  '#c9dcf6', '#e9c98a', '#c8b99e', '#e4daca', '#86c99a', '#b7e4c7', '#dbe3ef', '#d99898',
])

// 浅色模式里的“深墨色”：放到深色表面上会掉到 4.5:1 以下，必须换亮档
const DARK_INKS = new Set([
  '#0f172a', '#1e293b', '#1f2937', '#334155', '#34445d', '#475569', '#44516a', '#52647d',
  '#172033', '#172b4d', '#342e25', '#263650', '#18253a', '#0a0f1c', '#111827', '#3f5574',
  '#1f2d3d', '#2d4f91', '#4b70ca', '#496fd0', '#2c4f91', '#a15c16', '#b45309', '#b91c1c',
  '#7f1d1d', '#78350f', '#92400e', '#15803d', '#047857', '#1d4ed8', '#2563eb', '#6d28d9',
  '#9a3412', '#991b1b', '#a82424', '#8f2929', '#9f2222', '#b42318', '#235fcb', '#14532d',
  '#166534', '#4d7c5b', '#63748b', '#a36213', '#7351a9', '#2f65b4', '#20764e', '#b34a4a',
  '#25835a', '#3c70c9', '#64748b', '#94a3b8', '#6e52c7', '#bd6b19', '#3ca978', '#49a978',
])

const HEX = /#[0-9a-fA-F]{3,8}\b/g

function styleBlock(source, file) {
  const match = source.match(/<style[^>]*scoped[^>]*>([\s\S]*?)<\/style>/)
  assert.ok(match, `${file} 缺少 <style scoped>`)
  return match[1]
}

// 去掉 @media 段（内部可能嵌套大括号，先把整段剔除再解析平铺规则）
function withoutMedia(css) {
  let output = ''
  let index = 0
  for (;;) {
    const at = css.indexOf('@media', index)
    if (at === -1) {
      output += css.slice(index)
      break
    }
    output += css.slice(index, at)
    let depth = 0
    let cursor = at
    for (; cursor < css.length; cursor += 1) {
      if (css[cursor] === '{') depth += 1
      else if (css[cursor] === '}') {
        depth -= 1
        if (depth === 0) { cursor += 1; break }
      }
    }
    index = cursor
  }
  return output
}

function parseRules(css) {
  // 先去掉注释：注释会粘在紧随其后的选择器上，导致同名匹配失效
  const stripped = withoutMedia(css).replace(/\/\*[\s\S]*?\*\//g, '')
  return [...stripped.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
    selectors: match[1].split(',').map((part) => part.replace(/\s+/g, ' ').trim()).filter(Boolean),
    body: match[2],
  }))
}

function declarations(body) {
  return body.split(';').map((part) => part.trim()).filter(Boolean).map((part) => {
    const colon = part.indexOf(':')
    return colon === -1
      ? { property: part.toLowerCase(), value: '' }
      : { property: part.slice(0, colon).trim().toLowerCase(), value: part.slice(colon + 1).trim() }
  })
}

function colorsIn(value) {
  return (value.match(HEX) || []).map((hex) => hex.toLowerCase())
}

function hasLightSurface(value) {
  if (/rgba?\(\s*255\s*,\s*255\s*,\s*255/i.test(value)) return true
  if (/\bwhite\b/i.test(value)) return true
  return colorsIn(value).some((hex) => LIGHT_SURFACES.has(hex))
}

function hasLightBorder(value) {
  return colorsIn(value).some((hex) => LIGHT_BORDERS.has(hex))
}

function hasDarkInk(value) {
  return colorsIn(value).some((hex) => DARK_INKS.has(hex))
}

function group(property) {
  if (property === 'background' || property === 'background-color') return 'background'
  if (property === 'color') return 'color'
  if (property.startsWith('border')) return 'border'
  return property
}

function propertiesOf(body) {
  return new Set(declarations(body).map((declaration) => group(declaration.property)))
}

// 文件里“必须被深色覆盖”的 (选择器, 属性组)
function lightRequirements(css) {
  const requirements = []
  for (const rule of parseRules(css)) {
    if (rule.selectors.some((selector) => selector.includes('[data-theme='))) continue
    for (const declaration of declarations(rule.body)) {
      // 走 var(--token, fallback) 的声明由全局 token 负责，不算写死的浅色
      if (declaration.value.includes('var(')) continue
      const kind = group(declaration.property)
      let needed = false
      if (kind === 'background') needed = hasLightSurface(declaration.value)
      else if (kind === 'border') needed = hasLightBorder(declaration.value)
      else if (kind === 'color') needed = hasDarkInk(declaration.value)
      if (!needed) continue
      for (const selector of rule.selectors) requirements.push({ selector, kind })
    }
  }
  return requirements
}

function darkRules(css) {
  const rules = []
  for (const rule of parseRules(css)) {
    const selectors = rule.selectors
      .filter((selector) => selector.includes('[data-theme="dark"]'))
      .map((selector) => selector.replace(/\[data-theme="dark"\]/g, '').replace(/\s+/g, ' ').trim())
      .filter(Boolean)
    if (!selectors.length) continue
    rules.push({ selectors, body: rule.body, properties: propertiesOf(rule.body) })
  }
  return rules
}

for (const { name, file } of COMPONENTS) {
  test(`${name}：写死的浅色表面/描边/墨色在深色下都有同名覆盖，且只用 token`, () => {
    const css = styleBlock(read(file), file)
    const requirements = lightRequirements(css)
    assert.ok(requirements.length > 0, `${file} 没有检出任何需要深色覆盖的浅色声明（选择器或解析失效）`)

    const darks = darkRules(css)
    assert.ok(darks.length > 0, `${file} 缺少 [data-theme="dark"] 规则`)

    const covered = new Set()
    for (const rule of darks) {
      for (const selector of rule.selectors) {
        for (const kind of rule.properties) covered.add(`${selector}|${kind}`)
      }
    }

    const missing = requirements
      .filter(({ selector, kind }) => !covered.has(`${selector}|${kind}`))
      .map(({ selector, kind }) => `${selector} → ${kind}`)
      .filter((entry, index, all) => all.indexOf(entry) === index)
    assert.deepEqual(missing, [], `${file} 深色下这些浅色声明没有同名覆盖：\n${missing.join('\n')}`)

    // 深色规则不许再引入十六进制颜色（只允许 token / transparent / 现有阴影）
    for (const rule of darks) {
      const hexes = colorsIn(rule.body)
      assert.deepEqual(hexes, [], `${file} 深色规则里出现了新的十六进制颜色：${hexes.join(', ')}`)
    }
  })
}

test('许可管理页的卡片/描边/正文别名在深色下补齐，浅色仍取原 fallback', () => {
  const source = read('../platform/features/licenses/CommercialLicenseView.vue')
  const css = styleBlock(source, 'CommercialLicenseView.vue')
  // 浅色就是靠“别名未定义 + fallback”画出来的白卡，这里锁住这个前提
  assert.match(css, /\.license-card \{ background: var\(--surface, #fff\)/)
  assert.match(css, /\.license-stat \{ background: var\(--surface, #fff\)/)
  const dark = darkRules(css)
  const aliasRule = dark.find((rule) => rule.selectors.includes('.license-page'))
  assert.ok(aliasRule, '缺少 .license-page 的深色别名块')
  for (const [alias, token] of [
    ['--surface', 'var(--surface-card)'],
    ['--surface-2', 'var(--surface-muted)'],
    ['--border-color', 'var(--border)'],
    ['--text-primary', 'var(--text)'],
  ]) {
    assert.ok(
      aliasRule.body.replace(/\s+/g, ' ').includes(`${alias}: ${token}`),
      `深色别名块缺少 ${alias}: ${token}`,
    )
  }
  // 这些别名在全局样式里没有定义，浅色才会落到 fallback；一旦有人全局定义，浅色会变
  const main = read('../platform/shared/styles/main.css')
  for (const alias of ['--surface:', '--surface-2:', '--border-color:', '--text-primary:']) {
    assert.ok(!main.includes(alias), `main.css 不应定义 ${alias}，否则浅色不再取组件 fallback`)
  }
})

test('global-ux.css 不再重复组件内的深色兜底（单一来源）', () => {
  const globalUx = read('./styles/global-ux.css')
  const darkText = darkRules(globalUx)
    .map((rule) => rule.selectors.join(', ') + ' {' + rule.body + '}')
    .join('\n')
  assert.ok(darkText.length > 0, 'global-ux.css 仍应有全局深色规则（滚动条、遮罩、阴影等）')

  const ownedByComponents = [
    '.application-registry',
    '.access-error-card',
    '.forbidden-card',
    '.pen-package',
    '.pm-native-scope',
    '.personnel-change-form-grid',
    '.iam-batch-import',
    '.license-card',
    '.license-btn',
    '.manual-recovery',
    '.settlement-timeline-dot',
    '.da-dict-message',
  ]
  for (const fragment of ownedByComponents) {
    assert.ok(
      !darkText.includes(fragment),
      `global-ux.css 的深色块仍在兜底 ${fragment}，应与组件内深色规则只留一处`,
    )
  }
  // IAM 设置页遮罩的浅色取值在 iam-settings.css（模块级 CSS，不在本次组件清单），
  // 这里保留唯一一条深色覆盖
  assert.match(globalUx, /:root\[data-theme="dark"\] \.iam-modal-backdrop\s*\{[^}]*var\(--overlay-scrim\)/)
})
