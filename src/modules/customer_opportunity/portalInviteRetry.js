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

/**
 * validatePortalInviteResult 校验创建邀请响应中仅本次可见的一次性激活链接。
 *
 * 链接是 Bearer 凭证：CRM 不能用状态查询接口补取它。因此只有确认响应携带
 * 有效激活链接后，调用方才能清除页面内存中的幂等键并提示操作成功。
 *
 * @param {unknown} result 创建邀请接口已解包的响应数据。
 * @returns {string} 可安全交付给当前页面展示的激活链接；无效时返回空字符串。
 */
export function validatePortalInviteResult(result) {
  const rawURL = typeof result?.activation_url === 'string' ? result.activation_url.trim() : ''
  if (!rawURL) return ''

  try {
    const value = new URL(rawURL)
    if (!['http:', 'https:'].includes(value.protocol)) return ''
    if (value.pathname !== '/customer-portal/activate' || !value.searchParams.get('token')) return ''
    return value.toString()
  } catch {
    return ''
  }
}
