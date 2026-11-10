import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import readXlsxFile from 'read-excel-file/universal'
import { applyContractExcelCustomerLookup, blockingContractExcelIssues, buildContractExcelImportRows,
  contractExcelTemplateHeaders, matchContractExcelRecordsToFiles, parseContractExcelWorkbook,
  summarizeContractExcelImport } from './utils/contractExcelImport.js'
import { readContractExcelWorkbook } from './utils/contractExcelReader.js'
import { validateImportFormRows } from './utils/contractImportForm.js'
import { historyExcelHeaders, historyFactHeaders } from './utils/contractHistoryExcel.js'

const mainHeaders = [...contractExcelTemplateHeaders.main]
const serviceHeaders = [...contractExcelTemplateHeaders.services]
const systemHeaders = [...contractExcelTemplateHeaders.systems]
const paymentHeaders = [...contractExcelTemplateHeaders.payments]

function cellForHeader(header, values = {}) {
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
  if (header === '销售姓名') return values.salesName ?? ''
  if (header === '客户类型') return values.customerType ?? ''
  if (header === '行业') return values.industry ?? ''
  if (header === '地区') return values.region ?? ''
  return values[header] ?? ''
}

function mainRow(values = {}) {
  return mainHeaders.map((header) => cellForHeader(header, values))
}

function customRow(headers, values = {}, overrides = {}) {
  return headers.map((header) => (Object.hasOwn(overrides, header) ? overrides[header] : cellForHeader(header, values)))
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
  // 模板「合同明细」末尾 4 列必须与常量顺序一致，且「销售姓名」只能出现一次（重复列会让后加的列被静默忽略）。
  assert.deepEqual(byName.get('合同明细')[0].slice(-5, -1), ['销售姓名', '客户类型', '行业', '地区'])
  const mainHeaderRow = byName.get('合同明细')[0]
  for (const header of ['销售姓名', '客户类型', '行业', '地区']) {
    assert.equal(mainHeaderRow.filter((cell) => cell === header).length, 1, header)
  }
  assert.deepEqual([...byName.keys()], ['合同明细', '服务项', '系统信息', '付款条款', '填写说明', '历史档案'])
  assert.deepEqual(byName.get('历史档案')[0], historyExcelHeaders)
  assert.equal(byName.has('历史财务事实'), false)
  assert.equal(byName.get('合同明细')[0].at(-1), '当前负责人')
})

