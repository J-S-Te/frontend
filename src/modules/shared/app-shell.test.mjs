import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import * as Vue from 'vue'
import { h } from 'vue'
import { createRenderer } from '@vue/runtime-core'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'

// 共享外壳 AppShell.vue 的回归测试。
//
// 外壳把「侧栏 / 顶栏 / 主区 / 抽屉遮罩」从各模块视图收敛到一处，因此这里的断言分三层：
// 1. 模板 AST（compiler-sfc parse）：结构约束（唯一 <main>、<aside> 先闭合、遮罩在主区之后、
//    插槽集合、受控属性绑定），改模板就会失败，不依赖代码格式。
// 2. 真实渲染（runtime-core 自定义 renderer 挂载 + 真实点击）：导航分组 / 可见性 / 事件载荷，
//    能抓住「过滤逻辑被删」「事件参数被改」「必填属性丢失」这类语义回归。
// 3. 迁移视图守卫：PlatformConsoleView.vue 不得把 console 壳层类名搬回来。
//
// 说明：本仓库测试不引入 jsdom，已有用例多以源码文本或 compiler-sfc 断言；这里用
// runtime-core 的 createRenderer 挂载到纯对象宿主树，既能断言渲染结果又能派发真实点击，
// 不依赖浏览器环境。

const SRC = new URL('../../', import.meta.url).pathname
const SHELL_FILE = fileURLToPath(new URL('./components/AppShell.vue', import.meta.url))
const VIEW_FILE = new URL('../platform/views/PlatformConsoleView.vue', import.meta.url)
const CONSOLE_CSS_FILE = new URL('../platform/styles/console.css', import.meta.url)

const shellSource = readFileSync(SHELL_FILE, 'utf8')
const viewSource = readFileSync(VIEW_FILE, 'utf8')
const consoleCss = readFileSync(CONSOLE_CSS_FILE, 'utf8')

const shellSfc = parse(shellSource, { filename: SHELL_FILE })
const shellTemplate = shellSfc.descriptor.template.content
const shellAst = shellSfc.descriptor.template.ast
const viewSfc = parse(viewSource, { filename: 'PlatformConsoleView.vue' })
const viewAst = viewSfc.descriptor.template.ast

// ---------------------------------------------------------------------------
// SFC 加载（沿用仓库既有做法：compiler-sfc 编译 + 手工解析依赖）
// ---------------------------------------------------------------------------

const sfcCache = new Map()

async function resolveDependency(fromFile, specifier) {
  if (specifier === 'vue') return Vue
  const base = specifier.startsWith('.') ? resolve(dirname(fromFile), specifier) : join(SRC, specifier.slice(2))
  if (specifier.endsWith('.vue')) return loadSfc(base)
  for (const candidate of [base, `${base}.js`, join(base, 'index.js')]) {
    try {
      return await import(pathToFileURL(candidate).href)
    } catch (error) {
      if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error
    }
  }
  throw new Error(`cannot resolve ${specifier}`)
}

async function loadSfc(file) {
  if (sfcCache.has(file)) return sfcCache.get(file)
  const { descriptor } = parse(readFileSync(file, 'utf8'), { filename: file })
  const script = compileScript(descriptor, { id: file })
  const compiled = compileTemplate({
    source: descriptor.template.content,
    filename: file,
    id: file,
    compilerOptions: { bindingMetadata: script.bindings },
  })
  assert.deepEqual(compiled.errors, [], file)
  const imports = {}
  for (const node of script.scriptSetupAst.filter((item) => item.type === 'ImportDeclaration')) {
    const dependency = await resolveDependency(file, node.source.value)
    for (const spec of node.specifiers) {
      imports[spec.local.name] = spec.type === 'ImportDefaultSpecifier'
        ? (dependency.default ?? dependency)
        : dependency[spec.imported.name]
    }
  }
  // compileScript 会为 defineModel 等宏注入 `import { useModel as _useModel } from 'vue'`；
  // 这些不在原始 AST 中，须从 Vue 补齐，否则下方剥掉 import 后帮助函数未定义。
  for (const match of script.content.matchAll(/import \{([^}]+)\} from ['"]vue['"]/g)) {
    for (const part of match[1].split(',')) {
      const [imported, local = imported] = part.trim().split(/\s+as\s+/)
      if (imported && !(local in imports)) imports[local] = Vue[imported]
    }
  }
  const component = new Function(...Object.keys(imports), script.content
    .replace(/^import\s[\s\S]*?from ['"][^'"]+['"]\n/gm, '')
    .replace('export default', 'return'))(...Object.values(imports))
  component.render = new Function('Vue', compiled.code
    .replace(/import \{([^}]+)\} from "vue"/g, (_, names) => `const { ${names.replace(/ as /g, ': ')} } = Vue`)
    .replace('export function render', 'return function render'))(Vue)
  sfcCache.set(file, component)
  return component
}

