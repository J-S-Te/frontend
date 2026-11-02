/**
 * 合同批量导入 Excel 的纯解析、匹配与行构建层。
 *
 * 背景：现有普通合同导入要求逐份选择原件并在页面抽屉手工填写合同详情，字段多、重复劳动。
 * 本文件把“PDF 文件名 = 合同编号、Excel 提供合同详情”的映射拆成可单测的纯函数：
 * 解析工作簿、按合同编号匹配原件、应用 CRM 客户匹配结果、生成现有表单行。
 * 不发起网络请求，不修改服务端已保存批次，也不放宽服务端预检。
 */
import { createImportFormRow, emptyImportServiceItem, importItemKeyPattern } from './contractImportForm.js'
import { paymentAmountMinor } from './paymentTerms.js'

export const contractExcelSheetNames = Object.freeze({
  main: '合同明细',
  services: '服务项',
  systems: '系统信息',
  payments: '付款条款',
  help: '填写说明',
})

// 模板文件 frontend/public/contract-import-template.xlsx 的表头必须与这里一致。
export const contractExcelTemplateHeaders = Object.freeze({
  main: Object.freeze(['合同编号', '合同标题', '合同类型', '服务类型', 'CRM客户编号', '客户名称', '客户地址', '客户联系人', '客户联系电话', '客户信用等级', '金额（元）', '币种', '开始日期', '结束日期', '外部纸面编号', '商机编号', '商机名称', '实施场所', '实施批次', '检测类别', '检测方式', '体系/能力要求', '合同正文']),
  services: Object.freeze(['合同编号', '序号', '服务类型', '服务名称', '实施场所', '实施批次', '检测类别', '检测方式', '体系/能力要求']),
  systems: Object.freeze(['合同编号', '服务项序号', '系统名称', '系统等级']),
  payments: Object.freeze(['合同编号', '分期号', '到期日', '金额（元）']),
})

const mainColumns = [
  { key: 'contractNumber', aliases: ['合同编号', '合同号', '原合同编号', '来源合同编号'] },
  { key: 'title', aliases: ['合同标题', '合同名称', '标题'] },
  { key: 'contractType', aliases: ['合同类型'] },
  { key: 'serviceType', aliases: ['服务类型'] },
  { key: 'serviceName', aliases: ['服务名称'] },
  { key: 'crmCustomerId', aliases: ['CRM客户编号', 'CRM客户ID', 'CRM客户号', 'crm_customer_id'] },
  { key: 'customerName', aliases: ['客户名称', '客户'] },
  { key: 'customerAddress', aliases: ['客户地址'] },
  { key: 'customerContact', aliases: ['客户联系人', '联系人'] },
  { key: 'customerPhone', aliases: ['客户联系电话', '客户电话', '联系电话'] },
  { key: 'customerCreditLevel', aliases: ['客户信用等级', '信用等级'] },
  { key: 'amount', aliases: ['金额（元）', '金额(元)', '合同金额（元）', '合同金额(元)', '合同金额', '金额'] },
  { key: 'currency', aliases: ['币种', '货币'] },
  { key: 'startDate', aliases: ['开始日期', '合同开始日期', '起始日期'] },
  { key: 'endDate', aliases: ['结束日期', '合同结束日期', '到期日期'] },
  { key: 'externalPaperNumber', aliases: ['外部纸面编号', '纸面编号', '原纸面编号'] },
  { key: 'opportunityId', aliases: ['商机编号', '商机ID'] },
  { key: 'opportunityName', aliases: ['商机名称'] },
  { key: 'site', aliases: ['实施场所', '场所'] },
  { key: 'batch', aliases: ['实施批次', '批次'] },
  { key: 'category', aliases: ['检测类别', '检测分类'] },
  { key: 'testMode', aliases: ['检测方式'] },
  { key: 'requirement', aliases: ['体系/能力要求', '体系能力要求', '能力要求', '体系要求'] },
  { key: 'content', aliases: ['合同正文', '正文', '备注'] },
]
const serviceColumns = [
  { key: 'contractNumber', aliases: ['合同编号', '合同号'] },
  { key: 'serviceIndex', aliases: ['序号', '服务项序号'] },
  { key: 'serviceType', aliases: ['服务类型'] },
  { key: 'serviceName', aliases: ['服务名称'] },
  { key: 'site', aliases: ['实施场所', '场所'] },
  { key: 'batch', aliases: ['实施批次', '批次'] },
  { key: 'category', aliases: ['检测类别', '检测分类'] },
  { key: 'testMode', aliases: ['检测方式'] },
  { key: 'requirement', aliases: ['体系/能力要求', '体系能力要求', '能力要求', '体系要求'] },
]
const systemColumns = [
  { key: 'contractNumber', aliases: ['合同编号', '合同号'] },
  { key: 'serviceIndex', aliases: ['服务项序号', '序号'] },
  { key: 'systemName', aliases: ['系统名称'] },
  { key: 'systemLevel', aliases: ['系统等级'] },
]
const paymentColumns = [
  { key: 'contractNumber', aliases: ['合同编号', '合同号'] },
  { key: 'installmentNo', aliases: ['分期号', '期次', '序号'] },
  { key: 'dueDate', aliases: ['到期日', '到期日期'] },
  { key: 'amount', aliases: ['金额（元）', '金额(元)', '金额', '分期金额（元）', '分期金额'] },
]

const mainRequiredHeaders = ['contractNumber', 'title', 'contractType', 'amount']
const maximumExcelRows = 100

