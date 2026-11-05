import assert from 'node:assert/strict'
import test from 'node:test'
import { customerImportErrorHeaders, customerImportErrorRows, customerImportErrorsCsv } from './customerImportErrors.js'

test('客户导入错误报告：预检警告/错误行合并问题，包含表头、中文、BOM 与 CRLF', () => {
  const preview = {
    total_rows: 4,
    rows: [
      { row_no: 2, status: 'READY', name: '正常客户' },
      { row_no: 3, status: 'WARNING', name: '警告客户', issues: [{ column: '客户名称', code: 'POSSIBLE_DUPLICATE_NAME', message: '客户名称疑似已存在' }] },
      { row_no: 4, status: 'ERROR', name: '错误客户', issues: [
        { column: '统一社会信用代码', code: 'REQUIRED', message: '必填字段为空' },
        { column: '登记联系人电话', code: 'INVALID_PHONE', message: '联系电话格式不正确' },
      ] },
      { row_no: 5, status: 'READY', name: '另一位正常客户' },
    ],
  }
  const rows = customerImportErrorRows(preview)
  assert.equal(rows.length, 2)
  assert.deepEqual(rows[0], ['3', '警告（本次跳过）', '警告客户', '客户名称 · POSSIBLE_DUPLICATE_NAME · 客户名称疑似已存在'])
  assert.equal(rows[1][3], '统一社会信用代码 · REQUIRED · 必填字段为空；登记联系人电话 · INVALID_PHONE · 联系电话格式不正确')

  const csv = customerImportErrorsCsv(preview)
  assert.ok(csv.startsWith('\ufeff'))
  assert.equal(csv.split('\r\n')[0], `\ufeff${customerImportErrorHeaders.join(',')}`)
  assert.equal(csv.split('\r\n')[0], '\ufeff行号,状态,客户,问题')
  assert.equal(csv.split('\r\n').length, 3)
})

test('客户导入错误报告：结果失败/跳过行、结果优先于预检、空数据只保留表头', () => {
  const preview = { rows: [{ row_no: 2, status: 'ERROR', name: '预检客户', issues: [{ column: '客户名称', code: 'REQUIRED', message: '预检问题' }] }] }
  const result = { rows: [
    { row_no: 6, status: 'IMPORTED', customer_no: 'C-1' },
    { row_no: 7, status: 'FAILED', customer_no: 'C-2', error_code: 'OWNER_SELECTION_INVALID', message: '当前导入人已失效' },
    { row_no: 8, status: 'SKIPPED', customer_no: 'C-3' },
  ] }
  const rows = customerImportErrorRows(preview, result)
  assert.deepEqual(rows, [
    ['7', '导入失败', 'C-2', 'OWNER_SELECTION_INVALID · 当前导入人已失效'],
    ['8', '跳过', 'C-3', ''],
  ])
  assert.equal(customerImportErrorRows({ rows: [{ row_no: 2, status: 'READY', name: '正常' }] }).length, 0)
  assert.equal(customerImportErrorsCsv({ rows: [{ row_no: 2, status: 'READY', name: '正常' }] }).split('\r\n').length, 1)
  assert.equal(customerImportErrorsCsv(null, null).split('\r\n').length, 1)
})

test('客户导入错误报告：公式前缀被中和', () => {
  const csv = customerImportErrorsCsv({ rows: [
    { row_no: 2, status: 'ERROR', name: '=cmd', issues: [{ column: '@列', code: '+CODE', message: '-1+1' }] },
    { row_no: 3, status: 'ERROR', name: '普通客户', issues: [{ code: '+CODE', message: '-1+1' }] },
  ] })
  assert.ok(csv.includes("'=cmd"))
  assert.ok(csv.includes("'@列"))
  assert.ok(csv.includes("'+CODE · -1+1"))
})
