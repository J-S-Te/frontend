import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { attachStructuredContext, createApiRequestContext } from '../platform/shared/api/requestContext.js'
import { shouldStartSubsystemLogin } from '../shared/authz/sessionCompatibility.js'
import { formatDataAnalysisError } from './utils/errors.js'

const source = await readFile(new URL('./api/dataAnalysis.js', import.meta.url), 'utf8')
function harness(fetcher) {
  const redirects = []
  const context = vm.createContext({
    fetch: fetcher, attachStructuredContext, createApiRequestContext, shouldStartSubsystemLogin,
    formatDataAnalysisError, URLSearchParams,
    window: { location: { replace: (url) => redirects.push(url) } },
  })
  const script = source.replace(/^import .*$/gm, '').replace(/import\.meta\.env/g, '({})').replace(/^export /gm, '')
  vm.runInContext(`${script}\nglobalThis.api = { getAuthMe, getAlertRules, putAlertRules, triggerSource, getEmbedToken, createDictionaryMetric, deleteAlertRule, deleteDictionaryMetric, ensureDataAnalysisSession };`, context)
  return { api: context.api, redirects }
}
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })

test('BI known validation and version conflicts use actionable Chinese without field-name jargon', async () => {
  for (const [code, message, expected] of [
    ['RULE_PAYLOAD_INVALID', 'rule_code, name and source_fct are required', /规则名称.*提前天数/],
    ['RULE_VERSION_CONFLICT', 'version conflict', /刷新规则后重新编辑/],
    ['SOURCE_DISABLED', 'sync source is disabled', /停用.*管理员/],
    ['SYNC_ALREADY_QUEUED', 'sync source already has an active job', /无需重复触发/],
  ]) {
    const { api, redirects } = harness(async () => json({ code, message }, code === 'RULE_PAYLOAD_INVALID' ? 400 : 409))
    await assert.rejects(api.putAlertRules([]), (error) => {
      assert.match(error.message, expected)
      assert.doesNotMatch(error.message, /source_fct|rule_code|active job|sync source/)
      assert.equal(error.code, code)
      assert.equal(error.context.subsystem, 'data_analysis')
      return true
    })
    assert.equal(redirects.length, 0)
  }
})

test('BI preserves precise safe backend Chinese instead of replacing it with a general code label', async () => {
  for (const [code, message, status] of [
    ['SOURCE_DISABLED', '该数据源因接入凭据过期已停用，请在应用接入中更新凭据后再同步。', 409],
    ['RULE_VERSION_CONFLICT', '预警规则已更新，请关闭编辑框并重新打开，以免覆盖新的提前天数。', 409],
    ['RULE_PAYLOAD_INVALID', '提前天数必须为 1 至 3650 的整数，请重新填写。', 400],
  ]) {
    const { api } = harness(async () => json({ code, message }, status))
    await assert.rejects(api.putAlertRules([]), (error) => { assert.equal(error.message, message); assert.equal(error.code, code); return true })
  }
})

test('BI code translations cannot override shared write-timeout and unknown-result safety', async () => {
  for (const [status, code, message] of [[504, 'SYNC_JOB_CREATE_FAILED', 'failed to queue sync job'], [408, 'RULE_SAVE_FAILED', 'failed to save rules']]) {
    const { api } = harness(async () => json({ code, message }, status))
    await assert.rejects(api.triggerSource('source'), (error) => {
      assert.match(error.message, /无法确认操作结果.*避免重复提交/)
      assert.doesNotMatch(error.message, /请稍后重试|稍后重新触发/)
      return true
    })
  }
  const { api } = harness(async () => json({ code: 'SYNC_JOB_CREATE_FAILED', message: 'failed to queue sync job' }, 500))
  await assert.rejects(api.triggerSource('source'), (error) => { assert.match(error.message, /查看任务状态.*勿重复触发/); return true })
})

