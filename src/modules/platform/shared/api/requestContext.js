/**
 * 结构化 API 上下文，用于错误归档、告警分组和跨子系统追踪。
 * 所有子系统的请求都应该在抛出错误时带齐这些字段。
 *
 * @typedef {Object} ApiRequestContext
 * @property {string} subsystem - 子系统标识。
 * @property {string} feature - API 功能分组。
 * @property {string} operation - 业务动词，建议与调用的 API 行为一致。
 * @property {string} method - HTTP 方法。
 * @property {string} path - 相对请求路径。
 * @property {string} [actorId] - 发起人 ID（匿名环境可为空）。
 * @property {string} [tenantId] - 租户 ID。
 * @property {string} [requestId] - 服务端返回的请求 ID。
 * @property {string} [traceId] - 链路追踪 ID。
 * @property {Object} [metadata] - 额外业务元数据，用于离线分析。
 */

/**
 * createApiRequestContext 创建标准化请求上下文字段，供错误附加字段和日志统一解析使用。
 * @param {Object} [context] 传入的上下文覆盖值。
 * @param {string} [context.subsystem='unknown'] 业务子系统编码。
 * @param {string} [context.feature='api'] 功能分组。
 * @param {string} [context.operation=''] 业务动作或方法名。
 * @param {string} [context.method='GET'] HTTP 方法。
 * @param {string} [context.path=''] 请求路径。
 * @param {string} [context.actorId=''] 发起人 ID。
 * @param {string} [context.tenantId=''] 租户 ID。
 * @param {string} [context.requestId=''] 服务器请求 ID。
 * @param {string} [context.traceId=''] Trace 链路 ID。
 * @param {Object|null} [context.metadata=null] 额外上下文。
 * @returns {Object} 返回补齐默认值后的标准化上下文对象。
 */
export function createApiRequestContext({
  subsystem = 'unknown',
  feature = 'api',
  operation = '',
  method = 'GET',
  path = '',
  actorId = '',
  tenantId = '',
  requestId = '',
  traceId = '',
  metadata = null,
} = {}) {
  return {
    subsystem,
    feature,
    operation: operation || (String(method || 'GET').toUpperCase()),
    method: String(method || 'GET').toUpperCase(),
    path,
    actorId,
    tenantId,
    requestId,
    traceId,
    metadata: metadata || {},
    generatedAt: new Date().toISOString(),
  }
}

/**
 * attachStructuredContext 将统一上下文与错误字段进行合并，不改变错误类别语义。
 * 当上下文存在时，补齐 requestId/status/code/request_id 等诊断字段；如字段缺失，会尝试注入。
 * @param {Object|Error} error 需要补齐上下文的错误对象。
 * @param {Object} [context={}] 结构化上下文。
 * @param {Object} [details={}] 接口返回的异常细节。
 * @returns {Object|Error} 返回注入了上下文后的错误对象。
 */
export function attachStructuredContext(error, context = {}, details = {}) {
  if (!error || typeof error !== 'object') return error

  const normalized = createApiRequestContext(context)
  if (Object.prototype.hasOwnProperty.call(error, 'context')) {
    error.context = { ...normalized, ...error.context }
  } else {
    error.context = normalized
  }

  if (details.status && !error.status) error.status = details.status
  if (details.code && !error.code) error.code = details.code
  if (details.requestId && !error.requestID && !error.requestId) {
    error.requestID = details.requestId
    error.requestId = details.requestId
  }
  if (details.traceId && !error.traceId) error.traceId = details.traceId
  if (!error.subsystem) error.subsystem = normalized.subsystem
  if (!error.operation && normalized.operation) error.operation = normalized.operation
  if (!error.request_path && normalized.path) error.request_path = normalized.path
  if (!error.request_method && normalized.method) error.request_method = normalized.method

  return error
}
