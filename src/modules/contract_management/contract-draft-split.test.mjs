// 合同草稿表单拆分（阶段 3-合同）的回归护栏。
//
// 拆分后职责边界：ContractManagementView.vue 仍持有外层 <form>、提交入口、关闭确认、错误定位与
// 原生必填校验；ContractDraftFields.vue 只渲染字段并发明确事件；useContractDraftEditor.js 持有
// 表单状态与编辑动作。本文件锁定四件事（拆分不得改变既有行为）：
// 1. 拆分后表单只提交一次（含重复点击/并发提交）；
// 2. 取消关闭不触发任何业务提交；
// 3. 校验失败不提交，且错误仍被定位到表单；
// 4. 异步读取失败可重试，重试不触发重复业务提交。
//
// 断言对象是仓库里的真实实现：静态部分直接读 SFC/组合式函数源码，行为部分从源码抽出真实函数执行。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { parse as parseSFC } from '@vue/compiler-sfc'
import { parse as parseJS } from '@babel/parser'
import { ref } from 'vue'

const viewSource = await readFile(new URL('./views/ContractManagementView.vue', import.meta.url), 'utf8')
const draftFieldsSource = await readFile(new URL('./components/ContractDraftFields.vue', import.meta.url), 'utf8')
const draftEditorSource = await readFile(new URL('./composables/useContractDraftEditor.js', import.meta.url), 'utf8')
const viewScript = parseSFC(viewSource).descriptor.scriptSetup.content

// 用途：从真实源码里抽出指定函数声明，用受控依赖执行（不复制实现，避免断言与实现分叉）。
// 参数：script 为源码文本；names 为目标函数名。组合式函数里的动作是内层声明，因此递归查找。
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

// 用途：构造提交/关闭所需的页面状态与接口替身，记录业务写入次数。
// 参数：overrides 覆盖默认替身。
// 返回值：含状态引用、调用计数与可执行函数的测试宿主。
function viewHarness(overrides = {}) {
  const calls = { create: 0, external: 0, saveDraft: 0, update: 0, submit: 0, toast: [], data: 0, focused: 0, invalidFocused: 0 }
  const state = {
    newContract: ref({ title: '合同 A', customer_id: '7', customer_name: '客户甲', opportunity_id: '', amount: '100', currency: 'CNY', payment_terms: [], service_items: [], template_id: 'template-a', template_values: { party: '甲方' } }),
    contractCreating: ref(false),
    draftEditConflict: ref(false),
    draftEditError: ref(''),
    editingContract: ref(null),
    selectedContractTemplate: ref({ id: 'template-a', fields: [] }),
    externalContractFile: ref(null),
    externalContractFileError: ref(''),
    externalContractFileInputKey: ref(0),
    isExternalContractMode: ref(false),
    createDialogOpen: ref(true),
    initiatedApprovals: ref([]),
    approvalTab: ref('tasks'),
    termsIdentical: ref(false),
    templatePreviewHTML: ref(''),
    draftErrorElement: { value: { focus: () => { calls.focused += 1 } } },
  }
  const deps = {
    ...state,
    syncManagedTemplateValues: () => {},
    buildNewContractPayload: () => ({ title: '合同 A', crm_customer_id: 7, payment_terms: [] }),
    validateExternalContract: () => {},
    refreshSelectedCRMAccess: async () => {},
    saveContractDraft: async () => { calls.saveDraft += 1; return { saved: { id: 'draft-a' }, approval: null } },
    createContract: async () => { calls.create += 1; return { contract: { id: 'contract-a', title: '合同 A' } } },
    createExternalContract: async () => { calls.external += 1; return { contract: { id: 'contract-b' } } },
    updateContractDraft: async () => { calls.update += 1; return {} },
    submitContract: async () => { calls.submit += 1; return { approval_id: 'approval-a' } },
    loadBusinessData: async () => { calls.data += 1 },
    showToast: (message) => { calls.toast.push(message) },
    nextTick: (callback) => callback?.(),
    document: { querySelector: () => ({ focus: () => { calls.invalidFocused += 1 } }) },
    saveContractResult: () => {},
    pushOperationRecord: () => {},
    emptyNewContract: () => ({ title: '', customer_id: '', payment_terms: [], service_items: [], template_id: '', template_values: {} }),
    initializingApproval: (approval) => ({ id: approval.approval_id }),
    normalizeContract: (item) => item,
    waitForInitiatedApproval: async () => {},
    formatUserError: (error, { fallback } = {}) => error?.message || fallback || '错误',
    recordCRMDirectoryError: () => {},
    draftHasUnsavedChanges: () => false,
    askConfirm: async () => false,
    closeDraftEditorNow: () => { state.createDialogOpen.value = false },
    ...overrides,
  }
  const names = ['submitNewContract', 'closeDraftEditor']
  const host = new Function(...Object.keys(deps), `${functionSources(viewScript, names)}; return { ${names.join(',')} };`)(...Object.values(deps))
  return { ...state, ...deps, calls, host }
}

