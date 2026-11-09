import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildImportManifestFromRows,
  createImportFormRow,
  emptyImportServiceItem,
  importRowsFromItems,
  validateImportFormRows,
  importFieldLabel,
  importItemKeyPattern,
} from './utils/contractImportForm.js'

function serviceItem(overrides = {}) {
  return {
    serviceType: '等保测评', name: '', site: '上海总部', batch: '第一批次', category: '等保测评',
    requirement: '', testMode: 'STANDARD', systems: [{ name: '核心业务系统', level: '三级' }],
    ...overrides,
  }
}

function validRow(overrides = {}) {
  return {
    ...createImportFormRow({ fileName: '年度测评合同.pdf', externalRecordId: 'HT-2024-001' }),
    title: '年度等级保护测评合同',
    contractType: '直签',
    crmCustomerId: '42',
    customerName: '示例客户',
    amount: '1234.56',
    currency: 'CNY',
    startDate: '2026-01-02',
    endDate: '2026-12-31',
    serviceItems: [serviceItem()],
    ...overrides,
  }
}

test('最小普通表单生成现有 schema_version=1 清单，键与原件名互相独立', () => {
  const row = validRow()
  const manifest = buildImportManifestFromRows([row], { sourceSystem: 'manual' })
  assert.equal(manifest.schema_version, 1)
  assert.equal(manifest.source_system, 'manual')
  assert.equal(manifest.items.length, 1)
  const [item] = manifest.items
  assert.equal(item.mode, 'NORMAL')
  assert.equal(item.source_file_ref, '年度测评合同.pdf')
  assert.match(item.item_key, importItemKeyPattern)
  assert.equal(item.external_record_id, 'HT-2024-001')
  assert.equal(item.metadata.title, '年度等级保护测评合同')
  assert.equal(item.metadata.contract_type, '直签')
  assert.equal(item.metadata.service_type, '等保测评')
  assert.equal(item.metadata.amount_minor, 123456)
  assert.equal(item.metadata.start_date, '2026-01-02T00:00:00Z')
  assert.equal(item.metadata.end_date, '2026-12-31T00:00:00Z')
  assert.deepEqual(item.metadata.service_items, [{
    service_type: '等保测评', name: '', site: '上海总部', batch: '第一批次', category: '等保测评',
    requirement: '', test_mode: 'STANDARD', systems: [{ name: '核心业务系统', level: '三级' }],
  }])
})

test('金额按元精确转换为整数分，不经过浮点舍入', () => {
  for (const [amount, minor] of [['0.29', 29], ['19.99', 1999], ['1', 100], ['90071992547409.91', 9007199254740991]]) {
    const manifest = buildImportManifestFromRows([validRow({ amount })])
    assert.equal(manifest.items[0].metadata.amount_minor, minor, `${amount} 元`)
  }
  assert.throws(() => buildImportManifestFromRows([validRow({ amount: '1.234' })]), /最多两位小数/)
  assert.throws(() => buildImportManifestFromRows([validRow({ amount: '0' })]), /必须大于零/)
  assert.throws(() => buildImportManifestFromRows([validRow({ amount: '90071992547409.92' })]), /安全/)
})

test('日期为空时提交null，非法日期和倒序被明确阻断', () => {
  const empty = buildImportManifestFromRows([validRow({ startDate: '', endDate: '' })])
  assert.equal(empty.items[0].metadata.start_date, null)
  assert.equal(empty.items[0].metadata.end_date, null)
  assert.throws(() => buildImportManifestFromRows([validRow({ startDate: '2026-02-30' })]), /有效的合同开始日期/)
  assert.throws(() => buildImportManifestFromRows([validRow({ startDate: '2026-12-31', endDate: '2026-01-01' })]), /不能晚于结束日期/)
})