// 外壳 SFC 只编译一次（含递归加载 ConsoleIcon.vue），后续用例复用同一组件对象。
const AppShell = await loadSfc(SHELL_FILE)

// ---------------------------------------------------------------------------
// 纯对象宿主 renderer：渲染真实 vnode 树并允许调用 onClick 派发点击
// ---------------------------------------------------------------------------

function createHostNode(tag, text = '') {
  return { tag, text, children: [], props: {}, parent: null }
}

const hostOps = {
  patchProp(el, key, previous, next) {
    if (next === undefined || next === null) delete el.props[key]
    else el.props[key] = next
  },
  insert(child, parent, anchor = null) {
    if (child.parent) {
      const siblings = child.parent.children
      const current = siblings.indexOf(child)
      if (current >= 0) siblings.splice(current, 1)
    }
    child.parent = parent
    const at = anchor ? parent.children.indexOf(anchor) : -1
    if (at >= 0) parent.children.splice(at, 0, child)
    else parent.children.push(child)
  },
  remove(child) {
    const siblings = child.parent?.children
    if (!siblings) return
    const at = siblings.indexOf(child)
    if (at >= 0) siblings.splice(at, 1)
    child.parent = null
  },
  createElement: (tag) => createHostNode(tag),
  createText: (text) => createHostNode('#text', text),
  createComment: (text) => createHostNode('#comment', text),
  setText(node, text) { node.text = text },
  setElementText(node, text) { node.text = text; node.children = [] },
  parentNode: (node) => node.parent ?? null,
  nextSibling(node) {
    const siblings = node.parent?.children ?? []
    const at = siblings.indexOf(node)
    return at >= 0 ? siblings[at + 1] ?? null : null
  },
  querySelector: () => null,
  setScopeId() {},
  cloneNode: (node) => createHostNode(node.tag, node.text),
  insertStaticContent(content, parent, anchor) {
    const node = createHostNode('#static', content)
    hostOps.insert(node, parent, anchor)
    return [node, node]
  },
}

const { createApp } = createRenderer(hostOps)

function walkVNodes(vnode, visit) {
  if (!vnode || typeof vnode !== 'object') return
  if (Array.isArray(vnode)) {
    for (const child of vnode) walkVNodes(child, visit)
    return
  }
  visit(vnode)
  if (vnode.component) walkVNodes(vnode.component.subTree, visit)
  if (Array.isArray(vnode.children)) for (const child of vnode.children) walkVNodes(child, visit)
}

function classTokens(vnode) {
  const value = vnode?.props?.class
  const text = Array.isArray(value) ? value.join(' ') : String(value ?? '')
  return text.split(/\s+/).filter(Boolean)
}

function textOf(vnode) {
  if (typeof vnode === 'string') return vnode
  if (!vnode || typeof vnode !== 'object') return ''
  let out = ''
  if (vnode.component) out += textOf(vnode.component.subTree)
  // 插值文本在 vnode 上是字符串 children（createTextVNode / setElementText 路径），必须一并收集。
  if (typeof vnode.children === 'string') out += vnode.children
  else if (Array.isArray(vnode.children)) for (const child of vnode.children) out += textOf(child)
  return out
}

function renderShell(props = {}, slots = {}) {
  const container = createHostNode('#root')
  const app = createApp({ name: 'ShellHost', render: () => h(AppShell, props, slots) })
  app.mount(container)
  const vnodes = []
  walkVNodes(app._instance.subTree, (vnode) => vnodes.push(vnode))
  const elements = vnodes.filter((vnode) => typeof vnode.type === 'string')
  const byClass = (name) => elements.filter((vnode) => classTokens(vnode).includes(name))
  const byTag = (name) => elements.filter((vnode) => vnode.type === name)
  const oneByClass = (name) => {
    const found = byClass(name)
    assert.equal(found.length, 1, `期望恰好一个 .${name}，实际 ${found.length}`)
    return found[0]
  }
  return {
    app,
    vnodes,
    elements,
    byClass,
    byTag,
    oneByClass,
    // 宿主节点记录了 parent，可据此断言真实祖先关系（而不只靠文档顺序推断归属）。
    inside: (vnode, ancestor) => {
      let node = vnode?.el?.parent ?? null
      while (node) {
        if (node === ancestor?.el) return true
        node = node.parent
      }
      return false
    },
    text: () => textOf(app._instance.subTree),
    click: (vnode, event = {}) => {
      assert.equal(typeof vnode?.props?.onClick, 'function', `${classTokens(vnode).join('.')} 缺少点击处理器`)
      vnode.props.onClick(event)
    },
  }
}

