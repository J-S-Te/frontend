import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import * as Vue from 'vue'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'

// 售前审批规则面板的「编辑区可见性」行为锁。
//
// 要锁的不是样式，而是一条交互规则：
//   默认只显示规则列表，编辑卡整张不渲染、不占位；
//   只有「编辑」(含点规则行) 和「新增规则」才把它展开；
//   「放弃修改」、保存成功、删除当前编辑的规则之后都必须收起。
//
// 用例把真实 SFC 编译后用无 DOM 渲染器挂载，直接调用按钮上的真实事件处理器，
// 因此断言的是组件实际渲染出的节点，而不是源码里的字符串。

const SRC = new URL('../../', import.meta.url).pathname
const PANEL = join(SRC, 'modules/customer_opportunity/components/PresaleApprovalRulesPanel.vue')

// 接口与确认弹窗用最小替身：本用例只关心编辑区何时出现，
// 不去连真实售前服务，也不依赖 Teleport 的目标节点（那是 ConfirmDialog 自己的测试范围）。
const apiState = { rules: [], updateCalls: [], createCalls: [], deleteCalls: [] }
const apiStub = {
  listPresaleApprovalRules: async () => JSON.parse(JSON.stringify(apiState.rules)),
  updatePresaleApprovalRule: async (id, payload) => {
    apiState.updateCalls.push({ id, payload })
    const target = apiState.rules.find((rule) => String(rule.id) === String(id))
    if (target) Object.assign(target, payload)
    return target
  },
  createPresaleApprovalRule: async (payload) => {
    apiState.createCalls.push(payload)
    const created = { ...payload, id: `new-${apiState.rules.length + 1}`, version: 1 }
    apiState.rules.push(created)
    return created
  },
  deletePresaleApprovalRule: async (id) => {
    apiState.deleteCalls.push(id)
    apiState.rules = apiState.rules.filter((rule) => String(rule.id) !== String(id))
  },
}

const overrides = {
  [join(SRC, 'modules/customer_opportunity/api/presale.js')]: apiStub,
  [join(SRC, 'modules/shared/components/ConfirmDialog.vue')]: {
    name: 'ConfirmDialogStub',
    props: {
      open: { type: Boolean, default: false },
      title: { type: String, default: '' },
      description: { type: String, default: '' },
      confirmText: { type: String, default: '' },
      cancelText: { type: String, default: '' },
      danger: { type: Boolean, default: false },
      busy: { type: Boolean, default: false },
    },
    emits: ['confirm', 'cancel'],
    render() {
      if (!this.open) return null
      return Vue.h('button', { type: 'button', onClick: () => this.$emit('confirm') }, this.confirmText || '确认')
    },
  },
}

async function resolveDependency(fromFile, specifier) {
  if (specifier === 'vue') return Vue
  const base = specifier.startsWith('.') ? resolve(dirname(fromFile), specifier) : join(SRC, specifier.slice(2))
  if (overrides[base]) return overrides[base]
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
  const { descriptor } = parse(readFileSync(file, 'utf8'))
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
      imports[spec.local.name] = spec.type === 'ImportDefaultSpecifier' ? (dependency.default ?? dependency) : dependency[spec.imported.name]
    }
  }
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
  return component
}

const Panel = await loadSfc(PANEL)

