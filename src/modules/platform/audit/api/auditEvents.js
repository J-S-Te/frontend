import { createRequest } from '../../shared/api/request.js'

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

/**
 * 把后端 eventResponse 映射成前端模板的字段名。
 * - 后端 result 是 "SUCCESS" / "FAILURE" / "DENIED"；前端显示时翻译为中文。
 * - 后端 risk_level 是 "LOW" / "MEDIUM" / "HIGH" / "CRITICAL"；前端显示中文标签。
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
