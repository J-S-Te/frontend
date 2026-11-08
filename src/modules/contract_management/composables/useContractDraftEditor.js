import { computed, ref } from 'vue'
import { getContract } from '@/modules/contract_management/api/contract'
import { buildTemplateValues } from '@/modules/contract_management/utils/currentUserPrefill'
import { emptyNewContract, emptyServiceItem } from '@/modules/contract_management/utils/contractDisplay'
import { hydrateContractDraft } from '@/modules/contract_management/utils/contractDraft'
import { normalizePaymentTerms } from '@/modules/contract_management/utils/paymentTerms'
import { synchronizeContractTemplateValues } from '@/modules/contract_management/utils/systemTemplateFields'
import { createFormSnapshot, hasUnsavedChanges } from '@/modules/shared/utils/unsavedChanges.js'
import { formatUserError } from '@/modules/shared/utils/userError.js'

/**
 * 合同草稿编辑器状态与编辑动作（治理批次 3 合同页，自 ContractManagementView.vue 逐字迁移）。
 *
 * 职责边界：本组合式函数只持有“表单里写了什么”和“用户怎样编辑它”，
 * 不持有提交入口（save/approve）、关闭确认、错误聚焦与目录/CRM 读取：
 * - 提交入口仍由页面持有，页面是唯一业务提交者；
 * - `closeDraftEditor`（未保存改动拦截）与 beforeunload/路由守卫仍由页面持有；
 * - `draftErrorElement` 与原生必填校验焦点仍由页面持有。
 *
 * 注入项：route/session/contractTemplates（只读上下文）、termsIdentical（页面持有的一致性勾选）、
 * closeContract/resetCRMDirectoryConnection/resetTemplatePreview/loadDetectionCategoryOptions/showToast（页面动作）。
 * 返回值：草稿表单状态、防重复提交态、脏检查、行编辑动作与草稿打开/关闭动作。
 */