// 无 DOM 渲染器：把 vnode 树落成普通对象，就能直接调用按钮上的真实事件处理器，
// 同时记录 focus / scrollIntoView 的落点（编辑区出现后要抢焦点并滚进可见范围）。
function createDom() {
  const focused = []
  const scrolled = []
  const nodeOps = {
    createElement: (tag) => {
      const element = {
        tag,
        tagName: String(tag).toUpperCase(),
        props: {},
        style: { display: '' },
        children: [],
        value: '',
        checked: false,
        // select 的 v-model 指令会遍历 el.options 对齐选中项；这里给空集合即可。
        options: [],
        selectedIndex: -1,
        selectedOptions: [],
        multiple: false,
        parent: null,
        parentElement: null,
        focus: () => { focused.push(element) },
        scrollIntoView: () => { scrolled.push(element) },
        // v-model 的运行时指令（v-modelText / v-modelCheckbox）会注册原生监听、
        // 读挂载时的 value/checked，这里给出等价的最小表面即可。
        addEventListener: () => {},
        removeEventListener: () => {},
        getRootNode: () => ({ activeElement: null }),
        setAttribute: (key, value) => { element.props[key] = value },
        removeAttribute: (key) => { delete element.props[key] },
        hasAttribute: (key) => key in element.props,
        querySelectorAll: () => [],
      }
      return element
    },
    createText: (text) => ({ text }),
    createComment: (text) => ({ comment: text }),
    setText: (node, text) => { node.text = text },
    setElementText: (element, text) => { element.text = text },
    insert: (child, parent, anchor) => {
      child.parent = parent
      const index = anchor ? parent.children.indexOf(anchor) : -1
      if (index >= 0) parent.children.splice(index, 0, child)
      else parent.children.push(child)
    },
    remove: (child) => {
      const parent = child.parent
      if (!parent) return
      const index = parent.children.indexOf(child)
      if (index >= 0) parent.children.splice(index, 1)
      child.parent = null
    },
    parentNode: (node) => node.parent || null,
    nextSibling: (node) => {
      const parent = node.parent
      if (!parent) return null
      const index = parent.children.indexOf(node)
      return parent.children[index + 1] || null
    },
    querySelector: () => null,
    setScopeId: () => {},
    cloneNode: (node) => ({ ...node, children: [...node.children] }),
    insertStaticContent: () => [null, null],
    patchProp: (element, key, _previous, next) => { element.props[key] = next },
  }
  return { renderer: Vue.createRenderer(nodeOps), focused, scrolled }
}

function textOf(node) {
  if (!node) return ''
  if (typeof node.text === 'string') return node.text
  return (node.children || []).map(textOf).join('')
}

function collect(node, predicate, found = []) {
  if (!node) return found
  if (node.tag && predicate(node)) found.push(node)
  for (const child of node.children || []) collect(child, predicate, found)
  return found
}

function byClass(node, className) {
  return collect(node, (item) => String(item.props.class || '').split(/\s+/).includes(className))
}

function buttons(node, label) {
  return collect(node, (item) => item.tag === 'button' && textOf(item).trim() === label)
}

function buttonContaining(node, label) {
  return collect(node, (item) => item.tag === 'button' && textOf(item).includes(label))[0]
}

function rulesActionsButtons(node, label) {
  return byClass(node, 'crm-approval-rule-actions').flatMap((actions) => buttons(actions, label))
}

function inputByPlaceholder(node, placeholder) {
  return collect(node, (item) => item.tag === 'input' && item.props.placeholder === placeholder)[0]
}

async function flush() {
  for (let i = 0; i < 4; i += 1) {
    await Vue.nextTick()
    await new Promise((done) => setTimeout(done, 0))
  }
}

function seedRules() {
  const rule = (id, name, priority, enabled, nodeName) => ({
    id,
    name,
    priority,
    enabled,
    version: 1,
    expression: { logical: 'and', conditions: [{ field: 'urgency', operator: 'eq', value: 'NORMAL' }] },
    nodes: [{ id: `${id}-n1`, name: nodeName, type: 'APPROVAL', role_code: 'sales_director' }],
  })
  apiState.rules = [
    rule('r1', '标准售前审批', 10, true, '销售总监审批'),
    rule('r2', '大客户审批', 5, false, '技术总监审批'),
  ]
  apiState.updateCalls = []
  apiState.createCalls = []
  apiState.deleteCalls = []
}

async function mountPanel(props = { isAdmin: true }) {
  const dom = createDom()
  const root = { tag: 'root', props: {}, style: {}, children: [] }
  const app = dom.renderer.createApp({ render: () => Vue.h(Panel, props) })
  app.mount(root)
  await flush()
  return { ...dom, root, app }
}

