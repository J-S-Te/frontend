function normalizedContact(contact) {
  return {
    id: Number(contact?.id || 0),
    name: String(contact?.name || '').trim(),
    phone: String(contact?.phone || '').trim(),
    email: String(contact?.email || '').trim().toLowerCase(),
    is_registration: Boolean(contact?.is_registration),
  }
}

/**
 * Portal 开通是跨系统 Saga：CRM 建立映射、Portal 创建身份并发出邀请可能已经
 * 部分成功，而浏览器只看到超时。相同客户和联系人必须复用原幂等键，直到 CRM
 * 明确确认整条 Saga 成功；键仅保存在页面内存中。
 */
export function createPortalInviteRetryState(createKey) {
  const pending = new Map()

  function keyFor(customerID, contact) {
    const command = { customer_id: Number(customerID), contact: normalizedContact(contact) }
    const signature = JSON.stringify(command)
    if (!pending.has(signature)) pending.set(signature, createKey())
    return { key: pending.get(signature), signature, command }
  }

  function confirmSuccess(signature, key) {
    if (pending.get(signature) === key) pending.delete(signature)
  }

  return { keyFor, confirmSuccess }
}
