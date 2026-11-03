import assert from 'node:assert/strict'
import test from 'node:test'
import {
  FIELD_EVIDENCE_STATUS_NONE,
  FIELD_EVIDENCE_STATUS_PENDING,
  FIELD_EVIDENCE_STATUS_READY,
  FIELD_EVIDENCE_STATUS_UNKNOWN,
  fieldEvidenceCompletionBlocked,
  fieldEvidenceReasonMismatch,
  fieldEvidenceTypeLabel,
  normalizeServiceItemFieldEvidence,
  resolveFieldEvidenceVerdict,
} from './fieldEvidence.js'

// BIZ-PROJECT-06：缺项判定由服务端按服务项完整事件流给出，前端只消费结论。
// 这些用例锁死三件事：服务端驱动的缺项、"未知"状态的 fail-closed、待同步同样阻断完成。

const completeEvidence = {
  service_item_id: 'SI-1',
  gaps: [],
  missing: [],
  evidence: [
    { type: 'FIELD_CHECKED_IN', label: 'GPS 签到', event_id: 'EV-1', captured_at: '2026-10-30T08:00:00Z', summary: '定位 30.2741, 120.1551（精度 12.5 米）' },
    { type: 'FIELD_RECORD_SUBMITTED', label: '现场记录', event_id: 'EV-2', file_ref: 'FILE-RECORD-1' },
    { type: 'FIELD_SIGNATURE_CAPTURED', label: '电子签名', event_id: 'EV-3', file_ref: 'FILE-SIGN-1' },
  ],
  evidence_complete: true,
  state: 'COMPLETE',
  gate_policy: 'ENFORCE',
  scanned_events: 3,
}

const gappedEvidence = {
  ...completeEvidence,
  gaps: ['FIELD_SIGNATURE_CAPTURED'],
  missing: ['电子签名'],
  evidence: completeEvidence.evidence.slice(0, 2),
  evidence_complete: false,
  state: 'INCOMPLETE',
}

test('判定结构归一：缺项中文名、证据明细与回执都可直接展示', () => {
  const snapshot = normalizeServiceItemFieldEvidence(gappedEvidence, 'SI-1')
  assert.equal(snapshot.itemID, 'SI-1')
  assert.deepEqual(snapshot.gaps, ['FIELD_SIGNATURE_CAPTURED'])
  assert.deepEqual(snapshot.missing, ['电子签名'])
  assert.equal(snapshot.evidenceComplete, false)
  assert.equal(snapshot.evidence.length, 2)
  assert.equal(snapshot.evidence[1].fileRef, 'FILE-RECORD-1')
  assert.equal(snapshot.gatePolicy, 'ENFORCE')

  // 服务端未给中文名时按类型码兜底，界面永远能说清"缺什么"。
  const fallback = normalizeServiceItemFieldEvidence({ service_item_id: 'SI-1', gaps: ['FIELD_CHECKED_IN'], evidence_complete: false })
  assert.deepEqual(fallback.missing, ['GPS 签到'])
  assert.equal(fieldEvidenceTypeLabel('FIELD_SIGNATURE_CAPTURED'), '电子签名')
  assert.equal(fieldEvidenceTypeLabel('UNKNOWN_TYPE'), 'UNKNOWN_TYPE')

  // 结构不可用一律判为 null（调用方据此走"未知"分支，不得当成齐全）。
  assert.equal(normalizeServiceItemFieldEvidence(null), null)
  assert.equal(normalizeServiceItemFieldEvidence({}), null)
})

test('就绪判定放行完成，缺项与已具备证据全部来自服务端', () => {
  const snapshot = normalizeServiceItemFieldEvidence(gappedEvidence, 'SI-1')
  const verdict = resolveFieldEvidenceVerdict({ itemID: 'SI-1', snapshot })
  assert.equal(verdict.status, FIELD_EVIDENCE_STATUS_READY)
  assert.deepEqual(verdict.gaps, ['FIELD_SIGNATURE_CAPTURED'])
  assert.deepEqual(verdict.missing, ['电子签名'])
  assert.equal(verdict.evidence.length, 2)
  assert.equal(verdict.blockReason, '')
  assert.match(verdict.label, /缺少 电子签名/)
  assert.equal(fieldEvidenceCompletionBlocked(verdict), false)

  const complete = resolveFieldEvidenceVerdict({ itemID: 'SI-1', snapshot: normalizeServiceItemFieldEvidence(completeEvidence, 'SI-1') })
  assert.equal(complete.status, FIELD_EVIDENCE_STATUS_READY)
  assert.deepEqual(complete.gaps, [])
  assert.match(complete.label, /均已具备/)
  assert.equal(fieldEvidenceCompletionBlocked(complete), false)
})