function clickElement(shell, selector, label = '') {
  const target = shell.elements.find((vnode) => (
    classTokens(vnode).includes(selector) && (!label || textOf(vnode).includes(label))
  ))
  assert.ok(target, `未找到可点击元素 .${selector}${label ? `（${label}）` : ''}`)
  shell.click(target)
  return target
}

// ---------------------------------------------------------------------------
// 模板 AST 工具
// ---------------------------------------------------------------------------

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

function directive(node, name, argName) {
  return node.props.find((prop) => prop.type === 7 && prop.name === name
    && (argName === undefined || prop.arg?.content === argName))
}

function directiveExpression(node, name, argName) {
  const found = directive(node, name, argName)
  return found?.exp?.content?.trim()
}

function astClassTokens(node) {
  return (staticAttr(node, 'class') ?? '').split(/\s+/).filter(Boolean)
}

const shellElements = astElements(shellAst)
const elementByClass = (name) => shellElements.filter((node) => astClassTokens(node).includes(name))
const singleElementByClass = (name) => {
  const found = elementByClass(name)
  assert.equal(found.length, 1, `模板中期望恰好一个 .${name}，实际 ${found.length}`)
  return found[0]
}

const documentedProps = [
  'pageClass', 'sidebarClass', 'brandClass', 'navClass', 'sidebarUserClass', 'mainClass',
  'topbarClass', 'contentClass', 'mainId', 'menuOpen', 'navLabel', 'navGroups', 'navEmpty',
  'brandName', 'brandSubtitle', 'brandIcon', 'crumb', 'topbarAvatar', 'userName', 'userRole',
  'avatarText', 'logoutLabel', 'logoutDisabled', 'sidebarBaseClass', 'mainBaseClass',
]

const documentedSlots = [
  'default', 'brand', 'nav', 'nav-extra', 'nav-empty', 'sidebar-note', 'sidebar-user',
  'breadcrumb', 'topbar-center', 'topbar-actions', 'main-prefix', 'page-head', 'overlay',
]

const NAV_GROUPS = [
  { items: [{ key: 'portal', label: '返回子系统门户', icon: 'dashboard', itemClass: 'console-nav-item--portal' }] },
  {
    label: '系统管理',
    items: [
      { key: 'settings', label: '系统设置', icon: 'settings', active: true, title: '打开系统设置' },
      { key: 'audit', label: '审计日志', icon: 'audit', note: '只读' },
      { key: 'hidden', label: '不可见模块', icon: 'shield', visible: false },
    ],
  },
]

function navItemButtons(shell) {
  return shell.byClass('console-nav-item')
}

// ===========================================================================
// 1. 外壳结构：唯一 <main> / <aside>，遮罩只在抽屉打开且位于 </main> 之后
// ===========================================================================

test('外壳模板只有一个 <main> 和一个 <aside>，<aside> 在 <main> 前闭合', () => {
  assert.equal((shellTemplate.match(/<main[\s>]/g) ?? []).length, 1, '只允许一个 <main>')
  assert.equal((shellTemplate.match(/<\/main>/g) ?? []).length, 1, '不允许出现第二个 </main>')
  assert.equal((shellTemplate.match(/<aside[\s>]/g) ?? []).length, 1, '只允许一个 <aside>')
  assert.equal((shellTemplate.match(/<\/aside>/g) ?? []).length, 1, '不允许出现第二个 </aside>')

  const main = shellElements.filter((node) => node.tag === 'main')
  const aside = shellElements.filter((node) => node.tag === 'aside')
  assert.equal(main.length, 1)
  assert.equal(aside.length, 1)
  // aside.loc.end.offset 是 `</aside>` 之后的位置：侧栏必须整体在 <main> 开始前闭合，不能嵌进主区。
  assert.ok(aside[0].loc.end.offset < main[0].loc.start.offset, '侧栏必须在 <main> 开始前闭合')

  // 跳过导航链接的落点必须稳定存在：id 绑定 mainId（默认 main-content），且可聚焦。
  assert.equal(directiveExpression(main[0], 'bind', 'id'), 'mainId')
  assert.equal(staticAttr(main[0], 'tabindex'), '-1')
  assert.match(shellSfc.descriptor.scriptSetup.content, /mainId: \{ type: String, default: 'main-content' \}/)
})