function asTrimmed(value) {
  return String(value ?? '').replace(/^\uFEFF/, '').trim()
}

function normalizedHeader(value) {
  return asTrimmed(value)
    .normalize('NFKC')
    .replace(/\s+/g, '')
    .replace(/[：:]/g, '')
    .replace(/\*/g, '')
    .toLowerCase()
}

function normalizedSheetName(value) {
  return asTrimmed(value).normalize('NFKC').replace(/\s+/g, '').toLowerCase()
}

function normalizedContractNumber(value) {
  return asTrimmed(value).normalize('NFC').replace(/\u200B/g, '')
}

function normalizedCustomerName(value) {
  return asTrimmed(value).normalize('NFKC').replace(/\s+/g, ' ').toLowerCase()
}

function cellText(value) {
  if (value === null || value === undefined) return ''
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? '' : value.toISOString().slice(0, 10)
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : ''
  return asTrimmed(value)
}

function rowIsEmpty(row) {
  return !Array.isArray(row) || row.every((cell) => {
    if (cell === null || cell === undefined) return true
    if (typeof cell === 'string') return cell.trim() === ''
    return false
  })
}

function getCell(row, map, key) {
  const index = map[key]
  return index === undefined ? null : row[index]
}

function headerMap(row, definitions) {
  const aliases = new Map()
  for (const definition of definitions) {
    for (const alias of [definition.key, ...definition.aliases]) aliases.set(normalizedHeader(alias), definition.key)
  }
  const map = {}
  const unknown = []
  ;(Array.isArray(row) ? row : []).forEach((cell, index) => {
    const header = normalizedHeader(cell)
    if (!header) return
    const key = aliases.get(header)
    if (!key) {
      unknown.push(asTrimmed(cell))
      return
    }
    if (map[key] === undefined) map[key] = index
  })
  return { map, unknown }
}

/**
 * locateHeaderRow 在前 10 行中定位表头，允许模板上方有标题或空行。
 * 参数：data 为工作表矩阵，definitions 为列定义，requiredKeys 为必须出现的列。
 * 返回值：表头行下标、列映射和未知表头；找不到时返回 null。
 */
function locateHeaderRow(data, definitions, requiredKeys) {
  const limit = Math.min(Array.isArray(data) ? data.length : 0, 10)
  for (let index = 0; index < limit; index += 1) {
    if (rowIsEmpty(data[index])) continue
    const { map, unknown } = headerMap(data[index], definitions)
    if (requiredKeys.every((key) => map[key] !== undefined)) return { index, map, unknown }
  }
  return null
}

function excelRowNumber(_headerIndex, dataIndex) {
  // dataIndex 是工作表 0 基行下标；Excel 行号是 1 基，表头在第 1 行时第一条数据为第 2 行。
  return dataIndex + 1
}

function issueFor({ scope = 'record', rowNumber = 0, contractNumber = '', field = '', code = '', message = '', blocking = true }) {
  return { scope, rowNumber, contractNumber: asTrimmed(contractNumber), field, code, message, blocking }
}

function collectIssues(records, workbookIssues) {
  const issues = [...workbookIssues]
  for (const record of records) issues.push(...record.issues)
  return issues
}

function emptyRecord(rowNumber) {
  return {
    rowNumber,
    contractNumber: '',
    title: '',
    contractType: '',
    serviceType: '',
    serviceName: '',
    crmCustomerId: '',
    customerName: '',
    customerAddress: '',
    customerContact: '',
    customerPhone: '',
    customerCreditLevel: '',
    amount: '',
    currency: 'CNY',
    startDate: '',
    endDate: '',
    externalPaperNumber: '',
    opportunityId: '',
    opportunityName: '',
    content: '',
    mainService: emptyImportServiceItem(),
    serviceItems: [],
    paymentTerms: [],
    issues: [],
    fileName: '',
    excelFileName: '',
  }
}

function addRecordIssue(record, field, code, message, options = {}) {
  record.issues.push(issueFor({
    scope: 'record',
    rowNumber: record.rowNumber,
    contractNumber: record.contractNumber,
    field,
    code,
    message,
    blocking: options.blocking !== false,
  }))
}


function parseDateCell(value, { minimumYear = 1 } = {}) {
  if (value === null || value === undefined || value === '') return { text: '' }
  let date
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return { error: '日期格式不正确' }
    date = new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()))
  } else if (typeof value === 'number') {
    // 兼容单元格未套用日期格式、被读成 Excel 序列号的情况。
    if (!Number.isFinite(value) || value < 1 || value > 2958465) return { error: '日期格式不正确' }
    if (value < 20000) return { error: '日期格式不正确，请使用 yyyy-mm-dd 或设置 Excel 日期格式' }
    date = new Date(Math.round((value - 25569) * 86400 * 1000))
  } else {
    const text = asTrimmed(value).normalize('NFKC')
    const match = /^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?(?:[T\s].*)?$/.exec(text)
      || /^(\d{4})(\d{2})(\d{2})$/.exec(text)
    if (!match) return { error: '日期格式不正确，请使用 yyyy-mm-dd' }
    const year = Number(match[1])
    const month = Number(match[2])
    const day = Number(match[3])
    date = new Date(Date.UTC(year, month - 1, day))
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
      return { error: '日期不是有效日期' }
    }
  }
  if (Number.isNaN(date.getTime())) return { error: '日期格式不正确' }
  if (date.getUTCFullYear() < minimumYear) return { error: '日期年份超出允许范围' }
  return { text: date.toISOString().slice(0, 10) }
}

