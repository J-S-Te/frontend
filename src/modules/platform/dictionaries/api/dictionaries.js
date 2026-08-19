import { createRequest, API_BASE_URL } from '../../shared/api/request.js'

/** 保留平台 API 返回的安全错误元数据，不向上层泄露原始响应实现细节。 */
export class DictionaryError extends Error {
  constructor(message, options = {}) {
    super(message)
    this.name = 'DictionaryError'
    this.status = options.status || 0
    this.code = options.code || ''
    this.traceId = options.traceId || ''
  }
}



const request = createRequest({
  ErrorClass: DictionaryError,
  networkMessage: '无法连接字典服务，请确认后端服务已启动。',
  failureMessage: '字典请求失败。',
  subsystem: 'platform',
  feature: 'dictionaries',
})

function pageQuery({ page = 1, pageSize = 20, keyword = '', status = '' } = {}) {
  const query = new URLSearchParams({ page: String(page), page_size: String(pageSize) })
  if (keyword.trim()) query.set('keyword', keyword.trim())
  if (status) query.set('status', status)
  return `?${query.toString()}`
}

function dictionaryPath(dictionaryId) {
  return `/dictionaries/${encodeURIComponent(dictionaryId)}`
}

function itemPath(dictionaryId, itemId = '') {
  const collection = `${dictionaryPath(dictionaryId)}/items`
  return itemId ? `${collection}/${encodeURIComponent(itemId)}` : collection
}

/** 列出当前租户的业务字典；租户边界由会话和服务端查询共同限定。 */
export function listDictionaries(query = {}) {
  return request(`/dictionaries${pageQuery(query)}`)
}

/** 创建一个租户级字典。 */
export function createDictionary({ code, name, description = '', status = 'ACTIVE' }) {
  return request('/dictionaries', {
    method: 'POST',
    body: JSON.stringify({ code, name, description, status }),
  })
}

/** 按 ID 读取字典，服务端仍校验该 ID 是否属于当前租户。 */
export function getDictionary(dictionaryId) {
  return request(dictionaryPath(dictionaryId))
}

/** 使用乐观锁版本更新字典可编辑字段，防止覆盖其他管理员的并发修改。 */
export function updateDictionary({ dictionaryId, code, name, description = '', status, version }) {
  return request(dictionaryPath(dictionaryId), {
    method: 'PATCH',
    body: JSON.stringify({ code, name, description, status, version }),
  })
}

/** 列出字典下供管理使用的全部启用和停用条目。 */
export function listDictionaryItems({ dictionaryId, ...query }) {
  return request(`${itemPath(dictionaryId)}${pageQuery(query)}`)
}

/** 在指定字典下创建条目。 */
export function createDictionaryItem({ dictionaryId, code, label, value, sortOrder = 0, status = 'ACTIVE' }) {
  return request(itemPath(dictionaryId), {
    method: 'POST',
    body: JSON.stringify({ code, label, value, sort_order: Number(sortOrder) || 0, status }),
  })
}

/** 使用乐观锁版本更新字典条目可编辑字段。 */
export function updateDictionaryItem({ dictionaryId, itemId, code, label, value, sortOrder = 0, status, version }) {
  return request(itemPath(dictionaryId, itemId), {
    method: 'PATCH',
    body: JSON.stringify({ code, label, value, sort_order: Number(sortOrder) || 0, status, version }),
  })
}

/** 按启用字典编码只返回业务表单可选择的有效条目。 */
export function listActiveDictionaryItemsByCode({ dictionaryCode, ...query }) {
  return request(`/dictionaries/code/${encodeURIComponent(dictionaryCode)}/items${pageQuery(query)}`)
}
