// CRM 客户/商机编辑弹窗拆分（阶段 3-CRM）的行为回归护栏。
//
// 拆分后的职责边界：父层（CustomerOpportunityView.vue）持有表单、弹窗开关、脏检查基线与关闭确认，
// 并且是唯一业务提交者；子组件只渲染 + 上抛事件；组合式函数（useCustomerEditor / useOpportunityEditor）
// 只按同一引用回填表单并读取目录。本文件锁定拆分不得改变的行为：
// 1. 新建/编辑各只提交一次（重复点击/并发触发不会重复写）；
// 2. 取消关闭不触发任何业务提交；
// 3. 校验失败不提交，错误仍展示且表单保持打开；
// 4. 异步目录读取失败可重试，重试不触发重复业务提交；
// 5. 弹窗代码块加载边界：加载是惰性的、失败有显式重试、重试只换组件实例、不触发业务提交。
//
// 断言对象都是仓库里的真实实现：静态部分读 SFC/组合式函数源码，行为部分从源码抽出真实函数执行。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { parse as parseSFC } from '@vue/compiler-sfc'
import { parse as parseJS } from '@babel/parser'
import { reactive, ref, shallowRef, toRaw } from 'vue'
import { createCreateMutationRetryState } from './createMutationRetry.js'
import { useCustomerEditor } from './composables/useCustomerEditor.js'
import { useOpportunityEditor } from './composables/useOpportunityEditor.js'
import { emptyCustomer, emptyOpportunity } from './crmDisplay.js'

const viewSource = await readFile(new URL('./views/CustomerOpportunityView.vue', import.meta.url), 'utf8')
const viewScript = parseSFC(viewSource).descriptor.scriptSetup.content
const customerDialogSource = await readFile(new URL('./components/CustomerEditorDialog.vue', import.meta.url), 'utf8')
const opportunityDialogSource = await readFile(new URL('./components/OpportunityEditorDialog.vue', import.meta.url), 'utf8')

// 用途：从真实源码里抽出指定函数声明，用受控依赖执行（不复制实现，避免断言与实现分叉）。
// 参数：script 为源码文本；names 为目标函数名。
// 返回值：源码片段拼接，可直接拼进 new Function。
function functionSources(script, names) {
  const found = new Map()
  const walk = (node) => {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) {
      for (const item of node) walk(item)
      return
    }
    if (node.type === 'FunctionDeclaration' && node.id && names.includes(node.id.name)) {
      found.set(node.id.name, script.slice(node.start, node.end))
    }
    for (const key of Object.keys(node)) {
      if (['loc', 'start', 'end', 'leadingComments', 'trailingComments', 'innerComments'].includes(key)) continue
      walk(node[key])
    }
  }
  walk(parseJS(script, { sourceType: 'module' }).program)
  return names.map((name) => {
    assert.ok(found.has(name), `缺少 ${name}`)
    return found.get(name)
  }).join('\n')
}

// 用途：构造客户保存所需的页面状态与接口替身，记录业务写入次数。
// 参数：overrides 覆盖默认替身。
// 返回值：含父层状态、调用计数与可执行 submitCustomer 的测试宿主。
function customerHarness(overrides = {}) {
  const calls = { create: 0, update: 0, duplicate: 0, refresh: 0 }
  const form = reactive({
    ...emptyCustomer(), name: '客户甲', customer_type: '企业', industry: '金融', region: '北京',
    contacts: [{ id: 0, name: '张三', phone: '13800000000', email: '', is_registration: true }],
  })
  const deps = {
    actionLoading: ref(false),
    customerEditMode: ref(false),
    customerForm: form,
    customerDialog: ref(true),
    selectedCustomer: ref(null),
    error: ref(''),
    notice: ref(''),
    toRaw,
    createMutationRetries: createCreateMutationRetryState(() => 'customer-create-key'),
    resetMessages: () => { deps.error.value = ''; deps.notice.value = '' },
    showError: (value) => { deps.error.value = value?.message || '错误' },
    notifyWithReference: (text) => { deps.notice.value = text },
    checkCustomerDuplicate: async () => { calls.duplicate += 1; return [] },
    createCustomer: async () => { calls.create += 1; return { id: 'c1', customer_no: 'C-1' } },
    updateCustomer: async () => { calls.update += 1; return { id: 'c1', version: 2 } },
    loadCurrent: async () => { calls.refresh += 1 },
    ...overrides,
  }
  const name = 'submitCustomer'
  const submit = new Function(...Object.keys(deps), `${functionSources(viewScript, [name])}; return ${name};`)(...Object.values(deps))
  return { ...deps, calls, form, submit }
}