test('拉取失败与未拉取都是"未知"，并 fail-closed 拒绝完成', () => {
  const failed = resolveFieldEvidenceVerdict({ itemID: 'SI-1', snapshot: null, error: '缺项判定读取失败' })
  assert.equal(failed.status, FIELD_EVIDENCE_STATUS_UNKNOWN)
  assert.ok(fieldEvidenceCompletionBlocked(failed), '拉取失败必须拒绝完成')
  assert.deepEqual(failed.gaps, [])
  assert.match(failed.blockReason, /请重新读取/)

  // 未知绝不能被当成"证据齐全"：gaps 为空但 evidenceComplete 必须为 false。
  assert.equal(failed.evidenceComplete, false)

  const notLoaded = resolveFieldEvidenceVerdict({ itemID: 'SI-1', snapshot: null })
  assert.equal(notLoaded.status, FIELD_EVIDENCE_STATUS_UNKNOWN)
  assert.ok(fieldEvidenceCompletionBlocked(notLoaded))

  // 切换服务项后旧快照不得沿用：itemID 不匹配 → 未知。
  const stale = resolveFieldEvidenceVerdict({ itemID: 'SI-2', snapshot: normalizeServiceItemFieldEvidence(completeEvidence, 'SI-1') })
  assert.equal(stale.status, FIELD_EVIDENCE_STATUS_UNKNOWN)
  assert.ok(fieldEvidenceCompletionBlocked(stale))
  assert.deepEqual(stale.gaps, [])
})

test('待同步的现场操作阻断完成，避免窗口误判换个形式重演', () => {
  const verdict = resolveFieldEvidenceVerdict({
    itemID: 'SI-1',
    snapshot: normalizeServiceItemFieldEvidence(completeEvidence, 'SI-1'),
    pendingSyncCount: 2,
  })
  assert.equal(verdict.status, FIELD_EVIDENCE_STATUS_PENDING)
  assert.ok(fieldEvidenceCompletionBlocked(verdict))
  assert.match(verdict.label, /待同步（2 条现场操作未同步）/)
  assert.match(verdict.blockReason, /先联网补传/)
})

test('未选中服务项时既不放行也不报错', () => {
  const verdict = resolveFieldEvidenceVerdict({ itemID: '', snapshot: null })
  assert.equal(verdict.status, FIELD_EVIDENCE_STATUS_NONE)
  assert.equal(verdict.label, '未选择服务项')
  assert.ok(fieldEvidenceCompletionBlocked(verdict))
})

test('缺项说明与服务端判定的一致性口径与服务端 422 门禁相同', () => {
  const gapped = resolveFieldEvidenceVerdict({ itemID: 'SI-1', snapshot: normalizeServiceItemFieldEvidence(gappedEvidence, 'SI-1') })
  const complete = resolveFieldEvidenceVerdict({ itemID: 'SI-1', snapshot: normalizeServiceItemFieldEvidence(completeEvidence, 'SI-1') })
  // 四象限：证据不全×说明、证据齐全×说明。
  assert.equal(fieldEvidenceReasonMismatch(gapped, ''), 'REASON_REQUIRED')
  assert.equal(fieldEvidenceReasonMismatch(gapped, '客户禁止留存签名'), '')
  assert.equal(fieldEvidenceReasonMismatch(complete, ''), '')
  assert.equal(fieldEvidenceReasonMismatch(complete, '客户禁止留存现场照片'), 'REASON_NOT_ALLOWED')
  // 判定未知时不提前误导用户，交给完成门禁统一拒绝。
  assert.equal(fieldEvidenceReasonMismatch({ status: FIELD_EVIDENCE_STATUS_UNKNOWN, gaps: [] }, '任意说明'), '')
})
