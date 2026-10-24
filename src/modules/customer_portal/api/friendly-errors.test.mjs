import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { PortalAPIError, createReportRequest, downloadIssuedReport, downloadProjectExport, exportFilingPDF, listFilings, listProjects, saveFilingSection } from './portal.js'

function stubFetch(t, implementation) {
  const original = globalThis.fetch
  t.after(() => { globalThis.fetch = original })
  globalThis.fetch = implementation
}

test('Portal provides actionable version and locked-state errors without changing business codes', () => {
  const conflict = new PortalAPIError('filing draft was modified by another request', { status: 409, code: 'PORTAL_FILING_VERSION_CONFLICT', requestID: 'req-conflict', details: { expected_version: 5 } })
  assert.match(conflict.message, /其他操作修改.*重新读取/)
  assert.equal(conflict.code, 'PORTAL_FILING_VERSION_CONFLICT')
  assert.equal(conflict.requestID, 'req-conflict')
  assert.deepEqual(conflict.details, { expected_version: 5 })
  const locked = new PortalAPIError('submitted filing is locked', { status: 409, code: 'PORTAL_FILING_LOCKED' })
  assert.match(locked.message, /已提交并锁定.*服务人员/)
})

test('Portal preserves a safe specific Chinese business reason ahead of a generic filing code translation', () => {
  const specific = '备案资料的单位联系电话应为有效的 11 位手机号，请重新填写。'
  assert.equal(new PortalAPIError(specific, { status: 422, code: 'PORTAL_FILING_VALIDATION_ERROR' }).message, specific)
  const generic = new PortalAPIError('请求参数不合法', { status: 422, code: 'PORTAL_FILING_VALIDATION_ERROR' })
  assert.match(generic.message, /当前分区的必填项.*预检问题/)
  const field = new PortalAPIError(specific, { status: 422, code: 'PORTAL_FILING_VALIDATION_ERROR', details: { field: 'phone', rule: 'required' } })
  assert.equal(field.message, '请填写联系电话。')
  const mismatch = new PortalAPIError('json: cannot unmarshal string into expected_version', { status: 422, code: 'PORTAL_FILING_VALIDATION_ERROR' })
  assert.match(mismatch.message, /页面.*数据格式.*服务.*不一致/)
})

test('Portal report validation explains real editable fields and retains the server diagnosis', async (t) => {
  stubFetch(t, async () => new Response(JSON.stringify({ code: 'PORTAL_REPORT_INVALID_REQUEST', message: 'report request is invalid', request_id: 'req-report', details: { field: 'receive_email' } }), { status: 400, headers: { 'content-type': 'application/json' } }))
  await assert.rejects(createReportRequest({}), (error) => {
    assert.match(error.message, /项目.*报告类型.*申请原因.*接收邮箱/)
    assert.equal(error.status, 400)
    assert.equal(error.code, 'PORTAL_REPORT_INVALID_REQUEST')
    assert.equal(error.requestID, 'req-report')
    assert.deepEqual(error.details, { field: 'receive_email' })
    return true
  })
})

test('Portal DTO field type mismatch is explained as a page/service version issue', async (t) => {
  stubFetch(t, async () => new Response(JSON.stringify({ code: 'COMMON_INVALID_ARGUMENT', message: 'json: cannot unmarshal string into Go struct field expected_version of type int64', details: { reason: 'invalid_type', field: 'expected_version' } }), { status: 422, headers: { 'content-type': 'application/json' } }))
  await assert.rejects(saveFilingSection('FILE-1', 'UNIT', {}), (error) => {
    assert.match(error.message, /页面.*数据格式.*服务.*不一致/)
    assert.doesNotMatch(error.message, /unmarshal|int64|expected_version/)
    return true
  })
})

test('Portal rejects malformed JSON and HTML success responses instead of reporting a saved draft', async (t) => {
  const original = globalThis.fetch
  t.after(() => { globalThis.fetch = original })
  for (const [body, type] of [['<html>proxy login</html>', 'text/html'], ['{"data":', 'application/json']]) {
    globalThis.fetch = async () => new Response(body, { status: 200, headers: { 'content-type': type } })
    for (const [invoke, method] of [[() => listProjects(), 'GET'], [() => saveFilingSection('FILE-1', 'UNIT', {}), 'PUT']]) {
      await assert.rejects(invoke(), (error) => {
        assert.equal(error.code, 'PORTAL_RESPONSE_INVALID')
        assert.match(error.message, /服务返回的信息无法识别/)
        assert.equal(error.context.method, method)
        if (method === 'PUT') assert.match(error.message, /确认操作结果.*核对.*避免重复提交/)
        else assert.match(error.message, /刷新页面后重试/)
        assert.doesNotMatch(error.message, /<html>|proxy login/)
        return true
      })
    }
  }
})

