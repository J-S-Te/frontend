function commandSignature(customerID, reason) {
  return JSON.stringify({ customer_id: Number(customerID), reason: String(reason || '').trim() })
}

/**
 * 停用 Portal 访问会跨越 CRM 与 Portal 的身份边界。响应未知时保留原命令键，
 * 防止管理员重复点击产生两次停用审计或重复下游调用；成功后才释放。
 */
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
