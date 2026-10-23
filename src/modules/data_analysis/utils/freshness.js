// 数据看板时间口径：source_updated_at（源业务数据最后更新）、
// synced_at（最近一次成功同步或持久快照写入）、computed_at（本次查询计算）
// 是三个独立事实，展示层不得把 computed_at 标成“数据更新时间”。
const STATUS_LABELS = Object.freeze({
  SUCCESS: '同步正常',
  FAILED: '同步失败',
  RUNNING: '同步中',
  PENDING: '待首次同步',
  SNAPSHOT: '持久快照',
  UNKNOWN: '同步状态未知',
})

function text(value) {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * formatDashboardTimestamp 按本地时区展示后端时间戳。
 * 兼容 RFC3339（带 Z）与 MySQL DATETIME 文本；无法解析时原样返回，不伪造时间。
 * @param {unknown} value 后端时间字段。
 * @returns {string} 展示文本；空值返回空字符串。
 */
export function formatDashboardTimestamp(value) {
  const raw = text(value)
  if (!raw) return ''
  const normalized = raw.includes('T') ? raw : raw.replace(' ', 'T')
  const date = new Date(normalized)
  if (Number.isNaN(date.getTime())) return raw
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date)
}

/**
 * normalizeDashboardFreshness 归一化后端 freshness 字段，缺省时保持“未知”，
 * 不用当前浏览器时间补齐任何数据时间。
 * @param {object|null} summary 看板摘要响应。
 * @returns {object} 归一化后的时间口径。
 */
export function normalizeDashboardFreshness(summary) {
  const raw = summary && typeof summary === 'object' && summary.freshness && typeof summary.freshness === 'object'
    ? summary.freshness
    : null
  const status = (text(raw?.sync_status) || 'UNKNOWN').toUpperCase()
  return {
    present: Boolean(raw),
    sourceUpdatedAt: text(raw?.source_updated_at),
    syncedAt: text(raw?.synced_at),
    computedAt: text(raw?.computed_at),
    syncStatus: raw ? status : 'UNKNOWN',
    stale: Boolean(raw?.stale),
    staleReason: text(raw?.stale_reason),
    legacySnapshotAt: text(summary?.snapshot_at),
  }
}

/**
 * dashboardFreshnessStatus 生成数据状态徽标文案；陈旧数据保留展示但显式标注。
 * @param {object|null} summary 看板摘要响应。
 * @returns {{present:boolean,label:string,stale:boolean,reason:string}} 状态展示信息。
 */
export function dashboardFreshnessStatus(summary) {
  const freshness = normalizeDashboardFreshness(summary)
  if (!freshness.present) {
    // 旧响应没有 freshness：snapshot_at 只能表述为快照时间，不能冒充数据更新时间。
    const snapshot = formatDashboardTimestamp(freshness.legacySnapshotAt)
    return {
      present: false,
      stale: false,
      reason: '',
      label: snapshot ? `快照于 ${snapshot}` : '暂无聚合快照',
      badge: '',
    }
  }
  const statusLabel = STATUS_LABELS[freshness.syncStatus] || STATUS_LABELS.UNKNOWN
  return {
    present: true,
    stale: freshness.stale,
    reason: freshness.staleReason,
    label: `数据状态：${statusLabel}${freshness.stale ? '（可能已过期）' : ''}`,
    // 持久快照分支不声明“同步正常”：只说明它是持久化快照，避免过度承诺新鲜度。
    badge: freshness.stale ? '数据可能已过期' : (freshness.syncStatus === 'SNAPSHOT' ? '持久化快照' : '同步正常'),
  }
}

/**
 * dashboardFreshnessItems 返回三个时间口径的展示项；顺序与含义固定。
 * @param {object|null} summary 看板摘要响应。
 * @param {(value: unknown) => string} formatTimestamp 时间格式化函数，便于测试注入。
 * @returns {Array<{key:string,label:string,value:string}>} 时间口径展示项。
 */
export function dashboardFreshnessItems(summary, formatTimestamp = formatDashboardTimestamp) {
  const freshness = normalizeDashboardFreshness(summary)
  if (!freshness.present) return []
  return [
    { key: 'source_updated_at', label: '源数据更新', value: formatTimestamp(freshness.sourceUpdatedAt) || '来源未提供更新时间' },
    { key: 'synced_at', label: '最近成功同步', value: formatTimestamp(freshness.syncedAt) || '无成功同步记录' },
    { key: 'computed_at', label: '本次查询计算', value: formatTimestamp(freshness.computedAt) || '本次请求' },
  ]
}
