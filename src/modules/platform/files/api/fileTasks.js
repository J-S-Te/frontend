import { createRequest, API_BASE_URL } from '../../shared/api/request.js'
import { attachStructuredContext } from '../../shared/api/requestContext.js'

/**
 * FileTaskError 表示文件或异步任务接口返回的结构化错误。
 *
 * 异常仅保留运维排查所需元数据，不复制文件内容、存储路径或任务负载。
 *
 * @property {number} status HTTP 状态码；网络异常时为 0。
 * @property {string} code 服务端错误码。
 * @property {string} traceId 用于排查的请求跟踪标识。
 */
export class FileTaskError extends Error {
  constructor(message, options = {}) {
    super(message)
    this.name = 'FileTaskError'
    this.status = options.status || 0
    this.code = options.code || ''
    this.traceId = options.traceId || ''
  }
}

async function readResponse(response) {
  const contentType = response.headers.get('content-type') || ''
  if (contentType.includes('application/json')) return response.json()

  const text = await response.text()
  return text ? { message: text } : {}
}

function makeError(body, response, fallback) {
  return new FileTaskError(body.message || body.msg || fallback, {
    status: response.status,
    code: body.code,
    traceId: body.request_id || body.trace_id || body.traceId,
  })
}

const request = createRequest({
  ErrorClass: FileTaskError,
  networkMessage: '无法连接文件与异步任务服务，请确认后端服务已启动。',
  failureMessage: '文件与异步任务请求失败。',
  subsystem: 'platform',
  feature: 'files',
})

/**
 * uploadLocalFile 上传单个本地文件。
 *
 * 不得手工设置 Content-Type，multipart boundary 必须由浏览器生成。
 *
 * @param {Object} options 文件上传参数。
 * @param {string} options.applicationId 文件归属的应用标识。
 * @param {File|Blob} options.file 待上传的文件对象。
 * @param {string} [options.classification='INTERNAL'] 文件密级分类。
 * @returns {Promise<Object>} 返回服务端创建的文件记录。
 * @throws {FileTaskError} 上传参数无效、无文件权限或服务不可用时抛出。
 */
export function uploadLocalFile({ applicationId, file, classification = 'INTERNAL' }) {
  const formData = new FormData()
  formData.set('application_id', String(applicationId || '').trim())
  formData.set('classification', String(classification || 'INTERNAL').trim().toUpperCase())
  formData.set('file', file)
  return request('/files', { method: 'POST', body: formData })
}

/**
 * downloadLocalFile 下载指定文件并解析响应中的文件名。
 *
 * @param {string} fileId 文件标识。
 * @returns {Promise<{blob: Blob, filename: string}>} 返回文件二进制内容及尽力解析的文件名。
 * @throws {FileTaskError} 文件不存在、状态不允许下载、无访问权限或网络不可达时抛出。
 */
