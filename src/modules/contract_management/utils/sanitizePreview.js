// 合同预览 HTML 净化（SEC-X1 安全改造：正则沙箱 → HTML 词法解析 + 标签/属性白名单）。
//
// 安全理由（为什么必须替换旧正则实现）：
// 1) 旧实现的 EVENT_ATTR / DANGEROUS_URL 正则都要求属性前有空白（\s），但 HTML5 词法允许
//    属性紧邻前一个引号值或斜杠：src="/nope.png"onerror=… 、src="/x" /onerror=… 、
//    <details open/ontoggle=…> —— 浏览器会把它们当作独立的事件属性解析并执行，
//    审计已在 Chrome 实测穿透。本文件的输出是全站唯一 v-html 汇点（ContractDocumentPreview），
//    绕过即存储型 XSS。
// 2) 因此改为按 HTML5 词法自行分词解析（对齐浏览器 "reconsume" 行为：引号值后、斜杠后的
//    属性名都会被识别为独立属性），再按白名单重新序列化：
//    - 标签白名单：只输出排版所需静态标签，script/svg/math/form 等危险元素连同内容整体丢弃；
//    - 属性白名单：on* 事件属性、srcdoc、formaction、xlink:href 等永不在白名单内；
//    - URL scheme 白名单：href/src 解码 HTML 实体并剥离控制字符后仅允许 http/https/mailto/相对路径；
//    任何"解析器看不见"的写法都不可能出现在输出里，失败方向一律 fail-closed（丢弃剩余输入）。
// 3) 不引入 DOMPurify：本仓库测试在 Node（无 DOMParser/document）下用 node --test 运行，
//    引入 DOMPurify 还需连带 jsdom 等依赖与联网安装；自实现词法解析 + 白名单可离线、可审计，
//    且合同预览只需覆盖受限的文档排版标签子集。

// 危险元素：连同内容一起丢弃（对齐旧 BLOCKED_* 语义，另补 template——其内容对渲染不可见，
// 保留只会给解析器制造歧义）。
const BLOCKED_TAGS = new Set([
  'script', 'iframe', 'object', 'embed', 'link', 'meta', 'form', 'input', 'button',
  'select', 'textarea', 'svg', 'math', 'base', 'applet', 'audio', 'video', 'source',
  'track', 'frameset', 'frame', 'noscript', 'template',
])

// HTML void 元素：没有结束标签，遇到时只丢弃起始标签本身（否则会误删后续正文）。
const VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta',
  'param', 'source', 'track', 'wbr', 'frame',
])

// 排版标签白名单：合同/模板预览所需的静态文档子集。未列出的标签（含所有未知标签）
// 一律不输出标签本身，仅保留其文本内容。
const ALLOWED_TAGS = new Set([
  'a', 'abbr', 'acronym', 'address', 'article', 'aside', 'b', 'bdi', 'bdo', 'big',
  'blockquote', 'br', 'caption', 'center', 'cite', 'code', 'col', 'colgroup', 'dd',
  'del', 'details', 'dfn', 'div', 'dl', 'dt', 'em', 'figcaption', 'figure', 'footer',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hgroup', 'hr', 'i', 'ins', 'kbd',
  'li', 'main', 'mark', 'ol', 'p', 'pre', 'q', 'rp', 'rt', 'ruby', 's', 'samp',
  'section', 'small', 'span', 'strike', 'strong', 'sub', 'summary', 'sup', 'table',
  'tbody', 'td', 'tfoot', 'th', 'thead', 'time', 'tr', 'tt', 'u', 'ul', 'var',
  'wbr', 'img', 'style',
])