export function useContractDraftEditor({
  route,
  session,
  contractTemplates,
  termsIdentical,
  closeContract,
  resetCRMDirectoryConnection,
  resetTemplatePreview,
  invalidateDetectionCategoryRequest,
  loadDetectionCategoryOptions,
  showToast,
}) {
  // 表单与创建方式：newContract 保留本地目录来源（counterparty_source/category_source）等可选扩展字段。
  const newContract = ref(emptyNewContract())
  const contractCreationMode = ref('template')
  const externalContractFile = ref(null)
  const externalContractFileError = ref('')
  // 文件输入重置键：选择失败或重开表单时强制重建 <input type="file">，避免残留旧文件名。
  const externalContractFileInputKey = ref(0)
  const editingContract = ref(null)
  const contractCreating = ref(false)
  const draftEditLoading = ref(false)
  const draftEditError = ref('')
  const draftEditConflict = ref(false)
  const createDialogOpen = ref(false)
  // 脏检查基线：打开/载入草稿时的表单快照与是否已选外部原件。
  const draftInitialSnapshot = ref('')
  const draftInitialHadFile = ref(false)
  const selectedContractTemplate = computed(() => contractTemplates.value.find((item) => item.id === newContract.value.template_id) || null)
  const canAddServiceItem = computed(() => newContract.value.service_items.length < 20 && Boolean(newContract.value.service_items.at(-1)?.service_type))
  const paymentPlanError = computed(() => {
    try { normalizePaymentTerms(newContract.value.payment_terms, newContract.value.amount, newContract.value.currency); return '' }
    catch (error) { return formatUserError(error, { fallback: '付款计划未通过校验，请核对金额、分期与日期。' }) }
  })

  // 用途：记录当前表单为“已保存基线”，供关闭确认与 beforeunload 判断是否有未保存改动。
  // 参数：无；读取当前表单与外部原件。
  // 返回值：无。
  function markDraftClean() {
    draftInitialSnapshot.value = createFormSnapshot(newContract.value)
    draftInitialHadFile.value = Boolean(externalContractFile.value)
  }

  // 用途：判断草稿是否有未保存改动（表单字段或外部原件选择变化）。
  // 参数：无。
  // 返回值：true 表示存在未保存改动。
  function draftHasUnsavedChanges() {
    return hasUnsavedChanges(draftInitialSnapshot.value, newContract.value) ||
      Boolean(externalContractFile.value) !== draftInitialHadFile.value
  }

  // 用途：以组件事件带来的完整表单替换当前草稿（本地目录选择会重建整份表单）。
  // 参数：next 为替换后的完整表单对象。
  // 返回值：无；不触发提交。
  function replaceDraftForm(next) {
    newContract.value = next
  }

  // 用途：追加一期付款计划，分期号取未被占用的最小值。
  // 参数：无；上限 100 期，超限静默忽略。
  // 返回值：无。
  function addPaymentTerm() {
    if (newContract.value.payment_terms.length >= 100) return
    const used = new Set(newContract.value.payment_terms.map((term) => Number(term.installment_no)))
    let next = 1
    while (used.has(next)) next += 1
    newContract.value.payment_terms.push({ installment_no: next, due_date: '', amount: '' })
  }

  // 用途：删除指定位置的付款分期；数组身份不变。
  // 参数：index 为当前分期位置。
  // 返回值：无。
  function removePaymentTerm(index) {
    newContract.value.payment_terms.splice(index, 1)
  }

  // 用途：判断服务项还能否追加系统信息（最多 15 条，最后一条须先填完）。
  // 参数：serviceItem 为目标服务项。
  // 返回值：true 表示可以继续添加。
  function canAddSystemRow(serviceItem) {
    const last = serviceItem.systems.at(-1)
    return serviceItem.systems.length < 15 && (!last || Boolean(last.name.trim() && last.level))
  }

  // 用途：为服务项追加一条空的系统信息。
  // 参数：serviceItem 为目标服务项。
  // 返回值：无；不满足追加条件时忽略。
  function addSystemRow(serviceItem) {
    if (!canAddSystemRow(serviceItem)) return
    serviceItem.systems.push({ name: '', level: '' })
  }

  // 用途：删除服务项内的单条系统信息。
  // 参数：serviceItem 为目标服务项；index 为系统信息位置。
  // 返回值：无。
  function removeSystemRow(serviceItem, index) {
    serviceItem.systems.splice(index, 1)
  }

  // 用途：追加一个空服务项；上限 20 个且上一条须先选服务类型。
  // 参数：无。
  // 返回值：无。
  function addServiceItem() {
    if (!canAddServiceItem.value) return
    newContract.value.service_items.push(emptyServiceItem())
  }

  // 用途：删除服务项；仅剩一个时重置为空服务项，保证表单始终有可编辑行。
  // 参数：index 为服务项位置。
  // 返回值：无。
  function removeServiceItem(index) {
    if (newContract.value.service_items.length === 1) {
      newContract.value.service_items[0] = emptyServiceItem()
      return
    }
    newContract.value.service_items.splice(index, 1)
  }

  // 用途：打开空白草稿表单，只带入外部入口明确提供的客户/商机标识与名称。
  // 参数：无；上下文取自路由查询参数。
  // 返回值：无。
  function openNewContract() {
    termsIdentical.value = false
    editingContract.value = null
    draftEditError.value = ''
    draftEditConflict.value = false
    newContract.value = emptyNewContract()
    // 从商机/客户等外部入口进入时，只带入用户明确提供的对象标识和名称；
    // 金额、服务项、模板和日期仍由用户在合同中核对填写，不静默猜测。
    const contextCustomerId = String(route.query.customer_id || route.query.customerId || '').trim()
    const contextOpportunityId = String(route.query.opportunity_id || route.query.opportunityId || '').trim()
    if (contextCustomerId) newContract.value.customer_id = contextCustomerId
    if (contextCustomerId && route.query.customer_name) newContract.value.customer_name = String(route.query.customer_name)
    if (contextOpportunityId) newContract.value.opportunity_id = contextOpportunityId
    if (contextOpportunityId && route.query.opportunity_name) newContract.value.opportunity_name = String(route.query.opportunity_name)
    contractCreationMode.value = 'template'
    externalContractFile.value = null
    externalContractFileError.value = ''
    externalContractFileInputKey.value += 1
    resetTemplatePreview()
    createDialogOpen.value = true
    resetCRMDirectoryConnection()
    markDraftClean()
  }

  // 用途：读取并载入现有草稿进入编辑态，保留创建人和来源身份。
  // 参数：contract 为台账/详情里的合同记录（使用 recordId 或 id）。
  // 返回值：异步完成；读取失败只提示，不关闭已打开的表单。
  async function editContractDraft(contract) {
    if (draftEditLoading.value || contractCreating.value) return
    draftEditLoading.value = true
    try {
      const raw = await getContract(contract.recordId || contract.id)
      const form = hydrateContractDraft(raw)
      editingContract.value = raw
      newContract.value = form
      draftEditError.value = ''
      draftEditConflict.value = false
      contractCreationMode.value = raw.template_id ? 'template' : 'external'
      externalContractFile.value = null
      externalContractFileError.value = ''
      resetTemplatePreview()
      closeContract()
      createDialogOpen.value = true
      resetCRMDirectoryConnection()
      markDraftClean()
      if (!raw.template_id) void loadDetectionCategoryOptions()
      else if (!selectedContractTemplate.value) draftEditError.value = '原合同模板已不可用，不能重新生成正文，请联系管理员恢复原模板。'
    } catch (error) {
      showToast(formatUserError(error, { fallback: '读取草稿失败' }))
    } finally {
      draftEditLoading.value = false
    }
  }

  // 用途：直接关闭草稿编辑态并清空脏检查基线；未保存确认由页面在调用前完成。
  // 参数：无。
  // 返回值：无。
  function closeDraftEditorNow() {
    createDialogOpen.value = false
    editingContract.value = null
    draftEditError.value = ''
    draftEditConflict.value = false
    draftInitialSnapshot.value = ''
    draftInitialHadFile.value = false
  }

  // 用途：切换模板/外部上传两种创建方式；编辑既有草稿时不允许切换。
  // 参数：mode 为 'template' 或 'external'。
  // 返回值：无；外部方式会预填默认批次并读取检测类别目录。
  function selectContractCreationMode(mode) {
    if (editingContract.value) return
    invalidateDetectionCategoryRequest()
    contractCreationMode.value = mode
    resetTemplatePreview()
    if (mode === 'template') {
      externalContractFile.value = null
      externalContractFileError.value = ''
      externalContractFileInputKey.value += 1
      return
    }
    newContract.value.template_id = ''
    newContract.value.template_values = {}
    for (const serviceItem of newContract.value.service_items) {
      if (!serviceItem.batch.trim()) serviceItem.batch = '第一批次'
    }
    void loadDetectionCategoryOptions()
  }

  // 用途：选择模板后按当前用户资料与模板默认值重建模板替换值。
  // 参数：无；模板取自当前表单 template_id。
  // 返回值：无。
  function selectContractTemplate() {
    newContract.value.template_values = buildTemplateValues(
      selectedContractTemplate.value?.fields,
      session.value,
    )
    resetTemplatePreview()
  }

  // 用途：同步管理员预设与金额联动字段的替换值，提交前也会调用。
  // 参数：无。
  // 返回值：无。
  function syncManagedTemplateValues() {
    newContract.value.template_values = synchronizeContractTemplateValues(
      selectedContractTemplate.value?.fields, newContract.value.template_values, newContract.value.amount,
    )
  }

  return {
    newContract, contractCreationMode, externalContractFile, externalContractFileError, externalContractFileInputKey,
    editingContract, contractCreating, draftEditLoading, draftEditError, draftEditConflict, createDialogOpen,
    draftInitialSnapshot, draftInitialHadFile, selectedContractTemplate, canAddServiceItem, paymentPlanError,
    markDraftClean, draftHasUnsavedChanges, replaceDraftForm,
    addPaymentTerm, removePaymentTerm, canAddSystemRow, addSystemRow, removeSystemRow, addServiceItem, removeServiceItem,
    openNewContract, editContractDraft, closeDraftEditorNow, selectContractCreationMode, selectContractTemplate,
    syncManagedTemplateValues,
  }
}
