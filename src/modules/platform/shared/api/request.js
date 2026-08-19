// 平台前端统一 API 请求管道。
// 各平台功能模块（应用、IAM、安全、通知、审计、字典、文件、设置等）复用同一套
// fetch 行为：携带会话 Cookie、no-store 缓存、JSON 头与统一的错误解析，只保留
// 各自模块的 Error 类和提示文案。子系统模块（contract/customer/project）按
// “独立可拆分模块”设计各自保留 client，不依赖本工具。

import { attachStructuredContext } from './requestContext.js'

const API_BASE_URL = (import.meta.env?.VITE_API_BASE_URL || '/api/v1').replace(/\/$/, '')

export { API_BASE_URL }

/** 解析响应体：优先 JSON，非 JSON 退化为 { message: text }。 */
export async function readBody(response) {
  const contentType = response.headers.get('content-type') || ''
  if (contentType.includes('application/json')) {
    try {
      return await response.json()
    } catch {
      return {}
    }
  }
  const text = await response.text()
  return text ? { message: text } : {}
}

/**
 * createRequest 生成模块化的接口请求方法，统一处理鉴权、网络错误和失败返回结构。
 * @param {Object} config 配置对象。
 * @param {Function} config.ErrorClass 失败时抛出的错误构造函数。
 * @param {string} config.networkMessage 网络异常时的提示文案。
 * @param {string} config.failureMessage 接口失败时的默认提示文案。
 * @param {string} [config.subsystem='platform'] 子系统标识。
 * @param {string} [config.feature='api'] API 功能分组。
 * @param {Function} [config.onUnauthorized] 遇到 401 时的自定义鉴权回调。
 * @returns {Function} 返回请求函数 `(path, options, context) => Promise<any>`。
 * @throws {Error} 当请求失败时抛出 `config.ErrorClass`，并带上 status/request_id 等上下文。
 */
export function createRequest({ ErrorClass, networkMessage, failureMessage, subsystem = 'platform', feature = 'api', onUnauthorized }) {
  /**
   * request 执行单次 HTTP 请求。异常统一包为统一上下文，便于日志与告警联调。
   * 对于非 401 的失败，调用方可直接依赖错误里的 status/code/detail；401 会触发 onUnauthorized。
   */
  return async function request(path, options = {}, context = {}) {
    const method = String(options.method || 'GET').toUpperCase()
    const requestContext = {
      subsystem,
      feature,
      operation: context.operation || method,
      method,
      path,
      actorId: context.actorId || '',
      tenantId: context.tenantId || '',
      metadata: context.metadata || null,
    }

    let response
    try {
      response = await fetch(`${API_BASE_URL}${path}`, {
        ...options,
        credentials: 'include',
        // 平台目录和用户授权投影依赖当前会话；Cookie 切换后浏览器绝不能复用
        // 上一账号的响应，因此所有平台 API 请求统一禁用缓存。
        cache: 'no-store',
        headers: {
          Accept: 'application/json',
          'Cache-Control': 'no-cache',
          ...(options.body && !(options.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
          ...(options.headers || {}),
        },
      })
    } catch (error) {
      const requestError = new ErrorClass(networkMessage, { code: 'NETWORK_ERROR', cause: error })
      attachStructuredContext(requestError, {
        ...requestContext,
        metadata: { ...(requestContext.metadata || {}), network: true },
      }, {
        code: 'NETWORK_ERROR',
        status: 0,
      })
      throw requestError
    }
    const body = await readBody(response)
    if (!response.ok) {
      const error = new ErrorClass(body?.message || body?.msg || failureMessage, {
        status: response.status,
        code: body?.code,
        traceId: body?.request_id || body?.trace_id || body?.traceId,
        details: body?.details,
        nextAction: body?.details?.next_action,
        detail: body?.details?.detail,
      })
      attachStructuredContext(error, {
        ...requestContext,
        requestId: body?.request_id || '',
        traceId: body?.request_id || body?.trace_id || body?.traceId || '',
        metadata: { ...requestContext.metadata, failure: true },
      }, {
        status: response.status,
        code: body?.code,
        requestId: body?.request_id || body?.request_id || '',
        traceId: body?.trace_id || body?.traceId || '',
      })

      if (response.status === 401) {
        const maybeHandle = onUnauthorized || context.onUnauthorized
        if (typeof maybeHandle === 'function') {
          maybeHandle(error)
        }
      }

      throw error
    }
    return body?.data
  }
}
