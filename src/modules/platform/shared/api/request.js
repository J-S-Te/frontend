// 平台前端统一 API 请求管道。
// 各平台功能模块（应用、IAM、安全、通知、审计、字典、文件、设置等）复用同一套
// fetch 行为：携带会话 Cookie、no-store 缓存、JSON 头与统一的错误解析，只保留
// 各自模块的 Error 类和提示文案。子系统模块（contract/customer/project）按
// “独立可拆分模块”设计各自保留 client，不依赖本工具。

import { attachStructuredContext } from './requestContext.js'
import { downloadRequestSignal as withRequestTimeout } from '../../../shared/utils/downloadTimeout.js'
import { formatUserError, isWriteOutcomeUnknown, safeUserMessage, userFieldErrors } from '../../../shared/utils/userError.js'

const API_BASE_URL = (import.meta.env?.VITE_API_BASE_URL || '/api/v1').replace(/\/$/, '')

/**
 * 平台接口默认超时时间（毫秒）。
 *
 * 没有超时的 fetch 在网络半开、连接被中间设备丢弃或后端进程假死时会永久挂起，
 * 页面只能一直停在“加载中”。20s 覆盖正常 CRUD；耗时更长的部署 Agent 端点由
 * 调用方通过 `options.timeoutMs` 显式放大，FormData 上传不设硬超时（与
 * shared/utils/downloadTimeout.js 的约定一致，避免慢速上传被误杀）。
 */
export const DEFAULT_REQUEST_TIMEOUT_MS = 20 * 1000

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
 * resolveTimeoutMs 归一化单次请求的超时时间。
 * @param {unknown} override 调用方通过 `options.timeoutMs` 传入的覆盖值。
 * @returns {number} 有效毫秒数；调用方显式传 0、负数或非数字时返回 0（不设超时）。
 */
function resolveTimeoutMs(override) {
  if (override === undefined || override === null) return DEFAULT_REQUEST_TIMEOUT_MS
  const ms = Number(override)
  return Number.isFinite(ms) && ms > 0 ? ms : 0
}

