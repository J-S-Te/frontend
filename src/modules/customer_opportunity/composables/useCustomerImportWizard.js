import { computed, reactive, ref } from 'vue'

/**
 * 客户 Excel 导入向导域（治理批次 5 CRM，自 CustomerOpportunityView.vue 逐字迁移）。
 * 收编：弹窗开关、表单（文件/原因）、预检结果 / 提交结果 / 提交幂等键三态、入口可用性
 * （customer_import_scan 运行时能力）、文件后缀校验、预检 / 提交 / 错误明细下载 / 模板下载，
 * 以及导入专属错误码到文案的映射（其余错误委托注入的 showError）。
 * 幂等键仅驻内存：预检成功即生成，提交复用，关闭或重置时清空；不写入浏览器 Web Storage。
 *
 * 注入项与组件内同名标识一一对应：error/notice/actionLoading/resetMessages/showError/
 * loadCurrent/runtimeCapability/createIdempotencyKey/previewCustomerImport/commitCustomerImport/
 * downloadCustomerImportErrors/downloadCustomerImportTemplate；不直接导入 API 模块，保持可独立测试。
 */
export function useCustomerImportWizard({
  error, notice, actionLoading, resetMessages, showError, loadCurrent, runtimeCapability, createIdempotencyKey,
  previewCustomerImport, commitCustomerImport, downloadCustomerImportErrors, downloadCustomerImportTemplate,
}) {
  const customerImportDialog = ref(false)
  const customerImportForm = reactive({ file: null, reason: '' })
  const customerImportPreview = ref(null)
  const customerImportResult = ref(null)
  const customerImportCommitKey = ref('')
  const customerImportScanAvailable = computed(() => runtimeCapability('customer_import_scan').available)

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
  function showCustomerImportError(value) {
    if (value?.code === 'CRM_CUSTOMER_IMPORT_SCANNER_UNAVAILABLE') error.value = '客户导入代码安全校验当前不可用，暂不能预检。'
    else if (value?.code === 'CRM_CUSTOMER_IMPORT_FILE_REJECTED') error.value = '文件未通过服务端代码安全校验，已拒绝预检。'
    else if (value?.code === 'CRM_CUSTOMER_IMPORT_FILE_INVALID') error.value = 'Excel 文件格式、表头或内容不符合导入规范。'
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
  async function downloadImportErrors() {
    const jobNo = customerImportResult.value?.job_no || customerImportPreview.value?.job_no
    if (!jobNo) return
    try {
      const { blob, filename } = await downloadCustomerImportErrors(jobNo)
      const objectURL = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = objectURL; link.download = filename
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
