// 文档级主题：门户的主题开关是唯一偏好入口，它把 light | dark | system 写进
// localStorage('basic-platform.portal-theme')（见 SubsystemPortalView.vue）。
// 本模块只读同一份偏好，把它投射到 <html data-theme>，让六个业务外壳共用一套
// [data-theme="dark"] 样式覆盖；不新增第二套存储键，也不保存到会话作用域里
// （登出会清 sessionStorage，主题偏好必须长期保留）。
//
// 约定：
//   · 未选择过主题时保持既有浅色界面（DEFAULT_THEME_MODE = 'light'），
//     避免老用户因为升级而被整体切换成深色；
//   · 只有解析结果严格等于 'dark' 时才写 data-theme="dark"，其余一律 'light'，
//     因此浅色渲染路径与今天完全一致；
//   · 颜色本身不在这里决定，全部来自 main.css 的 [data-theme="dark"] token 覆盖。

// 偏好键、读取逻辑与变更事件已下沉到 shared/theme，供共享外壳 AppShell 与门户开关
// 共用同一份实现；这里保留同名 re-export，现有调用方与测试无需改动。
import {
  DEFAULT_THEME_MODE,
  THEME_MODES,
  THEME_PREFERENCE_CHANGED_EVENT,
  THEME_STORAGE_KEY,
  THEME_SWITCHER_SELECTOR,
  readThemePreference,
} from '../../../shared/theme/themePreference.js'

export {
  DEFAULT_THEME_MODE,
  THEME_MODES,
  THEME_PREFERENCE_CHANGED_EVENT,
  THEME_STORAGE_KEY,
  THEME_SWITCHER_SELECTOR,
  readThemePreference,
}

const DARK_QUERY = '(prefers-color-scheme: dark)'

// systemPrefersDark 读取操作系统深色偏好。
// 参数：win 为 window 对象。
// 返回值：布尔值；不支持 matchMedia 时视为浅色。
export function systemPrefersDark(win = globalThis.window) {
  try {
    return Boolean(win?.matchMedia?.(DARK_QUERY)?.matches)
  } catch {
    return false
  }
}

// resolveDocumentTheme 把偏好解析成最终主题。
// 参数：mode 为偏好值，prefersDark 为系统是否深色。
// 返回值：'light' | 'dark'。
export function resolveDocumentTheme(mode, prefersDark = false) {
  const safeMode = THEME_MODES.includes(mode) ? mode : DEFAULT_THEME_MODE
  if (safeMode === 'system') return prefersDark ? 'dark' : 'light'
  return safeMode === 'dark' ? 'dark' : 'light'
}

// applyDocumentTheme 把解析结果写到根元素。
// 参数：theme 为 'light' | 'dark'，doc 为 document 对象。
// 返回值：实际写入的主题。
export function applyDocumentTheme(theme, doc = globalThis.document) {
  const resolved = theme === 'dark' ? 'dark' : 'light'
  const root = doc?.documentElement
  if (!root) return resolved
  root.setAttribute('data-theme', resolved)
  return resolved
}

/**
 * createDocumentThemeOverride 创建一个“挂载期间临时覆盖根元素主题”的控制器。
 *
 * 门户默认深色，而全局 <html data-theme> 在未保存偏好时保持浅色；导览/清单
 * Teleport 到 body 后不在 `.subsystem-portal[data-theme]` 子树内，只能读取根元素
 * token，因此门户挂载时把 resolvedTheme 临时投射到 <html>，卸载时恢复挂载前原值。
 * @param {Object} [options] 依赖注入。
 * @param {Object} [options.document] document 对象。
 * @returns {{apply:(theme:string)=>void,restore:()=>void}} 覆盖控制器。
 */