test('拆分后草稿表单仍由页面提交一次：重复点击不会重复创建合同', async () => {
  const ui = viewHarness()
  const first = ui.host.submitNewContract({ submitter: { dataset: { action: 'save' } } })
  // 保存中再次提交（用户重复点击）必须被提交中状态挡住，不产生第二次业务写入。
  await ui.host.submitNewContract({ submitter: { dataset: { action: 'save' } } })
  await first
  assert.equal(ui.calls.create, 1, '一次保存只允许一次创建请求')
  assert.equal(ui.calls.external, 0)
  assert.equal(ui.calls.data, 1, '保存成功后只刷新一次业务数据')
  assert.equal(ui.createDialogOpen.value, false, '保存成功后关闭草稿弹窗')
  assert.deepEqual(ui.calls.toast, ['合同草稿已创建'])
})

test('取消关闭草稿不触发任何业务提交', async () => {
  const ui = viewHarness({ draftHasUnsavedChanges: () => true, askConfirm: async () => false })
  await ui.host.closeDraftEditor()
  assert.equal(ui.createDialogOpen.value, true, '放弃确认被取消时要留在表单')
  assert.deepEqual([ui.calls.create, ui.calls.external, ui.calls.saveDraft, ui.calls.update, ui.calls.submit], [0, 0, 0, 0, 0])

  const confirmed = viewHarness({ draftHasUnsavedChanges: () => true, askConfirm: async () => true })
  await confirmed.host.closeDraftEditor()
  assert.equal(confirmed.createDialogOpen.value, false, '确认放弃后关闭表单')
  assert.deepEqual([confirmed.calls.create, confirmed.calls.external, confirmed.calls.saveDraft, confirmed.calls.submit], [0, 0, 0, 0], '关闭确认本身不提交')
})

test('校验失败不提交，错误仍定位到草稿表单', async () => {
  const ui = viewHarness({
    buildNewContractPayload: () => { throw new Error('合同名称不能为空。') },
  })
  await ui.host.submitNewContract({ submitter: { dataset: { action: 'save' } } })
  assert.equal(ui.calls.create, 0, '校验失败不得创建合同')
  assert.equal(ui.calls.external, 0)
  assert.match(ui.draftEditError.value, /合同名称不能为空/)
  assert.equal(ui.createDialogOpen.value, true, '校验失败后表单保持打开')
  assert.equal(ui.calls.focused, 1, '错误提示获得焦点，便于定位')
  assert.equal(ui.calls.invalidFocused, 1, '同时定位到第一个原生校验失败的字段')
  assert.equal(ui.contractCreating.value, false, '失败后解除提交中状态，允许修正后重试')
})

test('外部合同校验失败同样不提交原件或元数据', async () => {
  const ui = viewHarness({
    isExternalContractMode: ref(true),
    externalContractFile: ref(new Blob(['docx'])),
    validateExternalContract: () => { throw new Error('请补全服务项 1 的实施场所。') },
  })
  await ui.host.submitNewContract({ submitter: { dataset: { action: 'save' } } })
  assert.equal(ui.calls.external, 0, '外部合同校验失败不得上传')
  assert.equal(ui.calls.create, 0)
  assert.match(ui.draftEditError.value, /实施场所/)
})

test('草稿异步读取失败可重试，重试不触发重复业务提交', async () => {
  // 直接执行组合式函数里的真实 editContractDraft：第一次读取失败 → 提示可重试；第二次成功 → 载入表单。
  const toasts = []
  const calls = { get: 0, save: 0, create: 0, close: 0 }
  const state = {
    draftEditLoading: ref(false),
    contractCreating: ref(false),
    editingContract: ref(null),
    newContract: ref({}),
    draftEditError: ref(''),
    draftEditConflict: ref(false),
    externalContractFile: ref(null),
    externalContractFileError: ref(''),
    createDialogOpen: ref(false),
    contractCreationMode: ref('template'),
    selectedContractTemplate: ref({ id: 'template-a', fields: [] }),
  }
  const deps = {
    ...state,
    getContract: async () => {
      calls.get += 1
      if (calls.get === 1) throw new Error('网络不可用')
      return { id: 'draft-a', version: 2, template_id: 'template-a', title: '恢复的草稿' }
    },
    hydrateContractDraft: (raw) => ({ title: raw.title, template_id: raw.template_id, payment_terms: [], service_items: [] }),
    closeContract: () => { calls.close += 1 },
    resetCRMDirectoryConnection: () => {},
    resetTemplatePreview: () => {},
    markDraftClean: () => {},
    loadDetectionCategoryOptions: async () => {},
    showToast: (message) => { toasts.push(message) },
    formatUserError: (error, { fallback } = {}) => error?.message || fallback || '错误',
    // 业务提交替身：任何一次读取或重试都不得触发。
    saveContractDraft: async () => { calls.save += 1 },
    createContract: async () => { calls.create += 1 },
  }
  const name = 'editContractDraft'
  const editContractDraft = new Function(...Object.keys(deps), `${functionSources(draftEditorSource, [name])}; return ${name};`)(...Object.values(deps))

  await editContractDraft({ id: 'draft-a' })
  assert.equal(calls.get, 1)
  assert.equal(state.draftEditError.value, '', '读取失败只提示，不写入表单错误')
  assert.match(toasts[0], /网络不可用/)
  assert.equal(state.createDialogOpen.value, false, '读取失败不打开空表单')

  await editContractDraft({ id: 'draft-a' })
  assert.equal(calls.get, 2, '重试会重新读取一次')
  assert.equal(state.createDialogOpen.value, true, '重试成功后进入编辑态')
  assert.equal(state.newContract.value.title, '恢复的草稿')
  assert.equal(calls.save + calls.create, 0, '读取与重试都不得触发业务提交')
})