// 用途：生成平台各模块共用的请求管道，保留鉴权、字段和未知结果语义。
// 参数：配置包含错误类型、网络及失败文案、子系统与功能名，以及未登录回调。
// 返回值：单次请求函数，失败抛出配置的错误类型并保留既有上下文。
export function createRequest({ ErrorClass, networkMessage, failureMessage, subsystem = 'platform', feature = 'api', onUnauthorized }) {
  // 用途：发送单次请求并区分业务拒绝、读取失败与写入结果未知。
  // 参数：path 为接口路径，options 为请求参数，context 为已知业务上下文。
  // 返回值：成功数据；失败抛出带稳定状态、字段问题和追踪标识的错误。
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

    // timeoutMs 是本请求管道自己的选项，不能透传给 fetch。
    const { timeoutMs: timeoutOption, ...fetchOptions } = options
    const callerSignal = fetchOptions.signal
    // multipart 上传不设硬超时：慢速上传被中途掐断会让服务端留下半份数据。
    const isUpload = typeof FormData !== 'undefined' && fetchOptions.body instanceof FormData
    const timeoutMs = isUpload ? 0 : resolveTimeoutMs(timeoutOption)
    // 复用下载超时工具：同时保留调用方取消语义与超时语义，并给出归因。
    const timeoutGuard = timeoutMs > 0 ? withRequestTimeout(callerSignal, timeoutMs) : null
    const signal = timeoutGuard ? timeoutGuard.signal : callerSignal

    let response
    try {
      response = await fetch(`${API_BASE_URL}${path}`, {
        ...fetchOptions,
        signal,
        credentials: 'include',
        // 平台目录和用户授权投影依赖当前会话；Cookie 切换后浏览器绝不能复用
        // 上一账号的响应，因此所有平台 API 请求统一禁用缓存。
        cache: 'no-store',
        headers: {
          Accept: 'application/json',
          'Cache-Control': 'no-cache',
          ...(fetchOptions.body && !(fetchOptions.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
          // 纵深防御：写请求统一携带 CSRF 标记头，与 CRM/门户/结算/项目管理/合同等
          // 子系统客户端保持一致。后端仍以 Origin 校验为权威，这里只是第二道门禁。
          // 置于调用方自定义头之前，调用方显式传入的同名头优先。
          ...(method !== 'GET' ? { 'X-CSRF-Token': '1' } : {}),
          ...(fetchOptions.headers || {}),
        },
      })
    } catch (error) {
      const timedOut = Boolean(timeoutGuard?.timedOut())
      const aborted = error?.name === 'AbortError' || error?.name === 'TimeoutError'
      // 超时沿用既有错误类型与既有文案映射（userError 已把 *_TIMEOUT 识别为
      // 「服务响应超时」）；调用方取消仍是 REQUEST_ABORTED，其余为 NETWORK_ERROR。
      const code = timedOut ? 'REQUEST_TIMEOUT' : aborted ? 'REQUEST_ABORTED' : 'NETWORK_ERROR'
      // 超时由 AbortController 触发，底层异常名是 AbortError/TimeoutError；
      // 直接传给 formatUserError 会被误判成“读取已取消”，这里换成中性输入。
      const source = timedOut ? { status: 0, code, message: '' } : error
      const requestError = new ErrorClass(formatUserError(source, { code, status: 0, method, fallback: networkMessage }), { code, cause: error })
      requestError.outcomeUnknown = isWriteOutcomeUnknown(source, { code, status: 0, method })
      attachStructuredContext(requestError, {
        ...requestContext,
        metadata: { ...(requestContext.metadata || {}), network: true, ...(timedOut ? { timeout: true } : {}) },
      }, {
        code,
        status: 0,
      })
      timeoutGuard?.dispose()
      throw requestError
    }
    let body
    try {
      body = await readBody(response)
      if (response.ok && ![204, 205].includes(response.status) && (!Object.hasOwn(body, 'data') || (body.code && body.code !== 'OK'))) {
        const error = new Error('服务返回的信息无法识别。'); error.code = 'INVALID_RESPONSE'; throw error
      }
    } catch (cause) {
      if (timeoutGuard?.timedOut()) {
        // 响应体读取阶段也可能卡住（连接被静默丢弃）；此时按超时失败，而不是误报
        // “服务返回的信息无法识别”。
        const code = 'REQUEST_TIMEOUT'
        const timeoutError = new ErrorClass(formatUserError({ status: 0, code, message: '' }, { code, status: 0, method, fallback: networkMessage }), { code, cause })
        timeoutError.outcomeUnknown = isWriteOutcomeUnknown({ code }, { method })
        attachStructuredContext(timeoutError, {
          ...requestContext,
          metadata: { ...(requestContext.metadata || {}), network: true, timeout: true },
        }, { code, status: 0 })
        throw timeoutError
      }
      const code = 'INVALID_RESPONSE'
      const error = new ErrorClass(formatUserError(cause, { code, method }), { status: response.status, code, cause })
      error.outcomeUnknown = isWriteOutcomeUnknown(cause, { code, method })
      attachStructuredContext(error, requestContext, { status: response.status, code })
      throw error
    } finally {
      // 响应体读完（成功或失败）即撤销超时定时器与合并监听，避免悬挂定时器。
      timeoutGuard?.dispose()
    }
    if (!response.ok) {
      // SEC-X4：message 是会被各页面直接展示的文本，必须先过安全过滤；
      // details/nextAction/traceId 保持结构化字段供已鉴权管理台（权限门控内）展示排障。
      const safeFallback = userSafeErrorMessage(body?.message) || userSafeErrorMessage(body?.msg) || failureMessage
      const details = body?.details ?? body?.field_errors ?? body?.fieldErrors
      const outcomeUnknown = isWriteOutcomeUnknown(body, { status: response.status, method })
      const error = new ErrorClass(formatUserError(body, {
        status: response.status, method, fallback: safeFallback, outcomeUnknown,
      }), {
        status: response.status,
        code: body?.code,
        traceId: body?.request_id || body?.trace_id || body?.traceId,
        details,
        nextAction: body?.details?.next_action,
        detail: body?.details?.detail,
      })
      // 部分旧版 Error 类不含 details，调用方仍需要结构化字段问题。
      error.details ??= details || null
      error.fieldErrors = [400, 422].includes(response.status) ? userFieldErrors(details) : []
      error.outcomeUnknown = outcomeUnknown
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
