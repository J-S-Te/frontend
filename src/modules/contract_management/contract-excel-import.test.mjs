import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import readXlsxFile from 'read-excel-file/universal'
import { applyContractExcelCustomerLookup, blockingContractExcelIssues, buildContractExcelImportRows,
  contractExcelTemplateHeaders, matchContractExcelRecordsToFiles, parseContractExcelWorkbook,
  summarizeContractExcelImport } from './utils/contractExcelImport.js'
import { readContractExcelWorkbook } from './utils/contractExcelReader.js'
import { validateImportFormRows } from './utils/contractImportForm.js'

const mainHeaders = [...contractExcelTemplateHeaders.main]
const serviceHeaders = [...contractExcelTemplateHeaders.services]
const systemHeaders = [...contractExcelTemplateHeaders.systems]
const paymentHeaders = [...contractExcelTemplateHeaders.payments]

function mainRow(values = {}) {
  return mainHeaders.map((header) => {
    if (header === '合同编号') return values.contractNumber ?? 'HT-2026001'
    if (header === '合同标题') return values.title ?? '示例合同'
    if (header === '合同类型') return values.contractType ?? '直签'
    if (header === '服务类型') return values.serviceType ?? '软件测试'
    if (header === 'CRM客户编号') return values.crmCustomerId ?? ''
    if (header === '客户名称') return values.customerName ?? '示例客户'
    if (header === '金额（元）') return values.amount ?? '10000'
    if (header === '币种') return values.currency ?? 'CNY'
    if (header === '开始日期') return values.startDate ?? '2024-01-01'
    if (header === '结束日期') return values.endDate ?? '2024-12-31'
    if (header === '实施场所') return values.site ?? '上海总部'
    if (header === '实施批次') return values.batch ?? '第一批次'
    if (header === '检测类别') return values.category ?? '等保测评'
    if (header === '检测方式') return values.testMode ?? '常规检测'
    if (header === '体系/能力要求') return values.requirement ?? '等保三级'
    return values[header] ?? ''
  })
}

function workbook(rows = [mainRow()], extra = {}) {
  return [
    { sheet: '合同明细', data: [mainHeaders, ...rows] },
    { sheet: '服务项', data: [serviceHeaders, ...(extra.services || [])] },
    { sheet: '系统信息', data: [systemHeaders, ...(extra.systems || [])] },
    { sheet: '付款条款', data: [paymentHeaders, ...(extra.payments || [])] },
  ]
}

function filesFor(...names) {
  return names.map((name) => ({ name }))
}

test('主表一行即可生成合同记录，并复用合同明细中的单条服务项', () => {
  const parsed = parseContractExcelWorkbook(workbook())
  assert.equal(parsed.records.length, 1)
  assert.deepEqual(blockingContractExcelIssues(parsed.issues), [])
  const record = parsed.records[0]
  assert.equal(record.contractNumber, 'HT-2026001')
  assert.equal(record.title, '示例合同')
  assert.equal(record.contractType, '直签')
  assert.equal(record.amount, '10000')
  assert.equal(record.startDate, '2024-01-01')
  assert.equal(record.endDate, '2024-12-31')
  assert.equal(record.serviceItems.length, 1)
  assert.equal(record.serviceItems[0].site, '上海总部')
  assert.equal(record.serviceItems[0].testMode, 'STANDARD')
  assert.equal(record.serviceItems[0].category, '等保测评')
})

test('服务项、系统信息和付款条款分表可生成多服务项与多期付款', () => {
  const parsed = parseContractExcelWorkbook(workbook([mainRow({ contractNumber: 'HT-2026002', serviceType: '', site: '', category: '', testMode: '', requirement: '' })], {
    services: [
      ['HT-2026002', 1, '软件测试', '', '北京', '第一批次', '软件测试', '常规检测', ''],
      ['HT-2026002', 2, '等保测评', '等级保护', '上海', '第二批次', '等保测评', '渗透测试', '等保三级'],
    ],
    systems: [
      ['HT-2026002', 2, '统一身份平台', '二级'],
    ],
    payments: [
      ['HT-2026002', 1, '2024-06-01', '5000'],
      ['HT-2026002', 2, '2024-12-01', '5000'],
    ],
  }))
  assert.deepEqual(blockingContractExcelIssues(parsed.issues), [])
  const record = parsed.records[0]
  assert.equal(record.serviceItems.length, 2)
  assert.equal(record.serviceItems[0].serviceType, '软件测试')
  assert.equal(record.serviceItems[1].testMode, 'PENETRATION')
  assert.deepEqual(record.serviceItems[1].systems, [{ name: '统一身份平台', level: '二级' }])
  assert.deepEqual(record.paymentTerms, [
    { installment_no: 1, due_date: '2024-06-01', amount: '5000' },
    { installment_no: 2, due_date: '2024-12-01', amount: '5000' },
  ])
})

