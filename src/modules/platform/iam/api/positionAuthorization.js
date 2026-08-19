import { createRequest, API_BASE_URL } from '../../shared/api/request.js'
import { AuthorizationError } from './authorization.js'




const request = createRequest({
  ErrorClass: AuthorizationError,
  networkMessage: '无法连接岗位授权模板服务，请确认基础平台后端已启动。',
  failureMessage: '岗位授权模板请求失败。',
  subsystem: 'platform',
  feature: 'position_authorization',
})

/**
 * listPositionAuthorizationTargets 查询可纳入岗位授权模板的应用与角色目标。
 * @returns {Promise<Object>} 返回可选授权目标目录。
 * @throws {AuthorizationError} 当前会话无权访问或授权目录服务不可用时抛出。
 */
export function listPositionAuthorizationTargets() {
  return request('/position-authorization-targets')
}

/**
 * listPositionAuthorizationPositions 查询可绑定授权模板的岗位目录。
 *
 * 该专用目录不要求调用者拥有岗位管理的 platform:position:read 权限。
 *
 * @returns {Promise<Object>} 返回授权模板可用的岗位目录。
 * @throws {AuthorizationError} 当前会话无权访问或岗位目录服务不可用时抛出。
 */
export function listPositionAuthorizationPositions() {
  return request('/position-authorization-positions')
}

/**
 * listPositionAuthorizationTemplates 查询岗位授权模板列表。
 * @returns {Promise<Object>} 返回岗位授权模板集合。
 * @throws {AuthorizationError} 当前会话无权访问或模板服务不可用时抛出。
 */
export function listPositionAuthorizationTemplates() {
  return request('/position-authorization-templates')
}

/**
 * getPositionAuthorizationTemplate 查询指定的岗位授权模板。
 * @param {string} templateId 模板标识。
 * @returns {Promise<Object>} 返回模板详情及授权项。
 * @throws {AuthorizationError} 模板不存在、无访问权限或服务不可用时抛出。
 */
export function getPositionAuthorizationTemplate(templateId) {
  return request(`/position-authorization-templates/${encodeURIComponent(templateId)}`)
}

/**
 * createPositionAuthorizationTemplate 创建岗位授权模板，模板编码由服务端生成。
 * @param {Object} [payload] 模板名称、描述及授权项等创建数据。
 * @returns {Promise<Object>} 返回新建的授权模板。
 * @throws {AuthorizationError} 模板数据无效、编码冲突或操作无权限时抛出。
 */
export function createPositionAuthorizationTemplate(payload = {}) {
  // 模板编码是服务端生成的安全标识。即使旧调用方仍传入 code，创建请求也不得携带它。
  const { code: _serverGeneratedCode, ...createPayload } = payload
  return request('/position-authorization-templates', { method: 'POST', body: JSON.stringify(createPayload) })
}

/**
 * updatePositionAuthorizationTemplate 更新岗位授权模板，并主动排除不可变的编码字段。
 * @param {string} templateId 模板标识。
 * @param {Object} [payload] 需要更新的模板数据。
 * @returns {Promise<Object>} 返回更新后的授权模板。
 * @throws {AuthorizationError} 模板不存在、版本冲突、数据无效或操作无权限时抛出。
 */
export function updatePositionAuthorizationTemplate(templateId, payload = {}) {
  // 编码创建后不可修改；避免旧调用方把展示字段回传给严格校验的服务端。
  const { code: _immutableCode, ...updatePayload } = payload
  return request(`/position-authorization-templates/${encodeURIComponent(templateId)}`, { method: 'PATCH', body: JSON.stringify(updatePayload) })
}

/**
 * deletePositionAuthorizationTemplate 逻辑删除岗位授权模板，保留授权与审计历史。
 * @param {string} templateId 模板标识。
 * @param {number} version 当前乐观锁版本号。
 * @returns {Promise<Object>} 返回模板的删除结果。
 * @throws {AuthorizationError} 模板不存在、版本冲突或操作无权限时抛出。
 */
export function deletePositionAuthorizationTemplate(templateId, version) {
  const search = new URLSearchParams({ version: String(version) })
  return request(`/position-authorization-templates/${encodeURIComponent(templateId)}?${search.toString()}`, { method: 'DELETE' })
}

/**
 * disablePositionAuthorizationTemplate 是逻辑删除函数的兼容别名。
 * @type {typeof deletePositionAuthorizationTemplate}
 */
export const disablePositionAuthorizationTemplate = deletePositionAuthorizationTemplate

/**
 * listPositionAuthorizationTemplateAssignments 查询指定岗位已分配的授权模板。
 * @param {string} positionId 岗位标识。
 * @returns {Promise<Object>} 返回岗位与授权模板的分配关系。
 * @throws {AuthorizationError} 岗位不存在、无访问权限或服务不可用时抛出。
 */
export function listPositionAuthorizationTemplateAssignments(positionId) {
  return request(`/positions/${encodeURIComponent(positionId)}/authorization-templates`)
}

/**
 * replacePositionAuthorizationTemplateAssignments 整体替换指定岗位的授权模板分配。
 * @param {string} positionId 岗位标识。
 * @param {Array<Object>} assignments 新的模板分配列表。
 * @returns {Promise<Object>} 返回替换后的分配关系。
 * @throws {AuthorizationError} 岗位或模板不存在、分配数据无效或操作无权限时抛出。
 */
export function replacePositionAuthorizationTemplateAssignments(positionId, assignments) {
  return request(`/positions/${encodeURIComponent(positionId)}/authorization-templates`, {
    method: 'PUT',
    body: JSON.stringify({ assignments }),
  })
}

/**
 * previewPositionAuthorization 预览岗位与授权模板组合后的有效权限。
 * @param {Object} payload 岗位、模板及待试算的分配数据。
 * @returns {Promise<Object>} 返回未持久化的权限试算结果。
 * @throws {AuthorizationError} 预览参数无效、引用对象不存在或操作无权限时抛出。
 */
export function previewPositionAuthorization(payload) {
  return request('/position-authorization-preview', { method: 'POST', body: JSON.stringify(payload) })
}
