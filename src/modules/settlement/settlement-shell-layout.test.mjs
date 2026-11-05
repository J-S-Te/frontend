import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')

// 取选择器对应的声明体（选择器后第一个 {...}），比整行匹配耐得住行内多余规则和空白变化。
function ruleBody(source, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const matched = new RegExp(escaped + '\\s*\\{([^}]*)\\}').exec(source)
  assert.ok(matched, `缺少规则 ${selector}`)
  return matched[1]
}

// 回归锁定：窄屏（≤820px）结算侧栏收敛为抽屉，汉堡按钮、关闭按钮和遮罩必须共同驱动
// 同一个 mobileMenuOpen，否则会出现“能打开不能关”或“遮罩盖住内容但点不掉”的窄屏死角。
//
// 迁移说明：这三个入口原来手写在结算视图里（class="console-menu-button" / "console-close-menu" /
// "console-menu-mask"），现在统一由共享外壳 AppShell.vue 渲染。断言随之拆成两段：
// 1. 外壳侧：三个入口存在，且外壳自己的 src/modules/shared/app-shell.test.mjs 锁定了
//    “汉堡 / 关闭 / 遮罩都驱动 update:menuOpen”“点击导航先收起抽屉再抛 navigate”。
// 2. 结算侧：抽屉状态仍由本页 mobileMenuOpen 持有并 v-model:menu-open 双向绑定，
//    页面自己的 go() 仍然在导航后收起抽屉（列表内的动作入口也走这个函数）。
test('结算侧栏抽屉由共享外壳驱动，本页继续持有 mobileMenuOpen 并在导航后收起', () => {
  const view = read('./views/SettlementView.vue')
  const shell = read('../shared/components/AppShell.vue')
  const shellTest = read('../shared/app-shell.test.mjs')

  assert.match(view, /const mobileMenuOpen = ref\(false\)/)
  assert.match(view, /<AppShell[\s\S]{0,600}v-model:menu-open="mobileMenuOpen"/)
  assert.match(view, /@navigate="handleNavigate"/)

  for (const control of ['console-menu-button', 'console-close-menu', 'console-menu-mask']) {
    assert.match(shell, new RegExp(`class="${control}"`), `共享外壳必须渲染 .${control}`)
    assert.match(shellTest, new RegExp(control), `app-shell.test.mjs 必须覆盖 .${control}`)
  }
  // 外壳 selectNav：先收起抽屉（setMenuOpen(false)）再 emit navigate。
  assert.match(shell, /function selectNav\(item\) \{\s*setMenuOpen\(false\)\s*emit\('navigate'/)
  assert.match(shellTest, /点击导航项先收起抽屉再抛出 navigate\(key, item\)/)

  // 导航跳转后必须收起抽屉，否则窄屏跳转完成仍被遮挡（结算列表内的动作入口也走 go()）。
  assert.match(view, /function go\(section\) \{\s*mobileMenuOpen\.value = false/)
  // 「返回子系统门户」与其它导航项一样由外壳抛键，本页映射到既有 back()。
  assert.match(view, /function handleNavigate\(key\) \{\s*if \(key === "portal"\) \{\s*back\(\);\s*return;\s*\}\s*go\(key\);/)
})

// 回归锁定：侧栏必须是 <main> 的兄弟节点（外壳子元素），而不是嵌在 <main> 里。
// 嵌进主区后主区的 margin-left / 滚动上下文会把抽屉裁掉，遮罩也无法覆盖整页。
//
// 迁移说明：这条结构约束原来靠数结算视图里的 <main>/<aside> 字面量成立；现在主区与侧栏
// 由共享外壳渲染一次，约束由 src/modules/shared/app-shell.test.mjs 锁定
// （模板与渲染结果都只有一个 <main>/<aside>、<aside> 在 <main> 开始前闭合、遮罩在 </main> 之后）。
// 结算视图这边的等价保证是：不再出现任何 <main>/<aside>/遮罩字面量，皮肤类名改走 props。
test('结算视图把主区与侧栏交给共享外壳，settlement-* 皮肤类名走 props', () => {
  const view = read('./views/SettlementView.vue')
  const shellTest = read('../shared/app-shell.test.mjs')

  assert.equal((view.match(/<AppShell[\s>]/g) || []).length, 1, '只允许一个 <AppShell>')
  assert.equal((view.match(/<\/AppShell>/g) || []).length, 1)
  assert.equal((view.match(/<main[\s>]/g) || []).length, 0, '主区由外壳渲染，视图不能再写 <main>')
  assert.equal((view.match(/<aside[\s>]/g) || []).length, 0, '侧栏由外壳渲染，视图不能再写 <aside>')
  assert.doesNotMatch(
    view,
    /console-menu-mask|console-menu-button|console-close-menu/,
    '汉堡按钮 / 关闭按钮 / 遮罩归共享外壳，视图不得再自建',
  )

  // 外壳的模板与渲染用例同时锁定唯一主区、侧栏顺序与遮罩位置。
  assert.match(shellTest, /外壳模板只有一个 <main> 和一个 <aside>，<aside> 在 <main> 前闭合/)
  assert.match(shellTest, /抽屉遮罩受 menuOpen 控制，且渲染在 <\/main> 之后/)

  // 皮肤类名仍然落在同一批元素上，只是改成 prop 传递。
  assert.match(view, /page-class="settlement-shell"/)
  assert.match(view, /sidebar-class="settlement-sidebar"/)
  assert.match(view, /topbar-class="settlement-topbar"/)
  assert.match(view, /content-class="settlement-content"/)
  assert.match(view, /main-class="settlement-main"/)
  // 侧栏用户区保留结算自己的外观（48px 头像、独立退出按钮、footer 分隔线）。
  assert.match(view, /sidebar-user-class="settlement-sidebar-footer subsystem-sidebar-user"/)
  assert.match(view, /<template #sidebar-user>[\s\S]{0,600}class="settlement-sidebar-avatar"/)
  assert.match(view, /<template #sidebar-user>[\s\S]{0,900}class="settlement-sidebar-logout"/)
})

// 回归锁定：结算不再自建 64px 图标栏，主区偏移与宽窄屏显隐统一交给共享 console.css。
// 自建图标栏会在 620–820px 留下一条没有导航的空白条；写死 margin-left 会让主区在窄屏被推出视口。
test('结算样式不再自建 64px 图标栏、不写死主区偏移、不在窄屏隐藏侧栏', () => {
  const css = read('./styles/settlement.css')
  assert.doesNotMatch(css, /width:\s*64px/, '不得再声明 64px 图标栏宽度')
  assert.doesNotMatch(css, /margin-left:\s*248px/, '主区偏移交给共享 console.css')
  assert.doesNotMatch(
    css,
    /\.settlement-sidebar[^{}]*\{[^}]*display:\s*none/,
    '窄屏侧栏必须是抽屉，不能用 display:none 抹掉导航入口',
  )
  assert.match(ruleBody(css, '.settlement-main'), /min-width:\s*0/)
})

// 回归锁定：顶栏有三个子元素（汉堡 / 面包屑 / 操作区），只靠 space-between 会把面包屑挤到中间；
// 操作区必须 margin-left:auto 顶到右缘，面包屑才稳定贴着汉堡按钮。
test('结算顶栏操作区用 margin-left:auto 顶到右缘', () => {
  const css = read('./styles/settlement.css')
  const actions = ruleBody(css, '.settlement-topbar-actions')
  assert.match(actions, /display:\s*flex/)
  assert.match(actions, /margin-left:\s*auto/)
})
