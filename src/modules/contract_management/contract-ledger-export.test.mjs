import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { escapeCsvCell } from '../platform/iam/utils/csvExport.js'
import {
  collectContractLedgerExport,
  CONTRACT_LEDGER_EXPORT_LIMIT,
  CONTRACT_LEDGER_EXPORT_PAGE_SIZE,
} from './utils/contractLedgerExport.js'

const view = await readFile(new URL('./views/ContractManagementView.vue', import.meta.url), 'utf8')

// ledgerRow 构造一份分页服务端返回的原始合同记录。
// 参数：index 为序号；返回值：与后端 GET /contracts 字段一致的合同对象。
function ledgerRow(index) {
  return {
    id: `record-${index}`,
    contract_number: `HT-${String(index).padStart(5, '0')}`,
    title: `合同 ${index}`,
    contract_type: '服务合同',
    service_type: '运维服务',
    amount_minor: index * 100,
    owner_display_name: '张三',
    status: 'active',
  }
}

// paginated 用可控的假服务端模拟 GET /contracts 分页信封，并记录每次请求参数。
// 参数：total 为服务端总数；返回值：fetchPage 与 calls 记录。
function paginated(total) {
  const calls = []
  const rows = Array.from({ length: total }, (_, index) => ledgerRow(index + 1))
  const fetchPage = async (query) => {
    calls.push({ ...query })
    const start = (query.page - 1) * query.page_size
    return {
      items: rows.slice(start, start + query.page_size),
      total,
      page: query.page,
      page_size: query.page_size,
    }
  }
  return { fetchPage, calls }
}

// 回归锁定 L1：导出必须跟随当前筛选逐页读取全部命中，而不是只导当前页 20 条。
// 350 条筛选结果按 page_size=200 分两页读取：page=1（200 条）+ page=2（200 条请求、实际 150 条）。
test('350 条筛选结果按 page_size=200 逐页导出，请求次数与顺序固定', async () => {
  const { fetchPage, calls } = paginated(350)
  const progress = []
  const result = await collectContractLedgerExport(fetchPage, {
    filters: { keyword: '示例客户', status: 'active', type: '服务合同' },
    pageSize: CONTRACT_LEDGER_EXPORT_PAGE_SIZE,
    limit: CONTRACT_LEDGER_EXPORT_LIMIT,
    onProgress: (value) => progress.push(value),
  })

  assert.deepEqual(calls, [
    { keyword: '示例客户', status: 'active', type: '服务合同', page: 1, page_size: 200 },
    { keyword: '示例客户', status: 'active', type: '服务合同', page: 2, page_size: 200 },
  ])
  assert.equal(result.items.length, 350)
  assert.equal(result.total, 350)
  assert.equal(result.truncated, false)
  assert.deepEqual(progress, [{ fetched: 200, total: 350 }, { fetched: 350, total: 350 }])
})

// 回归锁定：导出有硬上限；撞到上限时必须报告 truncated，调用方据此明确告知用户，
// 不允许静默截断或把 20 条当成全量。
test('超过 10 000 行硬上限时导出前 10 000 条并标记 truncated', async () => {
  const { fetchPage, calls } = paginated(25000)
  const result = await collectContractLedgerExport(fetchPage, {
    filters: { keyword: '' },
    pageSize: 200,
    limit: 10000,
  })

  assert.equal(CONTRACT_LEDGER_EXPORT_LIMIT, 10000)
  assert.equal(calls.length, 50)
  assert.deepEqual(calls[0], { keyword: '', page: 1, page_size: 200 })
  assert.deepEqual(calls.at(-1), { keyword: '', page: 50, page_size: 200 })
  assert.equal(result.items.length, 10000)
  assert.equal(result.total, 25000)
  assert.equal(result.truncated, true)
})

// 回归锁定：服务端 total 收齐后不再多请求一页（避免多打一次空页请求）。
test('恰好取满 total 时不会多发一页请求', async () => {
  const { fetchPage, calls } = paginated(400)
  const result = await collectContractLedgerExport(fetchPage, { pageSize: 200, limit: 10000 })
  assert.equal(calls.length, 2)
  assert.equal(result.items.length, 400)
  assert.equal(result.truncated, false)
})

// 回归锁定：空结果与旧版裸数组响应都不能导致死循环或伪造数据。
test('空结果只请求一页，裸数组响应按批次取满继续', async () => {
  const emptyCalls = []
  const empty = await collectContractLedgerExport(async (query) => {
    emptyCalls.push(query)
    return { items: [], total: 0, page: query.page, page_size: query.page_size }
  }, { pageSize: 200 })
  assert.equal(emptyCalls.length, 1)
  assert.equal(empty.items.length, 0)
  assert.equal(empty.truncated, false)

  const arrayCalls = []
  const legacyRows = Array.from({ length: 250 }, (_, index) => ledgerRow(index + 1))
  const legacy = await collectContractLedgerExport(async (query) => {
    arrayCalls.push(query)
    const start = (query.page - 1) * query.page_size
    return legacyRows.slice(start, start + query.page_size)
  }, { pageSize: 200 })
  assert.equal(arrayCalls.length, 2)
  assert.equal(legacy.items.length, 250)
  assert.equal(legacy.truncated, false)
})

