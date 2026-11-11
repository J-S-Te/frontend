// 缺陷 1 回归护栏：编辑客户弹窗必须回填服务端联系人，且空/失败都不得提交空数组。
//
// 现场缺陷：客户详情端点有意省略敏感联系人，编辑弹窗直接用详情里的 contacts，
// 保存时 PUT /customers/{id} 的请求体出现 "contacts": []；后端 dto 要求
// contacts binding required,min=1 且恰好一个 is_registration，于是必然 400。
// 本文件执行页面真实实现（从 SFC 源码抽取函数），断言：
// 1. 打开编辑弹窗即调用 listCustomerContacts 并把权威联系人文回填到 customerForm.contacts；
// 2. 客户确实没有联系人时给可读提示且 submitCustomer 不发请求；
// 3. 联系人加载失败时错误可读、清空旧值且 submitCustomer 不发请求；
// 4. 切换编辑对象时迟到的联系人响应不写回；
// 5. 更新载荷仍按 {id,name,is_registration,phone?,email?} 映射，掩码电话/邮箱不回填。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { parse as parseSFC } from '@vue/compiler-sfc'
import { parse as parseJS } from '@babel/parser'
import { reactive, ref, toRaw } from 'vue'
import { useCustomerEditor } from './composables/useCustomerEditor.js'
import { emptyCustomer } from './crmDisplay.js'
import { createCreateMutationRetryState } from './createMutationRetry.js'

const viewSource = await readFile(new URL('./views/CustomerOpportunityView.vue', import.meta.url), 'utf8')
const viewScript = parseSFC(viewSource).descriptor.scriptSetup.content