test('表头别名可用，未知扩展列不影响导入', () => {
  const headers = mainHeaders.map((header) => {
    if (header === '合同标题') return '合同名称'
    if (header === '金额（元）') return '金额'
    if (header === 'CRM客户编号') return 'CRM客户ID'
    return header
  })
  const data = [headers, headers.map((header, index) => {
    if (header === '合同编号') return 'HT-2026003'
    if (header === '合同名称') return '别名合同'
    if (header === '合同类型') return '三方合同'
    if (header === '金额') return '1,234.50'
    if (header === 'CRM客户ID') return '88'
    if (header === '客户名称') return '客户三'
    if (header === '实施场所') return '杭州'
    if (header === '检测类别') return '软件测试'
    return index === 0 ? '备注列' : ''
  })]
  const parsed = parseContractExcelWorkbook([{ sheet: '合同明细', data }])
  assert.deepEqual(blockingContractExcelIssues(parsed.issues), [])
  assert.equal(parsed.records[0].title, '别名合同')
  assert.equal(parsed.records[0].contractType, '三方')
  assert.equal(parsed.records[0].amount, '1234.50')
  assert.equal(parsed.records[0].crmCustomerId, '88')
})

test('重复合同编号、非法来源业务键和空合同编号均阻断', () => {
  const duplicate = parseContractExcelWorkbook(workbook([mainRow(), mainRow({ title: '重复' })]))
  assert.ok(duplicate.issues.some((issue) => issue.code === 'CONTRACT_NUMBER_DUPLICATE'))
  const unsupported = parseContractExcelWorkbook(workbook([mainRow({ contractNumber: '合同-中文-001' })]))
  assert.ok(unsupported.issues.some((issue) => issue.code === 'CONTRACT_NUMBER_UNSUPPORTED'))
  const empty = parseContractExcelWorkbook(workbook([mainRow({ contractNumber: '' })]))
  assert.ok(empty.issues.some((issue) => issue.code === 'CONTRACT_NUMBER_REQUIRED'))
})

test('PDF 匹配严格按文件名去扩展名等于合同编号', () => {
  const parsed = parseContractExcelWorkbook(workbook([
    mainRow({ contractNumber: 'HT-1' }),
    mainRow({ contractNumber: 'HT-2', title: '第二份' }),
  ]))
  const matched = matchContractExcelRecordsToFiles(parsed.records, filesFor('HT-1.pdf', 'HT-2.docx'))
  assert.deepEqual(blockingContractExcelIssues(matched.issues), [])
  assert.equal(matched.matchedRecords.length, 2)
  assert.equal(matched.matchedRecords[0].fileName, 'HT-1.pdf')

  const missing = matchContractExcelRecordsToFiles(parsed.records, filesFor('HT-1.pdf'))
  assert.ok(missing.issues.some((issue) => issue.code === 'PDF_MISSING_FOR_ROW'))

  const extra = matchContractExcelRecordsToFiles(parsed.records, filesFor('HT-1.pdf', 'HT-2.docx', 'HT-3.pdf'))
  assert.ok(extra.issues.some((issue) => issue.code === 'PDF_WITHOUT_EXCEL_ROW'))

  const caseMismatch = matchContractExcelRecordsToFiles([parsed.records[0]], filesFor('ht-1.pdf'))
  assert.ok(caseMismatch.issues.some((issue) => issue.code === 'PDF_CONTRACT_NUMBER_CASE_MISMATCH'))

  const multiple = matchContractExcelRecordsToFiles([parsed.records[0]], filesFor('HT-1.pdf', 'HT-1.docx'))
  assert.ok(multiple.issues.some((issue) => issue.code === 'MULTIPLE_PDF_FOR_CONTRACT'))
})

