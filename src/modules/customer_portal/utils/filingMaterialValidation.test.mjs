import assert from 'node:assert/strict'
import test from 'node:test'

import {
  FILING_MATERIAL_EXTENSIONS,
  FILING_MATERIAL_MAX_BYTES,
  validateFilingMaterialFile,
} from './filingMaterialValidation.js'

const MiB = 1024 * 1024
const file = (name, type, size) => ({ name, type, size })

test('与界面文案一致：材料上限 20 MiB，允许 PDF/PNG/JPG', () => {
  assert.equal(FILING_MATERIAL_MAX_BYTES, 20 * MiB)
  assert.deepEqual([...FILING_MATERIAL_EXTENSIONS], ['pdf', 'png', 'jpg', 'jpeg'])
})

test('大小边界：等于 20 MiB 通过，超出 1 字节拒绝且提示上限', () => {
  assert.equal(validateFilingMaterialFile(file('topology.pdf', 'application/pdf', 20 * MiB)).ok, true)
  const oversized = validateFilingMaterialFile(file('topology.pdf', 'application/pdf', 20 * MiB + 1))
  assert.equal(oversized.ok, false)
  assert.equal(oversized.code, 'FILE_TOO_LARGE')
  assert.match(oversized.message, /材料文件不能超过 20 MiB/)
})

test('空 file.type 按扩展名推断：pdf/png/jpg 通过', () => {
  for (const name of ['topology.pdf', 'topology.PNG', 'photo.jpg', 'photo.JPEG']) {
    assert.equal(validateFilingMaterialFile(file(name, '', 2048)).ok, true, name)
  }
  assert.equal(validateFilingMaterialFile(file('topology.pdf', 'application/octet-stream', 2048)).ok, true)
})

test('非法类型：非 PDF/PNG/JPG 拒绝并列出允许类型', () => {
  for (const [name, type] of [['topology.docx', ''], ['topology.txt', 'text/plain'], ['payload.exe', ''], ['scan.pdf', 'text/html']]) {
    const verdict = validateFilingMaterialFile(file(name, type, 2048))
    assert.equal(verdict.ok, false, `${name}/${type}`)
    assert.equal(verdict.code, 'FILE_TYPE_NOT_ALLOWED')
    assert.match(verdict.message, /材料文件类型不受支持，仅允许 PDF、PNG、JPG。/)
  }
})

test('合法通过：大小与类型都合规时不阻断上传', () => {
  const verdict = validateFilingMaterialFile(file('topology.pdf', 'application/pdf', 3 * MiB))
  assert.equal(verdict.ok, true)
  assert.equal(verdict.mimeType, 'application/pdf')
  assert.equal(verdict.extension, 'pdf')
})
