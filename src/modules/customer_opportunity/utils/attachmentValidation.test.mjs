import assert from 'node:assert/strict'
import test from 'node:test'

import {
  opportunityAttachmentMaxBytes,
  opportunityAttachmentMimeTypes,
  validateOpportunityAttachment,
} from './attachmentValidation.js'

const MiB = 1024 * 1024
const file = (name, type, size) => ({ name, type, size })

// 后端 attachment-capabilities 的真实字段（见 opportunity.AttachmentCapabilities）。
const capability = {
  upload_available: true,
  download_available: true,
  scanner_available: true,
  max_size_bytes: 20 * MiB,
  allowed_mime_types: [
    'application/pdf',
    'image/png',
    'image/jpeg',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ],
}

test('能力字段读取：大小上限与服务端类型白名单原样使用，缺失时不拦截', () => {
  assert.equal(opportunityAttachmentMaxBytes(capability), 20 * MiB)
  assert.equal(opportunityAttachmentMaxBytes({}), 0)
  assert.equal(opportunityAttachmentMaxBytes({ max_size_bytes: 'abc' }), 0)
  assert.deepEqual(opportunityAttachmentMimeTypes(capability), capability.allowed_mime_types)
  assert.deepEqual(opportunityAttachmentMimeTypes({ allowed_mime_types: 'application/pdf' }), [])
  assert.deepEqual(opportunityAttachmentMimeTypes({}), [])
})

test('大小边界：等于服务端上限通过，超出 1 字节即拒绝且文案给出 20 MiB 上限', () => {
  assert.equal(validateOpportunityAttachment(file('proof.pdf', 'application/pdf', 20 * MiB), capability).ok, true)
  const oversized = validateOpportunityAttachment(file('proof.pdf', 'application/pdf', 20 * MiB + 1), capability)
  assert.equal(oversized.ok, false)
  assert.equal(oversized.code, 'FILE_TOO_LARGE')
  assert.match(oversized.message, /附件不能超过 20 MiB/)
})

test('空 file.type 按扩展名归一化：pdf/png/jpg/docx/xlsx 通过，exe 拒绝', () => {
  for (const name of ['proof.pdf', 'chart.PNG', 'photo.jpg', 'photo.jpeg', 'doc.docx', 'sheet.xlsx']) {
    assert.equal(validateOpportunityAttachment(file(name, '', 1024), capability).ok, true, name)
  }
  const rejected = validateOpportunityAttachment(file('payload.exe', '', 1024), capability)
  assert.equal(rejected.ok, false)
  assert.equal(rejected.code, 'FILE_TYPE_NOT_ALLOWED')
  assert.match(rejected.message, /附件类型不受支持，仅允许 PDF、PNG、JPG、DOCX、XLSX。/)
})

test('非法类型：声明的 MIME 不在服务端白名单时拒绝', () => {
  const verdict = validateOpportunityAttachment(file('proof.pdf', 'text/html', 1024), capability)
  assert.equal(verdict.ok, false)
  assert.equal(verdict.code, 'FILE_TYPE_NOT_ALLOWED')
})

test('合法通过：大小与类型都合规时可直接创建上传会话', () => {
  const verdict = validateOpportunityAttachment(file('proof.pdf', 'application/pdf', 4 * MiB), capability)
  assert.equal(verdict.ok, true)
  assert.equal(verdict.mimeType, 'application/pdf')
  // 服务端未声明白名单（空数组）时不做事前类型拦截，避免误伤后续新增类型。
  const undeclared = { ...capability, allowed_mime_types: [] }
  assert.equal(validateOpportunityAttachment(file('archive.zip', 'application/zip', 1024), undeclared).ok, true)
  // 上限缺失时也不拦截大小。
  assert.equal(validateOpportunityAttachment(file('proof.pdf', 'application/pdf', 30 * MiB), { ...capability, max_size_bytes: 0 }).ok, true)
})
