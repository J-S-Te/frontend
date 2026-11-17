// 状态胶囊的语义词表：全平台只认五档（neutral / processing / success / warning / danger）。
// 各模块的历史映射仍可能输出 amber / blue / violet / purple / 风险 等旧名，
// 统一在这里归一，避免同一语义在不同模块落成两种颜色。
export const STATUS_TONES = Object.freeze(['neutral', 'processing', 'success', 'warning', 'danger'])

// 旧名 → 五档；violet 不再表示状态，历史数据落到 processing。
export const LEGACY_STATUS_TONES = Object.freeze({
  amber: 'warning',
  orange: 'warning',
  yellow: 'warning',
  关注: 'warning',
  待确认: 'warning',
  blue: 'processing',
  sky: 'processing',
  info: 'processing',
  violet: 'processing',
  purple: 'processing',
  indigo: 'processing',
  red: 'danger',
  risk: 'danger',
  high: 'danger',
  风险: 'danger',
  green: 'success',
  normal: 'success',
  success: 'success',
  gray: 'neutral',
  grey: 'neutral',
  slate: 'neutral',
  neutral: 'neutral',
})

// normalizeStatusTone 把任意历史色调名收敛到五档。
// 参数：tone 为映射表输出的色调名，fallback 为无法识别时的兜底。
// 返回值：STATUS_TONES 之一。
export function normalizeStatusTone(tone, fallback = 'neutral') {
  const key = String(tone ?? '').trim()
  if (!key) return fallback
  if (STATUS_TONES.includes(key)) return key
  return LEGACY_STATUS_TONES[key] || LEGACY_STATUS_TONES[key.toLowerCase()] || fallback
}

// resolveStatusTone 按“域映射表 → 五档”取色，未命中的状态一律中性，不臆测语义。
// 参数：map 为域内状态词表，code 为状态码或中文状态，fallback 为兜底。
// 返回值：STATUS_TONES 之一。
export function resolveStatusTone(map, code, fallback = 'neutral') {
  const key = String(code ?? '').trim()
  if (!key || !map) return fallback
  return normalizeStatusTone(map[key], fallback)
}
