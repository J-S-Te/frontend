import { API_BASE_URL, createRequest, readBody } from '../../shared/api/request.js'
import { attachStructuredContext } from '../../shared/api/requestContext.js'
import { formatUserError } from '../../../shared/utils/userError.js'

/**
 * AuditEventsError 与业务错误分类相关的错误类型定义。
 * @class
 * @property {string} name 标准错误类型名。
 */
export class AuditEventsError extends Error {
  constructor(message, options = {}) {
    super(message)
    this.name = 'AuditEventsError'
    this.status = options.status || 0
    this.code = options.code || ''
    this.traceId = options.traceId || ''
  }
}



const request = createRequest({
  ErrorClass: AuditEventsError,
  networkMessage: '无法连接审计事件服务，请确认后端服务已启动。',
  failureMessage: '审计事件查询失败。',
  subsystem: 'platform',
  feature: 'audit',
})

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
  actionCategory = '',
  result = '',
  riskLevel = '',
  clientIp = '',
  resourceId = '',
  requestId = '',
  occurredFrom = '',
  occurredTo = '',
  signal,
} = {}) {
  const query = new URLSearchParams({ page: String(page), page_size: String(pageSize) })
  if (keyword) query.set('keyword', keyword)
  const filter = encodeFilter({
    application_code: applicationCode,
    environment_code: environmentCode,
    action,
    action_category: actionCategory,
    result,
    risk_level: riskLevel,
    // 批次 3 查询维度：操作地址、对象、链路 ID。
    client_ip: clientIp,
    resource_id: resourceId,
    request_id: requestId,
    occurred_from: occurredFrom,
    occurred_to: occurredTo,
  })
  filter.forEach((value, key) => query.set(key, value))
  const data = await request(`/audit/events?${query.toString()}`, { signal })
  return {
    items: Array.isArray(data?.items) ? data.items.map(mapAuditEvent) : [],
    total: Number(data?.total || 0),
    page: Number(data?.page || page),
    pageSize: Number(data?.page_size || pageSize),
  }
}

/**
 * createAuditExportJob 创建审计导出任务，用于异步导出满足筛选条件的审计结果。
 * @param {Object} options 筛选条件。
 * @param {string} [options.keyword=''] 全文关键字。
 * @param {string} [options.applicationCode=''] 应用代码。
 * @param {string} [options.environmentCode=''] 环境代码。
 * @param {string} [options.action=''] 动作类型。
 * @param {string} [options.actionCategory=''] 动作分类。
 * @param {string} [options.result=''] 处理结果。
 * @param {string} [options.riskLevel=''] 风险等级。
 * @param {string} [options.occurredFrom=''] 起始时间。
 * @param {string} [options.occurredTo=''] 截止时间。
 * @returns {Promise<object>} 导出任务对象。
 * @throws {Error} 鉴权失败或参数异常时抛出。
 */
export function createAuditExportJob({ keyword = '', applicationCode = '', environmentCode = '', action = '', actionCategory = '', result = '', riskLevel = '', occurredFrom = '', occurredTo = '' } = {}) {
  return request('/audit/export-jobs', {
    method: 'POST',
    body: JSON.stringify({
      keyword,
      application_code: applicationCode,
      environment_code: environmentCode,
      action,
      action_category: actionCategory,
      result,
      risk_level: riskLevel,
      occurred_from: occurredFrom,
      occurred_to: occurredTo,
    }),
  })
}

/** 查询审计导出任务状态。 */
export function getAuditExportJob(jobId) {
  return request(`/audit/export-jobs/${encodeURIComponent(jobId)}`)
}

/** 返回同源、受会话保护的下载地址；服务端仍会再次执行租户和权限校验。 */
/**
 * 拉取平台侧审计摄取健康度（批次 3）。
 *
 * 口径：平台已接收的审计事件（近期接收量、来源未采集数、最后接收时间），
 * 用于发现上报停摆；不含各子系统本地 Outbox 的积压量。
 */
export async function getAuditIngestionHealth({ signal } = {}) {
  return (await request('/audit/ingestion-health', { signal })) || {}
}

export function auditExportDownloadURL(jobId) {
  return `${API_BASE_URL}/audit/export-jobs/${encodeURIComponent(jobId)}/download`
}

