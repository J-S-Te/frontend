/**
 * 员工批量导入的服务端逐行问题解析与错误报告导出。
 *
 * 后端 CreateEmployeesBatch 一次性返回整批 422，`details.issues` 里是每行独立的问题
 * （row / field / code / message）。这里只做“可安全展示 + 可下载”的规范化：不猜测业务
 * 原因、不改写说明文案，也不把任意 details 字段拼进面向用户的文本。
 */
import { toCsvText } from './csvExport.js'

/** 错误报告文件名；导入管理员下载后按行修正 CSV 再重新导入。 */
export const IMPORT_ISSUE_CSV_FILENAME = '员工导入错误.csv'
/** 错误报告列顺序固定，便于逐行对照与二次导入。 */
export const IMPORT_ISSUE_CSV_HEADERS = ['行号', '字段', '错误码', '说明']
/** 单次导入最多 100 行，这里留出每行多个问题的余量；超出部分不再展示，避免界面失控。 */
export const MAX_IMPORT_ISSUES = 200

// 字段列展示中文标签：导入管理员看到“岗位”比“position”更容易定位 CSV 列。
const FIELD_LABELS = {
  organization: '组织',
  organization_name: '组织',
  position: '岗位',
  position_name: '岗位',
  application_roles: '应用角色',
  display_name: '姓名',
  email: '邮箱',
  mobile: '手机号',
  status: '状态',
  items: '整批',
}

function issueText(value, maxLength = 400) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : ''
}

// 已知字段名映射为中文标签；已本地化的标签或未知字段原样保留，避免二次映射。
function issueFieldLabel(field) {
  return FIELD_LABELS[field] || field
}

/**
 * 解析 422 响应 details 中的逐行问题。
 *
 * 兼容三种输入：`{ issues: [...] }`、直接的 issues 数组、以及缺失 details 的旧响应。
 * 结构不完整的条目被丢弃而不是伪造占位说明；重复条目按内容去重。
 *
 * @param {unknown} details 服务端错误详情。
 * @returns {Array<{row: number, field: string, code: string, message: string}>} 规范化问题列表。
 */
export function parseBatchImportIssues(details) {
  const candidates = Array.isArray(details)
    ? details
    : (details && typeof details === 'object' && Array.isArray(details.issues) ? details.issues : [])
  const found = []
  const seen = new Set()
  for (const issue of candidates) {
    if (!issue || typeof issue !== 'object') continue
    const message = issueText(issue.message)
    const code = issueText(issue.code, 96)
    if (!message && !code) continue
    const rawRow = Number(issue.row ?? issue.line ?? 0)
    const row = Number.isSafeInteger(rawRow) && rawRow > 0 ? rawRow : 0
    const field = issueFieldLabel(issueText(issue.field, 96))
    const key = `${row}\u0000${field}\u0000${code}\u0000${message}`
    if (seen.has(key)) continue
    seen.add(key)
    found.push({ row, field, code, message })
    if (found.length >= MAX_IMPORT_ISSUES) break
  }
  return found
}

/** 行号列为空时表示整批级问题（例如服务端整体校验失败），而不是第 0 行。 */
export function importIssueRowLabel(row) {
  return Number(row) > 0 ? String(row) : '整批'
}

/**
 * 只把 422 批校验响应当作逐行问题清单。
 *
 * 403（缺少 platform:role-binding:update）、409（账号冲突）等仍是整批语义，说明文案由
 * 既有错误映射给出；把它们也当成逐行清单会淹没权限或冲突提示，误导管理员去改 CSV。
 *
 * @param {unknown} error createEmployeesBatch 抛出的 IAM 错误。
 * @returns {Array<{row: number, field: string, code: string, message: string}>} 逐行问题列表。
 */
export function importIssuesFromError(error) {
  if (!error || typeof error !== 'object') return []
  if (Number(error.status) !== 422) return []
  return parseBatchImportIssues(error.details)
}

/**
 * 生成错误报告 CSV 文本：UTF-8 BOM + CRLF，并发中和公式前缀。
 *
 * 说明列来自服务端文案，但仍是导入管理员之外可能出现的任意文本（例如 CSRF 之外的上游
 * 拼接），导出给 Excel 打开前必须按纯文本处理，不能变成公式。
 *
 * @param {Array<{row: number, field: string, code: string, message: string}>} issues 已规范化的问题。
 * @returns {string} 可直接写入文件的 CSV 文本（含 BOM）。
 */
export function batchImportIssueCsv(issues) {
  const rows = (Array.isArray(issues) ? issues : []).map((issue) => [
    importIssueRowLabel(issue?.row),
    issueFieldLabel(issueText(issue?.field, 96)),
    issue?.code || '',
    issue?.message || '',
  ])
  return `\uFEFF${toCsvText(IMPORT_ISSUE_CSV_HEADERS, rows)}`
}
