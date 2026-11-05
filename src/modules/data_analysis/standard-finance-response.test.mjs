import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

const source = await readFile(new URL('./api/dataAnalysis.js', import.meta.url), 'utf8')
const publication = { source_code: 'standard-finance', digest: 'a'.repeat(64), published: true,
  version: 1, batch_id: 'batch-1', published_at: '2026-11-04T00:00:00Z', replayed: false }
const preview = { schema_version: 1, batch_id: 'batch-1', digest: publication.digest,
  row_count: 0, expected_version: 0, snapshot: { available: true, metrics: { currencies: [] } } }

// 用途：运行真实标准财务API客户端，隔离网络与登录跳转。
// 参数：data为HTTP200响应中的数据对象。
// 返回值：标准财务读取、预览与发布方法。
function harness(data) {
  const context = vm.createContext({
    fetch: async () => new Response(JSON.stringify({ code: 'OK', data }), {
      headers: { 'content-type': 'application/json' },
    }),
    createApiRequestContext: () => ({}), attachStructuredContext: () => {},
    shouldStartSubsystemLogin: () => false, formatDataAnalysisError: () => '',
  })
  const script = source.replace(/^import .*$/gm, '').replace(/import\.meta\.env/g, '({})')
    .replace(/^export /gm, '')
  return vm.runInContext(`${script}\n;({ getStandardFinanceStatus, previewStandardFinance,
    publishStandardFinance })`, context)
}

test('发布只接受可核对的完整批次回执，不把非空JSON当成功', async () => {
  for (const invalid of [{ version: 1 }, { ...publication, digest: '' },
    { ...publication, published: false }, { ...publication, version: -1 },
    { ...publication, source_code: 'another-source' }]) {
    await assert.rejects(harness(invalid).publishStandardFinance({}),
      (error) => error.status === 200 && error.code === 'INVALID_RESPONSE')
  }
  assert.equal((await harness(publication).publishStandardFinance({})).batch_id, 'batch-1')
})

test('来源状态与预览缺版本、指纹或分币种指标时拒绝继续', async () => {
  await assert.rejects(harness({ selected_source: 'standard', publication: {} }).getStandardFinanceStatus(),
    (error) => error.code === 'INVALID_RESPONSE')
  await assert.rejects(harness({ ...preview, expected_version: null }).previewStandardFinance({}),
    (error) => error.code === 'INVALID_RESPONSE')
  await assert.rejects(harness({ ...preview, snapshot: { metrics: {} } }).previewStandardFinance({}),
    (error) => error.code === 'INVALID_RESPONSE')
  assert.equal((await harness(preview).previewStandardFinance({})).row_count, 0)
  const empty = { ...publication, published: false, version: 0, batch_id: '', digest: '', published_at: null }
  assert.equal((await harness({ selected_source: 'standard', publication: empty })
    .getStandardFinanceStatus()).publication.published, false)
})


test('有事实记录的预览不得以缺失币种汇总冒充零值，合法零金额记录仍可预览', async () => {
  await assert.rejects(harness({ ...preview, row_count: 1 }).previewStandardFinance({}),
    (error) => error.status === 200 && error.code === 'INVALID_RESPONSE')
  const zero = { currency: 'CNY', original_minor: 0, allocated_minor: 0,
    open_minor: 0, over_90_minor: 0, month_receipts_minor: 0, collection_rate: null }
  const result = await harness({ ...preview, row_count: 1,
    snapshot: { available: true, metrics: { currencies: [zero] } } }).previewStandardFinance({})
  assert.equal(result.row_count, 1)
  assert.equal(result.snapshot.metrics.currencies[0].original_minor, 0)
})
