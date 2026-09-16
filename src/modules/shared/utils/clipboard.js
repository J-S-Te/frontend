function legacyCopy(text, documentObject) {
  if (!documentObject?.body || typeof documentObject.createElement !== 'function' || typeof documentObject.execCommand !== 'function') {
    throw new Error('clipboard is unavailable')
  }

  const activeElement = documentObject.activeElement
  const textarea = documentObject.createElement('textarea')
  textarea.value = text
  textarea.setAttribute?.('readonly', '')
  textarea.setAttribute?.('aria-hidden', 'true')
  textarea.style.position = 'fixed'
  textarea.style.left = '-9999px'
  textarea.style.top = '0'
  textarea.style.opacity = '0'
  textarea.style.pointerEvents = 'none'

  documentObject.body.appendChild(textarea)
  try {
    textarea.focus?.({ preventScroll: true })
    textarea.select?.()
    textarea.setSelectionRange?.(0, text.length)
    if (documentObject.execCommand('copy') !== true) {
      throw new Error('copy command was rejected')
    }
    return true
  } finally {
    documentObject.body.removeChild(textarea)
    activeElement?.focus?.({ preventScroll: true })
  }
}

/**
 * 复制文本并兼容非 HTTPS 管理站点。
 * Clipboard API 仅在安全上下文中可靠可用；HTTP 或权限拒绝时使用仍由点击事件触发的
 * textarea + execCommand 回退。调用方只在 Promise 成功后展示“已复制”。
 */
export async function copyTextToClipboard(value, {
  navigatorObject = globalThis.navigator,
  documentObject = globalThis.document,
  secureContext = globalThis.isSecureContext,
} = {}) {
  const text = String(value ?? '')
  if (!text) throw new Error('copy text is empty')

  if (secureContext !== false && typeof navigatorObject?.clipboard?.writeText === 'function') {
    try {
      await navigatorObject.clipboard.writeText(text)
      return true
    } catch {
      // 浏览器可能暴露 API 但因权限策略拒绝，继续尝试兼容复制。
    }
  }
  return legacyCopy(text, documentObject)
}
