import { createRequest } from '../../shared/api/request.js'
import { ApplicationRegistryError } from './applications.js'

const request = createRequest({ ErrorClass: ApplicationRegistryError,
  networkMessage: '无法读取恢复结果，请先查询原操作。', failureMessage: '人工恢复未完成，请核对原操作。',
  subsystem: 'platform', feature: 'application-recovery' })

/** previewSubsystemAccessRecovery 读取原未知代次的真实核对事实。
 * 参数：operationId为当前租户内的原操作标识。
 * 返回值：预检版本与现场摘要；失败由统一请求错误模型表达。
 */
export function previewSubsystemAccessRecovery(operationId) {
  const id = encodeURIComponent(String(operationId || '').trim())
  return request(`/subsystem-access/operations/${id}/recovery-preview`)
}

/** abandonSubsystemAccessRecovery 保存已核对的人工终止决定，不发起新部署。
 * 参数：operationId限定原任务，body为已校验的版本、代次、摘要及原因。
 * 返回值：原代次失败收口视图；超时后应查询原操作。
 */
export function abandonSubsystemAccessRecovery(operationId, body) {
  const id = encodeURIComponent(String(operationId || '').trim())
  return request(`/subsystem-access/operations/${id}/abandon`, { method: 'POST', body: JSON.stringify(body) })
}