function parseAmountCell(value) {
  if (value === null || value === undefined || value === '') return { text: '' }
  let text
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value <= 0) return { error: '金额必须大于零' }
    // 不使用 toFixed 静默四舍五入；超过两位小数或科学计数法由 paymentAmountMinor 明确拒绝。
    text = String(value)
  } else {
    text = asTrimmed(value)
      .normalize('NFKC')
      .replace(/[￥¥]/g, '')
      .replace(/,/g, '')
      .replace(/\s+/g, '')
      .replace(/元$/, '')
  }
  if (!text) return { text: '' }
  try {
    const minor = paymentAmountMinor(text)
    if (minor <= 0) return { error: '金额必须大于零' }
  } catch (error) {
    return { error: error.message }
  }
  return { text }
}

function parseCustomerID(value) {
  const text = asTrimmed(value).normalize('NFKC').replace(/\s+/g, '')
  if (!text) return { id: '' }
  if (!/^[1-9]\d*$/.test(text) || !Number.isSafeInteger(Number(text))) return { error: 'CRM 客户编号必须是正整数' }
  return { id: text }
}

function normalizeContractType(value) {
  const text = asTrimmed(value).normalize('NFKC').replace(/\s+/g, '')
  if (!text) return ''
  if (text === '直签' || text === '直签合同') return '直签'
  if (text === '三方' || text === '三方合同') return '三方'
  return asTrimmed(value)
}

function normalizeTestMode(value) {
  const text = asTrimmed(value).normalize('NFKC').replace(/\s+/g, '')
  if (!text) return 'STANDARD'
  const upper = text.toUpperCase()
  if (upper === 'STANDARD' || text === '常规检测' || text === '标准检测' || text === '常规') return 'STANDARD'
  if (upper === 'PENETRATION' || text === '渗透测试' || text === '渗透') return 'PENETRATION'
  return asTrimmed(value)
}

function normalizeSystemLevel(value) {
  const text = asTrimmed(value).normalize('NFKC').replace(/\s+/g, '')
  if (!text) return ''
  const map = { '1级': '一级', '2级': '二级', '3级': '三级', '4级': '四级', 一级: '一级', 二级: '二级', 三级: '三级', 四级: '四级' }
  return map[text] || asTrimmed(value)
}

function parseMainSheet(data, issues) {
  const header = locateHeaderRow(data, mainColumns, mainRequiredHeaders)
  if (!header) {
    issues.push(issueFor({ scope: 'workbook', code: 'EXCEL_HEADER_MISSING', message: '「合同明细」工作表缺少表头或缺少必填列（合同编号、合同标题、合同类型、金额（元））。' }))
    return []
  }
  const records = []
  for (let index = header.index + 1; index < data.length; index += 1) {
    const row = data[index]
    if (rowIsEmpty(row)) continue
    if (records.length >= maximumExcelRows) {
      issues.push(issueFor({ scope: 'workbook', code: 'EXCEL_ROW_LIMIT', message: '每批最多 ' + maximumExcelRows + ' 份合同，请拆分 Excel 后再导入。' }))
      break
    }
    const record = emptyRecord(excelRowNumber(header.index, index))
    const rawContractNumber = getCell(row, header.map, 'contractNumber')
    if (typeof rawContractNumber === 'number') {
      addRecordIssue(record, 'contractNumber', 'CONTRACT_NUMBER_NUMERIC', '合同编号单元格是数字格式，可能丢失前导零；请将该列设为文本格式后重新导入。')
    }
    record.contractNumber = normalizedContractNumber(cellText(rawContractNumber))
    record.title = cellText(getCell(row, header.map, 'title'))
    record.contractType = normalizeContractType(getCell(row, header.map, 'contractType'))
    record.serviceType = cellText(getCell(row, header.map, 'serviceType'))
    record.serviceName = cellText(getCell(row, header.map, 'serviceName'))
    record.customerName = cellText(getCell(row, header.map, 'customerName'))
    record.customerAddress = cellText(getCell(row, header.map, 'customerAddress'))
    record.customerContact = cellText(getCell(row, header.map, 'customerContact'))
    record.customerPhone = cellText(getCell(row, header.map, 'customerPhone'))
    record.customerCreditLevel = cellText(getCell(row, header.map, 'customerCreditLevel'))
    record.currency = cellText(getCell(row, header.map, 'currency')).toUpperCase() || 'CNY'
    record.externalPaperNumber = cellText(getCell(row, header.map, 'externalPaperNumber'))
    record.opportunityId = cellText(getCell(row, header.map, 'opportunityId'))
    record.opportunityName = cellText(getCell(row, header.map, 'opportunityName'))
    record.content = cellText(getCell(row, header.map, 'content'))
    record.mainService = {
      ...emptyImportServiceItem(),
      serviceType: record.serviceType,
      name: record.serviceName,
      site: cellText(getCell(row, header.map, 'site')),
      batch: cellText(getCell(row, header.map, 'batch')) || '第一批次',
      category: cellText(getCell(row, header.map, 'category')),
      requirement: cellText(getCell(row, header.map, 'requirement')),
      testMode: normalizeTestMode(getCell(row, header.map, 'testMode')),
      systems: [],
    }
    const rawCustomerID = getCell(row, header.map, 'crmCustomerId')
    const customerID = parseCustomerID(rawCustomerID)
    if (customerID.error) addRecordIssue(record, 'crmCustomerId', 'CRM_CUSTOMER_ID_INVALID', customerID.error)
    // 解析失败时保留原始文本，让现有逐行校验继续报错，避免把非法值静默置空后绕过预检。
    record.crmCustomerId = customerID.id || (customerID.error ? cellText(rawCustomerID) : '')
    const rawAmount = getCell(row, header.map, 'amount')
    const amount = parseAmountCell(rawAmount)
    if (amount.error) addRecordIssue(record, 'amount', 'AMOUNT_INVALID', amount.error)
    record.amount = amount.text || (amount.error ? cellText(rawAmount) : '')
    const rawStartDate = getCell(row, header.map, 'startDate')
    const startDate = parseDateCell(rawStartDate)
    if (startDate.error) addRecordIssue(record, 'startDate', 'DATE_INVALID', startDate.error)
    record.startDate = startDate.text || (startDate.error ? cellText(rawStartDate) : '')
    const rawEndDate = getCell(row, header.map, 'endDate')
    const endDate = parseDateCell(rawEndDate)
    if (endDate.error) addRecordIssue(record, 'endDate', 'DATE_INVALID', endDate.error)
    record.endDate = endDate.text || (endDate.error ? cellText(rawEndDate) : '')
    if (!record.contractNumber) {
      addRecordIssue(record, 'contractNumber', 'CONTRACT_NUMBER_REQUIRED', '合同编号不能为空，必须与 PDF 文件名去掉扩展名后完全一致。')
    } else if (!importItemKeyPattern.test(record.contractNumber)) {
      addRecordIssue(record, 'contractNumber', 'CONTRACT_NUMBER_UNSUPPORTED', '合同编号只能使用字母/数字/._:-，当前编号不能作为来源业务键；请核对 PDF 文件名和合同编号。')
    }
    records.push(record)
  }
  const seen = new Map()
  for (const record of records) {
    const key = record.contractNumber
    if (!key) continue
    if (seen.has(key)) {
      addRecordIssue(record, 'contractNumber', 'CONTRACT_NUMBER_DUPLICATE', '合同编号「' + key + '」在 Excel 中重复，同一份合同只能有一行。')
    } else {
      seen.set(key, record)
    }
  }
  return records
}

