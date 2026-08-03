export function createContractTransferRetryState(createKey) {
  // 转合同命令同时受商机版本约束。签名必须包含版本和原因：同版本同原因是重试，
  // 版本推进或修改原因则是新命令，不能误用旧幂等结果。
  const pending = new Map()
  return {
    keyFor(opportunityID, payload) {
      const normalized = { version: Number(payload?.version), reason: String(payload?.reason || '').trim() }
      const coordinate = `${Number(opportunityID)}\u0000${JSON.stringify(normalized)}`
      if (!pending.has(coordinate)) pending.set(coordinate, createKey())
      return { key: pending.get(coordinate), payload: normalized, coordinate }
    },
    confirmSuccess(coordinate, key) {
      if (pending.get(coordinate) === key) pending.delete(coordinate)
    },
  }
}
