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
 * 按后端幂等摘要的字段规则规范化命令。日期、枚举、工时小数及执行人顺序
 * 都必须先归一化，否则语义相同的重试会得到不同签名，导致服务端无法识别
 * 已经执行过的命令。规范化结果只驻留当前页面内存，不写入浏览器持久存储。
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
  // 网络中断时无法判断服务端是否已提交，因此页面生命周期内要保留每条结果
  // 不确定命令。后续不同任务或不同载荷不能挤掉旧键，否则旧命令若已落库，
  // 使用新键重发会造成重复审批、分配或工时记录。
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