test('外壳渲染后仍然只有一个 <main> 与一个 <aside>，main 的 id/tabindex 来自外壳而非视图', () => {
  const shell = renderShell({ mainId: 'shell-main', pageClass: 'platform-console' })
  const mains = shell.byTag('main')
  const asides = shell.byTag('aside')
  assert.equal(mains.length, 1, '渲染结果只能有一个 <main>')
  assert.equal(asides.length, 1, '渲染结果只能有一个 <aside>')
  assert.equal(mains[0].props.id, 'shell-main')
  assert.equal(mains[0].props.tabindex, '-1')
  assert.ok(classTokens(asides[0]).includes('console-sidebar'))
  // 侧栏先于主区（DOM 顺序），保证键盘顺序与抽屉层级一致。
  assert.ok(shell.elements.indexOf(asides[0]) < shell.elements.indexOf(mains[0]))

  const defaults = renderShell()
  assert.equal(defaults.byTag('main')[0].props.id, 'main-content', 'mainId 默认值必须是 main-content')
})

test('抽屉遮罩受 menuOpen 控制，且渲染在 </main> 之后（不属于主区）', () => {
  const main = shellElements.filter((node) => node.tag === 'main')[0]
  const mask = singleElementByClass('console-menu-mask')
  assert.equal(mask.tag, 'button', '遮罩必须是可点击按钮，键盘/触屏都能关闭抽屉')
  assert.equal(staticAttr(mask, 'type'), 'button')
  assert.equal(directiveExpression(mask, 'if'), 'menuOpen', '遮罩必须由 v-if="menuOpen" 控制')
  assert.ok(mask.loc.start.offset > main.loc.end.offset, '遮罩必须出现在 </main> 之后')
  assert.match(directiveExpression(mask, 'on', 'click') ?? '', /setMenuOpen\(false\)/)

  // 渲染层：关闭时完全不渲染遮罩（不是 display:none 的残留节点），打开时恰好一个。
  const closed = renderShell({ menuOpen: false })
  assert.equal(closed.byClass('console-menu-mask').length, 0, 'menuOpen=false 时不得渲染遮罩')

  const opened = renderShell({ menuOpen: true })
  assert.equal(opened.byClass('console-menu-mask').length, 1, 'menuOpen=true 时必须渲染遮罩')
  const openedMain = opened.byTag('main')[0]
  const openedMask = opened.byClass('console-menu-mask')[0]
  assert.ok(opened.elements.indexOf(openedMask) > opened.elements.indexOf(openedMain), '遮罩必须排在主区之后')
})

test('遮罩与抽屉断点绑定 console.css：桌面隐藏，≤820px 才显示且侧栏变抽屉', () => {
  const mediaStart = consoleCss.indexOf('@media (max-width: 820px) {')
  assert.ok(mediaStart >= 0, 'console.css 必须保留 ≤820px 抽屉断点')
  // 取该 media 块的配对右括号，限制断言范围，避免误匹配其他断点。
  let depth = 0
  let mediaEnd = mediaStart
  for (let index = consoleCss.indexOf('{', mediaStart); index < consoleCss.length; index += 1) {
    if (consoleCss[index] === '{') depth += 1
    else if (consoleCss[index] === '}') {
      depth -= 1
      if (depth === 0) { mediaEnd = index; break }
    }
  }
  const media = consoleCss.slice(mediaStart, mediaEnd)
  const baseMask = /\.console-menu-mask\s*\{([^}]*)\}/.exec(consoleCss)
  assert.ok(baseMask, '缺少 .console-menu-mask 基础规则')
  assert.match(baseMask[1], /display:\s*none/, '桌面端遮罩必须隐藏')
  assert.match(media, /\.console-menu-mask\s*\{[^}]*display:\s*block/, '≤820px 时遮罩必须显示')
  assert.match(media, /\.console-sidebar\s*\{[^}]*transform:\s*translateX\(-100%\)/, '≤820px 侧栏必须收敛为抽屉')
  assert.match(media, /\.console-sidebar\.open\s*\{[^}]*transform:\s*translateX\(0\)/, '抽屉打开依赖 .open 类，外壳用 menuOpen 绑定')
})

// ===========================================================================
// 2. 导航渲染：分组标题 / visible 过滤 / active / note / itemClass / nav-empty
// ===========================================================================

test('导航分组只在有 label 时渲染标题，且按分组顺序输出导航项', () => {
  const shell = renderShell({ navGroups: NAV_GROUPS })
  const labels = shell.byClass('console-nav-label')
  assert.equal(labels.length, 1, '只有带 label 的分组才渲染分组标题')
  assert.equal(textOf(labels[0]).trim(), '系统管理')

  const labels2 = shell.byClass('console-nav-item').map((vnode) => {
    const span = vnode.children.find((child) => typeof child === 'object' && child.type === 'span')
    return textOf(span).trim()
  })
  assert.deepEqual(labels2, ['返回子系统门户', '系统设置', '审计日志'], '导航项顺序必须与 navGroups 一致')
})

