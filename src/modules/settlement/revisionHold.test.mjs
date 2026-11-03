import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { attachStructuredContext } from '../platform/shared/api/requestContext.js'
import { normalizeAuthorizationSession, principalIdentityID, shouldStartSubsystemLogin } from '../shared/authz/sessionCompatibility.js'
import { listQuery } from './api/pagination.js'
import { formatSettlementError } from './utils/errors.js'
import {
  REVISION_HOLD_MAX_LIMIT,
  REVISION_HOLD_MAX_OFFSET,
  formatRevisionHoldError,
  revisionDiffKindLabel,
  revisionHoldAmount,
  revisionHoldLength,
  revisionHoldQuery,
  revisionHoldReasonMeta,
  revisionHoldResolveBlockedReason,
  revisionHoldStatusMeta,
  summarizeRevisionHoldDiff,
  validateRevisionHoldReason,
} from './utils/revisionHold.js'

// 契约来源：Settlement/internal/service/contract_revision.go 的 contractRevisionDetail。
const DETAIL = {
  from_version: 1,
  to_version: 2,
  old_contract_amount: '1000.00',
  new_contract_amount: '1200.00',
  old_term_total: '1000.00',
  new_term_total: '1200.00',
  new_terms: [
    { installment_no: 1, due_date: '2026-02-01', amount: '600.00' },
    { installment_no: 2, due_date: '2026-03-01', amount: '600.00' },
  ],
  diffs: [
    {
      installment_no: 1,
      kind: 'AMOUNT_AND_DUE_DATE_CHANGED',
      old_due_date: '2026-01-01',
      new_due_date: '2026-02-01',
      old_amount: '500.00',
      new_amount: '600.00',
      implemented_facts: { received_allocated: '200.00', write_off: '0', invoiced: '0.00', reserved: '50.00' },
      references: 2,
    },
    {
      installment_no: 3,
      kind: 'REMOVED',
      old_due_date: '2026-05-01',
      old_amount: '500.00',
      implemented_facts: { received_allocated: '0', write_off: '0', invoiced: '0', reserved: '0' },
      references: 1,
    },
  ],
}

// 与 friendly-errors.test.mjs 同风格：在隔离 vm 中执行真实 api 层，只桩掉网络与浏览器能力。
const apiSource = await readFile(new URL('./api/settlement.js', import.meta.url), 'utf8')
function apiHarness(respond) {
  const calls = []
  const context = vm.createContext({
    fetch: async (url, options) => {
      calls.push({ url, options })
      return respond(url, options)
    },
    FormData, Blob, Headers, attachStructuredContext, listQuery, formatSettlementError, revisionHoldQuery,
    normalizeAuthorizationSession, principalIdentityID, shouldStartSubsystemLogin,
    getCurrentPrincipal: async () => ({}),
    crypto: { randomUUID: () => 'idempotent-test' },
    URL: { createObjectURL: () => 'blob:isolated-test', revokeObjectURL() {} },
    window: { location: { replace() {} }, setTimeout() {} },
    document: { body: { appendChild() {} }, createElement: () => ({ click() {}, remove() {} }) },
  })
  const script = apiSource
    .replace(/^import[\s\S]*?;\n/gm, '')
    .replace(/import\.meta\.env\?/g, '({})?')
    .replace(/^export /gm, '')
  vm.runInContext(`${script}\nglobalThis.api = { listContractRevisionHolds, resolveContractRevisionHold };`, context)
  return { api: context.api, calls }
}
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

test('修订工单列表：默认只查待复核，状态/合同/分页按后端契约拼装', async () => {
  const { api, calls } = apiHarness(() => json({ data: { items: [], limit: 50, offset: 0 } }))
  await api.listContractRevisionHolds()
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, '/settlement/api/v1/contract-revision-holds?status=PENDING_REVIEW&limit=50&offset=0')
  assert.equal(calls[0].options.method, undefined)
  assert.equal(calls[0].options.credentials, 'include')

  await api.listContractRevisionHolds({ status: '', contractRef: ' HT 1&2 ', limit: 100, offset: 100 })
  assert.equal(
    calls[1].url,
    '/settlement/api/v1/contract-revision-holds?contract_ref=HT%201%262&limit=100&offset=100',
    '空状态不发送 status，合同筛选必须编码后提交',
  )
})

