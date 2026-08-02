export const OPPORTUNITY_INTAKE_STATUSES = Object.freeze({
  ACCEPTED: Object.freeze({ label: '待核对', tone: 'warning' }),
  LINK_CONFIRMED: Object.freeze({ label: '关联已确认', tone: 'success' }),
  LINK_EXCEPTION: Object.freeze({ label: '关联异常', tone: 'danger' }),
})

export function opportunityIntakeStatus(status) {
  return OPPORTUNITY_INTAKE_STATUSES[status] || Object.freeze({ label: status || '未知状态', tone: 'neutral' })
}

function reviewFingerprint(command) {
  return JSON.stringify({
    intakeId: String(command.intakeId || ''),
    decision: String(command.decision || ''),
    reason: String(command.reason || '').trim(),
    version: Number(command.version || 0),
  })
}

function browserIdempotencyKey() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  if (!globalThis.crypto?.getRandomValues) {
    throw new Error('当前浏览器无法生成安全的幂等键，请升级浏览器后重试。')
  }
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16))
  return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('')
}

/**
 * 同一页面内，相同业务命令始终复用同一个幂等键。只有用户修改命令内容、
 * 关闭详情重新开始，或服务端明确成功后，调用方才应丢弃本次 attempt。
 */
export function ensureStableReviewAttempt(previous, command, keyFactory = browserIdempotencyKey) {
  const fingerprint = reviewFingerprint(command)
  if (previous?.fingerprint === fingerprint && previous?.key) return previous
  return Object.freeze({ fingerprint, key: keyFactory() })
}

export function isOpportunityIntakeVersionConflict(error) {
  return error?.status === 409 && ['CON_VERSION_CONFLICT', 'CON_STATE_CONFLICT'].includes(error?.code)
}

export function isOpportunityIntakeIdempotencyConflict(error) {
  return error?.status === 409 && error?.code === 'CON_INTAKE_REVIEW_IDEMPOTENCY_CONFLICT'
}
