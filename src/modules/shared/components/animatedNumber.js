// 大系统指标数字的统一解析/格式化：只对纯数字（含千分位、正负小数）做动画，
// 带单位或复合文案（如 "12.5万"、"3 / 4"）保持原样，避免动画把业务文案改错。
export function parseMetricValue(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string') return null
  const normalized = value.trim().replace(/,/g, '')
  if (!/^-?\d+(?:\.\d+)?$/.test(normalized)) return null
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : null
}

export function formatMetricNumber(value, { decimals = 0 } = {}) {
  if (!Number.isFinite(value)) return ''
  return new Intl.NumberFormat('zh-CN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value)
}

// 与原型 A 一致：1 - (1-p)^3，800ms 缓出。
export function easeOutCubic(progress) {
  const p = Math.min(Math.max(progress, 0), 1)
  return 1 - Math.pow(1 - p, 3)
}