test('修订工单列表：分页上限与服务端 page() 校验一致，越界在发请求前失败', async () => {
  const { api, calls } = apiHarness(() => json({ data: { items: [], limit: 50, offset: 0 } }))
  assert.throws(() => api.listContractRevisionHolds({ limit: REVISION_HOLD_MAX_LIMIT + 1 }), /1 到 100/)
  assert.throws(() => api.listContractRevisionHolds({ limit: 0 }), /1 到 100/)
  assert.throws(() => api.listContractRevisionHolds({ limit: 1.5 }), /1 到 100/)
  assert.throws(() => api.listContractRevisionHolds({ offset: REVISION_HOLD_MAX_OFFSET + 1 }), /0 到 100000/)
  assert.throws(() => api.listContractRevisionHolds({ offset: -1 }), /0 到 100000/)
  assert.throws(() => api.listContractRevisionHolds({ status: 'UNKNOWN' }), /状态筛选无效/)
  assert.throws(() => api.listContractRevisionHolds({ contractRef: 'a'.repeat(129) }), /最多 128 字/)
  assert.equal(calls.length, 0, '本地校验失败时不得发出请求')
})

test('修订工单关单：POST 带 CSRF 头与 5–500 字说明，同说明沿用同一幂等键', async () => {
  const { api, calls } = apiHarness(() => json({ data: { id: 'hold-1', status: 'RESOLVED', resolution_reason: '已按修订金额调整并红冲' } }))
  const result = await api.resolveContractRevisionHold('hold 1/2', '  已按修订金额调整并红冲  ')
  assert.equal(result.status, 'RESOLVED')
  assert.equal(calls[0].url, '/settlement/api/v1/contract-revision-holds/hold%201%2F2/resolve')
  assert.equal(calls[0].options.method, 'POST')
  assert.equal(calls[0].options.headers['X-CSRF-Token'], '1')
  assert.equal(calls[0].options.headers['Content-Type'], 'application/json')
  assert.equal(calls[0].options.body, JSON.stringify({ reason: '已按修订金额调整并红冲' }))
  assert.equal(calls[0].options.credentials, 'include')
  await api.resolveContractRevisionHold('hold 1/2', '已按修订金额调整并红冲')
  assert.equal(calls[1].options.headers['Idempotency-Key'], calls[0].options.headers['Idempotency-Key'])
  assert.throws(() => api.resolveContractRevisionHold('  ', '已按修订金额调整并红冲'), /修订工单标识缺失/)
})

test('修订工单错误：400/403/409/404 与只读许可期分别给出明确提示', async () => {
  const license = apiHarness(() => json({ code: 'COMMERCIAL_LICENSE_DENIED', message: '商业授权不可用或已到期；历史查询与导出仍受原权限控制' }, 403))
  await assert.rejects(license.api.resolveContractRevisionHold('hold-1', '已按修订金额调整并红冲'), (error) => {
    assert.equal(error.code, 'COMMERCIAL_LICENSE_DENIED')
    assert.equal(error.status, 403)
    assert.match(formatRevisionHoldError(error, { action: 'resolve' }), /只读期/)
    assert.doesNotMatch(formatRevisionHoldError(error, { action: 'resolve' }), /商业授权不可用/)
    return true
  })

  const forbidden = apiHarness(() => json({ code: 'SETTLEMENT_FORBIDDEN', message: '当前用户无权执行此操作' }, 403))
  await assert.rejects(forbidden.api.resolveContractRevisionHold('hold-1', '已按修订金额调整并红冲'), (error) => {
    const message = formatRevisionHoldError(error, { action: 'resolve' })
    assert.match(message, /settlement\.revision\.resolve/)
    assert.doesNotMatch(message, /settlement\.receivable\./, '403 文案只点名缺失的专用关单权限')
    return true
  })
  await assert.rejects(forbidden.api.listContractRevisionHolds(), (error) => {
    const message = formatRevisionHoldError(error, { action: 'list' })
    assert.match(message, /settlement\.revision\.read/)
    assert.doesNotMatch(message, /settlement\.receivable\./, '403 文案只点名缺失的专用读取权限')
    return true
  })

  const missing = apiHarness(() => json({ code: 'SETTLEMENT_NOT_FOUND', message: '未找到记录' }, 404))
  await assert.rejects(missing.api.resolveContractRevisionHold('hold-1', '已按修订金额调整并红冲'), (error) => {
    assert.match(formatRevisionHoldError(error, { action: 'resolve' }), /不存在.*范围/)
    return true
  })

  const conflict = apiHarness(() => json({ code: 'SETTLEMENT_CONFLICT', message: '记录已变化、重复或余额不足' }, 409))
  await assert.rejects(conflict.api.resolveContractRevisionHold('hold-1', '已按修订金额调整并红冲'), (error) => {
    const message = formatRevisionHoldError(error, { action: 'resolve' })
    assert.match(message, /已被处理/)
    assert.match(message, /不会自动重试/)
    return true
  })

  const invalid = apiHarness(() => json({ code: 'SETTLEMENT_INVALID_REQUEST', message: 'invalid input: hold id and resolution reason (5-500 characters) are required' }, 400))
  await assert.rejects(invalid.api.resolveContractRevisionHold('hold-1', '已按修订金额调整并红冲'), (error) => {
    assert.match(formatRevisionHoldError(error, { action: 'resolve' }), /5 至 500 字/)
    return true
  })
})

