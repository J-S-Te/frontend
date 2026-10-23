// 平台前端统一 API 请求管道。
// 各平台功能模块（应用、IAM、安全、通知、审计、字典、文件、设置等）复用同一套
// fetch 行为：携带会话 Cookie、no-store 缓存、JSON 头与统一的错误解析，只保留
// 各自模块的 Error 类和提示文案。子系统模块（contract/customer/project）按
// “独立可拆分模块”设计各自保留 client，不依赖本工具。

import { attachStructuredContext } from './requestContext.js'
import { formatUserError, safeUserMessage, userFieldErrors } from '../../../shared/utils/userError.js'

const API_BASE_URL = (import.meta.env?.VITE_API_BASE_URL || '/api/v1').replace(/\/$/, '')

export { API_BASE_URL }

/**
 * userSafeErrorMessage 过滤可能泄露接口地址、追踪标识或服务端实现细节的错误信息。
 *
 * SEC-X4：复用 contract 模块 userSafeErrorMessage 的做法。未登录页与通用错误提示
 * 只允许展示已本地化的安全文案；details.detail、next_action、trace/request_id 等
 * 结构化排障字段仍原样保留在 error 对象上，供权限门控内的管理台与日志检索使用，
 * 但绝不进入面向用户的 message 文本。
 *
 * @param {unknown} message 待筛选的错误信息。
 * @returns {string} 可安全展示的文本；不安全或空文本返回空字符串。
 */
export function userSafeErrorMessage(message) {
  return safeUserMessage(message)
}

/** 错误页面不是 API 结果，绝不能将代理返回的 HTML 页面直接展示为提示。 */
export async function readBody(response) {
  if (response.status === 204 || response.status === 205) return {}
  const contentType = (response.headers.get('content-type') || '').toLowerCase()
  if (contentType.includes('application/json') || contentType.includes('+json')) {
    try {
      const body = await response.json()
      if (body && typeof body === 'object' && !Array.isArray(body)) return body
    } catch (cause) {
      if (!response.ok) return {}
      const error = new Error('服务返回的信息无法识别。', { cause })
      error.code = 'INVALID_RESPONSE'
      throw error
    }
  }
  if (!response.ok) return {}
  const error = new Error('服务返回的信息无法识别。')
  error.code = 'INVALID_RESPONSE'
  throw error
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
      const code = error?.name === 'AbortError' ? 'REQUEST_ABORTED' : 'NETWORK_ERROR'
      const requestError = new ErrorClass(formatUserError(error, { code, method, fallback: networkMessage }), { code, cause: error })
      attachStructuredContext(requestError, {
        ...requestContext,
        metadata: { ...(requestContext.metadata || {}), network: true },
      }, {
        code,
        status: 0,
      })
      throw requestError
    }
    let body
    try {
      body = await readBody(response)
      if (response.ok && ![204, 205].includes(response.status) && (!Object.hasOwn(body, 'data') || (body.code && body.code !== 'OK'))) {
        const error = new Error('服务返回的信息无法识别。'); error.code = 'INVALID_RESPONSE'; throw error
      }
    } catch (cause) {
      const code = 'INVALID_RESPONSE'
      const error = new ErrorClass(formatUserError(cause, { code, method }), { status: response.status, code, cause })
      attachStructuredContext(error, requestContext, { status: response.status, code })
      throw error
    }
    if (!response.ok) {
      // SEC-X4：message 是会被各页面直接展示的文本，必须先过安全过滤；
      // details/nextAction/traceId 保持结构化字段供已鉴权管理台（权限门控内）展示排障。
      const safeFallback = userSafeErrorMessage(body?.message) || userSafeErrorMessage(body?.msg) || failureMessage
      const error = new ErrorClass(formatUserError(body, { status: response.status, method, fallback: safeFallback }), {
        status: response.status,
        code: body?.code,
        traceId: body?.request_id || body?.trace_id || body?.traceId,
        details: body?.details,
        nextAction: body?.details?.next_action,
        detail: body?.details?.detail,
      })
      // 部分旧版 Error 类不含 details，调用方仍需要结构化字段问题。
      error.details ??= body?.details || null
      error.fieldErrors = [400, 422].includes(response.status) ? userFieldErrors(body?.details) : []
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
