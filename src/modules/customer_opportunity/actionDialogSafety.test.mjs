import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const view = await readFile(new URL('./views/CustomerOpportunityView.vue', import.meta.url), 'utf8')
const inbox = await readFile(new URL('./components/CreditApprovalInbox.vue', import.meta.url), 'utf8')
const rules = await readFile(new URL('./components/PresaleApprovalRulesPanel.vue', import.meta.url), 'utf8')

// 用途：从实际组件提取命名函数并注入隔离依赖，执行真实操作分支。
// 参数：source 为组件源码，name 为函数名，scope 为替代外部服务和响应式状态。
// 返回值：可执行的组件函数；找不到函数时测试失败。
function operation(source, name, scope) {
  const start = source.indexOf(`async function ${name}(`)
  assert.ok(start >= 0, `缺少操作 ${name}`)
  const end = source.indexOf('\n}', start) + 2
  return new Function(...Object.keys(scope), `${source.slice(start, end)}; return ${name}`)(
    ...Object.values(scope),
  )
}

// 用途：创建手动完成的弹窗结果，模拟用户操作期间页面状态变化。
// 参数：无。
// 返回值：含 promise 与 resolve 的待决结果。
function pendingDialog() {
  let resolve
  const promise = new Promise((done) => { resolve = done })
  return { promise, resolve }
}

test('禁用门户确认取消、换客户、失去权限或变忙均不发禁用请求', async () => {
  for (const change of ['cancel', 'customer', 'permission', 'busy', 'reason']) {
    const dialog = pendingDialog()
    const calls = []
    const scope = {
      selectedCustomer: { value: { id: 1, name: '源客户' } },
      portalAccessDisableLoading: { value: false },
      portalAccessDisableReason: { value: '停用原因' },
      canDisablePortalAccount: { value: true },
      portalDisableAvailable: { value: true },
      askConfirm: () => dialog.promise,
      disablePortalAccess: async (...args) => { calls.push(args) },
      portalAccessDisableRetries: { keyFor: () => ({ key: 'retry' }) },
      customerTabErrors: {}, notice: { value: '' },
      getPortalAccessStatus: async () => ({}), portalAccessStatus: { value: null },
      canReadPortalInvite: { value: false },
      window: { confirm: () => { throw new Error('禁用操作仍使用同步原生弹窗') } },
    }
    const run = operation(view, 'disableCurrentPortalAccess', scope)()
    if (change === 'customer') scope.selectedCustomer.value = { id: 2, name: '另一客户' }
    if (change === 'permission') scope.canDisablePortalAccount.value = false
    if (change === 'busy') scope.portalAccessDisableLoading.value = true
    if (change === 'reason') scope.portalAccessDisableReason.value = '已修改的原因'
    dialog.resolve(change !== 'cancel')
    await run
    assert.equal(calls.length, 0, change)
  }
})

test('合并客户确认期间源客户、目标或版本变化均不误合并新对象', async () => {
  for (const change of ['cancel', 'source', 'target', 'version', 'permission', 'busy']) {
    const dialog = pendingDialog()
    const calls = []
    const scope = {
      selectedCustomer: { value: { id: 1, name: '源客户', version: 3, status: 'ACTIVE' } },
      customerMergeForm: { target: { id: 2, name: '目标客户', version: 5 }, target_customer_id: '2', reason: '合并原因' },
      customerMergeDialog: { value: true }, actionLoading: { value: false },
      canMergeCustomer: { value: true }, resetMessages: () => {}, error: { value: '' },
      askConfirm: () => dialog.promise,
      mergeCustomers: async (...args) => { calls.push(args); return {} },
      loadCurrent: async () => {}, notice: { value: '' }, showError: (error) => { throw error },
      window: { confirm: () => { throw new Error('合并操作仍使用同步原生弹窗') } },
    }
    const run = operation(view, 'submitCustomerMerge', scope)()
    if (change === 'source') scope.selectedCustomer.value = { id: 4, name: '新客户', version: 1 }
    if (change === 'target') scope.customerMergeForm.target_customer_id = '6'
    if (change === 'version') scope.customerMergeForm.target.version++
    if (change === 'permission') scope.canMergeCustomer.value = false
    if (change === 'busy') scope.actionLoading.value = true
    dialog.resolve(change !== 'cancel')
    await run
    assert.equal(calls.length, 0, change)
  }
})

