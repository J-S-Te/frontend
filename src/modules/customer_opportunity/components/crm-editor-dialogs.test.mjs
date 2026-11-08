// 客户/商机编辑弹窗子组件（阶段 3-CRM 拆分）的渲染契约。
//
// 拆分要求：字段区搬到 CustomerEditorDialog.vue / OpportunityEditorDialog.vue 后，
// DOM 层级、CSS 类名、原生必填属性不变；子组件只渲染 + 上抛事件，不持有表单副本，
// 也不调用任何创建/更新接口（父层是唯一提交者）。这里编译并 SSR 渲染真实 SFC，
// 只把外部 UI 组件替换为替身，直接观察渲染结果与父子数据引用关系。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
import * as Vue from 'vue'
import { renderToString } from '@vue/server-renderer'
import { emptyCustomer, emptyOpportunity } from '../crmDisplay.js'

// 用途：编译真实弹窗 SFC 并用受控属性渲染，观察拆分后的 DOM、事件契约与表单引用。
// 参数：filename 为组件文件名；deps 为被替换的外部依赖；props 为父层传入的状态。
// 返回值：SSR HTML、编译后的组件选项与捕获到的上抛事件。
async function dialogHarness(filename, deps, props) {
  const source = readFileSync(new URL(`./${filename}`, import.meta.url), 'utf8')
  const { descriptor } = parse(source, { filename })
  const compiled = compileScript(descriptor, { id: `${filename}-split-test` })
  const component = new Function(
    ...Object.keys(deps),
    compiled.content
      .replace(/^import\s[\s\S]*?from ['"][^'"]+['"]\n/gm, '')
      .replace('export default', 'return'),
  )(...Object.values(deps))
  const template = compileTemplate({
    source: descriptor.template.content,
    filename,
    id: `${filename}-split-test`,
    compilerOptions: { bindingMetadata: compiled.bindings },
  })
  assert.deepEqual(template.errors, [])
  const render = new Function('Vue', template.code
    .replace(/import \{([^}]+)\} from "vue"/g, (_, names) => `const { ${names.replace(/ as /g, ': ')} } = Vue`)
    .replace('export function render', 'return function render'))(Vue)
  const emitted = []
  const setupState = component.setup(props, {
    expose() {},
    emit(event, ...args) { emitted.push([event, ...args]) },
  }) || {}
  const html = await renderToString(Vue.createSSRApp({
    render: () => render({ $slots: {} }, [], props, Vue.proxyRefs(setupState), {}, {}),
  }))
  return { html, component, emitted, props }
}

const consoleIconStub = { props: ['name'], render() { return null } }
const ownerSelectorStub = {
  props: ['userId', 'organizationId', 'defaultUserId', 'defaultOrganizationId', 'disabled'],
  emits: ['update:userId', 'update:organizationId'],
  render() { return null },
}

function customerProps(overrides = {}) {
  const form = Vue.reactive({
    ...emptyCustomer(),
    name: '客户甲', customer_type: '企业', industry: '金融', region: '北京',
    owner_user_id: 'u1', owner_org_id: 'org1', reason: '更新联系方式',
    contacts: [
      { id: 7, name: '张三', phone: '', email: '', is_registration: true },
      { id: 0, name: '李四', phone: '13900000000', email: '', is_registration: false },
    ],
  })
  return Vue.reactive({
    form,
    editMode: true,
    busy: false,
    nested: true,
    session: { user_id: 'u1', primary_org_id: 'org1' },
    customerTypeSuggestions: ['企业', '政府'],
    industryOptions: ['金融', '政府'],
    regionSuggestions: ['北京', '上海'],
    ...overrides,
  })
}

function opportunityProps(overrides = {}) {
  const form = Vue.reactive({
    ...emptyOpportunity(),
    name: '商机甲', customer_id: '5', expected_amount: '100.00', expected_sign_date: '2026-12-01',
    requirement_summary: '建设需求', owner_user_id: 'u1', owner_org_id: 'org1', reason: '补充需求',
  })
  return Vue.reactive({
    form,
    editMode: true,
    busy: false,
    nested: true,
    customerKeyword: '客户甲',
    customerOptions: [{ id: '5', name: '客户甲', customer_no: 'C-5', industry: '金融', region: '北京' }],
    customerOptionsLoading: false,
    customerOptionsError: '',
    customerOptionsTotal: 1,
    catalogLoading: false,
    catalogError: '',
    typeOptions: [{ id: 1, name: '新建', enabled: true }, { id: 3, name: '续签', enabled: false }],
    sourceOptions: [{ id: 2, name: '转介绍', enabled: true }],
    typeSelections: [1],
    sourceSelections: [2],
    ownerLabel: '张三',
    ...overrides,
  })
}

