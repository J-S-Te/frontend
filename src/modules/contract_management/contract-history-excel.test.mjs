import test from 'node:test'
import assert from 'node:assert/strict'
import { readHistoryExcelRecords, historyImportDetails, validateHistoryImportDetails }
  from './utils/contractHistoryExcel.js'
import { buildImportManifestFromRows, importRowsFromItems, createImportFormRow }
  from './utils/contractImportForm.js'
import { prepareImportManifest } from './utils/contractImport.js'
import { readFile } from 'node:fs/promises'
import { readContractExcelWorkbook } from './utils/contractExcelReader.js'
import { buildContractExcelImportRows, parseContractExcelWorkbook, matchContractExcelRecordsToFiles }
  from './utils/contractExcelImport.js'

// historyRow 构造没有CRM引用、等待服务端开立的合成历史行。
// 参数：无。
// 返回值：满足合同基础字段校验的行，不使用真实业务数据。
function historyRow() {
  const row = createImportFormRow({ fileName: 'OLD-1.pdf', key: 'old-1', externalRecordId: 'OLD-1' })
  return Object.assign(row, { title: '合成历史合同', contractType: '直签', customerName: '合成客户',
    salesName: '合成销售', customerContact: '合成联系人', customerPhone: '13800000000',
    amount: '50000', startDate: '2025-01-01', endDate: '2025-12-31',
    serviceItems: [{ serviceType: '等保测评', site: '合成现场', batch: '一',
      category: '等保测评', testMode: 'STANDARD', systems: [] }] })
}

const defaults = { targetOwnerUserID: 'actor', historicalStatus: 'archived',
  declaredSignedDate: '2025-01-01', historicalOwnerLabel: '原销售',
  financeMode: 'EVIDENCE_ONLY', reportMode: 'HISTORICAL_SEPARATE', reportChannels: 'API_ONLY' }

test('新历史Excel清单固定不参与结算，旧页面财务选项不能改变新策略', () => {
  for (const mode of ['ARCHIVE_ONLY', 'HISTORICAL_CLOSED']) {
    const item = buildImportManifestFromRows([historyRow()], { mode,
      historyOptions: { ...defaults, financeMode: 'FULL_REPLAY', noHistoricalFacts: true } }).items[0]
    assert.equal(item.policy_options.finance_mode, 'NONE')
    assert.equal(item.history_evidence.expected_facts, undefined)
    assert.deepEqual(validateHistoryImportDetails(item, mode), [])
  }
})

test('旧Excel若填写了财务策略或事实必须明确阻断，不能静默丢掉财务资料', () => {
  const result = readHistoryExcelRecords([
    { sheet: '历史档案', data: [['合同编号', '财务处理方式'], ['OLD-1', '重建历史台账']] },
    { sheet: '历史财务事实', data: [['合同编号', '来源系统', '事实类型', '原事实编号'], ['OLD-1', 'old', '收款', 'r1']] },
  ], [{ contractNumber: 'OLD-1' }])
  assert.equal(result.issues.filter(issue => issue.code === 'HISTORY_FINANCE_NOT_APPLICABLE').length, 2)
})

test('历史Excel保留原签署日期并默认只同步合同档案，不采集财务事实', () => {
  const result = readHistoryExcelRecords([{ sheet: '历史档案', data: [
    ['合同编号', '原签署日期', '原合同状态', '原客户名称', '原负责人', '报表统计方式'],
    ['OLD-1', '2025-02-03', '已完成', '原客户', '原销售', '历史单独统计'],
  ] }], [{ contractNumber: 'OLD-1', currentOwnerName: '现任负责人' }])
  assert.deepEqual(result.issues, [])
  const detail = historyImportDetails(result.records[0], 'HISTORICAL_CLOSED', defaults)
  assert.equal(detail.history_evidence.declared_signed_date, '2025-02-03')
  assert.equal(detail.history_evidence.historical_status, 'completed')
  assert.equal(detail.history_evidence.target_owner_name, '现任负责人')
  assert.equal(detail.history_evidence.target_owner_user_id, '')
  assert.equal(detail.history_evidence.report_required_channels, 'API_ONLY')
  assert.equal(detail.policy_options.finance_mode, 'NONE')
  assert.equal(detail.history_evidence.expected_facts, undefined)
})

