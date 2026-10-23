import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { attachStructuredContext } from '../platform/shared/api/requestContext.js'
import { normalizeAuthorizationSession, principalIdentityID, shouldStartSubsystemLogin } from '../shared/authz/sessionCompatibility.js'
import { listQuery } from './api/pagination.js'
import { formatSettlementError } from './utils/errors.js'

const source = await readFile(new URL('./api/settlement.js', import.meta.url), 'utf8')
function harness(fetcher) {
  const calls = { redirects: [], downloads: [], revoked: [], timers: [] }
  let uuid = 0
  const context = vm.createContext({
    fetch: fetcher, FormData, Blob, Headers, attachStructuredContext, listQuery, formatSettlementError,
    normalizeAuthorizationSession, principalIdentityID, shouldStartSubsystemLogin,
    getCurrentPrincipal: async () => ({}),
    crypto: { randomUUID: () => `idempotent-${++uuid}` },
    URL: { createObjectURL: () => 'blob:isolated-test', revokeObjectURL: (url) => calls.revoked.push(url) },
    window: { location: { replace: (url) => calls.redirects.push(url) }, setTimeout: (fn) => calls.timers.push(fn) },
    document: { body: { appendChild() {} }, createElement: () => ({ click() { calls.downloads.push({ href: this.href, download: this.download }) }, remove() {} }) },
  })
  const script = source.replace(/^import[\s\S]*?;\n/gm, '').replace(/import\.meta\.env\?/g, '({})?').replace(/^export /gm, '')
  vm.runInContext(`${script}\nglobalThis.api = { getDashboard, getSettlementSession, listReceipts, listDunningRecipients, createReceipt, createInvoiceRequest, recoverInvoiceFailure, downloadReportExport, downloadTaxInvoiceDocument };`, context)
  return { api: context.api, calls, setFetch: (fn) => { context.fetch = fn } }
}
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })

test('known settlement field validation is translated and diagnostics remain structured', async () => {
  const { api, calls } = harness(async () => json({ code: 'SETTLEMENT_INVALID_REQUEST', message: 'invalid input: amount must be a positive decimal with at most two fractional digits', details: { validation_source: 'invoice' } }, 400, { 'x-request-id': 'request-test', 'x-trace-id': 'trace-test' }))
  await assert.rejects(api.createReceipt({ amount: '-1' }), (error) => {
    assert.match(error.message, /金额必须大于 0/)
    assert.doesNotMatch(error.message, /invalid input|request-test|trace-test/)
    assert.equal(error.status, 400)
    assert.equal(error.code, 'SETTLEMENT_INVALID_REQUEST')
    assert.deepEqual(error.details, { validation_source: 'invoice' })
    assert.equal(error.requestID, 'request-test')
    assert.equal(error.traceId, 'trace-test')
    assert.equal(error.context.subsystem, 'settlement')
    return true
  })
  assert.equal(calls.redirects.length, 0)
})

test('settlement wire type mismatch explains a system-version problem, not a user editing mistake', async () => {
  const { api } = harness(async () => json({ code: 'SETTLEMENT_INVALID_REQUEST', message: 'cannot unmarshal number into Go struct field Confirm.version of type string', details: { reason: 'invalid_type', field: 'version' } }, 400))
  await assert.rejects(api.createReceipt({ version: 3 }), (error) => {
    assert.match(error.message, /数据格式.*系统版本/)
    assert.doesNotMatch(error.message, /unmarshal|Go struct|Confirm/)
    assert.equal(error.details.field, 'version')
    return true
  })
})

test('network loss never automatically repeats a payment mutation and retains its idempotency key', async () => {
  const keys = []
  let fail = true
  const { api } = harness(async (_url, options) => {
    keys.push(options.headers['Idempotency-Key'])
    if (fail) throw new TypeError('Failed to fetch at mysql.internal:3306')
    return json({ data: { id: 'receipt' } })
  })
  await assert.rejects(api.createReceipt({ amount: '100' }), (error) => {
    assert.match(error.message, /尚无法确认.*勿重复提交/)
    assert.equal(error.code, 'NETWORK_ERROR')
    return true
  })
  assert.equal(keys.length, 1)
  fail = false
  await api.createReceipt({ amount: '100' })
  assert.equal(keys[0], keys[1])
  await api.createReceipt({ amount: '100' })
  assert.notEqual(keys[1], keys[2])
})