test('规则删除确认取消或待删规则版本变化后不发送请求', async () => {
  for (const change of ['cancel', 'version', 'permission', 'busy']) {
    const dialog = pendingDialog()
    const rule = { id: 7, version: 2, name: '售前规则' }
    const calls = []
    const scope = {
      canEdit: { value: true }, deletingRuleId: { value: '' }, saving: { value: false },
      rules: { value: [rule] }, askConfirm: () => dialog.promise,
      deletePresaleApprovalRule: async (...args) => { calls.push(args) },
      load: async () => true, error: { value: '' },
      formatCRMError: () => '删除失败',
      window: { confirm: () => { throw new Error('规则删除仍使用同步原生弹窗') } },
    }
    const run = operation(rules, 'remove', scope)(rule)
    if (change === 'version') rule.version++
    if (change === 'permission') scope.canEdit.value = false
    if (change === 'busy') scope.deletingRuleId.value = '8'
    dialog.resolve(change !== 'cancel')
    await run
    assert.equal(calls.length, 0, change)
  }
})

test('信用审批输入取消、权限或版本变化后不提交，驳回必须至少两字', async () => {
  for (const change of ['cancel', 'permission', 'version', 'busy', 'short']) {
    const dialog = pendingDialog()
    const item = { id: 3, version: 4 }
    let allowed = true
    const calls = []
    const scope = {
      canApprove: () => allowed, actionID: { value: '' }, items: { value: [item] },
      applicationID: (value) => String(value?.id || ''), error: { value: '' },
      askPrompt: () => dialog.promise, createIdempotencyKey: () => 'key',
      approveCustomerCreditApplication: async (...args) => { calls.push(args) },
      rejectCustomerCreditApplication: async (...args) => { calls.push(args) },
      load: async () => {}, formatCRMError: () => '审批失败',
      window: { prompt: () => { throw new Error('信用审批仍使用原生输入框') } },
    }
    const run = operation(inbox, 'decide', scope)(item, 'reject')
    if (change === 'permission') allowed = false
    if (change === 'version') item.version++
    if (change === 'busy') scope.actionID.value = '9'
    dialog.resolve(change === 'cancel' ? null : change === 'short' ? '一' : '不同意')
    await run
    assert.equal(calls.length, 0, change)
  }
})

test('信用审批确认使用捕获的申请编号、版本及去空格意见并释放忙锁', async () => {
  const calls = []
  const item = { id: 3, version: 4 }
  const scope = {
    canApprove: () => true, actionID: { value: '' }, items: { value: [item] },
    applicationID: (value) => String(value?.id || ''), error: { value: '' },
    askPrompt: async () => '  同意  ', createIdempotencyKey: () => 'key',
    approveCustomerCreditApplication: async (...args) => { calls.push(args) },
    rejectCustomerCreditApplication: async () => assert.fail('误调用驳回'),
    load: async () => {}, formatCRMError: () => '审批失败',
    window: { prompt: () => { throw new Error('信用审批仍使用原生输入框') } },
  }
  await operation(inbox, 'decide', scope)(item, 'approve')
  assert.deepEqual(calls, [[3, { opinion: '同意', version: 4 }, 'key']])
  assert.equal(scope.actionID.value, '')
})