test('CRM 客户按名称匹配时支持唯一、找不到和重名三种结果', () => {
  const parsed = parseContractExcelWorkbook(workbook())
  const lookup = { 示例客户: { status: 'found', id: 42, name: '示例客户（CRM）' } }
  const found = applyContractExcelCustomerLookup(parsed.records, lookup)
  assert.equal(found[0].crmCustomerId, '42')
  assert.equal(found[0].customerName, '示例客户（CRM）')

  const unresolved = applyContractExcelCustomerLookup(parsed.records, {})
  assert.ok(unresolved[0].issues.some((issue) => issue.code === 'CRM_CUSTOMER_LOOKUP_REQUIRED'))

  const notFound = applyContractExcelCustomerLookup(parsed.records, { 示例客户: { status: 'not_found' } })
  assert.ok(notFound[0].issues.some((issue) => issue.code === 'CRM_CUSTOMER_NOT_FOUND'))

  const ambiguous = applyContractExcelCustomerLookup(parsed.records, { 示例客户: { status: 'ambiguous', candidates: [{ id: 1, name: '示例客户' }, { id: 2, name: '示例客户' }] } })
  assert.ok(ambiguous[0].issues.some((issue) => issue.code === 'CRM_CUSTOMER_AMBIGUOUS'))
})

test('构建表单行写入现有详情字段并复用同名文件的行键', () => {
  const parsed = parseContractExcelWorkbook(workbook([mainRow({ crmCustomerId: '42' })]))
  const matched = matchContractExcelRecordsToFiles(parsed.records, filesFor('HT-2026001.pdf'))
  const rows = buildContractExcelImportRows(matched.matchedRecords, { keyByFileName: { 'HT-2026001.pdf': 'row-existing' } })
  assert.equal(rows.length, 1)
  const row = rows[0]
  assert.equal(row.key, 'row-existing')
  assert.equal(row.fileName, 'HT-2026001.pdf')
  assert.equal(row.externalRecordId, 'HT-2026001')
  assert.equal(row.title, '示例合同')
  assert.equal(row.amount, '10000')
  assert.equal(row.serviceItems[0].site, '上海总部')
  assert.equal(row.serviceItems[0].batch, '第一批次')
  const issues = validateImportFormRows(rows, { files: filesFor('HT-2026001.pdf') })
  assert.deepEqual(issues, [])
})

test('分表孤儿行和非法服务项序号阻断并给出定位', () => {
  const parsed = parseContractExcelWorkbook(workbook([mainRow()], {
    services: [
      ['HT-OTHER', 1, '软件测试', '', '北京', '第一批次', '软件测试', '常规检测', ''],
      ['HT-2026001', 1, '软件测试', '', '上海', '第一批次', '软件测试', '常规检测', ''],
    ],
    systems: [['HT-2026001', 9, '系统', '二级']],
  }))
  assert.ok(parsed.issues.some((issue) => issue.code === 'ORPHAN_SERVICE_ROW'))
  assert.ok(parsed.issues.some((issue) => issue.code === 'SYSTEM_SERVICE_INDEX_INVALID'))
})

test('缺失合同明细工作表、空数据行和超过100行均阻断', () => {
  const missing = parseContractExcelWorkbook([{ sheet: '服务项', data: [serviceHeaders] }])
  assert.ok(missing.issues.some((issue) => issue.code === 'EXCEL_SHEET_MISSING'))
  const empty = parseContractExcelWorkbook([{ sheet: '合同明细', data: [mainHeaders] }])
  assert.ok(empty.issues.some((issue) => issue.code === 'EXCEL_NO_RECORDS'))
  const many = Array.from({ length: 101 }, (_, index) => mainRow({ contractNumber: 'HT-' + (index + 1) }))
  const limited = parseContractExcelWorkbook(workbook(many))
  assert.ok(limited.issues.some((issue) => issue.code === 'EXCEL_ROW_LIMIT'))
})

test('金额、日期与数字格式合同编号给出明确问题', () => {
  const parsed = parseContractExcelWorkbook(workbook([mainRow({ amount: 'abc', startDate: '2024-02-30', contractNumber: 'HT-9' })]))
  assert.ok(parsed.issues.some((issue) => issue.code === 'AMOUNT_INVALID'))
  assert.ok(parsed.issues.some((issue) => issue.code === 'DATE_INVALID'))
  const numeric = parseContractExcelWorkbook(workbook([mainRow({ contractNumber: 12345 })]))
  assert.ok(numeric.issues.some((issue) => issue.code === 'CONTRACT_NUMBER_NUMERIC' && issue.blocking === true))
})