// 通用属性白名单（所有允许标签共享）：纯排版/语义属性，均无脚本执行能力。
const GLOBAL_ATTRS = new Set([
  'class', 'id', 'title', 'lang', 'dir', 'style', 'align', 'valign', 'width',
  'height', 'bgcolor', 'border', 'cellpadding', 'cellspacing', 'colspan', 'rowspan',
  'headers', 'span', 'scope', 'start', 'reversed', 'value', 'type', 'color', 'face',
  'open', 'datetime', 'summary', 'abbr', 'alt', 'loading', 'decoding',
])

// 标签专属属性白名单（在 GLOBAL_ATTRS 之外追加）。
const TAG_ATTRS = {
  a: ['href', 'target', 'rel', 'hreflang'],
  img: ['src'],
}

// 需要做 scheme 校验的 URL 属性。
const URL_ATTRS = new Set(['href', 'src'])

// HTML 实体解码（仅用于安全校验的探测串，宁可多解码——解码越多越容易命中危险 scheme）。
const NAMED_ENTITIES = {
  colon: ':', tab: '\t', newline: '\n', amp: '&', lt: '<', gt: '>',
  quot: '"', apos: "'", sol: '/', semi: ';', comma: ',', period: '.', num: '#',
  par: '(', rpar: ')',
}

function decodeEntities(value) {
  return String(value)
    .replace(/&#x([0-9a-fA-F]+);?/g, (m, hex) => {
      const code = Number.parseInt(hex, 16)
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ''
    })
    .replace(/&#([0-9]+);?/g, (m, dec) => {
      const code = Number.parseInt(dec, 10)
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ''
    })
    .replace(/&([a-zA-Z]+);/g, (m, name) => NAMED_ENTITIES[name.toLowerCase()] ?? m)
}