test('BI wire-type mismatch identifies incompatible system versions and preserves details/request IDs', async () => {
  const details = { reason: 'invalid_type', field: 'threshold_json' }
  const { api } = harness(async () => json({ code: 'RULE_PAYLOAD_INVALID', message: 'cannot unmarshal object into string', details }, 400, { 'x-request-id': 'req-bi', 'x-trace-id': 'trace-bi' }))
  await assert.rejects(api.putAlertRules([]), (error) => {
    assert.match(error.message, /数据格式.*系统版本/)
    assert.doesNotMatch(error.message, /unmarshal|threshold_json/)
    assert.equal(error.requestID, 'req-bi')
    assert.equal(error.traceId, 'trace-bi')
    assert.deepEqual(error.details, details)
    return true
  })
})

test('BI ordinary 401 starts OIDC, while invalid claims never enter a login redirect loop', async () => {
  const unauthenticated = harness(async () => json({ code: 'UNAUTHENTICATED', message: 'not authenticated' }, 401))
  assert.equal(await unauthenticated.api.ensureDataAnalysisSession(), null)
  assert.deepEqual(unauthenticated.redirects, ['/data_analysis/auth/login'])
  const invalid = harness(async () => json({ code: 'OIDC_CLAIMS_INVALID', message: 'OIDC authorization claims invalid' }, 401))
  await assert.rejects(invalid.api.ensureDataAnalysisSession(), (error) => error.code === 'OIDC_CLAIMS_INVALID')
  assert.equal(invalid.redirects.length, 0)
})

test('BI malformed successful mutation does not appear saved or automatically repeat', async () => {
  let calls = 0
  const { api } = harness(async () => { calls++; return new Response('{"data":', { headers: { 'content-type': 'application/json', 'x-request-id': 'broken-bi' } }) })
  await assert.rejects(api.createDictionaryMetric({ code: 'TEST' }), (error) => {
    assert.match(error.message, /服务器已接受操作.*勿重复提交/)
    assert.equal(error.code, 'INVALID_RESPONSE')
    assert.equal(error.status, 200)
    assert.equal(error.requestID, 'broken-bi')
    return true
  })
  assert.equal(calls, 1)
})

test('BI empty/bare JSON or explicit failure code at HTTP 200 cannot be mistaken for saved data', async () => {
  for (const body of [{}, [], { data: {} }, { data: [] }, { data: null }, { code: 'FORBIDDEN', message: '无权操作' }, { code: 'FORBIDDEN', message: '无权操作', data: { code: 'not-saved' } }]) {
    let calls = 0
    const { api, redirects } = harness(async () => { calls++; return json(body, 200, { 'x-request-id': 'bi-envelope' }) })
    await assert.rejects(api.createDictionaryMetric({ code: 'TEST' }), (error) => {
      assert.equal(error.status, 200)
      assert.equal(error.requestID, 'bi-envelope')
      if (body.code) { assert.equal(error.code, body.code); assert.equal(error.message, '无权操作') }
      else { assert.equal(error.code, 'INVALID_RESPONSE'); assert.match(error.message, /核对结果.*勿重复提交/) }
      return true
    })
    assert.equal(calls, 1)
    assert.equal(redirects.length, 0)
  }
})

test('BI valid current and legacy data envelopes retain session, list and bulk-save contracts', async () => {
  for (const code of [undefined, 'OK']) {
    const envelope = data => code ? { code, data } : { data }
    const me = { user_id: 'dashboard-user', tenant_id: 'tenant', permissions: ['dictionary.manage'], roles: ['admin'] }
    const rule = { id: 'rule', version: 1, rule_code: 'CONTRACT_EXPIRY' }
    const { api } = harness(async (url, options) => json(envelope(url.endsWith('/auth/me') ? me : options.method === 'PUT' ? [rule] : [])))
    assert.equal((await api.ensureDataAnalysisSession()).user_id, 'dashboard-user')
    assert.deepEqual(await api.getAlertRules(), [])
    assert.deepEqual(await api.putAlertRules([rule]), [rule])
  }
  const invalid = harness(async () => json({ code: 'OK', data: {} }))
  await assert.rejects(invalid.api.getAuthMe(), error => error.code === 'INVALID_RESPONSE')
})