const clickEvent = { preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {} }

test('默认只渲染规则列表，编辑卡不渲染也不占位', async () => {
  seedRules()
  const { root } = await mountPanel()
  assert.equal(byClass(root, 'crm-approval-rule-editor').length, 0, '默认不渲染编辑卡')
  assert.equal(byClass(root, 'crm-approval-rule-editor-body').length, 0, '编辑区表单也不渲染')
  assert.doesNotMatch(textOf(root), /编辑审批规则|新建审批规则/, '默认不出现编辑区标题')
  assert.match(textOf(root), /标准售前审批/, '默认只有规则列表')
  assert.match(textOf(root), /2 条规则/)
  const [layout] = byClass(root, 'crm-approval-rules-layout')
  assert.match(String(layout.props.class), /is-single/, '编辑卡收起时列表独占整行，不给它留空列')
  const rows = byClass(root, 'crm-approval-rule-row')
  assert.equal(rows.filter((row) => String(row.props.class).includes('is-active')).length, 0, '编辑卡收起时不标任何选中行')
  assert.ok(byClass(root, 'crm-approval-rule-select').every((button) => button.props['aria-pressed'] === false), '读屏也不必谎报正在编辑')
})

test('点某条规则的「编辑」展开这张卡，并填入这条规则', async () => {
  seedRules()
  const { root, focused, scrolled } = await mountPanel()
  const editButtons = rulesActionsButtons(root, '编辑')
  assert.equal(editButtons.length, 2, '每条规则一个编辑入口')
  editButtons[1].props.onClick(clickEvent)
  await flush()

  const [editor] = byClass(root, 'crm-approval-rule-editor')
  assert.ok(editor, '点「编辑」后编辑卡出现')
  assert.match(textOf(editor), /编辑审批规则/)
  assert.equal(inputByPlaceholder(editor, '例如：标准售前审批').value, '大客户审批', '编辑卡里是这一条规则')
  const [layout] = byClass(root, 'crm-approval-rules-layout')
  assert.doesNotMatch(String(layout.props.class), /is-single/, '有编辑卡时恢复两栏布局')
  assert.ok(focused.some((node) => textOf(node).trim() === '编辑审批规则'), '焦点进入编辑区标题')
  assert.ok(scrolled.includes(editor), '编辑卡滚进面板可见范围')
  const rows = byClass(root, 'crm-approval-rule-row')
  assert.match(String(rows[1].props.class), /is-active/, '正在编辑的行高亮')
  assert.equal(byClass(root, 'crm-approval-rule-select')[1].props['aria-pressed'], true)
})

test('点规则行同样进入编辑，列表「点击规则行即可编辑」的提示仍然成立', async () => {
  seedRules()
  const { root } = await mountPanel()
  const [rowButton] = byClass(root, 'crm-approval-rule-select')
  rowButton.props.onClick(clickEvent)
  await flush()
  const [editor] = byClass(root, 'crm-approval-rule-editor')
  assert.ok(editor, '点规则行后编辑卡出现')
  assert.equal(inputByPlaceholder(editor, '例如：标准售前审批').value, '标准售前审批')
})

test('点右上「新增规则」展开空白的新建编辑器', async () => {
  seedRules()
  const { root } = await mountPanel()
  const [create] = buttons(root, '＋新增规则')
  assert.ok(create, '表头有新增规则入口')
  create.props.onClick(clickEvent)
  await flush()

  const [editor] = byClass(root, 'crm-approval-rule-editor')
  assert.ok(editor, '点「新增规则」后编辑卡出现')
  assert.match(textOf(editor), /新建审批规则/)
  assert.equal(inputByPlaceholder(editor, '例如：标准售前审批').value, '', '新建态是空白表单')
  assert.match(textOf(editor), /创建审批规则/)
})

