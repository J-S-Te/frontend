import { createRequest, API_BASE_URL } from '../../shared/api/request.js'

/**
 * SecurityError 与业务错误分类相关的错误类型定义。
 * @class
 * @property {string} name 标准错误类型名。
 */
export class SecurityError extends Error {
  constructor(message, options = {}) {
    super(message)
    this.name = 'SecurityError'
    this.status = options.status || 0
    this.code = options.code || ''
    this.traceId = options.traceId || ''
  }
}



const request = createRequest({
  ErrorClass: SecurityError,
  networkMessage: '无法连接登录安全服务，请确认后端服务已启动。',
  failureMessage: '登录安全请求失败。',
  subsystem: 'platform',
  feature: 'security',
})

function pageQuery(parameters = {}) {
  const search = new URLSearchParams()
  Object.entries(parameters).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return
    search.set(key, String(value))
  })
  const encoded = search.toString()
  return encoded ? `?${encoded}` : ''
}

function normalize(value) {
  if (!value || typeof value !== 'object') {
    return { items: [], total: 0, page: 1, pageSize: 20 }
  }
  return {
    items: Array.isArray(value.items) ? value.items : [],
    total: Number(value.total || 0),
    page: Number(value.page || 1),
    pageSize: Number(value.page_size || 20),
  }
}

// 登录策略与具体业务系统解耦，由基础平台统一执行失败计数、锁定和无操作超时。

/**
 * getLoginPolicy 查询当前租户登录安全策略配置，包括失败阈值、锁定策略和空闲超时。
 * @returns {Promise<object>} 登录策略对象。
 * @throws {Error} 网络异常、鉴权失败或后端返回错误时抛出。
 */
export function getLoginPolicy() {
  return request('/security/login-policy')
}

/**
 * updateLoginPolicy 更新登录安全策略。
 * @param {Object} options 变更参数。
 * @param {number} options.maxFailedAttempts 允许的最大连续失败次数。
 * @param {number} options.lockoutDurationSeconds 锁定持续秒数。
 * @param {number} options.failureResetWindowSeconds 失败计数清零窗口秒数。
 * @param {number} options.idleTimeoutSeconds 无操作超时秒数。
 * @param {number} options.version 并发更新乐观锁版本号。
 * @returns {Promise<object>} 更新后的登录策略。
 * @throws {Error} 会话失效、参数非法或后端更新失败时抛出。
 */
export function updateLoginPolicy({ maxFailedAttempts, lockoutDurationSeconds, failureResetWindowSeconds, idleTimeoutSeconds, version }) {
  return request('/security/login-policy', {
    method: 'PUT',
    body: JSON.stringify({
      max_failed_attempts: maxFailedAttempts,
      lockout_duration_seconds: lockoutDurationSeconds,
      failure_reset_window_seconds: failureResetWindowSeconds,
      idle_timeout_seconds: idleTimeoutSeconds,
      version,
    }),
  })
}

// 锁定账号列表只返回当前租户内仍处于锁定状态的账号；手动解锁由服务端审计。

/**
 * listLockedAccounts 获取当前租户的被锁定账号分页列表，用于安全审计与解锁操作准备。
 * @param {Object} options 查询参数。
 * @param {number} [options.page=1] 当前页码。
 * @param {number} [options.pageSize=50] 每页条数。
 * @returns {Promise<{items:Array<object>,total:number,page:number,pageSize:number}>} 标准分页响应。
 * @throws {Error} 鉴权失效、参数非法或服务端错误时抛出。
 */
export function listLockedAccounts({ page = 1, pageSize = 50 } = {}) {
  return request(`/security/locked-accounts${pageQuery({ page, page_size: pageSize })}`).then(normalize)
}

/**
 * unlockAccount 对单个账号执行手工解锁，成功后该账号可继续登录尝试。
 * @param {string|number} accountId 账号 ID。
 * @returns {Promise<object>} 解锁结果。
 * @throws {Error} 非法账号、鉴权失败或后端处理失败时抛出。
 */
export function unlockAccount(accountId) {
  return request(`/security/locked-accounts/${encodeURIComponent(accountId)}/unlock`, { method: 'POST' })
}
