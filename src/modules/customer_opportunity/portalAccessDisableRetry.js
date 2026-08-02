function commandSignature(customerID, reason) {
  return JSON.stringify({ customer_id: Number(customerID), reason: String(reason || '').trim() })
}

/** Retains an outcome-ambiguous administrative disable command in memory. */
export function createPortalAccessDisableRetryState(createKey) {
  const pending = new Map()
  function keyFor(customerID, reason) {
    const signature = commandSignature(customerID, reason)
    if (!pending.has(signature)) pending.set(signature, createKey())
    return { key: pending.get(signature), signature }
  }
  function confirmSuccess(signature, key) {
    if (pending.get(signature) === key) pending.delete(signature)
  }
  return { keyFor, confirmSuccess }
}
