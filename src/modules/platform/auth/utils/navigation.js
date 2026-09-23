const DEFAULT_REDIRECT_PATH = '/'

/**
 * 将登录成功后的回跳地址限制在当前站点，避免接口返回值导致跨站跳转。
 *
 * @param {unknown} candidate 服务端或环境变量提供的回跳地址。
 * @param {string} [origin] 当前站点源地址，便于在调用方或测试中显式传入。
 * @returns {string} 当前站点内可安全跳转的路径；非法地址回退到首页。
 */
export function resolveSameOriginRedirect(candidate, origin = window.location.origin) {
  if (typeof candidate !== 'string' || candidate.trim() === '') {
    return DEFAULT_REDIRECT_PATH
  }

  try {
    const target = new URL(candidate, origin)
    if (target.origin !== origin) {
      return DEFAULT_REDIRECT_PATH
    }

    return `${target.pathname}${target.search}${target.hash}`
  } catch {
    return DEFAULT_REDIRECT_PATH
  }
}

/**
 * 校验由平台后端从登录目标注册表解析出的跳转地址。
 *
 * 相对地址和同源地址仍转换为站内路径；跨源地址只允许无用户凭据的 HTTPS URL。
 * 此函数不能用于处理浏览器直接提交的任意 return_to 参数。
 *
 * @param {unknown} candidate 平台登录接口返回的已登记目标地址。
 * @param {string} [origin] 当前站点源地址，便于测试显式传入。
 * @returns {string} 可安全导航的地址；非法地址回退到首页。
 */
export function resolveServerApprovedRedirect(candidate, origin = window.location.origin) {
  if (typeof candidate !== 'string' || candidate.trim() === '') {
    return DEFAULT_REDIRECT_PATH
  }

  try {
    const target = new URL(candidate, origin)
    if (target.username || target.password) {
      return DEFAULT_REDIRECT_PATH
    }
    if (target.origin === origin) {
      return `${target.pathname}${target.search}${target.hash}`
    }
    if (target.protocol !== 'https:') {
      return DEFAULT_REDIRECT_PATH
    }
    // SEC-X7：跨源回跳仅校验了 scheme（信任服务端登录目标注册表的登记结果）。
    // 记录告警以便在注册表被误配/污染时，从浏览器端审计日志发现"登录后跳到非本站点"
    // 的行为；如需进一步收紧，可在注册表侧维护允许的跨源域白名单后再改为直接拒绝。
    console.warn('[security] 登录回跳解析为跨源 HTTPS 目标（仅校验 scheme，请与登录目标注册表核对）：', target.href)
    return target.href
  } catch {
    return DEFAULT_REDIRECT_PATH
  }
}
