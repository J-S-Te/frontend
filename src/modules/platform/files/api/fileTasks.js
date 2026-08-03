const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '/api/v1').replace(/\/$/, '')

/**
 * 只保留平台响应包中的运维错误元数据；文件内容、存储路径和异步任务负载不会复制进异常。
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

async function request(path, options = {}) {
  let response
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      credentials: 'include',
      ...options,
      headers: {
        Accept: 'application/json',
        ...(options.body && !(options.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers || {}),
      },
    })
  } catch {
    throw new FileTaskError('无法连接文件与异步任务服务，请确认后端服务已启动。', { code: 'NETWORK_ERROR' })
  }

  const body = await readResponse(response)
  if (!response.ok) throw makeError(body, response, '文件与异步任务请求失败。')
  return body.data
}

/** 上传单个文件；不得手工设置 Content-Type，multipart boundary 必须由浏览器生成。 */
export function uploadLocalFile({ applicationId, file, classification = 'INTERNAL' }) {
  const formData = new FormData()
  formData.set('application_id', String(applicationId || '').trim())
  formData.set('classification', String(classification || 'INTERNAL').trim().toUpperCase())
  formData.set('file', file)
  return request('/files', { method: 'POST', body: formData })
}

/** 服务端完成租户、文件状态和下载权限校验后，返回 Blob 及尽力解析出的文件名。 */
export async function downloadLocalFile(fileId) {
  let response
  try {
    response = await fetch(`${API_BASE_URL}/files/${encodeURIComponent(fileId)}/content`, {
      credentials: 'include',
      headers: { Accept: 'application/octet-stream, application/json' },
    })
  } catch {
    throw new FileTaskError('无法连接文件下载服务，请稍后重试。', { code: 'NETWORK_ERROR' })
  }
  if (!response.ok) {
    const body = await readResponse(response)
    throw makeError(body, response, '文件下载失败。')
  }

  const disposition = response.headers.get('content-disposition') || ''
  const matched = disposition.match(/filename\*?=(?:UTF-8''|\")?([^;\"]+)/i)
  const filename = matched ? decodeURIComponent(matched[1].replace(/\"/g, '').trim()) : ''
  return { blob: await response.blob(), filename }
}

export function listAsyncJobs({ page = 1, pageSize = 20, status = '', jobType = '', applicationId = '', query = '' } = {}) {
  const params = new URLSearchParams({ page: String(page), page_size: String(pageSize) })
  if (status) params.set('status', status)
  if (jobType) params.set('job_type', jobType)
  if (applicationId) params.set('application_id', applicationId)
  if (query) params.set('query', query)
  return request(`/async-jobs?${params.toString()}`)
}

/** 创建已注册的应用任务；负载必须是不含密码、密钥和令牌的 JSON。 */
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

export function cancelAsyncJob(jobId) { return request(`/async-jobs/${encodeURIComponent(jobId)}/cancel`, { method: 'POST' }) }
export function retryAsyncJob(jobId) { return request(`/async-jobs/${encodeURIComponent(jobId)}/retry`, { method: 'POST' }) }
export function rerunAsyncJob(jobId) { return request(`/async-jobs/${encodeURIComponent(jobId)}/rerun`, { method: 'POST' }) }

/** 触发一次有数量上限的未绑定文件清理；服务端必须对该高风险操作执行权限校验。 */
export function cleanupExpiredFiles({ before, maxFiles }) {
  return request('/files/cleanup', { method: 'POST', body: JSON.stringify({ before, max_files: maxFiles }) })
}
