/**
 * historyAmount 将服务器安全范围内的分值按原币种显示为两位金额。
 * 参数：minor为历史原金额分值，不合并币种或隐式舍入。
 * 返回值：精确金额字符串；不安全或无效值要求核对权威台账。
 */
export function historyAmount(minor) {
  if (!Number.isSafeInteger(minor)) return '金额超出安全显示范围，请核对权威台账'
  const value = BigInt(minor), abs = value < 0n ? -value : value
  return `${value < 0n ? '-' : ''}${abs / 100n}.${String(abs % 100n).padStart(2, '0')}`
}

/**
 * historyAvailability 将实际发布状态转换为不掩盖缺失或陈旧的提示。
 * 参数：result为历史查询响应，未读取为null。
 * 返回值：中文数据状态说明，不以空列表代替成功记录。
 */
export function historyAvailability(result) {
  if (!result) return '尚未读取历史统计。'
  if (result.sync_status === 'UNKNOWN' || !result.synced_at) return '尚无成功发布记录；统计未知。'
  if (result.stale || result.sync_status !== 'SUCCESS') return '上次历史结果已陈旧，当前同步未完成或失败，请核对发布水位。'
  return '历史独立分栏已成功发布，以下按当前授权范围展示。'
}