test('修订工单错误：网络中断不提示重复提交', async () => {
  const harness = apiHarness(() => {
    throw new TypeError('Failed to fetch')
  })
  await assert.rejects(harness.api.resolveContractRevisionHold('hold-1', '已按修订金额调整并红冲'), (error) => {
    assert.match(formatRevisionHoldError(error, { action: 'resolve' }), /网络连接中断|暂时无法确认/)
    return true
  })
})

test('关单说明边界：4 字拒绝，5 字与 500 字通过，501 字拒绝', () => {
  assert.equal(validateRevisionHoldReason('已处理差').ok, false)
  assert.match(validateRevisionHoldReason('已处理差').message, /至少 5 字/)
  assert.equal(validateRevisionHoldReason('   ').ok, false)
  assert.equal(validateRevisionHoldReason('验收完成').ok, false, '首尾空白不计入字数')

  const five = validateRevisionHoldReason('  已按修订款  ')
  assert.equal(five.ok, true)
  assert.equal(five.reason, '已按修订款')
  assert.equal(validateRevisionHoldReason('a'.repeat(5)).ok, true)

  const max = validateRevisionHoldReason(`已${'红'.repeat(499)}`)
  assert.equal(revisionHoldLength(max.reason), 500)
  assert.equal(max.ok, true)

  const over = validateRevisionHoldReason(`已${'红'.repeat(500)}`)
  assert.equal(revisionHoldLength(over.reason), 501)
  assert.equal(over.ok, false)
  assert.match(over.message, /不能超过 500 字/)
})

test('差异摘要：把服务端 diff 解析成逐期可读事实，不整段输出 JSON', () => {
  const summary = summarizeRevisionHoldDiff(DETAIL)
  assert.equal(summary.hasDiff, true)
  assert.equal(summary.fromVersion, 1)
  assert.equal(summary.toVersion, 2)
  assert.equal(summary.oldContractAmount, '1,000.00')
  assert.equal(summary.newContractAmount, '1,200.00')
  assert.equal(summary.contractAmountChanged, true)
  assert.equal(summary.newTermsCount, 2)
  assert.equal(summary.rows.length, 2)

  const [changed, removed] = summary.rows
  assert.equal(changed.kindLabel, '金额与到期日都变化')
  assert.deepEqual(changed.facts.map((fact) => fact.label), ['已回款核销', '已预占'], '零值事实不得展示为已发生')
  assert.equal(changed.facts[0].amount, '200.00')
  assert.equal(changed.references, 2)
  assert.equal(removed.kindLabel, '新条款已删除该期')
  assert.equal(removed.removed, true)
  assert.equal(removed.newAmount, '')
  assert.equal(removed.facts.length, 0)
  assert.equal(summary.hasFacts, true)

  const mismatched = summarizeRevisionHoldDiff({
    from_version: 1,
    to_version: 2,
    old_contract_amount: '1000.00',
    new_contract_amount: '1200.00',
    new_term_total: '1100.00',
    new_terms: [{ installment_no: 1 }],
    diffs: [],
  })
  assert.equal(mismatched.hasDiff, true)
  assert.equal(mismatched.hasRows, false)
  assert.equal(mismatched.newTermTotal, '1,100.00')

  assert.equal(summarizeRevisionHoldDiff(null).hasDiff, false)
  assert.equal(summarizeRevisionHoldDiff('{not json').hasDiff, false)
  assert.equal(summarizeRevisionHoldDiff([1, 2]).hasDiff, false, '数组不是契约里的 diff 对象')
})

test('差异摘要支持 JSON 字符串与未知枚举，未知值保留原文', () => {
  const summary = summarizeRevisionHoldDiff(JSON.stringify(DETAIL))
  assert.equal(summary.rows.length, 2)
  assert.equal(revisionDiffKindLabel('NEW_KIND'), 'NEW_KIND · 未识别差异')
  assert.equal(revisionDiffKindLabel(''), '差异类型未知')
  const unknown = summarizeRevisionHoldDiff({ diffs: [{ installment_no: 4, kind: 'SPLIT' }] })
  assert.match(unknown.rows[0].kindLabel, /未识别差异/)
  assert.equal(unknown.hasFacts, false)
})