// 用途：从真实源码里抽出指定函数声明，避免断言与实现分叉。
// 参数：script 为脚本源码；names 为函数名。
// 返回值：可拼进 new Function 的源码片段。
function functionSources(script, names) {
  const found = new Map()
  const walk = (node) => {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) { for (const item of node) walk(item); return }
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

// 用途：用真实函数构造编辑弹窗宿主，记录联系人读取与业务写入。
// 参数：overrides 覆盖默认替身。
// 返回值：页面状态、真实 useCustomerEditor、可执行的 editCustomer / submitCustomer。
function harness(overrides = {}) {
  const calls = { contacts: 0, update: 0, duplicate: 0, refresh: 0 }
  const form = reactive(emptyCustomer())
  // 脏检查基线由父层登记：用可变持有对象观察，避免从函数参数副本读取旧值。
  const snapshot = { value: '' }
  const dialog = ref(false)
  const editMode = ref(false)
  const selectedCustomer = ref({ id: 65, version: 7, name: '客户甲', customer_type: '企业', industry: '金融', region: '北京', owner_user_id: 'u1', owner_org_id: '' })
  const deps = {
    actionLoading: ref(false),
    error: ref(''),
    notice: ref(''),
    customerForm: form,
    customerDialog: dialog,
    customerEditMode: editMode,
    customerEditContactsLoading: ref(false),
    customerEditContactsError: ref(''),
    customerEditContactsLoadFailed: ref(false),
    customerEditContactsSequence: ref(0),
    selectedCustomer,
    toRaw,
    createMutationRetries: createCreateMutationRetryState(() => 'customer-create-key'),
    resetMessages: () => { deps.error.value = ''; deps.notice.value = '' },
    showError: (value) => { deps.error.value = value?.message || '错误' },
    notifyWithReference: (text) => { deps.notice.value = text },
    formatCRMError: (value, options) => value?.message || options?.fallback || '错误',
    listCustomerContacts: async (id) => { calls.contacts += 1; return [{ id: 11, name: '张三', phone: '138****0000', email: 'a***@b.com', is_registration: true }] },
    checkCustomerDuplicate: async () => { calls.duplicate += 1; return [] },
    createCustomer: async () => { throw new Error('编辑态不得创建') },
    updateCustomer: async (id, payload) => { calls.update += 1; return { id, version: 8, payload } },
    loadCurrent: async () => { calls.refresh += 1 },
    ...overrides,
  }
  const editor = useCustomerEditor({
    form,
    dialog,
    editMode,
    setSnapshot: (value) => { snapshot.value = value },
  })
  const bound = { ...deps, customerEditor: editor }
  const exportNames = ['editCustomer', 'addCustomerContact', 'submitCustomer']
  const built = new Function(...Object.keys(bound),
    `${functionSources(viewScript, exportNames)}; return { ${exportNames.join(',')} };`)(...Object.values(bound))
  return { ...bound, editor, calls, form, snapshot, ...built }
}

test('打开编辑弹窗即回填服务端联系人（不等联系人页签）', async () => {
  const ui = harness()
  const opening = ui.editCustomer()
  // 弹窗立即打开，联系人回填异步进行，避免用户面对空白弹窗。
  assert.equal(ui.customerDialog.value, true)
  assert.equal(ui.customerEditContactsLoading.value, true)
  await opening
  assert.equal(ui.calls.contacts, 1, '编辑时必须读取一侧权威联系人列表')
  assert.equal(ui.customerEditContactsLoading.value, false)
  assert.equal(ui.customerEditContactsError.value, '')
  assert.deepEqual(JSON.parse(JSON.stringify(ui.form.contacts)), [
    // 电话/邮箱是服务端掩码值，不能当成新值回填，否则会把掩码写回业务库。
    { id: 11, name: '张三', phone: '', email: '', is_registration: true },
  ])
})

test('客户确实没有联系人时提示可读原因并阻止提交空数组', async () => {
  const ui = harness({ listCustomerContacts: async () => [] })
  await ui.editCustomer()
  assert.equal(ui.customerEditContactsError.value, '该客户暂无联系人，请先添加并设置注册联系人。')
  assert.equal(ui.form.contacts.length, 0)
  ui.form.reason = '更新客户'
  await ui.submitCustomer()
  assert.equal(ui.calls.update, 0, '没有联系人时不得发出 contacts: []')
  assert.match(ui.error.value, /暂无联系人/)
  assert.equal(ui.customerDialog.value, true, '阻断时保持弹窗打开让用户补联系人')
  assert.equal(ui.actionLoading.value, false)
})

test('联系人加载失败：错误可读、清空旧值、阻止提交', async () => {
  const failing = async () => { throw Object.assign(new Error('联系人服务暂时不可用'), { status: 503 }) }
  const ui = harness({ listCustomerContacts: failing })
  await ui.editCustomer()
  assert.match(ui.customerEditContactsError.value, /联系人加载失败：联系人服务暂时不可用/)
  assert.equal(ui.form.contacts.length, 0, '失败时不能保留详情里的旧联系人')
  ui.form.reason = '更新客户'
  await ui.submitCustomer()
  assert.equal(ui.calls.update, 0)
  assert.match(ui.error.value, /联系人加载失败/)
})

test('联系人加载中提交被挡住', async () => {
  let release
  const ui = harness({ listCustomerContacts: () => new Promise((resolve) => { release = resolve }) })
  const opening = ui.editCustomer()
  ui.form.reason = '更新客户'
  await ui.submitCustomer()
  assert.equal(ui.calls.update, 0, '加载未完成时不得提交')
  assert.match(ui.error.value, /正在加载/)
  release([{ id: 11, name: '张三', is_registration: true }])
  await opening
})

test('切换编辑对象时迟到的联系人响应不写回', async () => {
  let resolveFirst
  const ui = harness({
    listCustomerContacts: async (id) => (id === 65
      ? new Promise((resolve) => { resolveFirst = resolve })
      : [{ id: 22, name: '李四', is_registration: true }]),
  })
  const first = ui.editCustomer()
  // 第一个客户还在加载联系人时切到另一个客户并重新打开编辑。
  ui.selectedCustomer.value = { id: 66, version: 3, name: '客户乙', customer_type: '企业', industry: '金融', region: '北京', owner_user_id: 'u2' }
  await ui.editCustomer()
  assert.deepEqual(ui.form.contacts.map((item) => item.name), ['李四'])
  resolveFirst([{ id: 11, name: '张三', is_registration: true }])
  await first
  assert.deepEqual(ui.form.contacts.map((item) => item.name), ['李四'], '上一个客户的迟到响应不得覆盖当前表单')
})

test('更新载荷按 id/name/is_registration 映射，留空的电话邮箱不提交', async () => {
  const payloads = []
  const ui = harness({
    updateCustomer: async (id, payload) => { payloads.push({ id, payload }); return { id, version: 8 } },
  })
  await ui.editCustomer()
  ui.form.reason = '补齐联系人信息'
  // 只重填一个电话；另一个联系人的电话/邮箱保持留空（掩码值不回填、空串不提交）。
  ui.form.contacts[0].phone = '13900000000'
  ui.form.contacts.push({ id: 0, name: '李四', phone: '', email: '', is_registration: false })
  await ui.submitCustomer()
  assert.equal(payloads.length, 1)
  assert.equal(payloads[0].id, 65)
  assert.equal(payloads[0].payload.version, 7, '更新必须带乐观锁版本')
  assert.equal(payloads[0].payload.reason, '补齐联系人信息')
  assert.deepEqual(payloads[0].payload.contacts, [
    { id: 11, name: '张三', is_registration: true, phone: '13900000000' },
    { id: 0, name: '李四', is_registration: false },
  ])
  assert.equal(ui.customerDialog.value, false)
})

test('提交时只允许一个登记联系人', async () => {
  const ui = harness({
    listCustomerContacts: async () => [
      { id: 11, name: '张三', is_registration: true },
      { id: 12, name: '李四', is_registration: true },
    ],
  })
  await ui.editCustomer()
  assert.equal(ui.form.contacts.length, 2, '回填不擅自改动登记标记，交给用户确认')
  await ui.submitCustomer()
  assert.equal(ui.calls.update, 0, '两个登记联系人会被后端 400，前端先拦住')
  assert.match(ui.error.value, /只能设置一个门户登记联系人/)
  ui.form.contacts[1].is_registration = false
  await ui.submitCustomer()
  assert.equal(ui.calls.update, 1)
})

test('回填联系人不会把自动填充误判成未保存修改', async () => {
  let release
  const ui = harness({ listCustomerContacts: () => new Promise((resolve) => { release = resolve }) })
  const opening = ui.editCustomer()
  // 打开时的基线只包含空白表单；用户没有输入时，回填后基线应同步到回填结果。
  release([{ id: 11, name: '张三', is_registration: true }])
  await opening
  assert.equal(JSON.stringify(ui.form), ui.snapshot.value)
  // 用户已改过字段时，回填不得覆盖脏检查基线（保留未保存提示）。
  const ui2 = harness()
  ui2.customerEditor.openEdit(ui2.selectedCustomer.value)
  ui2.form.name = '客户甲（改）'
  ui2.customerEditor.fillContacts([{ id: 11, name: '张三', is_registration: true }])
  assert.notEqual(JSON.stringify(ui2.form), ui2.snapshot.value)
})

test('读取失败后即使手动补录联系人也不允许提交（避免全量覆盖服务端清单）', async () => {
  const ui = harness({ listCustomerContacts: async () => { throw new Error('联系人服务暂时不可用') } })
  await ui.editCustomer()
  assert.equal(ui.customerEditContactsLoadFailed.value, true)
  ui.addCustomerContact()
  ui.form.contacts[0].name = '补录联系人'
  ui.form.contacts[0].phone = '13900000000'
  ui.form.contacts[0].is_registration = true
  ui.form.reason = '更新客户'
  await ui.submitCustomer()
  assert.equal(ui.calls.update, 0, '加载失败必须硬阻断，不能拿不完整清单覆盖服务端联系人')
  assert.match(ui.error.value, /联系人加载失败/)
})

test('客户没有联系人时补录一行会撤掉“暂无联系人”提示', async () => {
  const ui = harness({ listCustomerContacts: async () => [] })
  await ui.editCustomer()
  assert.match(ui.customerEditContactsError.value, /暂无联系人/)
  ui.addCustomerContact()
  assert.equal(ui.form.contacts.length, 1)
  assert.equal(ui.customerEditContactsError.value, '', '补录后提示不再成立')
  ui.form.contacts[0].name = '张三'
  ui.form.contacts[0].phone = '13900000000'
  ui.form.contacts[0].is_registration = true
  ui.form.reason = '维护首个联系人'
  await ui.submitCustomer()
  assert.equal(ui.calls.update, 1)
})
