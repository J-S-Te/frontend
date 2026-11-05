// 合同管理外壳的键盘 / 读屏可达性约定（定向修复，视图不迁移到 shared/AppShell.vue）。
//
// 锁定三件事：
// 1. 跳过导航链接（#main-content）的落点：<main> 静态带 id="main-content" 且可编程聚焦；
// 2. 当前页导航项带 aria-current="page"，其余导航项不渲染该属性；
// 3. 汉堡按钮用 aria-expanded / aria-controls 关联抽屉侧栏。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parse } from '@vue/compiler-sfc'

const source = readFileSync(new URL('./views/ContractManagementView.vue', import.meta.url), 'utf8')
const sfc = parse(source, { filename: 'ContractManagementView.vue' })
const template = sfc.descriptor.template.content

function astElements(node, out = []) {
  if (!node || typeof node !== 'object') return out
  if (Array.isArray(node)) {
    for (const child of node) astElements(child, out)
    return out
  }
  if (node.type === 1) out.push(node)
  if (node.children) astElements(node.children, out)
  return out
}

function staticAttr(node, name) {
  const found = node.props.find((prop) => prop.type === 6 && prop.name === name)
  return found ? found.value?.content : undefined
}

function directiveExpression(node, name, argName) {
  const found = node.props.find((prop) => prop.type === 7 && prop.name === name
    && (argName === undefined || prop.arg?.content === argName))
  return found?.exp?.content?.trim()
}

const elements = astElements(sfc.descriptor.template.ast)
const byClass = (name) => elements.filter((node) => (staticAttr(node, 'class') ?? '').split(/\s+/).includes(name))
const singleByClass = (name) => {
  const found = byClass(name)
  assert.equal(found.length, 1, `模板中期望恰好一个 .${name}，实际 ${found.length}`)
  return found[0]
}

test('合同管理视图只有一个 <main>，并静态提供 id="main-content" 与 tabindex="-1"', () => {
  assert.equal((template.match(/<main[\s>]/g) ?? []).length, 1, '只允许一个 <main>')
  assert.equal((template.match(/<\/main>/g) ?? []).length, 1, '不允许出现第二个 </main>')
  assert.equal((template.match(/id="main-content"/g) ?? []).length, 1, 'id="main-content" 只能出现一次')

  const mains = elements.filter((node) => node.tag === 'main')
  assert.equal(mains.length, 1)
  assert.equal(staticAttr(mains[0], 'id'), 'main-content', '<main> 必须静态带 id="main-content"')
  assert.equal(directiveExpression(mains[0], 'bind', 'id'), undefined, '主区 id 不得改成运行时绑定')
  assert.equal(staticAttr(mains[0], 'tabindex'), '-1', '<main> 必须可编程聚焦（tabindex="-1"）')
})

test('合同管理导航只有当前页那一项带 aria-current="page"', () => {
  // 整份模板只允许一处 aria-current：多写一处就意味着非当前项也会被读屏念成「当前页」。
  assert.equal((template.match(/aria-current/g) ?? []).length, 1, 'aria-current 只能出现在当前页导航项上')

  const navItem = elements.filter((node) => (staticAttr(node, 'class') ?? '').split(/\s+/).includes('contract-nav'))
    .flatMap((nav) => astElements(nav.children).filter((node) => node.tag === 'button'))[0]
  assert.ok(navItem, '缺少合同导航项按钮')

  const nav = blockFromTemplate('class="contract-nav"')
  assert.match(nav, /:aria-current="activeSection === item\.key \? 'page' : undefined"/,
    '当前项输出 page，其余项省略属性（undefined 不渲染）')
  // 与 active 高亮口径必须一致，否则读屏「当前页」和视觉高亮会各说各话。
  assert.match(nav, /:class="\{ active: activeSection === item\.key \}"/)
})

test('合同管理汉堡按钮用 aria-expanded / aria-controls 关联抽屉侧栏', () => {
  const button = singleByClass('contract-menu-button')
  assert.equal(button.tag, 'button')
  assert.equal(directiveExpression(button, 'bind', 'aria-expanded'), "mobileMenuOpen ? 'true' : 'false'")
  assert.equal(staticAttr(button, 'aria-controls'), 'contract-sidebar', 'aria-controls 必须指向侧栏 id')

  const sidebar = singleByClass('contract-sidebar')
  assert.equal(sidebar.tag, 'aside')
  assert.equal(staticAttr(sidebar, 'id'), 'contract-sidebar', '抽屉侧栏必须有稳定 id 供 aria-controls 指向')
  assert.equal((template.match(/id="contract-sidebar"/g) ?? []).length, 1, '侧栏 id 必须唯一')
})

// blockFromTemplate 取模板中标记开始到下一个 </nav> 的片段，用于断言导航区的绑定表达式。
function blockFromTemplate(marker) {
  const start = template.indexOf(marker)
  assert.ok(start >= 0, `缺少 ${marker}`)
  const end = template.indexOf('</nav>', start)
  return template.slice(start, end === -1 ? undefined : end)
}

// 4. Esc 关闭抽屉并与共享外壳（AppShell）对齐：只在抽屉打开时生效，业务弹窗打开的 Esc
//    不被抢走，关闭后焦点交还汉堡按钮，且监听在挂载/卸载成对注册与移除。
test('抽屉支持 Esc 关闭、焦点交还汉堡按钮，且不与业务弹窗抢 Esc', () => {
  const script = sfc.descriptor.scriptSetup.content
  const handler = /function closeMenuOnEscape\(event\) \{([\s\S]*?)\n\}/.exec(script)
  assert.ok(handler, '缺少 closeMenuOnEscape 处理器')
  const body = handler[1]
  assert.match(body, /if \(!mobileMenuOpen\.value\) return/, '抽屉未打开时不得抢按键')
  assert.match(body, /defaultPrevented/, '已被业务弹窗处理的 Esc 不得重复响应')
  assert.match(body, /role="dialog"/, '有打开的弹窗时不得关闭抽屉')
  assert.match(body, /mobileMenuOpen\.value = false/, 'Esc 必须收起抽屉')
  assert.match(body, /menuButton\.value\?\.focus\?\.\(\)/, '收起后焦点必须交还汉堡按钮')

  // 汉堡按钮必须可被聚焦（ref 绑定）
  const hamburger = singleByClass('contract-menu-button')
  assert.equal(staticAttr(hamburger, 'ref'), 'menuButton', '汉堡按钮缺少 ref="menuButton"，Esc 后无法交还焦点')
  assert.match(script, /const menuButton = ref\(null\)/, '缺少 menuButton ref')

  // 注册/移除必须成对，避免离开视图后残留 document 监听
  const mounted = /onMounted\(async \(\) => \{([\s\S]*?)\n\}\)/.exec(script)
  const unmounted = /onBeforeUnmount\(\(\) => \{([\s\S]*?)\n\}\)/.exec(script)
  assert.ok(mounted?.[1].includes("document.addEventListener('keydown', closeMenuOnEscape)"), '挂载时未注册 Esc 监听')
  assert.ok(unmounted?.[1].includes("document.removeEventListener('keydown', closeMenuOnEscape)"), '卸载时未移除 Esc 监听')
})
