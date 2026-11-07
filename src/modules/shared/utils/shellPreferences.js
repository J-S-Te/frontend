// 共享外壳的持久化偏好：桌面侧栏是否折叠。
// 与主题偏好分开存放：主题键由门户开关写入（basic-platform.portal-theme），
// 侧栏折叠只是当前浏览器的布局偏好，登出也不应该被会话作用域清掉。
export const SIDEBAR_COLLAPSED_STORAGE_KEY = 'basic-platform.sidebar-collapsed'

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

// readSidebarCollapsed 读取桌面上次留下的折叠状态。
// 参数：win 为 window 对象。
// 返回值：布尔值；缺失、非法或存储不可用时回落为展开（false）。
export function readSidebarCollapsed(win = globalThis.window) {
  let stored = null
  try {
    stored = safeLocalStorage(win)?.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) ?? null
  } catch {
    stored = null
  }
  return stored === '1'
}

// writeSidebarCollapsed 持久化折叠状态。
// 参数：collapsed 为布尔值；win 为 window 对象。
// 返回值：布尔值，表示 localStorage 是否写入成功。
export function writeSidebarCollapsed(collapsed, win = globalThis.window) {
  try {
    const storage = safeLocalStorage(win)
    if (!storage) return false
    storage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, collapsed ? '1' : '0')
    return true
  } catch {
    return false
  }
}