// 用途：构造商机保存所需的页面状态与接口替身，并给出真实的 useOpportunityEditor 实例。
// 参数：overrides 覆盖默认替身。
// 返回值：含父层状态、组合式函数实例、调用计数与可执行 submitOpportunity 的测试宿主。
function opportunityHarness(overrides = {}) {
  const calls = { catalog: 0, customers: 0, create: 0, update: 0, refresh: 0 }
  const form = reactive(emptyOpportunity())
  const dialog = ref(false)
  const editMode = ref(false)
  const selectedOpportunity = ref(null)
  const selectedOpportunityOwnerOrgID = ref('')
  let catalogShouldFail = true
  const deps = {
    actionLoading: ref(false),
    error: ref(''),
    notice: ref(''),
    createMutationRetries: createCreateMutationRetryState(() => 'opportunity-create-key'),
    opportunityForm: form,
    opportunityDialog: dialog,
    opportunityEditMode: editMode,
    selectedOpportunity,
    selectedOpportunityOwnerOrgID,
    resetMessages: () => { deps.error.value = ''; deps.notice.value = '' },
    showError: (value) => { deps.error.value = value?.message || '错误' },
    updateOpportunity: async () => { calls.update += 1; return { id: 'o1', version: 2 } },
    createOpportunity: async () => { calls.create += 1; return { id: 'o1', opportunity_no: 'O-1' } },
    loadCurrent: async () => { calls.refresh += 1 },
    ...overrides,
  }
  const editor = useOpportunityEditor({
    form,
    dialog,
    editMode,
    setSnapshot: () => {},
    selectedOpportunity,
    selectedOpportunityOwnerOrgID,
    listCustomers: async () => {
      calls.customers += 1
      return { items: [{ id: '5', name: '客户甲', customer_no: 'C-5', industry: '金融', region: '北京' }], total: 1 }
    },
    listOpportunityCatalogItems: async (kind) => {
      calls.catalog += 1
      if (catalogShouldFail) throw Object.assign(new Error('目录暂时不可用'), { code: 'CRM_CATALOG_UNAVAILABLE' })
      return kind === 'TYPE'
        ? [{ id: 1, name: '新建', enabled: true, sort_order: 1 }]
        : [{ id: 2, name: '转介绍', enabled: true, sort_order: 1 }]
    },
    formatCRMError: (value, options) => value?.message || options?.fallback || '错误',
  })
  const bound = {
    ...deps,
    syncOpportunitySelections: editor.syncSelections,
    opportunityCatalogLoading: editor.catalogLoading,
    opportunityCatalogError: editor.catalogError,
    opportunityTypeSelections: editor.typeSelections,
    opportunitySourceSelections: editor.sourceSelections,
  }
  const name = 'submitOpportunity'
  const submit = new Function(...Object.keys(bound), `${functionSources(viewScript, [name])}; return ${name};`)(...Object.values(bound))
  return {
    ...bound, calls, form, editor, submit,
    setCatalogAvailable: () => { catalogShouldFail = false },
  }
}

test('新建客户只提交一次：提交中重复触发被挡住', async () => {
  const ui = customerHarness()
  const first = ui.submit()
  // 提交进行中再次触发（重复点击/原生表单重复提交）不得产生第二次创建。
  await ui.submit()
  await first
  assert.equal(ui.calls.create, 1, '一次保存只允许一次创建请求')
  assert.equal(ui.calls.update, 0)
  assert.equal(ui.calls.refresh, 1, '保存成功后只刷新一次列表')
  assert.equal(ui.customerDialog.value, false, '保存成功后关闭弹窗')
  assert.equal(ui.actionLoading.value, false, '成功后解除提交中状态')
})

test('编辑客户只提交一次：更新载荷仍带版本与更新原因', async () => {
  const payloads = []
  const ui = customerHarness({
    customerEditMode: ref(true),
    selectedCustomer: ref({ id: 7, version: 3 }),
    updateCustomer: async (id, payload) => { payloads.push({ id, payload }); return { id, version: 4 } },
  })
  ui.form.reason = '补齐联系人信息'
  await ui.submit()
  assert.equal(payloads.length, 1)
  assert.equal(payloads[0].id, 7)
  assert.equal(payloads[0].payload.version, 3, '更新必须带乐观锁版本')
  assert.equal(payloads[0].payload.reason, '补齐联系人信息', '更新原因必须随载荷提交')
  assert.equal(ui.customerDialog.value, false)
})

