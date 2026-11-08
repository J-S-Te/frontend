<script setup>
import { computed, nextTick, reactive, ref, watch, onBeforeUnmount } from 'vue'
import { pinyin } from 'pinyin-pro'
import ConsoleIcon from '@/modules/platform/shared/components/ConsoleIcon.vue'
import ConfirmDialog from '../../../shared/components/ConfirmDialog.vue'
import PaginationBar from '../../../shared/components/PaginationBar.vue'
import BatchUserImportPreviewTable from './BatchUserImportPreviewTable.vue'
import { useConfirmDialog } from '../../../shared/composables/useConfirmDialog.js'
import { createEmployeesBatch } from '@/modules/platform/iam/api/iam'
import { parseApplicationRoles, restoreRowSelection } from '@/modules/platform/iam/utils/batchUserImport.js'
import { importIssuesFromError, batchImportIssueCsv, IMPORT_ISSUE_CSV_FILENAME } from '@/modules/platform/iam/utils/batchImportIssues.js'
import { initialCredentialsForImport, initialCredentialsDocument, clearInitialCredentials } from '@/modules/platform/iam/utils/employeeInitialCredentials.js'
import { formatUserError, userFieldErrors } from '../../../shared/utils/userError.js'

// 上限与后端 POST /users/batch 的硬性约束保持一致：超过会一次性整体失败。
const BATCH_LIMIT = 100
const MAX_FILE_SIZE = 2 * 1024 * 1024
const ACCEPTED_STATUSES = new Set(['ACTIVE', 'DISABLED'])
const STATUS_ALIASES = new Map([
  ['启用', 'ACTIVE'],
  ['停用', 'DISABLED'],
  ['ACTIVE', 'ACTIVE'],
  ['DISABLED', 'DISABLED'],
])

const props = defineProps({
  organizations: { type: Array, default: () => [] },
  positions: { type: Array, default: () => [] },
  // 父组件正在重新读取组织 / 岗位目录，或读取失败。目录未确认前不能提交导入。
  catalogsLoading: { type: Boolean, default: false },
  catalogsError: { type: String, default: '' },
})
const emit = defineEmits(['close', 'completed', 'toast'])

// ---- wizard 状态 ----
const step = ref(1) // 1=上传, 2=预览, 3=结果
const { dialog: closeConfirm, askConfirm, accept: acceptClose, cancel: cancelClose } = useConfirmDialog()
const fileName = ref('')
const fileSize = ref(0)
const rawText = ref('')
const selectedFile = ref(null)
const parseError = ref('')
const submitting = ref(false)
const submitError = ref('')
// 服务端 422 的逐行问题清单（details.issues）。整批导入是原子的，出现任何一条都表示
// 本次没有写入；保留完整清单供页面展示和下载错误报告，而不是只显示第一条。
const submitIssues = ref([])
const ISSUE_PREVIEW_LIMIT = 20
const visibleSubmitIssues = computed(() => submitIssues.value.slice(0, ISSUE_PREVIEW_LIMIT))
const submitResult = ref(null) // { items: [], total, failed }
const credentialsVisible = ref(false)
onBeforeUnmount(() => clearInitialCredentials(submitResult.value))

// 1-based 行号 → 行对象（包含原始单元格、解析结果、勾选状态、错误信息）。
// 解析失败的单行只影响自身，不阻断其他行的预览 / 提交。
const rows = reactive([])
let rowIdCounter = 0

// 过滤视图：'all' 看全部，'valid' 只看合法行，'invalid' 只看异常行。
// 完整原始行集合 rows 始终保留；筛选与分页都是在它之上派生的视图（筛选结果 →
// 当前页），翻页只切切片，不重建记录，勾选 / 错误信息 / 原始行号都不会丢。
const filterMode = ref('all')
const filteredRows = computed(() => {
  if (filterMode.value === 'valid') return rows.filter((row) => row.valid)
  if (filterMode.value === 'invalid') return rows.filter((row) => !row.valid)
  return rows
})

// ---- 预览分页 ----
// 分页只影响展示：单批 100 行上限、校验、统计、提交与错误报告仍基于完整批次。
// 默认 25 行/页，档位 25 / 50 / 100 复用共享 PaginationBar。
const DEFAULT_PAGE_SIZE = 25
const PAGE_SIZE_OPTIONS = [25, 50, 100]
const pageSize = ref(DEFAULT_PAGE_SIZE)
const page = ref(1)

const totalPages = computed(() => Math.max(1, Math.ceil(filteredRows.value.length / pageSize.value)))
// 渲染时的页码始终收敛到有效范围：重新校验 / 筛选 / 页大小变化导致当前页越界时
// 直接显示最后一页，而不是先闪出一个空页。
const currentPage = computed(() => {
  const value = Math.trunc(Number(page.value))
  const normalized = Number.isFinite(value) && value > 0 ? value : 1
  return Math.min(normalized, totalPages.value)
})
const pageRows = computed(() => {
  const start = (currentPage.value - 1) * pageSize.value
  return filteredRows.value.slice(start, start + pageSize.value)
})

const stats = computed(() => {
  const total = rows.length
  let valid = 0
  let selected = 0
  for (const row of rows) {
    if (row.valid) valid += 1
    if (row.selected) selected += 1
  }
  return { total, valid, invalid: total - valid, selected }
})

const allSelected = computed(() => {
  const validRows = rows.filter((row) => row.valid)
  return validRows.length > 0 && validRows.every((row) => row.selected)
})
const someSelected = computed(() => {
  const validRows = rows.filter((row) => row.valid)
  return validRows.some((row) => row.selected) && !allSelected.value
})

// ---- 拖拽上传 ----
const dragOver = ref(false)
const fileInputEl = ref(null)

function onDragOver(event) {
  event.preventDefault()
  dragOver.value = true
}
function onDragLeave(event) {
  event.preventDefault()
  dragOver.value = false
}
function onDrop(event) {
  event.preventDefault()
  dragOver.value = false
  const file = event.dataTransfer?.files?.[0]
  if (file) ingestFile(file)
}
function onFilePicked(event) {
  const file = event.target?.files?.[0]
  if (file) ingestFile(file)
  // 允许同名文件再次选择
  if (event.target) event.target.value = ''
}
function pickFile() {
  fileInputEl.value?.click()
}

async function ingestFile(file) {
  parseError.value = ''
  if (!file) return
  if (!/\.csv$/i.test(file.name)) {
    parseError.value = '请选择 .csv 文件（UTF-8 编码）。'
    return
  }
  if (file.size > MAX_FILE_SIZE) {
    parseError.value = `文件过大（${(file.size / 1024).toFixed(0)} KB），单个文件不能超过 2 MB，请拆成多个小批次。`
    return
  }
  let text = ''
  try {
    text = await file.text()
    // 无表头 CSV 的首列也会带 BOM；解析前统一去掉，避免姓名首字符变成 U+FEFF。
    text = text.replace(/^\uFEFF/, '')
  } catch (error) {
    parseError.value = formatUserError(error, { fallback: '读取文件失败，请重新选择文件。' })
    return
  }
  fileName.value = file.name
  fileSize.value = file.size
  selectedFile.value = file
  rawText.value = text
  // 新文件回到第 1 页，避免沿用上一份文件的页码 / 定位高亮。
  page.value = 1
  highlightedLineNo.value = 0
  rebuildRows()
  if (parseError.value) return
  if (!rows.length) {
    parseError.value = '文件为空或没有可识别的数据行。'
    return
  }
  step.value = 2
}

