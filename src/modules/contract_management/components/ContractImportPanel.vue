<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { contractImportRequest, listContractImportBatches, releaseContractImportItem,
  getImportItemDocumentDescriptor, importItemSourceURL, openContractCRMLogin,
  listMyCustomers, ensureContractCRMDirectorySession, listContractDetectionCategories,
  getImportAutoApproveSetting, setImportAutoApproveSetting, listLocalCatalogGrantTargets } from '../api/contract.js'
import { formatBusinessDateTime } from '@/modules/shared/utils/businessTime.js'
import { copyTextToClipboard } from '@/modules/shared/utils/clipboard.js'
import ContractPDFPreview from './ContractPDFPreview.vue'
import LocalContractSourcePicker from './LocalContractSourcePicker.vue'
import { importRowSourceForm, applyImportRowSourceForm } from '../utils/localImportSourceBridge.js'
import { contractImportErrorRows, contractImportErrorsCsv, contractImportProvisionIssueLabels } from '../utils/contractImportErrors.js'
import { prepareImportManifest, formatImportMinor } from '../utils/contractImport.js'
import { buildImportManifestFromRows, createImportFormRow, emptyImportServiceItem,
  importFieldLabel, importRowsFromItems, validateImportFormRows } from '../utils/contractImportForm.js'
import { applyContractExcelCustomerLookup, blockingContractExcelIssues, buildContractExcelImportRows,
  matchContractExcelRecordsToFiles, parseContractExcelWorkbook, summarizeContractExcelImport } from '../utils/contractExcelImport.js'
import { historicalExcelModes, historyImportDetails, readHistoryExcelRecords } from '../utils/contractHistoryExcel.js'
import { contractExcelMaximumBytes, contractExcelTemplateURL, readContractExcelWorkbook } from '../utils/contractExcelReader.js'
import { externalContractTypes, contractSystemLevels, validateContractSourceFile } from '../utils/contractPayload.js'
import { paymentAmountMinor } from '../utils/paymentTerms.js'
import { fallbackServiceTypeOptions } from '../utils/contractDisplay.js'
import { useDictionaryOptions } from '@/modules/platform/dictionaries/composables/useDictionaryOptions.js'
import { ensureStableReviewAttempt } from '../utils/opportunityIntakeReview.js'

const props = defineProps({ enabled: Boolean, pdfEnabled: Boolean, canPreview: { type: Boolean, default: true }, canCommit: Boolean,
  canApprove: Boolean, canRelease: Boolean, canManageAutoApprove: Boolean,
  actorId: { type: String, default: '' }, initialBatchId: { type: String, default: '' },
  // 当前所在页签：imports 页把自动审批状态条固定展示在折叠面板之外（P2-5）。
  section: { type: String, default: '' },
  // 进入导入页或带批次号直达时默认展开面板；合同台账页保持折叠（P1-4）。
  defaultOpen: { type: Boolean, default: false },
  supportedModes: { type: Array, default: () => ['NORMAL'] },
  sourceCapabilities: { type: Object, default: () => ({}) } })
const text = ref(''), files = ref([]), batch = ref(null), batchID = ref(''), lookupID = ref(props.initialBatchId)
const busy = ref(false), error = ref(''), commitKey = ref(''), sourceSelectionVersion = ref(0)
const crmConnectionMessage = ref('')
const batches = ref([]), listOffset = ref(0), listNextOffset = ref(null), listHasMore = ref(false), listLimitReached = ref(false), document = ref(null), confirmationAttempt = ref(null), actionAttempt = ref(null)
const listBusy = ref(false), listError = ref('')
const newBatchModes = computed(() => props.supportedModes.filter(mode => historicalExcelModes.includes(mode)))
const entryMode = ref(newBatchModes.value[0] || '')
const historyOptions = ref({ targetOwnerUserID: '', declaredSignedDate: '', historicalStatus: '',
  historicalCustomerName: '', historicalOwnerLabel: '', reportMode: '' })
const sourceSystem = ref('legacy')
const historyOwnerOptions = ref([]), historyOwnerBusy = ref(false), historyOwnerError = ref('')
const formRows = ref([]), jsonAuthoritative = ref(false), fileMessage = ref(''), advancedMessage = ref('')
const normalEntryMode = ref('excel'), excelFile = ref(null), excelBusy = ref(false), excelMessage = ref('')
const excelIssues = ref([]), excelSummary = ref(null), excelCRMRequired = ref(false), excelCRMProgress = ref(''), excelStale = ref(false)
const excelExcludedFiles = ref([])
const drawerRowKey = ref(''), drawerRef = ref(null)
const customerOptions = ref([]), customerLoading = ref(false), customerError = ref(''), customerCrmRequired = ref(false)
const detectionCategoryOptions = ref([]), detectionCategoryLoading = ref(false), detectionCategoryError = ref('')
// 历史导入自动审批是全系统唯一开关：只有合同超级管理员能看到这一行。
// 读取到 version 后才允许写，写请求带版本，避免覆盖另一位管理员的修改。
const autoApprove = ref(null), autoApproveLoading = ref(false), autoApproveSaving = ref(false)
const autoApproveError = ref(''), autoApproveErrorCode = ref(''), autoApproveNotice = ref(''), autoApproveCopyHint = ref('')
const autoApproveConfirm = ref('')
let autoApproveTicket = 0
const AUTO_APPROVE_DISABLED_TEXT = '服务端未开启该能力（需部署时配置 CONTRACT_IMPORT_AUTO_APPROVE_HISTORICAL=true），请联系平台运维。'
const autoApproveCapability = computed(() => autoApprove.value?.capability_enabled === true)
const autoApproveEnabled = computed(() => autoApprove.value?.enabled === true)
const autoApproveBusy = computed(() => autoApproveLoading.value || autoApproveSaving.value)
const autoApproveSwitchDisabled = computed(() => autoApproveBusy.value || !autoApprove.value || !autoApproveCapability.value)
const autoApproveStatusLabel = computed(() => {
  if (!autoApprove.value) return '设置未读取'
  if (!autoApproveCapability.value) return '能力未开启'
  return autoApproveEnabled.value ? '已开启' : '已关闭'
})
const autoApproveStatusTone = computed(() => (autoApproveCapability.value && autoApproveEnabled.value ? 'success' : 'neutral'))
// 更新人/时间由服务端记录，按北京时间展示；两者都缺失时不显示假的更新时间。
const autoApproveUpdatedLabel = computed(() => {
  const data = autoApprove.value
  if (!data) return ''
  const actor = typeof data.updated_by === 'string' ? data.updated_by.trim() : ''
  const at = data.updated_at ? formatBusinessDateTime(data.updated_at) : ''
  if (actor && at) return `最近更新：${actor}（${at}）`
  if (actor) return `最近更新：${actor}`
  if (at) return `最近更新：${at}`
  return ''
})
const autoApproveConfirmText = computed(() => (autoApproveConfirm.value === 'enable'
  ? '开启后历史合同导入将自动审批并按清单声明状态归档，跳过人工会签；仅超级管理员可操作。'
  : '关闭后历史合同导入将恢复人工会签确认；仅超级管理员可操作。'))

// P1-4：导入页或带批次号直达时默认展开，合同台账页保持折叠。
// 用受控 open 而不是只在 onMounted 改 DOM，SSR/测试与浏览器两侧行为一致；
// 用户手动折叠后仍以原生 toggle 事件回写状态。
const panelOpen = ref(Boolean(props.defaultOpen))
watch(() => props.defaultOpen, (value) => { panelOpen.value = Boolean(value) })
function onPanelToggle(event) {
  const next = Boolean(event?.target?.open)
  if (next !== panelOpen.value) panelOpen.value = next
}
let detectionCategoriesLoaded = false, drawerReturnFocus = null
const { options: serviceTypeItems } = useDictionaryOptions('CONTRACT_SERVICE_TYPE', { fallback: fallbackServiceTypeOptions })
const serviceTypeOptions = computed(() => (serviceTypeItems.value || []).map((item) => item.value).filter(Boolean))
let timer = null, generation = 0, disposed = false
let documentGeneration = 0, excelGeneration = 0
const labels = { DRAFT: '待预检', BLOCKED: '需要修正', PREVIEWED: '预检完成', QUEUED: '等待执行', RUNNING: '正在创建记录', PARTIAL: '部分完成／需要恢复', PAUSED: '已暂停', CONFIRMATION_PENDING: '记录已创建，等待历史确认', TARGETS_PENDING: '历史已确认，等待各目标接续', COMPLETED: '本批次导入处理已完成' }
const modeLabels = { NORMAL: '普通新合同', ARCHIVE_ONLY: '历史存档', CONTINUE_LIVE: '接续履约', HISTORICAL_CLOSED: '历史结清档案' }
const targetLabels = { PROJECT: '项目接续', FINANCE: '财务接续', REPORT: '数析同步' }
const stateLabels = { DRAFT: '待预检', WAITING_RELEASE: '待申请放行', WAITING: '等待依赖满足', QUEUED: '等待执行', RUNNING: '正在核对执行', HOLD: '暂未放行', PREPARING: '正在建立财务暂存', PREPARED: '财务已暂存，待恢复对账', READY: '核对就绪，尚未放行', RELEASE_REQUESTED: '放行已申请，等待实际应用', COMPLETE: '已完成', COMPLETED: '已完成', NOT_APPLICABLE: '不建立此类业务', FAILED: '执行失败，可核对恢复', BLOCKED: '需要处理阻塞', NEEDS_REVIEW: '合同版本变化，需核对', CORRECTION_REQUIRED: '已建单基线需要业务更正', CREATED: '记录已创建，正在完成文件引用', PENDING: '待处理', APPROVED: '确认通过', STARTING: '正在启动独立确认', REJECTED: '确认驳回', WITHDRAWN: '确认撤回', EXPIRED: '确认已超时' }
const historyItems = computed(() => (batch.value?.items || []).filter(entry => entry.item.mode !== 'NORMAL'))
// P2-4：自动审批已开启且有历史项时，批次页脚文案必须与真实审批路径一致，
// 不能再写“之后独立确认/逐份审批”让人误以为还要人工会签。
const historyAutoApproveActive = computed(() => autoApproveEnabled.value && historyItems.value.length > 0)
const batchPreviewNote = computed(() => {
  const pending = batch.value ? batch.value.items.filter((entry) => !entry.contract_id).length : 0
  if (historyItems.value.length && historyItems.value.every(entry => entry.item.policy_options?.finance_mode === 'NONE')) {
    return `预计创建 ${pending} 份记录；历史项${historyAutoApproveActive.value ? '将自动审批归档' : '仍需独立确认'}。不参与结算开票，确认后仅按档案策略同步报表。`
  }
  if (historyAutoApproveActive.value) {
    return `预计创建 ${pending} 份记录；历史项将按清单声明状态自动审批归档（自动审批已开启），普通新合同仍逐份审批；确认后分别放行项目、财务和报表。`
  }
  return `预计创建 ${pending} 份记录；本次不免审生效。普通模式之后逐份审批；历史模式之后独立确认，再分别放行项目、财务和报表。`
})
// 批次头的状态徽标只在自动审批开启且本批次确有历史项时出现；普通新合同批次
// 即使全局开关开启也不该显示无关的自动审批提示。
const showAutoApproveBadge = computed(() => autoApproveEnabled.value && historyItems.value.length > 0)

const issueLabels = {
  ...contractImportProvisionIssueLabels,
  IMPORT_CRM_SESSION_REQUIRED: 'CRM 当前账号授权上下文缺失或已过期，请连接 CRM 后重新预检。',
  REQUIRED: '必填项缺失',
  UNSUPPORTED_ENUM: '取值不在允许范围',
  POSITIVE_MINOR_UNITS_REQUIRED: '金额必须大于零并精确到分',
  INVALID_AMOUNT: '金额格式不正确，最多两位小数',
  INVALID_DATE: '日期无效',
  DATE_ORDER_INVALID: '结束日期不能早于开始日期',
  PAYMENT_TERMS_INVALID: '付款条款与合同金额不一致',
  OPPORTUNITY_PAIR_REQUIRED: '商机编号和名称须同时提供',
  ITEM_COUNT_INVALID: '数量超出允许范围',
  TOO_LONG: '内容超出长度限制',
  DUPLICATE_SOURCE_FILE: '同一原件重复使用',
  FILE_MISSING: '原件未匹配',
  IMPORT_CORRECTION_REQUIRED: '已建单项需要业务更正，不能直接覆盖',
  IMPORT_VALIDATION_FAILED: '预检字段校验未通过',
  IMPORT_POLICY_UNSUPPORTED: '当前服务端未开放该历史策略',
  IMPORT_EVIDENCE_UNSUPPORTED: '历史来源证据不完整',
  IMPORT_INACTIVE_RESPONSIBILITY_UNSUPPORTED: '历史结清财务重建策略不受支持',
}
// 历史导入自动开立 CRM 客户/商机时，预览响应会多返回 provision_plan；缺失整块不渲染，界面与未开放时完全一致。
const provisionCustomerLabels = { EXISTS: '客户已存在', TO_CREATE: '将自动创建客户', AMBIGUOUS: '客户重名，需人工确认' }
const provisionSalesLabels = { RESOLVED: '销售已解析', UNRESOLVED: '销售未命中', AMBIGUOUS: '销售重名，需人工确认' }
const provisionPlan = computed(() => (Array.isArray(batch.value?.provision_plan) ? batch.value.provision_plan : [])
  .filter((item) => item && typeof item === 'object'))
const provisionSummary = computed(() => {
  const summary = { toCreate: 0, existing: 0, customerAmbiguous: 0, resolved: 0, unresolved: 0, salesAmbiguous: 0 }
  for (const plan of provisionPlan.value) {
    if (plan.customer_state === 'TO_CREATE') summary.toCreate += 1
    else if (plan.customer_state === 'EXISTS') summary.existing += 1
    else if (plan.customer_state === 'AMBIGUOUS') summary.customerAmbiguous += 1
    if (plan.sales_state === 'RESOLVED') summary.resolved += 1
    else if (plan.sales_state === 'UNRESOLVED') summary.unresolved += 1
    else if (plan.sales_state === 'AMBIGUOUS') summary.salesAmbiguous += 1
  }
  return summary
})

function provisionText(value) {
  return String(value ?? '').trim()
}

// 用途：给每条 provision_plan 一个稳定的逐项定位，缺少合同标识时用序号，不伪造业务编号。
function provisionPlanTitle(plan, index) {
  return provisionText(plan.contract_number || plan.external_record_id || plan.contractNumber || plan.externalRecordId) || `第 ${index + 1} 项`
}

// 用途：按后端返回值原样展示商机金额与预计签约日，不猜测金额单位。
function provisionOpportunityText(plan) {
  const amount = provisionText(plan.opportunity_amount)
  const date = provisionText(plan.opportunity_sign_date)
  if (!amount && !date) return '商机：未生成'
  return `商机：金额 ${amount || '—'}，签约日 ${date || '—'}`
}
const isNormalEntry = computed(() => entryMode.value === 'NORMAL')
const isHistoricalEntry = computed(() => historicalExcelModes.includes(entryMode.value))
const originalManifestRequired = computed(() => (batch.value?.items || []).some(entry => entry.item?.mode === 'CONTINUE_LIVE'))
const isFormEntry = computed(() => !originalManifestRequired.value && (isNormalEntry.value || isHistoricalEntry.value))
const usesJsonManifest = computed(() => !isFormEntry.value || jsonAuthoritative.value)
const selectableModes = computed(() => modeLocked.value ? [entryMode.value] : newBatchModes.value)
const modeLocked = computed(() => Boolean(batch.value?.items?.length))
watch(newBatchModes, (modes) => {
  if (!batchID.value && !files.value.length && !formRows.value.length && !modes.includes(entryMode.value)) {
    entryMode.value = modes[0] || ''
  }
})

// importFormOptions 统一预检与清单生成选项，避免历史行误用普通客户校验。
// 参数：无；读取当前批次和操作者明确填写的历史信息。
// 返回值：纯转换器选项，已有批次始终沿用原来源系统。
function importFormOptions() {
  return { sourceSystem: batch.value?.source_system || (isHistoricalEntry.value ? sourceSystem.value : 'manual'),
    mode: entryMode.value, files: files.value, sources: batch.value?.sources || [], historyOptions: historyOptions.value }
}

// loadHistoryOwners 读取已有合同目录中的真实账号，权限不足不退回任意ID输入。
// 参数：无。
// 返回值：无；失败显示错误并保留已选负责人。
async function loadHistoryOwners() {
  if (historyOwnerBusy.value) return
  historyOwnerBusy.value = true
  historyOwnerError.value = ''
  try {
    const rows = await listLocalCatalogGrantTargets()
    if (!disposed) historyOwnerOptions.value = rows.filter(row => row.subject_type === 'USER' && row.subject_id !== props.actorId)
  } catch (failure) {
    if (!disposed) historyOwnerError.value = failure.message || '当前负责人目录不可用。'
  } finally { if (!disposed) historyOwnerBusy.value = false }
}

// applyBatchHistory 显式把本批信息应用到行，避免输入默认值覆盖已恢复历史事实。
// 参数：无；使用操作者当前填写的本批历史信息。
// 返回值：无；逐行错误由本地校验重新生成。
function applyBatchHistory() {
  if (busy.value || !isHistoricalEntry.value) return
  error.value = ''
  for (const row of formRows.value) {
    if (row.contractId) continue
    const detail = historyImportDetails({}, row.importMode || entryMode.value, historyOptions.value)
    const savedChannel = row.historyEvidence?.report_required_channels
    const savedOwnerID = row.historyEvidence?.target_owner_user_id
    row.historyEvidence = { ...row.historyEvidence, ...detail.history_evidence }
    if (savedChannel) row.historyEvidence.report_required_channels = savedChannel
    if (historyOptions.value.targetOwnerUserID) row.historyEvidence.target_owner_name = ''
    else if (savedOwnerID) row.historyEvidence.target_owner_user_id = savedOwnerID
    row.policyOptions = { ...detail.policy_options, ...row.policyOptions }
  }
  applyFormIssues(validateImportFormRows(formRows.value, importFormOptions()))
}
const drawerRow = computed(() => formRows.value.find((row) => row.key === drawerRowKey.value) || null)
const drawerSourceError = ref('')
const localImportSources = computed(() => props.sourceCapabilities?.counterparty_source === 'local'
  || props.sourceCapabilities?.category_source === 'local')
const drawerSourceForm = computed(() => importRowSourceForm(drawerRow.value))
const drawerSourceCapabilities = computed(() => {
  const row = drawerRow.value
  const restored = (batch.value?.items || []).some((entry) => entry.item?.item_key === row?.key)
  return { ...props.sourceCapabilities,
    counterparty_source: row?.counterpartySource === 'LOCAL' ? 'local'
      : row?.counterpartySource === 'CRM' || row?.crmCustomerId || restored ? 'crm'
        : props.sourceCapabilities?.counterparty_source,
    category_source: row?.categorySource === 'LOCAL' ? 'local'
      : row?.categorySource === 'PROJECT' || restored ? 'project'
        : props.sourceCapabilities?.category_source,
  }
})
const drawerLocalCounterparty = computed(() => drawerSourceCapabilities.value.counterparty_source === 'local')
const drawerLocalCategories = computed(() => drawerSourceCapabilities.value.category_source === 'local')
watch(localImportSources, (local) => {
  if (local && isNormalEntry.value && !excelFile.value && !formRows.value.length && !batch.value?.items?.length) {
    normalEntryMode.value = 'manual'
  }
}, { immediate: true })

// 用途：将抽屉来源选择合回当前普通行，不改变原件、金额或服务项身份。
// 参数：form为来源选择器发出的同一行完整引用。
// 返回值：无；错位或失效结果保留原行并显示错误。
function updateDrawerSource(form) {
  if (busy.value || !drawerRow.value) return
  drawerSourceError.value = ''
  try { Object.assign(drawerRow.value, applyImportRowSourceForm(drawerRow.value, form)) }
  catch (failure) { drawerSourceError.value = failure.message }
}
// 批次恢复后 files 已清空，但已暂存原件仍可用文件名参与匹配；不能因此丢掉当前批次的可继续编辑能力。
const excelSourceFiles = computed(() => {
  if (files.value.length) return files.value
  const seen = new Set()
  const excluded = new Set(excelExcludedFiles.value)
  return (batch.value?.sources || [])
    .filter((source) => source.state === 'READY' && source.filename && !excluded.has(source.filename))
    .filter((source) => {
      if (seen.has(source.filename)) return false
      seen.add(source.filename)
      return true
    })
    .map((source) => ({ name: source.filename }))
})
// 只有工作簿/匹配层面的问题阻断预检；金额、日期、CRM 客户编号等字段问题由现有逐行校验在提交前精确阻断。
// 重复合同编号会令第二条 Excel 行无提示地不进入匹配，因此单独提升为结构性阻断。
const excelStructuralIssueCodes = new Set(['CONTRACT_NUMBER_DUPLICATE', 'CONTRACT_NUMBER_NUMERIC'])
const excelStructuralIssues = computed(() => (excelIssues.value || []).filter((issue) => issue && issue.blocking !== false
  && (issue.scope === 'workbook' || issue.scope === 'match' || excelStructuralIssueCodes.has(issue.code))))
