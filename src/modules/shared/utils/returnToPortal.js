const DEFAULT_FALLBACK_DELAY_MS = 100

// 合同模块通常由统一门户通过新标签页打开。浏览器允许脚本关闭这种标签页；若用户
// 直接访问合同地址，close() 会被浏览器拒绝，此时在当前标签页回退到统一门户。
export function closeSubsystemTabOrFallback(windowObject, fallback, delay = DEFAULT_FALLBACK_DELAY_MS) {
  try {
    windowObject.close()
  } catch {
    // 某些 WebView 会直接抛错，统一交给下面的导航回退处理。
  }

  windowObject.setTimeout(() => {
    if (!windowObject.closed) fallback()
  }, delay)
}
