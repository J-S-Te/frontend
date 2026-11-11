// 写操作幂等键 / 请求标识生成器。
//
// 背景：crypto.randomUUID 只在安全上下文（HTTPS、localhost、file://）暴露。生产里常见的
// http://<内网IP>:<端口> 明文部署下，globalThis.crypto 仍然存在，但 randomUUID 为 undefined，
// 直接 crypto.randomUUID() 会在“构造请求头”这一步抛 TypeError，导致新建/更新/作废/合并等
// 所有带幂等的写操作在浏览器端直接失败，请求根本发不出去。
// 因此这里统一降级，不依赖安全上下文：
// - 优先 randomUUID（安全上下文，全局唯一）；
// - 否则用“时间戳 + 进程内自增序号 + base36 随机数”。幂等键只需要区分同一客户端的
//   不同次业务意图（重放时必须复用同一个键），不要求密码学随机性，也不参与鉴权。
let fallbackSequence = 0

/**
 * createIdempotencyKey 生成一次写操作的幂等键。
 * @returns {string} 非空幂等键；安全上下文返回 UUID，否则返回 fallback- 前缀的降级键。
 */
export function createIdempotencyKey() {
  const cryptoImpl = globalThis.crypto
  // 必须以方法形式调用：部分浏览器实现要求正确的 this，取出函数再调用会抛 Illegal invocation。
  if (typeof cryptoImpl?.randomUUID === 'function') {
    try {
      return cryptoImpl.randomUUID()
    } catch {
      // 实现不可用（例如被策略禁用）时继续走降级，不能让写操作在构造请求头时中断。
    }
  }
  // 序号取模避免长时间挂机后无限增长；同一毫秒内的连续调用也能保持互不相同。
  fallbackSequence = (fallbackSequence + 1) % 0x100000
  return `fallback-${Date.now().toString(36)}-${fallbackSequence.toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}