const excelReady = computed(() => {
  if (excelBusy.value || excelStale.value) return false
  if (excelStructuralIssues.value.length) return false
  if (!formRows.value.length) return false
  if (normalEntryMode.value !== 'excel') return true
  // 只有新选择的 File 才做数量一致性检查；批次恢复后 files 为空，用户可能有意移除某行/原件。
  return files.value.length ? formRows.value.length === files.value.length : true
})
const canPreviewAction = computed(() => {
  if (busy.value) return false
  if (usesJsonManifest.value) return Boolean(text.value.trim())
  if (normalEntryMode.value === 'excel') return excelReady.value
  return formRows.value.length > 0
})
const formEditable = computed(() => props.enabled && props.canPreview
  && !['STARTING','PENDING','APPROVED'].includes(batch.value?.confirmation?.state)
  && (!batch.value?.operation_id || ['PAUSED','PARTIAL','DRAFT','BLOCKED','PREVIEWED'].includes(batch.value.state)))
const crmConnectionRequired = computed(() => props.canPreview && (batch.value?.items || [])
  .some(entry => (entry.issues || []).some(issue => issue.code === 'IMPORT_CRM_SESSION_REQUIRED')))
const canVote = computed(() => props.canApprove && batch.value?.confirmation?.state === 'PENDING'
  && !(batch.value.confirmation.commands || []).some(command => command.actor_id === props.actorId && ['APPROVE','REJECT'].includes(command.action))
  && Object.entries(batch.value.confirmation.assignees || {}).some(([role, ids]) => Array.isArray(ids) && ids.includes(props.actorId) && !(batch.value.confirmation.approved_roles || []).includes(role)))
// P1：已提交批次的确认口径以台账 confirmation.policy_decision 为准（AUTO/MANUAL）。
// AUTO 批次的 APPROVED 是提交时按租户策略自动形成的，没有人工签署，
// 因此不能用 stateLabels 的“确认通过”，也不能用当前租户开关反推历史批次。
const confirmationAutoApproved = computed(() => batch.value?.confirmation?.policy_decision === 'AUTO')
const confirmationStateText = computed(() => {
  const confirmation = batch.value?.confirmation
  if (!confirmation) return ''
  if (confirmation.policy_decision !== 'AUTO') return stateLabels[confirmation.state] || confirmation.state
  // policy_version 是判定所依据的租户开关版本；缺失（或旧数据 0）时不编造版本号。
  const version = Number(confirmation.policy_version)
  return Number.isInteger(version) && version > 0
    ? `按租户策略自动审批（策略版本 ${version}）`
    : '按租户策略自动审批'
})
const importErrorReportRows = computed(() => contractImportErrorRows(batch.value?.items || [], error.value, { issueLabels, fieldLabel: importFieldLabel }))

/**
 * syncRowBatchState 只把服务端逐项状态和问题映射回当前表单行，不覆盖用户未保存字段。
 * 参数：无；以 item_key 精确对应，避免重名文件串行。
 * 返回值：无。
 */
// syncRowBatchState 同步服务端行状态及精确原件代次，不覆盖未保存的合同字段。
// 参数：无。
// 返回值：无；历史事实仍保留当前编辑值。
function syncRowBatchState() {
  const entries = new Map((batch.value?.items || []).map((entry) => [entry.item.item_key, entry]))
  for (const row of formRows.value) {
    const entry = entries.get(row.key)
    row.batchIssues = entry?.issues || []
    row.state = entry?.state || 'DRAFT'
    row.contractId = entry?.contract_id || ''
    if (row.contractId && entry?.item) row.savedItem = JSON.parse(JSON.stringify(entry.item))
    row.normalized = entry?.normalized_metadata || null
    if (entry?.item?.source_file_ref) row.sourceFileRef = entry.item.source_file_ref
    const resolvedOwner = entry?.item?.history_evidence
    if (row.historyEvidence?.target_owner_name && row.historyEvidence.target_owner_name === resolvedOwner?.target_owner_name) {
      row.historyEvidence.target_owner_user_id = resolvedOwner.target_owner_user_id
    }
  }
}

/**
 * applyFormIssues 把本地表单问题挂回具体行，供表格与抽屉逐字段展示。
 * 参数：issues为 validateImportFormRows 或构建器返回的问题。
 * 返回值：无。
 */
function applyFormIssues(issues = []) {
  for (const row of formRows.value) row.issues = []
  for (const issue of issues) {
    const row = formRows.value.find((item) => item.key === issue.rowKey)
    if (row) row.issues.push(issue)
  }
}

function rowIssues(row) {
  return row.issues || []
}

function rowIssue(row, field) {
  return rowIssues(row).find((issue) => issue.field === field || issue.field.startsWith(`${field}.`)) || null
}

function rowIssueCount(row) {
  return rowIssues(row).length + (row.batchIssues?.length || 0)
}
/**
 * appendImportRowIssue 在现有逐行校验结果后追加目录校验问题，不覆盖已定位错误。
 * 参数：row 为表单行，field 为字段路径，code 为错误码，message 为中文提示。
 * 返回值：无。
 */
function appendImportRowIssue(row, field, code, message) {
  if (!row) return
  if (rowIssues(row).some((issue) => issue.field === field && issue.code === code)) return
  row.issues = [...rowIssues(row), { rowKey: row.key, field, code, message }]
}

/**
 * applyExcelDirectoryIssues 用当前字典/检测类别目录校验 Excel 直填文本，提前暴露服务端会拒绝的值。
 * 参数：rows 为已构建的表单行。
 * 返回值：追加的问题数量；目录尚未加载成功时跳过，仍由服务端预检兜底。
 */
function applyExcelDirectoryIssues(rows = []) {
  const serviceTypes = new Set((serviceTypeOptions.value || []).map((value) => String(value || '').trim()).filter(Boolean))
  const categories = new Set((detectionCategoryOptions.value || []).map((item) => String(item?.category || '').trim()).filter(Boolean))
  let count = 0
  for (const row of rows) {
    const services = Array.isArray(row.serviceItems) ? row.serviceItems : []
    services.forEach((service, index) => {
      const serviceType = String(service?.serviceType || '').trim()
      if (serviceTypes.size && serviceType && !serviceTypes.has(serviceType)) {
        appendImportRowIssue(row, `serviceItems.${index}.serviceType`, 'UNSUPPORTED_ENUM', `服务类型「${serviceType}」不在当前服务类型字典中，请从下拉目录选择。`)
        count += 1
      }
      const category = String(service?.category || '').trim()
      if (categories.size && category && !categories.has(category)) {
        appendImportRowIssue(row, `serviceItems.${index}.category`, 'UNSUPPORTED_ENUM', `检测类别「${category}」不在项目管理当前启用的检测类别目录中，请核对后重新导入。`)
        count += 1
      }
    })
  }
  return count
}

/**
 * clearExcelDirectoryIssues 只移除上一次目录校验追加的问题，保留现有字段校验结果。
 * 参数：rows 为表单行。
 * 返回值：无；用户修改服务类型/检测类别后可重新校验。
 */
function clearExcelDirectoryIssues(rows = []) {
  for (const row of rows) {
    row.issues = rowIssues(row).filter((issue) => !(issue.code === 'UNSUPPORTED_ENUM'
      && /^serviceItems\.\d+\.(serviceType|category)$/.test(issue.field || '')))
  }
}

function rowBatchIssueSummary(row) {
  return (row.batchIssues || []).map((issue) => `${importFieldLabel(issue.field_path)}：${issueLabels[issue.code] || issue.code}`)
}

/**
 * textValue 统一 Excel 与表单文本，避免 null/undefined 进入匹配键。
 * 参数：value 为任意单元格或表单值。
 * 返回值：去首尾空白后的字符串。
 */
function textValue(value) {
  return String(value ?? '').trim()
}

/**
 * normalizeCustomerLookupName 按与 Excel 解析器一致的口径归一客户名称。
 * 参数：value 为客户名称。
 * 返回值：用于 CRM 精确匹配的稳定键；不做模糊匹配。
 */
function normalizeCustomerLookupName(value) {
  return textValue(value).normalize('NFKC').replace(/\s+/g, ' ').toLowerCase()
}

function batchHasCreatedContract() {
  return (batch.value?.items || []).some((entry) => Boolean(entry.contract_id))
}

/**
 * excelIssueText 把解析/匹配问题转成带合同编号或行号的中文定位。
 * 参数：issue 为解析器问题对象。
 * 返回值：页面展示文本。
 */
function excelIssueText(issue) {
  if (!issue) return ''
  const position = issue.contractNumber
    ? `合同「${issue.contractNumber}」`
    : (issue.rowNumber ? `第 ${issue.rowNumber} 行` : '工作簿')
  return `${position}：${issue.message}`
}

function dedupeExcelIssues(issues = []) {
  const seen = new Set()
  const result = []
  for (const issue of issues) {
    if (!issue) continue
    const key = [issue.scope, issue.rowNumber, issue.contractNumber, issue.field, issue.code, issue.message].join('\u0000')
    if (seen.has(key)) continue
    seen.add(key)
    result.push(issue)
  }
  return result
}

/**
 * resetExcelState 清除一次 Excel 匹配的输入、结果和异步代次，阻止迟到响应回填。
 * 参数：keepFile 为 true 时保留已选 Excel 文件。
 * 返回值：无。
 */
function resetExcelState({ keepFile = false } = {}) {
  excelGeneration++
  excelBusy.value = false
  if (!keepFile) excelFile.value = null
  excelMessage.value = ''
  excelIssues.value = []
  excelSummary.value = null
  excelCRMRequired.value = false
  excelCRMProgress.value = ''
  excelStale.value = false
  excelExcludedFiles.value = []
}

function clearExcelFile() {
  resetExcelState()
  excelMessage.value = '已移除 Excel；可重新选择文件，或切换到手动逐份填写。'
}

/**
 * selectExcelFile 校验格式和大小后立即解析并匹配，选择新文件会作废旧请求。
 * 参数：event 为文件输入事件。
 * 返回值：Promise<void>；文件错误只显示提示，不清空已选 PDF。
 */
async function selectExcelFile(event) {
  const picked = event?.target?.files?.[0] || null
  if (event?.target) event.target.value = ''
  if (!picked) return
  if (!/\.xlsx$/i.test(picked.name)) {
    excelMessage.value = '只支持 .xlsx 格式的 Excel 模板；请下载模板填写后重新选择。'
    return
  }
  if (picked.size > contractExcelMaximumBytes) {
    excelMessage.value = 'Excel 文件不能超过 5MiB，请精简后再导入。'
    return
  }
  excelGeneration++
  excelBusy.value = false
  excelFile.value = picked
  excelMessage.value = ''
  excelIssues.value = []
  excelSummary.value = null
  await applyExcelImport()
}

/**
 * resolveExcelCustomers 对缺少 CRM 客户编号的记录按客户名称做精确匹配。
 * 参数：records 为已匹配 PDF 的记录，ticket 为当前 Excel 解析代次。
 * 返回值：写入客户编号/权威名称的记录；CRM 登录缺失时保留可重试提示。
 */
async function resolveExcelCustomers(records, ticket) {
  const names = []
  const seen = new Set()
  for (const record of records) {
    if (record.crmCustomerId || !textValue(record.customerName)) continue
    const key = normalizeCustomerLookupName(record.customerName)
    if (seen.has(key)) continue
    seen.add(key)
    names.push(textValue(record.customerName))
  }
  if (!names.length) return applyContractExcelCustomerLookup(records, {})
  excelCRMProgress.value = '正在核对 CRM 会话…'
  try {
    await ensureContractCRMDirectorySession()
  } catch (failure) {
    if (failure?.crmLoginRequired) {
      excelCRMRequired.value = true
      excelCRMProgress.value = ''
      return applyContractExcelCustomerLookup(records, {})
    }
    throw failure
  }
  const lookup = {}
  let cursor = 0, completed = 0
  async function worker() {
    while (cursor < names.length) {
      if (disposed || ticket !== excelGeneration) return
      const name = names[cursor]
      cursor += 1
      const key = normalizeCustomerLookupName(name)
      try {
        const result = await listMyCustomers({ keyword: name, page: 1, page_size: 100 })
        const exact = (result.items || []).filter((item) => normalizeCustomerLookupName(item.name || item.customer_name) === key)
        if (exact.length === 1) {
          lookup[key] = { status: 'found', id: exact[0].id || exact[0].customer_id, name: exact[0].name || exact[0].customer_name }
        } else if (exact.length > 1) {
          lookup[key] = { status: 'ambiguous', candidates: exact }
        } else if (result.has_more) {
          // 只取第一页会假阴性；候选过多时失败关闭，要求业务补填 CRM 客户编号。
          lookup[key] = { status: 'too_many' }
        } else {
          lookup[key] = { status: 'not_found' }
        }
      } catch (failure) {
        lookup[key] = { status: 'unavailable', message: failure?.message || '读取 CRM 客户目录失败' }
        if (failure?.crmLoginRequired) excelCRMRequired.value = true
      }
      completed += 1
      excelCRMProgress.value = `正在按客户名称核对 CRM（${completed}/${names.length}）…`
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, names.length) }, () => worker()))
  if (disposed || ticket !== excelGeneration) return null
  excelCRMProgress.value = ''
  return applyContractExcelCustomerLookup(records, lookup)
}

/**
 * applyExcelImport 解析 Excel、匹配 PDF、写入表单详情并做本地校验。
 * 参数：无；使用当前 excelFile、已选/已暂存原件和未建项批次。
 * 返回值：Promise<void>；结构性匹配问题阻断预检，字段问题交给现有逐行校验。
 */
async function applyExcelImport() {
  if (busy.value || excelBusy.value || !excelFile.value || !isFormEntry.value) return
  if (batchHasCreatedContract()) {
    excelMessage.value = '当前批次已有创建完成的合同，不能用 Excel 覆盖详情；请逐行核对已建项，或开始新批次。'
    excelIssues.value = []
    excelSummary.value = null
    return
  }
  const ticket = ++excelGeneration
  excelBusy.value = true
  excelStale.value = false
  excelMessage.value = ''
  excelCRMRequired.value = false
  excelCRMProgress.value = ''
  try {
    await ensureDetectionCategories()
    const sheets = await readContractExcelWorkbook(excelFile.value)
    if (disposed || ticket !== excelGeneration || normalEntryMode.value !== 'excel' || !isFormEntry.value) return
    const parsed = parseContractExcelWorkbook(sheets)
    const matchingFiles = excelSourceFiles.value
    const matched = matchContractExcelRecordsToFiles(parsed.records, matchingFiles)
    if (disposed || ticket !== excelGeneration || normalEntryMode.value !== 'excel') return
    const historical = isHistoricalEntry.value ? readHistoryExcelRecords(sheets, matched.matchedRecords)
      : { records: matched.matchedRecords, issues: [] }
    const resolved = isHistoricalEntry.value ? historical.records
      : await resolveExcelCustomers(matched.matchedRecords, ticket)
    if (!resolved || disposed || ticket !== excelGeneration || normalEntryMode.value !== 'excel') return
    const keyByFileName = {}
    for (const row of formRows.value) if (row.fileName && row.key) keyByFileName[row.fileName] = row.key
    const rows = buildContractExcelImportRows(resolved, { keyByFileName })
    if (isHistoricalEntry.value) rows.forEach((row, index) => {
      const existing = formRows.value.find(old => old.fileName === row.fileName)
      row.importMode = existing?.importMode
      row.sourceFileRef = existing?.sourceFileRef
      row.historyEvidence = { ...existing?.historyEvidence, ...resolved[index].historyEvidence }
      if (resolved[index].historyEvidence?.target_owner_name
          && resolved[index].historyEvidence.target_owner_name !== existing?.historyEvidence?.target_owner_name) {
        delete row.historyEvidence.target_owner_user_id
      }
      row.policyOptions = { ...existing?.policyOptions, ...resolved[index].policyOptions }
    })
    // parsed.issues 已汇总工作簿问题和所有 Excel 行的问题；未被 PDF 匹配的行也必须保留其问题，
    // 否则重复合同编号等结构性错误会在后续展示/阻断时丢失。
    const finalIssues = dedupeExcelIssues([...parsed.issues, ...matched.issues, ...historical.issues, ...resolved.flatMap((record) => record.issues)])
      // 空合同编号会同时产生 record 与 match 两条同义问题；页面只保留带行号的 match 一条。
      .filter((issue) => !(issue.scope === 'record' && issue.code === 'CONTRACT_NUMBER_REQUIRED'))
    formRows.value = rows
    excelIssues.value = finalIssues
    excelSummary.value = summarizeContractExcelImport({ records: parsed.records, matchedRecords: resolved, issues: finalIssues, files: matchingFiles })
    const rowFieldIssues = validateImportFormRows(rows, importFormOptions())
    applyFormIssues(rowFieldIssues)
    const directoryIssueCount = applyExcelDirectoryIssues(rows)
    const fieldIssueCount = rowFieldIssues.length + directoryIssueCount
    syncRowBatchState()
    const structuralBlocking = blockingContractExcelIssues(finalIssues).filter((issue) => issue.scope === 'workbook'
      || issue.scope === 'match' || excelStructuralIssueCodes.has(issue.code))
    if (structuralBlocking.length) {
      excelMessage.value = `Excel 匹配发现 ${structuralBlocking.length} 处需要处理的问题；修正后重新选择 Excel，或按提示补充缺少的 PDF/合同行。`
    } else if (fieldIssueCount) {
      excelMessage.value = `已按 Excel 写入 ${rows.length} 行合同详情；仍有 ${fieldIssueCount} 处字段需要修正，可逐行打开「编辑详情」处理。`
    } else if (rows.length) {
      excelMessage.value = `已按 Excel 写入 ${rows.length} 行合同详情；请逐行打开「编辑详情」核对，再暂存并预检。`
    } else {
      excelMessage.value = 'Excel 没有匹配到可导入的合同；请检查合同编号和 PDF 文件名。'
    }
  } catch (failure) {
    if (disposed || ticket !== excelGeneration) return
    excelIssues.value = [{ scope: 'workbook', rowNumber: 0, contractNumber: '', code: 'EXCEL_READ_FAILED', message: failure?.message || '读取 Excel 失败', blocking: true }]
    excelSummary.value = null
    excelCRMProgress.value = ''
    excelMessage.value = failure?.message || '读取 Excel 失败，请检查文件后重试。'
  } finally {
    if (!disposed && ticket === excelGeneration) excelBusy.value = false
  }
}

/**
 * selectNormalEntryMode 在 Excel 批量与手动逐份之间切换，保留已选原件。
 * 参数：value 为 'excel' 或 'manual'。
 * 返回值：无；切回手动时只为缺少表单行的原件补行。
 */
function selectNormalEntryMode(value) {
  if (busy.value || !isFormEntry.value || !['excel', 'manual'].includes(value)) return
  if (value === 'excel' && localImportSources.value) {
    error.value = '本地来源请使用逐份表单选择目录引用，可一次上传多份原件后批量预检。'
    return
  }
  // 模式切换必须作废在途 Excel 响应，否则迟到结果会覆盖手动行或另一模式的编辑。
  excelGeneration++
  excelBusy.value = false
  excelCRMProgress.value = ''
  normalEntryMode.value = value
  fileMessage.value = ''
  if (value === 'excel') {
    if (excelFile.value) {
      excelStale.value = false
      void applyExcelImport()
    } else {
      excelStale.value = false
      excelIssues.value = []
      excelSummary.value = null
      excelMessage.value = ''
    }
    return
  }
  const existing = new Set(formRows.value.map((row) => row.fileName))
  const missing = files.value.filter((file) => !existing.has(file.name)).map((file) => {
    const row = createImportFormRow({ fileName: file.name })
    flagMissingExternalRecordId(row)
    return row
  })
  if (missing.length) formRows.value = [...formRows.value, ...missing]
}

/**
 * markExcelStale 在 PDF/行集合变化后作废旧 Excel 匹配，并要求用户显式重新应用。
 * 参数：无。
 * 返回值：无；不自动重建表单行，避免静默覆盖用户在「编辑详情」中已做的修改。
 */
function markExcelStale() {
  if (normalEntryMode.value !== 'excel' || !excelFile.value || !isFormEntry.value) return
  excelGeneration++
  excelBusy.value = false
  excelCRMProgress.value = ''
  excelStale.value = true
  excelMessage.value = '原件或合同行已变化：请点击「重新应用 Excel」重新匹配（会覆盖未保存详情），或切换手动逐份填写后继续。'
}

const externalRecordIdMessage = '来源业务键（原系统合同编号/业务键）不能为空，只能使用字母/数字/._:-，且不能重复。'

function hasExternalRecordId(row) {
  return Boolean(String(row?.externalRecordId || '').trim())
}

/**
 * flagMissingExternalRecordId 让新建行立即显示缺少来源业务键，避免静默生成或悄悄放过。
 * 参数：row为刚生成的表单行。
 * 返回值：无；只补充该字段问题，不覆盖其它已定位错误。
 */
function flagMissingExternalRecordId(row) {
  if (!row || hasExternalRecordId(row)) return
  if (rowIssues(row).some((issue) => issue.field === 'externalRecordId')) return
  row.issues = [...rowIssues(row), { rowKey: row.key, field: 'externalRecordId', code: 'REQUIRED', message: externalRecordIdMessage }]
}

/**
 * clearExternalRecordIdIssue 在用户补填来源业务键后移除过期的行内提示。
 * 参数：row为抽屉当前行；event为输入事件，优先取输入框当前值，避免依赖 v-model 的更新顺序。
 * 返回值：无；字符是否合法仍由预检统一判定。
 */
function clearExternalRecordIdIssue(row, event) {
  if (!row) return
  const value = event?.target?.value ?? row.externalRecordId
  if (!String(value || '').trim()) return
  const remaining = rowIssues(row).filter((issue) => issue.field !== 'externalRecordId')
  if (remaining.length !== rowIssues(row).length) row.issues = remaining
}

