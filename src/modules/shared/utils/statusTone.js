// 共享状态色调映射：只统一“语义 → tone 档位”，具体色值仍由各模块 CSS token/皮肤决定。
// 未知状态一律落到 neutral，不根据中文字符或字符串包含关系猜测成功/失败。
export const STATUS_TONES = Object.freeze({
  DRAFT: 'neutral',
  NEW: 'neutral',
  NOT_STARTED: 'neutral',
  UNKNOWN: 'neutral',
  ARCHIVED: 'neutral',
  CANCELLED: 'neutral',
  CANCELED: 'neutral',
  CLOSED: 'neutral',
  DISABLED: 'neutral',
  VOID: 'neutral',
  REVOKED: 'neutral',
  PENDING: 'warning',
  PENDING_APPROVAL: 'warning',
  PENDING_REVIEW: 'warning',
  PENDING_CONFIRMATION: 'warning',
  REVIEW_PENDING: 'warning',
  SPECIAL_REVIEW: 'warning',
  HELD: 'warning',
  WAITING: 'warning',
  PARTIAL: 'warning',
  PARTIALLY_SETTLED: 'warning',
  OVERDUE: 'warning',
  SUBMITTED: 'info',
  PROCESSING: 'info',
  ISSUE_PENDING: 'info',
  ISSUE_UNKNOWN: 'info',
  REFUND_PENDING: 'info',
  SCHEDULED: 'info',
  IN_PROGRESS: 'info',
  ACTIVE: 'success',
  APPROVED: 'success',
  CONFIRMED: 'success',
  COMPLETED: 'success',
  DONE: 'success',
  EFFECTIVE: 'success',
  EXECUTED: 'success',
  ISSUED: 'success',
  PAID: 'success',
  SETTLED: 'success',
  SUCCESS: 'success',
  REFUND_CONFIRMED: 'success',
  REJECTED: 'danger',
  FAILED: 'danger',
  ERROR: 'danger',
  DENIED: 'danger',
  EXPIRED: 'danger',
  ISSUE_FAILED: 'danger',
})

export const STATUS_TONE_NAMES = Object.freeze(['neutral', 'info', 'success', 'warning', 'danger'])

// statusTone 把业务状态归一为共享色调；未知值保持 neutral，调用方可显式传 tone 覆盖。
// 参数：status 为状态码；fallback 为未知状态的回退 tone。
// 返回值：五个语义 tone 之一。
export function statusTone(status, fallback = 'neutral') {
  const key = String(status ?? '').trim().toUpperCase()
  if (STATUS_TONES[key]) return STATUS_TONES[key]
  return STATUS_TONE_NAMES.includes(fallback) ? fallback : 'neutral'
}
