import assert from 'node:assert/strict'
import test from 'node:test'

import {
  EXTENSION_MIME_TYPES,
  extensionsForMimeTypes,
  fileExtension,
  formatUploadBytes,
  mimeTypeForExtension,
  normalizeMimeType,
  uploadTypeLabels,
  validateUploadFile,
} from './uploadValidation.js'

const MiB = 1024 * 1024
const file = (name, type, size) => ({ name, type, size })

test('扩展名与 MIME 归一化：别名收敛、通用值视为未提供', () => {
  assert.equal(normalizeMimeType(' Application/PDF '), 'application/pdf')
  assert.equal(normalizeMimeType('application/pdf; charset=binary'), 'application/pdf')
  assert.equal(normalizeMimeType('image/jpg'), 'image/jpeg')
  assert.equal(normalizeMimeType('text/xml'), 'application/xml')
  assert.equal(normalizeMimeType(''), '')
  assert.equal(normalizeMimeType('application/octet-stream'), '')
  assert.equal(normalizeMimeType(undefined), '')

  assert.equal(fileExtension('Proof.PDF'), 'pdf')
  assert.equal(fileExtension('a.b.jpeg'), 'jpeg')
  assert.equal(fileExtension('no-extension'), '')
  assert.equal(fileExtension(''), '')
  assert.equal(mimeTypeForExtension('.PDF'), 'application/pdf')
  assert.equal(mimeTypeForExtension('exe'), '')
  assert.deepEqual(extensionsForMimeTypes(['application/pdf', 'image/jpeg', 'application/pdf']), ['pdf', 'jpg', 'jpeg'])
  assert.deepEqual(extensionsForMimeTypes(['application/x-unknown']), [])
})

test('大小边界：恰好等于上限通过，超过 1 字节即拒绝并说明上限与当前大小', () => {
  const options = { label: '附件', maxSizeBytes: 20 * MiB }
  assert.equal(validateUploadFile(file('a.pdf', 'application/pdf', 20 * MiB), options).ok, true)
  assert.equal(validateUploadFile(file('a.pdf', 'application/pdf', 0), options).ok, true)
  const rejected = validateUploadFile(file('a.pdf', 'application/pdf', 20 * MiB + 1), options)
  assert.equal(rejected.ok, false)
  assert.equal(rejected.code, 'FILE_TOO_LARGE')
  assert.match(rejected.message, /附件不能超过 20 MiB/)
  assert.match(rejected.message, new RegExp(`${20 * MiB + 1} 字节`))
})

test('不限大小：上限缺失、0 或非正数时不拦截大小', () => {
  for (const maxSizeBytes of [0, undefined, -1, Number.NaN]) {
    const verdict = validateUploadFile(file('a.pdf', 'application/pdf', 5 * 1024 * MiB), { maxSizeBytes })
    assert.equal(verdict.ok, true, String(maxSizeBytes))
  }
})

test('空 file.type 按扩展名推断；未知扩展名不接受', () => {
  const options = { label: '材料文件', allowedExtensions: ['pdf', 'png', 'jpg', 'jpeg'] }
  assert.equal(validateUploadFile(file('scan.PDF', '', 10), options).ok, true)
  assert.equal(validateUploadFile(file('scan.jpg', undefined, 10), options).ok, true)
  // 浏览器常把无法识别类型的文件声明为通用二进制：同样按扩展名推断。
  assert.equal(validateUploadFile(file('scan.png', 'application/octet-stream', 10), options).ok, true)
  const unknownExtension = validateUploadFile(file('payload.exe', '', 10), options)
  assert.equal(unknownExtension.ok, false)
  assert.equal(unknownExtension.code, 'FILE_TYPE_NOT_ALLOWED')
})

test('非法类型：扩展名或声明的 MIME 不在白名单时拒绝并列出允许类型', () => {
  const byExtension = validateUploadFile(file('report.txt', 'text/plain', 10), { label: '电子发票', allowedExtensions: ['pdf', 'ofd', 'xml', 'png', 'jpg', 'jpeg'] })
  assert.equal(byExtension.ok, false)
  assert.equal(byExtension.code, 'FILE_TYPE_NOT_ALLOWED')
  assert.match(byExtension.message, /电子发票类型不受支持，仅允许 PDF、OFD、XML、PNG、JPG。/)

  const byMime = validateUploadFile(file('report.pdf', 'text/html', 10), { allowedMimeTypes: ['application/pdf'] })
  assert.equal(byMime.ok, false)
  assert.equal(byMime.code, 'FILE_TYPE_NOT_ALLOWED')
})

test('合法通过：只给 MIME 白名单时按声明或扩展名归一化判断', () => {
  const allowedMimeTypes = ['application/pdf', 'image/png', 'image/jpeg', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']
  for (const candidate of [
    file('a.pdf', 'application/pdf', 10),
    file('a.pdf', '', 10),
    file('a.docx', 'application/octet-stream', 10),
    file('a.jpeg', 'image/jpg', 10),
  ]) {
    const verdict = validateUploadFile(candidate, { allowedMimeTypes })
    assert.equal(verdict.ok, true, `${candidate.name}/${candidate.type}`)
  }
  assert.equal(validateUploadFile(file('a.pdf', 'application/pdf', 10), { allowedMimeTypes }).mimeType, 'application/pdf')
  assert.equal(validateUploadFile(file('a.pdf', 'application/pdf', 10), { allowedMimeTypes }).extension, 'pdf')
  // 没有扩展名又没有类型声明时无法归一化，必须拒绝。
  assert.equal(validateUploadFile(file('README', '', 10), { allowedMimeTypes }).ok, false)
})

test('白名单为空表示不限制类型；两种限制可同时生效', () => {
  assert.equal(validateUploadFile(file('any.bin', '', 10), {}).ok, true)
  assert.equal(validateUploadFile(file('any.bin', 'application/x-msdownload', 10), { allowedMimeTypes: [] }).ok, true)
  const both = { maxSizeBytes: 10, allowedExtensions: ['pdf'], allowedMimeTypes: ['application/pdf'] }
  assert.equal(validateUploadFile(file('a.pdf', 'application/pdf', 10), both).ok, true)
  assert.equal(validateUploadFile(file('a.pdf', 'application/pdf', 11), both).ok, false)
})

test('类型标签与大小文案可直接展示', () => {
  assert.deepEqual(uploadTypeLabels({ allowedExtensions: ['pdf', 'ofd', 'xml', 'png', 'jpg', 'jpeg'] }), ['PDF', 'OFD', 'XML', 'PNG', 'JPG'])
  assert.deepEqual(uploadTypeLabels({ allowedMimeTypes: ['application/pdf', 'image/jpeg'] }), ['PDF', 'JPG'])
  assert.deepEqual(uploadTypeLabels({ allowedMimeTypes: ['application/x-custom'] }), ['application/x-custom'])
  assert.deepEqual(uploadTypeLabels(), [])
  assert.equal(formatUploadBytes(20 * MiB), '20 MiB')
  assert.equal(formatUploadBytes(10 * MiB), '10 MiB')
  assert.equal(formatUploadBytes(1536), '1.5 KiB')
  assert.equal(formatUploadBytes(900), '900 字节')
  assert.equal(formatUploadBytes(undefined), '未知大小')
  assert.equal(EXTENSION_MIME_TYPES.pdf, 'application/pdf')
})