function parseServiceRows(data, issues, knownContractNumbers) {
  const grouped = new Map()
  if (!Array.isArray(data) || data.length === 0) return grouped
  const header = locateHeaderRow(data, serviceColumns, ['contractNumber'])
  if (!header) {
    issues.push(issueFor({ scope: 'workbook', code: 'EXCEL_HEADER_MISSING', message: '「服务项」工作表缺少表头或缺少「合同编号」列。' }))
    return grouped
  }
  for (let index = header.index + 1; index < data.length; index += 1) {
    const row = data[index]
    if (rowIsEmpty(row)) continue
    const rowNumber = excelRowNumber(header.index, index)
    const contractNumber = normalizedContractNumber(cellText(getCell(row, header.map, 'contractNumber')))
    const serviceIndex = Number(cellText(getCell(row, header.map, 'serviceIndex')))
    if (!contractNumber) {
      issues.push(issueFor({ scope: 'workbook', rowNumber, code: 'SERVICE_CONTRACT_NUMBER_REQUIRED', message: '「服务项」工作表存在未填写合同编号的行。' }))
      continue
    }
    if (!knownContractNumbers.has(contractNumber)) {
      issues.push(issueFor({ scope: 'workbook', rowNumber, contractNumber, code: 'ORPHAN_SERVICE_ROW', message: '服务项行 ' + rowNumber + ' 的合同编号「' + contractNumber + '」在「合同明细」中不存在。' }))
      continue
    }
    const service = {
      serviceType: cellText(getCell(row, header.map, 'serviceType')),
      name: cellText(getCell(row, header.map, 'serviceName')),
      site: cellText(getCell(row, header.map, 'site')),
      batch: cellText(getCell(row, header.map, 'batch')) || '第一批次',
      category: cellText(getCell(row, header.map, 'category')),
      testMode: normalizeTestMode(getCell(row, header.map, 'testMode')),
      requirement: cellText(getCell(row, header.map, 'requirement')),
      systems: [],
      excelRowNumber: rowNumber,
      requestedIndex: Number.isInteger(serviceIndex) && serviceIndex > 0 ? serviceIndex : 0,
    }
    if (!grouped.has(contractNumber)) grouped.set(contractNumber, [])
    grouped.get(contractNumber).push(service)
  }
  return grouped
}

