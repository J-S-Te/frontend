// 平台前端统一 API 请求管道。
// 各平台功能模块（应用、IAM、安全、通知、审计、字典、文件、设置等）复用同一套
// fetch 行为：携带会话 Cookie、no-store 缓存、JSON 头与统一的错误解析，只保留
// 各自模块的 Error 类和提示文案。子系统模块（contract/customer/project）按
// “独立可拆分模块”设计各自保留 client，不依赖本工具。

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
 * 生成绑定到模块 Error 类的 request 函数。
 * @param {{ErrorClass: Function, networkMessage: string, failureMessage: string}} config
 * @returns {(path: string, options?: Object) => Promise<any>}
 */
export function createRequest({ ErrorClass, networkMessage, failureMessage }) {
  return async function request(path, options = {}) {
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
      throw new ErrorClass(networkMessage, { code: 'NETWORK_ERROR', cause: error })
    }
    const body = await readBody(response)
    if (!response.ok) {
      throw new ErrorClass(body?.message || body?.msg || failureMessage, {
        status: response.status,
        code: body?.code,
        traceId: body?.request_id || body?.trace_id || body?.traceId,
        details: body?.details,
        nextAction: body?.details?.next_action,
        detail: body?.details?.detail,
      })
    }
    return body?.data
  }
}