test('导入摘要统计合同、匹配和阻断数量', () => {
  const parsed = parseContractExcelWorkbook(workbook([
    mainRow({ contractNumber: 'HT-1' }),
    mainRow({ contractNumber: 'HT-2' }),
  ]))
  const matched = matchContractExcelRecordsToFiles(parsed.records, filesFor('HT-1.pdf'))
  const issues = [...parsed.issues, ...matched.issues]
  const summary = summarizeContractExcelImport({ records: parsed.records, matchedRecords: matched.matchedRecords, issues, files: filesFor('HT-1.pdf') })
  assert.equal(summary.contractCount, 2)
  assert.equal(summary.matchedCount, 1)
  assert.equal(summary.unmatchedFileCount, 0)
  assert.equal(summary.blockingCount, 1)
})

test('下载模板的工作表名和表头与解析器常量一致', async () => {
  const buffer = await readFile(new URL('../../../public/contract-import-template.xlsx', import.meta.url))
  const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
  const sheets = await readXlsxFile(arrayBuffer)
  const byName = new Map(sheets.map((sheet) => [sheet.sheet, sheet.data]))
  assert.deepEqual(byName.get('合同明细')[0], [...contractExcelTemplateHeaders.main])
  assert.deepEqual(byName.get('服务项')[0], [...contractExcelTemplateHeaders.services])
  assert.deepEqual(byName.get('系统信息')[0], [...contractExcelTemplateHeaders.systems])
  assert.deepEqual(byName.get('付款条款')[0], [...contractExcelTemplateHeaders.payments])
})

test('浏览器读取适配层可直接读取 ArrayBuffer 并返回全部工作表', async () => {
  const buffer = await readFile(new URL('../../../public/contract-import-template.xlsx', import.meta.url))
  const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
  const sheets = await readContractExcelWorkbook(arrayBuffer)
  assert.deepEqual(sheets.map((sheet) => sheet.sheet), ['合同明细', '服务项', '系统信息', '付款条款', '填写说明'])
  assert.deepEqual(sheets[0].data[0], [...contractExcelTemplateHeaders.main])
})

test('浏览器读取适配层拒绝无法解析的输入', async () => {
  const arrayBuffer = new TextEncoder().encode('not an xlsx').buffer
  await assert.rejects(() => readContractExcelWorkbook(arrayBuffer), /Excel 文件无法解析|读取 Excel 失败/)
})


test('合同明细主表单条服务项也能挂系统信息分表', () => {
  const parsed = parseContractExcelWorkbook(workbook([mainRow()], {
    systems: [['HT-2026001', 1, '统一身份平台', '二级']],
  }))
  assert.deepEqual(blockingContractExcelIssues(parsed.issues), [])
  assert.deepEqual(parsed.records[0].serviceItems[0].systems, [{ name: '统一身份平台', level: '二级' }])
})

test('ISO 时间戳形式的日期字符串按日期解析', () => {
  const parsed = parseContractExcelWorkbook(workbook([mainRow({ startDate: '2024-01-01T00:00:00Z' })]))
  assert.deepEqual(blockingContractExcelIssues(parsed.issues), [])
  assert.equal(parsed.records[0].startDate, '2024-01-01')
})

test('服务项序号乱序时系统信息仍挂到正确服务项', () => {
  const parsed = parseContractExcelWorkbook(workbook([mainRow({ contractNumber: 'HT-2', serviceType: '', site: '', category: '', testMode: '', requirement: '' })], {
    services: [
      ['HT-2', 2, '等保测评', '', '上海', '第一批次', '等保测评', '常规检测', ''],
      ['HT-2', 1, '软件测试', '', '北京', '第一批次', '软件测试', '常规检测', ''],
    ],
    systems: [['HT-2', 2, '统一身份平台', '二级']],
  }))
  assert.deepEqual(blockingContractExcelIssues(parsed.issues), [])
  const services = parsed.records[0].serviceItems
  assert.deepEqual(services.map((service) => service.serviceType), ['软件测试', '等保测评'])
  assert.deepEqual(services[0].systems, [])
  assert.deepEqual(services[1].systems, [{ name: '统一身份平台', level: '二级' }])
})