test('服务项至少一条，缺字段、错误检测方式与系统等级逐项定位', () => {
  const missing = validateImportFormRows([validRow({ serviceItems: [] })])
  assert.ok(missing.some((issue) => issue.field === 'serviceItems' && issue.code === 'ITEM_COUNT_INVALID'))
  const issues = validateImportFormRows([validRow({
    serviceItems: [serviceItem({ site: '', testMode: 'QUICK', systems: [{ name: '核心系统', level: '五级' }, { name: '', level: '一级' }] })],
  })])
  const fields = issues.map((issue) => `${issue.field}:${issue.code}`)
  assert.ok(fields.includes('serviceItems.0.site:REQUIRED'))
  assert.ok(fields.includes('serviceItems.0.testMode:UNSUPPORTED_ENUM'))
  assert.ok(fields.includes('serviceItems.0.systems.0.level:UNSUPPORTED_ENUM'))
  assert.ok(fields.includes('serviceItems.0.systems.1.name:REQUIRED'))
  assert.throws(() => buildImportManifestFromRows([validRow({ serviceItems: [serviceItem({ category: '' })] })]), /检测类别/)
})

test('重名原件与空表单失败关闭，不静默丢弃或合并', () => {
  assert.throws(() => buildImportManifestFromRows([]), /至少一份合同原件/)
  assert.throws(() => buildImportManifestFromRows([
    validRow({ externalRecordId: 'HT-1' }),
    validRow({ externalRecordId: 'HT-2' }),
  ]), /同一原件只能导入一次/)
  const issues = validateImportFormRows([
    validRow({ externalRecordId: 'HT-1' }),
    validRow({ externalRecordId: 'HT-2' }),
  ])
  assert.deepEqual(issues.map((issue) => issue.code), ['DUPLICATE_SOURCE_FILE'])
  assert.match(issues[0].message, /第 2 行/)
})

test('空行与缺字段错误按行报告，可定位到具体字段', () => {
  const issueRow = validRow({ title: '', contractType: '三方', crmCustomerId: '', customerName: '', amount: '', currency: 'RMB1' })
  const issues = validateImportFormRows([issueRow])
  const fields = issues.map((issue) => issue.field)
  for (const field of ['title', 'crmCustomerId', 'customerName', 'amount', 'currency']) assert.ok(fields.includes(field), field)
  assert.equal(issues.find((issue) => issue.field === 'title').code, 'REQUIRED')
  const invalid = createImportFormRow({ fileName: '' })
  assert.ok(validateImportFormRows([invalid]).some((issue) => issue.field === 'fileName' && issue.code === 'FILE_MISSING'))
})

test('历史表单必须显式提供历史信息，普通表单契约不变', () => {
  assert.throws(() => buildImportManifestFromRows([validRow()], { mode: 'ARCHIVE_ONLY' }), /请选择当前负责人/)
  assert.doesNotThrow(() => buildImportManifestFromRows([validRow()], { mode: 'NORMAL' }))
})

test('付款条款可选，提供时按合同金额精确校验并规范为两位小数', () => {
  assert.deepEqual(buildImportManifestFromRows([validRow()]).items[0].metadata.payment_terms, [])
  const manifest = buildImportManifestFromRows([validRow({
    paymentTerms: [
      { installment_no: 2, due_date: '2026-06-30', amount: '634.56' },
      { installment_no: 1, due_date: '2026-02-01', amount: '600' },
    ],
  })])
  assert.deepEqual(manifest.items[0].metadata.payment_terms, [
    { installment_no: 1, due_date: '2026-02-01', amount: '600.00' },
    { installment_no: 2, due_date: '2026-06-30', amount: '634.56' },
  ])
  assert.throws(() => buildImportManifestFromRows([validRow({
    paymentTerms: [{ installment_no: 1, due_date: '2026-02-01', amount: '600.00' }],
  })]), /合计必须等于合同金额/)
})

test('已保存普通批次可反填为表单行并再次生成同一业务清单', () => {
  const manifest = buildImportManifestFromRows([validRow()], { sourceSystem: 'legacy' })
  const entries = [{ id: 'item-1', item: manifest.items[0], state: 'PREVIEWED', issues: [], normalized_metadata: { customer_name: '示例客户', crm_customer_id: 42 } }]
  const sources = [{ file_ref: 'opaque-source-1', item_key: manifest.items[0].item_key, filename: '年度测评合同.pdf', state: 'READY' }]
  const [row] = importRowsFromItems(entries, sources)
  assert.equal(row.key, manifest.items[0].item_key)
  assert.equal(row.externalRecordId, manifest.items[0].external_record_id)
  assert.equal(row.fileName, '年度测评合同.pdf')
  assert.equal(row.amount, '1234.56')
  assert.equal(row.startDate, '2026-01-02')
  assert.equal(row.normalized.customer_name, '示例客户')
  assert.deepEqual(validateImportFormRows([row], { files: [], sources }), [])
  const rebuilt = buildImportManifestFromRows([row], { sourceSystem: 'legacy', sources })
  assert.deepEqual(rebuilt.items[0].metadata, manifest.items[0].metadata)
  assert.equal(rebuilt.items[0].source_file_ref, '年度测评合同.pdf')
})

