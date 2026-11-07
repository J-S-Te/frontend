import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { computed, nextTick, reactive, ref } from 'vue'
import { parse } from '@babel/parser'
import { parse as parseSFC } from '@vue/compiler-sfc'
import { useUrlFilterState } from '../shared/composables/useUrlFilterState.js'
import { statusLabels } from './utils/contractDisplay.js'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')
const view = read('./views/ContractManagementView.vue')

function functionBody(source, signature) {
  const start = source.indexOf(signature)
  assert.ok(start >= 0, `缺少 ${signature}`)
  const end = source.indexOf('\n}', start)
  assert.ok(end > start)
  return source.slice(start, end + 2)
}

// 从真实视图脚本里按名字抽出声明（函数或 const），再交给替身执行。
// 这样断言的是“视图真的会这么算”，而不是靠正则猜它看起来写对了。
function viewDeclarations() {
  const script = parseSFC(view).descriptor.scriptSetup.content
  const ast = parse(script, { sourceType: 'module' }).program.body
  const declaration = (name) => {
    const found = ast.find((node) => (node.type === 'FunctionDeclaration' && node.id.name === name)
      || (node.type === 'VariableDeclaration' && node.declarations.some((item) => item.id.name === name)))
    assert.ok(found, `缺少 ${name}`)
    return script.slice(found.start, found.end)
  }
  return { script, declaration }
}

// 台账请求块：从 ledgerQuery 构造开始到 addRequest 收尾（含页码钳制分支）。
// 不能用 indexOf('))') 截断——块内有 `.then((page) => {`、`ledgerExpiryQuery()` 等嵌套括号。
function ledgerRequestBlock(source) {
  const start = source.indexOf('const ledgerQuery = { page: ledgerPage.value')
  assert.ok(start >= 0, '缺少台账请求对象')
  const end = source.indexOf('}))', start)
  assert.ok(end > start, '缺少台账请求收尾')
  return source.slice(start, end + 3)
}

// 台账请求块：从 ledgerQuery 构造开始到类型条件收尾（addRequest 之前）。
// 不能用 indexOf('))') 截断——块内有 `.then((page) => {`、`ledgerExpiryQuery()` 等嵌套括号。
function ledgerRequestQuerySource() {
  const { script } = viewDeclarations()
  const start = script.indexOf('const ledgerQuery = { page: ledgerPage.value')
  assert.ok(start >= 0, '缺少台账请求对象')
  const tail = 'if (typeFilter.value) ledgerQuery.type = typeFilter.value'
  const end = script.indexOf(tail, start)
  assert.ok(end > start, '缺少台账请求类型条件')
  return script.slice(start, end + tail.length)
}

// 从真实视图脚本里抽出台账的纯函数与选项常量（页码解析 / expired 决策 / 请求组装），
// 用替身执行，避免只靠正则断言“看起来写对了”。
function loadLedgerHelpers() {
  const { declaration } = viewDeclarations()
  const expiryConstants = ['LEDGER_EXPIRED_FILTER', 'LEDGER_UNEXPIRED_FILTER', 'LEDGER_EXPIRY_FILTERS']
    .map(declaration)
    .join('\n')
  const pageFromQuery = new Function(`${declaration('ledgerPageFromQuery')}\nreturn ledgerPageFromQuery`)()
  const expiryWith = new Function(
    `let statusFilter = { value: '' }\n${expiryConstants}\n${declaration('ledgerExpiryQuery')}\nreturn (value) => { statusFilter.value = value; return ledgerExpiryQuery() }`,
  )()
  return { pageFromQuery, expiryWith }
}

