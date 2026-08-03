function text(value) {
  return String(value ?? '').trim()
}

function normalizeCustomer(payload) {
  return {
    name: text(payload?.name),
    unified_credit_code: text(payload?.unified_credit_code),
    customer_type: text(payload?.customer_type),
    industry: text(payload?.industry),
    region: text(payload?.region),
    owner_user_id: text(payload?.owner_user_id),
    owner_org_id: text(payload?.owner_org_id),
    contacts: (payload?.contacts || []).map((item) => ({
      name: text(item?.name),
      phone: text(item?.phone),
      email: text(item?.email),
      is_registration: Boolean(item?.is_registration),
    })),
    duplicate_override: Boolean(payload?.duplicate_override),
    duplicate_override_reason: text(payload?.duplicate_override_reason),
    reason: text(payload?.reason),
  }
}

function normalizeOpportunity(payload) {
  return {
    name: text(payload?.name),
    customer_id: Number(payload?.customer_id),
    type: text(payload?.type),
    source: text(payload?.source),
    expected_amount: text(payload?.expected_amount),
    expected_sign_date: text(payload?.expected_sign_date),
    requirement_summary: text(payload?.requirement_summary),
    system_count: Number(payload?.system_count || 0),
    pain_points: text(payload?.pain_points),
    competitor_info: text(payload?.competitor_info),
    owner_user_id: text(payload?.owner_user_id),
    owner_org_id: text(payload?.owner_org_id),
  }
}

export function normalizeCreateMutationPayload(operation, payload) {
  if (operation === 'customer') return normalizeCustomer(payload)
  if (operation === 'opportunity') return normalizeOpportunity(payload)
  throw new Error(`Unsupported create mutation: ${operation}`)
}

/**
 * 在当前页面生命周期内保留所有结果不确定的创建命令。只有服务端明确返回成功
 * 才释放键；键不会进入浏览器存储、URL 或请求体，既避免刷新后误重放，也避免
 * 把幂等凭据暴露到历史记录和日志。
 */
export function createCreateMutationRetryState(createKey) {
  const entries = new Map()
  const signaturesByKey = new Map()

  function keyFor(operation, payload) {
    const normalizedPayload = normalizeCreateMutationPayload(operation, payload)
    const signature = JSON.stringify({ operation, payload: normalizedPayload })
    const prior = entries.get(signature)
    if (prior) return { key: prior.key, payload: normalizedPayload, attempted: prior.attempted }
    const value = { key: createKey(), operation, signature, attempted: false }
    entries.set(signature, value)
    signaturesByKey.set(value.key, signature)
    return { key: value.key, payload: normalizedPayload, attempted: false }
  }

  // 仅在真实创建请求发出前标记 attempted。后续重试只有在“同一规范化命令
  // 确实已发送但结果未知”时才能跳过提示性的重复预检；本地校验或预检失败
  // 不能伪装成服务端结果不确定。
  function markAttempted(operation, key) {
    const signature = signaturesByKey.get(key)
    const value = signature ? entries.get(signature) : null
    if (!value || value.operation !== operation || value.key !== key) return false
    value.attempted = true
    return true
  }

  function confirmSuccess(operation, key) {
    const signature = signaturesByKey.get(key)
    const value = signature ? entries.get(signature) : null
    if (!value || value.operation !== operation || value.key !== key) return
    entries.delete(signature)
    signaturesByKey.delete(key)
  }

  return { keyFor, markAttempted, confirmSuccess }
}