function parseSystemRows(data, issues, serviceRowsByContract, mainServiceContracts = new Set()) {
  const grouped = new Map()
  if (!Array.isArray(data) || data.length === 0) return grouped
  const header = locateHeaderRow(data, systemColumns, ['contractNumber', 'systemName'])
  if (!header) {
    issues.push(issueFor({ scope: 'workbook', code: 'EXCEL_HEADER_MISSING', message: '「系统信息」工作表缺少表头或缺少「合同编号」「系统名称」列。' }))
    return grouped
  }
  for (let index = header.index + 1; index < data.length; index += 1) {
    const row = data[index]
    if (rowIsEmpty(row)) continue
    const rowNumber = excelRowNumber(header.index, index)
    const contractNumber = normalizedContractNumber(cellText(getCell(row, header.map, 'contractNumber')))
    const systemName = cellText(getCell(row, header.map, 'systemName'))
    const systemLevel = normalizeSystemLevel(getCell(row, header.map, 'systemLevel'))
    const requestedIndex = Number(cellText(getCell(row, header.map, 'serviceIndex')))
    if (!contractNumber) {
      issues.push(issueFor({ scope: 'workbook', rowNumber, code: 'SYSTEM_CONTRACT_NUMBER_REQUIRED', message: '「系统信息」工作表存在未填写合同编号的行。' }))
      continue
    }
    const serviceRows = serviceRowsByContract.get(contractNumber) || []
    // 允许合同明细主表只填一条服务项时，仍在系统信息分表挂系统；此时视为主表服务项序号 1。
    const usesMainService = !serviceRows.length && mainServiceContracts.has(contractNumber)
    const serviceCount = serviceRows.length || (usesMainService ? 1 : 0)
    if (!serviceCount) {
      issues.push(issueFor({ scope: 'workbook', rowNumber, contractNumber, code: 'ORPHAN_SYSTEM_ROW', message: '系统信息行 ' + rowNumber + ' 的合同编号「' + contractNumber + '」没有对应服务项。' }))
      continue
    }
    let target = 0
    if (Number.isInteger(requestedIndex) && requestedIndex > 0) {
      target = requestedIndex - 1
      if (target >= serviceCount) {
        issues.push(issueFor({ scope: 'workbook', rowNumber, contractNumber, code: 'SYSTEM_SERVICE_INDEX_INVALID', message: '系统信息行 ' + rowNumber + ' 的服务项序号 ' + requestedIndex + ' 超出该合同的服务项数量（' + serviceCount + '）。' }))
        continue
      }
    } else if (serviceCount > 1) {
      issues.push(issueFor({ scope: 'workbook', rowNumber, contractNumber, code: 'SYSTEM_SERVICE_INDEX_REQUIRED', message: '系统信息行 ' + rowNumber + ' 的合同有多个服务项，必须填写「服务项序号」。' }))
      continue
    }
    if (!grouped.has(contractNumber)) grouped.set(contractNumber, [])
    grouped.get(contractNumber).push({ rowNumber, serviceIndex: target, system: { name: systemName, level: systemLevel } })
  }
  return grouped
}

function parsePaymentRows(data, issues, knownContractNumbers) {
  const grouped = new Map()
  if (!Array.isArray(data) || data.length === 0) return grouped
  const header = locateHeaderRow(data, paymentColumns, ['contractNumber'])
  if (!header) {
    issues.push(issueFor({ scope: 'workbook', code: 'EXCEL_HEADER_MISSING', message: '「付款条款」工作表缺少表头或缺少「合同编号」列。' }))
    return grouped
  }
  for (let index = header.index + 1; index < data.length; index += 1) {
    const row = data[index]
    if (rowIsEmpty(row)) continue
    const rowNumber = excelRowNumber(header.index, index)
    const contractNumber = normalizedContractNumber(cellText(getCell(row, header.map, 'contractNumber')))
    if (!contractNumber) {
      issues.push(issueFor({ scope: 'workbook', rowNumber, code: 'PAYMENT_CONTRACT_NUMBER_REQUIRED', message: '「付款条款」工作表存在未填写合同编号的行。' }))
      continue
    }
    if (!knownContractNumbers.has(contractNumber)) {
      issues.push(issueFor({ scope: 'workbook', rowNumber, contractNumber, code: 'ORPHAN_PAYMENT_ROW', message: '付款条款行 ' + rowNumber + ' 的合同编号「' + contractNumber + '」在「合同明细」中不存在。' }))
      continue
    }
    const installmentText = cellText(getCell(row, header.map, 'installmentNo'))
    const installmentNo = Number(installmentText)
    const dueDate = parseDateCell(getCell(row, header.map, 'dueDate'), { minimumYear: 1000 })
    const amount = parseAmountCell(getCell(row, header.map, 'amount'))
    if (!grouped.has(contractNumber)) grouped.set(contractNumber, [])
    grouped.get(contractNumber).push({
      installment_no: Number.isInteger(installmentNo) && installmentNo > 0 ? installmentNo : 0,
      due_date: dueDate.text || (dueDate.error ? cellText(getCell(row, header.map, 'dueDate')) : ''),
      amount: amount.text || (amount.error ? cellText(getCell(row, header.map, 'amount')) : ''),
      rowNumber,
      dueDateError: dueDate.error || '',
      amountError: amount.error || '',
    })
  }
  return grouped
}

function buildServiceItems(mainService, serviceRows, systemRows) {
  const items = []
  if (serviceRows.length) {
    for (const row of serviceRows) items.push({
      serviceType: row.serviceType,
      name: row.name,
      site: row.site,
      batch: row.batch,
      category: row.category,
      testMode: row.testMode,
      requirement: row.requirement,
      systems: [],
    })
  } else {
    const hasMainServiceValue = [mainService.serviceType, mainService.name, mainService.site, mainService.category, mainService.requirement]
      .some((value) => asTrimmed(value) !== '')
    if (hasMainServiceValue) items.push({
      serviceType: mainService.serviceType,
      name: mainService.name,
      site: mainService.site,
      batch: mainService.batch || '第一批次',
      category: mainService.category,
      testMode: mainService.testMode || 'STANDARD',
      requirement: mainService.requirement,
      systems: [],
    })
  }
  for (const entry of systemRows) {
    if (!items[entry.serviceIndex]) continue
    items[entry.serviceIndex].systems.push(entry.system)
  }
  return items
}

