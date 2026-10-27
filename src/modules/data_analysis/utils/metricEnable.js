// 指标启用阻断原因的展示映射。原因码由后端 enable_block_reason 计算，
// 这里只负责把原因码翻译成可操作提示，不参与启用判定与权限判断。
// 后端尚未返回该字段时，按指标来源给出兼容提示；不复制服务端启用判定。
const CUSTOM_TEXT = '自定义指标未接入受控计算执行器，当前只能维护口径。'
const LEGACY_TEXT = '该指标未接入受控计算执行器或口径未匹配发布版本，不能启用。'
const FALLBACK_TEXT = '未绑定可用计算能力或口径不匹配，不能启用。'

export function metricEnableBlockText(metric) {
  const reason = String(metric?.enable_block_reason || '')
  const custom = metric?.origin === 'CUSTOM'
  if (reason === 'METRIC_STATUS_UNCONFIRMED') return '口径状态未确认；确认后方可恢复计算绑定。'
  if (reason === 'CALCULATION_DEFINITION_DRIFT') return '口径已偏离内置发布版本；恢复发布口径后可重新启用。'
  if (reason === 'CALCULATION_BINDING_MISSING') {
    return custom ? CUSTOM_TEXT : '该指标尚未接入受控计算执行器。'
  }
  if (!reason) return custom ? CUSTOM_TEXT : LEGACY_TEXT
  return FALLBACK_TEXT
}

export function enableableMetricLabels(metrics) {
  return (Array.isArray(metrics) ? metrics : [])
    .filter((metric) => metric?.can_enable)
    .map((metric) => `${metric.code} ${metric.name}`.trim())
}

export function enableableMetricSummary(metrics) {
  const labels = enableableMetricLabels(metrics)
  return labels.length ? labels.join('、') : '暂无'
}