test('取消关闭编辑弹窗不触发任何业务提交', async () => {
  // 关闭确认仍由父层持有：执行页面真实的 closeCustomerDialog，观察“继续编辑/放弃修改”两个分支。
  for (const accepted of [false, true]) {
    const calls = { create: 0, update: 0 }
    const state = {
      actionLoading: { value: false },
      customerFormDirty: { value: true },
      customerDialog: { value: true },
      customerFormInitial: 'old',
      confirmDialog: { value: null },
      askConfirm: async () => accepted,
      createCustomer: async () => { calls.create += 1 },
      updateCustomer: async () => { calls.update += 1 },
    }
    const close = new Function(...Object.keys(state),
      `${functionSources(viewScript, ['confirmDiscardIfDirty', 'closeCustomerDialog'])}; return closeCustomerDialog;`)(...Object.values(state))
    await close()
    assert.equal(state.customerDialog.value, !accepted, accepted ? '确认放弃后关闭弹窗' : '取消放弃时留在表单')
    assert.deepEqual(calls, { create: 0, update: 0 }, '关闭或放弃确认本身不提交业务写入')
  }
})

test('客户查重校验失败不提交，错误展示且表单保持打开', async () => {
  const ui = customerHarness({ checkCustomerDuplicate: async () => [{ id: 99 }] })
  await ui.submit()
  assert.equal(ui.calls.create, 0, '疑似重复且未授权覆盖时不得创建')
  assert.match(ui.error.value, /疑似重复客户/)
  assert.equal(ui.customerDialog.value, true, '校验失败后表单保持打开')
  assert.equal(ui.actionLoading.value, false, '失败后解除提交中状态，允许修正后重试')
})

test('商机目录读取失败可重试：重试不触发重复业务提交', async () => {
  const ui = opportunityHarness()
  await ui.editor.openNew()
  assert.equal(ui.opportunityDialog.value, true, '目录失败时表单仍打开')
  assert.match(ui.opportunityCatalogError.value, /目录暂时不可用/)
  assert.equal(ui.opportunityCatalogLoading.value, false, '失败后解除加载态，允许重试')
  ui.form.name = '商机甲'
  ui.form.customer_id = '5'
  ui.form.expected_amount = '100.00'
  ui.form.expected_sign_date = '2026-12-01'
  ui.form.requirement_summary = '建设需求'

  // 目录未加载成功时提交必须被挡住：空目录不能被当成有效选择。
  await ui.submit()
  assert.equal(ui.calls.create, 0, '目录失败时不得创建商机')
  assert.match(ui.error.value, /目录暂时不可用/)

  // 重试只重新读取目录，不产生任何业务写入。
  ui.setCatalogAvailable()
  await ui.editor.loadCatalogOptions()
  assert.equal(ui.opportunityCatalogError.value, '')
  assert.equal(ui.calls.create, 0, '目录重试不得触发创建')
  assert.equal(ui.form.name, '商机甲', '重试期间父层表单内容不丢')

  // 目录恢复但还没选类型/来源时，仍然只落校验提示，不提交。
  await ui.submit()
  assert.equal(ui.calls.create, 0, '校验失败不得创建商机')
  assert.match(ui.error.value, /请至少选择一个商机类型和一个来源/)

  ui.editor.toggleType(1, true)
  ui.editor.toggleSource(2, true)
  await ui.submit()
  assert.equal(ui.calls.create, 1, '目录恢复后一次提交只创建一次')
  assert.deepEqual(ui.form.type_ids, [1])
  assert.deepEqual(ui.form.source_ids, [2])
  assert.equal(ui.form.type, '新建', '提交载荷沿用目录展示名')
  assert.equal(ui.form.source, '转介绍')
  assert.equal(ui.opportunityDialog.value, false)
  assert.equal(ui.calls.refresh, 1)
})