// 组装真实请求：把视图里的 contractStatusQuery / ledgerExpiryQuery / ledgerQuery 构造块
// 原样搬进替身作用域执行，断言四种下拉选项各自产生的请求参数（含最终 query string）。
function loadLedgerRequest() {
  const { declaration } = viewDeclarations()
  const expiryConstants = ['LEDGER_EXPIRED_FILTER', 'LEDGER_UNEXPIRED_FILTER', 'LEDGER_EXPIRY_FILTERS']
    .map(declaration)
    .join('\n')
  const body = [
    'let statusFilter = { value: "" }',
    'let keyword = { value: "" }',
    'let typeFilter = { value: "" }',
    'let ledgerPage = { value: 1 }',
    'const LEDGER_PAGE_SIZE = 20',
    'const ledgerPageSize = { value: 20 }',
    expiryConstants,
    declaration('contractStatusQuery'),
    declaration('ledgerExpiryQuery'),
    `return (statusLabel, page = 1) => {
      statusFilter.value = statusLabel
      ledgerPage.value = page
      ${ledgerRequestQuerySource()}
      return { ...ledgerQuery, query: new URLSearchParams(ledgerQuery).toString() }
    }`,
  ].join('\n')
  return new Function('statusLabels', body)(statusLabels)
}

// 组装真实导出筛选：复用视图里的 ledgerExportFilters，确认导出与列表同一口径。
function loadLedgerExportFilters() {
  const { declaration } = viewDeclarations()
  const expiryConstants = ['LEDGER_EXPIRED_FILTER', 'LEDGER_UNEXPIRED_FILTER', 'LEDGER_EXPIRY_FILTERS']
    .map(declaration)
    .join('\n')
  const body = [
    'let statusFilter = { value: "" }',
    'let keyword = { value: "" }',
    'let typeFilter = { value: "" }',
    expiryConstants,
    declaration('contractStatusQuery'),
    declaration('ledgerExpiryQuery'),
    declaration('ledgerExportFilters'),
    'return (statusLabel) => { statusFilter.value = statusLabel; return ledgerExportFilters() }',
  ].join('\n')
  return new Function('statusLabels', body)(statusLabels)
}

// 组装真实的 filteredContracts：本地二次过滤只能在服务端未筛状态时兜底，
// 选中「已过期」/「未过期」时不得再按 status/displayStatus 过滤掉服务端返回的行。
function loadFilteredContracts(contracts) {
  const { declaration } = viewDeclarations()
  const expiryConstants = ['LEDGER_EXPIRED_FILTER', 'LEDGER_UNEXPIRED_FILTER', 'LEDGER_EXPIRY_FILTERS']
    .map(declaration)
    .join('\n')
  const body = [
    'const statusFilter = ref("")',
    'const keyword = ref("")',
    'const typeFilter = ref("")',
    expiryConstants,
    declaration('ledgerExpiryQuery'),
    declaration('filteredContracts'),
    'return { statusFilter, keyword, typeFilter, filteredContracts }',
  ].join('\n')
  return new Function('computed', 'ref', 'contracts', body)(computed, ref, contracts)
}

// 回归锁定：状态筛选必须下推服务端（GET /contracts 支持 status 精确匹配状态码）。
// 下拉框 option 的 value 是可读标签，所以要按 statusLabels 反查回状态码；标签不匹配时不下发，
// 否则会用标签当状态码查出一片空结果。
test('contractStatusQuery 通过 statusLabels 反查状态码，匹配不到时返回空串', () => {
  const body = functionBody(view, 'function contractStatusQuery()')
  assert.match(body, /if \(!statusFilter\.value\) return ''/)
  assert.match(body, /Object\.entries\(statusLabels\)\.find\(\(\[, label\]\) => label === statusFilter\.value\)/)
  assert.match(body, /return matched \? matched\[0\] : ''/)
  // 不能把标签原样当状态码下发。
  assert.doesNotMatch(body, /return statusFilter\.value/)
})

// 回归锁定：台账请求改成服务端分页（page/page_size），status 与 type 都是服务端筛选参数。
// 旧的 limit: 200 会静默截断超过 200 份合同的客户台账，不允许再出现。
test('台账请求对象带 page/page_size，并按状态码与类型条件追加 status/type', () => {
  assert.match(view, /const LEDGER_PAGE_SIZE = 20\b/)
  assert.match(view, /const ledgerPageSize = ref\(LEDGER_PAGE_SIZE\)/)
  assert.match(view, /const ledgerQuery = \{ page: ledgerPage\.value, page_size: ledgerPageSize\.value, keyword: keyword\.value\.trim\(\) \}/)
  assert.match(view, /const statusCode = contractStatusQuery\(\)/)
  assert.match(view, /if \(statusCode\) ledgerQuery\.status = statusCode/)
  assert.match(view, /if \(typeFilter\.value\) ledgerQuery\.type = typeFilter\.value/)
  assert.match(view, /listContracts\(ledgerQuery\)/)
  // 台账请求本身不能再带 limit：limit: 200 会静默截断超过 200 份合同的客户。
  assert.doesNotMatch(ledgerRequestBlock(view), /limit/)
})

