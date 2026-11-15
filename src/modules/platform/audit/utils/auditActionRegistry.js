// 审计 action registry：只负责稳定的分类/展示，不改变后端事件事实。
// 新增通用 HTTP/安全事件时优先在这里登记；未知 action 保留原编码。
export const AUDIT_ACTION_CATEGORY = Object.freeze({
  HTTP: 'HTTP',
  BUSINESS: 'BUSINESS',
  SECURITY: 'SECURITY',
  SENSITIVE_READ: 'SENSITIVE_READ',
})

const SECURITY_ACTIONS = new Set(['AUTHENTICATION_DENIED'])
const SENSITIVE_READ_ACTIONS = new Set([
  'AUDIT_EXPORT_DOWNLOAD',
  'LICENSE_ARTIFACT_READ',
  'DATA_ANALYSIS_EXPORT_DOWNLOAD',
  'SETTLEMENT_REPORT_EXPORT_DOWNLOADED',
  'SETTLEMENT_INVOICE_DOCUMENT_DOWNLOADED',
  'SETTLEMENT_RECEIPT_DOCUMENT_DOWNLOADED',
])

export function auditActionCategory(action) {
  const value = String(action || '').trim()
  if (!value) return ''
  if (SECURITY_ACTIONS.has(value)) return AUDIT_ACTION_CATEGORY.SECURITY
  if (SENSITIVE_READ_ACTIONS.has(value)) return AUDIT_ACTION_CATEGORY.SENSITIVE_READ
  if (/_HTTP_(GET|POST|PUT|PATCH|DELETE)_/.test(value)) return AUDIT_ACTION_CATEGORY.HTTP
  if (value.startsWith('HTTP_')) return AUDIT_ACTION_CATEGORY.HTTP
  return AUDIT_ACTION_CATEGORY.BUSINESS
}

export function auditActionMeta(action) {
  const value = String(action || '').trim()
  const category = auditActionCategory(value)
  if (category === AUDIT_ACTION_CATEGORY.SECURITY) return { category, label: '认证失败' }
  if (category === AUDIT_ACTION_CATEGORY.SENSITIVE_READ) return { category, label: '敏感读' }
  if (category === AUDIT_ACTION_CATEGORY.HTTP) return { category, label: '通用 HTTP 操作' }
  return { category, label: value || '未分类' }
}