function buildPaymentTerms(paymentRows, issues, contractNumber) {
  if (!paymentRows.length) return []
  const terms = paymentRows.map((row, index) => ({
    installment_no: row.installment_no || index + 1,
    due_date: row.due_date,
    amount: row.amount,
  }))
  const seen = new Set()
  for (const term of terms) {
    if (seen.has(term.installment_no)) {
      issues.push(issueFor({ scope: 'workbook', contractNumber, code: 'PAYMENT_INSTALLMENT_DUPLICATE', message: '合同「' + contractNumber + '」的付款条款存在重复分期号 ' + term.installment_no + '。' }))
    }
    seen.add(term.installment_no)
  }
  for (const row of paymentRows) {
    if (row.dueDateError) issues.push(issueFor({ scope: 'workbook', contractNumber, code: 'PAYMENT_DATE_INVALID', message: '合同「' + contractNumber + '」付款条款行 ' + row.rowNumber + '：' + row.dueDateError + '。' }))
    if (row.amountError) issues.push(issueFor({ scope: 'workbook', contractNumber, code: 'PAYMENT_AMOUNT_INVALID', message: '合同「' + contractNumber + '」付款条款行 ' + row.rowNumber + '：' + row.amountError + '。' }))
  }
  return terms
}

/**
 * parseContractExcelWorkbook 解析合同导入工作簿并生成每份合同的字段集合。
 * 参数：sheets 为 read-excel-file 返回的 [{sheet,data}]；data 为单元格矩阵。
 * 返回值：records（按合同明细顺序）、issues（工作簿/行级问题）和可选工作表信息。
 * 说明：不做网络请求；字段级必填/枚举/金额/日期仍由现有表单校验与服务端预检兜底。
 */
export function parseContractExcelWorkbook(sheets = []) {
  const issues = []
  const available = new Map()
  for (const sheet of Array.isArray(sheets) ? sheets : []) {
    if (!sheet || typeof sheet.sheet !== 'string' || !Array.isArray(sheet.data)) continue
    available.set(normalizedSheetName(sheet.sheet), sheet.data)
  }
  let mainData = available.get(normalizedSheetName(contractExcelSheetNames.main))
  if (!mainData) {
    // 兼容用户已有的单表 Excel：只在一个工作表能找到合同表头时使用它，并保留非阻断提示。
    const candidates = [...available.entries()].filter(([, data]) => locateHeaderRow(data, mainColumns, mainRequiredHeaders))
    if (candidates.length === 1 && available.size === 1) {
      mainData = candidates[0][1]
      issues.push(issueFor({ scope: 'workbook', code: 'EXCEL_MAIN_SHEET_FALLBACK', message: '未找到「' + contractExcelSheetNames.main + '」工作表，已使用唯一包含合同表头的工作表「' + candidates[0][0] + '」；建议下载模板填写。', blocking: false }))
    }
  }
  if (!mainData) {
    issues.push(issueFor({ scope: 'workbook', code: 'EXCEL_SHEET_MISSING', message: '缺少工作表「' + contractExcelSheetNames.main + '」，请使用下载的模板填写合同明细。' }))
    return { records: [], issues, availableSheets: [...available.keys()] }
  }
  const records = parseMainSheet(mainData, issues)
  if (!records.length) {
    issues.push(issueFor({ scope: 'workbook', code: 'EXCEL_NO_RECORDS', message: '「合同明细」工作表没有可导入的数据行。' }))
    return { records, issues, availableSheets: [...available.keys()] }
  }
  const knownContractNumbers = new Set(records.map((record) => record.contractNumber).filter(Boolean))
  const mainServiceContracts = new Set(records.filter((record) => [record.mainService.serviceType, record.mainService.name, record.mainService.site, record.mainService.category, record.mainService.requirement].some((value) => asTrimmed(value) !== '')).map((record) => record.contractNumber))
  const serviceRowsByContract = parseServiceRows(available.get(normalizedSheetName(contractExcelSheetNames.services)), issues, knownContractNumbers)
  // 先按「序号」稳定排序，系统信息的分表序号才能与实际生成的服务项顺序一致。
  for (const [contractNumber, serviceRows] of serviceRowsByContract.entries()) {
    serviceRows.sort((left, right) => {
      const leftIndex = left.requestedIndex || Number.MAX_SAFE_INTEGER
      const rightIndex = right.requestedIndex || Number.MAX_SAFE_INTEGER
      return leftIndex - rightIndex
    })
    // 系统信息用「服务项序号」定位；序号必须全部填写且为 1..N 连续，否则会静默挂错服务项。
    const indexes = serviceRows.map((row) => row.requestedIndex)
    const numbered = indexes.filter((index) => index > 0)
    if (numbered.length && numbered.length !== indexes.length) {
      issues.push(issueFor({ scope: 'workbook', contractNumber, code: 'SERVICE_INDEX_INVALID', message: '合同「' + contractNumber + '」的服务项序号必须全部填写或全部留空，不能只填一部分。' }))
    } else if (numbered.length) {
      const unique = new Set(numbered)
      const expected = Array.from({ length: indexes.length }, (_, index) => index + 1)
      if (unique.size !== numbered.length || expected.some((index) => !unique.has(index))) {
        issues.push(issueFor({ scope: 'workbook', contractNumber, code: 'SERVICE_INDEX_INVALID', message: '合同「' + contractNumber + '」的服务项序号必须为 1 至 ' + indexes.length + ' 且不能重复；请修正「服务项」工作表。' }))
      }
    }
  }
  const systemRowsByContract = parseSystemRows(available.get(normalizedSheetName(contractExcelSheetNames.systems)), issues, serviceRowsByContract, mainServiceContracts)
  const paymentRowsByContract = parsePaymentRows(available.get(normalizedSheetName(contractExcelSheetNames.payments)), issues, knownContractNumbers)
  for (const record of records) {
    const serviceRows = serviceRowsByContract.get(record.contractNumber) || []
    record.serviceItems = buildServiceItems(record.mainService, serviceRows, systemRowsByContract.get(record.contractNumber) || [])
    record.paymentTerms = buildPaymentTerms(paymentRowsByContract.get(record.contractNumber) || [], issues, record.contractNumber)
    // 服务项为空仍生成行，由现有 validateImportFormRows 精确指出必填字段，避免静默删除合同。
  }
  return { records, issues: collectIssues(records, issues), availableSheets: [...available.keys()] }
}


