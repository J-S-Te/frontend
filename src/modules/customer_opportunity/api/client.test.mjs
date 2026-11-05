import assert from 'node:assert/strict'
import test from 'node:test'

import { buildCRMLoginURL, getCRMSession, request, requestAuthorizedFile, requestBlob } from './client.js'

test('CRM login URL preserves the complete same-origin return path', () => {
  assert.equal(
    buildCRMLoginURL({ pathname: '/customer-opportunity/customers', search: '?page=2', hash: '#detail' }),
    '/customer-opportunity/auth/login?return_to=%2Fcustomer-opportunity%2Fcustomers%3Fpage%3D2%23detail',
  )
})

test('CRM auth session carries the unified authorization context fields', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })
  globalThis.fetch = async () => new Response(JSON.stringify({ code: 'OK', data: {
    sub: 'identity-1', identity_id: 'identity-1', person_id: 'person-1',
    data_scopes: [{ scope_type: 'ORG', scope_id: 'org-1' }],
    authorization_revision: 12, catalog_version: 'crm-2026.08',
  } }), { status: 200, headers: { 'content-type': 'application/json' } })

  const session = await getCRMSession()
  assert.equal(session.identity_id, 'identity-1')
  assert.equal(session.person_id, 'person-1')
  assert.equal(session.authorization_revision, 12)
  assert.equal(session.catalog_version, 'crm-2026.08')
  assert.deepEqual(session.data_scopes, [{ scope_type: 'ORG', scope_id: 'org-1' }])
})

test('CRM GET requests bypass browser caches because customer visibility follows the current session', async (t) => {
  const originalFetch = globalThis.fetch
  let requestOptions = null
  t.after(() => { globalThis.fetch = originalFetch })
  globalThis.fetch = async (_url, options) => {
    requestOptions = options
    return new Response(JSON.stringify({ code: 'OK', data: { items: [] } }), { status: 200, headers: { 'content-type': 'application/json' } })
  }

  await request('/customers?page=1&page_size=20')

  assert.equal(requestOptions?.method, undefined)
  assert.equal(requestOptions?.cache, 'no-store')
  assert.equal(requestOptions?.credentials, 'include')
})

test('CRM does not turn invalid OIDC claims into an automatic login loop', async (t) => {
  const originalFetch = globalThis.fetch
  const originalWindow = globalThis.window
  let redirect = ''
  t.after(() => { globalThis.fetch = originalFetch; globalThis.window = originalWindow })
  globalThis.window = { location: { pathname: '/customer-opportunity', search: '', hash: '', replace: (value) => { redirect = value } } }
  globalThis.fetch = async () => new Response(JSON.stringify({ code: 'CRM_OIDC_INVALID_CLAIMS', message: 'OIDC authorization claims are invalid' }), { status: 401, headers: { 'content-type': 'application/json' } })

  await assert.rejects(request('/auth/me'), (error) => error.status === 401 && error.code === 'CRM_OIDC_INVALID_CLAIMS')
  assert.equal(redirect, '')
})

test('CRM CSV download decodes UTF-8 filename* and prefers it over filename', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })
  globalThis.fetch = async () => new Response('\ufeff客户,错误\n张三,重复', {
    status: 200,
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': "attachment; filename=\"plain.csv\"; filename*=UTF-8''%E5%AE%A2%E6%88%B7%E5%AF%BC%E5%85%A5%E9%94%99%E8%AF%AF.csv",
    },
  })

  const result = await requestBlob('/customers/imports/JOB-1/errors')
  assert.equal(result.filename, '客户导入错误.csv')
  assert.match(await result.blob.text(), /张三,重复/)
})

test('CRM CSV download keeps the controlled fallback for unsafe or non-CSV filenames', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })
  const headers = [
    { 'content-type': 'text/csv', 'content-disposition': "attachment; filename*=UTF-8''%E4%B8%AD%ZZ" },
    { 'content-type': 'text/csv', 'content-disposition': 'attachment; filename="errors.pdf"' },
    { 'content-type': 'text/csv', 'content-disposition': 'attachment; filename="../../\u0007errors.csv"' },
  ]
  for (const header of headers) {
    globalThis.fetch = async () => new Response('a,b\n1,2', { status: 200, headers: header })
    const result = await requestBlob('/customers/imports/JOB-1/errors')
    assert.equal(result.filename, 'customer-import-errors.csv')
    assert.doesNotMatch(result.filename, /[\\/\u0000-\u001f\u007f]/)
  }
})

test('CRM authorized file download decodes Chinese filename* and falls back safely', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })
  globalThis.fetch = async () => new Response(new Blob(['%PDF-1.7'], { type: 'application/pdf' }), {
    status: 200,
    headers: { 'content-type': 'application/pdf', 'content-disposition': "attachment; filename*=UTF-8''%E9%AA%8C%E6%94%B6%E6%8A%A5%E5%91%8A.pdf" },
  })
  const chinese = await requestAuthorizedFile('/attachments/1', new Set(['application/pdf']), 'download.bin')
  assert.equal(chinese.filename, '验收报告.pdf')
  assert.equal(chinese.contentType, 'application/pdf')

  globalThis.fetch = async () => new Response(new Blob(['%PDF-1.7'], { type: 'application/pdf' }), {
    status: 200,
    headers: { 'content-type': 'application/pdf', 'content-disposition': "attachment; filename*=UTF-8''%E4%B8%AD%ZZ" },
  })
  const invalid = await requestAuthorizedFile('/attachments/1', new Set(['application/pdf']), 'download.bin')
  assert.equal(invalid.filename, 'download.bin')
})

test('CRM 下载请求带超时 signal，并保留调用方取消语义', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })
  const calls = []
  const controller = new AbortController()
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options })
    return new Response('a,b\n1,2', { status: 200, headers: { 'content-type': 'text/csv', 'content-disposition': 'attachment; filename="errors.csv"' } })
  }

  await requestBlob('/customers/imports/JOB-1/errors', { signal: controller.signal })
  assert.ok(calls[0].options.signal, '下载请求必须携带 signal')
  assert.equal(calls[0].options.signal.aborted, false)
  controller.abort()
  // 调用方 signal 不因超时合并而被丢弃：取消后合并 signal 同步中止。
  assert.equal(calls[0].options.signal.aborted, true)
})

test('CRM 下载超时转换为可读错误，不伪装成功', async (t) => {
  const originalFetch = globalThis.fetch
  const originalTimeout = globalThis.AbortSignal.timeout
  t.after(() => { globalThis.fetch = originalFetch; globalThis.AbortSignal.timeout = originalTimeout })
  globalThis.AbortSignal.timeout = () => originalTimeout(5)
  globalThis.fetch = (_url, options) => new Promise((resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true })
  })

  await assert.rejects(requestAuthorizedFile('/attachments/1', new Set(['application/pdf'])), (error) => {
    assert.equal(error.code, 'CRM_DOWNLOAD_TIMEOUT')
    assert.equal(error.message, '下载超时，请重试。')
    return true
  })
})
