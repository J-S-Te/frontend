// 合同草稿字段子组件（阶段 3-合同拆分）的渲染契约。
//
// 拆分要求：字段区搬到 ContractDraftFields.vue 后，DOM 层级、CSS 类名、原生必填属性不变，
// 且子组件不持有 <form>/提交入口/弹窗开关——它只渲染字段并发明确事件。
// 这里编译并 SSR 渲染真实 SFC（只把外部 UI 组件与纯函数替换为替身），直接观察渲染结果。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
import * as Vue from 'vue'
import { renderToString } from '@vue/server-renderer'
import { isContractAmountField, isSystemContractNumberField } from '../utils/systemTemplateFields.js'

const filename = 'ContractDraftFields.vue'
const { descriptor } = parse(readFileSync(new URL('./ContractDraftFields.vue', import.meta.url), 'utf8'))

// 用途：编译真实字段子组件并用受控属性渲染，观察拆分后的 DOM 与事件契约。
// 参数：overrides 覆盖默认展示状态。
// 返回值：SSR HTML、编译后的组件选项与可写入的表单对象。
async function fieldsHarness(overrides = {}) {
  const form = Vue.reactive({
    opportunity_id: '', opportunity_name: '', customer_id: '', title: '合成合同', contract_type: '直签',
    amount: '100.00', currency: 'CNY', customer_name: '合成客户', customer_address: '',
    customer_contact: '', customer_phone: '', start_date: '', end_date: '',
    payment_terms: [{ installment_no: 1, due_date: '2026-12-01', amount: '100.00' }],
    service_items: [{ service_type: '等保测评', name: '', site: '合成现场', batch: '第一批次', category: '等保测评', requirement: '', test_mode: 'STANDARD', systems: [{ name: '合成系统', level: '二级' }] }],
    template_id: 'template-a', template_values: { party: '甲方' },
  })
  const props = Vue.reactive({
    newContract: form,
    contractCreationMode: 'template',
    editingContract: null,
    contractTemplates: [{ id: 'template-a', name: '标准服务合同', fields: [{ name: 'party' }] }],
    selectedContractTemplate: { id: 'template-a', name: '标准服务合同', original_filename: 'standard.docx', fields: [{ name: 'party' }] },
    editableContractTemplateFields: [{ name: 'party', label: '甲方名称' }],
    availableContractTypeOptions: ['直签', '三方'],
    serviceTypeOptions: ['等保测评', '软件测试'],
    systemLevelOptions: ['一级', '二级'],
    currentUserLabel: '张三',
    externalContractFile: null,
    externalContractFileError: '',
    externalContractFileInputKey: 0,
    contractSourceCapabilities: { pdf_enabled: true },
    contractFormSourceCapabilities: {},
    localContractCounterparty: false,
    localContractCategories: false,
    canAddServiceItem: false,
    canAddSystemRow: () => true,
    detectionCategoryOptions: [],
    detectionCategoryLoading: false,
    detectionCategoryError: '',
    opportunityOptions: [],
    opportunityLoading: false,
    paymentPlanError: '',
    isAdmin: false,
    templatePreviewing: false,
    templatePreviewError: '',
    isExternalContractMode: false,
    busy: false,
    ...overrides,
  })
  const deps = {
    _defineComponent: Vue.defineComponent,
    ConsoleIcon: { render() { return null } },
    ContractPricingFields: { props: ['form', 'disabled'], render() { return null } },
    LocalContractSourcePicker: { props: ['modelValue', 'capabilities', 'disabled'], emits: ['update:modelValue'], render() { return null } },
    isContractAmountField,
    isSystemContractNumberField,
  }
  const compileOptions = compileScript(descriptor, { id: 'contract-draft-fields-test' })
  const component = new Function(...Object.keys(deps),
    compileOptions.content.replace(/^import\s[\s\S]*?from ['"][^'"]+['"]\n/gm, '').replace('export default', 'return'))(...Object.values(deps))
  const template = compileTemplate({ source: descriptor.template.content, filename, id: 'contract-draft-fields-test', compilerOptions: { bindingMetadata: compileOptions.bindings } })
  assert.deepEqual(template.errors, [])
  const render = new Function('Vue', template.code
    .replace(/import \{([^}]+)\} from "vue"/g, (_, names) => `const { ${names.replace(/ as /g, ': ')} } = Vue`)
    .replace('export function render', 'return function render'))(Vue)
  const state = component.setup(props, { expose() {}, emit() {} }) || {}
  // 渲染上下文按需提供插槽：父层通过 #status 插槽传入的提示区仍由页面渲染（含错误定位 ref）。
  const slots = overrides.slots || {}
  const html = await renderToString(Vue.createSSRApp({ render: () => render({ $slots: slots }, [], props, Vue.proxyRefs(state), {}, {}) }))
  return { html, form, props, component }
}