// 解析器把引号内的逗号、换行和双引号转义保留为字段内容，只在引号外把 CRLF/LF
// 视为记录边界。这里不做业务字段校验，解析后的每一行会在预览阶段独立标记错误，
// 避免单行脏数据让管理员失去检查其余记录的机会。
function parseCsv(text) {
  const records = []
  let record = []
  let field = ''
  let inQuote = false
  let quoteClosed = false
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    if (inQuote) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i += 1
        } else {
          inQuote = false
          quoteClosed = true
        }
      } else {
        field += ch
      }
      continue
    }
    if (quoteClosed) {
      if (ch !== ',' && ch !== '\r' && ch !== '\n' && ch !== ' ' && ch !== '\t') {
        throw new Error('发现引号后仍有未分隔的内容，请检查双引号是否成对出现')
      }
      if (ch === ',' || ch === '\r' || ch === '\n') quoteClosed = false
    }
    if (ch === '"' && !quoteClosed) {
      inQuote = true
    } else if (ch === ',') {
      record.push(field)
      field = ''
    } else if (ch === '\r' || ch === '\n') {
      record.push(field)
      field = ''
      if (record.some((col) => col.length > 0)) records.push(record)
      record = []
      // CRLF 是一个记录分隔符，消费 \r 后跳过紧随的 \n，避免生成空记录。
      if (ch === '\r' && text[i + 1] === '\n') i += 1
    } else {
      field += ch
    }
  }
  if (inQuote) throw new Error('存在未闭合的双引号，请检查 CSV 文件格式')
  // 文件可以不以换行结尾，循环结束后仍要提交最后一个字段和记录。
  if (field.length || record.length) {
    record.push(field)
    if (record.some((col) => col.length > 0)) records.push(record)
  }
  return records
}

const HEADER_ALIASES = {
  display_name: 'display_name',
  '姓名': 'display_name',
  '展示姓名': 'display_name',
  name: 'display_name',
  email: 'email',
  '邮箱': 'email',
  mail: 'email',
  mobile: 'mobile',
  '手机': 'mobile',
  '手机号': 'mobile',
  phone: 'mobile',
  status: 'status',
  '状态': 'status',
  application_roles: 'application_roles',
  '应用角色': 'application_roles',
  organization_name: 'organization_name',
  '组织': 'organization_name',
  '组织名称': 'organization_name',
  position_name: 'position_name',
  '岗位': 'position_name',
  '岗位名称': 'position_name',
  '岗位角色': 'application_roles',
  '角色': 'application_roles',
  roles: 'application_roles',
}

function normalizeHeader(value) {
  // Excel/下载样例通常会在 UTF-8 文件首字段前附加 BOM；不去除时“姓名”表头
  // 会被当成未知字段，整行随后会以数据行参与校验并最终触发 422。
  const key = String(value ?? '').replace(/^\uFEFF/, '').trim().toLowerCase()
  return HEADER_ALIASES[key] || key
}

function organizationId(item) {
  return String(item?.org_unit_id || item?.organization_id || item?.id || '').trim()
}

function getOrganizationName(item) {
  return String(item?.name || item?.org_unit_name || item?.organization_name || item?.code || '').trim()
}

function positionId(item) {
  return String(item?.position_id || item?.id || '').trim()
}

function getPositionName(item) {
  return String(item?.name || item?.position_name || item?.code || '').trim()
}

function positionOrganizationId(item) {
  return String(item?.org_unit_id || item?.organization_id || item?.org_unit?.id || item?.org_unit?.org_unit_id || '').trim()
}

function findOrganization(name) {
  return props.organizations.find((item) => getOrganizationName(item) === name)
}

function importedAccountName(displayName) {
  const value = pinyin(String(displayName || '').trim(), { toneType: 'none' })
    .toLowerCase()
    .replace(/[^a-z0-9\p{N}]+/gu, '')
  return value
}

function formatBatchError(error) {
  const issues = userFieldErrors(error?.details)
  return issues.length ? issues.map(issue => issue.message).join('；') : formatUserError(error, { fallback: '批量导入失败，请检查导入预检结果。' })
}

function rebuildRows() {
  // 重置状态
  rows.splice(0, rows.length)
  rowIdCounter = 0
  let records
  try {
    records = parseCsv(rawText.value)
  } catch (error) {
    parseError.value = formatUserError(error, { fallback: '文件内容无法解析，请使用下载的模板并检查格式。' })
    return
  }
  if (!records.length) {
    parseError.value = '文件为空或没有可识别的数据行。'
    return
  }

  // 表头检测：第一行若任意 cell 命中 HEADER_ALIASES，则视为表头。
  const firstRow = records[0]
  const hasHeader = firstRow.some((cell) => normalizeHeader(cell) in HEADER_ALIASES)
  let columnMap = { display_name: 0, email: 1, mobile: 2, status: 3, organization_name: 4, position_name: 5, application_roles: 6 }
  let dataStart = 0
  if (hasHeader) {
    columnMap = { display_name: -1, email: -1, mobile: -1, status: -1, organization_name: -1, position_name: -1, application_roles: -1 }
    firstRow.forEach((cell, idx) => {
      const key = normalizeHeader(cell)
      if (key in columnMap) columnMap[key] = idx
    })
    if (columnMap.display_name < 0) {
      parseError.value = '表头缺少“姓名 / display_name”列。'
      return
    }
    dataStart = 1
  }

  for (let i = dataStart; i < records.length; i += 1) {
    const cells = records[i]
    const lineNo = i + 1
    const row = makeRow(cells, columnMap, lineNo)
    rows.push(row)
  }

  // 后端会按姓名生成登录账号；提前标记本批次内可能生成同名全拼账号的行，
  // 避免等到数据库唯一约束处才整批回滚。
  const accountOwners = new Map()
  for (const row of rows) {
    const accountKey = importedAccountName(row.displayName)
    if (!accountKey) continue
    const previous = accountOwners.get(accountKey)
    if (previous) {
      row.errors.push(`账号名可能重复（姓名全拼冲突）：与第 ${previous.lineNo} 行重复`)
      row.valid = false
      row.selected = false
      previous.errors.push(`账号名可能重复（姓名全拼冲突）：与第 ${row.lineNo} 行重复`)
      previous.valid = false
      previous.selected = false
    } else {
      accountOwners.set(accountKey, row)
    }
  }

  if (rows.length > BATCH_LIMIT) {
    // 超过上限保留解析结果但阻止提交，避免一次性 500。
    parseError.value = `共解析出 ${rows.length} 行，超过单次 ${BATCH_LIMIT} 上限；请拆分文件后重试。`
  }
  // 记录集变化后立即收敛页码（重新校验 / 换文件都可能让行数变少并被当前页剔除），
  // 保证渲染前 page 本身就在有效范围内，不会出现空白页。
  page.value = Math.min(Math.max(1, page.value), totalPages.value)
  // 记录本次预览使用的目录签名，用于识别“预览后又有人改了组织 / 岗位”。
  previewCatalogSignature.value = catalogsSignature()
}

function pickColumn(cells, index) {
  if (index < 0) return ''
  return String(cells[index] ?? '').trim()
}

