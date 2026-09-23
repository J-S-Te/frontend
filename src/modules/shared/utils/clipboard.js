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

/** SEC-X10：敏感内容（临时密码等）复制后的剪贴板自动清除延时。 */
export const SENSITIVE_CLIPBOARD_CLEAR_DELAY_MS = 30 * 1000

/**
 * 复制敏感文本后安排延时清除剪贴板（SEC-X10）。
 *
 * 安全约定：
 * 1) 只在延时触发时剪贴板仍持有我们写入的原文才覆盖——readText 可用且读出的内容
 *    与原文不一致时说明用户已复制其它内容，跳过清除，避免误删；
 * 2) readText 被权限策略拒绝时无法比对，仍执行清空：空串覆盖的误伤远低于明文残留；
 * 3) 非安全上下文（HTTP 回退路径）没有异步 Clipboard API，复制之后无法再回写剪贴板，
 *    此时返回 { supported: false }，由调用方降级提示用户手动覆盖；
 * 4) 清除失败（权限在延时窗口内变化等）静默放弃，不影响页面。
 *
 * @param {string} expectedText 刚刚复制的敏感原文，用于清除前比对。
 * @param {object} [options] 可注入依赖便于测试。
 * @returns {{ supported: boolean, timerId?: number}} supported=false 时调用方应降级提示。
 */
export function scheduleSensitiveClipboardClear(expectedText, {
  delayMs = SENSITIVE_CLIPBOARD_CLEAR_DELAY_MS,
  navigatorObject = globalThis.navigator,
  timerObject = globalThis,
} = {}) {
  const text = String(expectedText ?? '')
  const clipboard = navigatorObject?.clipboard
  if (!text || typeof clipboard?.writeText !== 'function') {
    return { supported: false }
  }

  const timerId = timerObject?.setTimeout(async () => {
    try {
      if (typeof clipboard.readText === 'function') {
        try {
          const current = await clipboard.readText()
          if (current !== text) return
        } catch {
          // 读取被拒绝：无法比对，仍按约定清空剪贴板。
        }
      }
      await clipboard.writeText('')
    } catch {
      // 清除失败时保持静默；页面已提示过交付方式，不因清理失败打扰用户。
    }
  }, delayMs)

  return { supported: true, timerId }
}
