import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { File } from 'node:buffer'
import { externalContractMetadata, isContractDOCXFile, validateContractForm } from './utils/contractPayload.js'

const source = await readFile(new URL('./api/contract.js', import.meta.url), 'utf8')
const view = await readFile(new URL('./views/ContractManagementView.vue', import.meta.url), 'utf8')

function form(overrides = {}) {
  return {
    title: '合同', contract_type: '直签', amount: '123.45', currency: 'CNY', customer_id: '42',
    start_date: '2026-01-01', end_date: '2026-12-31',
    service_items: [{ service_type: '软件测试', test_mode: 'STANDARD', systems: [] }],
    ...overrides,
  }
}

test('external multipart wire metadata omits shared text content and preserves structured terms', async () => {
  // 执行真实 API 函数，仅替换其浏览器和构建相关导入。
  // 此处验证 FormData 序列化的回归，而非仅匹配源码文本。
  const utilityURL = new URL('./utils/contractPayload.js', import.meta.url).href
  const moduleSource = `import { externalContractMetadata } from ${JSON.stringify(utilityURL)};\n`
    + source.replace(/^import\s[\s\S]*?from ['"][^'"]+['"]\n/gm, '').replaceAll('import.meta.env', '({})')
  const api = await import(`data:text/javascript,${encodeURIComponent(moduleSource)}`)
  const originalFetch = globalThis.fetch
  let captured
  globalThis.fetch = async (url, options) => {
    captured = { url, options }
    return new Response(JSON.stringify({ code: 'OK', data: { id: 'created-1', version: 1, status: 'draft' } }), { status: 201, headers: { 'Content-Type': 'application/json' } })
  }
  try {
    const metadata = {
      title: '外部合同', content: '', crm_customer_id: 42, amount_minor: 12345,
      payment_terms: [{ installment_no: 1, due_date: '2026-12-31', amount: '123.45' }],
      service_items: [{ service_type: '软件测试', test_mode: 'STANDARD', systems: [] }],
      start_date: '2026-01-01T00:00:00Z', end_date: null,
    }
    const file = new File(['sample'], 'external.docx', { type: 'application/octet-stream' })
    assert.deepEqual(await api.createExternalContract(file, metadata), { id: 'created-1', version: 1, status: 'draft' })
    assert.equal(captured.url, '/contract_management/api/v1/contracts/external')
    assert.equal(captured.options.method, 'POST')
    assert.equal(captured.options.credentials, 'include')
    assert.equal(Object.hasOwn(captured.options, 'validateData'), false)
    assert.equal(captured.options.headers['Content-Type'], undefined)
    assert.deepEqual([...captured.options.body.keys()], ['file', 'metadata'])
    assert.equal(captured.options.body.get('file').name, 'external.docx')
    const wire = JSON.parse(captured.options.body.get('metadata'))
    assert.deepEqual(wire, externalContractMetadata(metadata))
    assert.equal(Object.hasOwn(wire, 'content'), false)
    assert.equal(metadata.content, '')
    assert.deepEqual(wire.payment_terms, metadata.payment_terms)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('external metadata normalization does not hide unknown fields from strict server validation', () => {
  assert.deepEqual(externalContractMetadata({ content: 'ignored text', unexpected_field: true }), { unexpected_field: true })
})

test('DOCX selection agrees with server support for generic binary MIME', () => {
  for (const type of ['', 'application/octet-stream', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']) {
    assert.equal(isContractDOCXFile({ name: 'contract.DOCX', type }), true)
  }
  for (const file of [null, { name: 'contract.pdf', type: 'application/octet-stream' }, { name: 'contract.docx', type: 'application/pdf' }]) {
    assert.equal(isContractDOCXFile(file), false)
  }
})

test('common form validation allows server-supported drafts and rejects precise invalid fields', () => {
  assert.doesNotThrow(() => validateContractForm(form()))
  assert.doesNotThrow(() => validateContractForm(form({ amount: '0', contract_type: '自定义模板合同' })))
  for (const [overrides, message] of [
    [{ title: '  ' }, /合同名称/],
    [{ start_date: '2026-02-30' }, /开始日期/],
    [{ start_date: '2027-01-01' }, /开始日期不能晚于结束日期/],
    [{ end_date: '10000-01-01' }, /结束日期/],
    [{ amount: '0.001' }, /最多两位小数/],
    [{ customer_id: '9007199254740993' }, /客户编号/],
    [{ service_items: [] }, /1 至 20/],
    [{ service_items: [{ service_type: '软件测试', test_mode: 'OTHER', systems: [] }] }, /检测方式/],
    [{ service_items: [{ service_type: '软件测试', systems: [{ name: '  ', level: '三级' }] }] }, /系统名称/],
    [{ service_items: [{ service_type: '软件测试', systems: [{ name: '系统', level: '五级' }] }] }, /系统等级/],
  ]) assert.throws(() => validateContractForm(form(overrides)), message)
})

test('external amounts, currencies and contract types follow the external API boundary', () => {
  assert.doesNotThrow(() => validateContractForm(form(), { external: true }))
  for (const [overrides, message] of [
    [{ amount: '0' }, /必须大于零/],
    [{ contract_type: '外包' }, /直签或三方/],
    [{ currency: '人民币' }, /三位字母/],
  ]) assert.throws(() => validateContractForm(form(overrides), { external: true }), message)
})

test('opportunity directory functions used by the form are imported from the API module', () => {
  const imports = view.match(/import \{([\s\S]*?)\} from '@\/modules\/contract_management\/api\/contract'/)?.[1] || ''
  assert.match(imports, /\blistMyOpportunities\b/)
})
