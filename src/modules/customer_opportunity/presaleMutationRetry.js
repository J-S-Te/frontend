function normalizedVersion(value) {
  return Number(value)
}

function compareUnicodeCodePoints(left, right) {
  const leftPoints = Array.from(left, (value) => value.codePointAt(0))
  const rightPoints = Array.from(right, (value) => value.codePointAt(0))
  const count = Math.min(leftPoints.length, rightPoints.length)
  for (let index = 0; index < count; index += 1) {
    if (leftPoints[index] !== rightPoints[index]) return leftPoints[index] - rightPoints[index]
  }
  return leftPoints.length - rightPoints.length
}

function normalizeAssignees(values) {
  return (values || [])
    .map((item) => ({
      person_id: String(item?.person_id || '').trim(),
      role: String(item?.role || '').trim(),
    }))
    .sort((left, right) => compareUnicodeCodePoints(left.person_id, right.person_id) || compareUnicodeCodePoints(left.role, right.role))
}

function normalizeDateTime(value) {
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? String(value || '').trim() : parsed.toISOString()
}

function normalizeWorklogDecimal(value) {
  const raw = String(value ?? '')
  if (!/^(?:0|[1-9]\d{0,7})(?:\.\d{1,2})?$/.test(raw)) return raw
  const [whole, fraction = ''] = raw.split('.')
  return `${whole}.${fraction.padEnd(2, '0')}`
}

/**
 * Normalizes the fields used by the backend mutation digest. This state stays
 * in memory and never crosses into browser storage.
 */
export function normalizePresaleMutationPayload(operation, payload) {
  if (operation === 'create') {
    return {
      opportunity_id: Number(payload?.opportunity_id),
      venue: String(payload?.venue || '').trim().toUpperCase(),
      service_address: String(payload?.service_address || '').trim(),
      contact_name: String(payload?.contact_name || '').trim(),
      contact_phone: String(payload?.contact_phone || '').trim(),
      description: String(payload?.description || '').trim(),
      expected_start: normalizeDateTime(payload?.expected_start),
      expected_end: normalizeDateTime(payload?.expected_end),
      urgency: String(payload?.urgency || '').trim().toUpperCase(),
    }
  }
  if (operation === 'approval') {
    return {
      action: String(payload?.action || '').trim().toUpperCase(),
      comment: String(payload?.comment || '').trim(),
      version: normalizedVersion(payload?.version),
    }
  }
  if (operation === 'assignment') {
    return {
      assignees: normalizeAssignees(payload?.assignees),
      change_reason: String(payload?.change_reason || '').trim(),
      version: normalizedVersion(payload?.version),
    }
  }
  if (operation === 'cancel') {
    return {
      reason: String(payload?.reason || '').trim(),
      version: normalizedVersion(payload?.version),
    }
  }
  if (operation === 'worklog') {
    return {
      work_start: normalizeDateTime(payload?.work_start),
      work_end: normalizeDateTime(payload?.work_end),
      raw_unit: String(payload?.raw_unit ?? ''),
      raw_value: normalizeWorklogDecimal(payload?.raw_value),
      work_site_address: String(payload?.work_site_address || '').trim(),
      work_content: String(payload?.work_content ?? ''),
      remark: String(payload?.remark || '').trim(),
      version: normalizedVersion(payload?.version),
    }
  }
  throw new Error(`Unsupported presale mutation: ${operation}`)
}

export function createPresaleMutationRetryState(createKey) {
  // Keep every outcome-ambiguous command for this page lifetime. A later
  // command with a different task or payload must not evict an earlier key:
  // the earlier command may already have committed while its response was
  // lost, and reusing a newly generated key would enqueue it twice.
  const entriesBySignature = new Map()
  const signaturesByKey = new Map()

  function keyFor(operation, requestID, payload) {
    const normalizedPayload = normalizePresaleMutationPayload(operation, payload)
    const signature = JSON.stringify({ request_id: String(requestID), operation, payload: normalizedPayload })
    const previous = entriesBySignature.get(signature)
    if (previous) return { key: previous.key, payload: normalizedPayload, attempted: previous.attempted }

    const next = { key: createKey(), signature, operation, requestID: String(requestID), attempted: false }
    entriesBySignature.set(signature, next)
    signaturesByKey.set(next.key, signature)
    return { key: next.key, payload: normalizedPayload, attempted: false }
  }

  function markAttempted(operation, requestID, key) {
    const signature = signaturesByKey.get(key)
    const current = signature ? entriesBySignature.get(signature) : null
    if (current?.operation !== operation || current?.requestID !== String(requestID) || current?.key !== key) return false
    current.attempted = true
    return true
  }

  function confirmSuccess(operation, requestID, key) {
    const signature = signaturesByKey.get(key)
    const current = signature ? entriesBySignature.get(signature) : null
    if (current?.operation !== operation || current?.requestID !== String(requestID) || current?.key !== key) return
    entriesBySignature.delete(signature)
    signaturesByKey.delete(key)
  }

  return { keyFor, markAttempted, confirmSuccess }
}
