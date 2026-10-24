import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { CRMAPIError, request, requestAuthorizedFile, requestBlob } from './client.js'

function stubFetch(t, implementation) {
  const original = globalThis.fetch
  t.after(() => { globalThis.fetch = original })
  globalThis.fetch = implementation
}

test('CRM translates actual business validation errors and retains diagnostic fields', async (t) => {
  const details = { field: 'registration_contact', reason: 'required' }
  stubFetch(t, async () => new Response(JSON.stringify({ code: 'CRM_CUSTOMER_INVALID_REGISTRATION_CONTACT', message: 'exactly one registration contact is required', request_id: 'req-crm-validation', details }), { status: 422, headers: { 'content-type': 'application/json' } }))
  await assert.rejects(request('/customers', { method: 'POST', body: '{}' }), (error) => {
    assert.ok(error instanceof CRMAPIError)
    assert.match(error.message, /且仅设置一位登记联系人/)
    assert.doesNotMatch(error.message, /registration_contact|HTTP|exactly/)
    assert.equal(error.status, 422)
    assert.equal(error.code, 'CRM_CUSTOMER_INVALID_REGISTRATION_CONTACT')
    assert.equal(error.requestID, 'req-crm-validation')
    assert.deepEqual(error.details, details)
    return true
  })
})

test('CRM business conflicts explain expired import previews rather than a generic version error', () => {
  const error = new CRMAPIError('customer import preview has expired', { status: 409, code: 'CRM_CUSTOMER_IMPORT_JOB_EXPIRED' })
  assert.match(error.message, /预检已过期.*重新上传/)
})

test('CRM preserves precise safe Chinese rejection and lets structured fields outrank code fallbacks', () => {
  const specific = '预计完成日期不能早于开始日期，请调整后保存。'
  const error = new CRMAPIError(specific, { status: 422, code: 'CRM_PRESALE_INVALID_INPUT' })
  assert.equal(error.message, specific)
  const generic = new CRMAPIError('请求参数不合法', { status: 400, code: 'CRM_CREDIT_APPLICATION_INVALID' })
  assert.match(generic.message, /目标等级.*调整原因/)
  const field = new CRMAPIError(specific, { status: 422, code: 'CRM_PRESALE_INVALID_INPUT', details: { field: 'name', rule: 'required' } })
  assert.equal(field.message, '请填写名称。')
  const mismatch = new CRMAPIError('json: unknown field "legacy_note"', { status: 422, code: 'CRM_PRESALE_INVALID_INPUT' })
  assert.match(mismatch.message, /页面.*数据格式.*服务.*不一致/)
})

test('CRM strict DTO mismatch asks users to refresh versions rather than edit unknown technical fields', async (t) => {
  stubFetch(t, async () => new Response(JSON.stringify({ code: 'COMMON_INVALID_ARGUMENT', message: 'json: unknown field "internal_new_field"', details: { reason: 'unknown_field', field: 'internal_new_field' } }), { status: 422, headers: { 'content-type': 'application/json' } }))
  await assert.rejects(request('/customers', { method: 'POST', body: '{}' }), (error) => {
    assert.match(error.message, /页面.*数据格式.*服务.*不一致/)
    assert.doesNotMatch(error.message, /json|unknown field|internal_new_field/)
    return true
  })
})

test('CRM refuses malformed or HTML success responses for both reads and mutations', async (t) => {
  const original = globalThis.fetch
  t.after(() => { globalThis.fetch = original })
  for (const [body, type] of [['<html>login proxy page</html>', 'text/html'], ['{"data":', 'application/json'], ['null', 'application/json']]) {
    globalThis.fetch = async () => new Response(body, { status: 200, headers: { 'content-type': type } })
    for (const options of [{}, { method: 'PUT', body: '{}' }]) {
      await assert.rejects(request('/customers/1', options), (error) => {
        assert.equal(error.code, 'CRM_RESPONSE_INVALID')
        assert.match(error.message, /服务返回的信息无法识别/)
        assert.equal(error.context.method, options.method || 'GET')
        assert.equal(error.context.path, '/customers/1')
        if (options.method) assert.match(error.message, /确认操作结果.*核对.*避免重复提交/)
        else assert.match(error.message, /刷新页面后重试/)
        assert.doesNotMatch(error.message, /<html>|login proxy/)
        return true
      })
    }
  }
})

test('CRM rejects empty, array and error-code 200 envelopes instead of acknowledging writes', async (t) => {
  const original = globalThis.fetch
  t.after(() => { globalThis.fetch = original })
  const rejected = [{}, [], { code: 'OK' }, { data: {} }, { code: 'CRM_FORBIDDEN', message: '无权操作', request_id: 'contradictory-response', details: { field: 'name' } }]
  for (const body of rejected) {
    globalThis.fetch = async () => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
    for (const method of ['GET', 'POST', 'PUT', 'DELETE']) {
      await assert.rejects(request('/customers/1', { method }), (error) => {
        assert.equal(error.code, 'CRM_RESPONSE_INVALID')
        assert.equal(error.context.method, method)
        if (method !== 'GET') assert.match(error.message, /核对.*避免重复提交/)
        else assert.match(error.message, /刷新页面后重试/)
        if (body.code === 'CRM_FORBIDDEN') {
          assert.equal(error.responseCode, body.code)
          assert.equal(error.requestID, body.request_id)
          assert.deepEqual(error.details, body.details)
        }
        return true
      })
    }
  }
})

