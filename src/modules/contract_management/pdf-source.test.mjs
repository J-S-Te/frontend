import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { validateContractSourceFile } from './utils/contractPayload.js'

// pdfClient 加载实际客户端实现并替换构建期导入。
// 参数：无；测试仅替换浏览器网络边界。
// 返回值：原件获取函数，不伪造业务成功响应。
async function pdfClient() {
  const source = (await readFile(new URL('./api/contract.js', import.meta.url), 'utf8'))
    .replace(/^import\s[\s\S]*?from ['"][^'"]+['"]\n/gm, '')
    .replaceAll('import.meta.env', '({})').replace(/^export /gm, '')
  return new Function(`${source}; return { fetchContractPDFSource };`)()
}

test('PDF选择仅在能力开放后允许且DOCX仍保留10MiB边界', () => {
  const pdf = { name: '原件.PDF', type: 'application/pdf', size: 20 * 1024 * 1024 }
  assert.throws(() => validateContractSourceFile(pdf), /未开启|尚未/)
  assert.equal(validateContractSourceFile(pdf, { pdfEnabled: true }).format, 'PDF')
  assert.throws(() => validateContractSourceFile({ ...pdf, size: pdf.size + 1 }, { pdfEnabled: true }), /20/)
  assert.throws(() => validateContractSourceFile({ ...pdf, type: 'text/plain' }, { pdfEnabled: true }), /类型|格式/)
  assert.throws(() => validateContractSourceFile({ name: '原件.docx', type: '', size: 10 * 1024 * 1024 + 1 }), /10/)
})

test('PDF原件请求限定本应用受鉴权路径并拒绝HTML伪成功', async () => {
  const client = await pdfClient()
  const originalFetch = globalThis.fetch
  let calls = 0
  globalThis.fetch = async (url, options) => {
    calls++
    assert.equal(url, '/contract_management/api/v1/contracts/contract-1/source')
    assert.equal(options.credentials, 'include')
    return new Response('%PDF-1.4\n%%EOF', { headers: { 'content-type': 'application/pdf' } })
  }
  try {
    const blob = await client.fetchContractPDFSource('/contracts/contract-1/source')
    assert.equal(await blob.text(), '%PDF-1.4\n%%EOF')
    for (const path of ['https://outside.invalid/file.pdf', '//outside.invalid/file', '/contracts/../source', '/contracts/one/source?token=x']) {
      await assert.rejects(client.fetchContractPDFSource(path), /路径|地址/)
    }
    assert.equal(calls, 1)
    globalThis.fetch = async () => new Response('<html>login</html>', { headers: { 'content-type': 'text/html' } })
    await assert.rejects(client.fetchContractPDFSource('/contracts/contract-1/source'), /格式|PDF/)
  } finally { globalThis.fetch = originalFetch }
})