test('Portal rejects empty/array/error-code 200 envelopes and keeps writes outcome-unknown', async (t) => {
  const original = globalThis.fetch
  t.after(() => { globalThis.fetch = original })
  for (const body of [{}, [], { code: 'OK' }, { data: {} }, { code: 'PORTAL_FORBIDDEN', message: '无权操作', request_id: 'portal-contradiction' }]) {
    globalThis.fetch = async () => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
    for (const [invoke, method] of [[() => listProjects(), 'GET'], [() => saveFilingSection('FILE-1', 'UNIT', {}), 'PUT']]) {
      await assert.rejects(invoke(), (error) => {
        assert.equal(error.code, 'PORTAL_RESPONSE_INVALID')
        assert.equal(error.context.method, method)
        if (method === 'PUT') assert.match(error.message, /核对.*避免重复提交/)
        else assert.match(error.message, /刷新页面后重试/)
        if (body.code === 'PORTAL_FORBIDDEN') {
          assert.equal(error.responseCode, body.code)
          assert.equal(error.requestID, body.request_id)
        }
        return true
      })
    }
  }
})

test('Portal accepts real OK envelopes with empty collection/null data', async (t) => {
  const original = globalThis.fetch
  t.after(() => { globalThis.fetch = original })
  for (const data of [[], null, { items: [], total: 0 }]) {
    globalThis.fetch = async () => new Response(JSON.stringify({ code: 'OK', message: 'success', data }), { headers: { 'content-type': 'application/json' } })
    assert.deepEqual(await listFilings(), data)
  }
})

test('Portal write cancellation retains its method and outcome-unknown guidance', async (t) => {
  const original = globalThis.fetch
  t.after(() => { globalThis.fetch = original })
  const cancelled = new DOMException('The operation was aborted', 'AbortError')
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
    await assert.rejects(saveFilingSection('FILE-1', 'UNIT', {}), (error) => {
      assert.equal(error.name, 'AbortError')
      assert.equal(error.code, 'REQUEST_ABORTED')
      assert.equal(error.context.method, 'PUT')
      assert.match(error.message, /确认操作结果.*核对.*避免重复提交/)
      return true
    })
  }
  globalThis.fetch = async () => { throw cancelled }
  await assert.rejects(listProjects(), (error) => error === cancelled)
  await assert.rejects(exportFilingPDF('FILE-1', 3), (error) => error === cancelled)
})

test('Portal network failure shows a Chinese recovery instruction for JSON and filing PDF calls', async (t) => {
  stubFetch(t, async () => { throw new TypeError('Failed to fetch') })
  for (const invoke of [() => listProjects(), () => exportFilingPDF('FILE-1', 3)]) {
    await assert.rejects(invoke(), (error) => {
      assert.equal(error.code, 'PORTAL_NETWORK_ERROR')
      assert.match(error.message, /网络|连接/)
      assert.doesNotMatch(error.message, /Failed to fetch/)
      return true
    })
  }
})

test('Portal an interrupted report submission requires result verification before resubmitting', async (t) => {
  stubFetch(t, async () => { throw new TypeError('Failed to fetch') })
  await assert.rejects(createReportRequest({}), (error) => {
    assert.match(error.message, /确认操作结果.*核对.*避免重复提交/)
    return true
  })
})

test('Portal report and project downloads preserve AbortError, never masking close-dialog cancellation as failure', async (t) => {
  const cancelled = new DOMException('The operation was aborted', 'AbortError')
  stubFetch(t, async (url) => {
    if (url.endsWith('/download-grants')) return new Response(JSON.stringify({ code: 'OK', data: { download_token: 'test-only-opaque-token' } }), { headers: { 'content-type': 'application/json' } })
    throw cancelled
  })
  for (const invoke of [() => downloadIssuedReport(1), () => downloadProjectExport(1)]) {
    await assert.rejects(invoke(), (error) => error === cancelled)
  }
})

test('Portal PDF and JSON failures never display raw proxy error bodies', async (t) => {
  stubFetch(t, async () => new Response('<html>SQLSTATE SELECT secret Bearer forbidden-token</html>', { status: 502, headers: { 'content-type': 'text/html' } }))
  for (const invoke of [() => listProjects(), () => exportFilingPDF('FILE-1', 3)]) {
    await assert.rejects(invoke(), (error) => {
      assert.match(error.message, /服务|稍后|管理员/)
      assert.doesNotMatch(error.message, /<html>|SQLSTATE|SELECT|Bearer|forbidden-token/)
      return true
    })
  }
})

test('Portal error panels sanitize both component emissions and local native errors', async () => {
  for (const path of ['views/CustomerPortalView.vue', 'components/FilingWizard.vue']) {
    const source = await readFile(new URL(`../${path}`, import.meta.url), 'utf8')
    assert.match(source, /formatPortalError/)
    assert.doesNotMatch(source, /\w+\?\.message \|\|/)
  }
})