function rowStateTone(row) {
  if (rowIssueCount(row)) return 'danger'
  if (row.state === 'CREATED' || row.state === 'COMPLETE') return 'success'
  if (row.state === 'READY' || row.state === 'PREVIEWED') return 'info'
  return 'neutral'
}

function normalizedCustomerDiff(row) {
  const normalized = row.normalized
  if (!normalized) return false
  return String(normalized.customer_name ?? '') !== String(row.customerName || '').trim()
    || String(normalized.crm_customer_id ?? '') !== String(row.crmCustomerId || '').trim()
}

function amountMinorHint(row) {
  try {
    const minor = paymentAmountMinor(row.amount)
    return `提交时精确转换为 ${minor} 分（${formatImportMinor(minor)} 元）`
  } catch {
    return '按元填写，最多两位小数；提交前自动转换为整数分，避免浮点误差。'
  }
}

/**
 * selectFiles 只追加尚未选择过的原件，并为每份原件生成一行合同。
 * 参数：event为文件输入事件；读取后清空 input，方便重命名后重新选择同名文件。
 * 返回值：无；重名、格式或体积错误显示可见提示，不静默替换已有行。
 */
function selectFiles(event) {
  const picked = Array.from(event?.target?.files || [])
  if (event?.target) event.target.value = ''
  fileMessage.value = ''
  const known = new Set(files.value.map((file) => file.name))
  const nextFiles = [...files.value]
  const nextRows = [...formRows.value]
  for (const file of picked) {
    if (known.has(file.name)) {
      fileMessage.value = `同一文件「${file.name}」只能选择一次；请先移除重复原件或整理文件后再导入。`
      continue
    }
    try { validateContractSourceFile(file, { pdfEnabled: props.pdfEnabled }) }
    catch (failure) { fileMessage.value = `${file.name}：${failure.message}`; continue }
    if (isFormEntry.value && nextFiles.length >= 100) {
      fileMessage.value = '每批最多 100 份合同，请拆分后再导入。'
      break
    }
    known.add(file.name)
    nextFiles.push(file)
    if (isFormEntry.value && normalEntryMode.value === 'manual' && !nextRows.some((row) => row.fileName === file.name)) {
      const row = createImportFormRow({ fileName: file.name })
      flagMissingExternalRecordId(row)
      nextRows.push(row)
    }
  }
  const filesChanged = nextFiles.length !== files.value.length
  files.value = nextFiles
  const selectedNames = new Set(nextFiles.map((file) => file.name))
  excelExcludedFiles.value = excelExcludedFiles.value.filter((name) => !selectedNames.has(name))
  if (isFormEntry.value && normalEntryMode.value === 'manual') formRows.value = nextRows
  advancedMessage.value = ''
  if (filesChanged) markExcelStale()
}

/**
 * dropFiles 让拖入的文件走同一套格式、重名与行生成逻辑，不产生第二套入口。
 * 参数：event为拖放事件。
 * 返回值：无。
 */
function dropFiles(event) {
  const dropped = Array.from(event?.dataTransfer?.files || [])
  if (dropped.length) selectFiles({ target: { files: dropped, value: '' } })
}

// removeRow 移除未建项及其新选原件，已建合同保持冻结身份。
// 参数：row为当前表单行。
// 返回值：无；已建项需要纠错时显示明确提示。
function removeRow(row) {
  if (row.contractId) {
    error.value = '该项已创建合同，不能从批次移除；更正请走合同纠错流程。'
    return
  }
  formRows.value = formRows.value.filter((item) => item.key !== row.key)
  files.value = files.value.filter((file) => file.name !== row.fileName)
  if (row.fileName && !excelExcludedFiles.value.includes(row.fileName)) excelExcludedFiles.value.push(row.fileName)
  if (drawerRowKey.value === row.key) closeDrawer()
  markExcelStale()
}

function removeSelectedFile(file) {
  files.value = files.value.filter((item) => item.name !== file.name)
  formRows.value = formRows.value.filter((row) => row.fileName !== file.name)
  if (file.name && !excelExcludedFiles.value.includes(file.name)) excelExcludedFiles.value.push(file.name)
  markExcelStale()
}

// selectEntryMode 切换新历史批次模式，作废迟到解析但保留用户文件与已编辑行。
// 参数：modeValue为服务端开放的历史模式。
// 返回值：无；已保存批次禁止改变生命周期。
function selectEntryMode(modeValue) {
  if (modeLocked.value || busy.value || !newBatchModes.value.includes(modeValue)) return
  excelGeneration++
  excelBusy.value = false
  excelCRMProgress.value = ''
  entryMode.value = modeValue
  fileMessage.value = ''
  advancedMessage.value = ''
  jsonAuthoritative.value = false
  markExcelStale()
}

function rowStaged(row) {
  return (batch.value?.sources || []).some((source) => source.state === 'READY' && source.item_key === row.key && source.filename === row.fileName)
}

function addServiceItem(row) {
  if (!Array.isArray(row.serviceItems)) row.serviceItems = []
  if (row.serviceItems.length >= 20) return
  row.serviceItems.push(emptyImportServiceItem())
}

function removeServiceItem(row, index) {
  if (row.serviceItems.length <= 1) return
  row.serviceItems.splice(index, 1)
}

function addSystem(service) {
  if (!Array.isArray(service.systems)) service.systems = []
  if (service.systems.length >= 15) return
  service.systems.push({ name: '', level: '' })
}

function removeSystem(service, index) {
  service.systems.splice(index, 1)
}

function addPaymentTerm(row) {
  if (!Array.isArray(row.paymentTerms)) row.paymentTerms = []
  if (row.paymentTerms.length >= 100) return
  const used = new Set(row.paymentTerms.map((term) => Number(term.installment_no)))
  let next = 1
  while (used.has(next)) next += 1
  row.paymentTerms.push({ installment_no: next, due_date: '', amount: '' })
}

function removePaymentTerm(row, index) {
  row.paymentTerms.splice(index, 1)
}

/**
 * openRow 打开单行编辑抽屉并把焦点移入；关闭后回到触发按钮。
 * 参数：row为目标行，event用于记录焦点返回位置。
 * 返回值：无；同时按需读取检测类别目录。
 */
function openRow(row, event) {
  if (row.contractId) {
    error.value = '该项已创建合同，保留已冻结的原件及历史信息；更正请走合同纠错流程。'
    return
  }
  if (isHistoricalEntry.value) {
    const detail = historyImportDetails(row, row.importMode || entryMode.value, historyOptions.value)
    row.historyEvidence = detail.history_evidence
    row.policyOptions = detail.policy_options
  }
  drawerReturnFocus = event?.currentTarget || null
  drawerRowKey.value = row.key
  customerOptions.value = []
  customerError.value = ''
  customerCrmRequired.value = false
  drawerSourceError.value = ''
  void ensureDetectionCategories()
  nextTick(() => drawerRef.value?.focus?.())
}

function closeDrawer() {
  drawerRowKey.value = ''
  const target = drawerReturnFocus
  drawerReturnFocus = null
  nextTick(() => target?.focus?.())
}

function onDrawerKeydown(event) {
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    closeDrawer()
    return
  }
  if (event.key !== 'Tab' || !drawerRef.value) return
  const focusable = Array.from(drawerRef.value.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'))
  if (!focusable.length) return
  const first = focusable[0], last = focusable[focusable.length - 1]
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
}

/**
 * ensureDetectionCategories 读取项目管理检测类别目录，导入表单不得保存自由文本类别。
 * 参数：force为true时忽略成功缓存重新读取。
 * 返回值：Promise<void>；失败保留可重试提示，不阻断已保存值编辑。
 */
async function ensureDetectionCategories(force = false) {
  if (drawerLocalCategories.value) return
  if (!isFormEntry.value || detectionCategoryLoading.value) return
  if (!force && detectionCategoriesLoaded) return
  detectionCategoryLoading.value = true
  detectionCategoryError.value = ''
  try {
    const options = await listContractDetectionCategories()
    if (disposed) return
    detectionCategoryOptions.value = (options || []).filter((item) => item?.category)
    detectionCategoriesLoaded = true
    if (!detectionCategoryOptions.value.length) detectionCategoryError.value = '项目管理尚未配置可用的检测类别，请配置后再预检。'
  } catch (failure) {
    if (disposed) return
    detectionCategoryOptions.value = []
    detectionCategoryError.value = failure?.message || '读取检测类别目录失败，请稍后重试。'
  } finally {
    if (!disposed) detectionCategoryLoading.value = false
  }
}

/**
 * loadCustomers 在用户主动检索时核对 CRM 会话并读取权限范围内的有效客户。
 * 参数：row为当前抽屉行，用于回填客户编号和权威名称。
 * 返回值：Promise<void>；登录缺失时保留表单并给出连接入口。
 */
async function loadCustomers(row) {
  if (row?.counterpartySource === 'LOCAL' || drawerLocalCounterparty.value) return
  if (customerLoading.value || busy.value) return
  customerLoading.value = true
  customerError.value = ''
  customerCrmRequired.value = false
  try {
    await ensureContractCRMDirectorySession()
    const result = await listMyCustomers({ keyword: row.customerName || '', page: 1, page_size: 20 })
    customerOptions.value = result.items || []
    if (!customerOptions.value.length) customerError.value = '没有匹配的有效客户，请调整客户名称后重试。'
  } catch (failure) {
    if (failure?.crmLoginRequired) {
      customerCrmRequired.value = true
      customerError.value = failure.message
    } else customerError.value = failure?.message || '读取可关联客户失败，请稍后重试。'
  } finally {
    customerLoading.value = false
  }
}

function selectCustomer(row, item) {
  row.crmCustomerId = String(item.id || item.customer_id || '')
  row.customerName = String(item.name || item.customer_name || '')
  customerOptions.value = []
  customerError.value = ''
}

function toggleJsonAuthoritative() {
  advancedMessage.value = ''
  if (jsonAuthoritative.value) {
    if (!text.value.trim()) regenerateJSON()
    const notice = '已切换为以 JSON 清单为准：预检会直接保存下方 JSON，表单修改不会生效。取消勾选后会重新用表单生成清单。'
    advancedMessage.value = text.value.trim() ? notice : `${advancedMessage.value} ${notice}`.trim()
    return
  }
  regenerateJSON()
}

// regenerateJSON 根据当前表单生成核对清单，保留既有历史策略及来源身份。
// 参数：无。
// 返回值：无；校验失败时只提示，不覆盖当前清单。
function regenerateJSON() {
  if (!isFormEntry.value) return
  try {
    text.value = JSON.stringify(buildImportManifestFromRows(formRows.value, {
      ...importFormOptions(),
    }), null, 2)
    advancedMessage.value = '已根据当前表单重新生成清单；表单修正后再点一次可刷新。'
  } catch (failure) {
    advancedMessage.value = `当前表单还不能生成清单：${failure.message}`
  }
}

function onAdvancedToggle(event) {
  if (event?.target?.open && !jsonAuthoritative.value) regenerateJSON()
}

/**
 * refresh 查询已有结果；断网后保留批次号，不自动新建批次。
 * 参数：id为查询批次号，fromWrite仅供当前写命令收尾读取使用。
 * 返回值：Promise<void>；错误保留可见提示。
 */
async function refresh(id = lookupID.value.trim(), { fromWrite = false } = {}) {
  if (busy.value && !fromWrite) return
  const current = ++generation
  clearTimeout(timer)
  try {
    const result = await contractImportRequest('get', id)
    if (disposed || current !== generation) return
    batch.value = result
    const switched = batchID.value !== result.batch_id
    if (switched) {
      crmConnectionMessage.value = ''
      documentGeneration++; document.value = null; text.value = ''; files.value = []; sourceSelectionVersion.value++
      commitKey.value = ''; confirmationAttempt.value = null; actionAttempt.value = null
      formRows.value = []; fileMessage.value = ''; advancedMessage.value = ''; jsonAuthoritative.value = false; drawerRowKey.value = ''; drawerReturnFocus = null
      resetExcelState(); normalEntryMode.value = localImportSources.value ? 'manual' : 'excel'
    }
    batchID.value = result.batch_id
    if (switched || lookupID.value.trim() === result.batch_id) lookupID.value = result.batch_id
    sourceSystem.value = result.source_system || 'legacy'
    const batchMode = result.items?.[0]?.item?.mode
    if (batchMode) entryMode.value = batchMode
    if (switched && historicalExcelModes.includes(batchMode)) normalEntryMode.value = 'excel'
    if (!text.value && result.items?.length) {
      text.value = JSON.stringify({ schema_version: 1, source_system: result.source_system, items: result.items.map((entry) => entry.item) }, null, 2)
    }
    if (isFormEntry.value && result.items?.length && (switched || !formRows.value.length)) {
      formRows.value = importRowsFromItems(result.items, result.sources || [])
    }
    syncRowBatchState()
    error.value = ''
    const awaitingConfirmation = ['STARTING', 'PENDING'].includes(result.confirmation?.state)
    const awaitingTarget = result.items?.some(entry => entry.targets?.some(target => ['QUEUED', 'RUNNING', 'WAITING', 'RELEASE_REQUESTED'].includes(target.state)))
    if (['RUNNING', 'QUEUED'].includes(result.state) || awaitingConfirmation || awaitingTarget) timer = setTimeout(() => refresh(result.batch_id), awaitingConfirmation || awaitingTarget ? 5000 : 2000)
  } catch (failure) { if (!disposed && current === generation) error.value = failure.message }
}

/**
 * startNewBatch 打开下一批本地清单，已保存的服务端任务继续保留。
 * 参数：无；仅允许当前可新建且没有写请求在途的操作者。
 * 返回值：无；隔离旧读取和原件响应，清除本地文件、表单及命令状态。
 */
function startNewBatch() {
  if (busy.value || !props.enabled || !props.canPreview) return
  clearTimeout(timer); generation++; documentGeneration++
  batch.value = null; batchID.value = ''; lookupID.value = ''
  text.value = ''; files.value = []; sourceSelectionVersion.value++
  document.value = null; commitKey.value = ''; error.value = ''
  confirmationAttempt.value = null; actionAttempt.value = null
  crmConnectionMessage.value = ''
  formRows.value = []; jsonAuthoritative.value = false; fileMessage.value = ''; advancedMessage.value = ''
  drawerRowKey.value = ''; drawerReturnFocus = null; customerOptions.value = []; customerError.value = ''; customerCrmRequired.value = false
  normalEntryMode.value = 'excel'; resetExcelState()
  entryMode.value = newBatchModes.value[0] || ''
  sourceSystem.value = 'legacy'
  for (const key of Object.keys(historyOptions.value)) historyOptions.value[key] = ''
}

/**
 * connectCRM 从明确授权错误或客户目录检索进入既有正常登录，保留原批次及未保存输入。
 * 参数：force为true表示由抽屉内客户检索主动发起；普通入口仍要求已出现授权错误。
 * 返回值：无；提示返回后重新预检，不自动上传、建单、提交或放行。
 */
function connectCRM(force = false) {
  if (busy.value || disposed || !props.canPreview) return
  if (!force && !crmConnectionRequired.value) return
  crmConnectionMessage.value = openContractCRMLogin()
    ? '已打开 CRM，请用同一账号登录并查询客户，返回后点击重新预检；原批次及原件保留。'
    : '无法打开 CRM 登录页，请允许浏览器弹出窗口后再点击连接 CRM。'
}

/**
 * importSourceErrorMessage 把原件准入拒绝还原成可定位的具体原因。
 * 参数：failure为contractImportRequest抛出的错误，含message、code、status与details。
 * 返回值：中文提示；有reason_code时附原因码，原件准入拒绝附文件名，繁忙拒绝明确可重试。
 */
function importSourceErrorMessage(failure) {
  const details = failure && typeof failure.details === 'object' && failure.details !== null ? failure.details : {}
  const reasonCode = typeof details.reason_code === 'string' ? details.reason_code.trim() : ''
  const fileName = typeof details.file_name === 'string' ? details.file_name.trim().slice(0, 160) : ''
  const message = typeof failure?.message === 'string' ? failure.message.trim() : ''
  const reason = reasonCode ? `（原因码 ${reasonCode}）` : ''
  // 503/IMPORT_SOURCE_BUSY 是PDF校验并发繁忙，原样重试即可，不能提示用户改动已填数据。
  if (failure?.code === 'IMPORT_SOURCE_BUSY' || reasonCode === 'IMPORT_SOURCE_BUSY') {
    return `${message || 'PDF 校验繁忙，请稍后重试。'} 已填数据无需修改，稍后直接重新预检${reason}。`
  }
  if (!reasonCode) return `${message || '原件未通过校验，请核对原件格式和文件名后重试。'}${fileName ? `（原件「${fileName}」）` : ''}`
  return `${fileName ? `原件「${fileName}」未通过校验：` : ''}${message || '原件未通过校验，请核对原件格式和文件名后重试。'}${reason}`
}

/**
 * preview 建立批次、逐文件暂存后提交清单预检。
 * 参数：无；Excel与表单生成普通或历史清单，高级旧批次保留原JSON及精确原件代次。
 * 返回值：Promise<void>；任一不确定结果保留批次号并要求先查询。
 */
async function preview() {
  generation++; clearTimeout(timer)
  busy.value = true; error.value = ''; fileMessage.value = ''
  crmConnectionMessage.value = ''
  let writeStarted = false
  try {
    if (!batchID.value && !newBatchModes.value.includes(entryMode.value)) throw new Error('批量导入仅用于历史存档或历史结清档案，新建合同请走正常流程。')
    if (batch.value?.operation_id && !['PAUSED', 'PARTIAL', 'DRAFT', 'BLOCKED', 'PREVIEWED'].includes(batch.value.state)) throw new Error('请先暂停批次并查询结果，只有未建单项可修订。')
    if (isFormEntry.value && normalEntryMode.value === 'excel' && excelStale.value) {
      throw new Error('原件或合同行已变化，请先点击「重新应用 Excel」或切换手动逐份填写后再预检。')
    }
    if (isFormEntry.value && normalEntryMode.value === 'excel' && excelStructuralIssues.value.length) {
      throw new Error('Excel 与 PDF 还有未处理的结构性匹配问题，请先按上方提示修正后再预检。')
    }
    if (isFormEntry.value && normalEntryMode.value === 'excel') {
      // 用户可能在抽屉里修改了服务类型/检测类别；预检前重新用当前目录刷新一次，避免误放行或残留过期提示。
      clearExcelDirectoryIssues(formRows.value)
      const directoryIssueCount = applyExcelDirectoryIssues(formRows.value)
      if (directoryIssueCount) throw new Error('Excel 有 ' + directoryIssueCount + ' 处服务类型/检测类别不在当前目录中，请逐行修正后再预检。')
    }
    if (usesJsonManifest.value && !text.value.trim()) throw new Error('请填写完整 JSON 清单后再预检。')
    if (!usesJsonManifest.value) {
      const built = buildImportManifestFromRows(formRows.value, {
        ...importFormOptions(),
      })
      text.value = JSON.stringify(built, null, 2)
      advancedMessage.value = '清单已从当前表单及显式历史信息生成。'
      formRows.value.forEach((row) => { row.issues = [] })
    }
    const prepared = prepareImportManifest(
      text.value, files.value, batch.value?.sources || [], props.supportedModes, entryMode.value,
    )
    if (!batchID.value && prepared.manifest.items.some(item => !newBatchModes.value.includes(item.mode))) {
      throw new Error('新批量导入只接受历史存档或历史结清档案，接续履约旧批次请按原批次号恢复。')
    }
    for (const item of prepared.manifest.items) {
      if (!historicalExcelModes.includes(item.mode) || item.policy_options?.finance_mode === 'NONE') continue
      const old = batch.value?.items?.find(entry => entry.item.item_key === item.item_key)?.item
      if (!old || old.external_record_id !== item.external_record_id || old.mode !== item.mode
          || ['policy_version', 'project_mode', 'finance_mode', 'report_mode', 'responsibility_mode', 'signing_mode']
            .some(field => old.policy_options?.[field] !== item.policy_options?.[field])) {
        throw new Error('新历史导入不参与结算开票，不能使用财务接续策略；旧批次仅保留原策略恢复。')
      }
    }
    for (const file of files.value) validateContractSourceFile(file, { pdfEnabled: props.pdfEnabled })
    // 上传前兜底：映射缺失或不是带 name 的对象时立刻失败，绝不把 undefined 塞进 FormData（会被序列化成 "undefined" 发出去）。
    for (const item of prepared.manifest.items) {
      if (prepared.stagedByKey.has(item.item_key)) continue
      const pending = prepared.filesByName.get(item.source_file_ref)
      if (!pending || typeof pending.name !== 'string' || !pending.name.trim()) {
        const label = typeof item.source_file_ref === 'string' && item.source_file_ref.trim() ? item.source_file_ref.trim().slice(0, 120) : item.item_key
        throw new Error(`原件未就绪：${label}，请重新选择原件后再预检。`)
      }
    }
    writeStarted = true
    if (!batch.value) {
      const created = await contractImportRequest('create', '', { schema_version: 1, source_system: prepared.manifest.source_system })
      batch.value = created; batchID.value = created.batch_id; lookupID.value = created.batch_id
    }
    if (batch.value.source_system !== prepared.manifest.source_system) throw new Error('来源系统不能在批次内改变。')
    for (const item of prepared.manifest.items) {
      if (prepared.stagedByKey.has(item.item_key)) { item.source_file_ref = prepared.stagedByKey.get(item.item_key); continue }
      const form = new FormData()
      form.set('file', prepared.filesByName.get(item.source_file_ref))
      form.set('item_key', item.item_key); form.set('expected_version', String(batch.value.version))
      const source = await contractImportRequest('files', batchID.value, form)
      item.source_file_ref = source.file_ref
      batch.value = await contractImportRequest('get', batchID.value)
    }
    batch.value = await contractImportRequest('manifest', batchID.value, { expected_version: batch.value.version, manifest: prepared.manifest })
    batch.value = await contractImportRequest('preview', batchID.value, { revision: batch.value.revision })
    text.value = JSON.stringify({ schema_version: 1, source_system: batch.value.source_system, items: batch.value.items.map(entry => entry.item) }, null, 2)
    files.value = []; sourceSelectionVersion.value++; commitKey.value = ''; confirmationAttempt.value = null
    formRows.value.forEach((row) => { row.issues = [] })
    excelIssues.value = []; excelSummary.value = null; excelMessage.value = ''; excelCRMRequired.value = false; excelCRMProgress.value = ''
    syncRowBatchState()
  } catch (failure) {
    if (failure?.code === 'IMPORT_ENTRY_MODE_MISMATCH') {
      // 本地模式校验还没有发起写入，不能用旧批次覆盖用户尚未保存的清单和原件。
      error.value = failure.message
    } else if (failure?.issues?.length) {
      applyFormIssues(failure.issues)
      error.value = `表单有 ${failure.issues.length} 处需要修正：${failure.message}`
      if (writeStarted && batchID.value) await refresh(batchID.value, { fromWrite: true })
    } else {
      if (writeStarted && batchID.value) await refresh(batchID.value, { fromWrite: true })
      error.value = `${importSourceErrorMessage(failure)}${batchID.value ? ' 批次已保留，请先查询状态。' : ''}`
    }
  } finally { busy.value = false }
}

