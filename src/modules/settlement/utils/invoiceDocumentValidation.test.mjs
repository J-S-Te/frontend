import assert from 'node:assert/strict'
import test from 'node:test'

import {
  INVOICE_DOCUMENT_EXTENSIONS,
  INVOICE_DOCUMENT_MAX_BYTES,
  validateInvoiceDocumentFile,
} from './invoiceDocumentValidation.js'

const MiB = 1024 * 1024
const file = (name, type, size) => ({ name, type, size })

test('与文件选择框 accept 及后端归档上限一致：10 MiB、pdf/ofd/xml/png/jpg/jpeg', () => {
  assert.equal(INVOICE_DOCUMENT_MAX_BYTES, 10 * MiB)
  assert.deepEqual([...INVOICE_DOCUMENT_EXTENSIONS], ['pdf', 'ofd', 'xml', 'png', 'jpg', 'jpeg'])
})

test('大小边界：等于 10 MiB 通过，超出 1 字节拒绝且提示上限', () => {
  assert.equal(validateInvoiceDocumentFile(file('invoice.pdf', 'application/pdf', 10 * MiB)).ok, true)
  const oversized = validateInvoiceDocumentFile(file('invoice.pdf', 'application/pdf', 10 * MiB + 1))
  assert.equal(oversized.ok, false)
  assert.equal(oversized.code, 'FILE_TOO_LARGE')
  assert.match(oversized.message, /电子发票不能超过 10 MiB/)
})

test('空 file.type 按扩展名推断：pdf/ofd/xml/png/jpg/jpeg 全部通过', () => {
  for (const name of ['invoice.pdf', 'invoice.ofd', 'invoice.xml', 'invoice.png', 'invoice.jpg', 'invoice.jpeg']) {
    assert.equal(validateInvoiceDocumentFile(file(name, '', 1024)).ok, true, name)
  }
  // OFD/XML 在不同环境可能声明为等价 MIME，归一化后同样通过。
  assert.equal(validateInvoiceDocumentFile(file('invoice.ofd', 'application/x-ofd', 1024)).ok, true)
  assert.equal(validateInvoiceDocumentFile(file('invoice.xml', 'text/xml', 1024)).ok, true)
  assert.equal(validateInvoiceDocumentFile(file('invoice.jpg', 'image/jpg', 1024)).ok, true)
})

test('非法类型：非白名单扩展名或 MIME 不符时拒绝并列出允许类型', () => {
  for (const [name, type] of [['invoice.docx', ''], ['invoice.exe', ''], ['invoice.pdf', 'text/html']]) {
    const verdict = validateInvoiceDocumentFile(file(name, type, 1024))
    assert.equal(verdict.ok, false, `${name}/${type}`)
    assert.equal(verdict.code, 'FILE_TYPE_NOT_ALLOWED')
    assert.match(verdict.message, /电子发票类型不受支持，仅允许 PDF、OFD、XML、PNG、JPG。/)
  }
})

test('合法通过：合规文件不阻断上传', () => {
  const verdict = validateInvoiceDocumentFile(file('invoice.ofd', 'application/ofd', 2 * MiB))
  assert.equal(verdict.ok, true)
  assert.equal(verdict.mimeType, 'application/ofd')
  assert.equal(verdict.extension, 'ofd')
})
