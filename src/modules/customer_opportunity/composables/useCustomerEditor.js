import { emptyCustomer } from '../crmDisplay.js'

// 用途：把服务端联系人（列表/详情）折叠成弹窗提交用的表单行。
// 参数：item 为服务端联系人；电话与邮箱在服务端只返回掩码值，不能当成新值回填，
//       因此这里统一留空，由用户在“留空表示保持原值”的语义下决定是否重填。
// 返回值：客户更新载荷可复用的联系人行。
function contactRow(item) {
  return { id: item.id, name: item.name, phone: '', email: '', is_registration: Boolean(item.is_registration) }
}

/**
 * 客户新建/编辑弹窗的编辑域（前端优化计划 阶段 3-CRM，自 CustomerOpportunityView.vue 迁移）。
 *
 * 职责边界：
 * - 表单对象、弹窗开关、编辑态与脏检查基线都由父层创建并持有，这里通过同一引用回填/清空，
 *   因此弹窗组件异步加载、加载失败重试或重新挂载都不会产生第二份表单，已输入内容不丢；
 * - 只做“把表单填成新建/编辑该有的样子”、联系人行回填与增删，不持有提交入口：
 *   创建/更新（更新原因、查重、幂等重放）仍由父层 submitCustomer 唯一执行，子组件只上抛 submit；
 * - 关闭确认（未保存拦截）留在父层 closeCustomerDialog，避免与别的草稿共用确认框时出现两条路径。
 *
 * 注入项与组件内同名标识一一对应：form（父层 customerForm 同一份 reactive 对象）、
 * dialog/editMode（父层弹窗状态）、setSnapshot（父层登记脏检查基线）。
 */
export function useCustomerEditor({ form, dialog, editMode, setSnapshot }) {
  // 打开弹窗时的表单基线：联系人由服务端权威列表异步回填，回填后需要判断用户是否已经改过其他字段。
  let openedState = ''

  // 用途：登记打开时的表单快照并显示弹窗；新建与编辑共用，避免两处基线写法分叉。
  // 参数：无；读取当前表单。
  // 返回值：无。
  function markOpened() {
    openedState = JSON.stringify(form)
    setSnapshot(openedState)
    dialog.value = true
  }

  // 用途：打开空白的新建客户表单。
  // 参数：无。
  // 返回值：无；不请求任何接口。
  function openNew() {
    Object.assign(form, emptyCustomer())
    editMode.value = false
    markOpened()
  }

  // 用途：用当前选中客户回填编辑表单。
  // 参数：customer 为客户详情；contacts 为 listCustomerContacts 返回的权威联系人列表
  //       （可选：缺省时退回详情里的 contacts，仅用于兼容调用方未预取的情况）。
  //       信用代码与联系人电话/邮箱只回填空值表示“不提交变更”，
  //       由 submitCustomer 只把用户重新输入的敏感字段放入更新载荷，服务端保留其余原密文。
  // 返回值：无；本函数自身不请求接口，联系人的网络读取由父层 editCustomer 负责。
  function openEdit(customer, contacts) {
    const source = Array.isArray(contacts) ? contacts : (customer.contacts || [])
    Object.assign(form, {
      name: customer.name, unified_credit_code: '', customer_type: customer.customer_type, industry: customer.industry,
      region: customer.region, owner_user_id: customer.owner_user_id, owner_org_id: customer.owner_org_id || '', reason: '',
      duplicate_override: false, duplicate_override_reason: '',
      contacts: source.map(contactRow),
    })
    editMode.value = true
    markOpened()
  }

  // 用途：用服务端权威联系人列表覆盖弹窗里的联系人行（编辑弹窗打开后异步回填）。
  // 参数：contacts 为 listCustomerContacts 返回的数组；非数组按空列表处理。
  // 返回值：无。
  function fillContacts(contacts) {
    const before = JSON.stringify(form)
    const rows = (Array.isArray(contacts) ? contacts : []).map(contactRow)
    form.contacts.splice(0, form.contacts.length, ...rows)
    // 自动回填不应被当成“未保存的修改”：只有在回填前用户没改过任何字段时，
    // 才把回填后的表单并入打开基线；已经改过则保留原来的基线，避免丢掉未保存提示。
    if (before !== openedState) return
    openedState = JSON.stringify(form)
    setSnapshot(openedState)
  }

  // 用途：清空弹窗里的联系人行。
  // 参数：无。
  // 返回值：无。
  function clearContacts() {
    form.contacts.splice(0, form.contacts.length)
  }

  // 用途：追加一个空联系人行。
  // 参数：无。
  // 返回值：无。
  function addContact() {
    form.contacts.push({ id: 0, name: '', phone: '', email: '', is_registration: false })
  }

  // 用途：删除指定联系人行；至少保留一行，删掉门户登记联系人时把登记标记顺延到第一行。
  // 参数：index 为联系人位置。
  // 返回值：无；越界或只剩一行时忽略。
  function removeContact(index) {
    if (form.contacts.length <= 1 || index < 0 || index >= form.contacts.length) return
    const [removed] = form.contacts.splice(index, 1)
    if (removed?.is_registration && !form.contacts.some((item) => item.is_registration)) {
      form.contacts[0].is_registration = true
    }
  }

  return { openNew, openEdit, fillContacts, clearContacts, addContact, removeContact }
}
