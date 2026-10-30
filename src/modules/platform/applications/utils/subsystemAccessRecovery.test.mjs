import test from 'node:test'
import assert from 'node:assert/strict'
import { buildManualRecoveryDecision, isManualRecoveryCandidate } from './subsystemAccessRecovery.mjs'

const preview = {
  operation_id: 'operation-1', operation_version: 5, generation: 7,
  application_code: 'contract_management', environment: 'prod', manifest_checksum: 'manifest-1',
  error_code: 'DEPLOYMENT_EFFECT_UNKNOWN', evidence_digest: 'a'.repeat(64),
  runtime_files: [{ path: 'runtime/contract.env', present: true }],
  containers: [{ service_id: 'contract-api', present: true }],
}
const reason = '已核对原始错误、配置备份差异及实际容器状态。'

test('人工恢复只针对等待核对的原未知派发', () => {
  assert.equal(isManualRecoveryCandidate({ status: 'WAITING', stage: 'DEPLOY', error_code: 'DEPLOYMENT_EFFECT_UNKNOWN' }), true)
  for (const operation of [null, { status: 'RUNNING' }, { status: 'FAILED' }, { status: 'WAITING', stage: 'READINESS' }]) {
    assert.equal(isManualRecoveryCandidate(operation), false)
  }
})

test('人工决定绑定当前操作、明确确认和原事实摘要', () => {
  assert.throws(() => buildManualRecoveryDecision(preview, 'different-operation', reason, true), /操作/)
  assert.throws(() => buildManualRecoveryDecision(preview, 'operation-1', reason, false), /确认/)
  assert.throws(() => buildManualRecoveryDecision(preview, 'operation-1', '已核对', true), /原因/)
  const body = buildManualRecoveryDecision(preview, 'operation-1', reason, true)
  assert.deepEqual(body, { expected_version: 5, generation: 7, evidence_digest: 'a'.repeat(64), reason })
  assert.equal('operator_id' in body, false)
  assert.equal('tenant_id' in body, false)
})

test('版本超出安全整数、事实不全或错误类别变化时不可终止', () => {
  for (const patch of [
    { operation_version: Number.MAX_SAFE_INTEGER + 1 }, { generation: 0 },
    { evidence_digest: 'invalid' }, { runtime_files: [] }, { containers: null },
    { error_code: 'DEPLOYMENT_SUCCEEDED' },
  ]) {
    assert.throws(() => buildManualRecoveryDecision({ ...preview, ...patch }, 'operation-1', reason, true))
  }
})
