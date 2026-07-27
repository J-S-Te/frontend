const ACTION_LABELS = Object.freeze({
  'auth.login': '登录',
  'auth.login.failed': '登录失败',
  'auth.login.locked': '账号锁定',
  'auth.logout': '退出登录',
})

const RESULT_LABELS = Object.freeze({
  SUCCESS: '成功',
  FAILURE: '失败',
  DENIED: '拒绝',
  ERROR: '异常',
  PARTIAL: '部分成功',
})

function normalized(value) {
  return String(value || '').trim()
}

/**
 * 返回面向管理员的操作名称。已知认证事件使用中文名称，未知事件保留后端原始值，
 * 避免前端臆测业务含义。
 */
export function auditActionLabel(record = {}) {
  const action = normalized(record.action || record.type)
  return ACTION_LABELS[action] || normalized(record.type) || action || '—'
}

/** 返回用于排查和接口对照的稳定操作代码。 */
export function auditActionCode(record = {}) {
  return normalized(record.action || record.type)
}

/**
 * 将结果与认证动作组合成易读状态。HTTP 状态码缺失时只显示真实业务结果，
 * 不再使用“— · 成功”这种容易误解的占位形式。
 */
export function auditResultLabel(record = {}) {
  const action = normalized(record.action || record.type)
  const result = normalized(record.result).toUpperCase()

  if (action === 'auth.login.locked') return result === 'SUCCESS' ? '锁定已解除' : '账号已锁定'
  if (action === 'auth.login' && result === 'SUCCESS') return '登录成功'
  if (action.startsWith('auth.login') && ['FAILURE', 'DENIED', 'ERROR'].includes(result)) return '登录失败'
  if (action === 'auth.logout' && result === 'SUCCESS') return '退出成功'

  return normalized(record.resultLabel) || RESULT_LABELS[result] || normalized(record.result) || '状态未知'
}

/** 返回结果徽标的语义色类名。 */
export function auditResultTone(result) {
  switch (normalized(result).toUpperCase()) {
    case 'SUCCESS':
      return 'audit-result-success'
    case 'FAILURE':
    case 'DENIED':
      return 'audit-result-denied'
    case 'ERROR':
      return 'audit-result-error'
    case 'PARTIAL':
      return 'audit-result-partial'
    default:
      return 'audit-result-unknown'
  }
}

/** 仅在后端确实返回有效状态码时显示 HTTP 状态，禁止补造 200 等值。 */
export function auditHttpStatusLabel(statusCode) {
  const code = Number(statusCode)
  return Number.isInteger(code) && code >= 100 && code <= 599 ? `HTTP ${code}` : ''
}

/** 返回详情视图中结果徽标之外的补充信息。 */
export function auditResultMeta(record = {}) {
  const parts = []
  const status = auditHttpStatusLabel(record.statusCode)
  if (status) parts.push(status)

  const risk = normalized(record.riskLabel || record.risk)
  if (risk && risk !== '—') parts.push(`${risk}风险`)

  return parts.join(' · ')
}

/** 审计详情弹窗使用的完整结果摘要。 */
export function auditResultSummary(record = {}) {
  return [auditResultLabel(record), auditResultMeta(record)].filter(Boolean).join(' · ')
}