test('visible:false 的导航项不渲染（等价于模块自己的权限 v-if）', () => {
  const shell = renderShell({ navGroups: NAV_GROUPS })
  assert.ok(!shell.text().includes('不可见模块'), 'visible:false 的导航项不得出现在渲染结果中')
  assert.equal(navItemButtons(shell).length, 3)
})

test('active / note / itemClass / title 映射到文档约定的类与属性', () => {
  const shell = renderShell({ navGroups: NAV_GROUPS })
  const [portal, settings, audit] = navItemButtons(shell)

  assert.ok(classTokens(portal).includes('console-nav-item--portal'), 'itemClass 必须落到导航项类名')
  assert.ok(classTokens(portal).includes('console-nav-item'))
  assert.ok(!classTokens(portal).includes('active'))

  assert.ok(classTokens(settings).includes('active'), 'active:true 必须渲染 .active')
  assert.equal(settings.props.title, '打开系统设置', 'title 必须转发到 DOM title')
  assert.ok(!classTokens(audit).includes('active'))
  assert.equal(audit.props.title, undefined, '没有 title 的项不能渲染空 title 属性')

  const notes = shell.byClass('console-nav-note')
  assert.equal(notes.length, 1, 'note 只渲染成一个小标签')
  assert.equal(textOf(notes[0]).trim(), '只读')
})

test('没有可见导航项时展示 nav-empty 提示块，带可见项时不展示', () => {
  const empty = renderShell({ navGroups: [] })
  const emptyBlocks = empty.byClass('console-nav-empty')
  assert.equal(emptyBlocks.length, 1)
  assert.match(textOf(emptyBlocks[0]), /当前账号没有可访问的菜单模块/)

  // 全部 visible:false 等于「没有任何可见导航项」。
  const allHidden = renderShell({
    navGroups: [{ label: '系统管理', items: [{ key: 'a', label: 'A', visible: false }] }],
  })
  assert.equal(navItemButtons(allHidden).length, 0)
  assert.equal(allHidden.byClass('console-nav-empty').length, 1)
  assert.equal(allHidden.byClass('console-nav-label').length, 0, '空分组不应残留标题')

  const filled = renderShell({ navGroups: NAV_GROUPS })
  assert.equal(filled.byClass('console-nav-empty').length, 0)

  // navEmpty 显式置 true 时即使有可见项也展示提示块（平台控制台「门户」项常驻，用它表达无权限）。
  const forced = renderShell({ navGroups: NAV_GROUPS, navEmpty: true })
  assert.equal(forced.byClass('console-nav-empty').length, 1)
  assert.equal(navItemButtons(forced).length, 3, '展示提示块不能吞掉可见导航项')
})

test('nav-empty / nav-extra 插槽可替换默认提示与追加侧栏内容', () => {
  const shell = renderShell({ navGroups: [] }, {
    'nav-empty': () => '当前账号未配置系统管理模块的访问权限。',
    'nav-extra': () => h('div', { class: 'custom-nav-extra' }, '自定义入口'),
  })
  const emptyBlock = shell.oneByClass('console-nav-empty')
  assert.equal(textOf(emptyBlock), '当前账号未配置系统管理模块的访问权限。')
  assert.ok(!textOf(emptyBlock).includes('当前账号没有可访问的菜单模块'), '插槽内容必须替换默认文案')
  assert.equal(shell.oneByClass('custom-nav-extra').props.class, 'custom-nav-extra')
})

// ===========================================================================
// 3. 侧栏页脚 / 品牌 / 可链接片段遵守文档属性
// ===========================================================================

test('品牌区、面包屑、账号头像与退出按钮按属性渲染', () => {
  const shell = renderShell({
    brandName: '基础能力平台',
    brandSubtitle: 'Basic Platform',
    crumb: '审计日志',
    userName: '张管理',
    userRole: '平台管理员',
    avatarText: '张管',
    topbarAvatar: true,
  })
  const brand = shell.oneByClass('console-brand')
  assert.match(textOf(brand), /基础能力平台/)
  assert.match(textOf(brand), /Basic Platform/)
  assert.equal(shell.byClass('console-brand-mark').length, 1, '默认品牌区必须有图标落点')

  const crumb = shell.oneByClass('console-crumb')
  assert.match(textOf(crumb), /基础能力平台/)
  assert.match(textOf(crumb), /审计日志/)
  assert.equal(shell.byClass('console-topbar-avatar').length, 1)
  assert.equal(textOf(shell.oneByClass('console-topbar-avatar')).trim(), '张管')

  const user = shell.oneByClass('console-sidebar-user')
  assert.match(textOf(user), /张管理/)
  assert.match(textOf(user), /平台管理员/)
  assert.equal(textOf(shell.oneByClass('console-avatar')).trim(), '张管')
})