// 回归锁定：服务端 total 必须写回 ledgerTotal，页脚与分页条才有真实总数。
test('台账请求把服务端 total 写回 ledgerTotal', () => {
  const request = ledgerRequestBlock(view)
  assert.match(request, /contracts\.value = page\.items\.map\(normalizeContract\)/)
  assert.match(request, /ledgerTotal\.value = page\.total/)
})

// 回归锁定：服务端 keyword 匹配 contract_number / title / customer_name，
// 本地二次过滤必须覆盖同一组字段，否则按客户名搜到的行会被本地过滤掉，表现为“搜客户名结果为空”。
test('filteredContracts 的关键词匹配包含 customerName', () => {
  const body = functionBody(view, 'const filteredContracts = computed(() => {')
  assert.match(body, /\[contract\.id, contract\.name, contract\.customerName, contract\.type, contract\.serviceType, contract\.owner\]/)
  assert.match(body, /\.join\(' '\)\.toLowerCase\(\)\.includes\(query\)/)
})

// 行为锁定：选中「已过期」/「未过期」时服务端已按 expired 筛完并分页，
// 本地不能再按 status 二次过滤（否则当前页里状态不同的行会被静默丢掉）；
// 关键词安全网仍然生效，普通状态仍按状态码兜底。
test('filteredContracts 在过期筛选下不再按 status 二次过滤，关键词仍生效', () => {
  const contracts = ref([
    { id: 'HT-1', name: '甲合同', customerName: '客户甲', type: '服务合同', serviceType: '运维', owner: '张三', status: '已生效' },
    { id: 'HT-2', name: '乙合同', customerName: '客户乙', type: '服务合同', serviceType: '运维', owner: '李四', status: '已完成' },
  ])
  const { statusFilter, keyword, filteredContracts } = loadFilteredContracts(contracts)
  // 「未过期」：服务端返回的两行都必须保留，不能按 status 再筛掉 completed。
  statusFilter.value = '未过期'
  assert.deepEqual(filteredContracts.value.map((item) => item.id), ['HT-1', 'HT-2'])
  // 「已过期」同样不做本地状态过滤。
  statusFilter.value = '已过期'
  assert.deepEqual(filteredContracts.value.map((item) => item.id), ['HT-1', 'HT-2'])
  // 关键词安全网仍然生效（按客户名匹配）。
  keyword.value = '客户乙'
  assert.deepEqual(filteredContracts.value.map((item) => item.id), ['HT-2'])
  keyword.value = ''
  // 普通状态仍按服务端下发的状态码做本地兜底。
  statusFilter.value = '已生效'
  assert.deepEqual(filteredContracts.value.map((item) => item.id), ['HT-1'])
})

// 回归锁定：状态/类型/关键词都是服务端查询参数，改选后必须回到第 1 页重新请求，
// 只在本地过滤会漏掉当前页之外的数据，停在第 N 页还会查到一个空页。
test('筛选条件变化回到第 1 页并触发台账重新加载', () => {
  const body = functionBody(view, 'async function reloadLedger() {')
  assert.match(body, /ledgerPage\.value = 1/)
  assert.match(body, /await loadBusinessData\(\)/)
  assert.match(view, /<input v-model="keyword"[^>]*@change="reloadLedger"/)
  assert.match(view, /<select v-model="statusFilter"[^>]*@change="reloadLedger"/)
  assert.match(view, /<select v-model="typeFilter"[^>]*@change="reloadLedger"/)
  // 类型筛选已下推服务端，不能再声称“仅限已加载记录”。
  assert.doesNotMatch(view, /仅限已加载记录/)
  assert.doesNotMatch(view, /服务端 GET \/contracts 暂不支持该查询参数/)
})