test('两种历史模式可由Excel行生成完整清单，客户编号为空交给后端查重', () => {
  for (const mode of ['ARCHIVE_ONLY', 'HISTORICAL_CLOSED']) {
    const row = historyRow()
    const manifest = buildImportManifestFromRows([row], { mode, sourceSystem: 'legacy', historyOptions: defaults })
    const item = manifest.items[0]
    assert.equal(item.mode, mode)
    assert.equal(item.metadata.crm_customer_id, 0)
    assert.equal(item.history_evidence.target_owner_user_id, 'actor')
    assert.equal(item.policy_options.project_mode, 'NONE')
    assert.equal(item.policy_options.finance_mode, 'NONE')
    assert.equal(item.metadata.sales_name, '合成销售')
    const [restored] = importRowsFromItems([{ item, state: 'READY', issues: [] }], [])
    const rebuilt = buildImportManifestFromRows([restored], { mode, sourceSystem: 'legacy' })
    assert.deepEqual(rebuilt, manifest)
  }
})

test('客户引用与商机引用仍严格校验，普通模式不接受空客户', () => {
  const row = historyRow()
  assert.throws(() => buildImportManifestFromRows([row]), /CRM 客户编号/)
  row.opportunityName = '只填名称'
  assert.throws(() => buildImportManifestFromRows([row], {
    mode: 'ARCHIVE_ONLY', historyOptions: defaults,
  }), /CRM 客户编号|商机编号/)
})

test('历史证据缺失、财务事实空白与非法组合不能被默认值掩盖', () => {
  assert.ok(validateHistoryImportDetails(historyImportDetails({}, 'ARCHIVE_ONLY', {}), 'ARCHIVE_ONLY').length)
  const replay = historyImportDetails({ policyOptions: { finance_mode: 'FULL_REPLAY' } }, 'HISTORICAL_CLOSED', defaults)
  assert.ok(validateHistoryImportDetails(replay, 'HISTORICAL_CLOSED').some(i => i.field.includes('expected_facts')))
  const none = historyImportDetails({ historyEvidence: { expected_facts: [] }, policyOptions: { finance_mode: 'FULL_REPLAY' } }, 'HISTORICAL_CLOSED',
    { ...defaults, financeMode: 'FULL_REPLAY' })
  assert.deepEqual(validateHistoryImportDetails(none, 'HISTORICAL_CLOSED'), [])
  const invalid = historyImportDetails({ policyOptions: { project_mode: 'CREATE_NEW' } }, 'ARCHIVE_ONLY', defaults)
  assert.ok(validateHistoryImportDetails(invalid, 'ARCHIVE_ONLY').length)
})

test('历史分表重复、孤立事实和非法日期逐行报错，不能静默丢失', () => {
  const result = readHistoryExcelRecords([
    { sheet: '历史档案', data: [['合同编号', '原签署日期'], ['OLD-1', '2025-02-30'], ['OLD-1', '']] },
    { sheet: '历史财务事实', data: [['合同编号', '来源系统', '事实类型', '原事实编号'], ['missing', 'legacy', '收款', 'r1']] },
  ], [{ contractNumber: 'OLD-1' }])
  assert.ok(result.issues.some(i => i.code === 'HISTORY_DATE_INVALID'))
  assert.ok(result.issues.some(i => i.code === 'HISTORY_DUPLICATE'))
  assert.ok(result.issues.some(i => i.code === 'HISTORY_FINANCE_NOT_APPLICABLE'))
})

test('恢复同名多代原件时保留当前精确file_ref，不能猜最新或丢引用', () => {
  const manifest = buildImportManifestFromRows([historyRow()], { mode: 'ARCHIVE_ONLY', historyOptions: defaults })
  manifest.items[0].source_file_ref = 'file-current'
  const sources = ['file-old', 'file-current'].map(file_ref => ({ item_key: 'old-1', filename: 'OLD-1.pdf', file_ref, state: 'READY' }))
  const restored = importRowsFromItems([{ item: manifest.items[0], state: 'READY', issues: [] }], sources)
  const rebuilt = buildImportManifestFromRows(restored, { mode: 'ARCHIVE_ONLY', sources })
  assert.equal(rebuilt.items[0].source_file_ref, 'file-current')
  const prepared = prepareImportManifest(JSON.stringify(rebuilt), [], sources, ['ARCHIVE_ONLY'], 'ARCHIVE_ONLY')
  assert.equal(prepared.stagedByKey.get('old-1'), 'file-current')
})