test('malformed 2xx mutation response reports uncertain result and preserves idempotency', async () => {
  const keys = []
  const { api, setFetch } = harness(async (_url, options) => {
    keys.push(options.headers['Idempotency-Key'])
    return new Response('{"data":', { status: 201, headers: { 'content-type': 'application/json', 'x-request-id': 'bad-json' } })
  })
  await assert.rejects(api.createInvoiceRequest({ items: [] }), (error) => {
    assert.equal(error.code, 'INVALID_RESPONSE')
    assert.equal(error.status, 201)
    assert.equal(error.requestID, 'bad-json')
    assert.match(error.message, /服务器已接受操作.*勿重复提交/)
    assert.doesNotMatch(error.message, /SyntaxError|JSON/)
    return true
  })
  setFetch(async (_url, options) => { keys.push(options.headers['Idempotency-Key']); return json({ data: { id: 'invoice' } }) })
  await api.createInvoiceRequest({ items: [] })
  assert.equal(keys[0], keys[1])
})

test('settlement empty/bare JSON and explicit business errors at HTTP 200 never resolve a mutation', async () => {
  for (const body of [{}, [], { data: {} }, { data: [] }, { data: null }, { code: 'SETTLEMENT_FORBIDDEN', message: '无权操作' }, { code: 'FORBIDDEN', message: '无权操作', data: { id: 'not-successful' } }]) {
    const keys = []
    const { api, calls, setFetch } = harness(async (_url, options) => { keys.push(options.headers['Idempotency-Key']); return json(body, 200, { 'x-request-id': 'envelope-check' }) })
    await assert.rejects(api.createReceipt({ amount: '100' }), (error) => {
      assert.equal(error.status, 200)
      assert.equal(error.requestID, 'envelope-check')
      if (body.code) { assert.equal(error.code, body.code); assert.equal(error.message, '无权操作') }
      else { assert.equal(error.code, 'INVALID_RESPONSE'); assert.match(error.message, /核对结果.*勿重复提交/) }
      return true
    })
    assert.equal(keys.length, 1)
    assert.equal(calls.redirects.length, 0)
    setFetch(async (_url, options) => { keys.push(options.headers['Idempotency-Key']); return json({ data: { id: 'receipt-created' } }) })
    await api.createReceipt({ amount: '100' })
    assert.equal(keys[0], keys[1])
  }
})

test('settlement valid enveloped auth and empty list contracts continue to work', async () => {
  const me = { user_id: 'finance-user', tenant_id: 'tenant', permissions: ['settlement.receipt.read'], catalog_version: 'development' }
  const { api } = harness(async (url) => json({ data: url.endsWith('/auth/me') ? me : [] }))
  assert.equal((await api.getSettlementSession()).identity_id, 'finance-user')
  assert.deepEqual(await api.listReceipts(), [])
  for (const body of [{}, [], { data: {} }, { code: 'OK', data: {} }]) {
    const invalid = harness(async () => json(body))
    await assert.rejects(invalid.api.getSettlementSession(), (error) => error.code === 'INVALID_RESPONSE')
  }
})

test('settlement personnel picker unwraps the real paginated directory without rejecting legacy arrays', async () => {
  const people = [{ user_id: 'collector', display_name: '催收人员', roles: ['settlement_collector'] }]
  for (const data of [people, { items: people, page: 1, page_size: 50, total: 1 }, { items: null, page: 1, page_size: 50, total: 0 }]) {
    const { api } = harness(async () => json({ data }))
    assert.deepEqual(structuredClone(await api.listDunningRecipients()), data.items === null ? [] : people)
  }
  const invalid = harness(async () => json({ data: { items: {}, total: 1 } }))
  await assert.rejects(invalid.api.listDunningRecipients(), error => error.code === 'INVALID_RESPONSE')
})

test('settlement creation cannot report success for an undefined no-content response', async () => {
  for (const status of [204, 205]) {
    const { api } = harness(async () => new Response(null, { status }))
    await assert.rejects(api.createReceipt({ amount: '100' }), (error) => error.code === 'INVALID_RESPONSE' && error.status === status)
  }
})

test('proxy HTML failure and internal exception text are never presented as user errors', async () => {
  const { api, setFetch } = harness(async () => new Response('<html>nginx upstream 10.0.0.1 secret-value</html>', { status: 502, headers: { 'content-type': 'text/html' } }))
  await assert.rejects(api.getDashboard(), (error) => {
    assert.equal(error.status, 502)
    assert.doesNotMatch(error.message, /nginx|10\.0\.0\.1|secret-value|html/i)
    assert.match(error.message, /[\u4e00-\u9fff]/)
    return true
  })
  setFetch(async () => json({ code: 'SETTLEMENT_INTERNAL_ERROR', message: 'Error 1146 (42S02): Table settlement_invoice does not exist' }, 500))
  await assert.rejects(api.getDashboard(), (error) => { assert.doesNotMatch(error.message, /1146|42S02|settlement_invoice/); return true })
})

test('binary download rejects JSON error without leaving the business page', async () => {
  const { api, calls } = harness(async () => json({ code: 'SETTLEMENT_EXPORT_EXPIRED', message: '导出文件已过期，请重新导出' }, 410))
  await assert.rejects(api.downloadReportExport('report'), /已过期/)
  assert.equal(calls.downloads.length, 0)
  assert.equal(calls.redirects.length, 0)
})

