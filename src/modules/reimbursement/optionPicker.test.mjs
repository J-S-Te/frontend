import test from 'node:test'
import assert from 'node:assert/strict'
import {
  hasMoreOptions, mergeOptionPage, normalizeOptionPage, optionEmptyText, optionQuery, optionValue,
} from './optionPicker.js'

test('选择器只向既有选项接口发送关键词、页码与业务用途', () => {
  assert.equal(optionQuery('/organization-options', { keyword: ' 研发 ', page: 2, pageSize: 20 }),
    '/organization-options?keyword=%E7%A0%94%E5%8F%91&page=2&page_size=20')
  assert.equal(optionQuery('/invoice-document-options', { purpose: 'reimbursement.claim.evidence' }),
    '/invoice-document-options?page=1&page_size=20&purpose=reimbursement.claim.evidence')
  // 空关键词不发送空搜索条件，避免服务端把它当成字面匹配。
  assert.doesNotMatch(optionQuery('/invoice-options', { keyword: '   ' }), /keyword/)
  // 页码与页大小夹在接口声明的边界内，不请求非法分页。
  assert.equal(optionQuery('/invoice-options', { page: 0, pageSize: 200 }),
    '/invoice-options?page=1&page_size=50')
})

test('选项响应归一保留服务端总数并拒绝不完整响应', () => {
  const page = normalizeOptionPage({ items: [{ id: 'org-1', name: '研发中心' }], total: 3, page: 2, page_size: 20 })
  assert.deepEqual(page.items, [{ id: 'org-1', name: '研发中心' }])
  assert.equal(page.total, 3)
  assert.equal(page.page, 2)
  assert.throws(() => normalizeOptionPage({ data: [] }), /选项接口响应不完整/)
  // 缺 total 时不伪造分页总数，用本页条数兜底。
  assert.equal(normalizeOptionPage({ items: [{ id: 'a', name: 'A' }] }).total, 1)
})

test('加载更多按内部引用去重且保留原始顺序', () => {
  const merged = mergeOptionPage(
    [{ id: 'file-1', name: '发票.pdf' }, { id: 'file-2', name: '行程单.png' }],
    [{ id: 'file-2', name: '行程单.png' }, { id: 'file-3', name: '回单.pdf' }])
  assert.deepEqual(merged.map((row) => row.id), ['file-1', 'file-2', 'file-3'])
  assert.equal(hasMoreOptions(merged, 4), true)
  assert.equal(hasMoreOptions(merged, 3), false)
})

test('文件选项用 file_id 作为提交引用，空引用不进入待选列表', () => {
  assert.equal(optionValue({ id: 'doc-1', file_id: 'file-1', name: '发票.pdf' }, 'file_id'), 'file-1')
  assert.equal(optionValue({ id: 'doc-1', file_id: '  ' }, 'file_id'), '')
  assert.equal(optionValue(null), '')
})

test('空结果文案区分"没有匹配"和"当前没有可选对象"', () => {
  assert.equal(optionEmptyText('费用组织', ' 财务 '), '没有找到与“财务”匹配的费用组织，请换关键词再试')
  assert.equal(optionEmptyText('证据文件', ''), '当前没有可选的证据文件')
})