test('工单状态与原因标签：识别已知值，未知值降级但不留空白', () => {
  assert.deepEqual(revisionHoldStatusMeta('PENDING_REVIEW'), { label: '待复核', tone: 'warning' })
  assert.deepEqual(revisionHoldStatusMeta('RESOLVED'), { label: '已关单', tone: 'success' })
  assert.deepEqual(revisionHoldStatusMeta('ARCHIVED'), { label: 'ARCHIVED · 未识别状态', tone: 'danger' })
  assert.deepEqual(revisionHoldStatusMeta(''), { label: '状态未知', tone: 'danger' })

  assert.match(revisionHoldReasonMeta('PLAN_DIFF_IMPLEMENTED_FACTS').label, /条款差异待人工处理/)
  assert.match(revisionHoldReasonMeta('TERM_TOTAL_MISMATCH').note, /没有写新的合同快照/)
  assert.match(revisionHoldReasonMeta('OTHER').label, /未识别原因 · OTHER/)
  assert.match(revisionHoldReasonMeta('').label, /工单原因缺失/)
  assert.equal(revisionHoldAmount(''), '')
  assert.equal(revisionHoldAmount('1200.5'), '1,200.50')
})

test('关单按钮权限：只要求 settlement.revision.resolve，不再依赖 receivable.adjust', () => {
  const blocked = revisionHoldResolveBlockedReason(() => false)
  assert.match(blocked, /settlement\.revision\.resolve/)
  assert.doesNotMatch(blocked, /settlement\.receivable\./, '关单只认专用动作权限，不得再点名应收权限')
  assert.match(
    revisionHoldResolveBlockedReason((permission) => permission === 'settlement.revision.read'),
    /settlement\.revision\.resolve/,
    '只有读取权限时必须给出禁用原因',
  )
  assert.equal(
    revisionHoldResolveBlockedReason((permission) => permission === 'settlement.revision.resolve'),
    '',
    '仅持有专用关单权限即可关单，无需 receivable.adjust',
  )
  assert.doesNotMatch(
    revisionHoldResolveBlockedReason((permission) => permission === 'settlement.revision.resolve'),
    /settlement\.receivable\./,
  )
  assert.match(revisionHoldResolveBlockedReason(undefined), /无法确认.*关单权限/)
})

test('列表筛选参数由纯函数拼装，页面与 api 层共用同一校验', () => {
  assert.equal(revisionHoldQuery({}), '?limit=50&offset=0')
  assert.equal(
    revisionHoldQuery({ status: 'PENDING_REVIEW', contractRef: 'HT-2026-001', limit: 20, offset: 40 }),
    '?status=PENDING_REVIEW&contract_ref=HT-2026-001&limit=20&offset=40',
  )
  assert.equal(revisionHoldQuery({ status: 'RESOLVED' }), '?status=RESOLVED&limit=50&offset=0')
  assert.throws(() => revisionHoldQuery({ limit: 101 }), /1 到 100/)
  assert.throws(() => revisionHoldQuery({ offset: 100001 }), /0 到 100000/)
  assert.throws(() => revisionHoldQuery({ status: 'DONE' }), /状态筛选无效/)
  assert.throws(() => revisionHoldQuery({ contractRef: 'x'.repeat(129) }), /最多 128 字/)
})

test('入口与分区权限：财务分区容纳修订工单读取能力，视图按读取权限挂载面板', async () => {
  const capabilities = await import('./utils/capabilities.js')
  assert.deepEqual(capabilities.allowedSections({ permissions: ['settlement.revision.read'] }), ['finance'])
  assert.equal(
    capabilities.permissionCheck({ permissions: ['settlement.revision.read'] })('settlement.difference.manage'),
    false,
    '读取修订工单不等于获得差异记录写入能力',
  )
  const view = await readFile(new URL('./views/SettlementView.vue', import.meta.url), 'utf8')
  assert.match(view, /import ContractRevisionHoldPanel from "@\/modules\/settlement\/components\/ContractRevisionHoldPanel\.vue"/)
  assert.match(
    view,
    /<ContractRevisionHoldPanel\s+v-if="active === 'finance' && can\('settlement\.revision\.read'\)"/,
    '无 settlement.revision.read 时不挂载入口，且不新造顶层导航',
  )
  assert.doesNotMatch(view, /["']revision-holds["']/, '修订工单不新增顶层导航项')
})
