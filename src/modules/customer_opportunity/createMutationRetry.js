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
 * Retains every outcome-ambiguous create command for this page lifetime.
 * Entries are removed only after the server confirms success; no key is
 * written to browser storage, URLs, or the request body.
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

  // Mark immediately before the real create request. A later retry may bypass
  // the advisory duplicate precheck only when this exact canonical command was
  // actually sent and its outcome is still unknown. Validation/precheck errors
  // therefore never masquerade as an ambiguous server result.
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
