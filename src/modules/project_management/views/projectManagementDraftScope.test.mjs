import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const view = await readFile(new URL('./ProjectManagementView.vue', import.meta.url), 'utf8')

// 切换服务项必须隔离条目级草稿：报告/偏离材料、现场证据与签名、原始数据与判断项，
// 并重建签名画布；否则在 A 选择材料后切到 B 提交，会把 A 的文件挂到 B 上。
test('切换服务项会清空条目级草稿并重建签名画布', () => {
  const start = view.indexOf('function fillOperationForm(item) {')
  assert.ok(start > 0, '缺少 fillOperationForm')
  const end = view.indexOf('function updatePenetrationPackage', start)
  assert.ok(end > start, 'fillOperationForm 边界无法定位')
  const body = view.slice(start, end)

  for (const field of [
    'reportFile: null',
    'fieldEvidenceFile: null',
    'fieldSignatureFile: null',
    'deviationEvidenceFile: null',
    'deviationID:',
    'rawData:',
    'environment:',
  ]) {
    assert.ok(body.includes(field), `fillOperationForm 未重置 ${field}`)
  }
  assert.ok(body.includes('signaturePadKey.value += 1'), '切换服务项时必须递增签名画布重建键')
  assert.match(view, /<SignaturePad\s+:key="signaturePadKey"/, '签名组件必须绑定重建键')
})
