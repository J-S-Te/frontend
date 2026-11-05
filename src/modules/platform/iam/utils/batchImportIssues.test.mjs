import test from 'node:test'
import assert from 'node:assert/strict'
import {
  IMPORT_ISSUE_CSV_FILENAME,
  IMPORT_ISSUE_CSV_HEADERS,
  MAX_IMPORT_ISSUES,
  batchImportIssueCsv,
  importIssueRowLabel,
  importIssuesFromError,
  parseBatchImportIssues,
} from './batchImportIssues.js'

const fixture = [
  { row: 2, field: 'organization', code: 'ORGANIZATION_NOT_FOUND', message: '组织不存在或已停用' },
  { row: 5, field: 'position', code: 'POSITION_REQUIRED', message: '岗位名称必填，请填写系统中的岗位中文名称' },
  { row: 9, field: 'application_roles', code: 'ROLE_ASSIGNMENT_INVALID', message: '应用角色条目无效' },
]

test('422 details.issues 被完整解析，行号与字段标签可直接对照 CSV', () => {
  const issues = parseBatchImportIssues({ issues: fixture })
  assert.equal(issues.length, 3)
  assert.deepEqual(issues.map((issue) => issue.row), [2, 5, 9])
  // 字段列展示中文标签，导入管理员不必猜测后端字段名。
  assert.deepEqual(issues.map((issue) => issue.field), ['组织', '岗位', '应用角色'])
  assert.equal(issues[0].code, 'ORGANIZATION_NOT_FOUND')
  assert.equal(issues[1].message, fixture[1].message)
})

test('整批级问题用 row=0 表示，不会被伪造成第 0 行数据或第一行', () => {
  const issues = parseBatchImportIssues({ issues: [{ row: 0, field: 'items', code: 'BATCH_VALIDATION_FAILED', message: '批量数据未通过服务端校验' }] })
  assert.equal(issues.length, 1)
  assert.equal(issues[0].row, 0)
  assert.equal(importIssueRowLabel(issues[0].row), '整批')
  // 非法行号同样归为整批级，不猜测成第 1 行。
  for (const row of [-3, 1.5, 'x', null, undefined]) {
    assert.equal(parseBatchImportIssues({ issues: [{ row, code: 'C', message: '说明' }] })[0].row, 0)
  }
})

test('缺少 details、结构异常或空问题的响应不会产生伪造清单', () => {
  for (const details of [undefined, null, {}, { issues: null }, { issues: 'oops' }, [], 'x', 42]) {
    assert.deepEqual(parseBatchImportIssues(details), [])
  }
  assert.deepEqual(parseBatchImportIssues({ issues: [null, 'x', 7, {}, { row: 1 }] }), [])
  // 只有错误码没有说明时仍保留，说明列由导出兜底为空。
  assert.deepEqual(parseBatchImportIssues({ issues: [{ row: 4, code: 'SOME_CODE' }] }), [
    { row: 4, field: '', code: 'SOME_CODE', message: '' },
  ])
})

test('完全重复的问题只保留一条，超出上限时截断', () => {
  assert.equal(parseBatchImportIssues({ issues: [fixture[0], { ...fixture[0] }] }).length, 1)
  const many = Array.from({ length: MAX_IMPORT_ISSUES + 25 }, (_, index) => ({
    row: index + 1, field: 'position', code: 'POSITION_NOT_FOUND', message: `第 ${index + 1} 行岗位缺失`,
  }))
  assert.equal(parseBatchImportIssues({ issues: many }).length, MAX_IMPORT_ISSUES)
})

test('错误报告 CSV 带 UTF-8 BOM、CRLF 与固定四列，且中和公式前缀', () => {
  assert.equal(IMPORT_ISSUE_CSV_FILENAME, '员工导入错误.csv')
  assert.deepEqual(IMPORT_ISSUE_CSV_HEADERS, ['行号', '字段', '错误码', '说明'])
  const csv = batchImportIssueCsv([
    ...fixture,
    { row: 0, field: '整批', code: 'BATCH_VALIDATION_FAILED', message: '=cmd|calc!A0' },
    { row: 12, field: '岗位', code: 'POSITION_NOT_FOUND', message: '含逗号,与"引号"' },
  ])
  assert.ok(csv.startsWith('\uFEFF'), 'CSV 必须以 UTF-8 BOM 开头，Excel 才不会乱码')
  const lines = csv.slice(1).split('\r\n')
  assert.equal(lines[0], '行号,字段,错误码,说明')
  assert.equal(lines.length, 6)
  assert.equal(lines[1], '2,组织,ORGANIZATION_NOT_FOUND,组织不存在或已停用')
  assert.equal(lines[4], '整批,整批,BATCH_VALIDATION_FAILED,\'=cmd|calc!A0')
  assert.equal(lines[5], '12,岗位,POSITION_NOT_FOUND,"含逗号,与""引号"""')
})

test('空清单导出只有表头，不产生伪造的数据行', () => {
  const csv = batchImportIssueCsv([])
  assert.equal(csv, '\uFEFF行号,字段,错误码,说明')
  assert.equal(batchImportIssueCsv(undefined), '\uFEFF行号,字段,错误码,说明')
})

test('只有 422 批校验被当成逐行清单，403/409 仍沿用整批语义', () => {
  const details = { issues: fixture }
  assert.equal(importIssuesFromError({ status: 422, details }).length, 3)
  assert.equal(importIssuesFromError({ status: '422', details }).length, 3)
  // 缺少 app:role-binding 权限的 403 与账号冲突的 409 不能被显示成“请逐行修正 CSV”。
  assert.deepEqual(importIssuesFromError({ status: 403, details }), [])
  assert.deepEqual(importIssuesFromError({ status: 409, details }), [])
  assert.deepEqual(importIssuesFromError({ status: 422 }), [])
  for (const error of [undefined, null, 'x', 42]) assert.deepEqual(importIssuesFromError(error), [])
})