/** 下载被拒绝时停留在当前页面，避免跳转至原始 JSON/HTML。 */
export async function downloadAuditExportFile(jobId) {
  const path = `/audit/export-jobs/${encodeURIComponent(jobId)}/download`
  const context = { subsystem: 'platform', feature: 'audit_download', method: 'GET', operation: 'GET', path }
  const failure = (body, status, code) => {
    const error = new AuditEventsError(formatUserError(body, { status, code, fallback: '审计文件下载失败，请稍后重新下载。' }), { status, code: code || body?.code })
    error.details = body?.details || null
    return attachStructuredContext(error, context, { status, code: error.code, requestId: body?.request_id, traceId: body?.trace_id || body?.traceId })
  }
  let response
  try { response = await fetch(auditExportDownloadURL(jobId), { credentials: 'include', cache: 'no-store', headers: { Accept: 'text/csv, application/octet-stream' } }) }
  catch { throw failure(null, 0, 'NETWORK_ERROR') }
  if (!response.ok) throw failure(await readBody(response), response.status)
  const type = (response.headers.get('content-type') || '').split(';', 1)[0].trim().toLowerCase()
  const disposition = response.headers.get('content-disposition') || ''
  if (type !== 'text/csv' && !(type === 'application/octet-stream' && /^attachment\b/i.test(disposition))) throw failure(null, response.status, 'INVALID_DOWNLOAD_RESPONSE')
  let blob
  try { blob = await response.blob() }
  catch { throw failure(null, response.status, 'NETWORK_ERROR') }
  if (!blob.size) throw failure(null, response.status, 'INVALID_DOWNLOAD_RESPONSE')
  const name = disposition.match(/filename\*=UTF-8''([^;]+)/i) || disposition.match(/filename="?([^";]+)/i)
  let filename = 'audit-export.csv'
  if (name) {
    try {
      const candidate = decodeURIComponent(name[1]).replace(/[\\/\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, '_').trim()
      if (candidate.length <= 180 && /\.csv$/i.test(candidate)) filename = candidate
    } catch { /* 文件名无效不影响已经接收的 CSV 数据。 */ }
  }
  return { blob, filename }
}

/**
 * 把后端 eventResponse 映射成前端模板的字段名。
 * - 后端 result 是 "SUCCESS" / "FAILURE" / "DENIED"；前端显示时翻译为中文。
 * - 后端 risk_level 是 "LOW" / "MEDIUM" / "HIGH" / "CRITICAL"；前端显示中文标签。
 * - 后端 change_summary 是 []FieldChange 数组；前端展示是字符串。
 */
export function mapAuditEvent(event) {
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
    // 统一审计来源协议：列表默认展示"操作 IP"；登录 IP 与投递地址只在详情里展示，
    // 三者含义不同，不能用一个字段互相顶替。
    ip: event.client_ip || '',
    loginIp: event.login_ip || '',
    ingestPeerIp: event.ingest_peer_ip || '',
    ipSource: event.ip_source || '',
    ipSourceLabel: ipSourceLabel(event.ip_source),
    userAgent: event.user_agent || '',
    requestId: event.request_id || '',
    traceId: event.trace_id || '',
    correlationId: event.correlation_id || '',
    statusCode: event.status_code ?? 0,
    result: event.result || '',
    resultLabel: resultLabel(event.result),
    risk: event.risk_level || '',
    riskLabel: riskLabel(event.risk_level),
    detail: event.detail || '',
    summary: event.summary || '',
    changeSummary,
  }
}

/**
 * 地址来源标记翻译。历史记录是 LEGACY_RECORD，旧发布方是 LEGACY_PROTOCOL，
 * 没有采集到地址时是 UNKNOWN——界面必须如实显示"未采集/来源未知"，不能猜。
 */
export function ipSourceLabel(source) {
  return {
    DIRECT: '直连采集',
    TRUSTED_PROXY: '可信代理解析',
    LEGACY_PROTOCOL: '旧协议上报',
    LEGACY_RECORD: '历史记录（旧口径）',
    UNKNOWN: '未采集／来源未知',
  }[source] || '未采集／来源未知'
}

function formatFieldChange(change) {
  if (!change) return ''
  const field = change.field || change.name || ''
  if (!field) return ''
  const before = change.before ?? change.from
  const after = change.after ?? change.to
  if (before === undefined && after === undefined) return `${field}: ${change.value ?? ''}`
  return `${field}: ${before ?? '—'} → ${after ?? '—'}`
}

function resultLabel(value) {
  switch (String(value || '').toUpperCase()) {
    case 'SUCCESS':
      return '成功'
    case 'FAILURE':
      return '失败'
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
    case 'CRITICAL':
      return '严重'
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