test('avatarText 缺省时按 ASCII 取 2 位、中文取 1 位，未登录时给出兜底', () => {
  const ascii = renderShell({ userName: 'admin', topbarAvatar: true })
  assert.equal(textOf(ascii.oneByClass('console-topbar-avatar')).trim(), 'AD')
  const chinese = renderShell({ userName: '张管理', topbarAvatar: true })
  assert.equal(textOf(chinese.oneByClass('console-topbar-avatar')).trim(), '张')
  const anonymous = renderShell({ topbarAvatar: true })
  assert.equal(textOf(anonymous.oneByClass('console-topbar-avatar')).trim(), '用')
  assert.equal(anonymous.byClass('console-sidebar-user').length, 0, '没有账号信息时不渲染侧栏用户区')
})

test('面包屑 crumb 为空时不留空 <strong>，品牌名仍然可读', () => {
  const shell = renderShell({ brandName: '基础能力平台' })
  const crumb = shell.oneByClass('console-crumb')
  assert.equal(crumb.children.filter((child) => child?.type === 'strong').length, 0)
  assert.match(textOf(crumb), /基础能力平台/)
})

test('logoutLabel / logoutDisabled 落到退出按钮的 aria-label 与 disabled', () => {
  const defaults = renderShell({ userName: '张管理' })
  const button = defaults.oneByClass('console-logout')
  assert.equal(button.props['aria-label'], '退出应用系统')
  assert.notEqual(button.props.disabled, true)

  const custom = renderShell({ userName: '张管理', logoutLabel: '正在退出…', logoutDisabled: true })
  const customButton = custom.oneByClass('console-logout')
  assert.equal(customButton.props['aria-label'], '正在退出…')
  assert.equal(customButton.props.disabled, true, 'logoutDisabled 必须阻止重复点击退出')
})

test('sidebar-user 插槽整体替换默认用户区（含退出按钮）', () => {
  const shell = renderShell({ userName: '张管理' }, {
    'sidebar-user': () => h('div', { class: 'custom-sidebar-user' }, '自定义用户区'),
  })
  assert.equal(shell.oneByClass('custom-sidebar-user').props.class, 'custom-sidebar-user')
  assert.equal(shell.byClass('console-logout').length, 0, '插槽替换后不再渲染默认退出按钮')
  assert.ok(!textOf(shell.oneByClass('console-sidebar-user')).includes('张管理'))
})

test('各区块附加类名属性落到对应元素，不污染其他区块', () => {
  const shell = renderShell({
    pageClass: 'platform-console',
    sidebarClass: 'platform-sidebar',
    brandClass: 'platform-brand',
    navClass: 'platform-nav',
    sidebarUserClass: 'platform-user',
    mainClass: 'platform-main',
    topbarClass: 'platform-topbar',
    contentClass: 'platform-content',
    userName: '张管理',
    navLabel: '平台导航',
  })
  assert.ok(classTokens(shell.oneByClass('console-page')).includes('platform-console'))
  assert.ok(classTokens(shell.oneByClass('console-sidebar')).includes('platform-sidebar'))
  assert.ok(classTokens(shell.oneByClass('console-brand')).includes('platform-brand'))
  const nav = shell.oneByClass('console-nav')
  assert.ok(classTokens(nav).includes('platform-nav'))
  assert.equal(nav.props['aria-label'], '平台导航', 'navLabel 必须是 <nav> 的可访问名称')
  assert.ok(classTokens(shell.oneByClass('console-sidebar-user')).includes('platform-user'))
  assert.ok(classTokens(shell.byTag('main')[0]).includes('platform-main'))
  assert.ok(classTokens(shell.oneByClass('console-topbar')).includes('platform-topbar'))
  assert.ok(classTokens(shell.oneByClass('console-content')).includes('platform-content'))
  assert.equal(shell.oneByClass('console-page').props.class.includes('platform-sidebar'), false)
})

// ===========================================================================
// 4. 事件：导航点击 / 遮罩 / 关闭按钮 / 退出
// ===========================================================================

function recordEvents() {
  const events = []
  return {
    events,
    props: {
      onNavigate: (key, item) => events.push({ type: 'navigate', key, item }),
      'onUpdate:menuOpen': (value) => events.push({ type: 'update:menuOpen', value }),
      onLogout: () => events.push({ type: 'logout' }),
    },
  }
}