// 回归锁定：翻页用服务端页码，且被服务端 total 推出的页数钳制；
// 上一页/下一页的禁用状态必须来自 ledgerPage 与 ledgerPageCount。
test('changeLedgerPage 钳制页码后重新加载台账', () => {
  const body = functionBody(view, 'async function changeLedgerPage(next) {')
  assert.match(body, /Math\.min\(Math\.max\(1, Math\.trunc\(Number\(next\) \|\| 1\)\), ledgerPageCount\.value\)/)
  assert.match(body, /if \(page === ledgerPage\.value\) return/)
  assert.match(body, /await loadBusinessData\(\)/)
  assert.match(view, /const ledgerPageCount = computed\(\(\) => Math\.max\(1, Math\.ceil\(ledgerTotal\.value \/ ledgerPageSize\.value\)\)\)/)
})

// 回归锁定：「已过期」/「未过期」是服务端 expired=true/false 组合筛选，不再只筛当前页。
// 旧实现把「已过期」当普通状态/displayStatus 在前端过滤：服务端分页后只能看到当前页里的
// 过期合同，其它页的命中被静默丢掉，页脚总数也与可见集合不一致。
test('「已过期」/「未过期」走服务端 expired=true/false，且不与 status 组合', () => {
  const statusQuery = functionBody(view, 'function contractStatusQuery()')
  // 普通状态仍按标签反查状态码，标签匹配不到时不下发。
  assert.match(statusQuery, /Object\.entries\(statusLabels\)\.find\(\(\[, label\]\) => label === statusFilter\.value\)/)
  // 两个过期选项都不是状态码，不能被当 status 下发。
  assert.match(statusQuery, /if \(ledgerExpiryQuery\(\)\) return ''/)
  // 单一决策点：ledgerExpiryQuery 由 LEDGER_EXPIRY_FILTERS 映射得出 'true' | 'false' | ''。
  const expiryQuery = functionBody(view, 'function ledgerExpiryQuery()')
  assert.match(expiryQuery, /return LEDGER_EXPIRY_FILTERS\.get\(statusFilter\.value\) \|\| ''/)
  assert.match(view, /const LEDGER_EXPIRY_FILTERS = new Map\(\[\s*\[LEDGER_EXPIRED_FILTER, 'true'\],\s*\[LEDGER_UNEXPIRED_FILTER, 'false'\],\s*\]\)/)
  // 台账请求：只有一个 expired 赋值点，且由 ledgerExpiryQuery() 决定取值。
  const request = ledgerRequestQuerySource()
  assert.equal((request.match(/\.expired\s*=/g) || []).length, 1)
  assert.match(request, /const expiry = ledgerExpiryQuery\(\)/)
  assert.match(request, /if \(expiry\) ledgerQuery\.expired = expiry === 'true'/)
  assert.match(request, /const statusCode = contractStatusQuery\(\)/)
  assert.match(request, /if \(statusCode\) ledgerQuery\.status = statusCode/)
  // 只有一个 select 绑定 statusFilter；两个过期选项与普通状态在同一控件里天然互斥。
  assert.equal((view.match(/v-model="statusFilter"/g) || []).length, 1)
  assert.match(view, /const ledgerStatusOptions = \[[\s\S]*?\{ value: LEDGER_EXPIRED_FILTER, label: LEDGER_EXPIRED_FILTER \},[\s\S]*?\{ value: LEDGER_UNEXPIRED_FILTER, label: LEDGER_UNEXPIRED_FILTER \},/)
  assert.match(view, /<option v-for="option in ledgerStatusOptions" :key="option\.value" :value="option\.value">/)
  // 选中任一过期选项时 filteredContracts 不能再按 displayStatus/status 二次过滤。
  const filtered = functionBody(view, 'const filteredContracts = computed(() => {')
  assert.match(filtered, /const expiryOnly = Boolean\(ledgerExpiryQuery\(\)\)/)
  assert.match(filtered, /expiryOnly \|\| !statusFilter\.value/)
  assert.doesNotMatch(filtered, /contract\.displayStatus|\.displayStatus ===/)
  // 修改筛选仍回到第 1 页。
  assert.match(functionBody(view, 'async function reloadLedger() {'), /ledgerPage\.value = 1/)
})

// 行为锁定：四个可选状态各自产生精确的台账请求（含最终 query string）。
// 全部状态 → 不带 status/expired；普通状态 → status=<code>；已过期 → expired=true；
// 未过期 → expired=false。三者互斥，绝不会同时出现 status 与 expired。
test('四种下拉状态各自组装出精确的台账请求', () => {
  const requestFor = loadLedgerRequest()
  assert.deepEqual(requestFor(''), {
    page: 1,
    page_size: 20,
    keyword: '',
    query: 'page=1&page_size=20&keyword=',
  })
  assert.deepEqual(requestFor('已生效'), {
    page: 1,
    page_size: 20,
    keyword: '',
    status: 'active',
    query: 'page=1&page_size=20&keyword=&status=active',
  })
  assert.deepEqual(requestFor('已过期'), {
    page: 1,
    page_size: 20,
    keyword: '',
    expired: true,
    query: 'page=1&page_size=20&keyword=&expired=true',
  })
  assert.deepEqual(requestFor('未过期'), {
    page: 1,
    page_size: 20,
    keyword: '',
    expired: false,
    query: 'page=1&page_size=20&keyword=&expired=false',
  })
  // 翻页时只改 page，expired=false 仍随请求下发。
  assert.equal(requestFor('未过期', 3).query, 'page=3&page_size=20&keyword=&expired=false')
  // 任何状态下 status 与 expired 都不会同时出现。
  for (const label of ['', '已生效', '审批中', '已过期', '未过期']) {
    const built = requestFor(label)
    assert.equal(built.status !== undefined && built.expired !== undefined, false, `${label} 组合了 status 与 expired`)
  }
})

// 行为锁定：导出沿用同一口径，四种状态导出同一批筛选（未过期带 expired=false）。
test('导出筛选与列表同口径，未过期带 expired=false', () => {
  const filtersFor = loadLedgerExportFilters()
  assert.deepEqual(filtersFor(''), { keyword: '' })
  assert.deepEqual(filtersFor('已生效'), { keyword: '', status: 'active' })
  assert.deepEqual(filtersFor('已过期'), { keyword: '', expired: true })
  assert.deepEqual(filtersFor('未过期'), { keyword: '', expired: false })
})

// 回归锁定：台账页码是深链状态。page 与 keyword/status/type 一起交给 useUrlFilterState：
// 首屏/前进后退从 URL 恢复，翻页时回写（字段 watch 统一 router.replace）。
// 非法页码归一为 1；超出真实页数的页码在拿到服务端 total 后钳制并重取本页。
test('台账页码从 URL 恢复并回写（page 参数往返）', () => {
  assert.match(view, /fields: \{ keyword, status: statusFilter, type: typeFilter, page: ledgerPage \}/)
  assert.match(view, /parse: \(value, name\) => name === 'page' \? ledgerPageFromQuery\(value\) : value/)
  const parse = functionBody(view, 'function ledgerPageFromQuery(value) {')
  assert.match(parse, /Math\.trunc\(Number\(value\)\)/)
  assert.match(parse, /return Number\.isFinite\(page\) && page > 0 \? page : 1/)
  // 翻页只改 ledgerPage；URL 的 page 由 useUrlFilterState 的字段 watch 回写。
  const change = functionBody(view, 'async function changeLedgerPage(next) {')
  assert.match(change, /ledgerPage\.value = page/)
  // 深链页码越界（筛选后总数变少 / URL 被改大）时钳制到 1..页数并重取本页。
  const request = ledgerRequestBlock(view)
  assert.match(request, /const clampedPage = Math\.min\(Math\.max\(1, ledgerPage\.value\), ledgerPageCount\.value\)/)
  assert.match(request, /ledgerPage\.value = clampedPage/)
  assert.match(request, /listContracts\(\{ \.\.\.ledgerQuery, page: clampedPage \}\)/)
})

// 行为锁定：深链页码只接受正整数，其余（空值、0、负数、小数、非数字）都回第 1 页；
// ledgerExpiryQuery 只认下拉框里那两个过期选项，普通状态标签不会误触发 expired。
test('ledgerPageFromQuery 归一非法页码，ledgerExpiryQuery 只认「已过期」/「未过期」选项', () => {
  const { pageFromQuery, expiryWith } = loadLedgerHelpers()
  assert.equal(pageFromQuery('2'), 2)
  assert.equal(pageFromQuery(' 3 '), 3)
  assert.equal(pageFromQuery('2.9'), 2)
  assert.equal(pageFromQuery('0'), 1)
  assert.equal(pageFromQuery('-5'), 1)
  assert.equal(pageFromQuery('abc'), 1)
  assert.equal(pageFromQuery(''), 1)
  assert.equal(pageFromQuery(undefined), 1)
  assert.equal(expiryWith('已过期'), 'true')
  assert.equal(expiryWith('未过期'), 'false')
  assert.equal(expiryWith('已生效'), '')
  assert.equal(expiryWith(''), '')
  assert.equal(expiryWith('active'), '')
  // 原型链上的键不能被当成过期选项（避免 'constructor' 之类误触发 expired）。
  assert.equal(expiryWith('constructor'), '')
  assert.equal(expiryWith('toString'), '')
})

// 行为锁定：台账页码真正走 useUrlFilterState 往返——首屏从 URL 恢复（非法值归一），
// 翻页回写且不丢 keyword/status/type，popstate 回到另一页时触发一次重载。
test('台账 page 参数经 useUrlFilterState 恢复与回写，筛选参数不丢', async () => {
  const { pageFromQuery } = loadLedgerHelpers()
  const route = reactive({ query: { keyword: '示例', status: '已过期', page: '3' } })
  const router = { last: null, replace(value) { this.last = value; return Promise.resolve() } }
  const keyword = ref('')
  const status = ref('')
  const type = ref('')
  const page = ref(1)
  const restores = []
  useUrlFilterState({
    route,
    router,
    fields: { keyword, status, type, page },
    parse: (value, name) => name === 'page' ? pageFromQuery(value) : value,
    onRestore: () => restores.push(page.value),
  })
  await nextTick()
  // 首屏恢复：page=3 生效，非法页码（例如 ?page=0）回第 1 页。
  assert.equal(keyword.value, '示例')
  assert.equal(status.value, '已过期')
  assert.equal(page.value, 3)
  assert.equal(restores.length, 0)

  page.value = 2
  await nextTick()
  assert.deepEqual(router.last.query, { keyword: '示例', status: '已过期', page: '2' })

  route.query = { keyword: '示例', status: '已过期', page: '1' }
  await nextTick()
  assert.equal(page.value, 1)
  assert.deepEqual(restores, [1])
})

// 行为锁定：「未过期」经 URL 往返：status=未过期&page=2 恢复后仍下发 expired=false。
// 与「已过期」同一深链机制（下拉标签存 status，页码存 page），恢复后请求不能丢掉 expired。
test('「未过期」经 URL 往返（status=未过期&page=2）并下发 expired=false', async () => {
  const { pageFromQuery } = loadLedgerHelpers()
  const route = reactive({ query: { status: '未过期', page: '2' } })
  const router = { last: null, replace(value) { this.last = value; return Promise.resolve() } }
  const status = ref('')
  const page = ref(1)
  const restores = []
  useUrlFilterState({
    route,
    router,
    fields: { status, page },
    parse: (value, name) => name === 'page' ? pageFromQuery(value) : value,
    onRestore: () => restores.push(page.value),
  })
  await nextTick()
  assert.equal(status.value, '未过期')
  assert.equal(page.value, 2)
  // 首屏恢复不触发 onRestore（由组件首加载自己拉取），避免重复请求。
  assert.deepEqual(restores, [])
  // 恢复出来的选项值继续走同一决策点：请求带 expired=false，且不带 status。
  const requestFor = loadLedgerRequest()
  const restored = requestFor(status.value, page.value)
  assert.equal(restored.expired, false)
  assert.equal(restored.status, undefined)
  assert.equal(restored.query, 'page=2&page_size=20&keyword=&expired=false')
  // 再次翻页时 URL 仍回写为同一个标签，复制链接可重开同一筛选与页码。
  page.value = 3
  await nextTick()
  assert.deepEqual(router.last.query, { status: '未过期', page: '3' })
})

// 回归锁定：台账页脚必须恢复真实总数（服务端 total），并给出上一页 / 第 X 页，共 Y 条 / 下一页。
// 旧文案“已加载 N 条（单次最多 200 条）”是在没有 total 时的免责说明，已被服务端计数取代。
test('台账页脚展示服务端总数与分页条，不再出现 200 条上限说法', () => {
  const start = view.indexOf('contract-ledger-table')
  assert.ok(start >= 0, '缺少台账表格')
  const end = view.indexOf('</template>', start)
  assert.ok(end > start)
  const ledger = view.slice(start, end)
  // 分页条已统一到 shared/components/PaginationBar.vue（2026-11 统一）：
  // 上一页 / 第 N 页，共 M 条 / 下一页的文案与禁用语义由组件保证（见 shared/pagination-bar.test.mjs），
  // 台账侧继续用服务端 total 作为总数来源、用 changeLedgerPage 作为翻页入口。
  // 页脚左侧原来还有一句「共 N 条合同记录」，与分页条的总数重复，已随统一去掉。
  assert.match(ledger, /<PaginationBar label="合同台账分页" :page="ledgerPage" :total="ledgerTotal" :page-size-options="\[20, 50, 100\]" :page-size="ledgerPageSize" :loading="businessDataLoading" @change="changeLedgerPage" @change-page-size="changeLedgerPageSize" \/>/)
  assert.doesNotMatch(ledger, /共 \{\{ ledgerTotal \}\} 条合同记录/)
  assert.doesNotMatch(ledger, /单次最多 200 条/)
  assert.doesNotMatch(ledger, /已加载 \{\{/)
})

// 回归锁定：顶栏搜索只筛合同台账，离开台账分区时必须禁用并说明范围，
// 否则用户在其他分区输入关键词却看不到任何变化。
test('顶栏搜索在台账分区之外禁用', () => {
  const start = view.indexOf('class="contract-global-search"')
  assert.ok(start >= 0, '缺少顶栏搜索框')
  const end = view.indexOf('</label>', start)
  assert.ok(end > start)
  const search = view.slice(start, end)
  assert.match(search, /:disabled="activeSection !== 'contracts'"/)
  assert.match(search, /'搜索仅限合同台账'/)
})

// 回归锁定：重置筛选回到第 1 页，避免清空筛选后停在一个不存在的深页。
test('resetFilters 重置台账页码', () => {
  const body = functionBody(view, 'async function resetFilters() {')
  assert.match(body, /ledgerPage\.value = 1/)
  assert.match(body, /await loadBusinessData\(\)/)
})

// 回归锁定：台账分页后 contracts 只剩当前页，看板卡片不能拿当前页求和/计数，
// 否则“本人合同 20 份 / 本人合同总额”会随翻页变化。
test('看板卡片改用服务端看板明细，不再对台账当前页汇总', () => {
  assert.match(view, /const summarizableContracts = computed\(\(\) => reportContracts\.value\)/)
  const totals = functionBody(view, 'const personalCurrencyTotals = computed(() =>')
  assert.match(totals, /summarizableContracts\.value\.map/)
  assert.doesNotMatch(totals, /contracts\.value\.map/)
  const active = functionBody(view, 'const activeContractCount = computed(() =>')
  assert.match(active, /summarizableContracts\.value\.filter/)
  assert.doesNotMatch(active, /contracts\.value\.filter/)
  assert.match(view, /const personalContractCount = computed\(\(\) => summarizableContracts\.value\.length\)/)
  assert.match(view, /\{\{ personalContractCount \}\}/)
})