function fileNameBase(fileName) {
  const name = asTrimmed(fileName)
  const dot = name.lastIndexOf('.')
  return (dot > 0 ? name.slice(0, dot) : name).normalize('NFC').trim()
}

/**
 * matchContractExcelRecordsToFiles 按“PDF 文件名去扩展名 = 合同编号”做一一匹配。
 * 参数：records 为解析结果，files 为当前选择的原件（File 或含 name 的对象）。
 * 返回值：matchedRecords（仅匹配成功的记录，带 fileName）、issues 和 unmatchedFiles；
 * 任何缺失、重复、大小写差异都会明确列出，不自动跳过或猜测。
 */
export function matchContractExcelRecordsToFiles(records = [], files = []) {
  const issues = []
  const fileList = (Array.isArray(files) ? files : []).filter((file) => file && asTrimmed(file.name))
  const filesByBase = new Map()
  for (const file of fileList) {
    const base = fileNameBase(file.name)
    if (!filesByBase.has(base)) filesByBase.set(base, [])
    filesByBase.get(base).push(file)
  }
  const matched = []
  const usedFiles = new Set()
  const usedContractNumbers = new Set()
  for (const record of records) {
    if (!record.contractNumber) {
      issues.push(issueFor({ scope: 'match', rowNumber: record.rowNumber, code: 'CONTRACT_NUMBER_REQUIRED', message: 'Excel 第 ' + record.rowNumber + ' 行合同编号为空，无法与 PDF 文件名匹配。' }))
      continue
    }
    if (usedContractNumbers.has(record.contractNumber)) continue
    usedContractNumbers.add(record.contractNumber)
    const exactFiles = filesByBase.get(record.contractNumber) || []
    if (exactFiles.length > 1) {
      issues.push(issueFor({ scope: 'match', rowNumber: record.rowNumber, contractNumber: record.contractNumber, code: 'MULTIPLE_PDF_FOR_CONTRACT', message: '合同编号「' + record.contractNumber + '」对应多份原件：' + exactFiles.map((file) => file.name).join('、') + '。每份合同只能对应一份原件。' }))
      for (const file of exactFiles) usedFiles.add(file.name)
      continue
    }
    if (!exactFiles.length) {
      const caseInsensitive = fileList.filter((file) => fileNameBase(file.name).toLowerCase() === record.contractNumber.toLowerCase())
      if (caseInsensitive.length === 1) {
        issues.push(issueFor({ scope: 'match', rowNumber: record.rowNumber, contractNumber: record.contractNumber, code: 'PDF_CONTRACT_NUMBER_CASE_MISMATCH', message: '合同编号「' + record.contractNumber + '」与原件「' + caseInsensitive[0].name + '」仅大小写不同；文件名必须与合同编号完全一致。' }))
        usedFiles.add(caseInsensitive[0].name)
      } else {
        issues.push(issueFor({ scope: 'match', rowNumber: record.rowNumber, contractNumber: record.contractNumber, code: 'PDF_MISSING_FOR_ROW', message: '合同编号「' + record.contractNumber + '」没有找到同名 PDF 原件（应为 ' + record.contractNumber + '.pdf 或 .docx）。' }))
      }
      continue
    }
    const file = exactFiles[0]
    usedFiles.add(file.name)
    matched.push({ ...record, fileName: file.name })
  }
  for (const file of fileList) {
    if (usedFiles.has(file.name)) continue
    issues.push(issueFor({ scope: 'match', code: 'PDF_WITHOUT_EXCEL_ROW', message: '原件「' + file.name + '」在 Excel「合同明细」中没有对应合同编号。' }))
  }
  return { matchedRecords: matched, issues, unmatchedFiles: fileList.filter((file) => !usedFiles.has(file.name)) }
}

/**
 * applyContractExcelCustomerLookup 把 CRM 目录精确匹配结果写回记录。
 * 参数：records 为匹配后的记录，lookup 为 { 规范化客户名: {status,id,name,candidates} }。
 * 返回值：带 customer 匹配问题的新记录；有 CRM 客户编号的行不覆盖。
 */