test('BI delete retains explicit success/no-content contracts but create requires actual data', async () => {
  for (const status of [204, 205]) {
    const deletion = harness(async () => new Response(null, { status }))
    assert.equal(await deletion.api.deleteAlertRule('rule'), null)
    const creation = harness(async () => new Response(null, { status }))
    await assert.rejects(creation.api.createDictionaryMetric({ code: 'TEST' }), error => error.code === 'INVALID_RESPONSE' && error.status === status)
  }
  const successful = harness(async () => json({ code: 'OK', data: { deleted: true } }))
  assert.deepEqual(await successful.api.deleteDictionaryMetric('TEST', 1), { deleted: true })
  const rejected = harness(async () => json({ code: 'OK', data: { deleted: false } }))
  await assert.rejects(rejected.api.deleteAlertRule('rule'), error => error.code === 'INVALID_RESPONSE')
})

test('BI upstream HTML and SQL error details stay outside human-readable messages', async () => {
  for (const response of [new Response('<html>nginx upstream password=secret</html>', { status: 502, headers: { 'content-type': 'text/html' } }), json({ code: 'RULE_LIST_FAILED', message: 'SQLSTATE 42S02: SELECT * FROM dashboard_rule' }, 500)]) {
    const { api } = harness(async () => response)
    await assert.rejects(api.getAlertRules(), (error) => { assert.match(error.message, /[\u4e00-\u9fff]/); assert.doesNotMatch(error.message, /nginx|SQLSTATE|dashboard_rule|secret/); return true })
  }
})

test('BI mutation network timeout is not retried and reports unconfirmed result', async () => {
  let calls = 0
  const { api } = harness(async () => { calls++; throw Object.assign(Error('AbortError'), { name: 'AbortError' }) })
  await assert.rejects(api.triggerSource('source'), (error) => {
    assert.match(error.message, /尚无法确认.*勿重复提交/)
    assert.equal(error.code, 'REQUEST_TIMEOUT')
    assert.equal(error.status, 0)
    return true
  })
  assert.equal(calls, 1)
})

async function componentHarness(name, bindings) {
  const component = await readFile(new URL(`./views/${name}.vue`, import.meta.url), 'utf8')
  const script = component.match(/<script setup>([\s\S]*?)<\/script>/)[1].replace(/^import .*$/gm, '')
  const context = vm.createContext({ ref: (value) => ({ value }), computed: (getter) => ({ get value() { return getter() } }), defineProps: () => ({ permissions: ['alert.manage', 'aggregation.manage'] }), onMounted() {}, formatDataAnalysisError, ...bindings })
  vm.runInContext(`${script}\nglobalThis.ui = { load, error, ${name === 'AdminSourcesView' ? 'onTrigger, onTriggerAll, notice' : 'runAction'} };`, context)
  return context.ui
}

test('BI synchronization accepted then refresh failed is clearly distinguished from failed submission', async () => {
  let writes = 0
  const ui = await componentHarness('AdminSourcesView', { listSources: async () => { throw Error('database unavailable') }, triggerSource: async () => { writes++; return { note: '任务已排队' } }, triggerAllSources: async () => ({ queued: 1, skipped: 0 }) })
  await ui.onTrigger('source')
  assert.equal(writes, 1)
  assert.match(ui.error.value, /任务已入队.*列表刷新失败.*无需重复触发/)
  assert.match(ui.notice.value, /任务已排队/)
})

test('BI alert accepted then refresh failed does not imply the state transition failed', async () => {
  let writes = 0
  const ui = await componentHarness('AlertsCenterView', { getAlerts: async () => { throw Error('database unavailable') }, getAlertSummary: async () => ({}), ackAlert: async () => { writes++ }, closeAlert: async () => { writes++ } })
  await ui.runAction('alert', 'ack')
  assert.equal(writes, 1)
  assert.match(ui.error.value, /预警已受理.*列表刷新失败.*无需重复操作/)
})