test('编辑商机只提交一次：更新载荷仍带版本与更新原因', async () => {
  const payloads = []
  const ui = opportunityHarness({ updateOpportunity: async (id, payload) => { payloads.push({ id, payload }); return { id, version: 9 } } })
  ui.setCatalogAvailable()
  ui.selectedOpportunityOwnerOrgID.value = 'org-9'
  ui.selectedOpportunity.value = {
    id: 'o7', customer_id: '5', name: '商机甲', type: '新建', source: '转介绍',
    types: [{ id: 1, name: '新建' }], sources: [{ id: 2, name: '转介绍' }],
    expected_amount: '100.00', expected_sign_date: '2026-12-01', requirement_summary: '需求',
    system_count: 2, pain_points: '', competitor_info: '', owner_user_id: 'u1', version: 3,
  }
  await ui.editor.openEdit(ui.selectedOpportunity.value)
  assert.equal(ui.opportunityEditMode.value, true)
  assert.deepEqual(ui.opportunityTypeSelections.value, [1], '编辑态回填已选类型')
  assert.equal(ui.form.owner_org_id, 'org-9', '负责人组织沿用服务端返回的归属')
  ui.form.name = '商机甲（更新）'
  ui.form.reason = '补充需求摘要'
  await ui.submit()
  assert.equal(payloads.length, 1)
  assert.equal(payloads[0].id, 'o7')
  assert.equal(payloads[0].payload.version, 3)
  assert.equal(payloads[0].payload.reason, '补充需求摘要')
  assert.equal('customer_id' in payloads[0].payload, false, '普通更新不接受客户归属字段')
  assert.equal(ui.opportunityDialog.value, false)
})

test('弹窗代码块加载是惰性的：建立异步边界不加载、失败重试只换实例且不触发提交', () => {
  // 动态导入边界写在页面里，子组件只被 import() 引用，静态依赖不进入主包/首屏。
  assert.match(viewSource, /const loadCustomerEditorDialog = \(\) => import\('\.\.\/components\/CustomerEditorDialog\.vue'\)/)
  assert.match(viewSource, /const loadOpportunityEditorDialog = \(\) => import\('\.\.\/components\/OpportunityEditorDialog\.vue'\)/)
  assert.match(viewSource, /defineAsyncComponent\(\{[\s\S]*?loader: loadCustomerEditorDialog/)
  assert.match(viewSource, /defineAsyncComponent\(\{[\s\S]*?loader: loadOpportunityEditorDialog/)

  const loaded = []
  const created = []
  const state = {
    customerEditorDialog: shallowRef(null),
    opportunityEditorDialog: shallowRef(null),
  }
  const deps = {
    ...state,
    loadCustomerEditorDialog: async () => { loaded.push('customer'); return { default: { name: 'CustomerEditorDialog' } } },
    loadOpportunityEditorDialog: async () => { loaded.push('opportunity'); return { default: { name: 'OpportunityEditorDialog' } } },
    defineAsyncComponent: (options) => { created.push(options); return { __async: options } },
    defineComponent: (options) => options,
    h: (component, props) => ({ component, props }),
    ErrorState: { name: 'ErrorState' },
    LoadingState: { name: 'LoadingState' },
  }
  const names = ['createCustomerEditorDialog', 'retryCustomerEditorDialog', 'createOpportunityEditorDialog', 'retryOpportunityEditorDialog']
  const host = new Function(...Object.keys(deps), `${functionSources(viewScript, names)}; return { ${names.join(',')} };`)(...Object.values(deps))

  const customerBoundary = host.createCustomerEditorDialog()
  const opportunityBoundary = host.createOpportunityEditorDialog()
  assert.equal(loaded.length, 0, '建立异步边界时不得提前加载代码块')
  assert.equal(customerBoundary.__async.loader, deps.loadCustomerEditorDialog)
  assert.equal(opportunityBoundary.__async.loader, deps.loadOpportunityEditorDialog)
  // 加载失败时由错误面板提供显式重试：重试只替换异步组件实例，不调用任何业务接口。
  const failureProps = customerBoundary.__async.errorComponent.setup()().props
  assert.equal(failureProps.onRetry, host.retryCustomerEditorDialog)
  assert.match(failureProps.title, /客户表单加载失败/)
  const before = state.customerEditorDialog.value
  host.retryCustomerEditorDialog()
  assert.notEqual(state.customerEditorDialog.value, before, '重试替换为新的异步组件实例')
  assert.equal(loaded.length, 0, '重试本身仍不直接执行加载器')
  assert.equal(created.length, 3, '两个初始边界 + 一次重试')

  // 子组件不得自行提交：没有创建/更新接口导入，提交只经由父层的事件接线。
  for (const source of [customerDialogSource, opportunityDialogSource]) {
    assert.doesNotMatch(source, /from '\.\.\/api\//, '弹窗子组件不得导入业务 API')
    assert.doesNotMatch(source, /createCustomer\(|updateCustomer\(|createOpportunity\(|updateOpportunity\(/)
    assert.match(source, /@submit\.prevent="emit\('submit'\)"/)
  }
  assert.match(viewSource, /@submit="submitCustomer"/)
  assert.match(viewSource, /@submit="submitOpportunity"/)
  assert.doesNotMatch(viewSource, /@click="submitCustomer"/)
})
