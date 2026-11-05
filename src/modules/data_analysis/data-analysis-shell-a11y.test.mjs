// 数据看板外壳的键盘 / 读屏可达性约定（定向修复，视图不迁移到 shared/AppShell.vue）。
//
// 锁定四件事：
// 1. 跳过导航链接（#main-content）的落点：<main> 静态带 id="main-content" 且可编程聚焦；
// 2. 汉堡按钮用 aria-expanded / aria-controls 关联抽屉侧栏；
// 3. Escape 收起抽屉并把焦点交还汉堡按钮，抽屉没开 / 弹窗占用按键时不抢按键；
// 4. 监听在 onMounted 注册、onBeforeUnmount 移除，模块切走后不再持有处理器。
//
// 第 3 条不是「源码里有这行」的文本断言：这里把视图里的 closeMenuOnEscape 原样取出执行，
// 用假的 document / ref 观察「抽屉关没关」「焦点落到哪」。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parse } from '@vue/compiler-sfc'

const source = readFileSync(new URL('./views/DashboardShellView.vue', import.meta.url), 'utf8')
const sfc = parse(source, { filename: 'DashboardShellView.vue' })
const template = sfc.descriptor.template.content
const script = sfc.descriptor.scriptSetup.content

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

// braceBlock 从标记位置起截取一个平衡的 { ... } 块（源码里的花括号由内容决定，不能用正则截断）。
function braceBlock(text, marker) {
  const start = text.indexOf(marker)
  assert.ok(start >= 0, `缺少 ${marker}`)
  const open = text.indexOf('{', start)
  let depth = 0
  for (let index = open; index < text.length; index += 1) {
    if (text[index] === '{') depth += 1
    else if (text[index] === '}') {
      depth -= 1
      if (depth === 0) return text.slice(start, index + 1)
    }
  }
  throw new Error(`未闭合的代码块：${marker}`)
}

const elements = astElements(sfc.descriptor.template.ast)
const byClass = (name) => elements.filter((node) => (staticAttr(node, 'class') ?? '').split(/\s+/).includes(name))
const singleByClass = (name) => {
  const found = byClass(name)
  assert.equal(found.length, 1, `模板中期望恰好一个 .${name}，实际 ${found.length}`)
  return found[0]
}

// fakeDocument 复刻抽屉处理器读到的两个位置：body.dataset 与打开中的 dialog。
function fakeDocument({ dialogOpen = false, confirmDialogOpen = false } = {}) {
  return {
    body: { dataset: confirmDialogOpen ? { confirmDialogOpen: 'true' } : {} },
    querySelector(selector) {
      return dialogOpen && selector === '[role="dialog"]' ? { role: 'dialog' } : null
    },
  }
}

const handlerSource = braceBlock(script, 'function closeMenuOnEscape(')
// 用参数遮蔽全局 document，让取出的真实源码在 node 里跑；等于把处理器原样搬进测试。
const createHandler = () => new Function('mobileMenuOpen', 'menuButton', 'document', `return ${handlerSource}`)

function runHandler({ open = true, options = {}, event = {} } = {}) {
  const mobileMenuOpen = { value: open }
  const focused = []
  const menuButton = { value: { focus: () => focused.push('menu') } }
  const handler = createHandler()(mobileMenuOpen, menuButton, fakeDocument(options))
  handler({ key: 'Escape', ...event })
  return { open: mobileMenuOpen.value, focused }
}

test('数据看板视图只有一个 <main>，并静态提供 id="main-content" 与 tabindex="-1"', () => {
  assert.equal((template.match(/<main[\s>]/g) ?? []).length, 1, '只允许一个 <main>')
  assert.equal((template.match(/<\/main>/g) ?? []).length, 1, '不允许出现第二个 </main>')
  assert.equal((template.match(/id="main-content"/g) ?? []).length, 1, 'id="main-content" 只能出现一次')

  const mains = elements.filter((node) => node.tag === 'main')
  assert.equal(mains.length, 1)
  assert.equal(staticAttr(mains[0], 'id'), 'main-content', '<main> 必须静态带 id="main-content"')
  assert.equal(directiveExpression(mains[0], 'bind', 'id'), undefined, '主区 id 不得改成运行时绑定')
  assert.equal(staticAttr(mains[0], 'tabindex'), '-1', '<main> 必须可编程聚焦（tabindex="-1"）')
})