test('binary success respects encoded safe file name and revokes the temporary object URL', async () => {
  const { api, calls } = harness(async () => new Response('csv-content', { headers: { 'content-type': 'text/csv', 'content-disposition': "attachment; filename*=UTF-8''%E8%B4%A6%E9%BE%84%2F%E6%8A%A5%E8%A1%A8.csv" } }))
  await api.downloadReportExport('report')
  assert.equal(calls.downloads[0].download, '账龄_报表.csv')
  assert.equal(calls.downloads[0].href, 'blob:isolated-test')
  calls.timers[0]()
  assert.deepEqual(calls.revoked, ['blob:isolated-test'])
})

test('successful HTML login page or empty attachment is not saved as an invoice', async () => {
  for (const response of [new Response('<html>login</html>', { headers: { 'content-type': 'text/html' } }), new Response('', { headers: { 'content-type': 'application/pdf', 'content-disposition': 'attachment; filename="invoice.pdf"' } })]) {
    const { api, calls } = harness(async () => response)
    await assert.rejects(api.downloadTaxInvoiceDocument('invoice', 'document'), (error) => error.code === 'INVALID_RESPONSE')
    assert.equal(calls.downloads.length, 0)
  }
})

test('specific settlement validations describe correction without inventing successful work', () => {
  for (const [message, expected] of [['currency mismatch', /币种不同/], ['receipt and receivable customers differ', /同一客户/], ['version is required', /刷新页面/], ['applicant cannot approve own invoice', /其他.*财务/], ['reason_detail is required', /红冲原因说明/]]) {
    assert.match(formatSettlementError({ code: 'SETTLEMENT_INVALID_REQUEST', message: `invalid input: ${message}` }), expected)
  }
})

test('settlement module translations keep precise Chinese and shared write-timeout precedence', () => {
  const precise = '该笔回款已部分核销，可用余额不足，请选择其他回款或减少核销金额。'
  assert.equal(formatSettlementError({ code: 'SETTLEMENT_CONFLICT', message: precise, status: 409 }), precise)
  const timeout = formatSettlementError({ code: 'SETTLEMENT_INVALID_REQUEST', message: 'invalid input: currency mismatch', status: 504 }, { method: 'POST' })
  assert.match(timeout, /无法确认操作结果.*避免重复提交/)
  assert.doesNotMatch(timeout, /币种不同/)
})

async function viewHarness(overrides = {}) {
  const component = await readFile(new URL('./views/SettlementView.vue', import.meta.url), 'utf8')
  const apiNames = component.match(/import \{([^}]+)\} from "@\/modules\/settlement\/api\/settlement";/)[1].split(',').map(value => value.trim()).filter(value => /^[A-Za-z]+$/.test(value))
  const bindings = Object.fromEntries(apiNames.map(name => [name, async () => []]))
  const script = component.match(/<script setup>([\s\S]*?)<\/script>/)[1].replace(/^import[\s\S]*?;\n/gm, '')
  const context = vm.createContext({
    ref: value => ({ value }), computed: getter => ({ get value() { return getter() } }), watch() {},
    useRoute: () => ({ params: { section: 'receipts' }, query: {} }), useRouter: () => ({ push() {}, replace() {} }),
    window: { setTimeout() {}, confirm: () => false }, formatSettlementError, ...bindings,
    getSettlementSession: async () => ({}), ...overrides,
  })
  vm.runInContext(`${script}\nglobalThis.ui = { submitReceipt, act, message, receiptComposerOpen, receiptMatchFor, receiptMatches, error };`, context)
  return context.ui
}

test('receipt registration success followed by match failure cannot be misreported as registration failure', async () => {
  let registrations = 0
  const ui = await viewHarness({ createReceipt: async () => { registrations++; return { id: 'receipt-created' } }, listReceiptMatches: async () => { throw new TypeError('Failed to fetch') } })
  ui.receiptComposerOpen.value = true
  await ui.submitReceipt()
  assert.equal(registrations, 1)
  assert.equal(ui.receiptComposerOpen.value, false)
  assert.equal(ui.receiptMatchFor.value, 'receipt-created')
  assert.match(ui.message.value, /回款已登记.*可核销应收查询失败.*勿重复登记/)
  assert.doesNotMatch(ui.message.value, /回款登记失败|TypeError|fetch/)
})

test('completed financial operation remains successful when subsequent page refresh fails', async () => {
  let writes = 0
  const ui = await viewHarness({ listReceipts: async () => { throw Error('internal database failure') } })
  await ui.act(async () => { writes++ }, '核销分配已确认。')
  assert.equal(writes, 1)
  assert.match(ui.message.value, /核销分配已确认.*页面刷新失败.*勿重复提交/)
  assert.doesNotMatch(ui.message.value, /操作失败|database/)
  assert.ok(ui.error.value)
})