test('CRM accepts actual OK envelopes with empty list/null data and explicit no-content status', async (t) => {
  const original = globalThis.fetch
  t.after(() => { globalThis.fetch = original })
  for (const data of [[], null, { items: [], total: 0 }]) {
    globalThis.fetch = async () => new Response(JSON.stringify({ code: 'OK', message: 'success', data }), { headers: { 'content-type': 'application/json' } })
    assert.deepEqual(await request('/customers'), data)
  }
  for (const status of [204, 205]) {
    globalThis.fetch = async () => new Response(null, { status })
    assert.deepEqual(await request('/customers/1', { method: 'DELETE' }), {})
  }
})

test('CRM interrupted writes retain AbortError semantics and real method for safe user judgment', async (t) => {
  const original = globalThis.fetch
  t.after(() => { globalThis.fetch = original })
  const cancelled = new DOMException('The operation was aborted', 'AbortError')
  for (const method of ['POST', 'PUT', 'DELETE']) {
    for (const phase of ['fetch', 'body', 'error-body']) {
      globalThis.fetch = async () => {
        if (phase === 'fetch') throw cancelled
        if (phase === 'error-body') {
          const response = new Response('upstream error', { status: 502, headers: { 'content-type': 'text/plain' } })
          response.text = async () => { throw cancelled }
          return response
        }
        const response = new Response('{"code":"OK","data":{}}', { headers: { 'content-type': 'application/json' } })
        response.json = async () => { throw cancelled }
        return response
      }
      await assert.rejects(request('/customers/1', { method }), (error) => {
        assert.equal(error.name, 'AbortError')
        assert.equal(error.code, 'REQUEST_ABORTED')
        assert.equal(error.context.method, method)
        assert.equal(error.context.path, '/customers/1')
        assert.match(error.message, /确认操作结果.*核对.*避免重复提交/)
        assert.doesNotMatch(error.message, /读取已取消/)
        return true
      })
    }
  }
})

test('CRM network errors are actionable across JSON, CSV and authorized file calls', async (t) => {
  stubFetch(t, async () => { throw new TypeError('Failed to fetch') })
  for (const invoke of [() => request('/customers'), () => requestBlob('/customers/export'), () => requestAuthorizedFile('/attachment', new Set(['application/pdf']))]) {
    await assert.rejects(invoke(), (error) => {
      assert.equal(error.code, 'CRM_NETWORK_ERROR')
      assert.equal(error.status, 0)
      assert.match(error.message, /网络|连接/)
      assert.doesNotMatch(error.message, /Failed to fetch/)
      return true
    })
  }
})

test('CRM preserves cancellation and accepts genuine no-content responses', async (t) => {
  const original = globalThis.fetch
  t.after(() => { globalThis.fetch = original })
  const cancelled = new DOMException('The operation was aborted', 'AbortError')
  globalThis.fetch = async () => { throw cancelled }
  await assert.rejects(request('/customers', { signal: new AbortController().signal }), (error) => error === cancelled)
  globalThis.fetch = async () => {
    const response = new Response('{}', { headers: { 'content-type': 'application/json' } })
    response.json = async () => { throw cancelled }
    return response
  }
  await assert.rejects(request('/customers'), (error) => error === cancelled)
  globalThis.fetch = async () => new Response(null, { status: 204 })
  assert.deepEqual(await request('/customers/1', { method: 'DELETE' }), {})
})

test('CRM an interrupted write never recommends a blind duplicate submission', async (t) => {
  stubFetch(t, async () => { throw new TypeError('Failed to fetch') })
  await assert.rejects(request('/customers', { method: 'POST', body: '{}' }), (error) => {
    assert.equal(error.code, 'CRM_NETWORK_ERROR')
    assert.match(error.message, /确认操作结果.*核对.*避免重复提交/)
    return true
  })
})

test('CRM JSON and CSV errors never expose raw HTML, SQL or bearer tokens', async (t) => {
  const original = globalThis.fetch
  t.after(() => { globalThis.fetch = original })
  for (const invoke of [() => request('/customers'), () => requestBlob('/customers/export')]) {
    globalThis.fetch = async () => new Response('<html>SQLSTATE[HY000] SELECT secret FROM users Authorization: Bearer hidden-token</html>', { status: 502, headers: { 'content-type': 'text/html' } })
    await assert.rejects(invoke(), (error) => {
      assert.match(error.message, /服务|稍后|管理员/)
      assert.doesNotMatch(error.message, /SQLSTATE|SELECT|Bearer|hidden-token|<html>/)
      return true
    })
  }
})

test('CRM local error panels use the safe formatter rather than raw exception messages', async () => {
  const paths = ['views/CustomerOpportunityView.vue', 'components/OwnerSelector.vue', 'components/CustomerCreditPanel.vue', 'components/CreditApprovalInbox.vue', 'components/CreditRuleSettingsPanel.vue', 'components/OpportunityCatalogDialog.vue', 'components/PresaleApprovalRulesPanel.vue']
  for (const path of paths) {
    const source = await readFile(new URL(`../${path}`, import.meta.url), 'utf8')
    assert.match(source, /formatCRMError/)
    assert.doesNotMatch(source, /\w+\?\.message \|\|/)
  }
})
