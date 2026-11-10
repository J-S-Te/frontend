import { toCsvText } from '../../platform/iam/utils/csvExport.js'

/**
 * 合同批量导入错误报告：只读取当前批次预检 items 的 ImportIssue 与页面已展示的批次错误。
 * ImportIssue 的 message 不一定存在，缺失时沿用页面现有的错误码中文映射，不额外编造原因。
 */

export const contractImportErrorHeaders = Object.freeze(['序号', '合同标识', '错误字段', '错误码', '可重试', '说明'])

/**
 * 历史导入自动开立 CRM 客户/商机（provision）失败原因的中文映射。
 * 服务端逐项 Issues 只保证返回稳定错误码，页面与错误报告据此给出中文原因，不编造细节。
 */
export const contractImportProvisionIssueLabels = Object.freeze({
  IMPORT_CRM_PROVISION_DISABLED: '服务端未开启历史导入自动开立 CRM 客户/商机，本批次不能按 provision 方式执行。',
  IMPORT_PROVISION_OWNER_UNRESOLVED: 'Excel「销售姓名」未能在平台人员目录中唯一匹配，请核对姓名或先维护该销售账号。',
  IMPORT_PROVISION_CUSTOMER_AMBIGUOUS: '客户名称在 CRM 中匹配到多个客户，无法自动开立商机；请填写 CRM 客户编号。',
  IMPORT_PROVISION_CRM_REJECTED: 'CRM 拒绝了自动开立客户或商机，请核对客户、销售以及商机金额、签约日期后重试。',
  IMPORT_PROVISION_CRM_UNAVAILABLE: 'CRM 自动开立服务暂不可用，已保留处理进度；服务恢复后请从原批次恢复执行。',
  IMPORT_PROVISION_CONTRACT_NOT_VERIFIED: '合同验真未通过，商机不能推进到「已签约」；请先完成合同验真再重试。',
})

function text(value) {
  return String(value ?? '')
}

function fieldText(issue, fieldLabel) {
  const field = text(issue?.field_path ?? issue?.field)
  if (!field) return ''
  try {
    return text(fieldLabel(field)) || field
  } catch {
    return field
  }
}

function issueMessage(issue, issueLabels) {
  const message = text(issue?.message)
  if (message) return message
  return text(issueLabels?.[issue?.code]) || text(issue?.code)
}

/**
 * contractImportErrorRows 生成逐项问题与批次错误行。
 * 参数：items 为批次 ImportItemState 数组；batchError 为页面展示的批次级错误；
 *   options.issueLabels 为错误码中文映射，options.fieldLabel 为字段名翻译函数。
 * 返回值：二维字符串数组；无问题项且无批次错误时为空数组。
 */
export function contractImportErrorRows(items = [], batchError = '', { issueLabels = {}, fieldLabel = (field) => field } = {}) {
  const rows = []
  const entries = Array.isArray(items) ? items : []
  entries.forEach((entry, index) => {
    const issues = Array.isArray(entry?.issues) ? entry.issues : []
    const identity = text(entry?.item?.item_key || entry?.item?.external_record_id || entry?.contract_id || entry?.id)
    for (const issue of issues) {
      rows.push([
        String(index + 1),
        identity,
        fieldText(issue, fieldLabel),
        text(issue?.code),
        issue?.retryable ? '是' : '否',
        issueMessage(issue, issueLabels),
      ])
    }
  })
  const batchMessage = text(batchError).trim()
  if (batchMessage) rows.push(['批次', '', '', '', '', batchMessage])
  return rows
}

/**
 * contractImportErrorsCsv 生成带 UTF-8 BOM、CRLF 行分隔的 CSV 文本。
 * 参数：同 contractImportErrorRows。
 * 返回值：CSV 字符串；无问题时只保留表头。
 */
export function contractImportErrorsCsv(items = [], batchError = '', options = {}) {
  return `\ufeff${toCsvText(contractImportErrorHeaders, contractImportErrorRows(items, batchError, options))}`
}
