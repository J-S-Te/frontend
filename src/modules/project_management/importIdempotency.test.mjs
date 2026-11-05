import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { importIdempotencyKey } from './importIdempotency.js'

const api = await readFile(new URL('./api/projectManagement.js', import.meta.url), 'utf8')
const qualification = await readFile(new URL('./components/QualificationImportDialog.vue', import.meta.url), 'utf8')
const detection = await readFile(new URL('./components/DetectionCategoryImportDialog.vue', import.meta.url), 'utf8')

const workbook = { name: '人员资质.csv', size: 100, lastModified: 1_700_000_000_000 }

test('幂等键对同一文件同一选择稳定，换文件或改选行即变化', () => {
  const base = importIdempotencyKey({ scope: 'capability', file: workbook, selectedRows: [2, 3] })
  // 选中行顺序与重复不影响结果：同一组行必须复用同一个键。
  assert.equal(base, importIdempotencyKey({ scope: 'capability', file: { ...workbook }, selectedRows: [3, 2, 2] }))
  // 键必须落在服务端允许的字符集与长度内。
  assert.match(base, /^[A-Za-z0-9._:-]{1,128}$/)
  assert.match(base, /^pm-import-capability-[0-9a-f]{16}$/)
  for (const other of [
    importIdempotencyKey({ scope: 'capability', file: workbook, selectedRows: [2] }),
    importIdempotencyKey({ scope: 'capability', file: { ...workbook, name: '其他.csv' }, selectedRows: [2, 3] }),
    importIdempotencyKey({ scope: 'capability', file: { ...workbook, size: 101 }, selectedRows: [2, 3] }),
    importIdempotencyKey({ scope: 'capability', file: { ...workbook, lastModified: 1 }, selectedRows: [2, 3] }),
    importIdempotencyKey({ scope: 'equipment', file: workbook, selectedRows: [2, 3] }),
    importIdempotencyKey({ scope: 'detection-category', file: workbook, selectedRows: [2, 3] }),
  ]) {
    assert.notEqual(base, other)
    assert.match(other, /^[A-Za-z0-9._:-]{1,128}$/)
  }
  assert.match(importIdempotencyKey(), /^pm-import-import-[0-9a-f]{16}$/)
})

test('确认弹窗用当前文件与选中行生成键，三个导入 API 都发送 Idempotency-Key', () => {
  assert.match(qualification, /importIdempotencyKey\(\{ scope: isEquipment\.value \? 'equipment' : 'capability', file: file\.value, selectedRows: rows \}\)/)
  assert.match(qualification, /importEquipment\(file\.value, rows, key\)/)
  assert.match(qualification, /importCapabilities\(file\.value, 'PERSON', rows, key\)/)
  assert.match(detection, /importIdempotencyKey\(\{ scope: 'detection-category', file: file\.value, selectedRows: rows \}\)/)
  assert.match(detection, /importDetectionCategories\(file\.value, rows, key\)/)
  const calls = [...api.matchAll(/headers: importIdempotencyHeaders\(idempotencyKey\)/g)]
  assert.equal(calls.length, 3)
  assert.match(api, /'Idempotency-Key': key/)
  // 没有键时不发送空头：让服务端按 400 失败关闭，而不是冒充一个有效键。
  assert.match(api, /return key \? \{ 'Idempotency-Key': key \} : \{\}/)
  assert.doesNotMatch(api, /'Idempotency-Key': ''/)
  // 预览端点保持不变：预检不消耗幂等键。
  assert.match(api, /request\('\/capabilities\/import\/preview', \{ method: 'POST', body: formData \}\)/)
  assert.match(api, /request\('\/equipment\/import\/preview', \{ method: 'POST', body: formData \}\)/)
  assert.match(api, /request\('\/detection-categories\/import\/preview', \{ method: 'POST', body: formData \}\)/)
})