function makeRow(cells, columnMap, lineNo) {
  const displayName = pickColumn(cells, columnMap.display_name)
  const email = pickColumn(cells, columnMap.email)
  const mobile = pickColumn(cells, columnMap.mobile)
  const rawStatus = pickColumn(cells, columnMap.status)
  const normalizedStatus = rawStatus.toUpperCase()
  const status = STATUS_ALIASES.get(rawStatus) || STATUS_ALIASES.get(normalizedStatus) || 'ACTIVE'
  const organizationName = pickColumn(cells, columnMap.organization_name)
  const positionName = pickColumn(cells, columnMap.position_name)
  const rawApplicationRoles = pickColumn(cells, columnMap.application_roles)
  const applicationRoles = []

  const errors = []
  if (!displayName) errors.push('姓名必填')
  else if (Array.from(displayName).length > 100) errors.push('姓名不能超过 100 个字符')

  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push('邮箱格式不正确')

  if (mobile) {
    if (Array.from(mobile).length > 32) errors.push('手机号不能超过 32 个字符')
    else if (!/^\+?\d+$/.test(mobile.replace(/[\s-]/g, ''))) errors.push('手机号只能包含数字 / 空格 / 连字符 / 开头的加号')
  }

  if (rawStatus && !STATUS_ALIASES.has(rawStatus) && !ACCEPTED_STATUSES.has(normalizedStatus)) {
    errors.push('状态只能填写“启用”或“停用”')
  }

  if (!organizationName) errors.push('组织必填，请填写组织中文名称')
  if (!positionName) errors.push('岗位必填，请填写岗位中文名称')
  const organization = organizationName ? findOrganization(organizationName) : null
  if (organizationName && props.organizations.length && !organization) {
    errors.push(`组织不存在：${organizationName}`)
  }
  if (positionName && props.positions.length && !props.positions.some((item) => getPositionName(item) === positionName && (!organizationName || positionOrganizationId(item) === organizationId(organization)))) {
    errors.push(`岗位不存在或不属于组织：${positionName}`)
  }

  if (rawApplicationRoles) {
    const parsedRoles = parseApplicationRoles(rawApplicationRoles)
    applicationRoles.push(...parsedRoles.roles)
    errors.push(...parsedRoles.errors)
  }

  // 标记字段过多的行（不抛错，避免打断预览）
  const expectedColumns = Math.max(...Object.values(columnMap).filter((value) => value >= 0), 3) + 1
  const overflow = cells.length > expectedColumns
  if (overflow) errors.push(`字段过多（${cells.length} 列）`)

  return {
    id: ++rowIdCounter,
    lineNo,
    displayName,
    email,
    mobile,
    status,
    organizationName,
    positionName,
    rawApplicationRoles,
    applicationRoles,
    // 应用角色为空时由岗位授权模板提供子系统角色；填写后作为用户级个人例外追加。
    authorizationSource: rawApplicationRoles ? '岗位模板 + 个人例外' : '岗位授权模板',
    valid: errors.length === 0,
    errors,
    selected: errors.length === 0, // 默认勾选合法行
    submitStatus: '', // 'success' | 'failed'
    submitMessage: '',
  }
}


// ---- 选中控制 ----
// 表头全选 / 反选 / 仅选合法行都遍历完整 rows（而不是当前页或当前筛选），
// 因此勾选状态跨筛选、跨页保留，语义始终是「全部有效行」。
function toggleAll(value) {
  for (const row of rows) {
    if (row.valid) row.selected = Boolean(value)
  }
}
function selectAll() { toggleAll(true) }
function invertSelection() {
  for (const row of rows) {
    if (row.valid) row.selected = !row.selected
  }
}
function selectValidOnly() {
  for (const row of rows) row.selected = row.valid
}

const selectedValidRows = computed(() => rows.filter((row) => row.selected && row.valid))

// ---- 分页交互 ----
// 筛选变化必须回到第 1 页：旧页码在新结果集里没有意义。这里用手写 handler 而不是
// watch(filterMode)：错误定位会临时把筛选切回「全部」并直接跳到目标行所在页，
// watch 的异步复位会把定位页码覆盖回第 1 页。
function changeFilter(next) {
  filterMode.value = next === 'valid' || next === 'invalid' ? next : 'all'
  page.value = 1
}

function changePageSize(next) {
  const value = Math.trunc(Number(next))
  if (!Number.isFinite(value) || value <= 0) return
  pageSize.value = value
  page.value = 1
}

// ---- 错误定位（跨页） ----
// 服务端逐行问题只带 CSV 行号，目标行可能不在当前页，也可能被当前筛选隐藏。
// 定位流程：必要时切回「全部」→ 求该行在筛选结果里的下标 → 切到所在页 →
// 高亮并滚动到原始行（scrollIntoView + 1.6s 高亮，沿用既有定位反馈的时长）。
const tableWrapEl = ref(null)
const highlightedLineNo = ref(0)
let locateHighlightTimer = null
onBeforeUnmount(() => {
  if (locateHighlightTimer) clearTimeout(locateHighlightTimer)
})

function scrollToLine(lineNo) {
  const wrap = tableWrapEl.value
  if (!wrap || typeof wrap.querySelector !== 'function') return
  const target = wrap.querySelector(`[data-line="${lineNo}"]`)
  if (target && typeof target.scrollIntoView === 'function') {
    target.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }
}

function locateLine(lineNo) {
  const target = Math.trunc(Number(lineNo))
  if (!Number.isFinite(target)) return
  let index = filteredRows.value.findIndex((row) => row.lineNo === target)
  if (index < 0) {
    // 目标行被当前筛选隐藏时先恢复「全部」，否则定位会静默失败。
    filterMode.value = 'all'
    index = filteredRows.value.findIndex((row) => row.lineNo === target)
  }
  if (index < 0) return
  page.value = Math.floor(index / pageSize.value) + 1
  highlightedLineNo.value = target
  if (locateHighlightTimer) clearTimeout(locateHighlightTimer)
  locateHighlightTimer = setTimeout(() => { highlightedLineNo.value = 0 }, 1600)
  // Node（测试 / SSR）里 setTimeout 没有 unref，浏览器里也不存在该属性，统一可选调用。
  locateHighlightTimer?.unref?.()
  nextTick(() => scrollToLine(target))
}


// ---- 样例 CSV ----
const SAMPLE_CSV = '姓名,邮箱,手机号,状态,组织,岗位,应用角色\n张三,zhang.san@example.com,13800000000,启用,华东事业部,销售经理,\n李四,,13900000000,启用,华东事业部,项目经理,\n王五,wang.wu@example.com,,启用,华南事业部,技术顾问,\n赵六,zhao.liu@example.com,13500000000,停用,华东事业部,合同专员,合同管理系统：审计管理员\n'

