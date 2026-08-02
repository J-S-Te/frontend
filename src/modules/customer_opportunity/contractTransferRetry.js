export function createContractTransferRetryState(createKey) {
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
