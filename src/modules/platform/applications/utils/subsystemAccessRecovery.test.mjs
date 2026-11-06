import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildManualRecoveryDecision,
  isManualRecoveryCandidate,
  isSupersededRecovery,
  isValidRecoveryChecksum,
  manualRecoveryMode,
} from './subsystemAccessRecovery.mjs'

const preview = {
  operation_id: 'operation-1', operation_version: 5, generation: 7,
  application_code: 'contract_management', environment: 'prod', manifest_checksum: 'sha256:manifest-receipt',
  error_code: 'DEPLOYMENT_EFFECT_UNKNOWN', evidence_digest: 'a'.repeat(64),
  runtime_files: [{ path: 'runtime/contract.env', present: true }],
  containers: [{ service_id: 'contract-api', present: true }],
  mode: 'fenced',
  receipt_manifest_checksum: 'sha256:manifest-receipt',
  current_profile_checksum: 'sha256:manifest-receipt',
}
// 原代次清单已被新发布替换：后端在 superseded 模式下显式返回空的运行事实。
const supersededPreview = {
  ...preview,
  mode: 'superseded',
  evidence_digest: '',
  runtime_files: [],
  containers: [],
  current_profile_checksum: 'sha256:manifest-published-later',
}
const reason = '已核对原始错误、配置备份差异及实际容器状态。'

test('人工恢复只针对等待核对的原未知派发', () => {
  assert.equal(isManualRecoveryCandidate({ status: 'WAITING', stage: 'DEPLOY', error_code: 'DEPLOYMENT_EFFECT_UNKNOWN' }), true)
  for (const operation of [null, { status: 'RUNNING' }, { status: 'FAILED' }, { status: 'WAITING', stage: 'READINESS' }]) {
    assert.equal(isManualRecoveryCandidate(operation), false)
  }
})

test('恢复模式按预检归一化：只有显式 superseded 才算已被取代', () => {
  assert.equal(manualRecoveryMode(supersededPreview), 'superseded')
  assert.equal(manualRecoveryMode({ ...preview, mode: 'SUPERSEDED' }), 'superseded')
  for (const value of [preview, { ...preview, mode: '' }, { ...preview, mode: undefined }, { ...preview, mode: 'unknown' }]) {
    assert.equal(manualRecoveryMode(value), 'fenced')
  }
  assert.equal(isSupersededRecovery(supersededPreview), true)
  assert.equal(isSupersededRecovery(preview), false)
  assert.equal(isSupersededRecovery(null), false)
})

test('清单校验和只接受非空、无空白且不超过128字符的值', () => {
  assert.equal(isValidRecoveryChecksum('sha256:abc'), true)
  for (const value of ['', '   ', null, undefined, 123, 'sha256: ab', 'a\nb', 'x'.repeat(129)]) {
    assert.equal(isValidRecoveryChecksum(value), false)
  }
})

test('fenced 人工决定绑定当前操作、明确确认和原事实摘要', () => {
  assert.throws(() => buildManualRecoveryDecision(preview, 'different-operation', reason, true), /操作/)
  assert.throws(() => buildManualRecoveryDecision(preview, 'operation-1', reason, false), /确认/)
  assert.throws(() => buildManualRecoveryDecision(preview, 'operation-1', '已核对', true), /原因/)
  const body = buildManualRecoveryDecision(preview, 'operation-1', reason, true)
  assert.deepEqual(body, { expected_version: 5, generation: 7, mode: 'fenced', evidence_digest: 'a'.repeat(64), reason })
  assert.equal('operator_id' in body, false)
  assert.equal('tenant_id' in body, false)
})

test('fenced 模式保留原有强校验：版本、事实摘要、运行文件与容器缺一不可', () => {
  for (const patch of [
    { operation_version: Number.MAX_SAFE_INTEGER + 1 }, { generation: 0 },
    { evidence_digest: 'invalid' }, { runtime_files: [] }, { containers: null },
    { error_code: 'DEPLOYMENT_SUCCEEDED' }, { manifest_checksum: '' },
  ]) {
    assert.throws(() => buildManualRecoveryDecision({ ...preview, ...patch }, 'operation-1', reason, true))
  }
})

test('superseded 模式允许运行事实为空，并改交两份清单校验和', () => {
  const body = buildManualRecoveryDecision(supersededPreview, 'operation-1', reason, true, true)
  assert.deepEqual(body, {
    expected_version: 5, generation: 7, mode: 'superseded',
    receipt_manifest_checksum: 'sha256:manifest-receipt',
    current_profile_checksum: 'sha256:manifest-published-later', reason,
  })
  // 取代路径不携带证据摘要：后端只接受否定证明，带上会让模式核对失败。
  assert.equal('evidence_digest' in body, false)
})

test('superseded 模式要求第二确认', () => {
  assert.throws(() => buildManualRecoveryDecision(supersededPreview, 'operation-1', reason, true, false), /再次确认/)
  assert.throws(() => buildManualRecoveryDecision(supersededPreview, 'operation-1', reason, true), /再次确认/)
})

test('superseded 模式拒绝无法证明"已被取代"的预检', () => {
  for (const [patch, pattern] of [
    // 两份校验和相同 = 未被取代，后端会 409，前端必须先拦住。
    [{ current_profile_checksum: 'sha256:manifest-receipt' }, /未被取代/],
    [{ current_profile_checksum: '' }, /缺失或不合法/],
    [{ receipt_manifest_checksum: '' }, /缺失或不合法/],
    [{ receipt_manifest_checksum: 'sha256:other-receipt' }, /不一致/],
    [{ current_profile_checksum: 'sha256: with space' }, /缺失或不合法/],
    [{ runtime_files: [{ path: 'runtime/contract.env' }] }, /运行事实/],
    [{ containers: [{ service_id: 'contract-api' }] }, /运行事实/],
    [{ operation_version: 0 }, /版本或代次/],
    [{ generation: 1.5 }, /版本或代次/],
    [{ manifest_checksum: '' }, /不完整/],
  ]) {
    assert.throws(() => buildManualRecoveryDecision({ ...supersededPreview, ...patch }, 'operation-1', reason, true, true), pattern)
  }
})
