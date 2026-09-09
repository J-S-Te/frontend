import { createRequest } from '../../shared/api/request.js'

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

const request = createRequest({
  ErrorClass: FileTaskError,
  networkMessage: '无法连接文件与异步任务服务，请确认后端服务已启动。',
  failureMessage: '文件与异步任务请求失败。',
  subsystem: 'platform',
  feature: 'files',
})

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
