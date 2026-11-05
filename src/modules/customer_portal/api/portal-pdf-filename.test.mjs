import assert from 'node:assert/strict'
import test from 'node:test'

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify({ code: 'OK', data }), { status, headers: { 'content-type': 'application/json' } })
}

function pdfResponse(disposition) {
  return new Response(new Blob(['%PDF-1.7'], { type: 'application/pdf' }), {
    status: 200,
    headers: { 'content-type': 'application/pdf', 'content-disposition': disposition },
  })
}

test('门户报告、项目导出与备案导出共用安全 PDF 文件名规则', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })
  let disposition = ''
  globalThis.fetch = async (url) => {
    if (url.endsWith('/download-grants')) return jsonResponse({ download_token: 'secret-token' }, 201)
    if (url.endsWith('/downloads') || url.endsWith('/exports')) return pdfResponse(disposition)
    throw new Error(`unexpected URL: ${url}`)
  }
  const api = await import(`./portal.js?portal-pdf-filename=${Date.now()}`)

  const cases = [
    ["attachment; filename=\"plain.pdf\"; filename*=UTF-8''%E9%AA%8C%E6%94%B6%E6%8A%A5%E5%91%8A.pdf", '验收报告.pdf'],
    ["attachment; filename*=UTF-8''%E4%B8%AD%ZZ", 'report.pdf'],
    ['attachment; filename="report.txt"', 'report.pdf'],
    ['attachment; filename="../../\u0007secret.pdf"', 'report.pdf'],
  ]
  for (const [header, expected] of cases) {
    disposition = header
    const report = await api.downloadIssuedReport(1)
    const project = await api.downloadProjectExport('export-1')
    const filing = await api.exportFilingPDF('filing-1', 1)
    assert.equal(report.filename, expected)
    assert.equal(project.fileName, expected)
    assert.equal(filing.filename, expected)
    for (const value of [report.filename, project.fileName, filing.filename]) {
      assert.match(value, /\.pdf$/)
      assert.doesNotMatch(value, /[\\/\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e]/)
    }
  }
})

test('门户中文 PDF 文件名中的控制字符和零宽字符会被清理', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })
  globalThis.fetch = async (url) => {
    if (url.endsWith('/download-grants')) return jsonResponse({ download_token: 'secret-token' }, 201)
    if (url.endsWith('/downloads')) return pdfResponse("attachment; filename*=UTF-8''%E9%AA%8C%07%E6%94%B6%E2%80%8B%E6%8A%A5%E5%91%8A.pdf")
    throw new Error(`unexpected URL: ${url}`)
  }
  const api = await import(`./portal.js?portal-pdf-sanitize=${Date.now()}`)
  const result = await api.downloadIssuedReport(1)
  assert.equal(result.filename, '验收报告.pdf')
})
