// 用途：根据父服务项生命周期限制专项写入及开展结论变更。
// 参数：item 为父服务项，operation 为 decision 时进一步限制现场完成后的结论变更。
// 返回值：允许写入时返回 true，已归档、终止或必须先返工时返回 false。
export function penetrationParentAllows(item, operation = 'mutate') {
  if (!item || item.archived_at || item.status === '已终止' || item.report_status === 'ARCHIVED') return false
  return operation !== 'decision' || item.status !== '现场实施完成'
}
