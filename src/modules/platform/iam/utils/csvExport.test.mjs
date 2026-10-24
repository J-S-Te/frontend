import assert from 'node:assert/strict'
import test from 'node:test'
import { escapeCsvCell, toCsvText } from './csvExport.js'

// 人员姓名等字段允许保存任意文本，导出给他人用 Excel 打开时不能变成公式。
test('公式前缀被中和，纯数字与负数保持原样', () => {
  assert.equal(escapeCsvCell('=1+2'), "'=1+2")
  assert.equal(escapeCsvCell('+SUM(A1)'), "'+SUM(A1)")
  assert.equal(escapeCsvCell('-2+3'), "'-2+3")
  assert.equal(escapeCsvCell('@cmd'), "'@cmd")
  assert.equal(escapeCsvCell('\tpayload'), "'\tpayload")
  assert.equal(escapeCsvCell('-100'), '-100')
  assert.equal(escapeCsvCell('42'), '42')
  assert.equal(escapeCsvCell('张三'), '张三')
  assert.equal(escapeCsvCell(''), '')
  assert.equal(escapeCsvCell(null), '')
})

test('结构转义仍然生效：分隔符、引号、换行', () => {
  assert.equal(escapeCsvCell('a,b'), '"a,b"')
  assert.equal(escapeCsvCell('say "hi"'), '"say ""hi"""')
  assert.equal(escapeCsvCell('a\nb'), '"a\nb"')
  // 公式前缀与结构转义可以同时作用。
  assert.equal(escapeCsvCell('=a,b'), '"\'=a,b"')
})

test('整行导出按 CRLF 连接且不会把注入行拆成多列', () => {
  // 不含分隔符的注入载荷只需前缀中和；含逗号的载荷必须同时加引号。
  const csv = toCsvText(['姓名', '备注'], [
    ["=cmd|' /c calc'!A0", 'a,b'],
    ["=cmd|' /c calc'!A0,1", '普通备注'],
  ])
  const lines = csv.split('\r\n')
  assert.equal(lines.length, 3)
  assert.equal(lines[0], '姓名,备注')
  assert.equal(lines[1], "\'=cmd|\' /c calc\'!A0,\"a,b\"")
  assert.equal(lines[2], "\"\'=cmd|\' /c calc\'!A0,1\",普通备注")
})
