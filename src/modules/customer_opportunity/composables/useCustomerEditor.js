import { emptyCustomer } from '../crmDisplay.js'

/**
 * 客户新建/编辑弹窗的编辑域（前端优化计划 阶段 3-CRM，自 CustomerOpportunityView.vue 迁移）。
 *
 * 职责边界：
 * - 表单对象、弹窗开关、编辑态与脏检查基线都由父层创建并持有，这里通过同一引用回填/清空，
 *   因此弹窗组件异步加载、加载失败重试或重新挂载都不会产生第二份表单，已输入内容不丢；
 * - 只做“把表单填成新建/编辑该有的样子”与联系人行的增删，不持有提交入口：
 *   创建/更新（更新原因、查重、幂等重放）仍由父层 submitCustomer 唯一执行，子组件只上抛 submit；
 * - 关闭确认（未保存拦截）留在父层 closeCustomerDialog，避免与别的草稿共用确认框时出现两条路径。
 *
 * 注入项与组件内同名标识一一对应：form（父层 customerForm 同一份 reactive 对象）、
 * dialog/editMode（父层弹窗状态）、setSnapshot（父层登记脏检查基线）。
 */
export function useCustomerEditor({ form, dialog, editMode, setSnapshot }) {
  // 用途：登记打开时的表单快照并显示弹窗；新建与编辑共用，避免两处基线写法分叉。
  // 参数：无；读取当前表单。
  // 返回值：无。
  function markOpened() {
    setSnapshot(JSON.stringify(form))
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
  // 参数：customer 为客户详情；信用代码与联系人电话/邮箱只回填空值表示“不提交变更”，
  //       由 submitCustomer 只把用户重新输入的敏感字段放入更新载荷，服务端保留其余原密文。
  // 返回值：无；不请求任何接口。
  function openEdit(customer) {
    Object.assign(form, {
      name: customer.name, unified_credit_code: '', customer_type: customer.customer_type, industry: customer.industry,
      region: customer.region, owner_user_id: customer.owner_user_id, owner_org_id: customer.owner_org_id || '', reason: '',
      duplicate_override: false, duplicate_override_reason: '',
      contacts: (customer.contacts || []).map((item) => ({ id: item.id, name: item.name, phone: '', email: '', is_registration: item.is_registration })),
    })
    editMode.value = true
    markOpened()
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

  return { openNew, openEdit, addContact, removeContact }
}