test('表单标识只随机生成 item_key，来源业务键为空并等待显式填写', () => {
  const first = createImportFormRow({ fileName: '中文 合同 原件.pdf' })
  const second = createImportFormRow({ fileName: '中文 合同 原件.pdf' })
  assert.match(first.key, importItemKeyPattern)
  assert.notEqual(first.key, second.key)
  assert.equal(first.externalRecordId, '')
  assert.equal(second.externalRecordId, '')
  assert.equal(createImportFormRow({ fileName: '合同A.pdf', externalRecordId: 'HT-2024-001' }).externalRecordId, 'HT-2024-001')
  assert.equal(first.title, '中文 合同 原件')
  assert.deepEqual(emptyImportServiceItem(), {
    serviceType: '', name: '', site: '', batch: '第一批次', category: '', requirement: '', testMode: 'STANDARD', systems: [],
  })
})

test('ASCII 文件名也不自动充当来源业务键，显式值才进入清单', () => {
  const blank = createImportFormRow({ fileName: 'contract-001.pdf' })
  assert.equal(blank.externalRecordId, '')
  const manifest = buildImportManifestFromRows([validRow({ externalRecordId: 'contract-001' })])
  assert.equal(manifest.items[0].external_record_id, 'contract-001')
})

test('来源业务键必填、限 ASCII 1—128 且在批次内唯一，错误按行定位', () => {
  const message = /来源业务键（原系统合同编号\/业务键）不能为空[^。]*且不能重复/
  const missing = validateImportFormRows([validRow({ externalRecordId: '' })])
  assert.deepEqual(missing.map((issue) => `${issue.field}:${issue.code}`), ['externalRecordId:REQUIRED'])
  assert.match(missing[0].message, message)
  assert.throws(() => buildImportManifestFromRows([validRow({ externalRecordId: '' })]), message)
  for (const invalid of ['合同-2024-001', 'HT 2024 001', `A${'1'.repeat(128)}`]) {
    const issues = validateImportFormRows([validRow({ externalRecordId: invalid })])
    assert.ok(issues.some((issue) => issue.field === 'externalRecordId' && issue.code === 'INVALID'), invalid)
    assert.throws(() => buildImportManifestFromRows([validRow({ externalRecordId: invalid })]), message)
  }
  const duplicate = validateImportFormRows([
    validRow({ fileName: '一.pdf', externalRecordId: 'HT-2024-001' }),
    validRow({ fileName: '二.pdf', externalRecordId: 'HT-2024-001' }),
  ])
  assert.deepEqual(duplicate.map((issue) => `${issue.field}:${issue.code}`), ['externalRecordId:DUPLICATE_EXTERNAL_RECORD_ID'])
  assert.match(duplicate[0].message, /第 2 行（二\.pdf）：来源业务键/)
  assert.throws(() => buildImportManifestFromRows([
    validRow({ fileName: '一.pdf', externalRecordId: 'HT-2024-001' }),
    validRow({ fileName: '二.pdf', externalRecordId: 'HT-2024-001' }),
  ]), message)
  assert.doesNotThrow(() => buildImportManifestFromRows([
    validRow({ fileName: '一.pdf', externalRecordId: 'HT-2024-001' }),
    validRow({ fileName: '二.pdf', externalRecordId: 'HT-2024-002' }),
  ]))
})

