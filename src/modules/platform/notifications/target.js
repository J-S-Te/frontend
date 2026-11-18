// 统一收件箱的详情跳转收敛：通知内容属于不可信输入，只允许与当前页面同源的
// 相对业务路径，禁止协议相对 URL、跨源地址和带凭据的地址，避免开放重定向。
// 目标页面仍必须用自己的接口重新校验对象级权限，通知本身不携带授权。
export function notificationTargetPath(targetURL, origin = globalThis.location?.origin) {
  if (typeof targetURL !== 'string' || !targetURL.trim() || !origin) return ''
  let target
  try {
    target = new URL(targetURL, origin)
  } catch {
    return ''
  }
  if (target.origin !== origin || target.username || target.password) return ''
  if (target.protocol !== 'http:' && target.protocol !== 'https:') return ''
  if (!target.pathname.startsWith('/')) return ''
  return `${target.pathname}${target.search}${target.hash}`
}