test('「放弃修改」收起编辑卡回到列表', async () => {
  seedRules()
  const { root } = await mountPanel()
  rulesActionsButtons(root, '编辑')[0].props.onClick(clickEvent)
  await flush()
  assert.equal(byClass(root, 'crm-approval-rule-editor').length, 1, '先确认编辑卡是展开的')

  buttons(root, '放弃修改')[0].props.onClick(clickEvent)
  await flush()
  assert.equal(byClass(root, 'crm-approval-rule-editor').length, 0, '放弃修改后编辑卡收起')
  assert.match(textOf(root), /标准售前审批/, '列表仍在，用户可以重新选择')
})

test('保存成功后收起编辑卡，列表显示保存后的规则', async () => {
  seedRules()
  const { root } = await mountPanel()
  rulesActionsButtons(root, '编辑')[0].props.onClick(clickEvent)
  await flush()
  const [editor] = byClass(root, 'crm-approval-rule-editor')
  const nameInput = inputByPlaceholder(editor, '例如：标准售前审批')
  nameInput.value = '标准售前审批（改）' // 模拟用户在输入框里敲完，DOM 值先变、模型随后同步
  nameInput.props['onUpdate:modelValue']('标准售前审批（改）')
  await flush()

  editor.props.onSubmit(clickEvent)
  await flush()
  assert.equal(byClass(root, 'crm-approval-rule-editor').length, 0, '保存成功后编辑卡收起')
  assert.equal(apiState.updateCalls.length, 1, '确实调用了保存接口')
  assert.equal(apiState.updateCalls[0].id, 'r1')
  assert.match(textOf(root), /标准售前审批（改）/, '列表用保存后的名称重绘')
})

test('保存校验失败时编辑卡保持展开并给出原因', async () => {
  seedRules()
  const { root } = await mountPanel()
  buttons(root, '＋新增规则')[0].props.onClick(clickEvent)
  await flush()
  const [editor] = byClass(root, 'crm-approval-rule-editor')
  editor.props.onSubmit(clickEvent) // 新建态规则名称为空 → 本地校验失败
  await flush()
  assert.equal(byClass(root, 'crm-approval-rule-editor').length, 1, '校验失败不收起编辑卡')
  assert.match(textOf(root), /请填写规则名称/, '提示原因，用户才能改')
  assert.equal(apiState.createCalls.length, 0, '校验失败不进入保存请求')
})

test('「收起列表」只控制列表，不影响已展开的编辑卡', async () => {
  seedRules()
  const { root } = await mountPanel()
  rulesActionsButtons(root, '编辑')[0].props.onClick(clickEvent)
  await flush()
  buttonContaining(root, '收起列表').props.onClick(clickEvent)
  await flush()
  assert.equal(byClass(root, 'crm-approval-rule-editor').length, 1, '编辑卡不受列表折叠影响')
  assert.equal(byClass(root, 'crm-approval-rules-body')[0].style.display, 'none', '列表体被收起')

  buttonContaining(root, '展开列表').props.onClick(clickEvent)
  await flush()
  assert.equal(byClass(root, 'crm-approval-rules-body')[0].style.display, '', '再点一次列表恢复')
})

test('删除当前编辑的规则后收起编辑卡', async () => {
  seedRules()
  const { root } = await mountPanel()
  rulesActionsButtons(root, '编辑')[1].props.onClick(clickEvent) // 正在编辑「大客户审批」
  await flush()
  rulesActionsButtons(root, '删除')[1].props.onClick(clickEvent)
  await flush()
  const [confirm] = buttons(root, '删除审批规则')
  assert.ok(confirm, '删除先走确认弹窗')
  confirm.props.onClick(clickEvent)
  await flush()

  assert.deepEqual(apiState.deleteCalls, ['r2'], '确认后才真正删除')
  assert.equal(byClass(root, 'crm-approval-rule-editor').length, 0, '删掉当前编辑的规则后编辑卡收起')
  assert.doesNotMatch(textOf(root), /大客户审批/, '列表里不再有这条规则')
})