// 行为锁定：「未过期」导出带 expired=false，必须原样进入每一页请求，
// 不能被 falsy 判断丢掉（丢掉就会导出整表，与页面可见集合不一致）。
test('导出每页请求保留 expired=false', async () => {
  const { fetchPage, calls } = paginated(3)
  const result = await collectContractLedgerExport(fetchPage, {
    filters: { keyword: '', expired: false },
    pageSize: 200,
    limit: 10000,
  })
  assert.deepEqual(calls, [{ keyword: '', expired: false, page: 1, page_size: 200 }])
  assert.equal(result.items.length, 3)
})

// 回归锁定：CSV 列顺序与格式保持分页改造前完全一致（\n 分隔、不含 BOM、按 escapeCsvCell 转义）。
test('CSV 保留原有列顺序与转义格式', () => {
  const header = ['合同编号', '合同名称', '合同类型', '服务类型', '金额', '负责人姓名', '状态']
  const rows = [
    ['HT-1', '标准合同', '服务合同', '运维', 100, '张三', '已生效'],
    ['HT-2', '含,逗号"引号', '服务合同', '=公式', -5, '@提及', '审批中'],
  ]
  const csv = [header, ...rows].map((row) => row.map(escapeCsvCell).join(',')).join('\n')
  assert.match(csv, /"含,逗号""引号"/)
  assert.match(csv, /'=公式/)
  assert.match(csv, /'@提及/)
  assert.equal(csv.includes('\ufeff'), false)
  // 视图仍复用平台转义函数、中文表头、BOM、文件名与 \n 换行（格式未随分页改造漂移）。
  assert.match(view, /import \{ escapeCsvCell \} from '@\/modules\/platform\/iam\/utils\/csvExport\.js'/)
  assert.ok(view.includes(".map((row) => row.map(escapeCsvCell).join(','))"))
  assert.ok(view.includes(".join('\\n')"))
  assert.match(view, /'合同编号', '合同名称', '合同类型', '服务类型', '金额', '负责人姓名', '状态'/)
  assert.match(view, /anchor\.download = '合同台账\.csv'/)
  assert.match(view, /\.join\('\\n'\)/)
})

// 回归锁定：视图导出入口改为按筛选分页读取，权限、BOM、文件名与两条提示口径可核对。
test('视图导出跟随筛选、保留权限检查并区分上限提示', () => {
  assert.match(view, /import \{ collectContractLedgerExport, CONTRACT_LEDGER_EXPORT_LIMIT, CONTRACT_LEDGER_EXPORT_PAGE_SIZE \} from '@\/modules\/contract_management\/utils\/contractLedgerExport\.js'/)
  assert.match(view, /if \(!can\('contract\.read'\)\) \{[\s\S]*?showToast\('当前角色没有合同台账读取权限，无法导出。'\)/)
  assert.match(view, /filters: ledgerExportFilters\(\)/)
  assert.match(view, /pageSize: EXPORT_PAGE_SIZE/)
  assert.match(view, /limit: EXPORT_ROW_LIMIT/)
  assert.match(view, /const EXPORT_ROW_LIMIT = CONTRACT_LEDGER_EXPORT_LIMIT/)
  assert.match(view, /正在导出合同台账：已读取 \$\{fetched\} \/ \$\{total\} 条…/)
  assert.match(view, /已导出前 \$\{rows\.length\} 条（超过导出上限 \$\{EXPORT_ROW_LIMIT\} 条，请缩小筛选范围后重试）/)
  assert.match(view, /已导出 \$\{rows\.length\} 条合同记录/)
  assert.match(view, /anchor\.download = '合同台账\.csv'/)
  assert.match(view, /new Blob\(\[`\\ufeff\$\{csv\}`\], \{ type: 'text\/csv;charset=utf-8' \}\)/)
  // 不再从当前页 filteredContracts 生成导出行。
  assert.doesNotMatch(view, /filteredContracts\.value\.map/)
  // 视图导出仍复用状态标签反查状态码的筛选口径。
  assert.match(view, /const statusCode = contractStatusQuery\(\)[\s\S]*?if \(statusCode\) filters\.status = statusCode[\s\S]*?if \(typeFilter\.value\) filters\.type = typeFilter\.value/)
  // 「已过期」/「未过期」导出与列表同一口径：沿用服务端 expired=true/false
  // （此时 statusCode 为空、不带 status），导出的集合必须与页面可见筛选一致，不能悄悄导出整表。
  const exportFilters = view.slice(
    view.indexOf('function ledgerExportFilters() {'),
    view.indexOf('\n}', view.indexOf('function ledgerExportFilters() {')),
  )
  assert.match(exportFilters, /const expiry = ledgerExpiryQuery\(\)/)
  assert.match(exportFilters, /if \(expiry\) filters\.expired = expiry === 'true'/)
  // 只有一个 expired 赋值点，避免列表与导出各自判定出不同的 expired 值。
  assert.equal((exportFilters.match(/\.expired\s*=/g) || []).length, 1)
  assert.doesNotMatch(exportFilters, /ledgerExpiredQuery/)
})
