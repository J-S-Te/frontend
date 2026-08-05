import { createRequest, API_BASE_URL } from '../../shared/api/request.js'
import { AuthorizationError } from './authorization.js'




const request = createRequest({ ErrorClass: AuthorizationError, networkMessage: '无法连接岗位授权模板服务，请确认基础平台后端已启动。', failureMessage: '岗位授权模板请求失败。' })

export function listPositionAuthorizationTargets() {
  return request('/position-authorization-targets')
}

// 岗位模板映射使用专用岗位目录，避免要求岗位管理的 platform:position:read 权限。
export function listPositionAuthorizationPositions() {
  return request('/position-authorization-positions')
}

export function listPositionAuthorizationTemplates() {
  return request('/position-authorization-templates')
}

export function createPositionAuthorizationTemplate(payload = {}) {
  // 模板编码是服务端生成的安全标识。即使旧调用方仍传入 code，创建请求也不得携带它。
  const { code: _serverGeneratedCode, ...createPayload } = payload
  return request('/position-authorization-templates', { method: 'POST', body: JSON.stringify(createPayload) })
}

export function updatePositionAuthorizationTemplate(templateId, payload = {}) {
  // 编码创建后不可修改；避免旧调用方把展示字段回传给严格校验的服务端。
  const { code: _immutableCode, ...updatePayload } = payload
  return request(`/position-authorization-templates/${encodeURIComponent(templateId)}`, { method: 'PATCH', body: JSON.stringify(updatePayload) })
}

export function deletePositionAuthorizationTemplate(templateId, version) {
  const search = new URLSearchParams({ version: String(version) })
  return request(`/position-authorization-templates/${encodeURIComponent(templateId)}?${search.toString()}`, { method: 'DELETE' })
}

// 兼容已有调用方：后端采用逻辑删除以保留授权与审计历史。
export const disablePositionAuthorizationTemplate = deletePositionAuthorizationTemplate

export function listPositionAuthorizationTemplateAssignments(positionId) {
  return request(`/positions/${encodeURIComponent(positionId)}/authorization-templates`)
}

export function replacePositionAuthorizationTemplateAssignments(positionId, assignments) {
  return request(`/positions/${encodeURIComponent(positionId)}/authorization-templates`, {
    method: 'PUT',
    body: JSON.stringify({ assignments }),
  })
}

export function previewPositionAuthorization(payload) {
  return request('/position-authorization-preview', { method: 'POST', body: JSON.stringify(payload) })
}
