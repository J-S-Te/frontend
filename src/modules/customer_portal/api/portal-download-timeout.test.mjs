import assert from 'node:assert/strict'
import test from 'node:test'

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify({ code: 'OK', data }), { status, headers: { 'content-type': 'application/json' } })
}

function pdfResponse() {
  return new Response(new Blob(['%PDF-1.7'], { type: 'application/pdf' }), {
    status: 200,
    headers: { 'content-type': 'application/pdf', 'content-disposition': 'attachment; filename="report.pdf"' },
  })
}

function downloadCalls(requests) {
  return requests.filter(({ url }) => /\/downloads$|\/exports$/.test(url))
}

test('门户报告、项目导出与备案导出下载统一携带超时 signal', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })
  const requests = []
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url, options })
    if (url.endsWith('/download-grants')) return jsonResponse({ download_token: 'secret-token' }, 201)
    if (url.endsWith('/downloads') || url.endsWith('/exports')) return pdfResponse()
    throw new Error(`unexpected URL: ${url}`)
  }

  const api = await import(`./portal.js?download-signal=${Date.now()}`)
  await api.downloadIssuedReport(1)
  await api.downloadProjectExport('export-1')
  await api.exportFilingPDF('filing-1', 1)

  const downloads = downloadCalls(requests)
  assert.equal(downloads.length, 3)
  for (const { url, options } of downloads) {
    assert.ok(options.signal, `${url} 必须携带下载超时 signal`)
    assert.equal(options.signal.aborted, false)
  }
})

test('门户下载超时转换为可读错误，不当作成功或普通网络失败', async (t) => {
  const originalFetch = globalThis.fetch
  const originalTimeout = globalThis.AbortSignal.timeout
  t.after(() => { globalThis.fetch = originalFetch; globalThis.AbortSignal.timeout = originalTimeout })
  globalThis.AbortSignal.timeout = () => originalTimeout(5)
  globalThis.fetch = (url, options = {}) => {
    if (url.endsWith('/download-grants')) return Promise.resolve(jsonResponse({ download_token: 'secret-token' }, 201))
    return new Promise((resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true })
    })
  }

  const api = await import(`./portal.js?download-timeout=${Date.now()}`)
  await assert.rejects(api.downloadIssuedReport(1), (error) => {
    assert.equal(error.code, 'PORTAL_REPORT_DOWNLOAD_TIMEOUT')
    assert.equal(error.message, '下载超时，请重试。')
    return true
  })
})

test('门户下载保留调用方取消语义，不误报为下载超时', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })
  let downloadOptions
  globalThis.fetch = async (url, options = {}) => {
    if (url.endsWith('/download-grants')) return jsonResponse({ download_token: 'secret-token' }, 201)
    downloadOptions = options
    return new Promise((resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true })
    })
  }

  const controller = new AbortController()
  const api = await import(`./portal.js?download-cancel=${Date.now()}`)
  const pending = api.exportFilingPDF('filing-1', 1, { signal: controller.signal })
  for (let attempt = 0; attempt < 50 && !downloadOptions; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 2))
  }
  assert.ok(downloadOptions?.signal, '调用方取消信号必须与下载请求关联')
  controller.abort()
  await assert.rejects(pending, (error) => error?.name === 'AbortError')
})