test('预检字段路径转为业务可读中文，未知路径保留原文', () => {
  assert.equal(importFieldLabel('metadata.amount_minor'), '合同金额')
  assert.equal(importFieldLabel('metadata.service_items[0].site'), '服务项 1 · 实施场所')
  assert.equal(importFieldLabel('metadata.service_items[2].systems[1].level'), '服务项 3 · 系统 2 · 系统等级')
  assert.equal(importFieldLabel('metadata.unknown_field'), 'metadata.unknown_field')

  // 服务端点号索引 + snake_case（服务端预检返回写法）。
  assert.equal(importFieldLabel('metadata.service_items.0.category'), '服务项 1 · 检测类别')
  assert.equal(importFieldLabel('metadata.service_items[0].category'), '服务项 1 · 检测类别')
  assert.equal(importFieldLabel('metadata.service_items.2.systems.1.level'), '服务项 3 · 系统 2 · 系统等级')
  assert.equal(importFieldLabel('metadata.service_items[2].systems[1].level'), '服务项 3 · 系统 2 · 系统等级')

  // 本地校验器生成的驼峰路径（无 metadata 前缀、点号索引）。
  assert.equal(importFieldLabel('serviceItems.0.serviceType'), '服务项 1 · 服务类型')
  assert.equal(importFieldLabel('serviceItems.0.categoryId'), '服务项 1 · 本地类别')
  assert.equal(importFieldLabel('serviceItems.0.categoryVersion'), '服务项 1 · 类别版本')
  assert.equal(importFieldLabel('serviceItems.0.testMode'), '服务项 1 · 检测方式')
  assert.equal(importFieldLabel('serviceItems.0.systems'), '服务项 1 · 系统信息')
  assert.equal(importFieldLabel('serviceItems.0.systems.0.name'), '服务项 1 · 系统 1 · 系统名称')
  assert.equal(importFieldLabel('serviceItems.0.systems[0].name'), '服务项 1 · 系统 1 · 系统名称')
  assert.equal(importFieldLabel('serviceItems.0.systems.1.level'), '服务项 1 · 系统 2 · 系统等级')

  // 顶层驼峰路径复用 metadata 同义文案。
  assert.equal(importFieldLabel('serviceItems'), '服务项')
  assert.equal(importFieldLabel('paymentTerms'), '付款条款')
  assert.equal(importFieldLabel('externalPaperNumber'), '外部纸面编号')
  assert.equal(importFieldLabel('customerType'), '客户类型')
  assert.equal(importFieldLabel('industry'), '行业')
  assert.equal(importFieldLabel('region'), '地区')
  assert.equal(importFieldLabel('opportunityId'), '商机编号')
  assert.equal(importFieldLabel('categorySource'), '类别来源')
  assert.equal(importFieldLabel('endDate'), '结束日期')

  // 未识别路径仍原样返回，不被归一化改写。
  assert.equal(importFieldLabel('metadata.unknown_field'), 'metadata.unknown_field')
  assert.equal(importFieldLabel('serviceItems.0.unknownField'), '服务项 1 · unknownField')
  assert.equal(importFieldLabel('unknown.camelPath'), 'unknown.camelPath')
  assert.equal(importFieldLabel(''), '合同字段')
})

test('NORMAL表单LOCAL引用可生成并恢复，版本与原source_id身份不丢失', () => {
  const row = validRow({ crmCustomerId: '', counterpartySource: 'LOCAL', localCounterpartyId: '01J00000000000000000000001', counterpartyVersion: 2, categorySource: 'LOCAL', serviceItems: [serviceItem({ sourceId: 'original-service', categoryId: '01J00000000000000000000002', categoryVersion: 3 })] })
  assert.deepEqual(validateImportFormRows([row]), [])
  const manifest = buildImportManifestFromRows([row])
  const metadata = manifest.items[0].metadata
  assert.equal(metadata.counterparty_source, 'LOCAL')
  assert.equal(metadata.local_counterparty_id, row.localCounterpartyId)
  assert.equal(metadata.crm_customer_id, 0)
  assert.equal(metadata.service_items[0].category_version, 3)
  assert.equal(metadata.service_items[0].source_id, 'original-service')
  const restored = importRowsFromItems([{ item: manifest.items[0], normalized_metadata: metadata }])[0]
  assert.equal(restored.counterpartySource, 'LOCAL')
  assert.equal(restored.counterpartyVersion, 2)
  assert.equal(restored.serviceItems[0].sourceId, 'original-service')
  assert.equal(restored.serviceItems[0].categoryId, '01J00000000000000000000002')
  const legacy = buildImportManifestFromRows([validRow()]).items[0].metadata
  assert.equal(Object.hasOwn(legacy, 'counterparty_source'), false)
  assert.equal(Object.hasOwn(legacy.service_items[0], 'category_id'), false)
})

