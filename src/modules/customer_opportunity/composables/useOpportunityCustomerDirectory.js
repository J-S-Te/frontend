import { ref } from 'vue'

/**
 * 商机表单「所属客户」下拉目录的状态与加载（治理批次 3 CRM 第二步）。
 * 收编：客户选项列表、关键字、加载/失败状态、总数与请求序号守卫，函数体逐字迁移
 * （editMode 守卫与选中清理经注入回调接入）。仍属父组件的职责（不在此处）：
 * 商机表单本体、编辑模式开关与打开弹窗时的加载编排。
 *
 * 注入项与组件内同名标识一一对应：listCustomers/formatCRMError/isDialogOpen/
 * selectedCustomerID/clearSelectedCustomer；不直接导入 API 模块，保持可独立测试。
 */
export function useOpportunityCustomerDirectory({ listCustomers, formatCRMError, isDialogOpen, selectedCustomerID, clearSelectedCustomer }) {
  const opportunityCustomerOptions = ref([])
  const opportunityCustomerOptionsLoading = ref(false)
  const opportunityCustomerOptionsError = ref('')
  const opportunityCustomerOptionsTotal = ref(0)
  const opportunityCustomerKeyword = ref('')
  const opportunityCustomerOptionsLoadSequence = ref(0)

  async function loadOpportunityCustomerOptions() {
    const sequence = ++opportunityCustomerOptionsLoadSequence.value
    opportunityCustomerOptionsLoading.value = true
    opportunityCustomerOptionsError.value = ''
    try {
      const result = await listCustomers({
        keyword: opportunityCustomerKeyword.value.trim(), status: 'ACTIVE',
        page: 1, page_size: 100, sort_by: 'name', sort_order: 'asc',
      })
      if (sequence !== opportunityCustomerOptionsLoadSequence.value || isDialogOpen()) return
      opportunityCustomerOptions.value = result?.items || []
      opportunityCustomerOptionsTotal.value = Number(result?.total || 0)
      if (selectedCustomerID() && !opportunityCustomerOptions.value.some((item) => String(item.id) === String(selectedCustomerID()))) {
        clearSelectedCustomer()
      }
    } catch (value) {
      if (sequence !== opportunityCustomerOptionsLoadSequence.value) return
      opportunityCustomerOptions.value = []
      opportunityCustomerOptionsTotal.value = 0
      opportunityCustomerOptionsError.value = formatCRMError(value, { fallback: '客户列表加载失败，请稍后重试。' })
    } finally {
      if (sequence === opportunityCustomerOptionsLoadSequence.value) opportunityCustomerOptionsLoading.value = false
    }
}


  return {
    opportunityCustomerOptions, opportunityCustomerOptionsLoading, opportunityCustomerOptionsError,
    opportunityCustomerOptionsTotal, opportunityCustomerKeyword, loadOpportunityCustomerOptions,
  }
}
