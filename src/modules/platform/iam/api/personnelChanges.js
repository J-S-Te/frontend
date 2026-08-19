import { createRequest } from '../../shared/api/request.js'

/**
 * PersonnelChangeError 与业务错误分类相关的错误类型定义。
 * @class
 * @property {string} name 标准错误类型名。
 */
export class PersonnelChangeError extends Error {
  constructor(message, options = {}) {
    super(message)
    this.name = 'PersonnelChangeError'
    this.status = options.status || 0
    this.code = options.code || ''
    this.traceId = options.traceId || ''
    this.details = options.details || null
  }
}

const request = createRequest({
  ErrorClass: PersonnelChangeError,
  networkMessage: '无法连接人员异动服务，请确认平台 API 已启动。',
  failureMessage: '人员异动请求失败。',
  subsystem: 'platform',
  feature: 'personnel_changes',
})

function query(parameters = {}) {
  const search = new URLSearchParams()
  Object.entries(parameters).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') search.set(key, String(value))
  })
  const encoded = search.toString()
  return encoded ? `?${encoded}` : ''
}

/**
 * listPersonnelChanges 分页查询人员异动单，支持状态、类型与关键字过滤。
 * @param {Object} options 查询参数。
 * @param {number} [options.page=1] 页码。
 * @param {number} [options.pageSize=20] 分页条数。
 * @param {string} [options.status=''] 状态过滤。
 * @param {string} [options.type=''] 类型过滤。
 * @param {string} [options.keyword=''] 关键字过滤。
 * @returns {Promise<{items:Array<object>,total:number,page:number,pageSize:number}>} 标准分页结果。
 * @throws {Error} 会话失效、权限不足或服务端异常时抛出。
 */
export function listPersonnelChanges({ page = 1, pageSize = 20, status = '', type = '', keyword = '' } = {}) {
  return request(`/personnel-changes${query({ page, page_size: pageSize, status, change_type: type, keyword })}`).then((value) => ({
    items: Array.isArray(value?.items) ? value.items : [],
    total: Number(value?.total || 0),
    page: Number(value?.page || page),
    pageSize: Number(value?.page_size || pageSize),
  }))
}

/**
 * previewPersonnelChange 提交异动前预检，返回变更校验结果与影响范围。
 * @param {Object} payload 预检负载，包含变动类型、目标岗位/组织/用户。
 * @returns {Promise<object>} 预检结果。
 * @throws {Error} 无权限、字段缺失或服务端校验失败时抛出。
 */
export function previewPersonnelChange(payload) {
  return request('/personnel-changes/preview', { method: 'POST', body: JSON.stringify(payload) })
}

/**
 * createPersonnelChange 创建异动草稿（尚未流转到审批）。用于岗位/组织变更提报。
 * @param {Object} payload 异动明细。
 * @returns {Promise<object>} 新建的异动单信息。
 * @throws {Error} 会话失效、权限不足、必填字段缺失时抛出。
 */
export function createPersonnelChange(payload) {
  return request('/personnel-changes', { method: 'POST', body: JSON.stringify(payload) })
}

/**
 * submitPersonnelChange 将草稿异动提交到审批链路。
 * @param {string|number} id 异动单 ID。
 * @returns {Promise<object>} 流转后的异动单状态。
 * @throws {Error} 单据状态不允许提交、鉴权失败或版本冲突时抛出。
 */
export function submitPersonnelChange(id) {
  return request(`/personnel-changes/${encodeURIComponent(id)}/transition`, {
    method: 'POST',
    body: JSON.stringify({ to_status: 'PENDING_APPROVAL' }),
  })
}

/**
 * cancelPersonnelChange 撤销待办异动，撤回后不可继续提交。
 * @param {string|number} id 异动单 ID。
 * @returns {Promise<object>} 撤回后的异动单状态。
 * @throws {Error} 单据不可取消、已审批完成或权限不足时抛出。
 */
export function cancelPersonnelChange(id) {
  return request(`/personnel-changes/${encodeURIComponent(id)}/transition`, {
    method: 'POST',
    body: JSON.stringify({ to_status: 'CANCELLED' }),
  })
}