/**
 * commit 提交冻结预检，不把202受理表示为审批通过。
 * 参数：无；重试复用当前预检与幂等键。
 * 返回值：Promise<void>；未知响应先查询稳定操作。
 */
async function commit() {
  generation++; clearTimeout(timer)
  busy.value = true
  try {
    if (!commitKey.value) commitKey.value = ensureStableReviewAttempt(null, { intakeId: batchID.value, decision: 'import', version: batch.value.revision, reason: batch.value.preview_token }).key
    batch.value = await contractImportRequest('commit', batchID.value, { revision: batch.value.revision, preview_token: batch.value.preview_token }, commitKey.value)
    await refresh(batchID.value, { fromWrite: true })
  } catch (failure) { await refresh(batchID.value, { fromWrite: true }); error.value = `${failure.message} 请核对当前操作号和逐项状态。` }
  finally { busy.value = false }
}

/**
 * control 暂停或恢复持久任务，采用服务器最新版本。
 * 参数：action为pause或resume。
 * 返回值：Promise<void>；冲突时刷新结果而非新建合同。
 */
async function control(action) {
  generation++; clearTimeout(timer)
  busy.value = true
  try { batch.value = await contractImportRequest(action, batchID.value, { expected_version: batch.value.version }); await refresh(batchID.value, { fromWrite: true }) }
  catch (failure) { await refresh(batchID.value, { fromWrite: true }); error.value = failure.message }
  finally { busy.value = false }
}

/**
 * loadBatches 查询当前权限范围内的创建批次及受派确认任务。
 * 参数：offset为服务端候选游标，默认刷新当前页。
 * 返回值：Promise<void>；错误保留可见提示。
 */
async function loadBatches(offset = listOffset.value) {
  if (busy.value || listBusy.value || !Number.isInteger(offset) || offset < 0 || offset > 10000) return
  listBusy.value = true; listError.value = ''
  try {
    const result = await listContractImportBatches(offset)
    if (typeof result.has_more !== 'boolean' || (result.has_more
      && (!Number.isInteger(result.next_offset) || result.next_offset <= offset || result.next_offset > 10000))) {
      throw new Error('批次分页响应不完整，请刷新或按批次号查询。')
    }
    if (!disposed) {
      batches.value = result.items || []; listOffset.value = offset
      listHasMore.value = result.has_more; listNextOffset.value = result.next_offset
      listLimitReached.value = result.query_limit_reached === true
    }
  } catch (failure) { if (!disposed) listError.value = failure.message }
  finally { if (!disposed) listBusy.value = false }
}

/**
 * confirmation 执行独立历史确认申请或当前可信角色的确认命令。
 * 参数：action为空表示提交，否则为APPROVE、REJECT或WITHDRAW。
 * 返回值：Promise<void>；未知响应先查询，不从客户端宣布通过。
 */
async function confirmation(action = '') {
  generation++; clearTimeout(timer)
  busy.value = true
  try {
    if (!action) {
      confirmationAttempt.value = ensureStableReviewAttempt(confirmationAttempt.value, { intakeId: batchID.value, decision: 'confirmation', version: batch.value.revision, reason: batch.value.preview_token })
      await contractImportRequest('submit-confirmation', batchID.value, { revision: batch.value.revision, preview_token: batch.value.preview_token }, confirmationAttempt.value.key)
    } else {
      const workflow = batch.value.confirmation?.workflow_id || ''
      if ((batch.value.confirmation?.commands || []).some(command => command.actor_id === props.actorId && command.action === action)) { await refresh(batchID.value, { fromWrite: true }); return }
      if (!actionAttempt.value || actionAttempt.value.batchID !== batchID.value || actionAttempt.value.workflow !== workflow || actionAttempt.value.action !== action) {
        const attempt = ensureStableReviewAttempt(null, { intakeId: batchID.value, decision: action, version: batch.value.version, reason: workflow })
        actionAttempt.value = { ...attempt, batchID: batchID.value, workflow, action, expectedVersion: batch.value.version }
      }
      await contractImportRequest('confirmation-actions', batchID.value, { expected_version: actionAttempt.value.expectedVersion, command_key: actionAttempt.value.key, action })
    }
    await refresh(batchID.value, { fromWrite: true })
  } catch (failure) {
    await refresh(batchID.value, { fromWrite: true })
    if (action && failure.status >= 400 && failure.status < 500 && ![408,429].includes(failure.status)) actionAttempt.value = null
    error.value = `${failure.message} 请先核对确认状态与命令结果。`
  }
  finally { busy.value = false }
}

/**
 * release 申请项目、财务或数析独立目标命令。
 * 参数：entry为持久单项，target为服务器目标状态，phase明确财务准备或放行。
 * 返回值：Promise<void>；完成与否只看服务器实际回执。
 */
async function release(entry, target, phase = 'RELEASE') {
  generation++; clearTimeout(timer)
  busy.value = true
  try { await releaseContractImportItem(entry.id, { target: target.target, expected_version: target.version, phase }); await refresh(batchID.value, { fromWrite: true }) }
  catch (failure) { await refresh(batchID.value, { fromWrite: true }); error.value = failure.message }
  finally { busy.value = false }
}

/**
 * canRetryProjectRejection 只为项目端明确参数拒绝显示同命令恢复入口。
 * 参数：target为服务端持久目标及真实拒绝分类。
 * 返回值：是否可提出重试；权限、版本及冻结基线仍由服务端强制核验。
 */
function canRetryProjectRejection(target) {
  return target.target === 'PROJECT' && target.phase === 'RELEASE'
    && target.state === 'BLOCKED' && target.recipient_http_status === 422
    && target.recipient_code === 'IMPORT_VALIDATION_FAILED'
}

/**
 * viewSource 读取受批次及冻结受派权限保护的同一原件描述。
 * 参数：entry为当前批次项。
 * 返回值：Promise<void>；迟到描述不会显示到另一批次。
 */
async function viewSource(entry) {
  const ticket = ++documentGeneration, id = batchID.value
  try {
    const descriptor = await getImportItemDocumentDescriptor(id, entry.id)
    if (disposed || ticket !== documentGeneration || id !== batchID.value) return
    document.value = { ...descriptor, batchID: id, itemID: entry.id }
  } catch (failure) { if (ticket === documentGeneration) error.value = failure.message }
}

/**
 * closeSource 关闭当前冻结原件并隔离迟到的描述响应。
 * 参数：无。
 * 返回值：无；PDF子组件卸载时释放当前Object URL。
 */
function closeSource() { documentGeneration++; document.value = null }

/**
 * downloadImportErrorReport 只根据当前批次已返回的逐项问题和可见批次错误生成 CSV。
 * 参数：无；不发起网络请求，不补造错误。
 * 返回值：无；无问题项时按钮禁用，下载后立即回收 Object URL。
 */
function downloadImportErrorReport() {
  if (!importErrorReportRows.value.length) return
  let url = ''
  try {
    const csv = contractImportErrorsCsv(batch.value?.items || [], error.value, { issueLabels, fieldLabel: importFieldLabel })
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url; link.download = '合同导入错误.csv'
    document.body.appendChild(link); link.click(); link.remove()
  } catch (failure) { error.value = failure?.message || '错误报告生成失败，请稍后重试。' }
  finally { if (url) URL.revokeObjectURL(url) }
}

/**
 * loadAutoApprove 读取历史导入自动审批的当前状态与服务端能力开关。
 * 参数：无；只有合同超级管理员触发，能力关闭也是正常返回。
 * 返回值：Promise<void>；迟到的读取不会覆盖更新的读取结果。
 */
async function loadAutoApprove() {
  if (!props.canManageAutoApprove) return
  const ticket = ++autoApproveTicket
  autoApproveLoading.value = true
  autoApproveError.value = ''; autoApproveErrorCode.value = ''; autoApproveCopyHint.value = ''
  try {
    const data = await getImportAutoApproveSetting()
    if (disposed || ticket !== autoApproveTicket) return
    autoApprove.value = data
  } catch (failure) {
    if (disposed || ticket !== autoApproveTicket) return
    autoApproveErrorCode.value = typeof failure?.code === 'string' ? failure.code : ''
    autoApproveError.value = failure?.message || '读取历史导入自动审批设置失败，请稍后重试。'
  } finally {
    if (ticket === autoApproveTicket) autoApproveLoading.value = false
  }
}

// 初始化与权限迟到时都只读一次：已有结果、正在读取或已报错都不重复请求。
function ensureAutoApproveLoaded() {
  if (!props.canManageAutoApprove || autoApproveBusy.value || autoApprove.value || autoApproveError.value) return
  loadAutoApprove()
}

/**
 * requestAutoApproveToggle 打开确认条，不直接写服务端。
 * 参数：event为原生复选框事件；确认前一律把开关显示拉回服务器状态。
 * 返回值：无；真正保存见 applyAutoApproveToggle。
 */
function requestAutoApproveToggle(event) {
  if (event?.target) event.target.checked = autoApproveEnabled.value
  autoApproveNotice.value = ''; autoApproveError.value = ''; autoApproveErrorCode.value = ''; autoApproveCopyHint.value = ''
  if (!props.canManageAutoApprove || autoApproveBusy.value) return
  if (!autoApprove.value) { ensureAutoApproveLoaded(); return }
  if (!autoApproveCapability.value) { autoApproveError.value = AUTO_APPROVE_DISABLED_TEXT; return }
  autoApproveConfirm.value = autoApproveEnabled.value ? 'disable' : 'enable'
}

/**
 * applyAutoApproveToggle 提交确认后的开关变更，并带上刚读取到的版本。
 * 参数：无；目标状态来自当前确认条。
 * 返回值：Promise<void>；成功后以服务端返回值刷新状态，版本冲突时重新读取。
 */
async function applyAutoApproveToggle() {
  const target = autoApproveConfirm.value === 'enable'
  if (!props.canManageAutoApprove || !autoApprove.value || autoApproveSaving.value) return
  const expectedVersion = Number.isSafeInteger(autoApprove.value.version) ? autoApprove.value.version : 0
  autoApproveSaving.value = true
  autoApproveError.value = ''; autoApproveErrorCode.value = ''; autoApproveNotice.value = ''; autoApproveCopyHint.value = ''
  try {
    const data = await setImportAutoApproveSetting({ enabled: target, expectedVersion })
    autoApprove.value = data
    autoApproveConfirm.value = ''
    autoApproveNotice.value = data.enabled ? '历史导入自动审批已开启。' : '历史导入自动审批已关闭。'
  } catch (failure) {
    const code = typeof failure?.code === 'string' ? failure.code : ''
    autoApproveErrorCode.value = code
    if (code === 'IMPORT_REVISION_CONFLICT') {
      // 版本冲突说明别人刚改过：先放弃本地确认态并重新读取，避免拿旧版本反复重试。
      autoApproveConfirm.value = ''
      await loadAutoApprove()
      autoApproveErrorCode.value = code
      autoApproveError.value = autoApprove.value
        ? '设置已被其他管理员更新，已重新读取最新状态，请刷新核对后重试。'
        : '设置已被其他管理员更新，请刷新页面后重试。'
    } else if (code === 'IMPORT_AUTO_APPROVE_DISABLED') {
      autoApproveConfirm.value = ''
      autoApproveError.value = AUTO_APPROVE_DISABLED_TEXT
    } else {
      autoApproveError.value = failure?.message || '自动审批设置未能保存，请稍后重试。'
    }
  } finally { autoApproveSaving.value = false }
}

function cancelAutoApproveToggle() {
  if (!autoApproveSaving.value) autoApproveConfirm.value = ''
}

/**
 * copyAutoApproveErrorCode 复制服务端错误码，便于转给平台运维排查。
 * 参数：无；没有错误码时不复制。
 * 返回值：Promise<void>；复制失败时提示手动选择。
 */
async function copyAutoApproveErrorCode() {
  const code = autoApproveErrorCode.value
  if (!code) return
  try {
    await copyTextToClipboard(code)
    autoApproveCopyHint.value = `错误码 ${code} 已复制，可发给平台运维排查。`
  } catch {
    autoApproveCopyHint.value = '浏览器未允许自动复制，请手动选择错误码复制。'
  }
}

// 会话与角色可能晚于面板挂载到位：权限从无到有时补一次读取，避免开关一直停在“设置未读取”。
watch(() => props.canManageAutoApprove, (allowed) => { if (allowed) ensureAutoApproveLoaded() })

onMounted(() => {
  // 合同超级管理员一进入导入区就读一次开关状态，避免显示猜测的默认值。
  ensureAutoApproveLoaded()
  if (props.initialBatchId) refresh(props.initialBatchId)
})

onBeforeUnmount(() => { disposed = true; generation++; documentGeneration++; excelGeneration++; clearTimeout(timer) })
</script>

