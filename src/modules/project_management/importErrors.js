import { toCsvText } from '../platform/iam/utils/csvExport.js'

/**
 * 项目导入错误报告：只根据服务端已经返回的预检/结果数据生成，不补造错误。
 *
 * 服务端人员资质、设备能力与检测类别接口当前把问题放在 errors/warnings（字符串数组），
 * 同时兼容 issues（{column, code, message}）结构。两种形状都按同一张 CSV 呈现：
 * 行号、状态、错误列、错误码、错误信息。没有列/错误码时留空，不猜测字段名。
 */

export const projectImportErrorHeaders = Object.freeze(['行号', '状态', '错误列', '错误码', '错误信息'])

const statusLabels = Object.freeze({
  READY: '可导入',
  INVALID: '不通过',
  IMPORTED: '成功',
  FAILED: '失败',
  SKIPPED: '跳过',
})

function text(value) {
  return String(value ?? '')
}

function statusLabel(value) {
  return statusLabels[value] || text(value)
}

function isSuccessStatus(value) {
  return value === 'READY' || value === 'IMPORTED'
}

function issueMessage(value) {
  if (value && typeof value === 'object') return text(value.message || value.msg || value)
  return text(value)
}

/**
 * formattedMessage 只对非空消息调用页面过滤器，避免空原因被兜底文案填满。
 * 参数：value 为服务端原始消息；formatMessage 为页面文案过滤器。
 * 返回值：过滤后的文本；没有原始消息时返回空串。
 */
function formattedMessage(value, formatMessage) {
  const message = issueMessage(value)
  return message ? text(formatMessage(message)) : ''
}

/**
 * normalizeRowIssues 统一行级问题，优先使用结构化 issues，再回退到 errors/warnings。
 * 参数：row 为服务端预检/结果行；formatMessage 为页面文案过滤器。
 * 返回值：{column, code, message} 数组；没有问题时返回空数组。
 */
function normalizeRowIssues(row, formatMessage) {
  if (Array.isArray(row?.issues) && row.issues.length) {
    return row.issues.map((issue) => ({
      column: text(issue?.column ?? issue?.field ?? ''),
      code: text(issue?.code ?? ''),
      message: formattedMessage(issue?.message, formatMessage),
    })).filter((issue) => issue.column || issue.code || issue.message)
  }
  const messages = [
    ...(Array.isArray(row?.errors) ? row.errors : []),
    ...(Array.isArray(row?.warnings) ? row.warnings : []),
  ].map((message) => formattedMessage(message, formatMessage)).filter(Boolean)
  if (messages.length) return messages.map((message) => ({ column: '', code: '', message }))
  const message = formattedMessage(row?.message, formatMessage)
  return message ? [{ column: '', code: '', message }] : []
}

/**
 * projectImportErrorRows 生成 CSV 数据行，覆盖所有非成功行。
 * 参数：source 为预检或导入结果对象（含 rows，可选 errors）；formatMessage 为可选文案过滤函数，
 *   页面会传入既有 formatUserError 包装，避免内部诊断进入导出文件。
 * 返回值：二维字符串数组；行内多个问题会拆成多行，同一行号可重复出现。
 */
export function projectImportErrorRows(source, formatMessage = (value) => value) {
  if (!source || typeof source !== 'object') return []
  const rows = []
  const coveredRowNumbers = new Set()
  const sourceRows = Array.isArray(source.rows) ? source.rows : []
  sourceRows.forEach((row, index) => {
    const status = text(row?.status)
    if (isSuccessStatus(status)) return
    const rowNo = Number.isInteger(row?.row_no) ? String(row.row_no) : String(index + 2)
    coveredRowNumbers.add(rowNo)
    const issues = normalizeRowIssues(row, formatMessage)
    if (!issues.length) {
      rows.push([rowNo, statusLabel(status), '', '', ''])
      return
    }
    for (const issue of issues) {
      rows.push([rowNo, statusLabel(status), issue.column, issue.code, issue.message])
    }
  })

  // 结果对象的顶层 errors 常是“第 N 行：原因”的汇总；已由行级数据覆盖的不再重复。
  const errors = Array.isArray(source.errors) ? source.errors : []
  for (const raw of errors) {
    const rawMessage = issueMessage(raw)
    if (!rawMessage) continue
    const message = text(formatMessage(rawMessage)).trim()
    if (!message) continue
    const match = /^第\s*(\d+)\s*行/.exec(message)
    const rowNo = match ? match[1] : ''
    if (rowNo && coveredRowNumbers.has(rowNo)) continue
    if (rows.some((row) => row[4] === message)) continue
    rows.push([rowNo, '失败', '', '', message])
  }
  return rows
}

/**
 * projectImportErrorsCsv 生成可直接下载的 UTF-8 BOM CSV 文本，行分隔为 CRLF。
 * 参数：source 同 projectImportErrorRows；formatMessage 可选文案过滤函数。
 * 返回值：带 BOM 的 CSV 字符串；无错误行时仍保留表头。
 */
export function projectImportErrorsCsv(source, formatMessage) {
  return `\ufeff${toCsvText(projectImportErrorHeaders, projectImportErrorRows(source, formatMessage))}`
}