test('点击导航项先收起抽屉再抛出 navigate(key, item)', () => {
  const recorder = recordEvents()
  const shell = renderShell({ navGroups: NAV_GROUPS, menuOpen: true, ...recorder.props })
  clickElement(shell, 'console-nav-item', '审计日志')

  assert.deepEqual(recorder.events.map((event) => event.type), ['update:menuOpen', 'navigate'])
  assert.equal(recorder.events[0].value, false)
  assert.equal(recorder.events[1].key, 'audit')
  assert.equal(recorder.events[1].item.label, '审计日志')
})

test('抽屉已关闭时导航只抛出 navigate，不重复 emit update:menuOpen', () => {
  const recorder = recordEvents()
  const shell = renderShell({ navGroups: NAV_GROUPS, menuOpen: false, ...recorder.props })
  clickElement(shell, 'console-nav-item', '返回子系统门户')

  assert.deepEqual(recorder.events.map((event) => event.type), ['navigate'])
  assert.equal(recorder.events[0].key, 'portal')
})

test('汉堡按钮 / 关闭按钮 / 遮罩 共同驱动 update:menuOpen', () => {
  const opening = recordEvents()
  const closedShell = renderShell({ menuOpen: false, ...opening.props })
  clickElement(closedShell, 'console-menu-button')
  assert.deepEqual(opening.events, [{ type: 'update:menuOpen', value: true }])

  const closing = recordEvents()
  const openShell = renderShell({ menuOpen: true, ...closing.props })
  clickElement(openShell, 'console-close-menu')
  clickElement(openShell, 'console-menu-mask')
  assert.deepEqual(closing.events, [
    { type: 'update:menuOpen', value: false },
    { type: 'update:menuOpen', value: false },
  ], '关闭按钮与遮罩都必须能收起抽屉')
})

test('退出按钮 emit logout，disabled 时浏览器层面阻止点击', () => {
  const enabled = recordEvents()
  const shell = renderShell({ userName: '张管理', ...enabled.props })
  clickElement(shell, 'console-logout')
  assert.deepEqual(enabled.events, [{ type: 'logout' }])

  const disabled = recordEvents()
  const busy = renderShell({ userName: '张管理', logoutDisabled: true, ...disabled.props })
  assert.equal(busy.oneByClass('console-logout').props.disabled, true, 'logoutDisabled 必须渲染 disabled 属性')
})

// ===========================================================================
// 5. 迁移视图守卫：PlatformConsoleView.vue 不得把壳层结构搬回来
// ===========================================================================

test('迁移后的平台控制台视图不再自建 shell 标记，改用 <AppShell>', () => {
  for (const forbidden of ['console-sidebar', 'console-topbar', 'console-main', 'console-menu-mask']) {
    assert.equal(viewSource.includes(forbidden), false, `视图不得重新引入 ${forbidden}（壳层归 AppShell.vue）`)
  }
  assert.doesNotMatch(viewSource, /<main[\s>]/, '主区必须由外壳渲染，视图不能再写 <main>')
  assert.equal((viewSource.match(/<AppShell[\s>]/g) ?? []).length, 1, '视图必须正好使用一个 <AppShell>')
  assert.equal((viewSource.match(/<\/AppShell>/g) ?? []).length, 1)
  assert.match(viewSource, /import AppShell from '@\/modules\/shared\/components\/AppShell\.vue'/)
})

test('迁移视图保留共享外壳插槽的页面内容（标题层级与隐藏 h2）', () => {
  assert.match(viewSource, /<h1>系统设置<\/h1>/)
  assert.match(viewSource, /<h2>平台基础信息<\/h2>/)

  // 隐藏小节标题只允许一条，且条件必须与 IamSettingsModule 的渲染条件一致，否则标题大纲会重复或断裂。
  const hiddenHeadings = astElements(viewAst).filter((node) => (
    node.tag === 'h2' && astClassTokens(node).includes('shared-visually-hidden')
  ))
  assert.equal(hiddenHeadings.length, 1, 'shared-visually-hidden 的隐藏 <h2> 只能有一条')
  const condition = directiveExpression(hiddenHeadings[0], 'if')
  assert.equal(condition, "hasActiveFilteredSettingsTab && activeSettingsTab === 'iam'")

  const iamModule = astElements(viewAst).find((node) => node.tag === 'IamSettingsModule')
  assert.ok(iamModule, '视图必须仍然渲染 IamSettingsModule')
  assert.equal(directiveExpression(iamModule, 'else-if'), condition, '隐藏 h2 的条件必须与 IAM 面板一致')
  assert.ok(hiddenHeadings[0].loc.start.offset < iamModule.loc.start.offset, '隐藏 h2 必须位于 IAM 面板之前')

  assert.equal(hiddenHeadings[0].children.filter((child) => child.type === 1).length, 0,
    '隐藏 <h2> 只允许文本插值，不能嵌套其他元素')
  const interpolation = hiddenHeadings[0].children.find((child) => child.type === 5)
  assert.equal(interpolation?.content.content.trim(), 'activeSettingsTabLabel')
})