test('门户禁用确认后保留原因与重试键并刷新权威状态', async () => {
  const calls = []
  const confirmed = []
  const scope = {
    selectedCustomer: { value: { id: 1, name: '客户' } },
    portalAccessDisableLoading: { value: false },
    portalAccessDisableReason: { value: '  停用原因  ' },
    canDisablePortalAccount: { value: true }, portalDisableAvailable: { value: true },
    askConfirm: async () => true,
    disablePortalAccess: async (...args) => { calls.push(args) },
    portalAccessDisableRetries: {
      keyFor: () => ({ key: 'stable-key', signature: 'coordinate' }),
      confirmSuccess: (...args) => { confirmed.push(args) },
    },
    customerTabErrors: {}, notice: { value: '' },
    portalAccessStatus: { value: null }, getPortalAccessStatus: async () => ({ access_status: 'DISABLED' }),
    canReadPortalInvite: { value: false },
    portalActivationURL: { value: 'old-url' }, portalInviteCopied: { value: true },
  }
  await operation(view, 'disableCurrentPortalAccess', scope)()
  assert.deepEqual(calls, [[1, { reason: '停用原因' }, 'stable-key']])
  assert.deepEqual(confirmed, [['coordinate', 'stable-key']])
  assert.equal(scope.portalAccessStatus.value.access_status, 'DISABLED')
  assert.equal(scope.portalAccessDisableLoading.value, false)
})

test('客户合并确认后提交两个客户的版本和原因', async () => {
  const calls = []
  const scope = {
    selectedCustomer: { value: { id: 1, name: '源客户', version: 3, status: 'ACTIVE' } },
    customerMergeForm: { target: { id: 2, name: '目标客户', version: 5 }, target_customer_id: '2', reason: '合并原因' },
    customerMergeDialog: { value: true }, actionLoading: { value: false },
    canMergeCustomer: { value: true }, resetMessages: () => {}, error: { value: '' },
    askConfirm: async () => true,
    mergeCustomers: async (...args) => { calls.push(args); return { migrated_counts: {} } },
    loadCurrent: async () => {}, notice: { value: '' }, showError: (error) => { throw error },
  }
  await operation(view, 'submitCustomerMerge', scope)()
  assert.deepEqual(calls, [[{
    source_customer_id: 1, target_customer_id: 2,
    source_version: 3, target_version: 5, reason: '合并原因',
  }]])
  assert.equal(scope.customerMergeDialog.value, false)
  assert.equal(scope.actionLoading.value, false)
})

test('规则删除确认后使用原规则版本且仅成功后重读', async () => {
  const rule = { id: 7, version: 2, name: '售前规则' }
  const calls = []
  const closings = []
  const scope = {
    canEdit: { value: true }, deletingRuleId: { value: '' }, saving: { value: false },
    editing: { value: 7 }, rules: { value: [rule] }, askConfirm: async () => true,
    deletePresaleApprovalRule: async (...args) => { calls.push(['delete', ...args]) },
    load: async () => { calls.push(['reload']); return true }, error: { value: '' },
    formatCRMError: () => '删除失败',
    closeEditor: () => closings.push('close'), reset: () => closings.push('reset'),
  }
  await operation(rules, 'remove', scope)(rule)
  assert.deepEqual(calls, [['delete', 7, 2], ['reload']])
  assert.equal(scope.deletingRuleId.value, '')
  assert.deepEqual(closings, ['close', 'reset'], '删掉当前编辑的规则后收起编辑区')
})

test('删除的不是当前编辑的规则时，编辑区保持展开', async () => {
  const rule = { id: 7, version: 2, name: '售前规则' }
  const calls = []
  const closings = []
  const scope = {
    canEdit: { value: true }, deletingRuleId: { value: '' }, saving: { value: false },
    editing: { value: 9 }, rules: { value: [rule] }, askConfirm: async () => true,
    deletePresaleApprovalRule: async (...args) => { calls.push(['delete', ...args]) },
    load: async () => { calls.push(['reload']); return true }, error: { value: '' },
    formatCRMError: () => '删除失败',
    closeEditor: () => closings.push('close'), reset: () => closings.push('reset'),
  }
  await operation(rules, 'remove', scope)(rule)
  assert.deepEqual(calls, [['delete', 7, 2], ['reload']])
  assert.deepEqual(closings, [], '编辑别的规则时删除不应打断编辑')
})
