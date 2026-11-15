import { computed, reactive, ref } from 'vue'
import { customerImportErrorRows, customerImportErrorsCsv } from '../customerImportErrors.js'

/** 用途：把导入预检已有的受控表头诊断转换为可操作的提示。
 * 参数：details 为服务端表头问题；仅接受既有列名和诊断码。
 * 返回值：安全中文消息；未识别的诊断使用原通用文案。
 */
function importFileMessage(details) {
  const fallback = 'Excel 文件格式、表头或内容不符合导入规范。'
  const columns = ['表头', '客户名称', '统一社会信用代码', '客户类型', '行业', '区域',
    '负责人用户ID', '负责人组织ID', '登记联系人姓名', '登记联系人电话', '登记联系人邮箱']
  if (!columns.includes(details?.column)) return fallback
  const reasons = {
    INVALID_HEADERS: '表头数量不正确，请使用下载的模板并保留全部列。',
    INVALID_HEADER: '只接受模板的固定中文表头，且表头不得包含公式；请恢复模板列后重新上传。',
    DUPLICATE_HEADER: '表头重复，请使用下载的模板修正后重新上传。',
  }
  return reasons[details?.code] ? `${details.column}：${reasons[details.code]}` : fallback
}

/**
 * 客户 Excel 导入向导域（治理批次 5 CRM，自 CustomerOpportunityView.vue 逐字迁移）。
 * 收编：弹窗开关、表单（文件/原因）、预检结果 / 提交结果 / 提交幂等键三态、入口可用性
 * （customer_import_scan 运行时能力）、文件后缀校验、预检 / 提交 / 错误明细下载 / 模板下载，
 * 以及导入专属错误码到文案的映射（其余错误委托注入的 showError）。
 * 幂等键仅驻内存：预检成功即生成，提交复用，关闭或重置时清空；不写入浏览器 Web Storage。
 *
 * 注入项与组件内同名标识一一对应：error/notice/actionLoading/resetMessages/showError/
 * loadCurrent/runtimeCapability/createIdempotencyKey/previewCustomerImport/commitCustomerImport/
 * downloadCustomerImportTemplate；不直接导入 API 模块，保持可独立测试。
 * 错误报告 CSV 完全由预检/结果行在浏览器生成，不再调用服务端错误下载接口。
 */
/** 用途：管理既有客户导入向导、预检与提交回执及安全错误提示。
 * 参数：依赖对象提供响应式状态、受控 API 与页面交互函数。
 * 返回值：向导状态和操作集合，幂等键只保留在当前页面内存。
 */