test('字段子组件不持有提交入口，也不自行打开/关闭弹窗', () => {
  assert.doesNotMatch(draftFieldsSource, /<form\b/, '外层 <form> 必须留在页面')
  for (const forbidden of ['createContract(', 'createExternalContract(', 'saveContractDraft(', 'updateContractDraft(', 'submitContract(', 'fetch(', 'useRouter', 'router.replace']) {
    assert.ok(!draftFieldsSource.includes(forbidden), `子组件不得执行提交或路由动作：${forbidden}`)
  }
  // 明确事件契约：编辑动作只以事件形式回到页面。
  for (const event of ['select-mode', 'template-change', 'select-file', 'replace-form', 'open-customer-picker', 'focus-opportunity', 'add-service-item', 'remove-service-item', 'add-payment-term', 'remove-payment-term', 'preview-template']) {
    assert.match(draftFieldsSource, new RegExp(`['"]${event}['"]`), `缺少明确事件：${event}`)
  }
  // 页面保留提交入口、关闭确认与错误定位引用。
  assert.match(viewSource, /<form ref="createDialogElement" class="contract-detail-modal contract-create-modal"[^>]*@submit\.prevent="submitNewContract\(\$event\)"/)
  assert.match(viewSource, /<footer><button class="contract-button secondary" type="button" :disabled="contractCreating" @click="closeDraftEditor">取消<\/button>/)
  assert.match(viewSource, /data-action="approval"/)
  assert.match(viewSource, /ref="draftErrorElement"/)
  assert.match(viewSource, /draftErrorElement\.value\?\.focus\(\)/)
  assert.match(viewSource, /document\.querySelector\('\.contract-create-modal input:invalid, \.contract-create-modal select:invalid, \.contract-create-modal textarea:invalid'\)/)
  // 未保存改动拦截仍在页面：beforeunload / 路由离开 / 关闭确认。
  assert.match(viewSource, /useBeforeUnloadGuard\(computed\(\(\) => createDialogOpen\.value && !contractCreating\.value && draftHasUnsavedChanges\(\)\)\)/)
  assert.match(viewSource, /onBeforeRouteLeave\(async \(\) => \{/)
  assert.match(viewSource, /title: '放弃未保存的合同内容？'/)
})

test('文件对象语义与敏感字段排除规则在拆分后不变', () => {
  // 外部原件始终以 File 对象快照提交，不被序列化或转成路径字符串。
  assert.match(viewSource, /const fileSnapshot = externalContractFile\.value/)
  assert.match(viewSource, /createdContract = await createExternalContract\(fileSnapshot, payload\)/)
  assert.match(viewSource, /validateExternalContract\(formSnapshot, fileSnapshot, \{ editing: false \}\)/)
  assert.doesNotMatch(viewSource, /JSON\.stringify\(externalContractFile/)
  assert.doesNotMatch(draftFieldsSource, /JSON\.stringify\(externalContractFile/)
  // 请求体仍是显式白名单字段：不把整份表单（含模板替换值、本地来源扩展、敏感字段）直接展开进 payload。
  assert.match(viewSource, /const payload = \{/)
  assert.match(viewSource, /content: '',/)
  assert.doesNotMatch(viewSource, /const payload = \{\s*\.\.\.form/)
  // 本地来源引用只通过白名单函数进入请求，服务项身份仍按编辑态保留。
  assert.match(viewSource, /localContractReferencePayload\(\{ \.\.\.form, service_items: payload\.service_items \}\)/)
  assert.match(viewSource, /\.\.\.\(editing && serviceItem\.source_id \? \{ source_id: serviceItem\.source_id \} : \{\}\)/)
})
