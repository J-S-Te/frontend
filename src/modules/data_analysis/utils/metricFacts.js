const sections = ['contract', 'project', 'report', 'finance']
const sources = { contract: 'contract_management', project: 'project_management',
  report: 'project_management', finance: 'settlement' }
const buckets = ['LT_80', 'FROM_80_TO_90', 'FROM_90_TO_100', 'AT_100', 'GT_100']

// isMetricRecord 识别普通数据对象，避免数组或null被当成完整指标。
// 参数：value为接口值。
// 返回值：非数组对象时为true。
function isMetricRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

// metricCount 校验次数与分钟为非负安全整数。
// 参数：value为来源指标。
// 返回值：能够精确表示的非负整数时为true。
function metricCount(value) {
  return Number.isSafeInteger(value) && value >= 0
}

// validMetricRatio 验证分母与可空百分比一致，零分母不能伪造零率。
// 参数：numerator/denominator为明确计数，rate为服务端百分比或null。
// 返回值：分子分母及比率一致时为true。
function validMetricRatio(numerator, denominator, rate) {
  if (!metricCount(numerator) || !metricCount(denominator) || numerator > denominator) return false
  return denominator === 0 ? rate === null : typeof rate === 'number' && Number.isFinite(rate)
    && Math.abs(rate - (100 * numerator / denominator)) < 0.000001
}

// validResourceFacts 验证已确认分钟、明确容量以及待审未知计数。
// 参数：value为一种资源的汇总。
// 返回值：完整且比率自洽时为true。
function validResourceFacts(value) {
  return isMetricRecord(value) && validMetricRatio(value.actual_minutes, value.capacity_minutes, value.rate)
    && metricCount(value.pending) && metricCount(value.unknown)
}

// validMetricFactsSummary 校验新增指标完整响应，拒绝空对象与非精确金额。
// 参数：value为分区指标摘要，不包含来源原始明细。
// 返回值：明确未发布或完整可用摘要符合契约时为true。
export function validMetricFactsSummary(value) {
  if (!isMetricRecord(value) || !sections.includes(value.section) || typeof value.available !== 'boolean'
    || typeof value.stale !== 'boolean' || typeof value.stale_reason !== 'string') return false
  if (!value.available) return value.stale === true && value.stale_reason.length > 0
  if (value.source_code !== sources[value.section] || typeof value.basis !== 'string' || !value.basis
    || !Number.isFinite(Date.parse(value.snapshot_at)) || value.stale && !value.stale_reason
    || Object.hasOwn(value, 'rows')) return false
  if (value.section === 'contract') {
    return metricCount(value.discount_known) && metricCount(value.discount_unknown)
      && isMetricRecord(value.discount_buckets) && Object.entries(value.discount_buckets)
        .every(([key, count]) => buckets.includes(key) && metricCount(count))
      && Object.values(value.discount_buckets).reduce((sum, count) => sum + count, 0) === value.discount_known
  }
  if (value.section === 'project') return validResourceFacts(value.person) && validResourceFacts(value.equipment)
  if (value.section === 'report') {
    return validMetricRatio(value.first_passed, value.first_reviewed, value.first_pass_rate)
      && ['pending', 'unknown', 'returned_decisions', 'returned_reports'].every(key => metricCount(value[key]))
      && value.returned_reports <= value.returned_decisions && isMetricRecord(value.return_reason_counts)
      && Object.values(value.return_reason_counts).every(metricCount)
      && Object.values(value.return_reason_counts).reduce((sum, count) => sum + count, 0) === value.returned_decisions
  }
  return validFinanceFacts(value)
}

// validFinanceFacts 验证原币种有符号确认净额及安全成本维度。
// 参数：value为财务新增指标摘要。
// 返回值：币种唯一、金额精确且待审异常计数完整时为true。
function validFinanceFacts(value) {
  const fields = ['income_minor', 'cost_minor', 'income_tax_minor', 'cost_tax_minor',
    'spend_minor', 'prepayment_minor']
  return metricCount(value.pending) && metricCount(value.conflicts)
    && Array.isArray(value.currencies) && new Set(value.currencies.map(row => row?.currency)).size === value.currencies.length
    && value.currencies.every(row => isMetricRecord(row) && /^[A-Z]{3}$/.test(row.currency)
      && fields.every(key => Number.isSafeInteger(row[key])))
    && Array.isArray(value.cost_dimensions) && value.cost_dimensions.every(row => isMetricRecord(row)
      && ['organization', 'identity', 'project'].includes(row.dimension) && typeof row.id === 'string'
      && typeof row.name === 'string' && /^[A-Z]{3}$/.test(row.currency) && Number.isSafeInteger(row.amount_minor))
}

// formatFactMoney 按整数分精确格式化金额，保留大额尾分和真实冲回负号。
// 参数：value为有符号最小币种单位整数。
// 返回值：两位小数的金额文本；未知或不安全金额为破折号。
export function formatFactMoney(value) {
  if (!Number.isSafeInteger(value)) return '—'
  const minor = BigInt(value)
  const absolute = minor < 0n ? -minor : minor
  return `${minor < 0n ? '-' : ''}${(absolute / 100n).toLocaleString('zh-CN')}.${String(absolute % 100n).padStart(2, '0')}`
}

// formatFactRate 显示明确百分比，未有分母保留不可计算状态。
// 参数：value为服务端百分比或null。
// 返回值：两位小数百分比，未知时破折号。
export function formatFactRate(value) {
  return typeof value === 'number' && Number.isFinite(value) ? `${value.toFixed(2)}%` : '—'
}