test('字段区保留原 DOM 层级与 CSS 类名，且不再持有表单或提交入口', async () => {
  const { html, component } = await fieldsHarness()
  // 与拆分前一致：一个 .contract-form-grid 承载字段，写入模板字段用 .contract-generated-form。
  assert.match(html, /<div class="contract-form-grid">/)
  assert.match(html, /<div class="contract-generated-form">/)
  for (const className of ['contract-form-wide', 'contract-creation-mode', 'contract-template-first', 'contract-service-items',
    'contract-service-item', 'contract-system-information', 'contract-payment-plan', 'contract-payment-term-row',
    'contract-template-field-grid', 'contract-opportunity-control']) {
    assert.match(html, new RegExp(className.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `缺少既有 CSS 类：${className}`)
  }
  // 原生必填校验仍由字段自己声明，交给外层 <form> 的原生校验。
  assert.match(html, /<input[^>]*required/)
  assert.match(html, /<select[^>]*required/)
  // 子组件不得自带表单/提交按钮，也不得自行关闭弹窗。
  assert.doesNotMatch(html, /<form\b/)
  assert.doesNotMatch(html, /type="submit"/)
  // 事件契约以声明形式暴露，编译后的组件必须注册这些 emit（父层唯一执行方）。
  assert.deepEqual(component.emits, [
    'select-mode', 'template-change', 'select-file', 'replace-form', 'open-customer-picker', 'clear-customer',
    'focus-opportunity', 'opportunity-change', 'clear-opportunity', 'add-service-item', 'remove-service-item',
    'add-system-row', 'remove-system-row', 'add-payment-term', 'remove-payment-term', 'preview-template',
    'reload-detection-categories',
  ])
})

test('字段双向绑定仍写回父层持有的同一份草稿对象', async () => {
  const { html, form, props } = await fieldsHarness()
  // 渲染读的是父层传入的表单，不是子组件自己复制的一份。
  assert.match(html, /value="合成合同"/)
  assert.match(html, /value="合成客户"/)
  assert.match(html, /value="100\.00"/)
  form.title = '改后的合同'
  assert.equal(props.newContract.title, '改后的合同', '字段对象与父层同一引用')
  const changed = await fieldsHarness({ newContract: form })
  assert.match(changed.html, /value="改后的合同"/, '字段编辑会反映到父层同一份表单的再次渲染')
  // 模板字段替换值来自父层 template_values。
  assert.match(html, /value="甲方"/)
})

test('外部合同模式按既有能力显示文件类型限制与检测类别错误重试入口', async () => {
  const { html } = await fieldsHarness({
    contractCreationMode: 'external',
    isExternalContractMode: true,
    editingContract: null,
    selectedContractTemplate: null,
    templatePreviewError: '',
    externalContractFileError: 'DOCX 文件不能超过 10MB。',
    detectionCategoryError: '读取检测类别目录失败，请稍后重试。',
    detectionCategoryOptions: [],
  })
  assert.match(html, /accept="\.docx,\.pdf,application\/pdf,application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document"/)
  assert.match(html, /DOCX 文件不能超过 10MB。/)
  assert.match(html, /读取检测类别目录失败，请稍后重试。/)
  assert.match(html, /重新加载/)
  // 外部模式不需要先选模板，因此不显示「请先选择合同模板」提示。
  assert.doesNotMatch(html, /请先选择合同模板/)

  const emptyTemplate = await fieldsHarness({ contractCreationMode: 'template', isExternalContractMode: false, selectedContractTemplate: null })
  assert.match(emptyTemplate.html, /请先选择合同模板，再填写合同、服务项和系统信息。/)
  assert.match(emptyTemplate.html, /第一步：选择合同模板/)
})

test('父层状态区通过插槽渲染在字段栅格内，DOM 位置与拆分前一致', async () => {
  const { html } = await fieldsHarness({
    slots: {
      status: () => [
        Vue.h('p', { class: 'contract-form-wide contract-form-required-hint', 'data-testid': 'parent-status' }, '带 * 的为必填项'),
        Vue.h('p', { class: 'contract-session-error contract-form-wide', role: 'alert', 'data-testid': 'parent-error' }, '错误'),
      ],
    },
  })
  const gridStart = html.indexOf('<div class="contract-form-grid">')
  const statusAt = html.indexOf('data-testid="parent-status"')
  const errorAt = html.indexOf('data-testid="parent-error"')
  const firstFieldAt = html.indexOf('contract-creation-mode')
  assert.ok(gridStart > -1 && statusAt > gridStart, '状态区必须渲染在字段栅格内部（与拆分前同一 DOM 位置）')
  assert.ok(errorAt > statusAt && firstFieldAt > errorAt, '状态区顺序：必填提示 → 错误提示 → 字段')
  // 状态区由页面提供，子组件不自带错误文案或错误定位 ref。
  assert.doesNotMatch(fieldsHarnessSource(), /draftErrorElement/)
})

// 用途：读取子组件源码，供“子组件不自持错误定位引用”的静态断言使用。
// 参数：无。
// 返回值：SFC 源码文本。
function fieldsHarnessSource() {
  return readFileSync(new URL('./ContractDraftFields.vue', import.meta.url), 'utf8')
}