test('浏览器读取适配层可直接读取 ArrayBuffer 并返回全部工作表', async () => {
  const buffer = await readFile(new URL('../../../public/contract-import-template.xlsx', import.meta.url))
  const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
  const sheets = await readContractExcelWorkbook(arrayBuffer)
  assert.deepEqual(sheets.map((sheet) => sheet.sheet), ['合同明细', '服务项', '系统信息', '付款条款', '填写说明', '历史档案'])
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

test('「销售姓名」列支持别名、可留空，并写入表单行', () => {
  // 标准模板已把「销售姓名」放在末尾，别名用例改用不含该列表头，避免同名列重复后只认第一处。
  const headersWithoutSalesName = mainHeaders.filter((header) => header !== '销售姓名')
  for (const alias of ['销售姓名', '销售', '业务员', '负责人姓名']) {
    const headers = [...headersWithoutSalesName, alias]
    const parsed = parseContractExcelWorkbook([{ sheet: '合同明细', data: [headers, customRow(headers, { crmCustomerId: '42' }, { [alias]: '张销售' })] }])
    assert.deepEqual(blockingContractExcelIssues(parsed.issues), [], alias)
    assert.equal(parsed.records[0].salesName, '张销售', alias)
    const matched = matchContractExcelRecordsToFiles(parsed.records, filesFor('HT-2026001.pdf'))
    const rows = buildContractExcelImportRows(matched.matchedRecords)
    assert.equal(rows[0].salesName, '张销售', alias)
    assert.deepEqual(validateImportFormRows(rows, { files: filesFor('HT-2026001.pdf') }), [], alias)
  }
  const parsed = parseContractExcelWorkbook(workbook([mainRow({ crmCustomerId: '42', salesName: '' })]))
  assert.deepEqual(blockingContractExcelIssues(parsed.issues), [])
  assert.equal(parsed.records[0].salesName, '')
  const matched = matchContractExcelRecordsToFiles(parsed.records, filesFor('HT-2026001.pdf'))
  const rows = buildContractExcelImportRows(matched.matchedRecords)
  assert.equal(rows[0].salesName, '')
  // 销售姓名留空不是必填项，行校验不受影响。
  assert.deepEqual(validateImportFormRows(rows, { files: filesFor('HT-2026001.pdf') }), [])
})

test('「客户类型/行业/地区」三列解析、可留空并写入表单行', () => {
  const parsed = parseContractExcelWorkbook(workbook([mainRow({ crmCustomerId: '42', customerType: '企业', industry: '金融', region: '华东' })]))
  assert.deepEqual(blockingContractExcelIssues(parsed.issues), [])
  const record = parsed.records[0]
  assert.equal(record.customerType, '企业')
  assert.equal(record.industry, '金融')
  assert.equal(record.region, '华东')
  const matched = matchContractExcelRecordsToFiles(parsed.records, filesFor('HT-2026001.pdf'))
  const rows = buildContractExcelImportRows(matched.matchedRecords)
  assert.equal(rows[0].customerType, '企业')
  assert.equal(rows[0].industry, '金融')
  assert.equal(rows[0].region, '华东')
  assert.deepEqual(validateImportFormRows(rows, { files: filesFor('HT-2026001.pdf') }), [])

  // 三列不是必填项：留空不产生任何阻断问题，表单行保持空串。
  const blank = parseContractExcelWorkbook(workbook([mainRow({ crmCustomerId: '42' })]))
  assert.deepEqual(blockingContractExcelIssues(blank.issues), [])
  assert.equal(blank.records[0].customerType, '')
  assert.equal(blank.records[0].industry, '')
  assert.equal(blank.records[0].region, '')
  const blankRows = buildContractExcelImportRows(matchContractExcelRecordsToFiles(blank.records, filesFor('HT-2026001.pdf')).matchedRecords)
  assert.equal(blankRows[0].customerType, '')
  assert.equal(blankRows[0].industry, '')
  assert.equal(blankRows[0].region, '')
  assert.deepEqual(validateImportFormRows(blankRows, { files: filesFor('HT-2026001.pdf') }), [])
})

test('「客户类型/行业/地区」支持别名，且不误判「合同类型」', () => {
  const headers = mainHeaders.map((header) => {
    if (header === '客户类型') return '客户类型'
    if (header === '行业') return '所属行业'
    if (header === '地区') return '所属地区'
    return header
  })
  const parsed = parseContractExcelWorkbook([{ sheet: '合同明细', data: [headers, customRow(headers, { crmCustomerId: '42', contractType: '三方' }, { 客户类型: '政府', 所属行业: '政务', 所属地区: '华北' })] }])
  assert.deepEqual(blockingContractExcelIssues(parsed.issues), [])
  const record = parsed.records[0]
  // 「合同类型」与「客户类型」是两个字段，别名不得互相覆盖。
  assert.equal(record.contractType, '三方')
  assert.equal(record.customerType, '政府')
  assert.equal(record.industry, '政务')
  assert.equal(record.region, '华北')
  assert.deepEqual(contractExcelTemplateHeaders.main.slice(-5, -1), ['销售姓名', '客户类型', '行业', '地区'])
})

test('「客户类型/行业/地区」超长按 64 字上限阻断，可定位到具体列', () => {
  const tooLong = '企'.repeat(65)
  const parsed = parseContractExcelWorkbook(workbook([mainRow({ crmCustomerId: '42', customerType: tooLong, industry: '金融', region: tooLong })]))
  const blocking = blockingContractExcelIssues(parsed.issues)
  assert.deepEqual(blocking.map((issue) => issue.field).sort(), ['customerType', 'region'])
  assert.ok(blocking.every((issue) => issue.code === 'TOO_LONG'))
  // 上限是 64 个字（按字符计，不按字节），64 个字仍允许。
  const boundary = parseContractExcelWorkbook(workbook([mainRow({ crmCustomerId: '42', customerType: '企'.repeat(64), industry: '金'.repeat(64), region: '华'.repeat(64) })]))
  assert.deepEqual(blockingContractExcelIssues(boundary.issues), [])
})
