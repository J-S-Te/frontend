import { createIdempotencyKey } from '../../shared/utils/idempotencyKey.js'

// 用途：将元金额转换为精确整数分，避免浮点舍入。
// 参数：value 为非负十进制元字符串，最多两位小数。
// 返回值：整数分字符串；非法格式抛出校验错误。
export function toMinor(value) {
  const text = String(value).trim()
  if (!/^(0|[1-9]\d*)(\.\d{1,2})?$/.test(text)) throw new Error('金额必须为非负数字，最多两位小数')
  const [whole, fraction = ''] = text.split('.')
  return String(BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0')))
}

// 用途：精确展示服务端整数分金额。
// 参数：value 为带符号十进制整数分字符串。
// 返回值：固定两位小数元金额；非法值显示不可用。
export function formatMinor(value) {
  if (typeof value !== 'string' || !/^-?\d+$/.test(value)) return '不可用'
  const amount = BigInt(value)
  const positive = amount < 0n ? -amount : amount
  return `${amount < 0n ? '-' : ''}${positive / 100n}.${String(positive % 100n).padStart(2, '0')}`
}

// 用途：把客户端校验错误绑定到页面字段坐标，便于滚动定位和标红。
// 参数：message 为业务原因，field 为页面 data-field 坐标。
// 返回值：携带 details 的校验错误。
function fieldError(message, field) {
  return Object.assign(new Error(message), { details: [{ field, message }] })
}

// 用途：校验费用项目分摊与票据用量的精确金额边界。
// 参数：items 为待保存费用项集合。
// 返回值：无；金额非法、项目缺失或分摊不平时抛出带字段坐标的错误。
export function validateItems(items) {
  if (!Array.isArray(items) || !items.length) throw fieldError('请至少添加一项费用', 'items')
  for (const [index, item] of items.entries()) {
    const field = (leaf) => `items[${index}].${leaf}`
    if (!/^[1-9]\d*$/.test(item.requested_minor)) throw fieldError('费用金额必须大于零', field('requested_minor'))
    const allocations = item.allocations || []
    if (!allocations.length || allocations.some((row) => !/^\d+$/.test(row.amount_minor))
      || allocations.reduce((sum, row) => sum + BigInt(row.amount_minor), 0n) !== BigInt(item.requested_minor)) {
      throw fieldError('项目分摊合计必须等于费用金额', field('allocations'))
    }
    if (allocations.some((row) => !row.project_id)) throw fieldError('请选择具有费用资格的项目', field('allocations'))
    const usages = item.invoice_usages || []
    if (usages.some((row) => !row.invoice_id || !/^[1-9]\d*$/.test(row.used_minor))) {
      throw fieldError('票据和使用金额不完整', field('invoice_usages'))
    }
    if (usages.reduce((sum, row) => sum + BigInt(row.used_minor), 0n) > BigInt(item.requested_minor)) {
      throw fieldError('票据使用金额不能超过该项费用', field('invoice_usages'))
    }
  }
}

// 用途：构造保留HTTP和业务语义的公开错误。
// 参数：body 为错误信封，status 为状态，unknown 表示写入结果未知，method 为请求方法。
// 返回值：附带请求追踪、请求方法与字段错误的Error。
function apiError(body, status, unknown = false, method = 'GET') {
  const error = new Error(unknown ? '操作结果尚未确认，请查询原命令后重试。' : body?.message || '报销服务暂不可用')
  return Object.assign(error, { status, code: body?.code || 'INVALID_RESPONSE',
    requestID: body?.request_id || '', details: body?.details || body?.field_errors,
    outcomeUnknown: unknown, method })
}

// 用途：为旧版 Safari 提供请求超时信号，避免 AbortSignal.timeout 缺失时请求全部失败。
// 参数：ms 为超时毫秒数。
// 返回值：超时后自动中止的 AbortSignal。
export function timeoutSignal(ms) {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return AbortSignal.timeout(ms)
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  if (typeof timer?.unref === 'function') timer.unref()
  return controller.signal
}

// 用途：创建隔离可测试的报销HTTP客户端。
// 参数：fetcher 为网络实现，base 为公开API前缀。
// 返回值：只在合法data信封时确认成功的客户端。
export function createClient({ fetcher = (...args) => fetch(...args), base = '/reimbursement/api/v1' } = {}) {
  return {
    // 用途：发送带Cookie和同源CSRF标记的请求。
    // 参数：path 为业务路径，options 为fetch配置。
    // 返回值：真实data；网络或信封异常抛错且保留未知写入标记。
    async request(path, options = {}) {
      const method = String(options.method || 'GET').toUpperCase()
      const mutation = !['GET', 'HEAD'].includes(method)
      let response
      try {
        response = await fetcher(`${base}${path}`, { ...options, method, credentials: 'include',
          signal: options.signal || timeoutSignal(60000),
          headers: { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}),
            ...(mutation ? { 'X-CSRF-Token': '1' } : {}), ...options.headers } })
      } catch { throw apiError({ code: 'NETWORK_ERROR' }, 0, mutation, method) }
      let body
      try { body = await response.json() } catch { throw apiError(null, response.status, mutation, method) }
      if (!response.ok) throw apiError(body, response.status, mutation && response.status >= 500, method)
      if (!body || !Object.hasOwn(body, 'data') || body.data === null
        || (mutation && (typeof body.data !== 'object' || Array.isArray(body.data)
          || Object.keys(body.data).length === 0))) {
        throw apiError(body, response.status, mutation, method)
      }
      return body.data
    },
  }
}