export function useCustomerImportWizard({
  error, notice, actionLoading, resetMessages, showError, loadCurrent, runtimeCapability, createIdempotencyKey,
  previewCustomerImport, commitCustomerImport, downloadCustomerImportTemplate,
}) {
  const customerImportDialog = ref(false)
  const customerImportForm = reactive({ file: null, reason: '' })
  const customerImportPreview = ref(null)
  const customerImportResult = ref(null)
  const customerImportCommitKey = ref('')
  const customerImportScanAvailable = computed(() => runtimeCapability('customer_import_scan').available)
  const customerImportErrorReportRows = computed(() => customerImportErrorRows(customerImportPreview.value, customerImportResult.value))

  function openCustomerImport() {
    if (!customerImportScanAvailable.value) {
      error.value = '客户导入代码安全校验当前不可用，入口已安全关闭。'
      return
    }
    Object.assign(customerImportForm, { file: null, reason: '' })
    customerImportPreview.value = null; customerImportResult.value = null; customerImportCommitKey.value = ''
    customerImportDialog.value = true
  }
  function resetCustomerImportPreview() {
    customerImportPreview.value = null; customerImportResult.value = null; customerImportCommitKey.value = ''
    customerImportForm.file = null
  }
  function closeCustomerImport() {
    resetCustomerImportPreview(); customerImportForm.reason = ''; customerImportDialog.value = false
  }
  function selectCustomerImportFile(event) {
    const file = event.target.files?.[0] || null
    customerImportForm.file = file?.name?.toLowerCase().endsWith('.xlsx') ? file : null
    if (file && !customerImportForm.file) error.value = '只接受 .xlsx 文件，请重新选择。'
  }
  /** 用途：展示导入失败原因，并在预检过期时清理失效的预检。
   * 参数：value 为导入 API 的结构化错误。
   * 返回值：无；更新导入提示或委托统一错误展示。
   */
  function showCustomerImportError(value) {
    if (value?.code === 'CRM_CUSTOMER_IMPORT_SCANNER_UNAVAILABLE') error.value = '客户导入代码安全校验当前不可用，暂不能预检。'
    else if (value?.code === 'CRM_CUSTOMER_IMPORT_FILE_REJECTED') error.value = '文件未通过服务端代码安全校验，已拒绝预检。'
    else if (value?.code === 'CRM_CUSTOMER_IMPORT_FILE_INVALID') error.value = importFileMessage(value.details)
    else if (value?.code === 'CRM_CUSTOMER_IMPORT_JOB_EXPIRED' || value?.code === 'CRM_CUSTOMER_IMPORT_JOB_CONFLICT' || value?.code === 'COMMON_VERSION_CONFLICT' || value?.status === 409) {
      error.value = '导入预检已过期或状态发生变化，请重新上传文件预检。'
      customerImportPreview.value = null
    } else showError(value)
  }
  async function previewImport() {
    if (!customerImportForm.file || !customerImportForm.reason.trim()) return
    actionLoading.value = true; resetMessages()
    try {
      customerImportPreview.value = await previewCustomerImport({ file: customerImportForm.file, reason: customerImportForm.reason.trim() })
      customerImportResult.value = null
      customerImportCommitKey.value = createIdempotencyKey()
      // 服务端接受文件并生成预检任务后，浏览器不再解析或持久保存工作簿内容。
      customerImportForm.file = null
    } catch (value) { showCustomerImportError(value) } finally { actionLoading.value = false }
  }
  async function commitImport() {
    const preview = customerImportPreview.value
    if (!preview || Number(preview.importable_rows) <= 0) return
    actionLoading.value = true; resetMessages()
    try {
      if (!customerImportCommitKey.value) customerImportCommitKey.value = createIdempotencyKey()
      const result = await commitCustomerImport(preview.job_no, { version: Number(preview.version) }, customerImportCommitKey.value)
      notice.value = `客户导入完成：成功 ${result.succeeded_rows || 0} 行，失败 ${result.failed_rows || 0} 行，跳过 ${result.skipped_rows || 0} 行。`
      closeCustomerImport()
      await loadCurrent()
    } catch (value) { showCustomerImportError(value) } finally { actionLoading.value = false }
  }
  function downloadImportErrors() {
    if (!customerImportErrorReportRows.value.length) return
    try {
      const csv = customerImportErrorsCsv(customerImportPreview.value, customerImportResult.value)
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
      const objectURL = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = objectURL; link.download = '客户导入错误.csv'
      document.body.appendChild(link); link.click(); link.remove()
      window.setTimeout(() => URL.revokeObjectURL(objectURL), 0)
    } catch (value) { showCustomerImportError(value) }
  }
  async function downloadCustomerImportExample() {
    try {
      const { blob, filename } = await downloadCustomerImportTemplate()
      const objectURL = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = objectURL; link.download = filename
      document.body.appendChild(link); link.click(); link.remove()
      window.setTimeout(() => URL.revokeObjectURL(objectURL), 0)
    } catch (value) { showCustomerImportError(value) }
  }

  return {
    customerImportDialog,
    customerImportForm,
    customerImportPreview,
    customerImportResult,
    customerImportCommitKey,
    customerImportScanAvailable,
    customerImportErrorReportRows,
    openCustomerImport,
    resetCustomerImportPreview,
    closeCustomerImport,
    selectCustomerImportFile,
    showCustomerImportError,
    previewImport,
    commitImport,
    downloadImportErrors,
    downloadCustomerImportExample,
  }
}
