<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { contractImportRequest, listContractImportBatches, releaseContractImportItem,
  getImportItemDocumentDescriptor, importItemSourceURL, openContractCRMLogin,
  listMyCustomers, ensureContractCRMDirectorySession, listContractDetectionCategories } from '../api/contract.js'
import ContractPDFPreview from './ContractPDFPreview.vue'
import LocalContractSourcePicker from './LocalContractSourcePicker.vue'
import { importRowSourceForm, applyImportRowSourceForm } from '../utils/localImportSourceBridge.js'
import { contractImportErrorRows, contractImportErrorsCsv } from '../utils/contractImportErrors.js'
import { prepareImportManifest, formatImportMinor } from '../utils/contractImport.js'
import { buildImportManifestFromRows, createImportFormRow, emptyImportServiceItem,
  importFieldLabel, importRowsFromItems, validateImportFormRows } from '../utils/contractImportForm.js'
import { applyContractExcelCustomerLookup, blockingContractExcelIssues, buildContractExcelImportRows,
  matchContractExcelRecordsToFiles, parseContractExcelWorkbook, summarizeContractExcelImport } from '../utils/contractExcelImport.js'
import { contractExcelMaximumBytes, contractExcelTemplateURL, readContractExcelWorkbook } from '../utils/contractExcelReader.js'
import { externalContractTypes, contractSystemLevels, validateContractSourceFile } from '../utils/contractPayload.js'
import { paymentAmountMinor } from '../utils/paymentTerms.js'
import { fallbackServiceTypeOptions } from '../utils/contractDisplay.js'
import { useDictionaryOptions } from '@/modules/platform/dictionaries/composables/useDictionaryOptions.js'
import { ensureStableReviewAttempt } from '../utils/opportunityIntakeReview.js'

const props = defineProps({ enabled: Boolean, pdfEnabled: Boolean, canPreview: { type: Boolean, default: true }, canCommit: Boolean,
  canApprove: Boolean, canRelease: Boolean, actorId: { type: String, default: '' }, initialBatchId: { type: String, default: '' },
  supportedModes: { type: Array, default: () => ['NORMAL'] },
  sourceCapabilities: { type: Object, default: () => ({}) } })
