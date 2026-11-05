import assert from 'node:assert/strict'
import test from 'node:test'
import { projectImportErrorHeaders, projectImportErrorRows, projectImportErrorsCsv } from './importErrors.js'

test('项目导入错误报告：表头、中文、BOM、CRLF 与行数', () => {
  const source = {
    total: 4,
    valid: 1,
    invalid: 3,
    rows: [
      { row_no: 2, status: 'READY', errors: [] },
      { row_no: 3, status: 'INVALID', errors: ['人员不唯一', '资质编码已停用'] },
      { row_no: 4, status: 'INVALID', issues: [{ column: '组织名称', code: 'REQUIRED', message: '组织名称不能为空' }] },
      { row_no: 5, status: 'INVALID', errors: [] },
    ],
  }
  const rows = projectImportErrorRows(source)
  assert.equal(rows.length, 4)
  assert.deepEqual(rows[0], ['3', '不通过', '', '', '人员不唯一'])
  assert.deepEqual(rows[1], ['3', '不通过', '', '', '资质编码已停用'])
  assert.deepEqual(rows[2], ['4', '不通过', '组织名称', 'REQUIRED', '组织名称不能为空'])
  assert.deepEqual(rows[3], ['5', '不通过', '', '', ''])

  const csv = projectImportErrorsCsv(source)
  assert.ok(csv.startsWith('\ufeff'))
  const lines = csv.split('\r\n')
  assert.equal(lines.length, 5)
  assert.equal(lines[0], `\ufeff${projectImportErrorHeaders.join(',')}`)
  assert.equal(lines[0], '\ufeff行号,状态,错误列,错误码,错误信息')
  assert.match(lines[1], /人员不唯一/)
})

test('项目导入错误报告：结果行覆盖失败/跳过，顶层 errors 只补充未被行级覆盖的原因', () => {
  const source = {
    imported: 1,
    skipped: 3,
    rows: [
      { row_no: 2, status: 'IMPORTED', message: '导入成功' },
      { row_no: 3, status: 'FAILED', message: '设备占用冲突' },
      { row_no: 4, status: 'SKIPPED', message: '未选择' },
    ],
    errors: ['第 3 行：设备占用冲突', '第 9 行：批次级异常', '第 9 行：批次级异常'],
  }
  const rows = projectImportErrorRows(source)
  assert.deepEqual(rows, [
    ['3', '失败', '', '', '设备占用冲突'],
    ['4', '跳过', '', '', '未选择'],
    ['9', '失败', '', '', '第 9 行：批次级异常'],
  ])
})

test('项目导入错误报告：公式前缀被中和，空数据仍保留表头且没有数据行', () => {
  const csv = projectImportErrorsCsv({ rows: [{ row_no: 2, status: 'INVALID', issues: [{ column: '=列', code: '@CODE', message: '=1+2' }] }] })
  assert.ok(csv.includes("'=列"))
  assert.ok(csv.includes("'@CODE"))
  assert.ok(csv.includes("'=1+2"))
  assert.equal(projectImportErrorRows({ rows: [{ row_no: 2, status: 'READY' }] }).length, 0)
  assert.equal(projectImportErrorsCsv({ rows: [{ row_no: 2, status: 'READY' }] }).split('\r\n').length, 1)
  assert.equal(projectImportErrorsCsv(null).split('\r\n').length, 1)
})

test('项目导入错误报告：页面文案过滤器可拦截内部诊断，空消息不套用兜底文案', () => {
  const source = { rows: [
    { row_no: 2, status: 'INVALID', errors: ['SQLSTATE HY000: INSERT INTO credentials'] },
    { row_no: 3, status: 'SKIPPED' },
  ] }
  const rows = projectImportErrorRows(source, () => '请核对本行内容；如无法确认，请联系管理员。')
  assert.equal(rows[0][4], '请核对本行内容；如无法确认，请联系管理员。')
  assert.equal(rows[1][4], '')
  assert.deepEqual(projectImportErrorRows({ errors: ['第 2 行：网络中断'] }), [['2', '失败', '', '', '第 2 行：网络中断']])
})