test('历史档案空白列使用已明确填写的本批值，不能静默清空来源信息', () => {
  const parsed = readHistoryExcelRecords([{ sheet: '历史档案', data: [
    ['合同编号', '原签署日期', '原客户名称', '原负责人'], ['OLD-1', '', '', ''],
  ] }], [{ contractNumber: 'OLD-1' }])
  const detail = historyImportDetails(parsed.records[0], 'ARCHIVE_ONLY', {
    ...defaults, historicalCustomerName: '原客户名称',
  })
  assert.equal(detail.history_evidence.declared_signed_date, '2025-01-01')
  assert.equal(detail.history_evidence.historical_customer_name, '原客户名称')
  assert.equal(detail.history_evidence.historical_owner_label, '原销售')
})

test('PARTIAL已建项保留冻结原清单，不受批量历史信息或表单修改影响', () => {
  const manifest = buildImportManifestFromRows([historyRow()], { mode: 'ARCHIVE_ONLY', historyOptions: defaults })
  const item = manifest.items[0]
  const restored = importRowsFromItems([{ item, contract_id: 'created-contract', state: 'CREATED', issues: [] }])
  restored[0].title = '不得改写已建合同'
  restored[0].historyEvidence.declared_signed_date = ''
  const rebuilt = buildImportManifestFromRows(restored, { mode: 'ARCHIVE_ONLY' })
  assert.deepEqual(rebuilt.items[0], item)
})

test('实际下载模板的历史分表可生成后端完整清单，无需手写JSON', async () => {
  const buffer = await readFile(new URL('../../../public/contract-import-template.xlsx', import.meta.url))
  const sheets = await readContractExcelWorkbook(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength))
  const values = { 合同编号: 'OLD-1', 合同标题: '合成历史合同', 合同类型: '直签', 服务类型: '等保测评',
    客户名称: '合成客户', 当前负责人: '现任负责人', 客户联系人: '合成联系人', 客户联系电话: '13800000000', 销售姓名: '合成销售',
    '金额（元）': '50000', 币种: 'CNY', 开始日期: '2025-01-01', 实施场所: '合成现场',
    实施批次: '一', 检测类别: '等保测评', 检测方式: '常规检测' }
  const main = sheets.find(sheet => sheet.sheet === '合同明细').data
  main.push(main[0].map(header => values[header] ?? null))
  const history = sheets.find(sheet => sheet.sheet === '历史档案').data
  history.push(['OLD-1', '2025-02-03', '已归档', '原客户', '原销售', null])
  const parsed = parseContractExcelWorkbook(sheets)
  assert.deepEqual(parsed.issues, [])
  const read = readHistoryExcelRecords(sheets, parsed.records)
  assert.deepEqual(read.issues, [])
  const files = [{ name: 'OLD-1.pdf' }]
  const matched = matchContractExcelRecordsToFiles(read.records, files)
  const rows = buildContractExcelImportRows(matched.matchedRecords)
  const manifest = buildImportManifestFromRows(rows, { files, mode: 'ARCHIVE_ONLY',
    sourceSystem: 'legacy', historyOptions: { targetOwnerUserID: 'actor' } })
  assert.equal(manifest.items[0].history_evidence.declared_signed_date, '2025-02-03')
  assert.equal(manifest.items[0].metadata.crm_customer_id, 0)
  assert.equal(manifest.items[0].history_evidence.target_owner_name, '现任负责人')
  assert.equal(manifest.items[0].history_evidence.historical_owner_label, '原销售')
  assert.doesNotThrow(() => prepareImportManifest(JSON.stringify(manifest), files, [], ['ARCHIVE_ONLY'], 'ARCHIVE_ONLY'))
})
