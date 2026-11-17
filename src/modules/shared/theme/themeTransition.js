// 主题切换的整体过渡：只在“用户明确切换且页面可见”时用 View Transitions
// 把换肤前后两帧做一次 180ms 互溶；其余路径（首帧、路由、系统偏好、跨标签、
// 降敏、隐藏标签页）一律瞬时切换，避免每次导航都闪一下。
export const THEME_TRANSITION_MS = 180

// prefersReducedMotion 读取系统降敏设置。
// 参数：win 为 window 对象。
// 返回值：要求减少动态效果时为 true。
export function prefersReducedMotion(win) {
  try {
    return Boolean(win?.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches)
  } catch {
    return false
  }
}

// shouldAnimateTheme 判断这次换肤能否安全地做整帧过渡。
// 参数：doc/win 为文档与窗口。
// 返回值：可以动画时为 true。
export function shouldAnimateTheme(doc, win) {
  if (!doc?.startViewTransition) return false
  if (doc.visibilityState === 'hidden') return false
  return !prefersReducedMotion(win)
}

// runThemeChange 执行一次换肤；能动画时用 View Transitions，否则同步写入。
// 参数：apply 为真正写 data-theme 的同步函数，options 可注入 document/window。
// 返回值：View Transition 句柄；未动画时为 null。
export function runThemeChange(apply, options = {}) {
  const doc = options.document ?? globalThis.document
  const win = options.window ?? doc?.defaultView ?? globalThis.window
  if (!doc || typeof apply !== 'function') return null
  if (!shouldAnimateTheme(doc, win)) {
    apply()
    return null
  }
  const transition = doc.startViewTransition(() => apply())
  transition?.finished?.catch?.(() => {})
  return transition || null
}