test('销售姓名进入 metadata 白名单且非必填，可从已保存清单恢复', () => {
  assert.equal(createImportFormRow({ fileName: '合同A.pdf' }).salesName, '')
  // 留空不产生任何行级问题，也不阻断清单生成。
  assert.deepEqual(validateImportFormRows([validRow()], { files: [], sources: [] }), [])
  assert.equal(buildImportManifestFromRows([validRow()]).items[0].metadata.sales_name, '')
  assert.equal(importFieldLabel('metadata.sales_name'), '销售姓名')

  const row = validRow({ salesName: '  张销售  ' })
  assert.deepEqual(validateImportFormRows([row], { files: [], sources: [] }), [])
  const manifest = buildImportManifestFromRows([row], { sourceSystem: 'manual' })
  assert.equal(manifest.items[0].metadata.sales_name, '张销售')

  const restored = importRowsFromItems([{ item: manifest.items[0], state: 'PREVIEWED', issues: [] }])[0]
  assert.equal(restored.salesName, '张销售')
  assert.equal(buildImportManifestFromRows([restored]).items[0].metadata.sales_name, '张销售')
})

test('客户类型/行业/地区进入 metadata 白名单且非必填，可从已保存清单恢复', () => {
  const blank = createImportFormRow({ fileName: '合同A.pdf' })
  assert.equal(blank.customerType, '')
  assert.equal(blank.industry, '')
  assert.equal(blank.region, '')
  // 留空不产生任何行级问题，也不阻断清单生成。
  assert.deepEqual(validateImportFormRows([validRow()], { files: [], sources: [] }), [])
  const blankMetadata = buildImportManifestFromRows([validRow()]).items[0].metadata
  assert.equal(blankMetadata.customer_type, '')
  assert.equal(blankMetadata.industry, '')
  assert.equal(blankMetadata.region, '')
  assert.equal(importFieldLabel('metadata.customer_type'), '客户类型')
  assert.equal(importFieldLabel('metadata.industry'), '行业')
  assert.equal(importFieldLabel('metadata.region'), '地区')

  const row = validRow({ customerType: '  企业  ', industry: ' 金融 ', region: ' 华东 ' })
  assert.deepEqual(validateImportFormRows([row], { files: [], sources: [] }), [])
  const manifest = buildImportManifestFromRows([row], { sourceSystem: 'manual' })
  assert.equal(manifest.items[0].metadata.customer_type, '企业')
  assert.equal(manifest.items[0].metadata.industry, '金融')
  assert.equal(manifest.items[0].metadata.region, '华东')

  // 已保存批次反填后仍能生成同一业务清单，草稿续填不会丢字段。
  const sources = [{ file_ref: 'opaque-source-1', item_key: manifest.items[0].item_key, filename: '年度测评合同.pdf', state: 'READY' }]
  const restored = importRowsFromItems([{ item: manifest.items[0], state: 'PREVIEWED', issues: [] }], sources)[0]
  assert.equal(restored.customerType, '企业')
  assert.equal(restored.industry, '金融')
  assert.equal(restored.region, '华东')
  const rebuilt = buildImportManifestFromRows([restored], { sources })
  assert.equal(rebuilt.items[0].metadata.customer_type, '企业')
  assert.equal(rebuilt.items[0].metadata.industry, '金融')
  assert.equal(rebuilt.items[0].metadata.region, '华东')
})

test('客户类型/行业/地区超过 64 字按行阻断，边界值放行', () => {
  for (const [field, code] of [['customerType', 'TOO_LONG'], ['industry', 'TOO_LONG'], ['region', 'TOO_LONG']]) {
    const row = validRow({ [field]: '字'.repeat(65) })
    const issues = validateImportFormRows([row], { files: [], sources: [] })
    assert.deepEqual(issues.map((issue) => [issue.field, issue.code]), [[field, code]], field)
  }
  const boundary = validRow({ customerType: '字'.repeat(64), industry: '字'.repeat(64), region: '字'.repeat(64) })
  assert.deepEqual(validateImportFormRows([boundary], { files: [], sources: [] }), [])
})
