// 合同预览 HTML 净化：预览文档由服务端生成，但会嵌入用户提交的模板值。
// 渲染前剥离可执行元素、事件属性和危险 URL，只保留排版所需的静态标签。
const EVENT_ATTR = /\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi
const DANGEROUS_URL = /(\s(?:href|src|xlink:href)\s*=\s*)(?:"[^"]*"|'[^']*'|[^\s>]+)/gi
const BLOCKED_PAIR = /<\s*(script|iframe|object|embed|link|meta|form|input|button|select|textarea|svg|math|base|applet|audio|video|source|track|frameset|frame|noscript)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi
const BLOCKED_SINGLE = /<\s*(script|iframe|object|embed|link|meta|form|input|button|select|textarea|svg|math|base|applet|audio|video|source|track|frameset|frame|noscript)\b[^>]*\/?\s*>/gi

export function sanitizePreviewHTML(raw) {
  if (typeof raw !== 'string') return ''
  let html = raw
  // 1. 整体移除可执行/交互元素：先处理成对标签（含内容），再处理自闭合形式。
  html = html.replace(BLOCKED_PAIR, '')
  html = html.replace(BLOCKED_SINGLE, '')
  // 2. 剥离所有 on* 事件属性。
  html = html.replace(EVENT_ATTR, '')
  // 3. href/src 只保留 http(s)/相对路径/锚点/mailto，javascript:/data:/vbscript: 一律移除。
  html = html.replace(DANGEROUS_URL, (match, prefix) => {
    const rawValue = match.slice(prefix.length).trim()
    const value = rawValue.replace(/^["']|["']$/g, '').trim()
    if (/^\s*(javascript|data|vbscript):/i.test(value)) {
      return ''
    }
    if (/^(https?:\/\/|\/|#|mailto:)/i.test(value)) {
      return prefix + JSON.stringify(value)
    }
    return ''
  })
  return html
}