<template>
  <!-- P2-5：导入页顶部常驻状态条。放在折叠面板之外，面板收起时仍能看到
       自动审批当前状态与最近变更人/时间；只对能读取该设置的合同超级管理员渲染。 -->
  <aside v-if="section === 'imports' && canManageAutoApprove" class="contract-import-statusbar" role="status" aria-label="导入自动审批状态">
    <span class="contract-import-statusbar-label">历史导入自动审批</span>
    <span class="contract-badge" :class="autoApproveStatusTone"><i></i>{{ autoApproveStatusLabel }}</span>
    <span v-if="autoApproveUpdatedLabel" class="contract-import-statusbar-meta">{{ autoApproveUpdatedLabel }}</span>
    <span v-else-if="autoApproveLoading" class="contract-import-statusbar-meta">正在读取最近变更…</span>
    <span class="contract-import-statusbar-hint"><template v-if="!autoApprove">正在读取自动审批状态…</template><template v-else>{{ autoApproveEnabled ? '历史项将按声明状态自动审批归档' : '历史项提交后仍需人工会签' }}；变更在“批量导入”面板内确认后生效。</template></span>
  </aside>

  <details class="contract-import-panel" :open="panelOpen" @toggle="onPanelToggle">
    <summary>批量导入外部合同原件</summary>
    <div class="contract-import-body">
      <div class="contract-import-intro">
        <p class="contract-import-lede">批量导入用于历史存档与历史结清档案。上传合同原件和 Excel，逐行核对历史信息及客户开立计划后提交；新建合同请走正常新建流程。</p>
        <p class="contract-import-note">历史签署日期是来源声明，导入确认不补造原年度审批，也不替代签署原件核验。</p>
        <p v-if="!enabled" class="contract-import-note">新增批次已关闭；已有批次仍可查询、暂停与恢复。</p>
      </div>

      <ol class="contract-import-steps" aria-label="导入流程">
        <li>选择导入方式</li>
        <li>选择或拖入原件</li>
        <li>暂存并预检</li>
        <li>逐条核对问题</li>
        <li>提交冻结清单</li>
      </ol>

      <!-- 历史导入自动审批是系统级开关，只对合同超级管理员渲染；能力未开启时只读。 -->
      <section v-if="canManageAutoApprove" class="contract-import-block contract-import-auto-approve" aria-labelledby="contract-import-auto-approve-title">
        <div class="contract-import-auto-approve-head">
          <p id="contract-import-auto-approve-title" class="contract-import-batch-id">历史导入自动审批</p>
          <span class="contract-badge" :class="autoApproveStatusTone"><i></i>{{ autoApproveStatusLabel }}</span>
        </div>
        <div class="contract-import-actions">
          <label class="contract-import-switch-label">
            <input class="contract-import-switch" type="checkbox" role="switch" aria-label="历史导入自动审批开关"
              :checked="autoApproveEnabled" :disabled="autoApproveSwitchDisabled" @change="requestAutoApproveToggle" />
            <span>{{ autoApproveEnabled ? '已开启' : '已关闭' }}</span>
          </label>
          <span v-if="autoApproveUpdatedLabel">{{ autoApproveUpdatedLabel }}</span>
        </div>
        <p class="contract-import-note">开启后，历史合同导入在提交冻结清单时自动审批并按清单声明状态归档，跳过人工会签；普通新合同仍走现有逐份审批。只有合同超级管理员可以切换，保存以服务端返回的版本为准。</p>
        <p v-if="autoApproveLoading" class="contract-import-status is-loading" role="status">正在读取历史导入自动审批设置…</p>
        <p v-if="autoApprove && !autoApproveCapability" class="contract-import-warning" role="status">{{ AUTO_APPROVE_DISABLED_TEXT }}</p>
        <p v-if="autoApproveError" class="contract-import-alert" role="alert">
          {{ autoApproveError }}
          <span v-if="autoApproveErrorCode" class="contract-import-error-code">错误码 <code>{{ autoApproveErrorCode }}</code><button class="contract-text-button" type="button" @click="copyAutoApproveErrorCode">复制错误码</button></span>
          <button class="contract-text-button" type="button" :disabled="autoApproveBusy" @click="loadAutoApprove">重新读取设置</button>
        </p>
        <p v-else-if="autoApproveNotice" class="contract-import-hint" role="status">{{ autoApproveNotice }}</p>
        <p v-if="autoApproveCopyHint" class="contract-import-note" role="status">{{ autoApproveCopyHint }}</p>
        <div v-if="autoApproveConfirm" class="contract-import-auto-approve-confirm" role="group" aria-label="确认变更历史导入自动审批" aria-live="polite">
          <p class="contract-import-warning">{{ autoApproveConfirmText }}</p>
          <div class="contract-import-actions">
            <button class="contract-button primary small" type="button" :disabled="autoApproveSaving" @click="applyAutoApproveToggle">{{ autoApproveSaving ? '正在保存…' : (autoApproveConfirm === 'enable' ? '确认开启' : '确认关闭') }}</button>
            <button class="contract-button secondary small" type="button" :disabled="autoApproveSaving" @click="cancelAutoApproveToggle">取消</button>
          </div>
        </div>
      </section>

      <section class="contract-import-block contract-import-tools" aria-label="批次查询与新建">
        <div class="contract-import-toolbar">
          <button v-if="enabled && canPreview" class="contract-button secondary small" type="button" :disabled="busy" @click="startNewBatch">开始新批次（保留已保存任务）</button>
          <label class="contract-import-field">查询批次号<input v-model="lookupID" maxlength="26" :disabled="busy" autocomplete="off" /></label>
          <button class="contract-button secondary small" type="button" :disabled="busy || !lookupID" @click="refresh(lookupID)">查询／刷新结果</button>
          <button class="contract-button secondary small" type="button" :disabled="busy || listBusy" @click="loadBatches()">我的批次与待确认任务</button>
        </div>
        <p v-if="listBusy" class="contract-import-status is-loading" role="status">正在查询批次列表…</p>
        <p v-if="listError" class="contract-import-alert" role="alert">{{ listError }}</p>
        <div class="contract-import-task-list"><button v-for="record in batches" :key="record.batch_id" type="button" :disabled="busy" @click="refresh(record.batch_id)">{{ record.batch_id }} · {{ labels[record.state] || record.state }}</button></div>
        <div v-if="batches.length || listOffset || listHasMore" class="contract-import-task-list contract-import-pager"><button type="button" :disabled="busy || listBusy || !listOffset" @click="loadBatches(Math.max(0, listOffset - 50))">列表上一页</button><button type="button" :disabled="busy || listBusy || !listHasMore" @click="loadBatches(listNextOffset)">列表下一页</button></div>
        <p v-if="listLimitReached" class="contract-import-note">已到达批次列表查询上限，请使用批次号定位需要处理的记录。</p>
      </section>

      <template v-if="formEditable">
        <p v-if="!batch && !newBatchModes.length" class="contract-import-alert" role="alert">服务端尚未开放历史存档或历史结清导入，请联系管理员；不会改用普通合同导入。</p>
        <section class="contract-import-block" aria-label="导入方式">
          <p v-if="batch?.operation_id" class="contract-import-note">已建单项须原样保留，只能修订尚未建单项；新修订会使旧预检和执行代次失效。已建单内容更正需先核对原合同。</p>
          <fieldset v-if="selectableModes.length" class="contract-import-mode" :disabled="busy || modeLocked">
            <legend>导入方式</legend>
            <label v-for="modeValue in selectableModes" :key="modeValue">
              <input type="radio" name="contract-import-entry-mode" :value="modeValue" :checked="entryMode === modeValue" @change="selectEntryMode(modeValue)" />
              {{ modeLabels[modeValue] || modeValue }}{{ modeValue === 'CONTINUE_LIVE' ? '（原清单）' : '（Excel）' }}
            </label>
          </fieldset>
          <p v-if="modeLocked" class="contract-import-hint">批次已保存清单，导入方式随当前批次固定；需要换一种方式请开始新批次。</p>
          <p v-if="isNormalEntry" class="contract-import-hint">普通新合同按当前来源选择已有 CRM 客户或本地交易对方，Excel 和手动表单都不会自动建客户。历史资料需要自动建档时，请选择“历史存档”或“历史结清档案”，并上传 Excel。</p>
          <p v-else-if="['ARCHIVE_ONLY', 'HISTORICAL_CLOSED'].includes(entryMode)" class="contract-import-hint">历史自动建档启用后，由服务端查重：客户不存在时创建客户，客户编号由 CRM 生成；客户重名或停用时逐项阻断。预检只展示计划，提交冻结清单后才执行创建。</p>
        </section>

        <section v-if="isFormEntry" class="contract-import-block contract-import-stage" :aria-label="isHistoricalEntry ? '历史合同Excel导入表单' : '已有普通批次修订表单'">
          <fieldset v-if="isHistoricalEntry" id="contract-import-history" class="contract-form-grid" :disabled="busy">
            <legend>本批历史信息（Excel 行中已填写的值优先）</legend>
            <p class="contract-import-note contract-form-wide">历史导入不参与结算开票，不建立财务台账；后续由财务人员按正常流程办理。档案报表独立同步，不代表回款或开票已核验。</p>
            <label><span>来源系统标识</span><input v-model="sourceSystem" maxlength="64" :readonly="!!batch" pattern="[A-Za-z0-9_.:\-]+" /><small>同一来源保持不变，用于识别重复导入。</small></label>
            <label><span>当前负责人</span><select v-model="historyOptions.targetOwnerUserID"><option value="">请选择负责人</option><option v-if="actorId" :value="actorId">当前登录人（提交时服务端核验）</option><option v-for="owner in historyOwnerOptions" :key="owner.subject_id" :value="owner.subject_id">{{ owner.name }}</option></select></label>
            <button v-if="sourceCapabilities.local_catalog_manage" class="contract-button secondary small" type="button" :disabled="historyOwnerBusy" @click="loadHistoryOwners">{{ historyOwnerBusy ? '正在读取账号…' : '读取其他可选负责人' }}</button>
            <p v-if="historyOwnerError" class="contract-field-error" role="alert">{{ historyOwnerError }}</p>
            <label><span>原签署日期（可空）</span><input v-model="historyOptions.declaredSignedDate" type="date" /><small>按原件填写，不自动取合同开始日期。</small></label>
            <label><span>原合同状态</span><select v-model="historyOptions.historicalStatus"><option value="">请选择原状态</option><option value="archived">已归档</option><template v-if="entryMode === 'HISTORICAL_CLOSED'"><option value="completed">已完成</option><option value="terminated">已终止</option></template></select></label>
            <label><span>原客户名称（可空）</span><input v-model="historyOptions.historicalCustomerName" maxlength="255" /></label>
            <label><span>原负责人姓名（可空）</span><input v-model="historyOptions.historicalOwnerLabel" maxlength="128" /></label>
            <template v-if="entryMode === 'HISTORICAL_CLOSED'">
              <label><span>报表统计方式</span><select v-model="historyOptions.reportMode"><option value="">请选择统计方式</option><option value="ARCHIVE_SEPARATE">档案单独统计</option><option value="HISTORICAL_SEPARATE">历史单独统计</option></select></label>
            </template>
            <button class="contract-button secondary small" type="button" :disabled="!formRows.length" @click="applyBatchHistory">用本批信息覆盖各行历史信息</button>
            <p class="contract-import-note contract-form-wide">新行未填写的字段使用本批信息；已有批次保留逐行历史信息。覆盖会替换未建项的签署日期、原状态及本批所选负责人；旧策略与原财务资料保留，请先核对。</p>
          </fieldset>
          <fieldset v-if="isNormalEntry" class="contract-import-normal-modes" :disabled="busy">
            <legend>详情填写方式</legend>
            <label v-if="!localImportSources"><input type="radio" name="contract-import-normal-mode" value="excel" :checked="normalEntryMode === 'excel'" @change="selectNormalEntryMode('excel')" /> Excel 批量导入（推荐）</label>
            <label><input type="radio" name="contract-import-normal-mode" value="manual" :checked="normalEntryMode === 'manual'" @change="selectNormalEntryMode('manual')" /> 手动逐份填写</label>
          </fieldset>
          <p v-if="localImportSources && isNormalEntry" class="contract-import-hint">本地来源使用逐份表单选择真实目录引用；可以一次上传多份原件并批量预检，历史清单不自动转换来源。</p>
          <template v-if="normalEntryMode === 'excel'">
            <p class="contract-import-hint">第一步选择 PDF 原件（可多选），第二步选择填写好合同详情的 Excel。PDF 文件名去掉扩展名必须与 Excel「合同明细」的合同编号完全一致；系统按合同编号一一对应写入「编辑详情」，缺 PDF、缺 Excel 行、重复编号都会在下面列出并阻止预检。</p>
            <div class="contract-import-step">
              <div class="contract-import-dropzone" @dragover.prevent @drop.prevent="dropFiles">
                <label for="contract-import-files">第一步：选择或拖入 PDF 原件（可多选，≤100 份）</label>
                <input id="contract-import-files" :key="sourceSelectionVersion" type="file" multiple :accept="pdfEnabled ? '.docx,.pdf' : '.docx'" :disabled="busy" @change="selectFiles" />
              </div>
              <p v-if="files.length" class="contract-import-status" role="status">已选择 {{ files.length }} 份原件：{{ files.map(file => file.name).join('、') }}</p>
              <ul v-if="files.length" class="contract-import-file-list"><li v-for="file in files" :key="file.name"><span>{{ file.name }}</span> <button class="contract-text-button danger" type="button" :disabled="busy" @click="removeSelectedFile(file)">移除</button></li></ul>
            </div>
            <div class="contract-import-step">
              <div class="contract-import-dropzone">
                <label for="contract-import-excel">第二步：选择 Excel（.xlsx，≤5MiB）</label>
                <input id="contract-import-excel" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" :disabled="busy || excelBusy" @change="selectExcelFile" />
              </div>
              <p class="contract-import-note"><a :href="contractExcelTemplateURL" download>下载 Excel 标准模板（含合同明细、服务项、系统信息、付款条款和填写说明）</a></p>
              <p class="contract-import-hint">历史 Excel 的 CRM 客户编号可以留空，由服务端查重并在提交后自动创建客户、生成编号。自动开立时商机编号和名称都留空；填写真实销售姓名，新客户须有真实联系人和电话。客户类型、行业、地区可留空。“当前负责人”列填写真实姓名，系统按姓名唯一匹配有效账号；未匹配或重名会逐行提示。历史档案可填在对应分表，也可补填本批历史信息。</p>
              <p v-if="excelFile" class="contract-import-status" role="status">已选择 Excel：{{ excelFile.name }} <button class="contract-text-button" type="button" :disabled="busy || excelBusy" @click="applyExcelImport">重新应用 Excel（覆盖未保存详情）</button><button class="contract-text-button danger" type="button" :disabled="busy || excelBusy" @click="clearExcelFile">移除</button></p>
              <p v-if="excelBusy" class="contract-import-status is-loading" role="status">正在解析 Excel 并匹配 PDF…</p>
              <p v-if="excelCRMProgress" class="contract-import-status is-loading" role="status">{{ excelCRMProgress }}</p>
              <p v-if="excelMessage" class="contract-import-hint" role="status">{{ excelMessage }}</p>
              <div v-if="excelSummary" class="contract-import-excel-summary">
                <span>Excel 合同 {{ excelSummary.contractCount }} 份</span>
                <span>已匹配 {{ excelSummary.matchedCount }} 份</span>
                <span>未匹配 PDF {{ excelSummary.unmatchedFileCount }} 份</span>
                <span>阻断问题 {{ excelSummary.blockingCount }} 处</span>
              </div>
              <div v-if="excelIssues.length" class="contract-import-excel-issues" role="alert">
                <p><strong>Excel 解析与匹配问题（共 {{ excelIssues.length }} 处）：</strong></p>
                <ul><li v-for="(issue, index) in excelIssues.slice(0, 20)" :key="issue.code + '-' + issue.rowNumber + '-' + issue.contractNumber + '-' + index">{{ excelIssueText(issue) }}</li></ul>
                <p v-if="excelIssues.length > 20">…还有 {{ excelIssues.length - 20 }} 处，请先修正 Excel 或 PDF 文件名后重新应用。</p>
              </div>
              <div v-if="excelCRMRequired" class="contract-import-alert contract-import-alert--warn" role="alert">
                <p>Excel 中缺少 CRM 客户编号，部分客户尚未在 CRM 中核对。</p>
                <div class="contract-import-actions">
                  <button class="contract-button secondary small" type="button" :disabled="busy" @click="connectCRM(true)">连接 CRM</button>
                  <button class="contract-button secondary small" type="button" :disabled="busy || excelBusy" @click="applyExcelImport">登录后重新应用 Excel</button>
                </div>
              </div>
              <p v-if="batch?.items?.length" class="contract-import-hint">当前批次已恢复；重新选择 Excel 会覆盖尚未建项的详情，已建单项不会被覆盖。</p>
            </div>
          </template>
          <template v-else>
            <p class="contract-import-hint">先选择合同原件（PDF/DOCX），每份原件自动生成一行合同。文件名只作为原件引用，重命名文件后请移除该行并重新选择；同一文件只能导入一次。每行还须在「编辑详情」填写来源业务键（原系统合同编号/业务键，必填），系统据此识别重复导入的同一份合同。</p>
            <div class="contract-import-dropzone" @dragover.prevent @drop.prevent="dropFiles">
              <label for="contract-import-files">选择或拖入合同原件（可多选）</label>
              <input id="contract-import-files" :key="sourceSelectionVersion" type="file" multiple :accept="pdfEnabled ? '.docx,.pdf' : '.docx'" :disabled="busy" @change="selectFiles" />
            </div>
            <p v-if="files.length" class="contract-import-status" role="status">已选择 {{ files.length }} 份：{{ files.map(file => file.name).join('、') }}</p>
            <ul v-if="files.length" class="contract-import-file-list"><li v-for="file in files" :key="file.name"><span>{{ file.name }}</span> <button class="contract-text-button danger" type="button" :disabled="busy" @click="removeSelectedFile(file)">移除</button></li></ul>
          </template>
          <p v-if="fileMessage" class="contract-import-alert" role="alert">{{ fileMessage }}</p>
          <!-- 长列表自带滚动容器：max-height 有界，短列表自然收起；动作区留在容器外的页脚里。 -->
          <div v-if="formRows.length" class="contract-import-listframe" tabindex="0" role="group" aria-label="合同导入行列表，可滚动">
            <ul class="contract-import-rows" aria-label="合同导入行">
              <li v-for="(row, index) in formRows" :key="row.key" class="contract-import-row">
                <div class="contract-import-row-head">
                  <div class="contract-import-row-id">
                    <strong>{{ row.fileName }}</strong>
                    <span>{{ rowStaged(row) ? '重新预检沿用当前批次已暂存原件' : (batch ? '新原件，预检时上传' : '尚未上传') }}</span>
                  </div>
                  <div class="contract-import-row-actions">
                    <span class="contract-badge" :class="rowStateTone(row)"><i></i>{{ stateLabels[row.state] || row.state }}</span>
                    <button class="contract-text-button" type="button" :disabled="!!row.contractId" :aria-label="`编辑第 ${index + 1} 行详情`" @click="openRow(row, $event)">编辑详情</button>
                    <button class="contract-text-button danger" type="button" :disabled="busy || !!row.contractId" :aria-label="`移除第 ${index + 1} 行`" @click="removeRow(row)">移除</button>
                  </div>
                </div>
                <dl class="contract-import-facts">
                  <div class="contract-import-fact-title"><dt>合同标题</dt><dd>{{ row.title || '未填写' }}</dd></div>
                  <div class="contract-import-fact-party">
                    <dt>客户</dt>
                    <dd>{{ row.customerName || '未填写' }}<small v-if="row.crmCustomerId" class="contract-import-fact-extra">ID {{ row.crmCustomerId }}</small><small v-if="row.normalized" class="contract-import-fact-extra">预检权威：{{ row.normalized.customer_name }} / {{ row.normalized.crm_customer_id }}</small><small v-if="normalizedCustomerDiff(row)" class="contract-import-fact-extra contract-import-error-text">与预检客户不一致，请以权威目录为准</small></dd>
                  </div>