export function createDocumentThemeOverride(options = {}) {
  const doc = options.document ?? globalThis.document
  const win = options.window ?? doc?.defaultView ?? globalThis.window
  const root = doc?.documentElement
  if (!root) return { apply: () => {}, restore: () => {} }
  // dataset 与 data-theme 属性互相映射；优先走 dataset.theme，测试替身没有 dataset 时回退属性。
  function writeTheme(value) {
    if (root.dataset) root.dataset.theme = value
    else if (typeof root.setAttribute === 'function') root.setAttribute('data-theme', value)
  }

  function clearTheme() {
    if (root.dataset) delete root.dataset.theme
    else if (typeof root.removeAttribute === 'function') root.removeAttribute('data-theme')
  }

  let active = false
  return {
    apply(theme) {
      active = true
      writeTheme(theme === 'dark' ? 'dark' : 'light')
    },
    restore() {
      if (!active) return
      active = false
      // 不能写回挂载前快照：门户内切换主题会更新全局偏好，路由 watcher 也会先同步
      // 新偏好；快照会把这次变更覆盖回旧值。恢复即按当前偏好重新同步，交还控制权。
      syncDocumentTheme({ window: win, document: doc })
    },
  }
}

// syncDocumentTheme 重新读取偏好并同步到根元素。
// 参数：options.window / options.document 便于测试注入。
// 返回值：本次生效的主题。
export function syncDocumentTheme(options = {}) {
  const { window: win = globalThis.window, document: doc = globalThis.document } = options
  return applyDocumentTheme(resolveDocumentTheme(readThemePreference(win), systemPrefersDark(win)), doc)
}

// installDocumentThemeSync 安装主题同步：首帧同步 + 跨标签页 + 系统主题变化 +
// 回到前台 + 同标签页切换门户开关。
// 参数：options.window / options.document 便于测试注入。
// 返回值：清理函数，移除全部监听。
export function installDocumentThemeSync(options = {}) {
  const { window: win = globalThis.window, document: doc = globalThis.document } = options
  if (!win || !doc) return () => {}

  const sync = () => syncDocumentTheme({ window: win, document: doc })
  sync()

  let pendingTimer = 0
  // scheduleSync 在同一轮点击结束后重读偏好：门户按钮先写 localStorage，再重渲染。
  const scheduleSync = () => {
    if (pendingTimer) return
    pendingTimer = win.setTimeout(() => {
      pendingTimer = 0
      sync()
    }, 0)
  }

  const onStorage = (event) => {
    if (!event || event.key === null || event.key === THEME_STORAGE_KEY) sync()
  }
  const onMediaChange = () => sync()
  const onForeground = () => {
    if (doc.visibilityState === 'visible' || doc.visibilityState === undefined) sync()
  }
  const onDocumentClick = (event) => {
    const target = event?.target
    if (target && typeof target.closest === 'function' && target.closest(THEME_SWITCHER_SELECTOR)) {
      scheduleSync()
    }
  }

  win.addEventListener('storage', onStorage)
  win.addEventListener('focus', onForeground)
  doc.addEventListener('visibilitychange', onForeground)
  doc.addEventListener('click', onDocumentClick, true)
  win.addEventListener(THEME_PREFERENCE_CHANGED_EVENT, scheduleSync)

  let mediaQuery = null
  try {
    mediaQuery = win.matchMedia?.(DARK_QUERY) || null
  } catch {
    mediaQuery = null
  }
  if (mediaQuery?.addEventListener) mediaQuery.addEventListener('change', onMediaChange)
  else if (mediaQuery?.addListener) mediaQuery.addListener(onMediaChange)

  return () => {
    if (pendingTimer) {
      win.clearTimeout(pendingTimer)
      pendingTimer = 0
    }
    win.removeEventListener('storage', onStorage)
    win.removeEventListener('focus', onForeground)
    doc.removeEventListener('visibilitychange', onForeground)
    doc.removeEventListener('click', onDocumentClick, true)
    win.removeEventListener(THEME_PREFERENCE_CHANGED_EVENT, scheduleSync)
    if (mediaQuery?.removeEventListener) mediaQuery.removeEventListener('change', onMediaChange)
    else if (mediaQuery?.removeListener) mediaQuery.removeListener(onMediaChange)
  }
}