test('数据看板汉堡按钮用 aria-expanded / aria-controls 关联抽屉侧栏', () => {
  const button = singleByClass('da-menu-button')
  assert.equal(button.tag, 'button')
  assert.equal(directiveExpression(button, 'bind', 'aria-expanded'), "mobileMenuOpen ? 'true' : 'false'")
  assert.equal(staticAttr(button, 'aria-controls'), 'da-sidebar', 'aria-controls 必须指向侧栏 id')
  assert.equal(staticAttr(button, 'ref'), 'menuButton', '汉堡按钮需要 ref 作为焦点落脚点')

  const sidebar = singleByClass('da-sidebar')
  assert.equal(sidebar.tag, 'aside')
  assert.equal(staticAttr(sidebar, 'id'), 'da-sidebar', '抽屉侧栏必须有稳定 id 供 aria-controls 指向')
  assert.equal((template.match(/id="da-sidebar"/g) ?? []).length, 1, '侧栏 id 必须唯一')
})

test('Escape 收起打开的抽屉并把焦点交还汉堡按钮', () => {
  assert.deepEqual(runHandler({ open: true }), { open: false, focused: ['menu'] })
  // 老浏览器 / 部分 IME 上报 Esc 而不是 Escape。
  assert.deepEqual(runHandler({ open: true, event: { key: 'Esc' } }), { open: false, focused: ['menu'] })
})

test('抽屉没打开时 Escape 不抢按键、也不搬走焦点', () => {
  assert.deepEqual(runHandler({ open: false }), { open: false, focused: [] })
})

test('非 Escape 按键不影响抽屉', () => {
  for (const key of ['Enter', 'Tab', ' ', 'ArrowDown']) {
    assert.deepEqual(runHandler({ open: true, event: { key } }), { open: true, focused: [] }, `${key} 不得关闭抽屉`)
  }
})

test('弹窗占用同一个 Escape 时抽屉不关闭、焦点不跳走', () => {
  // 已处理的按键（弹窗先 preventDefault）。
  assert.deepEqual(runHandler({ open: true, event: { defaultPrevented: true } }), { open: true, focused: [] })
  // 共享确认框 / 提示框打开的标记。
  assert.deepEqual(runHandler({ open: true, options: { confirmDialogOpen: true } }), { open: true, focused: [] })
  // 页面里还有 role="dialog" 的浮层（例如指标卡设置）。
  assert.deepEqual(runHandler({ open: true, options: { dialogOpen: true } }), { open: true, focused: [] })
})

test('Escape 监听在挂载时注册、卸载时移除', () => {
  const mounted = braceBlock(script, 'onMounted(async () => {')
  assert.match(mounted, /document\.addEventListener\("keydown", closeMenuOnEscape\)/,
    'Escape 必须挂在 document 上：焦点在遮罩 / 侧栏里时事件不会冒泡到根节点')

  const unmounted = braceBlock(script, 'onBeforeUnmount(() => {')
  assert.match(unmounted, /document\.removeEventListener\("keydown", closeMenuOnEscape\)/,
    '卸载时必须移除同一个处理器，否则模块切走后仍会改动已卸载的抽屉状态')

  // 注册与移除必须成对引用同一个处理器，且整份脚本只有这一对。
  assert.equal((script.match(/"keydown", closeMenuOnEscape/g) ?? []).length, 2)
})

test('抽屉状态仍由本页 mobileMenuOpen 持有，未被搬进共享外壳', () => {
  assert.match(script, /import \{[^}]*onMounted[^}]*\} from "vue"/)
  assert.match(script, /const mobileMenuOpen = ref\(false\)/)
  assert.doesNotMatch(source, /AppShell/)
  assert.match(template, /<aside id="da-sidebar" class="da-sidebar" :class="\{ open: mobileMenuOpen \}">/)
})
