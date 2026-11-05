import { toCsvText } from '../platform/iam/utils/csvExport.js'
import { importRowStatusText } from './crmDisplay.js'

/**
 * 客户导入错误报告：只用弹窗里已经存在的预检/结果行生成，不再请求服务端下载接口。
 * 预检行问题在 issues（column/code/message），结果行问题是 error_code + message；
 * 两者都合并到“问题”列，多个问题用分号分隔。成功/可导入行不进入报告。
 */

export const customerImportErrorHeaders = Object.freeze(['行号', '状态', '客户', '问题'])

function text(value) {
  return String(value ?? '')
}

function issueText(issue) {
  return [text(issue?.column), text(issue?.code), text(issue?.message)]
    .filter(Boolean)
    .join(' · ')
}

function previewProblem(row) {
  return (Array.isArray(row?.issues) ? row.issues : [])
    .map(issueText)
    .filter(Boolean)
    .join('；')
}

function resultProblem(row) {
  return [text(row?.error_code), text(row?.message)].filter(Boolean).join(' · ')
}

function isSuccessStatus(value) {
  return value === 'READY' || value === 'IMPORTED'
}

function statusText(value) {
  return value === 'SKIPPED' ? '跳过' : importRowStatusText(value)
}

/**
 * customerImportErrorRows 生成错误/警告/失败行的报表数据。
 * 参数：preview 为预检对象，result 为提交结果对象；有结果时以结果为准。
 * 返回值：二维字符串数组；无内容时返回空数组。
 */
export function customerImportErrorRows(preview, result) {
  const source = result || preview
  if (!source || !Array.isArray(source.rows)) return []
  return source.rows
    .filter((row) => !isSuccessStatus(text(row?.status)))
    .map((row, index) => ({
      rowNo: Number.isInteger(row?.row_no) ? String(row.row_no) : String(index + 2),
      status: statusText(text(row?.status)),
      customer: text(result ? (row?.customer_no || row?.customer_name || row?.name) : (row?.name || row?.customer_name)),
      problem: result ? resultProblem(row) : previewProblem(row),
    }))
    .map((row) => [row.rowNo, row.status, row.customer, row.problem])
}

/**
 * customerImportErrorsCsv 生成带 UTF-8 BOM、CRLF 行分隔的 CSV 文本。
 * 参数：preview、result 同 customerImportErrorRows。
 * 返回值：CSV 字符串；无错误行时只保留表头。
 */
export function customerImportErrorsCsv(preview, result) {
  return `\ufeff${toCsvText(customerImportErrorHeaders, customerImportErrorRows(preview, result))}`
}