test('已有单表 Excel 未按模板命名工作表时仍可识别合同表头', () => {
  const parsed = parseContractExcelWorkbook([{ sheet: 'Sheet1', data: [mainHeaders, mainRow({ crmCustomerId: '42' })] }])
  assert.equal(parsed.records.length, 1)
  assert.ok(parsed.issues.some((issue) => issue.code === 'EXCEL_MAIN_SHEET_FALLBACK' && issue.blocking === false))
  assert.deepEqual(blockingContractExcelIssues(parsed.issues), [])
})

test('Excel 问题定位使用工作表真实行号', () => {
  const parsed = parseContractExcelWorkbook(workbook([
    mainRow({ contractNumber: 'HT-1' }),
    mainRow({ contractNumber: 'HT-2' }),
  ], {
    services: [['HT-NOT-EXIST', 1, '软件测试', '', '北京', '第一批次', '软件测试', '常规检测', '']],
  }))
  assert.equal(parsed.records[1].rowNumber, 3)
  const orphan = parsed.issues.find((issue) => issue.code === 'ORPHAN_SERVICE_ROW')
  assert.equal(orphan?.rowNumber, 2)
})

test('非法日期/金额/客户编号保留原值并由现有逐行校验阻断，不被静默置空', () => {
  const parsed = parseContractExcelWorkbook(workbook([mainRow({
    contractNumber: 'HT-BAD',
    amount: 'abc',
    startDate: '2024-02-30',
    crmCustomerId: 'abc',
  })]))
  const matched = matchContractExcelRecordsToFiles(parsed.records, filesFor('HT-BAD.pdf'))
  const rows = buildContractExcelImportRows(matched.matchedRecords)
  const issues = validateImportFormRows(rows, { files: filesFor('HT-BAD.pdf') })
  assert.ok(issues.some((issue) => issue.field === 'amount'))
  assert.ok(issues.some((issue) => issue.field === 'startDate'))
  assert.ok(issues.some((issue) => issue.field === 'crmCustomerId'))
  assert.equal(rows[0].startDate, '2024-02-30')
  assert.equal(rows[0].amount, 'abc')
  assert.equal(rows[0].crmCustomerId, 'abc')
})

test('服务项序号空洞或重复会阻断，不会把系统信息挂到错误服务项', () => {
  const gap = parseContractExcelWorkbook(workbook([mainRow({ contractNumber: 'HT-2', serviceType: '', site: '', category: '', testMode: '', requirement: '' })], {
    services: [
      ['HT-2', 1, '软件测试', '', '北京', '第一批次', '软件测试', '常规检测', ''],
      ['HT-2', 3, '等保测评', '', '上海', '第一批次', '等保测评', '常规检测', ''],
    ],
    systems: [['HT-2', 2, '统一身份平台', '二级']],
  }))
  assert.ok(gap.issues.some((issue) => issue.code === 'SERVICE_INDEX_INVALID'))
  const duplicate = parseContractExcelWorkbook(workbook([mainRow({ contractNumber: 'HT-2', serviceType: '', site: '', category: '', testMode: '', requirement: '' })], {
    services: [
      ['HT-2', 1, '软件测试', '', '北京', '第一批次', '软件测试', '常规检测', ''],
      ['HT-2', 1, '等保测评', '', '上海', '第一批次', '等保测评', '常规检测', ''],
    ],
  }))
  assert.ok(duplicate.issues.some((issue) => issue.code === 'SERVICE_INDEX_INVALID'))
})

test('多工作表但缺少「合同明细」时不回退主表，避免静默丢失分表详情', () => {
  const parsed = parseContractExcelWorkbook([
    { sheet: 'Sheet1', data: [mainHeaders, mainRow({ crmCustomerId: '42' })] },
    { sheet: '服务项', data: [serviceHeaders, ['HT-2026001', 1, '软件测试', '', '北京', '第一批次', '软件测试', '常规检测', '']] },
  ])
  assert.equal(parsed.records.length, 0)
  assert.ok(parsed.issues.some((issue) => issue.code === 'EXCEL_SHEET_MISSING'))
})