test('客户编辑弹窗保留既有 DOM 层级与 CSS 类，字段编辑写回父层同一份表单', async () => {
  const deps = { _defineComponent: Vue.defineComponent, ConsoleIcon: consoleIconStub, OwnerSelector: ownerSelectorStub }
  const props = customerProps()
  const { html, component, emitted } = await dialogHarness('CustomerEditorDialog.vue', deps, props)

  // 与拆分前一致：弹窗外壳 → console-detail-modal → 字段网格。
  assert.match(html, /^<div class="console-modal-backdrop nested"[^>]*>/)
  assert.match(html, /<form class="console-detail-modal crm-customer-dialog" role="dialog" aria-modal="true" aria-label="编辑客户"/)
  assert.match(html, /<div class="console-form-grid crm-customer-dialog__body">/)
  for (const className of ['crm-customer-contacts', 'crm-customer-contact-heading', 'crm-check-item']) {
    assert.match(html, new RegExp(className))
  }
  // 原生必填校验仍由字段自己声明，交给弹窗内的 <form>。
  assert.match(html, /<input[^>]*required/)
  assert.match(html, /<select[^>]*required/)
  assert.match(html, /<textarea[^>]*required/)
  // 父层表单的内容原样渲染（编辑态）。
  assert.match(html, /value="客户甲"/)
  // 多行文本（更新原因）以 textarea 文本内容渲染，联系人姓名以 value 属性渲染。
  assert.match(html, /更新联系方式/)
  assert.match(html, /value="张三"/)

  // 表单没有第二份副本：子组件改的是父层传入的同一引用。
  props.form.name = '客户乙'
  const second = await dialogHarness('CustomerEditorDialog.vue', deps, props)
  assert.equal(second.props.form, props.form, '重新挂载后仍是父层同一份表单')
  assert.match(second.html, /value="客户乙"/, '父层表单改动在子组件重挂载后仍然可见')
  // 事件契约以声明形式暴露，父层是唯一执行方。
  assert.deepEqual(component.emits, ['submit', 'close', 'add-contact', 'remove-contact'])
  assert.deepEqual(emitted, [], '渲染阶段不上抛任何事件（不会自行提交/关闭）')
})

test('商机编辑弹窗保留既有 DOM 层级与 CSS 类，勾选与禁用状态来自父层', async () => {
  const deps = { _defineComponent: Vue.defineComponent, ConsoleIcon: consoleIconStub }
  const props = opportunityProps()
  const { html, component } = await dialogHarness('OpportunityEditorDialog.vue', deps, props)

  assert.match(html, /^<div class="console-modal-backdrop nested"[^>]*>/)
  assert.match(html, /<form class="console-detail-modal crm-opportunity-dialog" role="dialog" aria-modal="true" aria-label="编辑商机"/)
  assert.match(html, /<div class="console-form-grid crm-opportunity-dialog__body">/)
  for (const className of ['crm-opportunity-multi-field', 'crm-opportunity-check-list', 'crm-opportunity-check-item',
    'crm-owner-selector crm-opportunity-owner']) {
    assert.match(html, new RegExp(className))
  }
  // 已选项勾选、停用项仍显示但不可再选（编辑态已选项保持可取消）。
  assert.match(html, /<input type="checkbox" value="1" checked>/)
  assert.match(html, /<input type="checkbox" value="2" checked>/)
  assert.match(html, /<input type="checkbox" value="3" disabled>/)
  assert.match(html, /已选择 1 项/)
  // 编辑态客户只读、负责人只展示父层解析出的姓名。
  assert.match(html, /<span>关联客户<\/span><input value="5" readonly disabled>/)
  assert.match(html, /<span>负责人用户<\/span><input value="张三" readonly>/)
  assert.match(html, /商机主档编辑不变更负责人/)
  // 更新原因仍是必填，提交按钮文案随编辑态变化。
  assert.match(html, /更新原因 \*/)
  assert.match(html, /保存商机/)
  assert.deepEqual(component.emits, ['submit', 'close', 'update:customer-keyword', 'search-customer', 'toggle-type', 'toggle-source'])
})

test('新建商机弹窗：父层状态映射为可查询的客户下拉与可提交按钮', async () => {
  const deps = { _defineComponent: Vue.defineComponent, ConsoleIcon: consoleIconStub }
  const props = opportunityProps({
    editMode: false,
    customerKeyword: '',
    customerOptions: [],
    customerOptionsTotal: 0,
    typeSelections: [],
    sourceSelections: [],
    form: Vue.reactive({ ...emptyOpportunity(), name: '商机乙' }),
  })
  const { html } = await dialogHarness('OpportunityEditorDialog.vue', deps, props)
  assert.match(html, /aria-label="新建商机"/)
  assert.match(html, /placeholder="按客户号或名称查询"/)
  assert.match(html, /请选择客户/)
  assert.match(html, /暂无符合条件的有效客户，请先在客户管理中创建客户。/)
  assert.match(html, /创建商机/)
  assert.match(html, /已选择 0 项/)
  // 目录仍在加载/失败时提交按钮保持禁用，避免把“选项没出来”当成有效提交。
  const failed = await dialogHarness('OpportunityEditorDialog.vue', deps, opportunityProps({ editMode: false, catalogError: '目录加载失败' }))
  assert.match(failed.html, /class="console-button primary" type="submit" disabled/)
  assert.match(failed.html, /目录加载失败/)
})

test('弹窗子组件不持有表单副本，也不自行提交业务写入', () => {
  for (const filename of ['CustomerEditorDialog.vue', 'OpportunityEditorDialog.vue']) {
    const source = readFileSync(new URL(`./${filename}`, import.meta.url), 'utf8')
    // 表单由父层传入：子组件不得自建 reactive/ref 表单，也不得回填空表单。
    assert.doesNotMatch(source, /reactive\(/)
    assert.doesNotMatch(source, /emptyCustomer|emptyOpportunity/)
    assert.doesNotMatch(source, /await createCustomer|await updateCustomer|await createOpportunity|await updateOpportunity/)
    // 事件上抛 + 父层接线（页面里 submit/close 都指向父层函数）。
    assert.match(source, /defineEmits\(/)
    assert.match(source, /@submit\.prevent="emit\('submit'\)"/)
    assert.match(source, /@click="emit\('close'\)"/)
  }
})