export async function downloadLocalFile(fileId) {
  let response
  try {
    response = await fetch(`${API_BASE_URL}/files/${encodeURIComponent(fileId)}/content`, {
      credentials: 'include',
      headers: { Accept: 'application/octet-stream, application/json' },
    })
  } catch {
    const error = new FileTaskError('无法连接文件下载服务，请稍后重试。', { code: 'NETWORK_ERROR' })
    attachStructuredContext(error, {
      subsystem: 'platform',
      feature: 'files',
      operation: 'GET',
      path: `/files/${encodeURIComponent(fileId)}/content`,
      method: 'GET',
      metadata: { fileId, source: 'file_download' },
    }, {
      status: 0,
      code: 'NETWORK_ERROR',
      requestId: '',
      traceId: '',
    })
    throw error
  }
  if (!response.ok) {
    const body = await readResponse(response)
    const requestId = body.request_id || ''
    const traceId = body.trace_id || body.traceId || ''
    const error = makeError(body, response, '文件下载失败。')
    attachStructuredContext(error, {
      subsystem: 'platform',
      feature: 'files',
      operation: 'GET',
      path: `/files/${encodeURIComponent(fileId)}/content`,
      method: 'GET',
      requestId,
      traceId,
      metadata: { fileId, source: 'file_download' },
    }, {
      status: response.status,
      code: body?.code,
      requestId,
      traceId,
    })
    throw error
  }

  const disposition = response.headers.get('content-disposition') || ''
  const matched = disposition.match(/filename\*?=(?:UTF-8''|\")?([^;\"]+)/i)
  const filename = matched ? decodeURIComponent(matched[1].replace(/\"/g, '').trim()) : ''
  return { blob: await response.blob(), filename }
}

/**
 * listAsyncJobs 分页查询异步任务，并按状态、类型或应用筛选。
 *
 * @param {Object} [options] 查询参数。
 * @param {number} [options.page=1] 页码。
 * @param {number} [options.pageSize=20] 每页数量。
 * @param {string} [options.status] 任务状态。
 * @param {string} [options.jobType] 任务类型。
 * @param {string} [options.applicationId] 应用标识。
 * @param {string} [options.query] 关键字。
 * @returns {Promise<Object>} 返回异步任务分页数据。
 * @throws {FileTaskError} 当前会话无权访问或查询服务不可用时抛出。
 */
export function listAsyncJobs({ page = 1, pageSize = 20, status = '', jobType = '', applicationId = '', query = '' } = {}) {
  const params = new URLSearchParams({ page: String(page), page_size: String(pageSize) })
  if (status) params.set('status', status)
  if (jobType) params.set('job_type', jobType)
  if (applicationId) params.set('application_id', applicationId)
  if (query) params.set('query', query)
  return request(`/async-jobs?${params.toString()}`)
}

/**
 * createAsyncJob 创建已注册的应用异步任务。
 *
 * 任务负载必须是不含密码、密钥和令牌的 JSON。
 *
 * @param {Object} options 任务参数。
 * @param {string} [options.applicationId] 归属应用标识。
 * @param {string} options.jobType 已注册的任务类型。
 * @param {string} [options.aggregateType] 聚合根类型。
 * @param {string} [options.aggregateId] 聚合根标识。
 * @param {Object} options.payload 任务负载。
 * @param {number} [options.priority=100] 执行优先级。
 * @param {number} [options.maxAttempts=3] 最大尝试次数。
 * @param {string|null} [options.availableAt] 最早可执行时间。
 * @returns {Promise<Object>} 返回新建的任务记录。
 * @throws {FileTaskError} 任务类型未注册、负载不合法或创建服务不可用时抛出。
 */
export function createAsyncJob({ applicationId = '', jobType, aggregateType = '', aggregateId = '', payload, priority = 100, maxAttempts = 3, availableAt = null }) {
  return request('/async-jobs', {
    method: 'POST',
    body: JSON.stringify({
      application_id: applicationId,
      job_type: jobType,
      aggregate_type: aggregateType,
      aggregate_id: aggregateId,
      payload,
      priority,
      max_attempts: maxAttempts,
      available_at: availableAt,
    }),
  })
}

/**
 * cancelAsyncJob 取消一个尚可终止的异步任务。
 * @param {string} jobId 任务标识。
 * @returns {Promise<Object>} 返回取消后的任务状态。
 * @throws {FileTaskError} 任务不存在、当前状态不允许取消或操作无权限时抛出。
 */
export function cancelAsyncJob(jobId) { return request(`/async-jobs/${encodeURIComponent(jobId)}/cancel`, { method: 'POST' }) }

/**
 * retryAsyncJob 重试一个执行失败的异步任务。
 * @param {string} jobId 任务标识。
 * @returns {Promise<Object>} 返回重试后的任务状态。
 * @throws {FileTaskError} 任务不存在、状态不允许重试或已达尝试上限时抛出。
 */
export function retryAsyncJob(jobId) { return request(`/async-jobs/${encodeURIComponent(jobId)}/retry`, { method: 'POST' }) }

/**
 * rerunAsyncJob 基于原任务参数创建一次新的执行。
 * @param {string} jobId 原任务标识。
 * @returns {Promise<Object>} 返回新任务记录。
 * @throws {FileTaskError} 原任务不存在、任务类型不允许重新执行或操作无权限时抛出。
 */
export function rerunAsyncJob(jobId) { return request(`/async-jobs/${encodeURIComponent(jobId)}/rerun`, { method: 'POST' }) }

/**
 * cleanupExpiredFiles 触发一次有数量上限的过期未绑定文件清理。
 * @param {Object} options 清理参数。
 * @param {string} options.before 只清理该时间之前的文件。
 * @param {number} options.maxFiles 本次最多清理的文件数。
 * @returns {Promise<Object>} 返回本次清理的统计结果。
 * @throws {FileTaskError} 参数无效、操作者无高风险操作权限或服务不可用时抛出。
 */
export function cleanupExpiredFiles({ before, maxFiles }) {
  return request('/files/cleanup', { method: 'POST', body: JSON.stringify({ before, max_files: maxFiles }) })
}
