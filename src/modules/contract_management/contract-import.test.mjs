import test from 'node:test'
import assert from 'node:assert/strict'
import { prepareImportManifest, formatImportMinor } from './utils/contractImport.js'
import { sourceSHA256 } from './utils/sourceIntegrity.js'
import { createHash } from 'node:crypto'

test('清单与原件显式一一匹配，保留元数据不猜测业务字段', () => {
  const file = { name: '原件.pdf' }
  const input = { schema_version: 1, source_system: 'legacy', items: [{ item_key: 'one', external_record_id: 'old-1', mode: 'NORMAL', source_file_ref: file.name, metadata: { amount_minor: 321 } }] }
  const result = prepareImportManifest(JSON.stringify(input), [file])
  assert.equal(result.filesByName.get(file.name), file)
  assert.equal(result.manifest.items[0].metadata.amount_minor, 321)
  assert.throws(() => prepareImportManifest(JSON.stringify(input), []), /未匹配/)
  assert.throws(() => prepareImportManifest(JSON.stringify(input), [file, file]), /重名/)
  input.items.push({ ...input.items[0] })
  assert.throws(() => prepareImportManifest(JSON.stringify(input), [file]), /重复/)
})

test('历史模式和清单容量失败关闭，不静默降为普通业务', () => {
  const input = { schema_version: 1, source_system: 'legacy', items: [{ item_key: 'one', external_record_id: 'old-1', mode: 'ARCHIVE_ONLY', source_file_ref: 'old.pdf', metadata: {} }] }
  assert.throws(() => prepareImportManifest(JSON.stringify(input), [{ name: 'old.pdf' }]), /历史模式/)
  assert.throws(() => prepareImportManifest(' '.repeat(2 * 1024 * 1024 + 1), []), /2MiB/)
})

test('丢失上传响应或重载后可复用本批次READY原件，未匹配仍阻断', () => {
  const input = { schema_version: 1, source_system: 'legacy', items: [{ item_key: 'one', external_record_id: 'old-1', mode: 'NORMAL', source_file_ref: '原件.pdf', metadata: {} }] }
  const result = prepareImportManifest(JSON.stringify(input), [], [{ item_key: 'one', filename: '原件.pdf', file_ref: 'stable-ref', state: 'READY' }])
  assert.equal(result.stagedByKey.get('one'), 'stable-ref')
  assert.throws(() => prepareImportManifest(JSON.stringify(input), [], [{ item_key: 'other', filename: '原件.pdf', file_ref: 'other-ref', state: 'READY' }]), /未匹配/)
})

test('同名不同SHA代次重载后严格保留当前opaque引用，禁止猜旧版本', () => {
  const sources = [{ item_key: 'one', filename: 'same.pdf', file_ref: 'older', sha256: 'a', state: 'READY' }, { item_key: 'one', filename: 'same.pdf', file_ref: 'current', sha256: 'b', state: 'READY' }]
  const input = { schema_version: 1, source_system: 'qa', items: [{ item_key: 'one', external_record_id: 'old-1', mode: 'NORMAL', source_file_ref: 'current', metadata: {} }] }
  assert.equal(prepareImportManifest(JSON.stringify(input), [], sources).stagedByKey.get('one'), 'current')
  input.items[0].source_file_ref = 'same.pdf'
  assert.throws(() => prepareImportManifest(JSON.stringify(input), [], sources), /多个代次/)
})

test('HTTP无subtle仍以既有forge校验原字节，不跳过SHA256', async () => {
  const bytes = Uint8Array.from({ length: 20000 }, (_, index) => index % 256)
  assert.equal(await sourceSHA256(new Blob([bytes]), {}), createHash('sha256').update(bytes).digest('hex'))
})

test('总额和身份数值不经过JSON浮点静默舍入', () => {
  for (const amount of ['9007199254740993', '9007199254740990.4', '1e3']) {
    assert.throws(() => prepareImportManifest(`{"schema_version":1,"source_system":"qa","items":[{"amount_minor":${amount}}]}`, []), /静默舍入/)
  }
  assert.equal(formatImportMinor(101), '1.01')
  assert.equal(formatImportMinor(9007199254740991), '90071992547409.91')
  assert.match(formatImportMinor(9007199254740992), /核对/)
})
