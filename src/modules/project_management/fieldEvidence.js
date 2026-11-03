// 现场完成缺项判定（BIZ-PROJECT-06）的前端口径：状态推导与展示文案集中在这里，
// 视图、测试共用同一套判定，避免"窗口内没看到事件就算缺项"的旧逻辑回流。
//
// 后端口径（project_management）：
//   GET /service-items/:id/field-evidence →
//     { service_item_id, gaps:[事件类型码], missing:[中文名], evidence:[...],
//       evidence_complete, state, gate_policy, scanned_events }
// 判定按该服务项的**完整事件流**计算，不再是"租户最近 500 条事件"的窗口近似。
//
// 前端只消费服务端结论，并且三条硬约束：
//   1. 没有可用的判定结果（未拉取/拉取失败/服务项不匹配）→ 状态"未知"，完成动作必须拒绝；
//   2. 存在未同步的现场操作 → 状态"待同步"，同样拒绝完成（否则窗口误判换个形式重演）；
//   3. 只有 ready 才允许据此展示缺项、放行完成；"未知"绝不能被当成"证据齐全"。

/** 判定状态：未选中服务项。 */
export const FIELD_EVIDENCE_STATUS_NONE = 'none'
/** 判定状态：服务端判定不可用（未拉取 / 拉取失败）。未知不等于齐全。 */
export const FIELD_EVIDENCE_STATUS_UNKNOWN = 'unknown'
/** 判定状态：仍有未同步的现场操作，判定基于旧证据链，不能用来完成。 */
export const FIELD_EVIDENCE_STATUS_PENDING = 'pending'
/** 判定状态：服务端已给出判定，可据此展示缺项与放行完成。 */
export const FIELD_EVIDENCE_STATUS_READY = 'ready'

/** 三类必备现场证据的事件类型与中文名（顺序与后端一致，仅作缺字段兜底展示）。 */
export const FIELD_EVIDENCE_TYPES = [
  { type: 'FIELD_CHECKED_IN', label: 'GPS 签到' },
  { type: 'FIELD_RECORD_SUBMITTED', label: '现场记录' },
  { type: 'FIELD_SIGNATURE_CAPTURED', label: '电子签名' },
]

/**
 * fieldEvidenceTypeLabel 把事件类型码翻译成展示名。
 * 服务端会同时给出 missing 中文名，这里只是缺字段时的兜底。
 * @param {string} type 事件类型码。
 * @returns {string} 中文展示名，未知类型回退类型码本身。
 */
export function fieldEvidenceTypeLabel(type) {
  const code = String(type || '').trim()
  const known = FIELD_EVIDENCE_TYPES.find((item) => item.type === code)
  return known ? known.label : code
}

/**
 * normalizeServiceItemFieldEvidence 把服务端响应归一成视图状态。
 * 结构不合法（缺少服务项标识）视为不可用，返回 null，让视图走"未知"分支。
 * @param {object|null|undefined} payload 服务端响应体。
 * @param {string} [fallbackItemID=''] 请求时使用的服务项 ID。
 * @returns {{itemID: string, gaps: string[], missing: string[], evidence: object[], evidenceComplete: boolean, state: string, gatePolicy: string, scannedEvents: number}|null} 归一后的判定。
 */
export function normalizeServiceItemFieldEvidence(payload, fallbackItemID = '') {
  if (!payload || typeof payload !== 'object') return null
  const itemID = String(payload.service_item_id || fallbackItemID || '').trim()
  if (!itemID) return null
  const gaps = (Array.isArray(payload.gaps) ? payload.gaps : []).map((gap) => String(gap || '').trim()).filter(Boolean)
  const missing = (Array.isArray(payload.missing) ? payload.missing : []).map((label) => String(label || '').trim()).filter(Boolean)
  const evidence = (Array.isArray(payload.evidence) ? payload.evidence : [])
    .map((entry) => ({
      type: String(entry?.type || '').trim(),
      label: String(entry?.label || '').trim() || fieldEvidenceTypeLabel(entry?.type),
      eventID: String(entry?.event_id || '').trim(),
      capturedAt: String(entry?.captured_at || '').trim(),
      fileRef: String(entry?.file_ref || '').trim(),
      summary: String(entry?.summary || '').trim(),
    }))
    .filter((entry) => entry.type)
  return {
    itemID,
    gaps,
    // 服务端没给中文名时按类型码兜底，保证界面永远能说清"缺什么"。
    missing: missing.length ? missing : gaps.map(fieldEvidenceTypeLabel),
    evidence,
    evidenceComplete: payload.evidence_complete === true,
    state: String(payload.state || '').trim(),
    gatePolicy: String(payload.gate_policy || '').trim(),
    scannedEvents: Number(payload.scanned_events) || 0,
  }
}

