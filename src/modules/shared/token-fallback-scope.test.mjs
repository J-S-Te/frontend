import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// 结构不变量：模块私有的设计令牌（--line-1/--bg-soft 属于 .iam-settings，
// --pm-primary/--pm-muted 属于 .pm-shell）只在定义它们的作用域内有效。
// 下面两个组件会被挂到定义作用域之外：
//   · OperationInboxPanel 出现在平台顶栏（PlatformConsoleView）与合同模块
//     （ContractManagementView），这两处都不是 .iam-settings 内部；
//   · SearchableSelect 的下拉菜单 <Teleport to="body">，脱离 .pm-shell。
// 因此组件里不允许直接写「var(模块 token, 字面值)」：作用域外会静默渲染成
// 字面值，而同组件在作用域内渲染成 token 值，同一元素出现两种颜色。
// 唯一允许出现该写法的地方，是「组件根 / Teleport 菜单根」上的自定义属性声明：
// 它把模块 token 收敛成局部别名，模块内沿用模块值、模块外取确定值。
// 校验的核心就是这条：字面值兜底只准出现在别名声明上，别名只准在根上声明。

const read = (relativePath) => readFileSync(new URL(relativePath, import.meta.url), 'utf8')
const OVERLAY_SOURCE = read('./components/OperationInboxPanel.vue')
const SELECT_SOURCE = read('../project_management/components/SearchableSelect.vue')

function styleBlock(source, file) {
  const match = source.match(/<style scoped>([\s\S]*?)<\/style>/)
  assert.ok(match, `${file} 缺少 scoped 样式块`)
  return match[1]
}

function ruleBody(css, selector) {
  const pattern = new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^{}]*)\\}`)
  const match = css.match(pattern)
  assert.ok(match, `缺少规则 ${selector}`)
  return match[1]
}

function declaration(body, property) {
  const match = body.match(new RegExp(`(?:^|[;{\\s])${property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:\\s*([^;]+);`))
  return match ? match[1].trim() : ''
}

// 扁平的「属性: 值」列表，用来判断 token 兜底写在哪个属性上。
function declarations(css) {
  return [...css.matchAll(/(^|[;{\s])((?:--)?[A-Za-z][\w-]*)\s*:\s*([^;{}]+);/g)]
    .map((match) => ({ property: match[2], value: match[3].trim() }))
}

const OVERLAY_CSS = styleBlock(OVERLAY_SOURCE, 'OperationInboxPanel.vue')
const SELECT_CSS = styleBlock(SELECT_SOURCE, 'SearchableSelect.vue')

const SCOPED_TOKENS = [
  {
    file: 'OperationInboxPanel.vue',
    css: OVERLAY_CSS,
    tokens: ['--line-1', '--bg-soft'],
    aliases: ['--inbox-hover-line', '--inbox-hover-bg'],
  },
  {
    file: 'SearchableSelect.vue',
    css: SELECT_CSS,
    tokens: ['--pm-primary', '--pm-muted'],
    aliases: ['--pm-select-primary', '--pm-select-muted'],
  },
]

test('操作记录抽屉在组件根上收敛 IAM token，作用域外不再回落字面值', () => {
  const root = ruleBody(OVERLAY_CSS, '.operation-inbox')
  assert.equal(declaration(root, '--inbox-hover-line'), 'var(--line-1, #dbe3ef)')
  assert.equal(declaration(root, '--inbox-hover-bg'), 'var(--bg-soft, #f6f8fb)')

  // hover 只消费别名：别名在 .iam-settings 内解析成 var(--border)/var(--surface-muted)，
  // 在平台顶栏、合同模块解析成 #dbe3ef/#f6f8fb（与改前的回退值一致）。
  const hover = ruleBody(OVERLAY_CSS, '.operation-inbox-trigger:hover')
  assert.equal(declaration(hover, 'border-color'), 'var(--inbox-hover-line)')
  assert.equal(declaration(hover, 'background'), 'var(--inbox-hover-bg)')
})

test('操作记录抽屉的深色主题别名与平台全局 token 同源（深色取值与改前一致）', () => {
  const darkRoot = ruleBody(OVERLAY_CSS, '[data-theme="dark"] .operation-inbox')
  assert.equal(declaration(darkRoot, '--inbox-hover-line'), 'var(--border)')
  assert.equal(declaration(darkRoot, '--inbox-hover-bg'), 'var(--surface-hover)')
})

test('下拉选择器的组件根与 Teleport 菜单根各自声明同一组 PM 别名', () => {
  // 菜单 Teleport 到 body，拿不到 .pm-shell 的继承值，必须自己声明一份；
  // 组件根负责触发器与选项 chip。两处取值相同，菜单与触发器才不会分叉。
  for (const selector of ['.pm-search-select', '.pm-search-select-menu']) {
    const body = ruleBody(SELECT_CSS, selector)
    assert.equal(declaration(body, '--pm-select-primary'), 'var(--pm-primary, #1f5eff)')
    assert.equal(declaration(body, '--pm-select-muted'), 'var(--pm-muted, #64748b)')
  }
  // 别名在模块内解析成 #2563eb / var(--text-muted)（与改前一致），
  // 模块外解析成 #1f5eff / #64748b（与改前的字面值一致）。
  assert.match(SELECT_CSS, /\.pm-search-select-option\.selected \{ color: var\(--pm-select-primary\); \}/)
  assert.match(SELECT_CSS, /\.pm-search-select-empty \{[^}]*color: var\(--pm-select-muted\);/)
})

test('模块 token 的字面值兜底只允许出现在根上的别名声明里', () => {
  for (const item of SCOPED_TOKENS) {
    const parsed = declarations(item.css)
    for (const token of item.tokens) {
      const fallbackRefs = parsed.filter((entry) => entry.value.includes(`var(${token},`))
      assert.ok(fallbackRefs.length > 0, `${item.file} 丢失了 ${token} 的别名声明`)
      for (const ref of fallbackRefs) {
        assert.ok(
          item.aliases.includes(ref.property),
          `${item.file}: ${token} 的字面值兜底写在 ${ref.property} 上；` +
            '直接消费模块 token 的规则会在作用域外渲染成字面值，必须改为消费组件根上的别名',
        )
      }
    }
  }
})

test('别名不复用模块 token 名，避免自定义属性自引用（循环 → invalid）', () => {
  for (const item of SCOPED_TOKENS) {
    for (const alias of item.aliases) {
      assert.ok(
        !item.tokens.includes(alias),
        `${item.file}: 别名 ${alias} 与模块 token 同名，var() 自引用会让整条声明失效`,
      )
    }
  }
})
