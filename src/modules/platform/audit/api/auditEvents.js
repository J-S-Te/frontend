const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '/api/v1').replace(/\/$/, '')

export class AuditEventsError extends Error {
  constructor(message, options = {}) {
    super(message)
    this.name = 'AuditEventsError'
    this.status = options.status || 0
    this.code = options.code || ''
    this.traceId = options.traceId || ''
  }
}

async function readBody(response) {
  const contentType = response.headers.get('content-type') || ''
  if (contentType.includes('application/json')) return response.json()
  const text = await response.text()
  return text ? { message: text } : {}
}

async function request(path, options = {}) {
  let response
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers || {}),
      },
      ...options,
    })
  } catch {
    throw new AuditEventsError('无法连接审计事件服务，请确认后端服务已启动。', { code: 'NETWORK_ERROR' })
  }
  const body = await readBody(response)
  if (!response.ok) {
    throw new AuditEventsError(body.message || '审计事件查询失败。', {
      status: response.status,
      code: body.code,
      traceId: body.trace_id || body.traceId,
    })
  }
  return body.data
}

function encodeFilter(parameters) {
  const search = new URLSearchParams()
  Object.entries(parameters).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return
    search.set(`filter[${key}]`, String(value))
  })
  return search
}

/**
 * 拉取平台审计事件。
 * 字段命名：
 *   - 后端返回 event_id / occurred_at / operator_display_name / application_code / application_name
 *     / environment_code / action_type / action / result / risk_level / method / path / client_ip
 *     / status_code / detail / change_summary。
 *   - 前端模板里用的是 id / time / operator / application / environment / type / risk 这种短名，
 *     所以这里把后端数据再映射成前端模板期望的字段名。
 */
export async function listAuditEvents({
  page = 1,
  pageSize = 20,
  keyword = '',
  applicationCode = '',
  environmentCode = '',
  action = '',
  result = '',
  riskLevel = '',
  occurredFrom = '',
  occurredTo = '',
} = {}) {
  const query = new URLSearchParams({ page: String(page), page_size: String(pageSize) })
  if (keyword) query.set('keyword', keyword)
  const filter = encodeFilter({
    application_code: applicationCode,
    environment_code: environmentCode,
    action,
    result,
    risk_level: riskLevel,
    occurred_from: occurredFrom,
    occurred_to: occurredTo,
  })
  filter.forEach((value, key) => query.set(key, value))
  const data = await request(`/audit/events?${query.toString()}`)
  return {
    items: Array.isArray(data?.items) ? data.items.map(mapAuditEvent) : [],
    total: Number(data?.total || 0),
    page: Number(data?.page || page),
    pageSize: Number(data?.page_size || pageSize),
  }
}

export function getAuditEvent(eventId) {
  return request(`/audit/events/${encodeURIComponent(eventId)}`).then(mapAuditEvent)
}

export function createAuditExportJob({ keyword = '', applicationCode = '', environmentCode = '', action = '', result = '', riskLevel = '', occurredFrom = '', occurredTo = '' } = {}) {
  return request('/audit/export-jobs', {
    method: 'POST',
    body: JSON.stringify({
      keyword,
      application_code: applicationCode,
      environment_code: environmentCode,
      action,
      result,
      risk_level: riskLevel,
      occurred_from: occurredFrom,
      occurred_to: occurredTo,
    }),
  })
}

export function getAuditExportJob(jobId) {
  return request(`/audit/export-jobs/${encodeURIComponent(jobId)}`)
}

/**
 * 把后端 eventResponse 映射成前端模板的字段名。
 * - 后端 result 是 "SUCCESS" / "DENIED" / "ERROR" 等枚举；前端显示时翻译为中文。
 * - 后端 risk_level 是 "LOW" / "MEDIUM" / "HIGH"；前端模板用的是 "高" / "中" / "低"。
 * - 后端 change_summary 是 []FieldChange 数组；前端展示是字符串。
 */
function mapAuditEvent(event) {
  if (!event || typeof event !== 'object') return event
  const changeSummary = Array.isArray(event.change_summary)
    ? event.change_summary.map(formatFieldChange).filter(Boolean).join('；')
    : ''
  return {
    id: event.event_id,
    time: event.occurred_at,
    operator: event.operator_display_name || '',
    type: event.action_type || event.action || '',
    application: event.application_name || event.application_code || '',
    applicationCode: event.application_code || '',
    environment: event.environment_code || '',
    environmentCode: event.environment_code || '',
    object: event.resource_name || event.resource_type || '',
    resource: event.resource_type || '',
    action: event.action || '',
    method: event.method || '',
    path: event.path || '',
    ip: event.client_ip || '',
    statusCode: event.status_code ?? 0,
    result: event.result || '',
    resultLabel: resultLabel(event.result),
    risk: event.risk_level || '',
    riskLabel: riskLabel(event.risk_level),
    userAgent: '',
    detail: event.detail || '',
    changeSummary: changeSummary || event.summary || '',
  }
}

function formatFieldChange(change) {
  if (!change) return ''
  const field = change.field || change.name || ''
  if (!field) return ''
  if (change.from === undefined || change.to === undefined) return `${field}: ${change.value ?? ''}`
  return `${field}: ${change.from} → ${change.to}`
}

function resultLabel(value) {
  switch (String(value || '').toUpperCase()) {
    case 'SUCCESS':
      return '成功'
    case 'DENIED':
      return '拒绝'
    case 'ERROR':
      return '异常'
    case 'PARTIAL':
      return '部分成功'
    default:
      return value || '—'
  }
}

function riskLabel(value) {
  switch (String(value || '').toUpperCase()) {
    case 'HIGH':
      return '高'
    case 'MEDIUM':
      return '中'
    case 'LOW':
      return '低'
    default:
      return value || '—'
  }
}