<div v-if="isHistoricalEntry"><dt>当前负责人</dt><dd>{{ row.historyEvidence?.target_owner_name || (row.historyEvidence?.target_owner_user_id ? '已选账号' : '未填写') }}<small v-if="row.historyEvidence?.target_owner_name && row.historyEvidence?.target_owner_user_id">已匹配有效账号</small></dd></div>
                  <div><dt>金额（元）</dt><dd>{{ row.amount || '未填写' }}<small v-if="row.contractId" class="contract-import-fact-extra">合同 {{ row.contractId }}</small></dd></div>
                  <div><dt>币种</dt><dd>{{ row.currency }}</dd></div>
                  <div><dt>开始日期</dt><dd>{{ row.startDate || '—' }}</dd></div>
                  <div><dt>结束日期</dt><dd>{{ row.endDate || '—' }}</dd></div>
                </dl>
                <p class="contract-import-row-key" :class="hasExternalRecordId(row) ? '' : 'contract-import-error-text'">来源业务键：{{ row.externalRecordId || '未填写（请在「编辑详情」补填）' }}</p>
                <p v-if="rowIssues(row).length" class="contract-import-error-text">发现 {{ rowIssues(row).length }} 处问题</p>
                <ul v-if="rowIssues(row).length" class="contract-import-error-text" role="alert"><li v-for="(issue, issueIndex) in rowIssues(row)" :key="issueIndex">{{ issue.message }}</li></ul>
                <p v-else-if="row.batchIssues.length" class="contract-import-error-text" role="alert">{{ rowBatchIssueSummary(row)[0] }}{{ row.batchIssues.length > 1 ? `（共 ${row.batchIssues.length} 处）` : '' }}</p>
              </li>
            </ul>
          </div>
          <p v-else class="contract-import-empty">{{ normalEntryMode === 'excel' ? '尚未匹配到合同行。请选择 Excel，并确认 PDF 文件名去掉扩展名后与 Excel 合同编号完全一致；匹配成功后会写入下方详情。' : '尚未选择原件。选择后会自动生成合同行，不需要手工编写 JSON。' }}</p>
          <div class="contract-import-actions contract-import-actions--footer">
            <p class="contract-import-hint">暂存并预检不会创建合同。预检错误会按行和字段显示，可修正后重试；预检通过后再提交冻结清单。</p>
            <button class="contract-button primary" type="button" :disabled="busy || !canPreviewAction" @click="preview">{{ batch ? '继续暂存／修订并重新预检' : '暂存并逐项预检' }}</button>
          </div>
        </section>

        <section v-else-if="batch" class="contract-import-block contract-import-stage" aria-label="历史合同完整清单导入">
          <p class="contract-import-hint"><strong>历史导入需要完整清单。</strong>历史存档、接续履约和历史结清档案包含 history_evidence、policy_options 等字段，继续使用 JSON 清单核对；不使用普通表单，避免丢字段或改写历史事实。</p>
          <label class="contract-import-field" for="contract-import-json">UTF-8 JSON 清单（≤2MiB，1—100项）</label>
          <textarea id="contract-import-json" v-model="text" maxlength="2097152" rows="10" :disabled="busy" placeholder='{"schema_version":1,"source_system":"legacy","items":[{"item_key":"one","external_record_id":"原业务键","mode":"ARCHIVE_ONLY","source_file_ref":"原件.pdf","metadata":{},"history_evidence":{},"policy_options":{}}]}' />
          <p class="contract-import-hint">每项 metadata 填写完整合同字段；历史项还须提供 history_evidence 和 policy_options。source_file_ref 在此处填写对应文件名，须与所选原件一一匹配。</p>
          <p v-if="['ARCHIVE_ONLY', 'HISTORICAL_CLOSED'].includes(entryMode)" class="contract-import-hint">已启用历史自动建档时，待建客户可不填 crm_customer_id，同时留空商机编号及名称；请填写真实客户名称、销售姓名，以及新客户的联系人和电话。服务端预检会校验字段并展示客户／商机开立计划，无须先登录 CRM 手工创建客户。</p>
          <p v-if="batch" class="contract-import-hint">已暂存项保留当前 file_ref；需要更换原件时，将该行 source_file_ref 改为新选择的文件名。相同文件名的历史代次不会自动替换当前原件。</p>
          <label class="contract-import-field">选择对应原件<input :key="sourceSelectionVersion" type="file" multiple :accept="pdfEnabled ? '.docx,.pdf' : '.docx'" :disabled="busy" @change="selectFiles" /></label>
          <p v-if="files.length" class="contract-import-status" role="status">已选择：{{ files.map(file => file.name).join('、') }}</p>
          <p v-if="fileMessage" class="contract-import-alert" role="alert">{{ fileMessage }}</p>
          <ul v-if="files.length" class="contract-import-file-list"><li v-for="file in files" :key="file.name"><span>{{ file.name }}</span> <button class="contract-text-button danger" type="button" :disabled="busy" @click="removeSelectedFile(file)">移除</button></li></ul>
          <div class="contract-import-actions contract-import-actions--footer">
            <button class="contract-button primary" type="button" :disabled="busy || !canPreviewAction" @click="preview">{{ batch ? '继续暂存／修订并重新预检' : '暂存并逐项预检' }}</button>
          </div>
        </section>

        <details v-if="isFormEntry" class="contract-import-advanced" @toggle="onAdvancedToggle">
          <summary>高级：查看/编辑清单</summary>
          <div class="contract-import-advanced-body">
            <p class="contract-import-hint">默认以 Excel 和编辑详情为准，下方清单只用于核对或兼容旧批次。展开不会自动保存，也不会改写历史事实。</p>
            <label class="contract-import-check"><input v-model="jsonAuthoritative" type="checkbox" :disabled="busy" @change="toggleJsonAuthoritative" /> 以 JSON 清单为准（高级；勾选后表单修改不会进入预检）</label>
            <p v-if="jsonAuthoritative" class="contract-import-warning" role="alert">当前以 JSON 为准：预检直接保存下方 JSON。取消勾选会重新用表单生成清单，JSON 中的修改会被覆盖；需要历史字段请切换到历史导入方式。</p>
            <label class="contract-import-field" for="contract-import-advanced-json">清单 JSON（普通模式默认只读）</label>
            <textarea id="contract-import-advanced-json" v-model="text" maxlength="2097152" rows="10" :readonly="!jsonAuthoritative" :disabled="busy" />
            <div class="contract-import-actions"><button class="contract-button secondary small" type="button" :disabled="busy || jsonAuthoritative" @click="regenerateJSON">用当前表单重新生成 JSON</button><span v-if="advancedMessage" role="status">{{ advancedMessage }}</span></div>
          </div>
        </details>
      </template>

      <p v-if="error" class="contract-import-alert" role="alert">{{ error }}</p>

      <template v-if="batch">
        <section class="contract-import-block contract-import-batch" aria-label="批次导入结果">
          <header class="contract-import-block-head">
            <p class="contract-import-batch-id" role="status">批次 {{ batch.batch_id }} · 第 {{ batch.revision }} 版 · {{ labels[batch.state] || batch.state }}<span v-if="showAutoApproveBadge" class="contract-badge success contract-import-batch-approve-badge"><i></i>自动审批：已开启</span></p>
            <button class="contract-button secondary small" type="button" :disabled="busy || !importErrorReportRows.length" aria-label="下载合同批量导入错误报告 CSV" @click="downloadImportErrorReport">下载错误报告 CSV</button>
          </header>
          <p v-if="crmConnectionRequired" class="contract-import-alert contract-import-alert--warn" role="alert">CRM 当前账号授权上下文缺失或已过期，请先连接 CRM，再重新预检当前批次。 <button class="contract-text-button" type="button" :disabled="busy" @click="connectCRM()">连接 CRM</button> <span v-if="crmConnectionMessage" class="contract-import-hint" role="status">{{ crmConnectionMessage }}</span></p>
          <div class="contract-import-batch-meta">
            <p v-if="batch.items?.length">导入方式：{{ modeLabels[batch.items[0].item.mode] || batch.items[0].item.mode }}</p>
            <p v-if="batch.operation_id">操作号：{{ batch.operation_id }}。请保留批次号，重新登录或刷新页面后可查询恢复。</p>
          </div>
          <section v-if="provisionPlan.length" class="contract-import-provision" aria-label="将自动创建的 CRM 客户与商机">
            <p><strong>CRM 开立计划（共 {{ provisionPlan.length }} 项）：</strong>将自动创建客户 {{ provisionSummary.toCreate }} 项，客户已存在 {{ provisionSummary.existing }} 项<span v-if="provisionSummary.customerAmbiguous">，客户重名需人工确认 {{ provisionSummary.customerAmbiguous }} 项</span>；销售已解析 {{ provisionSummary.resolved }} 项，销售未命中 {{ provisionSummary.unresolved }} 项<span v-if="provisionSummary.salesAmbiguous">，销售重名需人工确认 {{ provisionSummary.salesAmbiguous }} 项</span>。以上为预览结果，实际开立仍按当前开关与逐项核对执行。</p>
            <ul class="contract-import-provision-list">
              <li v-for="(plan, index) in provisionPlan" :key="`provision-${index}-${provisionPlanTitle(plan, index)}`" class="contract-import-provision-item">
                <p class="contract-import-provision-title">{{ provisionPlanTitle(plan, index) }}</p>
                <dl class="contract-import-facts contract-import-facts--inline">
                  <dt>客户</dt><dd>{{ plan.customer_name || '未提供' }}<small class="contract-import-fact-extra">{{ provisionCustomerLabels[plan.customer_state] || plan.customer_state || '状态未返回' }}</small></dd>
                  <dt>销售</dt><dd>{{ plan.sales_name || '未提供' }}<small class="contract-import-fact-extra">{{ provisionSalesLabels[plan.sales_state] || plan.sales_state || '状态未返回' }}</small></dd>
                </dl>
                <p class="contract-import-provision-opportunity">{{ provisionOpportunityText(plan) }}</p>
              </li>
            </ul>
          </section>
          <!-- 批次逐项结果同样有界滚动；提交 / 暂停 / 恢复放在下方的常驻页脚里。 -->
          <div v-if="batch.items?.length" class="contract-import-listframe" tabindex="0" role="group" aria-label="批次逐项结果列表，可滚动">
            <ul class="contract-import-batch-items" aria-label="批次逐项结果">
              <li v-for="entry in batch.items" :key="entry.id" class="contract-import-batch-item">
                <div class="contract-import-batch-item-main">
                  <p class="contract-import-batch-item-title"><strong>{{ entry.item.item_key }}</strong><span>{{ modeLabels[entry.item.mode] }}</span></p>
                  <p class="contract-import-batch-item-state">{{ stateLabels[entry.state] || entry.state }}</p>
                  <p class="contract-import-batch-item-contract">{{ entry.contract_id || '尚未建单' }}</p>
                  <button v-if="entry.contract_id" class="contract-text-button" type="button" :disabled="busy" @click="viewSource(entry)">查看冻结原件</button>
                </div>
                <div class="contract-import-batch-item-side">
                  <dl class="contract-import-facts contract-import-facts--inline">
                    <dt>原件：</dt><dd>{{ batch.sources.find(source => source.file_ref === entry.item.source_file_ref)?.filename }}<small class="contract-import-fact-extra">{{ entry.item.source_file_ref }}</small></dd>
                    <dt>来源业务键：</dt><dd>{{ entry.item.external_record_id }}</dd>
                    <dt>纸面编号：</dt><dd>{{ entry.item.metadata.external_paper_number || '未提供' }}</dd>
                    <template v-if="entry.item.history_evidence">
                      <dt>声明签署日：</dt><dd>{{ entry.item.history_evidence.declared_signed_date || '未声明' }}</dd>
                      <dt>原终态／履约态：</dt><dd>{{ entry.item.history_evidence.historical_status }}</dd>
                    </template>
                    <template v-if="entry.normalized_metadata">
                      <dt>权威客户：</dt><dd>{{ entry.normalized_metadata.customer_name }}</dd>
                      <dt>客户ID：</dt><dd>{{ entry.normalized_metadata.crm_customer_id }}</dd>
                      <dt>规范金额：</dt><dd>{{ entry.normalized_metadata.currency }} {{ formatImportMinor(entry.normalized_metadata.amount_minor) }}</dd>
                    </template>
                    <template v-if="entry.item.metadata.customer_name !== entry.normalized_metadata?.customer_name">
                      <dt>清单客户声明：</dt><dd>{{ entry.item.metadata.customer_name }}</dd>
                    </template>
                  </dl>
                </div>
                <div class="contract-import-batch-item-issues">
                  <p class="contract-import-issues-title">字段及错误</p>
                  <ul v-if="entry.issues?.length" class="contract-import-issues">
                    <li v-for="issue in entry.issues" :key="issue.field_path + issue.code" class="contract-import-issue" :class="{ 'is-retryable': issue.retryable }" role="alert">{{ importFieldLabel(issue.field_path) }}：{{ issueLabels[issue.code] || issue.code }}{{ issue.retryable ? '（可恢复）' : '' }}</li>
                  </ul>
                  <p v-else class="contract-import-issues-empty">无</p>
                </div>
              </li>
            </ul>
          </div>
          <!-- 常驻页脚：在滚动容器之外，列表再长也不会把提交 / 暂停 / 恢复顶走。 -->
          <div class="contract-import-batch-foot">
            <p v-if="batch.state === 'PREVIEWED'" class="contract-import-note">{{ batchPreviewNote }}</p>
            <p v-if="!batch.can_commit" class="contract-import-note">当前身份可查看此批次；提交和恢复须由具有导入提交权限的批次创建人执行。</p>
            <div class="contract-import-actions">
              <button v-if="batch.state === 'PREVIEWED' && !historyItems.length && canCommit && batch.can_commit" class="contract-button primary" type="button" :disabled="busy" @click="commit">确认冻结清单并创建草稿</button>
              <button v-if="['RUNNING','QUEUED'].includes(batch.state) && canCommit && batch.can_commit" class="contract-button secondary" type="button" :disabled="busy" @click="control('pause')">暂停新认领</button>
              <button v-if="['PAUSED','PARTIAL'].includes(batch.state) && canCommit && batch.can_commit && !batch.items.some(entry => ['CORRECTION_REQUIRED','NEEDS_REVIEW'].includes(entry.state))" class="contract-button secondary" type="button" :disabled="busy" @click="control('resume')">重新授权并恢复原操作</button>
            </div>
          </div>
        </section>

        <section v-if="historyItems.length" class="contract-import-block contract-import-history" aria-label="历史导入确认及分目标接续">
          <h3>历史导入独立确认</h3>
          <p class="contract-import-hint">确认对象为本批次当前冻结的原件、字段、原业务事实及子系统政策。已创建记录不代表历史接续已经完成。</p>
          <div class="contract-import-actions">
            <button v-if="canCommit && batch.can_commit && batch.state === 'PREVIEWED' && !['STARTING','PENDING','APPROVED'].includes(batch.confirmation?.state)" class="contract-button primary" type="button" :disabled="busy" @click="confirmation()">冻结清单、建立历史记录并提交独立确认</button>
          </div>
          <template v-if="batch.confirmation">
            <p class="contract-import-hint">当前确认：{{ confirmationStateText }}；冻结修订 {{ batch.confirmation.revision }}。</p>
            <!-- AUTO 批次没有人工会签事实：不展示“要求角色/已确认”这类会被读成签署记录的占位。 -->
            <p v-if="!confirmationAutoApproved" class="contract-import-hint">要求角色：{{ batch.confirmation.roles.join('、') }}；已确认：{{ batch.confirmation.approved_roles?.join('、') || '无' }}。</p>
            <div class="contract-import-actions">
              <button v-if="canVote" class="contract-button secondary small" type="button" :disabled="busy" @click="confirmation('APPROVE')">确认本次历史导入基线</button>
              <button v-if="canVote" class="contract-button secondary small" type="button" :disabled="busy" @click="confirmation('REJECT')">驳回本次历史导入</button>
              <button v-if="canCommit && batch.can_commit && ['STARTING','PENDING'].includes(batch.confirmation.state)" class="contract-button secondary small" type="button" :disabled="busy" @click="confirmation('WITHDRAW')">撤回本次确认</button>
            </div>
          </template>
          <article v-for="entry in historyItems" :key="entry.id" class="contract-import-targets">
            <h4>{{ entry.item.item_key }} · {{ entry.confirmed ? '当前历史基线已确认' : '等待当前独立确认' }}</h4>
            <p v-if="entry.item.policy_options.finance_mode === 'NONE'" class="contract-import-note">本项不参与结算开票，合同金额及来源结清状态仅作为档案资料，不表示财务核验完成。</p>
            <p v-else class="contract-import-hint">旧批次原策略保留：项目 {{ entry.item.policy_options.project_mode }}；财务 {{ entry.item.policy_options.finance_mode }}；报表 {{ entry.item.policy_options.report_mode }}。</p>
            <p v-if="entry.item.policy_options.finance_mode === 'EVIDENCE_ONLY'" class="contract-import-note">仅保存原财务证明，未在结算重建财务台账，不能将此项解释为结算已核验零余额。</p>
            <ul class="contract-import-target-list">
              <li v-for="target in entry.targets" :key="target.target" class="contract-import-target">
                <p class="contract-import-target-head"><strong>{{ targetLabels[target.target] }}</strong>：{{ stateLabels[target.state] || target.state }}<span v-if="target.error_code && target.state !== 'COMPLETE'"> · {{ target.error_code }}</span><span v-if="target.receipt_id"> · 实际回执 {{ target.receipt_id }}</span></p>
                <p v-if="target.state === 'BLOCKED' && target.recipient_http_status === 409 && target.recipient_code === 'SETTLEMENT_CONFLICT'" class="contract-import-note">接收方已明确拒绝旧放行。财务须先重新对账；再次申请会严格核对新凭证、政策与责任，并保留旧命令记录。来源或政策不一致仍阻断。</p>
                <p v-if="canRetryProjectRejection(target)" class="contract-import-note">项目端明确拒绝参数或负责人。请核对项目负责人在目标环境的有效授权及冻结字段；恢复仅重试原命令，不修改已确认基线。</p>
                <div v-if="canRelease && entry.confirmed && !['COMPLETE','NOT_APPLICABLE'].includes(target.state) && (target.state !== 'BLOCKED' || canRetryProjectRejection(target) || (target.target === 'FINANCE' && target.phase === 'RELEASE' && target.recipient_http_status === 409 && target.recipient_code === 'SETTLEMENT_CONFLICT'))" class="contract-import-actions">
                  <button v-if="target.target === 'FINANCE' && !target.receipt_id" class="contract-button secondary small" type="button" :disabled="busy" @click="release(entry, target, 'PREPARE')">建立／恢复财务HOLD暂存</button>
                  <button v-else-if="canRetryProjectRejection(target)" class="contract-button secondary small" type="button" :disabled="busy" @click="release(entry, target)">核对项目参数和负责人后重试同一命令</button>
                  <button v-else class="contract-button secondary small" type="button" :disabled="busy" @click="release(entry, target)">{{ target.target === 'FINANCE' ? (target.state === 'BLOCKED' ? '重新核对并申请财务放行' : '核验对账和责任后申请财务放行') : target.target === 'REPORT' ? '申请／查询真实数析应用' : '申请／恢复项目绑定' }}</button>
                </div>
                <a v-if="target.target === 'FINANCE' && target.receipt_id" :href="`/settlement/imports?import_snapshot=${encodeURIComponent(target.receipt_id)}`">前往财务恢复工作台</a>
              </li>
            </ul>
          </article>
        </section>
      </template>

      <section v-if="document" class="contract-import-block contract-import-document" aria-label="冻结导入原件">
        <div class="contract-import-actions"><button class="contract-button secondary small" type="button" @click="closeSource">关闭原件</button></div>
        <ContractPDFPreview v-if="document.format === 'PDF'" :descriptor="document" title="当前导入基线的PDF原件" />
        <a v-else :href="importItemSourceURL(document.batchID, document.itemID)">下载冻结的 DOCX 原件</a>
      </section>
    </div>

    <div v-if="drawerRow" class="contract-modal-mask contract-import-drawer-mask" @click.self="closeDrawer">
      <article ref="drawerRef" class="contract-detail-modal contract-import-drawer" role="dialog" aria-modal="true" aria-labelledby="contract-import-drawer-title" tabindex="-1" @keydown="onDrawerKeydown">
        <header>
          <div>
            <span class="contract-badge info">{{ isHistoricalEntry ? '历史合同导入' : '已有普通批次修订' }}</span>
            <h2 id="contract-import-drawer-title">{{ drawerRow.fileName }}</h2>
            <p>填写完整合同字段；金额按元输入，提交前精确转换为分，不猜测原件中的金额、客户或分期。</p>
          </div>
          <button type="button" aria-label="关闭编辑详情" :disabled="busy" @click="closeDrawer">×</button>
        </header>
        <section>
          <p v-if="rowIssue(drawerRow, 'fileName')" class="contract-field-error contract-form-wide" role="alert">{{ rowIssue(drawerRow, 'fileName').message }}</p>
          <p v-if="rowIssues(drawerRow).length" class="contract-field-error contract-form-wide" role="alert">需要修正 {{ rowIssues(drawerRow).length }} 处：{{ rowIssues(drawerRow).map(issue => issue.message).join('；') }}</p>
          <p v-if="drawerRow.batchIssues.length" class="contract-field-error contract-form-wide" role="alert">预检返回 {{ drawerRow.batchIssues.length }} 处问题：{{ rowBatchIssueSummary(drawerRow).join('；') }}</p>
          <div class="contract-form-grid">
            <template v-if="isHistoricalEntry && drawerRow.historyEvidence">
              <label><span>当前负责人姓名（Excel）</span><input v-model="drawerRow.historyEvidence.target_owner_name" maxlength="128" @input="drawerRow.historyEvidence.target_owner_user_id = ''" /><small>预检按姓名唯一匹配有效账号，重名请明确选择账号。</small></label>
              <label><span>原签署日期</span><input v-model="drawerRow.historyEvidence.declared_signed_date" type="date" /></label>
              <label><span>原合同状态</span><select v-model="drawerRow.historyEvidence.historical_status"><option value="">请选择</option><option value="archived">已归档</option><template v-if="(drawerRow.importMode || entryMode) === 'HISTORICAL_CLOSED'"><option value="completed">已完成</option><option value="terminated">已终止</option></template></select></label>
              <label><span>原客户名称</span><input v-model="drawerRow.historyEvidence.historical_customer_name" maxlength="255" /></label>
              <label><span>原负责人姓名</span><input v-model="drawerRow.historyEvidence.historical_owner_label" maxlength="128" /></label>
              <label><span>当前负责人</span><select v-model="drawerRow.historyEvidence.target_owner_user_id" @change="drawerRow.historyEvidence.target_owner_name = ''"><option value="">请选择</option><option v-if="actorId" :value="actorId">当前登录人</option><option v-if="drawerRow.historyEvidence.target_owner_user_id && drawerRow.historyEvidence.target_owner_user_id !== actorId && !historyOwnerOptions.some(owner => owner.subject_id === drawerRow.historyEvidence.target_owner_user_id)" :value="drawerRow.historyEvidence.target_owner_user_id">已保存的负责人（服务端复核）</option><option v-for="owner in historyOwnerOptions" :key="owner.subject_id" :value="owner.subject_id">{{ owner.name }}</option></select></label>
              <template v-if="(drawerRow.importMode || entryMode) === 'HISTORICAL_CLOSED'">
                <label><span>报表统计方式</span><select v-model="drawerRow.policyOptions.report_mode"><option value="">请选择</option><option value="ARCHIVE_SEPARATE">档案单独统计</option><option value="HISTORICAL_SEPARATE">历史单独统计</option></select></label>
              </template>
            </template>
            <label class="contract-form-wide"><span>合同标题</span><input id="contract-import-row-title" v-model="drawerRow.title" maxlength="255" required autocomplete="off" :aria-invalid="rowIssue(drawerRow, 'title') ? 'true' : undefined" /><small v-if="rowIssue(drawerRow, 'title')" class="contract-field-error" role="alert">{{ rowIssue(drawerRow, 'title').message }}</small></label>
            <label class="contract-form-wide"><span>来源业务键：原系统合同编号/业务键（必填，用于重复导入识别）</span><input id="contract-import-row-external-record-id" v-model="drawerRow.externalRecordId" maxlength="128" pattern="[A-Za-z0-9_.:\-]+" required autocomplete="off" @input="clearExternalRecordIdIssue(drawerRow, $event)" :aria-invalid="(!hasExternalRecordId(drawerRow) || rowIssue(drawerRow, 'externalRecordId')) ? 'true' : undefined" /><small>填写来源系统中的原合同编号或业务键；只能使用字母/数字/._:-，同一批次内不能重复，重复导入据此识别同一份合同。</small><small v-if="rowIssue(drawerRow, 'externalRecordId')" class="contract-field-error" role="alert">{{ rowIssue(drawerRow, 'externalRecordId').message }}</small></label>
            <label><span>合同类型</span><select id="contract-import-row-type" v-model="drawerRow.contractType" required :aria-invalid="rowIssue(drawerRow, 'contractType') ? 'true' : undefined"><option value="" disabled>请选择合同类型</option><option v-for="type in externalContractTypes" :key="type" :value="type">{{ type }}</option></select><small v-if="rowIssue(drawerRow, 'contractType')" class="contract-field-error" role="alert">{{ rowIssue(drawerRow, 'contractType').message }}</small></label>
            <label><span>金额（元）*</span><input id="contract-import-row-amount" v-model="drawerRow.amount" type="text" inputmode="decimal" maxlength="20" pattern="[0-9]+([.][0-9]{1,2})?" placeholder="0.00" required :aria-invalid="rowIssue(drawerRow, 'amount') ? 'true' : undefined" /><small>{{ amountMinorHint(drawerRow) }}</small><small v-if="rowIssue(drawerRow, 'amount')" class="contract-field-error" role="alert">{{ rowIssue(drawerRow, 'amount').message }}</small></label>
            <label><span>币种</span><input id="contract-import-row-currency" v-model="drawerRow.currency" maxlength="3" pattern="[A-Za-z]{3}" autocomplete="off" required :aria-invalid="rowIssue(drawerRow, 'currency') ? 'true' : undefined" /><small v-if="rowIssue(drawerRow, 'currency')" class="contract-field-error" role="alert">{{ rowIssue(drawerRow, 'currency').message }}</small></label>
            <label><span>开始日期（选填）</span><input v-model="drawerRow.startDate" type="date" min="0001-01-01" max="9999-12-31" :aria-invalid="rowIssue(drawerRow, 'startDate') ? 'true' : undefined" /><small v-if="rowIssue(drawerRow, 'startDate')" class="contract-field-error" role="alert">{{ rowIssue(drawerRow, 'startDate').message }}</small></label>
            <label><span>结束日期（选填）</span><input v-model="drawerRow.endDate" type="date" :min="drawerRow.startDate || '0001-01-01'" max="9999-12-31" :aria-invalid="rowIssue(drawerRow, 'endDate') ? 'true' : undefined" /><small v-if="rowIssue(drawerRow, 'endDate')" class="contract-field-error" role="alert">{{ rowIssue(drawerRow, 'endDate').message }}</small></label>
            <label><span>外部纸面编号（选填）</span><input v-model="drawerRow.externalPaperNumber" maxlength="128" /><small v-if="rowIssue(drawerRow, 'externalPaperNumber')" class="contract-field-error" role="alert">{{ rowIssue(drawerRow, 'externalPaperNumber').message }}</small></label>
            <LocalContractSourcePicker class="contract-form-wide" :model-value="drawerSourceForm" :capabilities="drawerSourceCapabilities" :disabled="busy" @update:model-value="updateDrawerSource" />
            <p v-if="drawerSourceError" class="contract-field-error contract-form-wide" role="alert">{{ drawerSourceError }}</p>
            <label v-if="!drawerLocalCounterparty"><span>CRM 客户编号</span><input id="contract-import-row-customer-id" v-model="drawerRow.crmCustomerId" inputmode="numeric" maxlength="20" required :aria-invalid="rowIssue(drawerRow, 'crmCustomerId') ? 'true' : undefined" /><small v-if="rowIssue(drawerRow, 'crmCustomerId')" class="contract-field-error" role="alert">{{ rowIssue(drawerRow, 'crmCustomerId').message }}</small></label>
            <label><span>客户名称</span><input id="contract-import-row-customer-name" v-model="drawerRow.customerName" :readonly="drawerLocalCounterparty" maxlength="255" required :aria-invalid="rowIssue(drawerRow, 'customerName') ? 'true' : undefined" /><small v-if="rowIssue(drawerRow, 'customerName')" class="contract-field-error" role="alert">{{ rowIssue(drawerRow, 'customerName').message }}</small></label>
            <label><span>客户联系人（选填）</span><input v-model="drawerRow.customerContact" maxlength="128" /></label>
            <label><span>客户联系电话（选填）</span><input v-model="drawerRow.customerPhone" type="tel" inputmode="tel" maxlength="64" /></label>
            <label class="contract-form-wide"><span>客户地址（选填）</span><input v-model="drawerRow.customerAddress" maxlength="500" /></label>
            <p v-if="drawerRow.normalized" class="contract-form-wide contract-import-hint">预检权威客户：{{ drawerRow.normalized.customer_name }}（{{ drawerRow.normalized.counterparty_source === 'LOCAL' ? '本地引用' : 'CRM ID' }} {{ drawerRow.normalized.local_counterparty_id || drawerRow.normalized.crm_customer_id }}）<span v-if="normalizedCustomerDiff(drawerRow)"> · 与当前填写不一致，请以权威目录为准</span></p>
            <div v-if="!drawerLocalCounterparty" class="contract-form-wide contract-import-customer-picker">
              <button class="contract-button secondary small" type="button" :disabled="busy || customerLoading" @click="loadCustomers(drawerRow)">{{ customerLoading ? '正在读取客户…' : '从 CRM 选择客户' }}</button>
              <span>仅读取当前账号 CRM 权限范围内的有效客户；客户名称与编号以 CRM 目录为准。</span>
              <p v-if="customerCrmRequired" role="alert">CRM 登录状态未建立或已失效。{{ crmConnectionMessage || '请连接 CRM 后重试。' }} <button class="contract-text-button" type="button" :disabled="busy" @click="connectCRM(true)">连接 CRM</button></p>
              <p v-else-if="customerError" role="alert">{{ customerError }}</p>
              <ul v-if="customerOptions.length"><li v-for="item in customerOptions" :key="item.id || item.customer_id"><button class="contract-text-button" type="button" @click="selectCustomer(drawerRow, item)"><strong>{{ item.name || item.customer_name }}</strong><span>{{ item.customer_no || item.id || item.customer_id }}</span></button></li></ul>
            </div>
            <label v-if="!drawerLocalCounterparty"><span>商机编号（选填）</span><input v-model="drawerRow.opportunityId" maxlength="128" /><small v-if="rowIssue(drawerRow, 'opportunityId')" class="contract-field-error" role="alert">{{ rowIssue(drawerRow, 'opportunityId').message }}</small></label>
            <label v-if="!drawerLocalCounterparty"><span>商机名称（选填）</span><input v-model="drawerRow.opportunityName" maxlength="255" /><small>商机编号和名称须同时填写，或都留空。</small></label>
            <label><span>客户信用等级（选填）</span><input v-model="drawerRow.customerCreditLevel" maxlength="64" /></label>

            <div class="contract-form-wide contract-service-items">
              <div class="contract-section-title"><div><h3>服务项</h3><p>至少 1 条，最多 20 条；场所、批次、检测类别和检测方式用于合同生效后的项目拆解。</p></div><button class="contract-text-button" type="button" :disabled="busy || drawerRow.serviceItems.length >= 20" @click="addServiceItem(drawerRow)">＋ 增加服务项</button></div>
              <p v-if="detectionCategoryLoading" class="contract-service-directory-state" role="status">正在读取项目管理检测类别…</p>
              <p v-else-if="detectionCategoryError" class="contract-service-directory-state contract-field-error" role="alert">{{ detectionCategoryError }} <button class="contract-text-button" type="button" @click="ensureDetectionCategories(true)">重新加载</button></p>
              <p v-if="rowIssue(drawerRow, 'serviceItems')" class="contract-field-error" role="alert">{{ rowIssue(drawerRow, 'serviceItems').message }}</p>
              <article v-for="(service, serviceIndex) in drawerRow.serviceItems" :key="serviceIndex" class="contract-service-item">
                <header><strong>服务项 {{ serviceIndex + 1 }}</strong><button type="button" :disabled="busy || drawerRow.serviceItems.length <= 1" :aria-label="`删除服务项 ${serviceIndex + 1}`" @click="removeServiceItem(drawerRow, serviceIndex)">×</button></header>
                <div class="contract-form-grid">
                  <label><span>服务类型</span><select v-model="service.serviceType" required :aria-invalid="rowIssue(drawerRow, `serviceItems.${serviceIndex}.serviceType`) ? 'true' : undefined"><option value="" disabled>请选择服务类型</option><option v-if="service.serviceType && !serviceTypeOptions.includes(service.serviceType)" :value="service.serviceType">{{ service.serviceType }}（原清单值）</option><option v-for="option in serviceTypeOptions" :key="option" :value="option">{{ option }}</option></select><small v-if="rowIssue(drawerRow, `serviceItems.${serviceIndex}.serviceType`)" class="contract-field-error" role="alert">{{ rowIssue(drawerRow, `serviceItems.${serviceIndex}.serviceType`).message }}</small></label>
                  <label><span>服务名称（选填）</span><input v-model="service.name" maxlength="255" placeholder="默认使用服务类型" /></label>
                  <label><span>实施场所</span><input v-model="service.site" maxlength="255" required placeholder="例如：上海总部" /><small v-if="rowIssue(drawerRow, `serviceItems.${serviceIndex}.site`)" class="contract-field-error" role="alert">{{ rowIssue(drawerRow, `serviceItems.${serviceIndex}.site`).message }}</small></label>
                  <label><span>实施批次</span><input v-model="service.batch" maxlength="120" required placeholder="例如：第一批次" /><small v-if="rowIssue(drawerRow, `serviceItems.${serviceIndex}.batch`)" class="contract-field-error" role="alert">{{ rowIssue(drawerRow, `serviceItems.${serviceIndex}.batch`).message }}</small></label>
                  <label><span>检测类别</span><select v-if="!drawerLocalCategories" v-model="service.category" required :disabled="detectionCategoryLoading || !detectionCategoryOptions.length" :aria-invalid="rowIssue(drawerRow, `serviceItems.${serviceIndex}.category`) ? 'true' : undefined"><option value="" disabled>{{ detectionCategoryLoading ? '正在加载检测类别' : (detectionCategoryError ? '目录加载失败，请先重新加载' : '请选择检测类别') }}</option><option v-if="service.category && !detectionCategoryOptions.some(option => option.category === service.category)" :value="service.category">{{ service.category }}（原清单值）</option><option v-for="option in detectionCategoryOptions" :key="option.category" :value="option.category">{{ option.category }}</option></select><input v-else :value="service.category" readonly placeholder="请在本地目录选择器中选择类别" /><small v-if="rowIssue(drawerRow, `serviceItems.${serviceIndex}.category`)" class="contract-field-error" role="alert">{{ rowIssue(drawerRow, `serviceItems.${serviceIndex}.category`).message }}</small></label>
                  <label><span>检测方式</span><select v-model="service.testMode" required><option value="STANDARD">常规检测</option><option value="PENETRATION">渗透测试</option></select><small v-if="rowIssue(drawerRow, `serviceItems.${serviceIndex}.testMode`)" class="contract-field-error" role="alert">{{ rowIssue(drawerRow, `serviceItems.${serviceIndex}.testMode`).message }}</small></label>
                  <label class="contract-form-wide"><span>体系 / 能力要求（选填）</span><input v-model="service.requirement" maxlength="1000" placeholder="例如：等保三级" /></label>
                </div>
                <section class="contract-system-information">
                  <div class="contract-section-title"><div><h3>系统信息（选填）</h3><p>每个系统将形成可独立实施的服务来源，最多 15 个。</p></div><button class="contract-text-button" type="button" :disabled="busy || service.systems.length >= 15" @click="addSystem(service)">＋ 增加系统信息</button></div>
                  <p v-if="!service.systems.length" class="contract-service-empty">尚未增加系统信息</p>
                  <div v-for="(system, systemIndex) in service.systems" :key="systemIndex" class="contract-system-row">
                    <label><span>系统名称</span><input v-model="system.name" maxlength="255" required placeholder="请输入系统名称" /><small v-if="rowIssue(drawerRow, `serviceItems.${serviceIndex}.systems.${systemIndex}.name`)" class="contract-field-error" role="alert">{{ rowIssue(drawerRow, `serviceItems.${serviceIndex}.systems.${systemIndex}.name`).message }}</small></label>
                    <label><span>系统等级</span><select v-model="system.level" required><option value="">请选择系统等级</option><option v-for="level in contractSystemLevels" :key="level" :value="level">{{ level }}</option></select><small v-if="rowIssue(drawerRow, `serviceItems.${serviceIndex}.systems.${systemIndex}.level`)" class="contract-field-error" role="alert">{{ rowIssue(drawerRow, `serviceItems.${serviceIndex}.systems.${systemIndex}.level`).message }}</small></label>
                    <button type="button" :disabled="busy" aria-label="删除系统信息" @click="removeSystem(service, systemIndex)">×</button>
                  </div>
                </section>
              </article>
            </div>

            <div class="contract-form-wide contract-payment-plan">
              <div class="contract-section-title"><div><h3>付款条款（选填）</h3><p>分期使用合同币种，合计须等于合同金额；不维护则保持为空，不会自动补造分期。</p></div><button class="contract-text-button" type="button" :disabled="busy || drawerRow.paymentTerms.length >= 100" @click="addPaymentTerm(drawerRow)">＋ 增加分期</button></div>
              <p v-if="!drawerRow.paymentTerms.length">尚未维护付款条款。</p>
              <div v-for="(term, termIndex) in drawerRow.paymentTerms" :key="termIndex" class="contract-payment-term-row">
                <label><span>分期号</span><input v-model.number="term.installment_no" type="number" min="1" max="100" step="1" required /></label>
                <label><span>到期日</span><input v-model="term.due_date" type="date" min="1000-01-01" max="9999-12-31" required /></label>
                <label><span>金额（{{ drawerRow.currency }}）</span><input v-model="term.amount" type="text" inputmode="decimal" maxlength="20" required placeholder="0.00" /></label>
                <button class="contract-text-button danger" type="button" :disabled="busy" :aria-label="`删除第 ${term.installment_no} 期`" @click="removePaymentTerm(drawerRow, termIndex)">删除</button>
              </div>
              <p v-if="rowIssue(drawerRow, 'paymentTerms')" class="contract-field-error" role="alert">{{ rowIssue(drawerRow, 'paymentTerms').message }}</p>
            </div>

            <label class="contract-form-wide"><span>合同正文（选填，纯文本说明）</span><textarea v-model="drawerRow.content" maxlength="20000" rows="3" placeholder="可留空；外部原件正文以所选 PDF/DOCX 为准，不从文本猜测合同条款。" /></label>
          </div>
        </section>
        <footer><button class="contract-button secondary" type="button" :disabled="busy" @click="closeDrawer">关闭导入结果</button></footer>
      </article>
    </div>
  </details>
