/**
 * CSV 导出单元格转义。
 *
 * 两层处理缺一不可：
 * 1) 结构转义：包含分隔符、引号或换行的值必须加引号并把引号翻倍，否则一行会裂成多列。
 * 2) 公式前缀防护：以 = + - @ 或制表符/回车开头的文本会被 Excel / LibreOffice 当作公式
 *    执行（人员姓名允许保存这类值），导出给他人打开时形成注入面。对文本加前导单引号，
 *    表格软件按文本显示；纯数字（含负数）保持原样，避免把数值变成文本。
 */

const FORMULA_PREFIX = /^[=+\-@\t\r]/
const PLAIN_NUMBER = /^-?\d+(\.\d+)?$/

export function escapeCsvCell(value) {
  let text = String(value ?? '')
  if (FORMULA_PREFIX.test(text) && !PLAIN_NUMBER.test(text)) {
    text = `'${text}`
  }
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`
  }
  return text
}

/** 把表头和行数据渲染成 CRLF 分隔的 CSV 文本（不含 BOM）。 */
export function toCsvText(headers, rows) {
  const lines = [headers.map(escapeCsvCell).join(',')]
  for (const row of rows) {
    lines.push(row.map(escapeCsvCell).join(','))
  }
  return lines.join('\r\n')
}