function escapeAttrValue(value) {
  return String(value)
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    // 已是合法实体的 & 不重复转义，避免改变展示内容。
    .replace(/&(?![a-zA-Z][a-zA-Z0-9]*;|#\d+;|#x[0-9a-fA-F]+;)/gi, '&amp;')
}

// URL scheme 白名单：解码实体、剥离控制字符（浏览器解析 URL 时会去掉 tab/CR/LF 等）后
// 再判断 scheme，防止 &#106;avascript: / javascript&colon; / java\nscript: 这类混淆绕过。
function isSafeUrl(rawValue) {
  const cleaned = decodeEntities(rawValue)
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .trim()
  const schemeMatch = /^([a-zA-Z][a-zA-Z0-9+.\-]*):/.exec(cleaned)
  if (!schemeMatch) return true // 相对路径、锚点、协议相对(//) URL：与原实现一致放行（不可执行脚本）
  return ['http', 'https', 'mailto'].includes(schemeMatch[1].toLowerCase())
}

function isSafeStyleValue(rawValue) {
  const decoded = decodeEntities(rawValue).replace(/[\u0000-\u001F\u007F]/g, '')
  // IE expression()/ -moz-binding 可执行脚本；@import 可拉取外部资源；javascript:/vbscript: 出现在
  // url() 中的历史 XSS 载体——命中任意一项即整体丢弃该 style 属性。
  return !/expression\s*\(|javascript:|vbscript:|-moz-binding|@import/i.test(decoded)
}

function isAllowedAttr(tag, attrName) {
  if (attrName.startsWith('on')) return false // 事件处理器双保险：即使误配白名单也永不放行
  if (attrName.startsWith('aria-') || attrName.startsWith('data-')) return true // 纯数据，无执行能力
  if (GLOBAL_ATTRS.has(attrName)) return true
  const extra = TAG_ATTRS[tag]
  return Boolean(extra) && extra.includes(attrName)
}

// 形如 HTML5 "data state / before attribute name" 的起始标签解析。
// 关键点：属性之间不要求空白分隔——"值"onerror=、/onerror= 都会被识别为独立属性名，
// 与浏览器行为一致，这正是旧正则沙箱被绕过的根因。
function parseStartTag(html, start) {
  let i = start + 1
  const nameStart = i
  while (i < html.length && !/[\s/>]/.test(html[i])) i += 1
  const name = html.slice(nameStart, i).toLowerCase()
  if (!name) return null
  const attrs = []
  let selfClosing = false
  while (i < html.length) {
    while (i < html.length && /\s/.test(html[i])) i += 1
    if (i >= html.length) return null // 标签未闭合 → fail-closed，丢弃剩余输入
    if (html[i] === '>') return { name, attrs, selfClosing, next: i + 1 }
    if (html[i] === '/') {
      // "/x=" 中的斜杠：浏览器进入 self-closing 状态后 reconsume，属性名照常解析。
      selfClosing = true
      i += 1
      continue
    }
    const attrStart = i
    while (i < html.length && !/[\s/>=]/.test(html[i])) i += 1
    if (i === attrStart) return null // 不可解析字符（如裸 = ）→ fail-closed
    const attrName = html.slice(attrStart, i).toLowerCase()
    while (i < html.length && /\s/.test(html[i])) i += 1
    let value = ''
    let hasValue = false
    if (html[i] === '=') {
      i += 1
      while (i < html.length && /\s/.test(html[i])) i += 1
      const quote = html[i]
      if (quote === '"' || quote === "'") {
        const close = html.indexOf(quote, i + 1)
        if (close < 0) return null // 引号值未闭合 → fail-closed
        value = html.slice(i + 1, close)
        i = close + 1
      } else {
        const valueStart = i
        while (i < html.length && !/[\s>]/.test(html[i])) i += 1
        value = html.slice(valueStart, i)
      }
      hasValue = true
    }
    attrs.push({ name: attrName, value, hasValue })
  }
  return null
}

function parseEndTag(html, start) {
  let i = start + 2
  const nameStart = i
  while (i < html.length && !/[\s>]/.test(html[i])) i += 1
  const name = html.slice(nameStart, i).toLowerCase()
  if (!name) return null
  const gt = html.indexOf('>', i)
  if (gt < 0) return null
  return { name, next: gt + 1 }
}

// 找到与被禁标签配对的结束标签位置（同名嵌套按深度计数）；找不到返回 html.length（丢到结尾）。
function skipBlockedElement(html, from, name) {
  let depth = 1
  let i = from
  const open = new RegExp('<' + name + '(?=[\\s/>])', 'i')
  const close = new RegExp('</' + name + '[\\s\\S]*?>', 'i')
  while (i < html.length) {
    const nextOpen = open.exec(html.slice(i))
    const nextClose = close.exec(html.slice(i))
    const openAt = nextOpen ? i + nextOpen.index : -1
    const closeAt = nextClose ? i + nextClose.index : -1
    if (closeAt < 0) return html.length // 未闭合 → 整段丢弃（fail-closed）
    if (openAt >= 0 && openAt < closeAt) {
      depth += 1
      i = openAt + open[0].length
      continue
    }
    depth -= 1
    if (depth === 0) return closeAt + nextClose[0].length
    i = closeAt + nextClose[0].length
  }
  return html.length
}

function sanitizeStyleContent(css) {
  // <style> 内容按 RAWTEXT 原样保留（服务端预览用内联样式排版），仅剥离可执行/外链构造。
  // CSS 没有实体解码，直接对原文做替换即可。
  return css.replace(/expression\s*\(|javascript:|vbscript:|-moz-binding|@import/gi, '')
}

function serializeStartTag(tag) {
  let out = '<' + tag.name
  for (const attr of tag.attrs) {
    if (!isAllowedAttr(tag.name, attr.name)) continue
    if (URL_ATTRS.has(attr.name)) {
      if (!isSafeUrl(attr.value)) continue
      out += ' ' + attr.name + '="' + escapeAttrValue(attr.value) + '"'
      continue
    }
    if (attr.name === 'style') {
      if (!isSafeStyleValue(attr.value)) continue
      out += ' style="' + escapeAttrValue(attr.value) + '"'
      continue
    }
    out += attr.hasValue
      ? ' ' + attr.name + '="' + escapeAttrValue(attr.value) + '"'
      : ' ' + attr.name
  }
  return out + '>'
}

export function sanitizePreviewHTML(raw) {
  if (typeof raw !== 'string') return ''
  const html = raw
  let i = 0
  let out = ''
  const openStack = []
  while (i < html.length) {
    const lt = html.indexOf('<', i)
    if (lt < 0) {
      out += html.slice(i)
      break
    }
    out += html.slice(i, lt)
    const next = html[lt + 1]
    if (next === '!') {
      // 注释 / doctype / CDATA 一律丢弃：条件注释（<!--[if]><script>）是历史 XSS 载体。
      if (html.startsWith('<!--', lt)) {
        const end = html.indexOf('-->', lt + 4)
        i = end < 0 ? html.length : end + 3
      } else {
        const end = html.indexOf('>', lt + 2)
        i = end < 0 ? html.length : end + 1
      }
      continue
    }
    if (next === '?') {
      const end = html.indexOf('>', lt + 2)
      i = end < 0 ? html.length : end + 1
      continue
    }
    if (next === '/') {
      const afterSlash = html[lt + 2]
      if (!afterSlash || !/[a-zA-Z]/.test(afterSlash)) {
        //  "</>"、"</ x>" 等：对齐浏览器的 bogus comment 语义，丢弃到下一个 ">"（而非整段）。
        const end = html.indexOf('>', lt + 2)
        i = end < 0 ? html.length : end + 1
        continue
      }
      const endTag = parseEndTag(html, lt)
      if (!endTag) {
        i = html.length // 结束标记未闭合 → fail-closed
        continue
      }
      i = endTag.next
      if (BLOCKED_TAGS.has(endTag.name) || !ALLOWED_TAGS.has(endTag.name)) continue
      const stackIndex = openStack.lastIndexOf(endTag.name)
      if (stackIndex < 0) continue // 无匹配打开标签的结束标记：丢弃，防止提前闭合外层元素
      out += '</' + endTag.name + '>'
      openStack.length = stackIndex
      continue
    }
    if (next && /[a-zA-Z]/.test(next)) {
      const startTag = parseStartTag(html, lt)
      if (!startTag) {
        i = html.length // 标签未闭合 → 丢弃剩余输入（fail-closed）
        break
      }
      i = startTag.next
      const name = startTag.name
      if (BLOCKED_TAGS.has(name)) {
        // 危险元素：void 元素只丢起始标签；其余连同内容（至配对结束标签）整体丢弃。
        if (!VOID_TAGS.has(name)) i = skipBlockedElement(html, i, name)
        continue
      }
      if (!ALLOWED_TAGS.has(name)) {
        continue // 未知标签：丢标签、留内容（内容仍会经过同样的白名单流水线）
      }
      if (name === 'style' && !startTag.selfClosing) {
        // <style> 内容是 RAWTEXT：按原始文本截取到 </style>，单独做 CSS 净化。
        out += serializeStartTag(startTag)
        const closeMatch = /<\/style\s*>/i.exec(html.slice(i))
        if (!closeMatch) {
          out += sanitizeStyleContent(html.slice(i))
          i = html.length
          continue
        }
        out += sanitizeStyleContent(html.slice(i, i + closeMatch.index))
        i = i + closeMatch.index + closeMatch[0].length
        out += '</style>'
        continue
      }
      if (VOID_TAGS.has(name)) {
        out += serializeStartTag(startTag)
        continue
      }
      if (startTag.selfClosing) {
        out += serializeStartTag(startTag) + '</' + name + '>'
        continue
      }
      out += serializeStartTag(startTag)
      openStack.push(name)
      continue
    }
    // 普通文本中的裸 "<"（如 a < b）：按字面输出。
    out += '<'
    i = lt + 1
  }
  return out
}
