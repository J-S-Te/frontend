// 主题偏好的唯一来源：light | dark | system 写入 localStorage('basic-platform.portal-theme')。
// 本模块只负责读/写与广播，不碰 DOM；把偏好投射成 <html data-theme> 由
// platform/shared/composables/useDocumentTheme.js 完成（业务外壳共用同一套覆盖）。
//
// 放在 shared 是因为共享外壳 AppShell 与门户主题开关都要读写同一份偏好，
// 不能各自维护第二套存储键，也不允许 shared 反向依赖 platform。
export const THEME_STORAGE_KEY = 'basic-platform.portal-theme'
export const THEME_MODES = Object.freeze(['light', 'dark', 'system'])
export const DEFAULT_THEME_MODE = 'light'
// 门户主题开关按钮的类名；同一标签页内的切换不会触发 storage 事件，
// 因此用一次委托点击把偏好重新读进文档属性。
export const THEME_SWITCHER_SELECTOR = '.subsystem-portal__theme-option'
// 其它写入方（例如共享外壳的浅色/深色/跟随系统切换）广播这个事件即可，
// 文档级同步与各外壳不需要互相知道对方存在。
export const THEME_PREFERENCE_CHANGED_EVENT = 'basic-platform:theme-preference-changed'

// safeLocalStorage 在禁用 Cookie/存储的浏览器里返回 null 而不是抛错。
// 参数：win 为 window 对象。
// 返回值：Storage 或 null。
function safeLocalStorage(win) {
  try {
    return win?.localStorage || null
  } catch {
    return null
  }
}

// readThemePreference 读取主题偏好。
// 参数：win 为 window 对象。
// 返回值：'light' | 'dark' | 'system'；缺失或非法值回落到默认模式。
export function readThemePreference(win = globalThis.window) {
  let stored = null
  try {
    stored = safeLocalStorage(win)?.getItem(THEME_STORAGE_KEY) ?? null
  } catch {
    stored = null
  }
  return THEME_MODES.includes(stored) ? stored : DEFAULT_THEME_MODE
}

// writeThemePreference 持久化主题偏好并广播变更事件。
// 参数：mode 为目标模式；win 为 window 对象。
// 返回值：布尔值，表示 localStorage 是否写入成功（事件广播失败不回滚写入）。
export function writeThemePreference(mode, win = globalThis.window) {
  if (!THEME_MODES.includes(mode)) return false
  let stored = false
  try {
    const storage = safeLocalStorage(win)
    if (storage) {
      storage.setItem(THEME_STORAGE_KEY, mode)
      stored = true
    }
  } catch {
    stored = false
  }
  try {
    const EventCtor = win?.CustomEvent
    if (EventCtor) win.dispatchEvent(new EventCtor(THEME_PREFERENCE_CHANGED_EVENT, { detail: { mode } }))
  } catch {
    // 事件只是同标签页的即时同步；存储已写入时下次路由/可见性刷新仍会生效。
  }
  return stored
}