// ===========================================================================
// 6. 外壳契约：插槽集合 / props / 事件
// ===========================================================================

test('外壳声明的插槽集合与文档完全一致（少一个、多一个、重复都失败）', () => {
  const slotNodes = shellElements.filter((item) => item.tag === 'slot')
  const declared = slotNodes.map((node) => staticAttr(node, 'name') ?? 'default')
  assert.equal(declared.length, documentedSlots.length, '每个插槽只允许声明一次')
  assert.deepEqual([...declared].sort(), [...documentedSlots].sort(), '插槽集合必须与文档一致')
  assert.equal(new Set(declared).size, declared.length, '插槽不得重复声明')
})

test('外壳 props 契约覆盖文档列出的全部属性', () => {
  const propsBlock = /const props = defineProps\(\{([\s\S]*?)\n\}\)/.exec(shellSfc.descriptor.scriptSetup.content)
  assert.ok(propsBlock, '缺少 defineProps 声明')
  const declared = [...propsBlock[1].matchAll(/^\s{2}([A-Za-z][\w]*):\s*\{/gm)].map((match) => match[1])
  assert.deepEqual(declared.sort(), [...documentedProps].sort(), 'props 集合必须与文档一致')

  const emits = /defineEmits\(\[([^\]]*)\]\)/.exec(shellSfc.descriptor.scriptSetup.content)
  assert.ok(emits, '缺少 defineEmits 声明')
  const emitNames = [...emits[1].matchAll(/'([^']+)'/g)].map((match) => match[1])
  assert.deepEqual(emitNames.sort(), ['navigate', 'logout', 'update:menuOpen'].sort(), '事件集合必须与文档一致')
})

test('page-head / main-prefix / 默认插槽按文档位置落进主区', () => {
  const shell = renderShell({ pageClass: 'audit-console' }, {
    'main-prefix': () => h('div', { class: 'custom-main-prefix' }, '操作结果横幅'),
    'page-head': () => h('div', { class: 'custom-page-head' }, '页头'),
    default: () => h('section', { class: 'custom-content' }, '页面内容'),
  })
  const page = shell.oneByClass('console-page')
  assert.equal(classTokens(page)[0], 'console-page', 'console-page 必须是根节点首个类名')
  assert.ok(classTokens(page).includes('audit-console'), 'pageClass 必须落在根节点上')

  const main = shell.byTag('main')[0]
  const topbar = shell.oneByClass('console-topbar')
  const content = shell.oneByClass('console-content')
  const mainPrefix = shell.oneByClass('custom-main-prefix')
  const pageHead = shell.oneByClass('custom-page-head')
  const body = shell.oneByClass('custom-content')

  // 主区前缀（如操作结果横幅）在主区内、顶栏之前；页头与正文在 .console-content 内且页头在前。
  assert.ok(shell.inside(mainPrefix, main), 'main-prefix 必须渲染在主区内')
  assert.ok(shell.elements.indexOf(mainPrefix) < shell.elements.indexOf(topbar))
  assert.ok(shell.inside(pageHead, content), 'page-head 必须渲染在内容区内')
  assert.ok(shell.inside(body, content), '默认插槽必须渲染在内容区内')
  assert.ok(shell.elements.indexOf(pageHead) < shell.elements.indexOf(body), '页头必须排在正文之前')
})

test('overlay 插槽渲染在 </main> 之后、仍在外壳根节点内', () => {
  const main = shellElements.filter((node) => node.tag === 'main')[0]
  const overlaySlots = shellElements.filter((node) => node.tag === 'slot' && staticAttr(node, 'name') === 'overlay')
  assert.equal(overlaySlots.length, 1)
  assert.ok(overlaySlots[0].loc.start.offset > main.loc.end.offset, 'overlay 插槽必须位于 </main> 之后')

  const shell = renderShell({}, { overlay: () => h('div', { class: 'custom-overlay' }, '弹窗') })
  const overlay = shell.oneByClass('custom-overlay')
  assert.ok(shell.inside(overlay, shell.oneByClass('console-page')), 'overlay 内容必须仍在外壳根节点内')
  assert.ok(shell.elements.indexOf(overlay) > shell.elements.indexOf(shell.byTag('main')[0]),
    '弹窗不允许被主区包住，否则会被主区滚动/裁剪')
})
