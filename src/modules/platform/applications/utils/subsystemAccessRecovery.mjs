/** 人工恢复的两种模式（与后端契约一致）。
 * fenced：原回执清单仍是当前审核清单，必须同时给出运行事实与证据摘要；
 * superseded：原回执清单已被新发布取代，只接受"两份清单校验和不同"的否定证明。
 */
export const MANUAL_RECOVERY_MODE = Object.freeze({
  FENCED: 'fenced',
  SUPERSEDED: 'superseded',
})

/** isManualRecoveryCandidate 判断当前操作是否属于待人工核对的未知派发。
 * 参数：operation为服务端返回的原操作视图。
 * 返回值：仅等待中的部署未知结果返回true。
 */
export function isManualRecoveryCandidate(operation) {
  return operation?.status === 'WAITING' && operation?.stage === 'DEPLOY'
    && operation?.error_code === 'DEPLOYMENT_EFFECT_UNKNOWN'
}

/** manualRecoveryMode 归一化预检返回的恢复模式。
 * 参数：preview为recovery-preview返回体；旧后端不带mode。
 * 返回值：'superseded' 或 'fenced'（缺省/未知一律按 fenced，保持旧语义）。
 */
export function manualRecoveryMode(preview) {
  const raw = String(preview?.mode || '').trim().toLowerCase()
  return raw === MANUAL_RECOVERY_MODE.SUPERSEDED ? MANUAL_RECOVERY_MODE.SUPERSEDED : MANUAL_RECOVERY_MODE.FENCED
}

/** isSupersededRecovery 判断预检是否属于"原代次已被取代"的收口路径。
 * 参数：preview为recovery-preview返回体。
 * 返回值：superseded 为true，其余false。
 */
export function isSupersededRecovery(preview) {
  return manualRecoveryMode(preview) === MANUAL_RECOVERY_MODE.SUPERSEDED
}

/** isValidRecoveryChecksum 校验清单校验和是否可安全回传比对。
 * 参数：value为预检返回或页面带回的清单校验和。
 * 返回值：非空、无内嵌空白且不超过128字符时为true（与后端列宽/格式约束一致）。
 */
export function isValidRecoveryChecksum(value) {
  if (typeof value !== 'string') return false
  const text = value.trim()
  return text !== '' && text.length <= 128 && !/\s/.test(text)
}

/** buildManualRecoveryDecision 将明确核对决定绑定到当前操作和原事实。
 * 参数：preview为实际预检，operationId为当前原操作，reason为人工原因，
 *      confirmed为第一确认，confirmedSuperseded为 superseded 模式下的第二确认。
 * 返回值：严格白名单提交体；未核对、漂移或不安全整数时抛出可理解错误。
 */
export function buildManualRecoveryDecision(preview, operationId, reason, confirmed, confirmedSuperseded = false) {
  if (!preview || preview.operation_id !== operationId) throw new Error('当前操作已变化，请重新读取核验。')
  if (!confirmed) throw new Error('请确认已核对原错误与现场事实。')
  if (!Number.isSafeInteger(preview.operation_version) || preview.operation_version <= 0
    || !Number.isSafeInteger(preview.generation) || preview.generation <= 0) {
    throw new Error('任务版本或代次无法安全核对，请重新读取。')
  }
  if (preview.error_code !== 'DEPLOYMENT_EFFECT_UNKNOWN'
    || !preview.application_code || !preview.environment
    || !isValidRecoveryChecksum(preview.manifest_checksum)) {
    throw new Error('原任务或现场事实不完整，请重新读取核验。')
  }
  const normalized = String(reason || '').trim()
  if ([...normalized].length < 10 || [...normalized].length > 500) {
    throw new Error('请填写10至500字的核对原因，不要填写密码或密钥。')
  }
  if (manualRecoveryMode(preview) === MANUAL_RECOVERY_MODE.SUPERSEDED) {
    const receipt = String(preview.receipt_manifest_checksum || '').trim()
    const current = String(preview.current_profile_checksum || '').trim()
    // 取代路径没有运行事实：后端只接受"否定证明"，两段事实必须显式为空。
    if ((Array.isArray(preview.runtime_files) && preview.runtime_files.length > 0)
      || (Array.isArray(preview.containers) && preview.containers.length > 0)) {
      throw new Error('原代次运行事实与「已被取代」状态不符，请重新读取核验。')
    }
    if (!isValidRecoveryChecksum(receipt) || !isValidRecoveryChecksum(current)) {
      throw new Error('原清单或当前清单校验和缺失或不合法，请重新读取核验。')
    }
    if (receipt !== String(preview.manifest_checksum || '').trim()) {
      throw new Error('原清单校验和与预检结果不一致，请重新读取核验。')
    }
    if (receipt === current) {
      throw new Error('原清单与当前清单校验和相同，说明原代次未被取代，请按原路径核对。')
    }
    if (!confirmedSuperseded) throw new Error('请再次确认原清单与当前清单校验和确实不同。')
    return { expected_version: preview.operation_version, generation: preview.generation,
      mode: MANUAL_RECOVERY_MODE.SUPERSEDED, receipt_manifest_checksum: receipt,
      current_profile_checksum: current, reason: normalized }
  }
  // fenced：原有语义保持不变，运行文件与容器事实必须逐项核对过。
  if (!/^[a-f0-9]{64}$/.test(preview.evidence_digest || '')
    || !Array.isArray(preview.runtime_files) || preview.runtime_files.length === 0
    || !Array.isArray(preview.containers) || preview.containers.length === 0) {
    throw new Error('原任务或现场事实不完整，请重新读取核验。')
  }
  return { expected_version: preview.operation_version, generation: preview.generation,
    mode: MANUAL_RECOVERY_MODE.FENCED, evidence_digest: preview.evidence_digest, reason: normalized }
}