// 用途：管理一次未确认命令，阻止重复点击或断网产生新业务事实。
// 参数：client 为HTTP客户端，uuid 为命令ID生成器。
// 返回值：执行、查询及待确认状态；命令仅保留于当前页面内存。
export function createCommandRunner(client, uuid = createIdempotencyKey) {
  let pending = null
  let busy = false
  // 用途：查询原命令的权威结果；失败时保留命令。
  // 参数：无。
  // 返回值：命令结果；不存在或服务不可用时抛错。
  async function resolve() {
    if (!pending) throw new Error('没有待确认命令')
    const data = await client.request(`/commands/${encodeURIComponent(pending.command_id)}`)
    if (!data || typeof data !== 'object' || Array.isArray(data) || !Object.keys(data).length) {
      throw apiError(null, 200, true, 'GET')
    }
    pending = null
    return data
  }
  return {
    pending: () => pending,
    resolve,
    // 用途：显式重试未确认原命令，不采纳之后的表单编辑。
    // 参数：无。
    // 返回值：原命令查询或重放结果；未完成时继续保留。
    retry() {
      if (!pending) throw new Error('没有待确认命令')
      return this.execute(pending.key, pending.path, pending.payload, pending.method)
    },
    // 用途：执行命令，未知结果先查询，明确未提交才复用原命令重试。
    // 参数：key 为界面动作键，path 为API，payload 为业务内容，method 为请求方法。
    // 返回值：服务端结果；冲突或结果未知抛错。
    async execute(key, path, payload, method = 'POST') {
      if (busy) throw new Error('原命令正在处理中，请勿重复操作')
      const fingerprint = JSON.stringify([key, path, payload, method])
      if (pending && pending.fingerprint !== fingerprint) throw new Error('请先查询原命令，不能更换内容或另起操作')
      busy = true
      try {
        if (pending) {
          try { return await resolve() } catch (error) {
            if (error.status !== 404) throw error
          }
        } else pending = { key, path, payload: JSON.parse(JSON.stringify(payload)),
          method, fingerprint, command_id: uuid() }
        try {
          const result = await client.request(path, { method,
            body: JSON.stringify({ ...pending.payload, command_id: pending.command_id }) })
          pending = null
          return result
        } catch (error) {
          if (!error.outcomeUnknown) pending = null
          throw error
        }
      } finally { busy = false }
    },
  }
}
