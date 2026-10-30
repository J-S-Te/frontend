/** isManualRecoveryCandidate 判断当前操作是否属于待人工核对的未知派发。
 * 参数：operation为服务端返回的原操作视图。
 * 返回值：仅等待中的部署未知结果返回true。
 */
export function isManualRecoveryCandidate(operation) {
  return operation?.status === 'WAITING' && operation?.stage === 'DEPLOY'
    && operation?.error_code === 'DEPLOYMENT_EFFECT_UNKNOWN'
}

/** buildManualRecoveryDecision 将明确核对决定绑定到当前操作和原事实。
 * 参数：preview为实际预检，operationId为当前原操作，reason为人工原因，confirmed为明确确认。
 * 返回值：严格白名单提交体；未核对、漂移或不安全整数时抛出可理解错误。
 */
export function buildManualRecoveryDecision(preview, operationId, reason, confirmed) {
  if (!preview || preview.operation_id !== operationId) throw new Error('当前操作已变化，请重新读取核验。')
  if (!confirmed) throw new Error('请确认已核对原错误与现场事实。')
  if (!Number.isSafeInteger(preview.operation_version) || preview.operation_version <= 0
    || !Number.isSafeInteger(preview.generation) || preview.generation <= 0) {
    throw new Error('任务版本或代次无法安全核对，请重新读取。')
  }
  if (preview.error_code !== 'DEPLOYMENT_EFFECT_UNKNOWN'
    || !/^[a-f0-9]{64}$/.test(preview.evidence_digest || '')
    || !preview.application_code || !preview.environment || !preview.manifest_checksum
    || !Array.isArray(preview.runtime_files) || preview.runtime_files.length === 0
    || !Array.isArray(preview.containers) || preview.containers.length === 0) {
    throw new Error('原任务或现场事实不完整，请重新读取核验。')
  }
  const normalized = String(reason || '').trim()
  if ([...normalized].length < 10 || [...normalized].length > 500) {
    throw new Error('请填写10至500字的核对原因，不要填写密码或密钥。')
  }
  return { expected_version: preview.operation_version, generation: preview.generation,
    evidence_digest: preview.evidence_digest, reason: normalized }
}
