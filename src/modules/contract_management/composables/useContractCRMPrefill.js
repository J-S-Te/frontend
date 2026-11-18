import { computed, getCurrentScope, onScopeDispose, ref, watch } from 'vue'

const TEMPLATE_FIELDS = [
  { key: 'customer_name', group: 'customer', names: ['customername', '客户名称', '单位名称'] },
  { key: 'customer_contact', group: 'customer', names: ['customercontact', '客户联系人'] },
  { key: 'title', group: 'opportunity', names: ['contracttitle', 'contractname', '合同名称', '合同标题'] },
  { key: 'opportunity_name', group: 'opportunity', names: ['opportunityname', '商机名称'] },
  { key: 'requirement', group: 'opportunity', names: ['requirementsummary', '需求摘要', '需求描述', '需求说明'] },
]

// 用途：只预填新建合同的空白或未被手工修改的自动值，隔离迟到联系人请求。
// 参数：options包含表单、模板、编辑状态、联系人读取接口和既有错误处理。
// 返回值：预填/清除动作与读取、错误、核对提示状态；不提交任何业务写入。
export function useContractCRMPrefill({ newContract, selectedContractTemplate,
  createDialogOpen, contractCreating, editingContract, listContacts, onError, formatError }) {
  const managed = new Map()
  const crmPrefillLoading = ref(false)
  const crmPrefillError = ref('')
  const notices = ref({ customer: '', opportunity: '' })
  const crmPrefillNotice = computed(() => Object.values(notices.value).filter(Boolean).join(' '))
  let requestID = 0
  let lastCustomerID = ''
  let manualFields = new WeakMap()
  let automaticWrites = 0
  // 请求不取消用户会话；离开组件时仅失效回填票据。
  if (getCurrentScope()) onScopeDispose(() => { requestID += 1 })

  // 用途：限制预填仅发生在打开且未保存的新建表单中。
  // 参数：无。
  // 返回值：当前是否允许自动写入表单。
  function enabled() {
    return createDialogOpen.value && !contractCreating.value && !editingContract.value
  }

  // 用途：记住本表单中手工修改的具体字段，包括主动清空。
  // 参数：target为字段所属对象，key为字段名。
  // 返回值：无；标记不进入提交表单。
  function rememberManualField(target, key) {
    if (!manualFields.has(target)) manualFields.set(target, new Set())
    manualFields.get(target).add(key)
  }

  // 用途：写自动值时区分同步触发的观察器与用户输入。
  // 参数：target/key为目标字段，value为自动值。
  // 返回值：无。
  function writeAutomatic(target, key, value) {
    automaticWrites += 1
    try { target[key] = value }
    finally { automaticWrites -= 1 }
  }

  // 用途：记录自动值的实际目标，手工改过的非空值保持不变。
  // 参数：group为来源，token为字段身份，target/key为目标位置，value为候选值，max为长度上限。
  // 返回值：无；超过字段上限的内容不截断写入。
  function fillField(group, token, target, key, value, max) {
    if (!target || manualFields.get(target)?.has(key)) return
    const id = `${group}:${token}`
    const previous = managed.get(id)
    const current = String(target[key] ?? '')
    const owned = previous?.target === target && current === previous.value
    const next = String(value ?? '').trim()
    if ((previous?.target === target && !owned) || (current.trim() && !owned)) {
      rememberManualField(target, key)
      return
    }
    if (next.length > max) return
    if (next) managed.set(id, { target, key, value: next })
    else managed.delete(id)
    if (current !== next) writeAutomatic(target, key, next)
  }

  // 用途：清除指定来源仍保持自动值的字段，保留手工修改。
  // 参数：group为客户或商机来源。
  // 返回值：无。
  function clearGroup(group) {
    for (const [id, entry] of [...managed]) {
      if (!id.startsWith(`${group}:`) || managed.get(id) !== entry) continue
      managed.delete(id)
      if (String(entry.target[entry.key] ?? '') === entry.value) {
        writeAutomatic(entry.target, entry.key, '')
      } else rememberManualField(entry.target, entry.key)
    }
  }

  // 用途：把明确对应业务字段的值同步到模板，管理员预设与手填值保持。
  // 参数：无；读取当前表单和模板。
  // 返回值：无；名称或标签对应多个来源时不猜测。
  function fillTemplate() {
    if (!enabled()) return
    const form = newContract.value
    const values = { ...form, requirement: form.service_items?.length === 1
      ? form.service_items[0].requirement : '' }
    for (const field of selectedContractTemplate.value?.fields || []) {
      if (field.locked || String(field.default ?? '').trim()) continue
      const identifiers = [field.name, field.label].map((value) =>
        String(value ?? '').trim().toLowerCase().replace(/[\s_-]+/g, ''))
      const matches = TEMPLATE_FIELDS.filter((item) =>
        identifiers.some((name) => item.names.includes(name)))
      if (matches.length !== 1) continue
      const item = matches[0]
      fillField(item.group, `template:${field.name}`, form.template_values,
        field.name, values[item.key], 2000)
    }
  }

  // 用途：移除关联商机时清理其自动字段，不触碰客户资料与手填内容。
  // 参数：无。
  // 返回值：无。
  function clearCRMOpportunityPrefill() {
    clearGroup('opportunity')
    notices.value.opportunity = ''
  }

  // 用途：移除客户时使联系人请求失效，并清除该关联的自动内容。
  // 参数：无。
  // 返回值：无。
  function clearCRMCustomerPrefill() {
    requestID += 1
    lastCustomerID = ''
    crmPrefillLoading.value = false
    crmPrefillError.value = ''
    notices.value.customer = ''
    clearGroup('customer')
    clearCRMOpportunityPrefill()
  }

  // 用途：从已有商机补齐合同名称、金额和唯一服务项需求。
  // 参数：item为当前用户已选择的CRM商机记录。
  // 返回值：无；需求超长或服务项不唯一时给出核对提示。
  function autofillOpportunity(item) {
    if (!enabled()) return
    clearCRMOpportunityPrefill()
    const form = newContract.value
    fillField('opportunity', 'title', form, 'title', item.name || item.title || item.opportunity_name, 255)
    fillField('opportunity', 'amount', form, 'amount', item.expected_amount, 32)
    const summary = String(item.requirement_summary ?? '').trim()
    if (summary.length > 1000) notices.value.opportunity = '商机需求超过 1000 字，请核对后填写，不自动截断。'
    else if (summary && form.service_items?.length !== 1) {
      notices.value.opportunity = '当前有多个服务项，请核对并分配商机需求。'
    } else fillField('opportunity', 'requirement', form.service_items?.[0], 'requirement', summary, 1000)
    fillTemplate()
  }

  // 用途：观察可自动带入的字段变化，保留用户输入与清空意图。
  // 参数：无；读取当前表单及明确可映射的模板字段。
  // 返回值：字段对象、名称和值的快照，新表单或新模板目标不会继承旧脏标记。
  function editableFieldSnapshot() {
    const form = newContract.value
    const fields = ['title', 'amount', 'customer_contact'].map((key) => [form, key])
    for (const item of form.service_items || []) fields.push([item, 'requirement'])
    for (const field of selectedContractTemplate.value?.fields || []) {
      const names = [field.name, field.label].map((value) =>
        String(value ?? '').trim().toLowerCase().replace(/[\s_-]+/g, ''))
      if (form.template_values && TEMPLATE_FIELDS.some((item) =>
        names.some((name) => item.names.includes(name)))) fields.push([form.template_values, field.name])
    }
    return fields.map(([target, key]) => ({ target, key, value: String(target[key] ?? '') }))
  }

  // 用途：读取当前客户联系人，只带入唯一注册联系人或唯一联系人姓名。
  // 参数：customerID为当前表单中已关联的CRM客户编号。
  // 返回值：异步完成；失败显示可重试错误，过期响应不修改表单。
  async function autofillCustomer(customerID) {
    const id = String(customerID || '')
    if (!enabled() || !id || id !== String(newContract.value.customer_id)) return
    if (lastCustomerID !== id) clearGroup('customer')
    lastCustomerID = id
    const ticket = ++requestID
    const form = newContract.value
    // 用途：校验响应仍属于本次新建表单及客户，且保存尚未开始。
    // 参数：无。
    // 返回值：当前响应是否仍可安全回填。
    const isCurrent = () => ticket === requestID && enabled()
      && newContract.value === form && String(form.customer_id) === id
    crmPrefillLoading.value = true
    crmPrefillError.value = ''
    notices.value.customer = ''
    fillTemplate()
    try {
      const contacts = await listContacts(id)
      if (!isCurrent()) return
      const registered = contacts.filter((item) => item.is_registration)
      const contact = registered.length === 1 ? registered[0] : contacts.length === 1 ? contacts[0] : null
      fillField('customer', 'contact', form, 'customer_contact', contact?.name, 128)
      if (!contact && contacts.length > 1) notices.value.customer = '客户有多个联系人，请核对后填写本次合同联系人。'
      fillTemplate()
    } catch (error) {
      if (!isCurrent()) return
      onError(error)
      crmPrefillError.value = formatError(error, { fallback: '读取客户联系人失败，请手工填写或重试。' })
    } finally {
      if (ticket === requestID) crmPrefillLoading.value = false
    }
  }

  watch(newContract, () => {
    managed.clear()
    manualFields = new WeakMap()
    clearCRMCustomerPrefill()
  }, { flush: 'sync' })
  watch([createDialogOpen, contractCreating, editingContract], () => {
    if (!enabled()) { requestID += 1; crmPrefillLoading.value = false }
  }, { flush: 'sync' })
  // 先记录手工输入，再同步模板；同步过程中的派生值不应被误标为手填。
  watch(editableFieldSnapshot, (next, previous) => {
    if (!enabled() || automaticWrites) return
    for (const field of next) {
      const before = previous?.find((item) => item.target === field.target && item.key === field.key)
      if (before && before.value !== field.value) rememberManualField(field.target, field.key)
    }
  }, { flush: 'sync' })
  watch(() => {
    const form = newContract.value
    return [selectedContractTemplate.value, form.template_values, form.customer_name,
      form.customer_contact, form.title, form.opportunity_name,
      form.service_items?.length === 1 ? form.service_items[0].requirement : '']
  }, fillTemplate, { flush: 'sync' })

  return { autofillCustomer, autofillOpportunity, clearCRMCustomerPrefill,
    clearCRMOpportunityPrefill, crmPrefillLoading, crmPrefillError, crmPrefillNotice }
}