</template>

<style scoped>
/* 深色主题：结构性表面 / 墨色 / 描边一律写成 var(--token, 原字面量)。
   token 在浅色下的取值与回退一致（--surface-tint 一类只在深色定义的除外），
   浅色渲染不变；深色下取 main.css 的值。 */

/* ── 面板骨架 ─────────────────────────────────────────────────────────── */
/* P2-5 导入页常驻状态条：与面板同宽同语言，信息按优先级从左到右，
   窄屏自动换行，不挤压右侧说明。 */
.contract-import-statusbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 12px;
  margin-block: 16px 0;
  padding: 10px 14px;
  color: var(--text);
  font-size: var(--fs-xs);
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--surface-muted);
}

.contract-import-statusbar-label { font-weight: 600; }
.contract-import-statusbar-meta { color: var(--text-muted); }
.contract-import-statusbar-hint { color: var(--text-muted); }

/* 批次头徽标与批次号同一行，空间不足时随 flex 换行。 */
.contract-import-batch-approve-badge { margin-inline-start: 8px; vertical-align: middle; }

.contract-import-panel {
  margin-block: 16px;
  color: var(--text, #0f172a);
  font-size: 13px;
  border: 1px solid var(--border, #e2e8f0);
  border-radius: 14px;
  background: var(--surface-card, #fff);
  box-shadow: var(--shadow-card);
}

.contract-import-panel > summary {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 15px 18px;
  color: var(--text, #0f172a);
  font-size: 14px;
  font-weight: 600;
  line-height: 1.4;
  cursor: pointer;
  border-radius: 14px;
  list-style: none;
  transition: background var(--duration-fast) ease;
}

.contract-import-panel > summary::-webkit-details-marker { display: none; }
.contract-import-panel > summary::marker { content: ''; }
.contract-import-panel > summary:hover { background: var(--surface-muted, #f8fafc); }

/* 折叠指示：静态用 CSS 三角形，展开时旋转 90°，不额外引入图标组件。 */
.contract-import-panel > summary::before {
  width: 0;
  height: 0;
  flex: 0 0 auto;
  content: '';
  border-block: 4.5px solid transparent;
  border-inline-start: 6px solid var(--text-muted, #64748b);
  transition: transform var(--duration-fast) ease;
}

/* 折叠标题是面板的第一个键盘落点，焦点环沿用全局配色（深色下更亮）。 */
.contract-import-panel > summary:focus-visible,
.contract-import-advanced > summary:focus-visible {
  outline: 2px solid var(--focus-ring, #2563eb);
  outline-offset: 2px;
  border-radius: 8px;
}

.contract-import-panel[open] > summary::before { transform: rotate(90deg); }
.contract-import-panel[open] > summary { border-end-end-radius: 0; border-end-start-radius: 0; }

/* ── 纵向节奏：所有区块共用一套间距 ──────────────────────────────────── */
.contract-import-body {
  display: grid;
  gap: 16px;
  padding: 0 18px 18px;
}

.contract-import-body p { margin: 0; overflow-wrap: anywhere; }
:where(.contract-import-body label) { display: block; margin: 0; }
.contract-import-body input { max-width: 100%; }

.contract-import-intro {
  display: grid;
  gap: 6px;
  padding: 12px 14px;
  border-radius: 10px;
  background: var(--surface-muted, #f8fafc);
}

.contract-import-lede { color: var(--text-secondary, #475569); font-size: 12.5px; line-height: 1.7; }
.contract-import-note { color: var(--text-muted, #64748b); font-size: 12px; line-height: 1.7; }
.contract-import-hint { color: var(--text-secondary, #475569); font-size: 12px; line-height: 1.7; }

/* 主线：选方式 → 选原件 → 预检 → 核问题 → 提交。只表达流程，不表达进度。 */
.contract-import-steps {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 0;
  margin: 0;
  padding: 0;
  color: var(--text-muted, #64748b);
  font-size: 12px;
  list-style: none;
  counter-reset: contract-import-step;
}

.contract-import-steps li {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding-inline-end: 14px;
  counter-increment: contract-import-step;
}

.contract-import-steps li::before {
  display: grid;
  width: 18px;
  height: 18px;
  flex: 0 0 auto;
  place-items: center;
  content: counter(contract-import-step);
  color: var(--primary-ink, #1d4ed8);
  font-size: 11px;
  font-weight: 600;
  border-radius: var(--r-full, 999px);
  background: var(--primary-soft, #eff6ff);
}

.contract-import-steps li:not(:last-child)::after {
  width: 12px;
  height: 1px;
  margin-inline-start: 7px;
  content: '';
  background: var(--border, #e2e8f0);
}

/* ── 区块容器与区头 ──────────────────────────────────────────────────── */
.contract-import-block {
  display: grid;
  gap: 12px;
  padding: 16px;
  border: 1px solid var(--border, #e2e8f0);
  border-radius: 12px;
}

.contract-import-block-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px 14px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--line-soft, #edf0f5);
}

.contract-import-batch-id { color: var(--text, #0f172a); font-size: 13px; font-weight: 600; line-height: 1.5; }
.contract-import-batch-meta { display: flex; flex-wrap: wrap; gap: 4px 16px; color: var(--text-muted, #64748b); font-size: 12px; }
.contract-import-batch-meta p { color: inherit; font-size: inherit; line-height: 1.6; }

/* ── 批次工具条 ──────────────────────────────────────────────────────── */
.contract-import-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 10px;
}

.contract-import-toolbar .contract-import-field { flex: 1 1 220px; min-width: 0; }

.contract-import-field {
  display: grid;
  gap: 5px;
  align-items: start;
  margin: 0;
  color: var(--text-secondary, #475569);
  font-size: 12px;
  font-weight: 600;
}

.contract-import-field input:not([type='checkbox']):not([type='file']) {
  width: 100%;
  min-width: 0;
  min-height: 34px;
  padding: 0 10px;
  color: var(--text, #0f172a);
  font-size: 12.5px;
  font-weight: 400;
  border: 1px solid var(--border, #e2e8f0);
  border-radius: 8px;
  background: var(--surface-input, #fff);
  transition: border-color var(--duration-fast) ease;
}

.contract-import-field input:not([type='checkbox']):not([type='file']):focus { border-color: var(--border-brand-strong, #93c5fd); }

/* 批次列表 / 分页：把「选中的批次」与「翻页」分成两组，用间距而不是边框区分。 */
.contract-import-task-list { display: flex; flex-wrap: wrap; gap: 8px; }
.contract-import-pager { padding-top: 10px; border-top: 1px dashed var(--border, #e2e8f0); }

/* 面板内没有专门样式的按钮（批次项、分页、目标放行等）统一成同一尺寸。 */
.contract-import-body button:not(.contract-button):not(.contract-text-button) {
  padding: 6px 12px;
  color: var(--text-secondary, #475569);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  border: 1px solid var(--border, #e2e8f0);
  border-radius: 8px;
  background: var(--surface-raised, #fff);
  transition: color var(--duration-fast) ease, border-color var(--duration-fast) ease, background var(--duration-fast) ease;
}

.contract-import-body button:not(.contract-button):not(.contract-text-button):hover {
  color: var(--primary-dark, #1d4ed8);
  border-color: var(--border-brand-strong, #93c5fd);
  background: var(--primary-soft, #eff6ff);
}

.contract-import-body button:disabled { cursor: not-allowed; opacity: .55; }

/* ── 导入方式 / 填写方式：单选药丸 ──────────────────────────────────── */
.contract-import-mode,
.contract-import-normal-modes {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 0;
  padding: 12px 14px 14px;
  border: 1px solid var(--border, #e2e8f0);
  border-radius: 10px;
  background: var(--surface-muted, #f8fafc);
}

.contract-import-mode legend,
.contract-import-normal-modes legend {
  padding-inline: 6px;
  color: var(--text, #0f172a);
  font-size: 12.5px;
  font-weight: 600;
}

.contract-import-mode label,
.contract-import-normal-modes label {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  margin: 0;
  padding: 7px 12px;
  color: var(--text-secondary, #475569);
  font-size: 12.5px;
  font-weight: 500;
  line-height: 1.4;
  cursor: pointer;
  border: 1px solid var(--border, #e2e8f0);
  border-radius: var(--r-full, 999px);
  background: var(--surface-raised, #fff);
  transition: color var(--duration-fast) ease, border-color var(--duration-fast) ease, background var(--duration-fast) ease;
}

.contract-import-mode label:hover,
.contract-import-normal-modes label:hover { border-color: var(--border-brand-strong, #93c5fd); }

.contract-import-mode label:has(input:checked),
.contract-import-normal-modes label:has(input:checked) {
  color: var(--primary-dark, #1d4ed8);
  border-color: var(--primary-border, #bfdbfe);
  background: var(--primary-soft, #eff6ff);
}

.contract-import-mode label:has(input:focus-visible),
.contract-import-normal-modes label:has(input:focus-visible) {
  outline: 2px solid var(--primary, #2563eb);
  outline-offset: 2px;
}

.contract-import-mode input,
.contract-import-normal-modes input { margin: 0; }

.contract-import-mode:disabled label,
.contract-import-normal-modes:disabled label { cursor: not-allowed; opacity: .6; }

/* ── 步骤区（拖放 + 状态） ──────────────────────────────────────────── */
.contract-import-stage { gap: 14px; }
.contract-import-step { display: grid; gap: 10px; }

.contract-import-dropzone {
  display: grid;
  gap: 10px;
  margin: 0;
  padding: 15px 16px;
  border: 1px dashed var(--border-brand-strong, #93c5fd);
  border-radius: 10px;
  background: var(--surface-tint, #f8fbff);
  transition: border-color var(--duration-fast) ease;
}

.contract-import-dropzone:focus-within { border-color: var(--primary, #2563eb); }
.contract-import-dropzone label { margin: 0; color: var(--text, #0f172a); font-size: 12.5px; font-weight: 600; line-height: 1.5; }

.contract-import-dropzone input[type='file'] {
  width: 100%;
  max-width: 100%;
  padding: 0;
  color: var(--text-muted, #64748b);
  font-size: 12px;
  cursor: pointer;
  border: 0;
  background: transparent;
}

.contract-import-dropzone input[type='file']::file-selector-button {
  margin-inline-end: 10px;
  padding: 7px 12px;
  color: var(--text-secondary, #475569);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  border: 1px solid var(--border, #e2e8f0);
  border-radius: 8px;
  background: var(--surface-raised, #fff);
  transition: color var(--duration-fast) ease, border-color var(--duration-fast) ease;
}

.contract-import-dropzone input[type='file']::file-selector-button:hover {
  color: var(--primary-dark, #1d4ed8);
  border-color: var(--border-brand-strong, #93c5fd);
}

.contract-import-file-list { display: flex; flex-wrap: wrap; gap: 6px; margin: 0; padding: 0; list-style: none; }

.contract-import-file-list li {
  display: inline-flex;
  max-width: 100%;
  flex-wrap: wrap;
  align-items: center;
  gap: 2px 6px;
  padding: 4px 4px 4px 11px;
  color: var(--text-secondary, #475569);
  font-size: 12px;
  overflow-wrap: anywhere;
  border: 1px solid var(--border, #e2e8f0);
  border-radius: var(--r-full, 999px);
  background: var(--surface-muted, #f8fafc);
}

/* ── 行卡片：主信息在头部与字段网格，次要信息降为小字 ────────────────── */
.contract-import-rows { display: grid; gap: 10px; margin: 0; padding: 0; list-style: none; }

.contract-import-row {
  display: grid;
  gap: 10px;
  padding: 12px 14px;
  border: 1px solid var(--border, #e2e8f0);
  border-radius: 10px;
  background: var(--surface-card, #fff);
}

.contract-import-row-head {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px 12px;
}

.contract-import-row-id { display: grid; min-width: 0; gap: 2px; }
.contract-import-row-id strong { color: var(--text, #0f172a); font-size: 13px; font-weight: 600; overflow-wrap: anywhere; }
.contract-import-row-id span { color: var(--text-muted, #64748b); font-size: 11.5px; line-height: 1.5; }
.contract-import-row-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 4px; }
.contract-import-row-key { color: var(--text-secondary, #475569); font-size: 12px; line-height: 1.6; }

/* 事实清单：窄屏一列、宽屏自动多列，标签在上、值在下，不靠 <br> 折行。 */
.contract-import-facts {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 10px 18px;
  margin: 0;
}

.contract-import-facts > div { display: grid; min-width: 0; gap: 2px; }
.contract-import-facts dt { color: var(--text-muted, #64748b); font-size: 11.5px; font-weight: 500; line-height: 1.5; }
.contract-import-facts dd { min-width: 0; margin: 0; color: var(--text, #0f172a); font-size: 12.5px; line-height: 1.55; overflow-wrap: anywhere; }

.contract-import-facts--inline {
  grid-template-columns: max-content minmax(0, 1fr);
  align-items: baseline;
  gap: 5px 10px;
}

.contract-import-facts--inline dt { color: var(--text-muted, #64748b); font-size: 12px; font-weight: 500; }
.contract-import-facts--inline dd { color: var(--text-secondary, #475569); font-size: 12px; }
.contract-import-fact-extra { display: block; margin-top: 2px; color: var(--text-muted, #64748b); font-size: 11.5px; font-weight: 400; line-height: 1.5; }

.contract-import-empty {
  padding: 20px 16px;
  color: var(--text-muted, #64748b);
  font-size: 12.5px;
  line-height: 1.7;
  text-align: center;
  border: 1px dashed var(--border, #e2e8f0);
  border-radius: 10px;
  background: var(--surface-muted, #f8fafc);
}

/* ── 长列表：容器自带滚动，动作区留在容器外的常驻页脚 ────────────────── */
/* 滚动发生在容器内部，所以页面流里不再有「很长的列表把按钮顶到很远」这件事，
   也不需要视图层 sticky（那会盖住下面的区块、并在流程里留下空白）。
   用 max-height 而不是 height：只有长列表被截住，短列表自然收起、不留空档。
   可滚提示走两条不会看错的信号：
     1) 明确的「窗口」边界——描边、圆角、淡底托盘；
     2) 上下两条 sticky 渐变遮罩：用 position: sticky 贴在滚动视口的内沿，
        高度靠负外边距抵掉，所以不占布局；内容在切口处渐隐，
        原本被硬切一半的卡片因此读起来是「后面还有」。
   遮罩用托盘色而不是深色阴影：浅色下是白雾、深色下是深雾，两端都不出现脏边。
   容器 tabindex="0"，键盘可以把焦点放进来直接上下翻，焦点环沿用面板约定。 */
.contract-import-listframe {
  max-height: min(60vh, 520px);
  padding: 10px;
  overflow-y: auto;
  border: 1px solid var(--border, #e2e8f0);
  border-radius: 12px;
  background: var(--surface-muted, #f8fafc);
  scrollbar-width: thin;
  scrollbar-color: var(--scrollbar-thumb, #cbd5e1) transparent;
}

.contract-import-listframe::before,
.contract-import-listframe::after {
  position: sticky;
  z-index: 1;
  display: block;
  height: 24px;
  pointer-events: none;
  content: '';
}

.contract-import-listframe::before {
  top: 0;
  margin-bottom: -24px;
  background: linear-gradient(to bottom, var(--surface-muted, #f8fafc) 40%, transparent);
}

.contract-import-listframe::after {
  bottom: 0;
  margin-top: -24px;
  background: linear-gradient(to top, var(--surface-muted, #f8fafc) 40%, transparent);
}

.contract-import-listframe:focus-visible {
  border-color: var(--border-brand-strong, #93c5fd);
  outline: 2px solid var(--focus-ring, #2563eb);
  outline-offset: 2px;
  border-radius: 12px;
}

.contract-import-listframe::-webkit-scrollbar { width: 8px; }
.contract-import-listframe::-webkit-scrollbar-track { background: transparent; }

.contract-import-listframe::-webkit-scrollbar-thumb {
  border: 2px solid transparent;
  border-radius: 999px;
  background: var(--scrollbar-thumb, #cbd5e1);
  background-clip: padding-box;
}

.contract-import-listframe::-webkit-scrollbar-thumb:hover {
  background: var(--scrollbar-thumb-hover, #94a3b8);
  background-clip: padding-box;
}

/* ── 批次逐项：主信息 / 次要信息两栏，问题整行铺开 ──────────────────── */
.contract-import-batch-items { display: grid; gap: 10px; margin: 0; padding: 0; list-style: none; }

.contract-import-batch-item {
  display: grid;
  gap: 10px 20px;
  padding: 12px 14px;
  border: 1px solid var(--border, #e2e8f0);
  border-radius: 10px;
  background: var(--surface-card, #fff);
}

.contract-import-batch-item-main { display: grid; min-width: 0; gap: 4px; align-content: start; }
.contract-import-batch-item-title { display: flex; flex-wrap: wrap; align-items: baseline; gap: 8px; color: var(--text, #0f172a); font-size: 13px; }
.contract-import-batch-item-title strong { font-weight: 600; overflow-wrap: anywhere; }
.contract-import-batch-item-title span { color: var(--text-muted, #64748b); font-size: 11.5px; }
.contract-import-batch-item-state { color: var(--text-secondary, #475569); font-size: 12px; font-weight: 600; line-height: 1.5; }
.contract-import-batch-item-contract { color: var(--text-muted, #64748b); font-size: 11.5px; line-height: 1.5; overflow-wrap: anywhere; }
.contract-import-batch-item-main .contract-text-button { justify-self: start; }
.contract-import-batch-item-side { min-width: 0; }
.contract-import-batch-item-issues { min-width: 0; padding-top: 8px; border-top: 1px dashed var(--border, #e2e8f0); }

/* 问题列表：默认（阻断）走危险色，可恢复的走警示色，色差之外还有「（可恢复）」文字。 */
.contract-import-issues-title { color: var(--text-muted, #64748b); font-size: 11.5px; font-weight: 600; }
.contract-import-issues { display: grid; gap: 4px; margin: 6px 0 0; padding: 0; list-style: none; }
.contract-import-issues-empty { margin-top: 6px; color: var(--text-muted, #64748b); font-size: 12px; }

.contract-import-issue {
  padding: 6px 10px;
  color: var(--danger-text, #b91c1c);
  font-size: 12px;
  line-height: 1.6;
  overflow-wrap: anywhere;
  border-inline-start: 3px solid var(--danger, #dc2626);
  border-radius: 0 6px 6px 0;
  background: var(--danger-soft, #fef2f2);
}

.contract-import-issue.is-retryable {
  color: var(--warning-ink, #92400e);
  border-inline-start-color: var(--warning, #d97706);
  background: var(--warning-soft, #fef3c7);
}

/* ── CRM 开立计划 ───────────────────────────────────────────────────── */
.contract-import-provision {
  display: grid;
  gap: 8px;
  margin: 0;
  padding: 12px 14px;
  color: var(--text-secondary, #475569);
  font-size: 12px;
  border: 1px solid var(--primary-border, #bfdbfe);
  border-radius: 10px;
  background: var(--primary-soft, #eff6ff);
}

.contract-import-provision > p { color: inherit; font-size: inherit; line-height: 1.7; }
.contract-import-provision-list { display: grid; gap: 8px; margin: 0; padding: 0; list-style: none; }

.contract-import-provision-item {
  display: grid;
  gap: 6px;
  padding: 10px 12px;
  border: 1px solid var(--primary-border, #bfdbfe);
  border-radius: 8px;
  background: var(--surface-card, #fff);
}

.contract-import-provision-title { color: var(--text, #0f172a); font-size: 12.5px; font-weight: 600; overflow-wrap: anywhere; }
.contract-import-provision-opportunity { color: var(--text-muted, #64748b); font-size: 12px; line-height: 1.6; }

/* ── 状态 / 提示 / 危险条 ───────────────────────────────────────────── */
.contract-import-status { color: var(--text-secondary, #475569); font-size: 12px; line-height: 1.7; }
.contract-import-status.is-loading { display: flex; align-items: center; gap: 8px; }

.contract-import-status.is-loading::before {
  width: 11px;
  height: 11px;
  flex: 0 0 auto;
  content: '';
  border: 2px solid var(--border, #e2e8f0);
  border-top-color: var(--primary, #2563eb);
  border-radius: var(--r-full, 999px);
  animation: contract-import-spin .8s linear infinite;
}

@keyframes contract-import-spin { to { transform: rotate(360deg); } }

.contract-import-alert {
  padding: 10px 12px;
  color: var(--danger-text, #b91c1c);
  font-size: 12px;
  line-height: 1.7;
  border: 1px solid var(--danger-border, #fecaca);
  border-radius: 10px;
  background: var(--danger-soft, #fef2f2);
}

.contract-import-alert .contract-import-hint { display: inline; color: var(--text-secondary, #475569); }

/* 可恢复的待处理状态（例如 CRM 会话缺失）用警示色，危险色只留给真正的失败。 */
.contract-import-alert--warn {
  color: var(--warning-ink, #92400e);
  border-color: var(--warning-border, #fcd34d);
  background: var(--warning-soft, #fef3c7);
}
.contract-import-error-text { color: var(--danger-text, #b91c1c); font-size: 12px; }

.contract-import-warning {
  padding: 10px 12px;
  color: var(--warning-ink, #92400e);
  font-size: 12px;
  line-height: 1.7;
  border: 1px solid var(--warning-border, #fcd34d);
  border-radius: 10px;
  background: var(--warning-soft-strong, #fffbeb);
}

.contract-import-excel-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 18px;
  padding: 10px 12px;
  color: var(--text, #0f172a);
  font-size: 12px;
  border: 1px solid var(--primary-border, #bfdbfe);
  border-radius: 10px;
  background: var(--primary-soft, #eff6ff);
}

.contract-import-excel-summary span { white-space: nowrap; }

.contract-import-excel-issues {
  padding: 10px 12px;
  color: var(--danger-ink, #7f1d1d);
  font-size: 12px;
  line-height: 1.6;
  border: 1px solid var(--danger-border, #fecaca);
  border-radius: 10px;
  background: var(--danger-soft, #fef2f2);
}

.contract-import-excel-issues p { margin-block: 0 6px; color: inherit; font-size: inherit; }
.contract-import-excel-issues ul { max-height: 220px; margin: 0; padding-inline-start: 20px; overflow: auto; }
.contract-import-excel-issues li { margin-block: 3px; overflow-wrap: anywhere; }

/* ── 历史确认与分目标接续 ───────────────────────────────────────────── */
.contract-import-history h3 { margin: 0; color: var(--text, #0f172a); font-size: 13.5px; font-weight: 600; }

.contract-import-targets {
  display: grid;
  gap: 8px;
  padding: 12px 14px;
  border: 1px solid var(--border, #e2e8f0);
  border-radius: 10px;
  background: var(--surface-muted, #f8fafc);
}

.contract-import-targets h4 { margin: 0; color: var(--text, #0f172a); font-size: 12.5px; font-weight: 600; overflow-wrap: anywhere; }
.contract-import-target-list { display: grid; gap: 8px; margin: 0; padding: 0; list-style: none; }

.contract-import-target {
  display: grid;
  gap: 6px;
  padding: 10px 12px;
  border: 1px solid var(--border, #e2e8f0);
  border-radius: 8px;
  background: var(--surface-card, #fff);
}

.contract-import-target-head { color: var(--text-secondary, #475569); font-size: 12px; line-height: 1.6; }
.contract-import-target-head strong { color: var(--text, #0f172a); font-weight: 600; }
.contract-import-target > a { color: var(--primary-ink, #1d4ed8); font-size: 12px; }
.contract-import-body a { color: var(--primary-ink, #1d4ed8); }

/* ── 动作区：固定在区块视觉终点（贴底、整幅通栏），不与长列表争位置 ──── */
.contract-import-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
.contract-import-actions span { color: var(--text-secondary, #475569); font-size: 12px; }

.contract-import-actions--footer {
  justify-content: space-between;
  gap: 10px 18px;
  margin: 2px -16px -16px;
  padding: 13px 16px;
  border-top: 1px solid var(--line-soft, #edf0f5);
  border-radius: 0 0 12px 12px;
  background: var(--surface-muted, #f8fafc);
}

.contract-import-actions--footer .contract-import-hint { flex: 1 1 320px; min-width: 0; }

/* 批次结果的常驻页脚：与导入表单的 --footer 同一套视觉语言（通栏、描边分隔、
   淡底、贴住区块圆角），但内容是「备注 + 动作」两段，所以用 grid 排而不是 flex。
   它不在滚动容器里，列表滚多远都不会把它顶走，也不会盖住下一个区块。 */
.contract-import-batch-foot {
  display: grid;
  gap: 10px;
  margin: 2px -16px -16px;
  padding: 13px 16px;
  border-top: 1px solid var(--line-soft, #edf0f5);
  border-radius: 0 0 12px 12px;
  background: var(--surface-muted, #f8fafc);
}

/* ── 高级清单（默认折叠） ───────────────────────────────────────────── */
.contract-import-advanced { border: 1px dashed var(--line-strong, #cbd5e1); border-radius: 10px; }

.contract-import-advanced > summary {
  padding: 12px 14px;
  color: var(--text-secondary, #475569);
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
}

.contract-import-advanced-body { display: grid; gap: 10px; padding: 2px 14px 14px; }

.contract-import-advanced textarea[readonly] { background: var(--surface-muted, #f8fafc); }

.contract-import-check { display: flex; align-items: flex-start; gap: 8px; color: var(--text-secondary, #475569); font-size: 12px; line-height: 1.6; }
.contract-import-check input { margin-top: 3px; }

.contract-import-body textarea {
  display: block;
  width: 100%;
  padding: 10px 12px;
  color: var(--text, #0f172a);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
  line-height: 1.6;
  resize: vertical;
  border: 1px solid var(--border, #e2e8f0);
  border-radius: 10px;
  background: var(--surface-input, #fff);
}

.contract-import-body textarea:focus { border-color: var(--border-brand-strong, #93c5fd); }
.contract-import-document a { color: var(--primary-ink, #1d4ed8); font-size: 12.5px; }

/* ── 单行编辑抽屉（结构沿用合同模块的弹窗规范） ─────────────────────── */
.contract-import-drawer { width: min(1020px, 100%); }
.contract-import-drawer label { display: flex; flex-direction: column; gap: 7px; margin: 0; color: var(--text-secondary, #475569); font-size: 12px; font-weight: 600; }
.contract-import-drawer label > small { color: var(--text-muted, #64748b); font-size: 11px; font-weight: 400; }
.contract-import-drawer input:not([type=checkbox]),.contract-import-drawer select,.contract-import-drawer textarea { width: 100%; box-sizing: border-box; }
.contract-import-drawer textarea { min-height: 76px; padding: 9px 10px; color: var(--text, #0f172a); font-size: 12px; line-height: 1.6; resize: vertical; outline: 0; border: 1px solid var(--border, #e2e8f0); border-radius: 7px; }
.contract-import-drawer textarea:focus { border-color: var(--border-brand-strong, #93c5fd); box-shadow: 0 0 0 3px rgba(37,99,235,.07); }
.contract-import-drawer button { margin: 0; }
.contract-import-drawer > header > button,.contract-import-drawer .contract-service-item > header > button { width: 30px; height: 30px; padding: 0; }
.contract-import-drawer .contract-system-row > button { height: 36px; padding: 0; }
.contract-import-drawer .contract-form-grid { gap: 12px; }

.contract-import-customer-picker { padding: 12px; border: 1px solid var(--border-soft, #dbe3ee); border-radius: 9px; background: var(--surface-muted, #f8fafc); }
.contract-import-customer-picker > span { color: var(--text-secondary, #475569); font-size: 12px; }
.contract-import-customer-picker ul { display: grid; gap: 4px; max-height: 190px; margin: 8px 0 0; padding: 0; overflow: auto; list-style: none; }
.contract-import-customer-picker li button { display: flex; width: 100%; justify-content: space-between; gap: 10px; padding: 8px 10px; text-align: left; border-radius: 7px; background: var(--surface-raised, #fff); }
.contract-import-customer-picker li button:hover { background: var(--primary-soft, #eff6ff); }
.contract-import-customer-picker li span { color: var(--text-muted, #64748b); font-size: 11px; }

/* ── 历史导入自动审批（仅合同超级管理员） ───────────────────────────── */
/* 开关用原生复选框绘制（appearance: none）：焦点、键盘和读屏语义仍由浏览器负责。
   颜色全部引用全局 token，不在这里新造字面量，深色主题随 main.css 一起切换。 */
.contract-import-auto-approve-head { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 12px; }

.contract-import-switch-label { display: inline-flex; align-items: center; gap: 8px; margin: 0; cursor: pointer; }

.contract-import-switch {
  width: 38px;
  height: 22px;
  flex: 0 0 auto;
  margin: 0;
  padding: 0;
  cursor: pointer;
  appearance: none;
  -webkit-appearance: none;
  border: 1px solid var(--border);
  border-radius: var(--r-full, 999px);
  background-color: var(--border);
  /* 关闭态：描边色轨道 + 中性灰圆钮。浅色是浅灰轨道配灰钮，深色是深蓝灰轨道配灰钮，
     两端都靠 --text-faint 与轨道拉开明度差，不引入字面量，也不依赖阴影。 */
  background-image: radial-gradient(circle closest-side, var(--text-faint) 0 100%, transparent 100%);
  background-repeat: no-repeat;
  background-position: 2px center;
  background-size: 16px 16px;
  transition: background-color var(--duration-fast) ease, background-position var(--duration-fast) ease, border-color var(--duration-fast) ease;
}

/* 开启态：轨道换成主色、圆钮换成卡片色（浅色为白、深色为深蓝），
   滑动距离 = 轨道内宽 36px - 圆钮 16px - 两侧各 2px 留白 = 18px。 */
.contract-import-switch:checked {
  border-color: var(--primary);
  background-color: var(--primary);
  background-image: radial-gradient(circle closest-side, var(--surface-card) 0 100%, transparent 100%);
  background-position: 18px center;
}

/* 焦点环沿用主色：浅色与 panel 其他焦点环同为 #2563eb，深色由 main.css 的 --primary 提亮。 */
.contract-import-switch:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }

.contract-import-switch:disabled { cursor: not-allowed; opacity: .55; }

.contract-import-auto-approve-confirm { display: grid; gap: 10px; }

/* 错误码是可复制的短标签，等宽字体便于口头或工单核对。 */
.contract-import-error-code { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-inline-start: 6px; }
.contract-import-error-code code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }

/* ── 响应式：窄屏改单列，不产生横向滚动、不叠字 ─────────────────────── */
@media (min-width: 900px) {
  .contract-import-batch-item { grid-template-columns: minmax(170px, 250px) minmax(0, 1fr); }
  .contract-import-batch-item-issues { grid-column: 1 / -1; }
  /* 行卡片：标题与客户各占半行，金额/币种/起止日期四种短字段排成一行。 */
  .contract-import-row .contract-import-facts { grid-template-columns: repeat(4, minmax(0, 1fr)); }
  .contract-import-row .contract-import-fact-title,
  .contract-import-row .contract-import-fact-party { grid-column: span 2; }
}

@media (max-width: 768px) {
  .contract-import-body { gap: 14px; padding: 0 14px 14px; }
  .contract-import-panel > summary { padding: 13px 14px; }
  .contract-import-block { padding: 14px; }
  .contract-import-toolbar { flex-direction: column; align-items: stretch; }
  .contract-import-toolbar .contract-import-field { flex: 0 0 auto; }
  .contract-import-toolbar > .contract-button { width: 100%; }
  .contract-import-actions--footer { flex-direction: column; align-items: stretch; margin: 2px -14px -14px; padding: 13px 14px; }
  .contract-import-actions--footer .contract-import-hint { flex: 0 0 auto; }
  .contract-import-actions--footer .contract-button { width: 100%; }
  /* 窄屏上列表最多占半屏多一点，页脚离得近；动作按钮整幅排开，手指好点。 */
  .contract-import-listframe { max-height: min(56vh, 460px); padding: 8px; }
  .contract-import-batch-foot { margin: 2px -14px -14px; padding: 13px 14px; }
  .contract-import-batch-foot .contract-import-actions { flex-direction: column; align-items: stretch; }
  .contract-import-batch-foot .contract-button { width: 100%; }
  .contract-import-facts { grid-template-columns: minmax(0, 1fr); }
  .contract-import-facts--inline { grid-template-columns: max-content minmax(0, 1fr); }
  .contract-import-facts--inline dt { font-size: 11.5px; }
  .contract-import-row-head { align-items: stretch; flex-direction: column; }
  .contract-import-task-list > button { flex: 1 1 auto; }
  .contract-import-steps { font-size: 11.5px; }
}

@media (max-width: 720px) {
  .contract-import-drawer { width: 100%; }
  .contract-import-mode, .contract-import-normal-modes { flex-direction: column; align-items: stretch; }
  .contract-import-mode label, .contract-import-normal-modes label { justify-content: flex-start; border-radius: 8px; }
}

@media (prefers-reduced-motion: reduce) {
  .contract-import-status.is-loading::before { animation: none; }
  .contract-import-panel > summary::before { transition: none; }
  .contract-import-switch { transition: none; }
}
</style>
