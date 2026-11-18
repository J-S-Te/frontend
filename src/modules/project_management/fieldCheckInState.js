// 用途：汇总本次定位、待同步作业和服务端已有证据，避免刷新或其他作业结果冒充本次签到成功。
// 参数：itemID、ownerKey 为当前操作身份，state 为本次反馈，pending 为当前签到队列项，snapshot 为服务端证据，error 为证据读取失败原因。
// 返回值：可显示的签到状态；没有可信结果时返回 null。
export function resolveFieldCheckInState({ itemID, ownerKey, state, pending, snapshot, error } = {}) {
  if (!itemID || !ownerKey) return null
  const current = state?.itemID === itemID && state.ownerKey === ownerKey ? state : null
  if (current && ['locating', 'submitting', 'error'].includes(current.phase)) return current
  if (pending?.itemID === itemID && pending.ownerKey === ownerKey) {
    const coords = { latitude: pending.payload?.latitude, longitude: pending.payload?.longitude, accuracy: pending.payload?.accuracy_meters }
    return { phase: 'pending', message: `签到已保存在本机，尚未确认成功。${pending.lastError || '联网后将自动同步，也可点击重试同步。'}`,
      position: Object.values(coords).every(Number.isFinite) ? { coords, timestamp: Date.parse(pending.capturedAt) } : undefined }
  }
  if (current) return current
  if (!error && snapshot?.itemID === itemID && (!snapshot.ownerKey || snapshot.ownerKey === ownerKey)) {
    const evidence = snapshot.evidence?.find(entry => entry.type === 'FIELD_CHECKED_IN')
    if (evidence) return { phase: 'recorded', message: `服务端已有 GPS 签到记录。${evidence.summary || ''}`, capturedAt: evidence.capturedAt }
  }
  return null
}