function downloadSample() {
  // 加上 UTF-8 BOM，方便 Excel 直接打开不乱码。
  const blob = new Blob(['\uFEFF', SAMPLE_CSV], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = '用户批量导入模板.csv'
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

// ---- 目录一致性 ----
//
// 预览阶段的行校验依赖组织 / 岗位目录。目录在其他入口变化后，之前判定“合法”的行
// 可能已经失效（组织改名或岗位停用）。这里用目录签名判断预览是否过期：过期后立即
// 重新核验并按行号保留勾选，未确认目录时禁止提交；已选择的文件不会被清空。
const catalogNotice = ref('')
const previewCatalogSignature = ref('')

function catalogsSignature() {
  const organizations = props.organizations
    .map((item) => `${organizationId(item)}:${getOrganizationName(item)}`)
    .sort()
    .join('|')
  const positions = props.positions
    .map((item) => `${positionId(item)}:${getPositionName(item)}:${positionOrganizationId(item)}`)
    .sort()
    .join('|')
  return `${organizations}##${positions}`
}

const previewStale = computed(() => rows.length > 0 && previewCatalogSignature.value !== catalogsSignature())

function revalidatePreview() {
  if (!rows.length) return
  // 只按行号恢复用户**当时的**勾选状态：重新解析会把合法行默认勾上，
  // 若只做"补勾"而不取消，用户手动取消勾选的行会在目录变化后被重新勾上并提交。
  const selectedLineNos = new Set(rows.filter((row) => row.selected).map((row) => row.lineNo))
  rebuildRows()
  restoreRowSelection(rows, selectedLineNos)
  previewCatalogSignature.value = catalogsSignature()
  catalogNotice.value = '组织或岗位目录已更新，已按最新目录重新核验预览；请确认勾选结果后再提交。'
}

watch(() => catalogsSignature(), () => {
  if (step.value !== 2 || !rows.length) return
  revalidatePreview()
})

// ---- 提交 ----
async function submit() {
  if (submitting.value) return
  if (props.catalogsLoading) {
    submitError.value = '正在读取最新组织与岗位目录，请稍候再提交。'
    return
  }
  if (props.catalogsError) {
    submitError.value = `关联目录尚未确认：${props.catalogsError}`
    return
  }
  if (previewStale.value) {
    revalidatePreview()
    submitError.value = '提交前发现组织或岗位目录已变化，已重新核验预览；请确认结果后再次提交。'
    return
  }
  const items = selectedValidRows.value
  // 分页只影响展示：批次上限仍按文件解析出的完整行数判断，不能靠翻页 / 勾选
  // 当前页来绕过 100 行限制（按钮已禁用，这里再做一次兜底）。
  if (rows.length > BATCH_LIMIT) {
    submitError.value = `当前文件共 ${rows.length} 行，超过单次 ${BATCH_LIMIT} 行上限；请拆分文件后重试。`
    return
  }
  if (!items.length) {
    submitError.value = '请至少勾选 1 行合法数据。'
    return
  }
  if (items.length > BATCH_LIMIT) {
    submitError.value = `单次最多 ${BATCH_LIMIT} 条，当前勾选 ${items.length} 条。`
    return
  }
  submitError.value = ''
  submitIssues.value = []
  submitting.value = true
  try {
    const payload = items.map((row) => ({
      displayName: row.displayName,
      email: row.email || null,
      mobile: row.mobile || null,
      status: row.status || 'ACTIVE',
      organizationName: row.organizationName,
      positionName: row.positionName,
      applicationRoles: row.applicationRoles,
      lineNo: row.lineNo,
    }))
    const result = await createEmployeesBatch(payload, selectedFile.value)
    const created = Array.isArray(result?.items) ? result.items : []
    const createdByLineNo = new Map()
    for (const item of created) {
      if (item && (item.line_no || item.lineNo)) {
        createdByLineNo.set(Number(item.line_no || item.lineNo), item)
      }
    }
    // 后端当前是全量提交/全量回滚。只有返回数量与请求数量一致时才显示全部成功；
    // 若服务端将来提供 line_no，则按行展示，避免前端无条件误报成功。
    const batchSucceeded = created.length === items.length
    for (const row of items) {
      if (createdByLineNo.size > 0) {
        row.submitStatus = createdByLineNo.has(row.lineNo) ? 'success' : 'failed'
        row.submitMessage = row.submitStatus === 'failed' ? '服务端未返回该行的创建结果' : ''
      } else {
        row.submitStatus = batchSucceeded ? 'success' : 'failed'
        row.submitMessage = batchSucceeded ? '' : '服务端返回的创建数量与提交数量不一致'
      }
    }
    const failedCount = items.filter((row) => row.submitStatus === 'failed').length
    const initialCredentials = initialCredentialsForImport(result, created.length)
    clearInitialCredentials(submitResult.value)
    credentialsVisible.value = false
    submitResult.value = {
      createdCount: created.length,
      requestedCount: items.length,
      failedCount,
      failures: items.filter((row) => row.submitStatus === 'failed').map((row) => ({ lineNo: row.lineNo, message: row.submitMessage })),
      initialCredentials: initialCredentials || [],
      credentialsUnavailable: initialCredentials === null,
    }
    step.value = 3
    emit('toast', failedCount ? `批量导入返回异常：成功 ${created.length} 条，失败 ${failedCount} 条。` : `已批量创建 ${created.length} 位用户。`)
    if (!failedCount) emit('completed', { createdCount: created.length })
  } catch (error) {
    // 422 batchValidation 会带回整批逐行问题：保留完整清单，页面上展示可读摘要，
    // 并允许下载错误报告后按行修正 CSV。整批原子语义不变——这些行一条都没有写入。
    const issues = importIssuesFromError(error)
    submitIssues.value = issues
    submitError.value = issues.length
      ? `本次导入未写入任何数据：服务端返回 ${issues.length} 条问题，请按行修正后重新导入（可下载错误报告）。`
      : formatBatchError(error)
    emit('toast', submitError.value)
  } finally {
    submitting.value = false
  }
}

// ---- 关闭 ----
async function close() {
  if (submitting.value) return
  if (step.value >= 2) {
    const credentialsPending = step.value === 3 && submitResult.value?.initialCredentials?.length
    const ok = await askConfirm({
      title: credentialsPending ? '关闭并放弃初始凭据？' : '关闭导入？',
      description: credentialsPending
        ? '初始密码只显示这一次，关闭后无法从系统再次查看。请先下载初始凭据，确认无误后再关闭。'
        : '当前导入还没有完成。关闭后本次已选择或填写的内容不会保留。',
      confirmText: credentialsPending ? '仍然关闭' : '放弃导入',
      cancelText: credentialsPending ? '返回查看凭据' : '继续导入',
      danger: true,
    })
    if (!ok) return
  }
  clearInitialCredentials(submitResult.value)
  credentialsVisible.value = false
  emit('close')
}
async function onBackdropClick() {
  await close()
}
async function onKeydown(event) {
  if (event?.key === 'Escape' && !submitting.value) {
    event.stopPropagation()
    await close()
  }
}
function restart() {
  if (submitting.value) return
  clearInitialCredentials(submitResult.value)
  credentialsVisible.value = false
  // 回到第一步重置
  step.value = 1
  rows.splice(0, rows.length)
  rawText.value = ''
  selectedFile.value = null
  fileName.value = ''
  fileSize.value = 0
  parseError.value = ''
  submitError.value = ''
  submitIssues.value = []
  submitResult.value = null
  filterMode.value = 'all'
  page.value = 1
  pageSize.value = DEFAULT_PAGE_SIZE
  highlightedLineNo.value = 0
  catalogNotice.value = ''
  previewCatalogSignature.value = ''
}

// 错误报告：UTF-8 BOM + CRLF + 公式前缀中和（见 iam/utils/batchImportIssues.js），
// 下载后可直接用 Excel 按“行号”对照 CSV 修正。无 issues 时按钮禁用，这里再做一次
// 兜底返回，避免下载空文件冒充“有报告”。
function downloadIssueReport() {
  if (!submitIssues.value.length) return
  const blob = new Blob([batchImportIssueCsv(submitIssues.value)], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  try {
    link.href = url
    link.download = IMPORT_ISSUE_CSV_FILENAME
    document.body.appendChild(link)
    link.click()
  } finally {
    link.remove()
    URL.revokeObjectURL(url)
  }
}

function downloadInitialCredentials() {
  const credentials = submitResult.value?.initialCredentials
  if (!credentials?.length) return
  const blob = new Blob([initialCredentialsDocument(credentials)], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  try {
    link.href = url
    link.download = '员工初始登录凭据.json'
    document.body.appendChild(link)
    link.click()
  } finally {
    link.remove()
    URL.revokeObjectURL(url)
  }
}

function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}
</script>

<template>
  <div class="iam-modal-backdrop" role="presentation" @click.self="onBackdropClick" @keydown="onKeydown">
    <section class="iam-modal iam-batch-import-modal" role="dialog" aria-modal="true" aria-label="批量导入用户">
      <header>
        <div class="iam-batch-import-heading">
          <span class="iam-batch-import-heading-icon"><ConsoleIcon name="user" /></span>
          <div>
            <p>用户目录 · 批量创建</p>
            <h3>从 CSV 导入用户</h3>
            <small>上传文件后先校验数据，确认无误再写入用户目录</small>
          </div>
        </div>
        <button class="console-modal-close" type="button" aria-label="关闭批量导入" :disabled="submitting" @click="close">
          <ConsoleIcon name="close" />
        </button>
      </header>

      <ol class="iam-batch-import-steps" aria-label="批量导入步骤">
        <li :class="{ active: step === 1, done: step > 1 }"><b>1</b><span>上传 CSV</span></li>
        <li :class="{ active: step === 2, done: step > 2 }"><b>2</b><span>校验预览</span></li>
        <li :class="{ active: step === 3 }"><b>3</b><span>提交结果</span></li>
      </ol>

      <!-- 步骤 1：上传 CSV -->
      <div v-if="step === 1" class="iam-batch-import-body">
        <p class="iam-form-alert iam-batch-import-guide">
          <ConsoleIcon name="info" />
          <span>表头使用“姓名、邮箱、手机号、状态、组织、岗位、应用角色”。组织和岗位必须填写系统中的中文名称；应用角色仅用于个人例外，可留空，留空时自动继承所选岗位的授权模板。单次最多 {{ BATCH_LIMIT }} 行。</span>
        </p>

        <div
          class="iam-batch-import-dropzone"
          :class="{ over: dragOver }"
          role="button"
          tabindex="0"
          aria-label="点击或拖拽上传 CSV 文件"
          @click="pickFile"
          @keydown.enter.prevent="pickFile"
          @keydown.space.prevent="pickFile"
          @dragover="onDragOver"
          @dragleave="onDragLeave"
          @drop="onDrop"
        >
          <span class="iam-batch-import-upload-icon"><ConsoleIcon name="download" /></span>
          <strong>拖拽 CSV 文件到此处</strong>
          <small>或者 <b>点击选择文件</b> · 仅支持 UTF-8 编码的 <code>.csv</code></small>
          <em>解析失败的行会单独标记，不影响其他有效数据</em>
        </div>

        <input
          ref="fileInputEl"
          type="file"
          accept=".csv,text/csv"
          hidden
          @change="onFilePicked"
        />

        <div v-if="parseError" class="iam-batch-import-error" role="alert">{{ parseError }}</div>

        <div class="iam-batch-import-sample">
          <div class="iam-batch-import-sample-copy">
            <span class="iam-batch-import-sample-title"><ConsoleIcon name="info" /><strong>文件格式示例</strong></span>
            <p>姓名、组织、岗位必填。组织和岗位填写中文名称；个人例外角色填写“应用名称：角色名称”，多个角色用“|”分隔。日常岗位角色由岗位授权模板自动继承。</p>
            <pre><code>{{ SAMPLE_CSV }}</code></pre>
          </div>
          <button class="console-button ghost small" type="button" @click="downloadSample">
            <ConsoleIcon name="download" />下载样例 CSV
          </button>
        </div>
      </div>

      <!-- 步骤 2：预览 / 校验 -->
      <div v-else-if="step === 2" class="iam-batch-import-body">
        <p v-if="catalogsLoading" class="iam-form-alert" role="status"><ConsoleIcon name="info" />正在读取最新组织与岗位目录…读取完成前不能提交导入，避免按过期目录校验行数据。</p>
        <p v-else-if="catalogsError" class="iam-batch-import-error" role="alert">关联目录读取失败：{{ catalogsError }}。请回到“身份、组织与授权”页面重试读取后再导入。</p>
        <p v-if="catalogNotice" class="iam-form-alert" role="status">{{ catalogNotice }}</p>
        <div class="iam-batch-import-summary">
          <div class="iam-batch-import-file">
            <span><ConsoleIcon name="download" /></span>
            <div>
            <strong>{{ fileName }}</strong>
            <small>{{ formatFileSize(fileSize) }} · 共 {{ stats.total }} 行</small>
            </div>
          </div>
          <div class="iam-batch-import-stats">
            <span class="stat valid"><b>{{ stats.valid }}</b><small>合法</small></span>
            <span class="stat invalid"><b>{{ stats.invalid }}</b><small>异常</small></span>
            <span class="stat selected"><b>{{ stats.selected }}</b><small>已勾选</small></span>
          </div>
        </div>

        <div class="iam-batch-import-toolbar">
          <div class="iam-batch-import-toolbar-left">
            <button class="console-button ghost small" type="button" :disabled="!rows.length" @click="selectAll">全选</button>
            <button class="console-button ghost small" type="button" :disabled="!rows.length" @click="invertSelection">反选</button>
            <button class="console-button ghost small" type="button" :disabled="!rows.length" @click="selectValidOnly">仅选合法行</button>
          </div>
          <div class="iam-batch-import-toolbar-right">
            <label class="iam-batch-import-filter">
              <span>筛选</span>
              <select :value="filterMode" @change="changeFilter($event.target.value)">
                <option value="all">全部（{{ stats.total }}）</option>
                <option value="valid">仅合法（{{ stats.valid }}）</option>
                <option value="invalid">仅异常（{{ stats.invalid }}）</option>
              </select>
            </label>
            <button class="console-button ghost small" type="button" @click="restart">
              <ConsoleIcon name="reset" />重新上传
            </button>
          </div>
        </div>

        <div class="iam-batch-import-role-notice" role="status">
          <span class="iam-batch-import-role-notice-icon"><ConsoleIcon name="shield" /></span>
          <div>
            <strong>权限继承规则</strong>
            <p>应用角色留空：按所选岗位的授权模板继承子系统角色；填写应用角色：在岗位模板角色之外追加用户级个人例外，不会覆盖岗位模板。</p>
          </div>
        </div>

        <div v-if="parseError" class="iam-batch-import-error" role="alert">{{ parseError }}</div>

        <!-- 提交失败的整批逐行问题：一行一条，可下载完整错误报告按行修正 CSV。 -->
        <div v-if="submitError" class="iam-batch-import-error iam-batch-import-submit-error" role="alert">
          <div class="iam-batch-import-submit-error-head">
            <ConsoleIcon name="info" />
            <p>{{ submitError }}</p>
          </div>
          <div v-if="submitIssues.length" class="iam-batch-import-issue-report">
            <ul class="iam-batch-import-issue-list">
              <li v-for="issue in visibleSubmitIssues" :key="`${issue.row}-${issue.field}-${issue.code}-${issue.message}`">
                <button
                  v-if="issue.row > 0"
                  type="button"
                  class="issue-row issue-locate"
                  :title="`定位到第 ${issue.row} 行`"
                  @click="locateLine(issue.row)"
                >第 {{ issue.row }} 行</button>
                <span v-else class="issue-row">整批问题</span>
                <span v-if="issue.field" class="issue-field">{{ issue.field }}</span>
                <span class="issue-message">{{ issue.message || issue.code }}</span>
              </li>
            </ul>
            <small v-if="submitIssues.length > ISSUE_PREVIEW_LIMIT">仅显示前 {{ ISSUE_PREVIEW_LIMIT }} 条，共 {{ submitIssues.length }} 条；完整清单请下载错误报告。</small>
          </div>
          <div class="iam-batch-import-issue-actions">
            <button
              class="console-button ghost small"
              type="button"
              :disabled="!submitIssues.length"
              @click="downloadIssueReport"
            >
              <ConsoleIcon name="download" />下载错误报告 CSV
            </button>
            <small v-if="!submitIssues.length">服务端未返回逐行问题，当前没有可下载的错误清单。</small>
          </div>
        </div>

        <div ref="tableWrapEl" class="iam-batch-import-table-wrap">
          <BatchUserImportPreviewTable
            :rows="pageRows"
            :all-selected="allSelected"
            :some-selected="someSelected"
            :has-rows="rows.length > 0"
            :highlighted-line-no="highlightedLineNo"
            empty-text="当前筛选下没有数据行。"
            @toggle-all="toggleAll"
          />
        </div>
        <div class="iam-batch-import-pagination">
          <p v-if="filteredRows.length > pageSize" class="iam-batch-import-page-note">
            分页只影响显示：统计、校验与提交始终基于完整批次的 {{ stats.total }} 行；表头全选覆盖全部有效行（跨筛选、跨页）。
          </p>
          <PaginationBar
            :page="currentPage"
            :total="filteredRows.length"
            :page-size="pageSize"
            :page-size-options="PAGE_SIZE_OPTIONS"
            label="导入预览分页"
            :disabled="submitting"
            @change="page = $event"
            @change-page-size="changePageSize"
          />
        </div>
      </div>

      <!-- 步骤 3：结果 -->
      <div v-else class="iam-batch-import-body">
        <div v-if="submitResult" class="iam-batch-import-result">
          <span class="iam-batch-import-result-icon" :class="submitResult.failedCount ? 'danger' : 'success'"><ConsoleIcon :name="submitResult.failedCount ? 'info' : 'save'" /></span>
          <h4>{{ submitResult.failedCount ? '用户导入结果异常' : '用户导入完成' }}</h4>
          <p class="iam-form-alert" :class="submitResult.failedCount ? 'danger' : 'success'">
            <ConsoleIcon :name="submitResult.failedCount ? 'info' : 'save'" />
            成功导入 <b>{{ submitResult.createdCount }}</b> / {{ submitResult.requestedCount }} 位用户
            <template v-if="submitResult.failedCount">，失败 {{ submitResult.failedCount }} 位，请检查结果列后重试。</template>
            <template v-else>。系统已自动创建用户名全拼账号、初始密码、员工编号、组织岗位任职、基础平台“普通用户”角色；CSV 中非空的应用角色按个人例外授权处理并更新授权版本。</template>
          </p>
          <p v-if="submitResult.credentialsUnavailable" class="iam-form-alert danger" role="alert">账号已创建，但响应未包含完整初始凭据。请在账号管理中重置密码，不要重复导入这些用户。</p>
          <template v-else>
            <p class="iam-field-help">每个账号使用独立的随机初始密码，首次登录必须修改。请在关闭页面前下载并安全交付凭据；关闭后无法从此结果页再次取得。</p>
            <div class="iam-batch-credential-actions">
              <button class="console-button ghost small" type="button" :aria-pressed="credentialsVisible" @click="credentialsVisible = !credentialsVisible">{{ credentialsVisible ? '隐藏初始密码' : '显示初始密码' }}</button>
              <button class="console-button primary small" type="button" @click="downloadInitialCredentials">下载初始凭据</button>
            </div>
            <div class="iam-batch-import-table-wrap">
              <table class="iam-batch-import-table">
                <thead><tr><th>用户名</th><th>初始密码</th></tr></thead>
                <tbody><tr v-for="credential in submitResult.initialCredentials" :key="credential.accountName">
                  <td>{{ credential.accountName }}</td>
                  <td><input :type="credentialsVisible ? 'text' : 'password'" :value="credential.initialPassword" readonly autocomplete="off" :aria-label="`${credential.accountName} 的初始密码`" /></td>
                </tr></tbody>
              </table>
            </div>
          </template>
        </div>
        <div v-else class="iam-batch-import-result">
          <span class="iam-batch-import-result-icon danger"><ConsoleIcon name="info" /></span>
          <h4>没有可展示的导入结果</h4>
          <p class="iam-form-alert danger">
            <ConsoleIcon name="info" />本次未提交任何数据。
          </p>
        </div>
      </div>

      <footer>
        <template v-if="step === 1">
          <button class="console-button ghost" type="button" @click="close">取消</button>
        </template>
        <template v-else-if="step === 2">
          <button class="console-button ghost" type="button" :disabled="submitting" @click="restart">重新上传</button>
          <button class="console-button ghost" type="button" :disabled="submitting" @click="close">取消</button>
          <button
            class="console-button primary"
            type="button"
            :disabled="submitting || !selectedValidRows.length || rows.length > BATCH_LIMIT || catalogsLoading || Boolean(catalogsError) || previewStale"
            @click="submit"
          >
            <ConsoleIcon name="save" />
            {{ submitting ? '提交中…' : `提交 ${selectedValidRows.length} 行` }}
          </button>
        </template>
        <template v-else>
          <button class="console-button ghost" type="button" @click="restart">再导一批</button>
          <button class="console-button primary" type="button" @click="close">关闭导入结果</button>
        </template>
      </footer>
    </section>
    <ConfirmDialog
      :open="Boolean(closeConfirm)"
      v-bind="closeConfirm || {}"
      @confirm="acceptClose"
      @cancel="cancelClose"
    />
  </div>
</template>

<style scoped>
.iam-batch-import-modal {
  width: min(1040px, 100%);
  max-height: min(900px, calc(100vh - 40px));
  overflow: hidden;
  border-color: #dce5f1;
  background: #fff;
}

.iam-batch-import-modal > header {
  align-items: center;
  padding: 24px 28px;
  background: linear-gradient(135deg, #fff 0%, #f8fbff 72%, #eef5ff 100%);
}

.iam-batch-import-heading {
  display: flex;
  align-items: center;
  gap: 14px;
}

.iam-batch-import-heading-icon {
  display: grid;
  width: 44px;
  height: 44px;
  flex: 0 0 auto;
  place-items: center;
  color: #fff;
  border-radius: 12px;
  background: linear-gradient(145deg, var(--brand-3, #3b82f6), var(--brand-1, #1e40af));
  box-shadow: 0 10px 24px rgba(37, 99, 235, .22);
}

.iam-batch-import-heading-icon svg { width: 22px; height: 22px; }
.iam-batch-import-heading h3 { margin-top: 4px; }
.iam-batch-import-heading small {
  display: block;
  margin-top: 5px;
  color: var(--ink-3, #475569);
  font-size: 12px;
  line-height: 1.5;
}

.iam-batch-import-steps {
  list-style: none;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  align-items: center;
  gap: 0;
  margin: 0;
  padding: 20px 28px 18px;
  color: var(--ink-4, #94a3b8);
  font-size: 12.5px;
  border-bottom: 1px solid var(--line-2, #eef0f4);
  background: #fff;
}
.iam-batch-import-steps li {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
}
.iam-batch-import-steps li:not(:last-child)::after {
  content: '';
  height: 1px;
  flex: 1;
  margin: 0 14px 0 6px;
  background: var(--line-1, #e6e9ef);
}
.iam-batch-import-steps li.done:not(:last-child)::after { background: #93b4f8; }
.iam-batch-import-steps li b {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  flex: 0 0 auto;
  border-radius: 999px;
  border: 1px solid var(--line-1, #e6e9ef);
  background: var(--bg-soft, #fafbfd);
  color: var(--ink-4, #94a3b8);
  font-size: 12px;
  font-weight: 700;
}
.iam-batch-import-steps li.active b {
  background: var(--brand-1, #2563eb);
  border-color: var(--brand-1, #2563eb);
  color: #fff;
  box-shadow: 0 0 0 4px rgba(37, 99, 235, .1);
}
.iam-batch-import-steps li.done b {
  color: var(--brand-1, #1e40af);
  border-color: #bfdbfe;
  background: var(--brand-soft, #eff6ff);
}
.iam-batch-import-steps li.active { color: var(--ink-1, #111827); }

.iam-batch-import-body {
  min-height: 0;
  max-height: calc(100vh - 275px);
  padding: 24px 28px 6px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  overflow: auto;
}

.iam-batch-import-guide {
  align-items: center;
  padding: 12px 14px;
  color: #3f5574;
  border-color: #dbe7f7;
  background: #f6f9fe;
}

.iam-batch-import-guide code { white-space: nowrap; }

.iam-batch-import-guide > svg {
  width: 18px;
  height: 18px;
}

.iam-batch-import-dropzone {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 9px;
  min-height: 210px;
  padding: 34px 24px;
  border: 1.5px dashed #b9cce7;
  border-radius: 14px;
  background: linear-gradient(180deg, #fbfdff 0%, #f5f8fd 100%);
  color: var(--ink-2, #374151);
  cursor: pointer;
  transition: border-color 160ms, background 160ms, box-shadow 160ms, transform 160ms;
}
.iam-batch-import-dropzone:hover,
.iam-batch-import-dropzone:focus,
.iam-batch-import-dropzone.over {
  border-color: var(--brand-1, #2563eb);
  background: var(--brand-soft, #eef4ff);
  outline: none;
  box-shadow: inset 0 0 0 1px rgba(37, 99, 235, .08), 0 10px 30px rgba(37, 99, 235, .07);
  transform: translateY(-1px);
}
.iam-batch-import-upload-icon {
  display: grid;
  width: 52px;
  height: 52px;
  margin-bottom: 4px;
  place-items: center;
  color: var(--brand-2, #2563eb);
  border: 1px solid #d5e3fb;
  border-radius: 14px;
  background: #fff;
  box-shadow: 0 8px 22px rgba(37, 99, 235, .12);
}
.iam-batch-import-upload-icon svg { width: 25px; height: 25px; }
.iam-batch-import-dropzone strong { color: var(--ink-1, #0a0f1c); font-size: 15px; }
.iam-batch-import-dropzone small { color: var(--ink-3, #475569); font-size: 12.5px; }
.iam-batch-import-dropzone small b { color: var(--brand-2, #2563eb); font-weight: 600; }
.iam-batch-import-dropzone em { color: var(--ink-4, #94a3b8); font-size: 11.5px; font-style: normal; }
.iam-batch-import-dropzone code {
  background: #fff;
  border: 1px solid #dce5f1;
  border-radius: 6px;
  padding: 0 4px;
  font-size: 11.5px;
}

.iam-batch-import-error {
  background: var(--danger-soft, #fef2f2);
  border: 1px solid #fecaca;
  color: #b91c1c;
  padding: 12px 14px;
  border-radius: 10px;
  font-size: 13px;
}

.iam-batch-import-submit-error { display: flex; flex-direction: column; gap: 10px; }
.iam-batch-import-submit-error-head { display: flex; align-items: flex-start; gap: 8px; }
.iam-batch-import-submit-error-head svg { width: 16px; height: 16px; flex: 0 0 auto; margin-top: 2px; }
.iam-batch-import-submit-error-head p { margin: 0; line-height: 1.55; }
.iam-batch-import-issue-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 220px;
  overflow: auto;
}
.iam-batch-import-issue-list li {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 6px;
  padding: 6px 9px;
  border-radius: 8px;
  background: var(--surface-raised, #fff);
  border: 1px solid var(--danger-border, #fecaca);
  color: var(--ink-2, #374151);
  font-size: 12px;
}
.iam-batch-import-issue-list .issue-row { flex: 0 0 auto; font-weight: 600; color: var(--danger-text, #b91c1c); }
/* 行号是可点的定位入口：点击后切到该行所在页并高亮原始行（按钮样式贴合文本）。 */
.iam-batch-import-issue-list button.issue-row {
  padding: 0;
  border: 0;
  background: none;
  font: inherit;
  font-weight: 600;
  color: var(--danger-text, #b91c1c);
  text-decoration: underline dotted;
  cursor: pointer;
}
.iam-batch-import-issue-list button.issue-row:hover { text-decoration-style: solid; }
.iam-batch-import-issue-list button.issue-row:focus-visible { outline: 2px solid var(--danger-text, #b91c1c); outline-offset: 2px; }
.iam-batch-import-issue-list .issue-field { flex: 0 0 auto; color: var(--ink-3, #6b7280); }
.iam-batch-import-issue-list .issue-message { flex: 1 1 220px; min-width: 0; overflow-wrap: anywhere; }
.iam-batch-import-issue-report small { display: block; margin-top: 6px; color: var(--ink-3, #6b7280); font-size: 11.5px; }
.iam-batch-import-issue-actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.iam-batch-import-issue-actions small { color: var(--ink-3, #6b7280); font-size: 11.5px; }

.iam-batch-import-sample {
  display: flex;
  gap: 20px;
  align-items: flex-start;
  padding: 16px 18px;
  background: var(--bg-soft, #fafbfd);
  border: 1px solid var(--line-1, #e6e9ef);
  border-radius: 12px;
}
.iam-batch-import-sample-copy { min-width: 0; flex: 1; }
.iam-batch-import-sample-title { display: flex; align-items: center; gap: 7px; }
.iam-batch-import-sample-title svg { width: 16px; height: 16px; color: var(--brand-2, #2563eb); }
.iam-batch-import-sample strong { color: var(--ink-1, #0a0f1c); font-size: 13px; }
.iam-batch-import-sample p { margin: 6px 0 10px; color: var(--ink-3, #475569); font-size: 12px; }
.iam-batch-import-sample pre {
  margin: 0;
  background: #101827;
  border: 1px solid #26344a;
  border-radius: 8px;
  padding: 11px 13px;
  font-size: 11.5px;
  overflow-x: auto;
  color: #d7e5f7;
  line-height: 1.65;
}

.iam-batch-import-summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  padding: 14px 16px;
  background: linear-gradient(135deg, #fbfdff, #f5f8fd);
  border: 1px solid var(--line-1, #e6e9ef);
  border-radius: 12px;
}
.iam-batch-import-file { display: flex; align-items: center; gap: 11px; min-width: 0; }
.iam-batch-import-file > span {
  display: grid;
  width: 36px;
  height: 36px;
  flex: 0 0 auto;
  place-items: center;
  color: var(--brand-2, #2563eb);
  border: 1px solid #d7e4f7;
  border-radius: 8px;
  background: #fff;
}
.iam-batch-import-file > span svg { width: 18px; height: 18px; }
.iam-batch-import-file > div { min-width: 0; }
.iam-batch-import-file strong {
  display: block;
  max-width: 390px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.iam-batch-import-summary strong { color: var(--ink-1, #0a0f1c); font-size: 13px; }
.iam-batch-import-summary small { display: block; color: var(--ink-3, #6b7280); font-size: 12px; margin-top: 2px; }
.iam-batch-import-stats { display: flex; gap: 8px; }
.iam-batch-import-stats .stat {
  display: grid;
  grid-template-columns: auto auto;
  align-items: baseline;
  gap: 3px 6px;
  min-width: 72px;
  padding: 8px 10px;
  border-radius: 8px;
  background: #fff;
  border: 1px solid var(--line-1, #e6e9ef);
}
.iam-batch-import-stats .stat b { font-size: 16px; line-height: 1; }
.iam-batch-import-stats .stat small { margin: 0; font-size: 11px; color: var(--ink-3, #6b7280); }
.iam-batch-import-stats .stat.valid b { color: #15803d; }
.iam-batch-import-stats .stat.invalid b { color: #b91c1c; }
.iam-batch-import-stats .stat.selected b { color: var(--brand-1, #2563eb); }

.iam-batch-import-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  padding: 2px 0;
}
.iam-batch-import-toolbar-left,
.iam-batch-import-toolbar-right {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.iam-batch-import-role-notice {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 11px 14px;
  border: 1px solid #dbe7f7;
  border-radius: 10px;
  color: #3f5574;
  background: #f6f9fe;
  font-size: 12px;
}
.iam-batch-import-role-notice-icon {
  display: grid;
  flex: 0 0 auto;
  width: 22px;
  height: 22px;
  place-items: center;
  color: var(--brand-2, #2563eb);
}
.iam-batch-import-role-notice-icon svg { width: 17px; height: 17px; }
.iam-batch-import-role-notice strong { display: block; color: var(--ink-1, #172033); font-size: 12.5px; }
.iam-batch-import-role-notice p { margin: 3px 0 0; line-height: 1.55; }
.iam-batch-import-filter {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12.5px;
  color: var(--ink-3, #6b7280);
}
.iam-batch-import-filter select {
  font-size: 12.5px;
  min-height: 32px;
  padding: 4px 30px 4px 9px;
  color: var(--ink-2, #1e293b);
  border: 1px solid var(--line-1, #e6e9ef);
  border-radius: 8px;
  background: #fff;
}
.iam-batch-import-filter select:focus {
  border-color: var(--brand-2, #2563eb);
  outline: 0;
  box-shadow: 0 0 0 3px rgba(37, 99, 235, .1);
}

.iam-batch-import-table-wrap {
  border: 1px solid var(--line-1, #e6e9ef);
  border-radius: 12px;
  overflow: auto;
  max-height: min(480px, calc(100vh - 360px));
  box-shadow: 0 4px 16px rgba(15, 23, 42, .035);
}
.iam-batch-import-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12.5px;
}
.iam-batch-import-table thead th {
  position: sticky;
  top: 0;
  z-index: 1;
  background: #f5f8fc;
  text-align: left;
  font-weight: 600;
  color: var(--ink-2, #374151);
  padding: 11px 12px;
  border-bottom: 1px solid var(--line-1, #e6e9ef);
  white-space: nowrap;
}
.iam-batch-import-table tbody td {
  padding: 10px 12px;
  border-bottom: 1px solid var(--line-2, #e5e7eb);
  color: var(--ink-2, #374151);
  vertical-align: middle;
  overflow-wrap: anywhere;
  word-break: break-word;
}
.iam-batch-import-table tbody tr:last-child td { border-bottom: 0; }

/* 预览分页：分页条右对齐；跨页说明在窄屏下折行，不与分页控件抢一行。 */
.iam-batch-import-pagination {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}
.iam-batch-import-page-note {
  margin: 0;
  color: var(--ink-3, #6b7280);
  font-size: 11.5px;
  line-height: 1.55;
}

.iam-batch-import-result {
  display: flex;
  min-height: 300px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 30px;
  text-align: center;
}
.iam-batch-import-result-icon {
  display: grid;
  width: 58px;
  height: 58px;
  place-items: center;
  border-radius: var(--radius-pill);
}
.iam-batch-import-result-icon svg { width: 28px; height: 28px; }
.iam-batch-import-result-icon.success { color: var(--ok-1, #047857); background: var(--ok-soft, #ecfdf5); }
.iam-batch-import-result-icon.danger { color: var(--danger-1, #b91c1c); background: var(--danger-soft, #fef2f2); }
.iam-batch-import-result h4 { margin: 2px 0 6px; color: var(--ink-1, #0a0f1c); font-size: 16px; }
.iam-batch-credential-actions { display: flex; gap: 10px; flex-wrap: wrap; margin: 12px 0; }
.iam-batch-import-result .iam-batch-import-table-wrap { width: 100%; }
.iam-batch-import-result input[readonly] { width: min(260px, 100%); padding: 7px 10px; border: 1px solid var(--line-1, #dce5f1); border-radius: 6px; font-family: monospace; }
.iam-batch-import-result .iam-form-alert { width: min(620px, 100%); justify-content: center; }
.iam-batch-import-result .iam-form-alert.success {
  background: #f0fdf4;
  border-color: #bbf7d0;
  color: #14532d;
}
.iam-batch-import-result .iam-form-alert.danger {
  background: #fef2f2;
  border-color: #fecaca;
  color: #b91c1c;
}

.iam-batch-import-modal > footer {
  position: sticky;
  bottom: 0;
  margin-top: 18px;
  background: rgba(255, 255, 255, .96);
}

@media (max-width: 760px) {
  .iam-batch-import-modal { width: 100%; }
  .iam-batch-import-modal > header { padding: 20px; }
  .iam-batch-import-heading-icon { display: none; }
  .iam-batch-import-body { padding: 18px 20px 4px; }
  .iam-batch-import-steps { padding: 16px 20px; }
  .iam-batch-import-steps li { gap: 6px; }
  .iam-batch-import-steps li:not(:last-child)::after { margin-inline: 6px; }
  .iam-batch-import-steps li span { font-size: 11.5px; }
  .iam-batch-import-dropzone { min-height: 180px; padding: 28px 16px; }
  .iam-batch-import-sample { flex-direction: column; }
  .iam-batch-import-summary { flex-direction: column; align-items: flex-start; }
  .iam-batch-import-stats { width: 100%; }
  .iam-batch-import-stats .stat { flex: 1; }
  .iam-batch-import-modal > footer { flex-wrap: wrap; padding-inline: 20px; }
}

@media (max-width: 480px) {
  .iam-batch-import-steps li:not(:last-child)::after { display: none; }
  .iam-batch-import-steps { gap: 8px; }
  .iam-batch-import-steps li { justify-content: center; }
  .iam-batch-import-steps li span { display: none; }
  .iam-batch-import-toolbar-left,
  .iam-batch-import-toolbar-right { width: 100%; }
}

/* ==========================================================================
   深色主题：本弹窗的局部 token 层（--ink-* / --line-* / --bg-soft / --ok-*）
   在 .iam-settings 里是浅色取值；这里只补 [data-theme="dark"] 覆盖，
   浅色声明一行未改，深色下重映射到 main.css 的共享 token。
   ========================================================================== */
[data-theme="dark"] .iam-batch-import-modal {
  --ink-1: var(--text);
  --ink-2: var(--text-secondary);
  --ink-3: var(--text-muted);
  --ink-4: var(--text-faint);
  --line-1: var(--border);
  --line-2: var(--line-soft);
  --bg-soft: var(--surface-muted);
  --brand-soft: var(--primary-soft);
  --ok-1: var(--success-text);
  --ok-soft: var(--success-soft);
  --danger-1: var(--danger-text);
  border-color: var(--border);
  background: var(--surface-card);
}
[data-theme="dark"] .iam-batch-import-modal > header {
  background: linear-gradient(135deg, var(--surface-card) 0%, var(--surface-tint) 72%, var(--surface-tint) 100%);
}
[data-theme="dark"] .iam-batch-import-steps {
  border-bottom-color: var(--border);
  background: var(--surface-card);
}
[data-theme="dark"] .iam-batch-import-steps li:not(:last-child)::after {
  background: var(--border);
}
[data-theme="dark"] .iam-batch-import-steps li.done:not(:last-child)::after {
  background: var(--primary-border);
}
[data-theme="dark"] .iam-batch-import-steps li b {
  border-color: var(--border);
  background: var(--surface-muted);
  color: var(--text-muted);
}
[data-theme="dark"] .iam-batch-import-steps li.done b {
  color: var(--primary-ink);
  border-color: var(--border-brand);
  background: var(--chip-brand);
}
[data-theme="dark"] .iam-batch-import-steps li.active {
  color: var(--text);
}
[data-theme="dark"] .iam-batch-import-guide {
  color: var(--text-secondary);
  border-color: var(--border-brand);
  background: var(--surface-muted);
}
[data-theme="dark"] .iam-batch-import-dropzone {
  border-color: var(--border-brand-strong);
  background: linear-gradient(180deg, var(--surface-muted) 0%, var(--surface-card) 100%);
}
[data-theme="dark"] .iam-batch-import-upload-icon {
  border-color: var(--border);
  background: var(--surface-raised);
  box-shadow: none;
}
[data-theme="dark"] .iam-batch-import-dropzone code {
  border-color: var(--border);
  background: var(--surface-raised);
}
[data-theme="dark"] .iam-batch-import-dropzone small b {
  color: var(--primary-ink);
}
[data-theme="dark"] .iam-batch-import-error {
  border-color: var(--danger-border);
  color: var(--danger-text);
}
[data-theme="dark"] .iam-batch-import-sample {
  border-color: var(--border);
  background: var(--surface-muted);
}
[data-theme="dark"] .iam-batch-import-summary {
  border-color: var(--border);
  background: linear-gradient(135deg, var(--surface-muted), var(--surface-card));
}
[data-theme="dark"] .iam-batch-import-file > span {
  border-color: var(--border);
  background: var(--surface-raised);
}
[data-theme="dark"] .iam-batch-import-stats .stat {
  border-color: var(--border);
  background: var(--surface-raised);
}
[data-theme="dark"] .iam-batch-import-stats .stat.valid b {
  color: var(--success-text);
}
[data-theme="dark"] .iam-batch-import-stats .stat.invalid b {
  color: var(--danger-text);
}
[data-theme="dark"] .iam-batch-import-stats .stat.selected b {
  color: var(--primary-ink);
}
[data-theme="dark"] .iam-batch-import-role-notice {
  color: var(--text-secondary);
  border-color: var(--border-brand);
  background: var(--surface-muted);
}
[data-theme="dark"] .iam-batch-import-filter select {
  border-color: var(--border);
  background: var(--surface-input);
}
[data-theme="dark"] .iam-batch-import-table-wrap {
  border-color: var(--border);
  box-shadow: none;
}
[data-theme="dark"] .iam-batch-import-table thead th {
  border-bottom-color: var(--border);
  background: var(--surface-head);
}
[data-theme="dark"] .iam-batch-import-table tbody td {
  border-bottom-color: var(--line-soft);
}
/* 预览表格的深色覆盖随样式一起迁移到 BatchUserImportPreviewTable.vue。 */
[data-theme="dark"] .iam-batch-import-result-icon.success {
  background: var(--success-soft-strong);
}
[data-theme="dark"] .iam-batch-import-result-icon.danger {
  background: var(--danger-soft-strong);
}
[data-theme="dark"] .iam-batch-import-result input[readonly] {
  border-color: var(--border);
  background: var(--surface-input);
  color: var(--text);
}
[data-theme="dark"] .iam-batch-import-result .iam-form-alert.success {
  background: var(--success-soft);
  border-color: var(--success-border);
  color: var(--text-on-success);
}
[data-theme="dark"] .iam-batch-import-result .iam-form-alert.danger {
  background: var(--danger-soft);
  border-color: var(--danger-border);
  color: var(--text-on-danger);
}
[data-theme="dark"] .iam-batch-import-modal > footer {
  border-top: 1px solid var(--border);
  background: var(--surface-card);
}
</style>