export function applyContractExcelCustomerLookup(records = [], lookup = {}) {
  return (Array.isArray(records) ? records : []).map((record) => {
    const issues = [...record.issues]
    const result = { ...record, issues }
    if (result.crmCustomerId) return result
    const name = asTrimmed(result.customerName)
    if (!name) {
      issues.push(issueFor({ scope: 'record', rowNumber: result.rowNumber, contractNumber: result.contractNumber, field: 'customerName', code: 'CUSTOMER_NAME_REQUIRED', message: '合同编号「' + (result.contractNumber || result.rowNumber) + '」缺少客户名称或 CRM 客户编号。' }))
      return result
    }
    const found = lookup[normalizedCustomerName(name)]
    if (!found) {
      issues.push(issueFor({ scope: 'record', rowNumber: result.rowNumber, contractNumber: result.contractNumber, field: 'crmCustomerId', code: 'CRM_CUSTOMER_LOOKUP_REQUIRED', message: '合同编号「' + result.contractNumber + '」的客户「' + name + '」尚未在 CRM 中核对；请连接 CRM 后重新匹配或直接填写 CRM 客户编号。' }))
      return result
    }
    if (found.status === 'found' && found.id) {
      result.crmCustomerId = String(found.id)
      if (found.name) result.customerName = found.name
      return result
    }
    if (found.status === 'too_many') {
      issues.push(issueFor({ scope: 'record', rowNumber: result.rowNumber, contractNumber: result.contractNumber, field: 'crmCustomerId', code: 'CRM_CUSTOMER_LOOKUP_UNAVAILABLE', message: '客户「' + name + '」在 CRM 中相似候选超过一页，无法唯一确认；请填写 CRM 客户编号。' }))
      return result
    }
    if (found.status === 'unavailable') {
      issues.push(issueFor({ scope: 'record', rowNumber: result.rowNumber, contractNumber: result.contractNumber, field: 'crmCustomerId', code: 'CRM_CUSTOMER_LOOKUP_UNAVAILABLE', message: '客户「' + name + '」的 CRM 目录核对失败：' + (found.message || '请稍后重试或直接填写 CRM 客户编号。') }))
      return result
    }
    if (found.status === 'ambiguous') {
      const candidates = (found.candidates || []).slice(0, 3).map((item) => (item.name || '') + '（ID ' + (item.id || item.customer_id || '') + '）').join('、')
      issues.push(issueFor({ scope: 'record', rowNumber: result.rowNumber, contractNumber: result.contractNumber, field: 'crmCustomerId', code: 'CRM_CUSTOMER_AMBIGUOUS', message: '客户「' + name + '」在 CRM 中匹配到多个客户：' + (candidates || '多个结果') + '；请在 Excel 填写 CRM 客户编号。' }))
      return result
    }
    issues.push(issueFor({ scope: 'record', rowNumber: result.rowNumber, contractNumber: result.contractNumber, field: 'crmCustomerId', code: 'CRM_CUSTOMER_NOT_FOUND', message: '客户「' + name + '」在当前账号可读取的 CRM 有效客户中未找到；请检查名称或填写 CRM 客户编号。' }))
    return result
  })
}

/**
 * buildContractExcelImportRows 把匹配后的 Excel 记录转成现有普通导入表单行。
 * 参数：records 为匹配后的记录，keyByFileName 用于复用已暂存原件的行键，避免重新预检时换键。
 * 返回值：可直接进入现有暂存/预检流程的表单行。
 */
export function buildContractExcelImportRows(records = [], { keyByFileName = {} } = {}) {
  return (Array.isArray(records) ? records : []).map((record) => {
    const row = createImportFormRow({
      fileName: record.fileName,
      key: keyByFileName[record.fileName] || '',
      externalRecordId: record.contractNumber,
    })
    row.title = record.title
    row.contractType = record.contractType
    row.opportunityId = record.opportunityId
    row.opportunityName = record.opportunityName
    row.crmCustomerId = record.crmCustomerId
    row.customerName = record.customerName
    row.customerAddress = record.customerAddress
    row.customerContact = record.customerContact
    row.customerPhone = record.customerPhone
    row.customerCreditLevel = record.customerCreditLevel
    row.amount = record.amount
    row.currency = record.currency || 'CNY'
    row.startDate = record.startDate
    row.endDate = record.endDate
    row.externalPaperNumber = record.externalPaperNumber
    row.content = record.content
    row.serviceItems = record.serviceItems.length
      ? record.serviceItems.map((service) => ({
        serviceType: service.serviceType || '',
        name: service.name || '',
        site: service.site || '',
        batch: service.batch || '第一批次',
        category: service.category || '',
        requirement: service.requirement || '',
        testMode: service.testMode || 'STANDARD',
        systems: (service.systems || []).map((system) => ({
          name: system.name || '',
          level: system.level || '',
        })),
      }))
      : [emptyImportServiceItem()]
    row.paymentTerms = (record.paymentTerms || []).map((term) => ({
      installment_no: term.installment_no,
      due_date: term.due_date,
      amount: term.amount,
    }))
    row.excelRowNumber = record.rowNumber
    row.excelIssues = record.issues
    return row
  })
}

/**
 * blockingContractExcelIssues 汇总阻断性问题，供页面禁用预检并给出明确原因。
 * 参数：issues 为解析/匹配/客户匹配问题。
 * 返回值：blocking !== false 的问题数组。
 */
export function blockingContractExcelIssues(issues = []) {
  return (Array.isArray(issues) ? issues : []).filter((issue) => issue && issue.blocking !== false)
}

/**
 * summarizeContractExcelImport 生成面向业务的匹配摘要，避免只显示英文错误码。
 * 参数：records 为 Excel 记录，matchedRecords 为匹配记录，issues 为问题集合，files 为所选原件。
 * 返回值：{ contractCount, matchedCount, unmatchedFileCount, blockingCount }。
 */
export function summarizeContractExcelImport({ records = [], matchedRecords = [], issues = [], files = [] } = {}) {
  const blocking = blockingContractExcelIssues(issues)
  const matchedFiles = new Set(matchedRecords.map((record) => record.fileName))
  return {
    contractCount: records.length,
    matchedCount: matchedRecords.length,
    unmatchedFileCount: (files || []).filter((file) => !matchedFiles.has(file.name)).length,
    blockingCount: blocking.length,
  }
}