const text = ref(''), files = ref([]), batch = ref(null), batchID = ref(''), lookupID = ref(props.initialBatchId)
const busy = ref(false), error = ref(''), commitKey = ref(''), sourceSelectionVersion = ref(0)
const crmConnectionMessage = ref('')
const batches = ref([]), listOffset = ref(0), listNextOffset = ref(null), listHasMore = ref(false), listLimitReached = ref(false), document = ref(null), confirmationAttempt = ref(null), actionAttempt = ref(null)
const listBusy = ref(false), listError = ref('')
const entryMode = ref(props.supportedModes.includes('NORMAL') ? 'NORMAL' : (props.supportedModes[0] || 'NORMAL'))
const formRows = ref([]), jsonAuthoritative = ref(false), fileMessage = ref(''), advancedMessage = ref('')
const normalEntryMode = ref('excel'), excelFile = ref(null), excelBusy = ref(false), excelMessage = ref('')
const excelIssues = ref([]), excelSummary = ref(null), excelCRMRequired = ref(false), excelCRMProgress = ref(''), excelStale = ref(false)
const excelExcludedFiles = ref([])
const drawerRowKey = ref(''), drawerRef = ref(null)
const customerOptions = ref([]), customerLoading = ref(false), customerError = ref(''), customerCrmRequired = ref(false)
const detectionCategoryOptions = ref([]), detectionCategoryLoading = ref(false), detectionCategoryError = ref('')
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
const issueLabels = {
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
const isNormalEntry = computed(() => entryMode.value === 'NORMAL')
const usesJsonManifest = computed(() => !isNormalEntry.value || jsonAuthoritative.value)
const modeLocked = computed(() => Boolean(batch.value?.items?.length))
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
  if (local && !excelFile.value && !formRows.value.length && !batch.value?.items?.length) {
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
const importErrorReportRows = computed(() => contractImportErrorRows(batch.value?.items || [], error.value, { issueLabels, fieldLabel: importFieldLabel }))

/**
 * syncRowBatchState 只把服务端逐项状态和问题映射回当前表单行，不覆盖用户未保存字段。
 * 参数：无；以 item_key 精确对应，避免重名文件串行。
 * 返回值：无。
 */
function syncRowBatchState() {
  const entries = new Map((batch.value?.items || []).map((entry) => [entry.item.item_key, entry]))
  for (const row of formRows.value) {
    const entry = entries.get(row.key)
    row.batchIssues = entry?.issues || []
    row.state = entry?.state || 'DRAFT'
    row.contractId = entry?.contract_id || ''
    row.normalized = entry?.normalized_metadata || null
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
  if (busy.value || excelBusy.value || !excelFile.value || !isNormalEntry.value) return
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
    if (disposed || ticket !== excelGeneration || normalEntryMode.value !== 'excel' || !isNormalEntry.value) return
    const parsed = parseContractExcelWorkbook(sheets)
    const matchingFiles = excelSourceFiles.value
    const matched = matchContractExcelRecordsToFiles(parsed.records, matchingFiles)
    if (disposed || ticket !== excelGeneration || normalEntryMode.value !== 'excel') return
    const resolved = await resolveExcelCustomers(matched.matchedRecords, ticket)
    if (!resolved || disposed || ticket !== excelGeneration || normalEntryMode.value !== 'excel') return
    const keyByFileName = {}
    for (const row of formRows.value) if (row.fileName && row.key) keyByFileName[row.fileName] = row.key
    const rows = buildContractExcelImportRows(resolved, { keyByFileName })
    // parsed.issues 已汇总工作簿问题和所有 Excel 行的问题；未被 PDF 匹配的行也必须保留其问题，
    // 否则重复合同编号等结构性错误会在后续展示/阻断时丢失。
    const finalIssues = dedupeExcelIssues([...parsed.issues, ...matched.issues, ...resolved.flatMap((record) => record.issues)])
      // 空合同编号会同时产生 record 与 match 两条同义问题；页面只保留带行号的 match 一条。
      .filter((issue) => !(issue.scope === 'record' && issue.code === 'CONTRACT_NUMBER_REQUIRED'))
    formRows.value = rows
    excelIssues.value = finalIssues
    excelSummary.value = summarizeContractExcelImport({ records: parsed.records, matchedRecords: resolved, issues: finalIssues, files: matchingFiles })
    const rowFieldIssues = validateImportFormRows(rows, { files: files.value, sources: batch.value?.sources || [] })
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
  if (busy.value || !isNormalEntry.value || !['excel', 'manual'].includes(value)) return
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
  if (normalEntryMode.value !== 'excel' || !excelFile.value || !isNormalEntry.value) return
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
    if (isNormalEntry.value && nextFiles.length >= 100) {
      fileMessage.value = '每批最多 100 份合同，请拆分后再导入。'
      break
    }
    known.add(file.name)
    nextFiles.push(file)
    if (isNormalEntry.value && normalEntryMode.value === 'manual' && !nextRows.some((row) => row.fileName === file.name)) {
      const row = createImportFormRow({ fileName: file.name })
      flagMissingExternalRecordId(row)
      nextRows.push(row)
    }
  }
  const filesChanged = nextFiles.length !== files.value.length
  files.value = nextFiles
  const selectedNames = new Set(nextFiles.map((file) => file.name))
  excelExcludedFiles.value = excelExcludedFiles.value.filter((name) => !selectedNames.has(name))
  if (isNormalEntry.value && normalEntryMode.value === 'manual') formRows.value = nextRows
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

function removeRow(row) {
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

function selectEntryMode(modeValue) {
  if (modeLocked.value || busy.value || !props.supportedModes.includes(modeValue)) return
  const wasNormal = entryMode.value === 'NORMAL'
  entryMode.value = modeValue
  fileMessage.value = ''
  advancedMessage.value = ''
  if (modeValue === 'NORMAL') {
    if (!wasNormal) normalEntryMode.value = localImportSources.value ? 'manual' : 'excel'
    if (normalEntryMode.value === 'manual') {
      const existing = new Set(formRows.value.map((row) => row.fileName))
      const missing = files.value.filter((file) => !existing.has(file.name)).map((file) => {
        const row = createImportFormRow({ fileName: file.name })
        flagMissingExternalRecordId(row)
        return row
      })
      if (missing.length) formRows.value = [...formRows.value, ...missing]
    } else {
      markExcelStale()
    }
  }
  if (modeValue !== 'NORMAL') jsonAuthoritative.value = false
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
  if (!isNormalEntry.value || detectionCategoryLoading.value) return
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

function regenerateJSON() {
  if (!isNormalEntry.value) return
  try {
    text.value = JSON.stringify(buildImportManifestFromRows(formRows.value, {
      sourceSystem: batch.value?.source_system || 'manual',
      files: files.value,
      sources: batch.value?.sources || [],
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
    const batchMode = result.items?.[0]?.item?.mode
    if (batchMode) entryMode.value = batchMode
    if (!text.value && result.items?.length) {
      text.value = JSON.stringify({ schema_version: 1, source_system: result.source_system, items: result.items.map((entry) => entry.item) }, null, 2)
    }
    if (isNormalEntry.value && result.items?.length && (switched || !formRows.value.length)) {
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
  normalEntryMode.value = localImportSources.value ? 'manual' : 'excel'; resetExcelState()
  entryMode.value = props.supportedModes.includes('NORMAL') ? 'NORMAL' : (props.supportedModes[0] || 'NORMAL')
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
 * 参数：无；普通模式以表单生成清单，历史模式使用完整 JSON；已暂存文件沿用精确file_ref。
 * 返回值：Promise<void>；任一不确定结果保留批次号并要求先查询。
 */
async function preview() {
  generation++; clearTimeout(timer)
  busy.value = true; error.value = ''; fileMessage.value = ''
  crmConnectionMessage.value = ''
  try {
    if (batch.value?.operation_id && !['PAUSED', 'PARTIAL', 'DRAFT', 'BLOCKED', 'PREVIEWED'].includes(batch.value.state)) throw new Error('请先暂停批次并查询结果，只有未建单项可修订。')
    if (isNormalEntry.value && normalEntryMode.value === 'excel' && excelStale.value) {
      throw new Error('原件或合同行已变化，请先点击「重新应用 Excel」或切换手动逐份填写后再预检。')
    }
    if (isNormalEntry.value && normalEntryMode.value === 'excel' && excelStructuralIssues.value.length) {
      throw new Error('Excel 与 PDF 还有未处理的结构性匹配问题，请先按上方提示修正后再预检。')
    }
    if (isNormalEntry.value && normalEntryMode.value === 'excel') {
      // 用户可能在抽屉里修改了服务类型/检测类别；预检前重新用当前目录刷新一次，避免误放行或残留过期提示。
      clearExcelDirectoryIssues(formRows.value)
      const directoryIssueCount = applyExcelDirectoryIssues(formRows.value)
      if (directoryIssueCount) throw new Error('Excel 有 ' + directoryIssueCount + ' 处服务类型/检测类别不在当前目录中，请逐行修正后再预检。')
    }
    if (usesJsonManifest.value && !text.value.trim()) throw new Error('请填写完整 JSON 清单后再预检。')
    if (!usesJsonManifest.value) {
      const built = buildImportManifestFromRows(formRows.value, {
        sourceSystem: batch.value?.source_system || 'manual', files: files.value, sources: batch.value?.sources || [],
      })
      text.value = JSON.stringify(built, null, 2)
      advancedMessage.value = '普通模式以表单为准，清单已从当前表单生成。'
      formRows.value.forEach((row) => { row.issues = [] })
    }
    const prepared = prepareImportManifest(text.value, files.value, batch.value?.sources || [], props.supportedModes)
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
    if (failure?.issues?.length) {
      applyFormIssues(failure.issues)
      error.value = `表单有 ${failure.issues.length} 处需要修正：${failure.message}`
      if (batchID.value) await refresh(batchID.value, { fromWrite: true })
    } else {
      if (batchID.value) await refresh(batchID.value, { fromWrite: true })
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

onMounted(() => { if (props.initialBatchId) refresh(props.initialBatchId) })

onBeforeUnmount(() => { disposed = true; generation++; documentGeneration++; excelGeneration++; clearTimeout(timer) })
</script>

<template>
  <details class="contract-import-panel">
    <summary>批量导入外部合同原件</summary>
    <p>当前开放：{{ supportedModes.map(mode => modeLabels[mode] || mode).join('、') }}。普通合同可先批量上传 PDF、再上传 Excel 自动写入详情（也可切换手动逐份填写），仍需逐份走现有审批；历史合同需要完整 JSON 清单并走当前独立导入确认，各子系统分别核对放行。</p>
    <p>历史签署日期是来源声明，导入确认不补造原年度审批，也不替代签署原件核验。</p>
    <p v-if="!enabled">新增批次已关闭；已有批次仍可查询、暂停与恢复。</p>
    <button v-if="enabled && canPreview" type="button" :disabled="busy" @click="startNewBatch">开始新批次（保留已保存任务）</button>
    <label>查询批次号 <input v-model="lookupID" maxlength="26" :disabled="busy" autocomplete="off" /></label>
    <button type="button" :disabled="busy || !lookupID" @click="refresh(lookupID)">查询／刷新结果</button>
    <button type="button" :disabled="busy || listBusy" @click="loadBatches()">我的批次与待确认任务</button>
    <p v-if="listBusy" role="status">正在查询批次列表…</p>
    <p v-if="listError" role="alert">{{ listError }}</p>
    <div class="contract-import-task-list"><button v-for="record in batches" :key="record.batch_id" type="button" :disabled="busy" @click="refresh(record.batch_id)">{{ record.batch_id }} · {{ labels[record.state] || record.state }}</button></div>
    <div v-if="batches.length || listOffset || listHasMore" class="contract-import-task-list"><button type="button" :disabled="busy || listBusy || !listOffset" @click="loadBatches(Math.max(0, listOffset - 50))">列表上一页</button><button type="button" :disabled="busy || listBusy || !listHasMore" @click="loadBatches(listNextOffset)">列表下一页</button></div>
    <p v-if="listLimitReached">已到达批次列表查询上限，请使用批次号定位需要处理的记录。</p>

    <template v-if="formEditable">
      <p v-if="batch?.operation_id">已建单项须原样保留，只能修订尚未建单项；新修订会使旧预检和执行代次失效。已建单内容更正需先核对原合同。</p>
      <fieldset v-if="supportedModes.length > 1" class="contract-import-mode" :disabled="busy || modeLocked">
        <legend>导入方式</legend>
        <label v-for="modeValue in supportedModes" :key="modeValue">
          <input type="radio" name="contract-import-entry-mode" :value="modeValue" :checked="entryMode === modeValue" @change="selectEntryMode(modeValue)" />
          {{ modeLabels[modeValue] || modeValue }}{{ modeValue === 'NORMAL' ? '（Excel/表单）' : '（完整 JSON 清单）' }}
        </label>
      </fieldset>
      <p v-if="modeLocked" class="contract-import-hint">批次已保存清单，导入方式随当前批次固定；需要换一种方式请开始新批次。</p>

      <section v-if="isNormalEntry" aria-label="普通新合同导入表单">
        <fieldset class="contract-import-normal-modes" :disabled="busy">
          <legend>详情填写方式</legend>
          <label v-if="!localImportSources"><input type="radio" name="contract-import-normal-mode" value="excel" :checked="normalEntryMode === 'excel'" @change="selectNormalEntryMode('excel')" /> Excel 批量导入（推荐）</label>
          <label><input type="radio" name="contract-import-normal-mode" value="manual" :checked="normalEntryMode === 'manual'" @change="selectNormalEntryMode('manual')" /> 手动逐份填写</label>
        </fieldset>
        <p v-if="localImportSources" class="contract-import-hint">本地来源使用逐份表单选择真实目录引用；可以一次上传多份原件并批量预检，历史清单不自动转换来源。</p>
        <template v-if="normalEntryMode === 'excel'">
          <p>第一步选择 PDF 原件（可多选），第二步选择填写好合同详情的 Excel。PDF 文件名去掉扩展名必须与 Excel「合同明细」的合同编号完全一致；系统按合同编号一一对应写入「编辑详情」，缺 PDF、缺 Excel 行、重复编号都会在下面列出并阻止预检。</p>
          <div class="contract-import-dropzone" @dragover.prevent @drop.prevent="dropFiles">
            <label for="contract-import-files">第一步：选择或拖入 PDF 原件（可多选，≤100 份）</label>
            <input id="contract-import-files" :key="sourceSelectionVersion" type="file" multiple :accept="pdfEnabled ? '.docx,.pdf' : '.docx'" :disabled="busy" @change="selectFiles" />
          </div>
          <p v-if="files.length" role="status">已选择 {{ files.length }} 份原件：{{ files.map(file => file.name).join('、') }}</p>
          <ul v-if="files.length" class="contract-import-file-list"><li v-for="file in files" :key="file.name">{{ file.name }} <button class="contract-text-button danger" type="button" :disabled="busy" @click="removeSelectedFile(file)">移除</button></li></ul>
          <div class="contract-import-dropzone">
            <label for="contract-import-excel">第二步：选择 Excel（.xlsx，≤5MiB）</label>
            <input id="contract-import-excel" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" :disabled="busy || excelBusy" @change="selectExcelFile" />
          </div>
          <p><a :href="contractExcelTemplateURL" download>下载 Excel 标准模板（含合同明细、服务项、系统信息、付款条款和填写说明）</a></p>
          <p v-if="excelFile" role="status">已选择 Excel：{{ excelFile.name }} <button class="contract-text-button" type="button" :disabled="busy || excelBusy" @click="applyExcelImport">重新应用 Excel（覆盖未保存详情）</button><button class="contract-text-button danger" type="button" :disabled="busy || excelBusy" @click="clearExcelFile">移除</button></p>
          <p v-if="excelBusy" role="status">正在解析 Excel 并匹配 PDF…</p>
          <p v-if="excelCRMProgress" role="status">{{ excelCRMProgress }}</p>
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
          <p v-if="excelCRMRequired" role="alert">Excel 中缺少 CRM 客户编号，部分客户尚未在 CRM 中核对。 <button type="button" :disabled="busy" @click="connectCRM(true)">连接 CRM</button> <button type="button" :disabled="busy || excelBusy" @click="applyExcelImport">登录后重新应用 Excel</button></p>
          <p v-if="batch?.items?.length" class="contract-import-hint">当前批次已恢复；重新选择 Excel 会覆盖尚未建项的详情，已建单项不会被覆盖。</p>
        </template>
        <template v-else>
          <p>先选择合同原件（PDF/DOCX），每份原件自动生成一行合同。文件名只作为原件引用，重命名文件后请移除该行并重新选择；同一文件只能导入一次。每行还须在「编辑详情」填写来源业务键（原系统合同编号/业务键，必填），系统据此识别重复导入的同一份合同。</p>
          <div class="contract-import-dropzone" @dragover.prevent @drop.prevent="dropFiles">
            <label for="contract-import-files">选择或拖入合同原件（可多选）</label>
            <input id="contract-import-files" :key="sourceSelectionVersion" type="file" multiple :accept="pdfEnabled ? '.docx,.pdf' : '.docx'" :disabled="busy" @change="selectFiles" />
          </div>
          <p v-if="files.length" role="status">已选择 {{ files.length }} 份：{{ files.map(file => file.name).join('、') }}</p>
        </template>
        <p v-if="fileMessage" class="contract-import-error" role="alert">{{ fileMessage }}</p>
        <div v-if="formRows.length" class="contract-import-scroll">
          <table class="contract-data-table contract-import-rows" aria-label="普通合同导入行">
            <thead><tr><th>原件</th><th>合同标题</th><th>客户</th><th>金额（元）</th><th>币种</th><th>开始日期</th><th>结束日期</th><th>状态／错误</th><th>操作</th></tr></thead>
            <tbody>
              <tr v-for="(row, index) in formRows" :key="row.key">
                <td><strong>{{ row.fileName }}</strong><small class="block">{{ rowStaged(row) ? '重新预检沿用当前批次已暂存原件' : (batch ? '新原件，预检时上传' : '尚未上传') }}</small><small class="block" :class="hasExternalRecordId(row) ? '' : 'contract-import-error-text'">来源业务键：{{ row.externalRecordId || '未填写（请在「编辑详情」补填）' }}</small></td>
                <td>{{ row.title || '未填写' }}</td>
                <td>{{ row.customerName || '未填写' }}<small v-if="row.crmCustomerId" class="block">ID {{ row.crmCustomerId }}</small><small v-if="row.normalized" class="block">预检权威：{{ row.normalized.customer_name }} / {{ row.normalized.crm_customer_id }}</small><small v-if="normalizedCustomerDiff(row)" class="contract-import-error-text block">与预检客户不一致，请以权威目录为准</small></td>
                <td class="amount">{{ row.amount || '未填写' }}<small v-if="row.contractId" class="block">合同 {{ row.contractId }}</small></td>
                <td>{{ row.currency }}</td>
                <td>{{ row.startDate || '—' }}</td>
                <td>{{ row.endDate || '—' }}</td>
                <td><span class="contract-badge" :class="rowStateTone(row)"><i></i>{{ stateLabels[row.state] || row.state }}</span><p v-if="rowIssues(row).length" class="contract-import-error-text" role="alert">发现 {{ rowIssues(row).length }} 处问题：{{ rowIssues(row)[0].message }}</p><p v-else-if="row.batchIssues.length" class="contract-import-error-text" role="alert">{{ rowBatchIssueSummary(row)[0] }}{{ row.batchIssues.length > 1 ? `（共 ${row.batchIssues.length} 处）` : '' }}</p></td>
                <td><button class="contract-text-button" type="button" :aria-label="`编辑第 ${index + 1} 行详情`" @click="openRow(row, $event)">编辑详情</button><button class="contract-text-button danger" type="button" :disabled="busy" :aria-label="`移除第 ${index + 1} 行`" @click="removeRow(row)">移除</button></td>
              </tr>
            </tbody>
          </table>
        </div>
        <p v-else class="contract-import-hint">{{ normalEntryMode === 'excel' ? '尚未匹配到合同行。请选择 Excel，并确认 PDF 文件名去掉扩展名后与 Excel 合同编号完全一致；匹配成功后会写入下方详情。' : '尚未选择原件。选择后会自动生成合同行，不需要手工编写 JSON。' }}</p>
        <p><button class="contract-button primary" type="button" :disabled="busy || !canPreviewAction" @click="preview">{{ batch ? '继续暂存／修订并重新预检' : '暂存并逐项预检' }}</button></p>
        <p class="contract-import-hint">暂存并预检不会创建合同。预检错误会按行和字段显示，可修正后重试；预检通过后再提交冻结清单。</p>
      </section>

      <section v-else aria-label="历史合同完整清单导入">
        <p><strong>历史导入需要完整清单。</strong>历史存档、接续履约和历史结清档案包含 history_evidence、policy_options 等字段，继续使用 JSON 清单核对；不使用普通表单，避免丢字段或改写历史事实。</p>
        <label for="contract-import-json">UTF-8 JSON 清单（≤2MiB，1—100项）</label>
        <textarea id="contract-import-json" v-model="text" maxlength="2097152" rows="10" :disabled="busy" placeholder='{"schema_version":1,"source_system":"legacy","items":[{"item_key":"one","external_record_id":"原业务键","mode":"ARCHIVE_ONLY","source_file_ref":"原件.pdf","metadata":{},"history_evidence":{},"policy_options":{}}]}' />
        <p>每项 metadata 填写完整合同字段；历史项还须提供 history_evidence 和 policy_options。source_file_ref 在此处填写对应文件名，须与所选原件一一匹配。</p>
        <p v-if="batch">已暂存项保留当前 file_ref；需要更换原件时，将该行 source_file_ref 改为新选择的文件名。相同文件名的历史代次不会自动替换当前原件。</p>
        <label>选择对应原件 <input :key="sourceSelectionVersion" type="file" multiple :accept="pdfEnabled ? '.docx,.pdf' : '.docx'" :disabled="busy" @change="selectFiles" /></label>
        <p v-if="files.length" role="status">已选择：{{ files.map(file => file.name).join('、') }}</p>
        <p v-if="fileMessage" class="contract-import-error" role="alert">{{ fileMessage }}</p>
        <ul v-if="files.length" class="contract-import-file-list"><li v-for="file in files" :key="file.name">{{ file.name }} <button class="contract-text-button danger" type="button" :disabled="busy" @click="removeSelectedFile(file)">移除</button></li></ul>
        <p><button class="contract-button primary" type="button" :disabled="busy || !canPreviewAction" @click="preview">{{ batch ? '继续暂存／修订并重新预检' : '暂存并逐项预检' }}</button></p>
      </section>

      <details v-if="isNormalEntry" class="contract-import-advanced" @toggle="onAdvancedToggle">
        <summary>高级：查看/编辑清单</summary>
        <p>普通模式默认以表单为准；下方 JSON 由表单生成，仅用于核对或特殊处理。展开不会自动保存，也不会自动改写表单。</p>
        <label class="contract-import-check"><input v-model="jsonAuthoritative" type="checkbox" :disabled="busy" @change="toggleJsonAuthoritative" /> 以 JSON 清单为准（高级；勾选后表单修改不会进入预检）</label>
        <p v-if="jsonAuthoritative" class="contract-import-warning" role="alert">当前以 JSON 为准：预检直接保存下方 JSON。取消勾选会重新用表单生成清单，JSON 中的修改会被覆盖；需要历史字段请切换到历史导入方式。</p>
        <label for="contract-import-advanced-json">清单 JSON（普通模式默认只读）</label>
        <textarea id="contract-import-advanced-json" v-model="text" maxlength="2097152" rows="10" :readonly="!jsonAuthoritative" :disabled="busy" />
        <div class="contract-import-actions"><button class="contract-button secondary small" type="button" :disabled="busy || jsonAuthoritative" @click="regenerateJSON">用当前表单重新生成 JSON</button><span v-if="advancedMessage" role="status">{{ advancedMessage }}</span></div>
      </details>
    </template>

    <p v-if="error" role="alert">{{ error }}</p>
    <template v-if="batch">
      <p role="status">批次 {{ batch.batch_id }} · 第 {{ batch.revision }} 版 · {{ labels[batch.state] || batch.state }}</p>
      <p v-if="batch.items?.length">导入方式：{{ modeLabels[batch.items[0].item.mode] || batch.items[0].item.mode }}</p>
      <p v-if="batch.operation_id">操作号：{{ batch.operation_id }}。请保留批次号，重新登录或刷新页面后可查询恢复。</p>
      <p v-if="crmConnectionRequired" role="alert">
        CRM 当前账号授权上下文缺失或已过期，请先连接 CRM，再重新预检当前批次。
        <button type="button" :disabled="busy" @click="connectCRM()">连接 CRM</button>
        <span v-if="crmConnectionMessage" role="status">{{ crmConnectionMessage }}</span>
      </p>
      <div class="contract-import-scroll"><table class="contract-data-table"><thead><tr><th>单项</th><th>来源业务键</th><th>状态／合同ID</th><th>字段及错误</th></tr></thead><tbody>
        <tr v-for="entry in batch.items" :key="entry.id"><td>{{ entry.item.item_key }} · {{ modeLabels[entry.item.mode] }}<br /><small>原件：{{ batch.sources.find(source => source.file_ref === entry.item.source_file_ref)?.filename }}<br />{{ entry.item.source_file_ref }}</small><button v-if="entry.contract_id" class="contract-text-button" type="button" :disabled="busy" @click="viewSource(entry)">查看冻结原件</button></td><td>{{ entry.item.external_record_id }}<p>纸面编号：{{ entry.item.metadata.external_paper_number || '未提供' }}</p><p v-if="entry.item.history_evidence">声明签署日：{{ entry.item.history_evidence.declared_signed_date || '未声明' }}<br />原终态／履约态：{{ entry.item.history_evidence.historical_status }}</p></td><td>{{ stateLabels[entry.state] || entry.state }}<br />{{ entry.contract_id || '尚未建单' }}<p v-if="entry.normalized_metadata">权威客户：{{ entry.normalized_metadata.customer_name }}<br />客户ID：{{ entry.normalized_metadata.crm_customer_id }}<br />规范金额：{{ entry.normalized_metadata.currency }} {{ formatImportMinor(entry.normalized_metadata.amount_minor) }}</p><p v-if="entry.item.metadata.customer_name !== entry.normalized_metadata?.customer_name">清单客户声明：{{ entry.item.metadata.customer_name }}</p></td><td><template v-for="issue in entry.issues" :key="issue.field_path + issue.code"><p class="contract-import-issue" role="alert">{{ importFieldLabel(issue.field_path) }}：{{ issueLabels[issue.code] || issue.code }}{{ issue.retryable ? '（可恢复）' : '' }}</p></template><p v-if="!entry.issues?.length">无</p></td></tr>
      </tbody></table></div>
      <p><button class="contract-button secondary small" type="button" :disabled="busy || !importErrorReportRows.length" aria-label="下载合同批量导入错误报告 CSV" @click="downloadImportErrorReport">下载错误报告 CSV</button></p>
      <p v-if="batch.state === 'PREVIEWED'">预计创建 {{ batch.items.filter(entry => !entry.contract_id).length }} 份记录；本次不免审生效。普通模式之后逐份审批；历史模式之后独立确认，再分别放行项目、财务和报表。</p>
      <p v-if="!batch.can_commit">当前身份可查看此批次；提交和恢复须由具有导入提交权限的批次创建人执行。</p>
      <button v-if="batch.state === 'PREVIEWED' && !historyItems.length && canCommit && batch.can_commit" type="button" :disabled="busy" @click="commit">确认冻结清单并创建草稿</button>
      <button v-if="['RUNNING','QUEUED'].includes(batch.state) && canCommit && batch.can_commit" type="button" :disabled="busy" @click="control('pause')">暂停新认领</button>
      <button v-if="['PAUSED','PARTIAL'].includes(batch.state) && canCommit && batch.can_commit && !batch.items.some(entry => ['CORRECTION_REQUIRED','NEEDS_REVIEW'].includes(entry.state))" type="button" :disabled="busy" @click="control('resume')">重新授权并恢复原操作</button>
      <section v-if="historyItems.length" aria-label="历史导入确认及分目标接续">
        <h3>历史导入独立确认</h3>
        <p>确认对象为本批次当前冻结的原件、字段、原业务事实及子系统政策。已创建记录不代表历史接续已经完成。</p>
        <button v-if="canCommit && batch.can_commit && batch.state === 'PREVIEWED' && !['STARTING','PENDING','APPROVED'].includes(batch.confirmation?.state)" type="button" :disabled="busy" @click="confirmation()">冻结清单、建立历史记录并提交独立确认</button>
        <template v-if="batch.confirmation">
          <p>当前确认：{{ stateLabels[batch.confirmation.state] || batch.confirmation.state }}；冻结修订 {{ batch.confirmation.revision }}。</p>
          <p>要求角色：{{ batch.confirmation.roles.join('、') }}；已确认：{{ batch.confirmation.approved_roles?.join('、') || '无' }}。</p>
          <button v-if="canVote" type="button" :disabled="busy" @click="confirmation('APPROVE')">确认本次历史导入基线</button>
          <button v-if="canVote" type="button" :disabled="busy" @click="confirmation('REJECT')">驳回本次历史导入</button>
          <button v-if="canCommit && batch.can_commit && ['STARTING','PENDING'].includes(batch.confirmation.state)" type="button" :disabled="busy" @click="confirmation('WITHDRAW')">撤回本次确认</button>
        </template>
        <article v-for="entry in historyItems" :key="entry.id" class="contract-import-targets">
          <h4>{{ entry.item.item_key }} · {{ entry.confirmed ? '当前历史基线已确认' : '等待当前独立确认' }}</h4>
          <p>项目政策 {{ entry.item.policy_options.project_mode }}；财务政策 {{ entry.item.policy_options.finance_mode }}；报表政策 {{ entry.item.policy_options.report_mode }}。</p>
          <p v-if="entry.item.policy_options.finance_mode === 'EVIDENCE_ONLY'">仅保存原财务证明，未在结算重建财务台账，不能将此项解释为结算已核验零余额。</p>
          <div v-for="target in entry.targets" :key="target.target">
            <strong>{{ targetLabels[target.target] }}</strong>：{{ stateLabels[target.state] || target.state }}<span v-if="target.error_code && target.state !== 'COMPLETE'"> · {{ target.error_code }}</span>
            <span v-if="target.receipt_id"> · 实际回执 {{ target.receipt_id }}</span>
            <p v-if="target.state === 'BLOCKED' && target.recipient_http_status === 409 && target.recipient_code === 'SETTLEMENT_CONFLICT'">接收方已明确拒绝旧放行。财务须先重新对账；再次申请会严格核对新凭证、政策与责任，并保留旧命令记录。来源或政策不一致仍阻断。</p>
            <p v-if="canRetryProjectRejection(target)">项目端明确拒绝参数或负责人。请核对项目负责人在目标环境的有效授权及冻结字段；恢复仅重试原命令，不修改已确认基线。</p>
            <template v-if="canRelease && entry.confirmed && !['COMPLETE','NOT_APPLICABLE'].includes(target.state) && (target.state !== 'BLOCKED' || canRetryProjectRejection(target) || (target.target === 'FINANCE' && target.phase === 'RELEASE' && target.recipient_http_status === 409 && target.recipient_code === 'SETTLEMENT_CONFLICT'))">
              <button v-if="target.target === 'FINANCE' && !target.receipt_id" type="button" :disabled="busy" @click="release(entry, target, 'PREPARE')">建立／恢复财务HOLD暂存</button>
              <button v-else-if="canRetryProjectRejection(target)" type="button" :disabled="busy" @click="release(entry, target)">核对项目参数和负责人后重试同一命令</button>
              <button v-else type="button" :disabled="busy" @click="release(entry, target)">{{ target.target === 'FINANCE' ? (target.state === 'BLOCKED' ? '重新核对并申请财务放行' : '核验对账和责任后申请财务放行') : target.target === 'REPORT' ? '申请／查询真实数析应用' : '申请／恢复项目绑定' }}</button>
            </template>
            <a v-if="target.target === 'FINANCE' && target.receipt_id" :href="`/settlement/imports?import_snapshot=${encodeURIComponent(target.receipt_id)}`">前往财务恢复工作台</a>
          </div>
        </article>
      </section>
    </template>
    <section v-if="document" aria-label="冻结导入原件">
      <button type="button" @click="closeSource">关闭原件</button>
      <ContractPDFPreview v-if="document.format === 'PDF'" :descriptor="document" title="当前导入基线的PDF原件" />
      <a v-else :href="importItemSourceURL(document.batchID, document.itemID)">下载冻结的 DOCX 原件</a>
    </section>

    <div v-if="drawerRow" class="contract-modal-mask contract-import-drawer-mask" @click.self="closeDrawer">
      <article ref="drawerRef" class="contract-detail-modal contract-import-drawer" role="dialog" aria-modal="true" aria-labelledby="contract-import-drawer-title" tabindex="-1" @keydown="onDrawerKeydown">
        <header>
          <div>
            <span class="contract-badge info">普通合同导入</span>
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
            <label class="contract-form-wide"><span>合同标题</span><input id="contract-import-row-title" v-model="drawerRow.title" maxlength="255" required autocomplete="off" :aria-invalid="rowIssue(drawerRow, 'title') ? 'true' : undefined" /><small v-if="rowIssue(drawerRow, 'title')" class="contract-field-error" role="alert">{{ rowIssue(drawerRow, 'title').message }}</small></label>
            <label class="contract-form-wide"><span>来源业务键：原系统合同编号/业务键（必填，用于重复导入识别）</span><input id="contract-import-row-external-record-id" v-model="drawerRow.externalRecordId" maxlength="128" pattern="[A-Za-z0-9_.:-]+" required autocomplete="off" @input="clearExternalRecordIdIssue(drawerRow, $event)" :aria-invalid="(!hasExternalRecordId(drawerRow) || rowIssue(drawerRow, 'externalRecordId')) ? 'true' : undefined" /><small>填写来源系统中的原合同编号或业务键；只能使用字母/数字/._:-，同一批次内不能重复，重复导入据此识别同一份合同。</small><small v-if="rowIssue(drawerRow, 'externalRecordId')" class="contract-field-error" role="alert">{{ rowIssue(drawerRow, 'externalRecordId').message }}</small></label>
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
   token 在浅色下未定义或取值与原字面量相同，浅色渲染不变；深色下取 main.css 的值。 */
.contract-import-panel { padding: 16px; margin-block: 16px; border: 1px solid var(--line-strong, #cbd5e1); border-radius: 8px; background: var(--surface-card, #fff); }
.contract-import-panel label { display: block; margin-block: 12px; }
.contract-import-panel textarea { display: block; width: 100%; box-sizing: border-box; }
.contract-import-panel input { max-width: 100%; }
.contract-import-panel p { overflow-wrap: anywhere; }
.contract-import-panel button { margin: 4px; padding: 8px; }
.contract-import-scroll { overflow-x: auto; }
.contract-import-panel th,.contract-import-panel td { padding: 8px; text-align: left; vertical-align: top; }
.contract-import-task-list { display: flex; flex-wrap: wrap; }
.contract-import-targets { padding: 12px; border-block-start: 1px solid var(--border-soft, #d9e1ec); }
.contract-import-targets div { margin-block: 8px; }
.contract-import-mode { display: flex; flex-wrap: wrap; gap: 14px; margin-block: 12px; padding: 12px; border: 1px solid var(--line-strong, #cbd5e1); border-radius: 8px; }
.contract-import-mode legend { padding-inline: 4px; font-weight: 600; }
.contract-import-mode label { display: inline-flex; align-items: center; gap: 6px; margin: 0; }
.contract-import-mode input { margin: 0; }
.contract-import-normal-modes { display: flex; flex-wrap: wrap; gap: 14px; margin-block: 12px; padding: 12px; border: 1px solid var(--line-strong, #cbd5e1); border-radius: 8px; }
.contract-import-normal-modes legend { padding-inline: 4px; font-weight: 600; }
.contract-import-normal-modes label { display: inline-flex; align-items: center; gap: 6px; margin: 0; }
.contract-import-normal-modes input { margin: 0; }
.contract-import-excel-summary { display: flex; flex-wrap: wrap; gap: 8px 18px; margin-block: 10px; padding: 10px 12px; color: var(--text, #0f172a); font-size: 12px; border: 1px solid var(--primary-border, #bfdbfe); border-radius: 8px; background: var(--primary-soft, #eff6ff); }
.contract-import-excel-issues { margin-block: 10px; padding: 10px 12px; color: var(--danger-ink, #7f1d1d); font-size: 12px; border: 1px solid var(--danger-border, #fecaca); border-radius: 8px; background: var(--danger-soft, #fef2f2); }
.contract-import-excel-issues p { margin-block: 0 6px; }
.contract-import-excel-issues ul { max-height: 220px; margin: 0; padding-inline-start: 20px; overflow: auto; }
.contract-import-excel-issues li { margin-block: 3px; overflow-wrap: anywhere; }
.contract-import-hint { color: var(--text-secondary, #475569); font-size: 12px; }
.contract-import-warning { padding: 10px 12px; color: var(--warning-ink, #92400e); font-size: 12px; border: 1px solid var(--warning-border, #fcd34d); border-radius: 8px; background: var(--warning-soft-strong, #fffbeb); }
.contract-import-error { color: var(--danger-text, #b91c1c); font-size: 12px; }
.contract-import-error-text { color: var(--danger-text, #b91c1c); font-size: 12px; }
.contract-import-issue { margin: 0 0 6px; color: var(--danger-text, #b91c1c); font-size: 12px; }
.contract-import-rows { min-width: 1080px; }
.contract-import-dropzone { margin-block: 12px; padding: 14px; border: 1px dashed var(--border-brand-strong, #93c5fd); border-radius: 9px; background: var(--surface-tint, #f8fbff); }
.contract-import-dropzone label { margin: 0 0 8px; }
.contract-import-advanced { margin-block: 14px; padding: 12px; border: 1px dashed var(--line-strong, #cbd5e1); border-radius: 8px; }
.contract-import-advanced summary { cursor: pointer; font-weight: 600; }
.contract-import-advanced textarea[readonly] { background: var(--surface-muted, #f8fafc); }
.contract-import-check { display: flex; align-items: flex-start; gap: 8px; }
.contract-import-check input { margin-top: 3px; }
.contract-import-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
.contract-import-actions span { color: var(--text-secondary, #475569); font-size: 12px; }
.contract-import-file-list { padding-inline-start: 20px; font-size: 12px; }
.contract-import-file-list li { margin-block: 4px; }
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
@media (max-width: 720px) { .contract-import-drawer { width: 100%; } .contract-import-mode { flex-direction: column; } }
</style>
