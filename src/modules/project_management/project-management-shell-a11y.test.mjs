// 项目管理外壳的键盘 / 读屏可达性约定（定向修复，视图不迁移到 shared/AppShell.vue）。
//
// 锁定四件事，任何一项被改回都会失败：
// 1. 跳过导航链接（#main-content）的落点：<main> 静态带 id="main-content" 且可编程聚焦；
// 2. 汉堡按钮与抽屉侧栏的控制关系：aria-expanded 跟随 mobileMenuOpen，aria-controls 指向侧栏 id；
// 3. Escape 收起抽屉后焦点回到汉堡按钮，避免焦点留在已隐藏的侧栏里；
// 4. 模板里仍然只有一个 <main>，不因这次修复多出第二个主区。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parse } from '@vue/compiler-sfc'

const source = readFileSync(new URL('./views/ProjectManagementView.vue', import.meta.url), 'utf8')
const sfc = parse(source, { filename: 'ProjectManagementView.vue' })
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

// blockAfter 取标记后的第一个 { ... } 平衡块：模板里 ({ 与 }) 都可能出现，不能用正则截断。
function blockAfter(marker) {
  const start = source.indexOf(marker)
  assert.ok(start >= 0, `缺少 ${marker}`)
  const open = source.indexOf('{', start)
  let depth = 0
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1
    else if (source[index] === '}') {
      depth -= 1
      if (depth === 0) return source.slice(start, index + 1)
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

test('项目管理视图只有一个 <main>，并静态提供 id="main-content" 与 tabindex="-1"', () => {
  assert.equal((template.match(/<main[\s>]/g) ?? []).length, 1, '只允许一个 <main>')
  assert.equal((template.match(/<\/main>/g) ?? []).length, 1, '不允许出现第二个 </main>')
  assert.equal((template.match(/id="main-content"/g) ?? []).length, 1, 'id="main-content" 只能出现一次')

  const mains = elements.filter((node) => node.tag === 'main')
  assert.equal(mains.length, 1)
  // 静态属性（而不是运行时绑定）才能保证首屏解析完 skip link 就已经有落点。
  assert.equal(staticAttr(mains[0], 'id'), 'main-content', '<main> 必须静态带 id="main-content"')
  assert.equal(directiveExpression(mains[0], 'bind', 'id'), undefined, '主区 id 不得改成运行时绑定')
  assert.equal(staticAttr(mains[0], 'tabindex'), '-1', '<main> 必须可编程聚焦（tabindex="-1"）')
})

test('项目管理汉堡按钮用 aria-expanded / aria-controls 关联抽屉侧栏', () => {
  const button = singleByClass('pm-menu-button')
  assert.equal(button.tag, 'button')
  assert.equal(directiveExpression(button, 'bind', 'aria-expanded'), "mobileMenuOpen ? 'true' : 'false'")
  assert.equal(staticAttr(button, 'aria-controls'), 'pm-sidebar', 'aria-controls 必须指向侧栏 id')

  const sidebar = singleByClass('pm-sidebar')
  assert.equal(sidebar.tag, 'aside')
  assert.equal(staticAttr(sidebar, 'id'), 'pm-sidebar', '抽屉侧栏必须有稳定 id 供 aria-controls 指向')
  assert.equal((template.match(/id="pm-sidebar"/g) ?? []).length, 1, '侧栏 id 必须唯一')
})

test('项目管理 Escape 收起抽屉后把焦点交还汉堡按钮', () => {
  const button = singleByClass('pm-menu-button')
  assert.equal(staticAttr(button, 'ref'), 'mobileMenuButton', '汉堡按钮需要 ref 作为焦点落脚点')
  assert.match(script, /const mobileMenuButton = ref\(null\)/, '必须声明汉堡按钮引用')

  // 关闭顺序：先收起抽屉，再把焦点交给汉堡按钮，最后返回 true 表示这次按键已被消费。
  const overlay = blockAfter('function closeActiveOverlay()')
  assert.match(
    overlay,
    /if \(mobileMenuOpen\.value\) \{ mobileMenuOpen\.value = false; mobileMenuButton\.value\?\.focus\?\.\(\); return true \}/,
    'Escape 收起抽屉后必须把焦点交还汉堡按钮',
  )
  // Escape 入口仍然是同一个全局处理器，且遮罩关闭不抢焦点。
  assert.match(blockAfter('function onGlobalKeydown(event)'), /if \(closeActiveOverlay\(\)\) event\.preventDefault\(\)/)
  assert.equal((template.match(/mobileMenuOpen = false/g) ?? []).length >= 1, true)
  assert.match(template, /class="pm-menu-mask" @click="mobileMenuOpen = false"/, '遮罩点击只收起抽屉，不移动焦点')
})
