// 报告阶段码的唯一前端展示词表：与 project_management/internal/domain/project_status.go
// 的 reportPhaseLabels 保持同一口径。码值由后端派生，前端只做展示，不据此推断阶段。
export const REPORT_STAGE_LABELS = Object.freeze({
  NONE: '待整改',
  RECTIFYING: '整改中',
  COMPILING: '编制中',
  REVIEWED: '已审核',
  ISSUED: '已签发',
  ARCHIVED: '已归档',
})

// 用途：把 report_stage 码转成中文；空值返回调用方给的兜底文案，未知码原样返回便于排查。
// 参数：value 为后端阶段码；fallback 为空值时的展示文案。
// 返回值：中文阶段名、未知码或兜底文案。
export function reportStageLabel(value, fallback = '') {
  const code = String(value ?? '').trim().toUpperCase()
  if (!code) return fallback
  return REPORT_STAGE_LABELS[code] || code
}
