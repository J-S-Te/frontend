// portalPublicURL 阻止未编译模块通过同站地址再次进入当前 SPA。
// 参数：value 为后端入口，prefixes 为未编译路径，origin 为当前站点来源。
// 返回值：可保留的后端地址；同站未编译路径或无效地址返回空串。
export function portalPublicURL(value, prefixes, origin = globalThis.location?.origin) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  try {
    const base = origin || 'http://localhost'
    const url = new URL(raw, base)
    const path = decodeURIComponent(url.pathname).replace(/\/+$/, '')
    const unavailable = prefixes.some((prefix) => {
      const normalized = String(prefix).replace(/\/+$/, '')
      return path === normalized || path.startsWith(`${normalized}/`)
    })
    return url.origin === new URL(base).origin && unavailable ? '' : raw
  } catch {
    return ''
  }
}