/**
 * resolveFieldEvidenceVerdict 推导当前服务项的缺项判定与完成放行结论。
 * @param {object} input 输入。
 * @param {string} [input.itemID=''] 当前选中的服务项 ID。
 * @param {object|null} [input.snapshot=null] 已拉取的服务端判定（normalize 后）。
 * @param {string} [input.error=''] 最近一次拉取的错误信息。
 * @param {number} [input.pendingSyncCount=0] 本地未同步的现场操作条数。
 * @param {boolean} [input.loading=false] 是否正在拉取判定。
 * @returns {{status: string, gaps: string[], missing: string[], evidence: object[], evidenceComplete: boolean, blockReason: string, label: string}} 判定结论。
 */
export function resolveFieldEvidenceVerdict({ itemID = '', snapshot = null, error = '', pendingSyncCount = 0, loading = false } = {}) {
  const empty = { gaps: [], missing: [], evidence: [], evidenceComplete: false }
  const target = String(itemID || '').trim()
  if (!target) return { ...empty, status: FIELD_EVIDENCE_STATUS_NONE, blockReason: '', label: '未选择服务项' }

  if (Number(pendingSyncCount) > 0) {
    return {
      ...empty,
      status: FIELD_EVIDENCE_STATUS_PENDING,
      blockReason: '仍有现场签到、记录或签名未同步，缺项判定以服务端为准；请先联网补传后再确认完成。',
      label: `待同步（${Number(pendingSyncCount)} 条现场操作未同步）`,
    }
  }

  const usable = snapshot && String(snapshot.itemID || '').trim() === target && !error
  if (!usable) {
    const reason = String(error || '').trim()
    return {
      ...empty,
      status: FIELD_EVIDENCE_STATUS_UNKNOWN,
      blockReason: reason
        ? `缺项判定读取失败（${reason}），无法确认证据是否齐全；请重新读取后再完成。`
        : loading
          ? '正在读取服务端缺项判定，尚未确认证据是否齐全；请稍候再完成。'
          : '尚未取得服务端缺项判定，无法确认证据是否齐全；请重新读取后再完成。',
      label: reason ? `未知（${reason}）` : loading ? '未知（读取中）' : '未知（未读取）',
    }
  }

  return {
    status: FIELD_EVIDENCE_STATUS_READY,
    gaps: snapshot.gaps,
    missing: snapshot.missing,
    evidence: snapshot.evidence,
    evidenceComplete: snapshot.evidenceComplete,
    blockReason: '',
    label: snapshot.evidenceComplete
      ? 'GPS 签到、现场记录、电子签名均已具备'
      : `缺少 ${snapshot.missing.join('、')}`,
  }
}

/**
 * fieldEvidenceCompletionBlock 判断完成动作是否必须被前端拦下。
 * 只有"服务端判定可用"这一种状态能放行；未知/待同步一律 fail-closed。
 * @param {object} verdict resolveFieldEvidenceVerdict 的返回值。
 * @returns {boolean} true 表示必须拒绝完成。
 */
export function fieldEvidenceCompletionBlocked(verdict) {
  return (verdict?.status || FIELD_EVIDENCE_STATUS_UNKNOWN) !== FIELD_EVIDENCE_STATUS_READY
}

/**
 * fieldEvidenceReasonMismatch 判断缺项说明与服务端判定是否矛盾。
 * 证据齐全却写说明、证据不全却留空，都会被后端 422 拒绝，前端提前给出同一口径的提示。
 * @param {object} verdict resolveFieldEvidenceVerdict 的返回值。
 * @param {string} reason 用户填写的缺项确认说明。
 * @returns {''|'REASON_REQUIRED'|'REASON_NOT_ALLOWED'} 矛盾类型，一致时返回空串。
 */
export function fieldEvidenceReasonMismatch(verdict, reason) {
  if (verdict?.status !== FIELD_EVIDENCE_STATUS_READY) return ''
  const hasReason = String(reason || '').trim() !== ''
  const gaps = Array.isArray(verdict.gaps) ? verdict.gaps : []
  if (gaps.length && !hasReason) return 'REASON_REQUIRED'
  if (!gaps.length && hasReason) return 'REASON_NOT_ALLOWED'
  return ''
}
