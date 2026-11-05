import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import * as Vue from 'vue'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'

let source = ''
try { source = await readFile(new URL('./components/StandardFinanceImportPanel.vue', import.meta.url), 'utf8') } catch {}

// 用途：执行真实标准事实导入组件脚本，替换隔离网络边界。
// 参数：sourceMode 为服务端选中来源，failure 为可选发布异常。
// 返回值：真实组件状态与观察到的提交参数。
function harness(sourceMode = 'standard', failure = null) {
  assert.ok(source, '标准事实导入组件尚未实现')
  const calls = { preview: [], publish: [] }
  const context = {
    ...Vue, onMounted: () => {}, defineProps: () => ({ permissions: ['aggregation.manage'] }),
    getStandardFinanceStatus: async () => ({ selected_source: sourceMode, publication: { version: 0, published: false } }),
    previewStandardFinance: async (doc) => { calls.preview.push(doc); return { digest: 'digest', expected_version: 0, row_count: 1, snapshot: { metrics: { currencies: [{ currency: 'CNY', original_minor: 10000, allocated_minor: 0, open_minor: 10000, over_90_minor: 0, month_receipts_minor: 0 }] } } } },
    publishStandardFinance: async (request) => { calls.publish.push(request); if (failure) throw failure; return { version: 1, batch_id: 'batch-1', published: true } },
    getStandardFinanceTemplate: async () => ({}), formatDataAnalysisError: (error) => error.message,
  }
  const script = source.match(/<script setup>([\s\S]*?)<\/script>/)[1].replace(/^import .*$/gm, '')
  const ui = vm.runInNewContext(`${script}\n;({ loadState, onFile, prepare, publish, preview, confirmed, error, notice, canImport, publication })`, context)
  return { ui, calls }
}

test('标准事实组件可编译，文件预览后必须明确确认才发布', async () => {
  const h = harness()
  const { descriptor } = parse(source)
  const script = compileScript(descriptor, { id: 'standard-finance' })
  assert.deepEqual(compileTemplate({ source: descriptor.template.content, filename: 'StandardFinanceImportPanel.vue', id: 'standard-finance', compilerOptions: { bindingMetadata: script.bindings } }).errors, [])
  await h.ui.loadState()
  const doc = { schema_version: 1, batch_id: 'batch-1', as_of_date: '2026-11-04', complete: true, receivables: [], receipts: [] }
  await h.ui.onFile({ target: { files: [{ name: 'facts.json', size: 100, text: async () => JSON.stringify(doc) }] } })
  await h.ui.prepare()
  assert.equal(h.calls.preview.length, 1)
  await h.ui.publish()
  assert.equal(h.calls.publish.length, 0, '未确认不得发布')
  h.ui.confirmed.value = true
  await h.ui.publish()
  assert.equal(h.calls.publish.length, 1)
  assert.equal(h.calls.publish[0].digest, 'digest')
  assert.equal(h.calls.publish[0].expected_version, 0)
  assert.equal(h.calls.publish[0].document.batch_id, 'batch-1')
  assert.equal(h.ui.preview.value, null)
})

test('联动模式阻止导入；文件超限或换文件时清除旧预览', async () => {
  const off = harness('integration'); await off.ui.loadState(); assert.equal(off.ui.canImport.value, false)
  const h = harness(); await h.ui.loadState()
  h.ui.preview.value = { digest: 'old' }; h.ui.confirmed.value = true
  await h.ui.onFile({ target: { files: [{ name: 'big.json', size: 1048577, text: async () => '{}' }] } })
  assert.equal(h.ui.preview.value, null)
  assert.equal(h.ui.confirmed.value, false)
  assert.match(h.ui.error.value, /1 MiB/)
  await h.ui.prepare(); assert.equal(h.calls.preview.length, 0)
})

test('成功状态但回执损坏或请求超时均锁定发布，核对来源前不能重复写入', async () => {
  for (const status of [200, 408, 503]) {
    const failure = Object.assign(new Error('尚无法确认结果'), { status, code: 'INVALID_RESPONSE' })
    const h = harness('standard', failure)
    await h.ui.loadState()
    await h.ui.onFile({ target: { files: [{ name: 'facts.json', size: 100,
      text: async () => JSON.stringify({ batch_id: 'batch-1' }) }] } })
    await h.ui.prepare()
    h.ui.confirmed.value = true
    await h.ui.publish()
    assert.equal(h.ui.canImport.value, false, `HTTP ${status}仍然允许重复发布`)
    h.ui.confirmed.value = true
    await h.ui.publish()
    assert.equal(h.calls.publish.length, 1)
    await h.ui.loadState()
    assert.equal(h.ui.canImport.value, true)
  }
})
