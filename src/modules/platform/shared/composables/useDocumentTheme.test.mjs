import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_THEME_MODE,
  THEME_PREFERENCE_CHANGED_EVENT,
  THEME_STORAGE_KEY,
  THEME_SWITCHER_SELECTOR,
  applyDocumentTheme,
  installDocumentThemeSync,
  readThemePreference,
  resolveDocumentTheme,
  syncDocumentTheme,
  systemPrefersDark,
} from './useDocumentTheme.js'

// 极简 window / document 替身：只实现本模块用到的接口，避免测试依赖浏览器。
function createHarness({ stored = null, prefersDark = false, storageThrows = false } = {}) {
  const store = new Map()
  if (stored !== null) store.set(THEME_STORAGE_KEY, stored)
  const windowListeners = new Map()
  const documentListeners = new Map()
  const mediaListeners = new Set()
  const timers = []
  const mediaQuery = {
    matches: prefersDark,
    addEventListener(type, handler) { if (type === 'change') mediaListeners.add(handler) },
    removeEventListener(type, handler) { if (type === 'change') mediaListeners.delete(handler) },
  }
  const attributes = new Map()
  const documentElement = {
    setAttribute(name, value) { attributes.set(name, String(value)) },
    getAttribute(name) { return attributes.has(name) ? attributes.get(name) : null },
  }
  const document = {
    documentElement,
    visibilityState: 'visible',
    addEventListener(type, handler) { documentListeners.set(type, handler) },
    removeEventListener(type, handler) { documentListeners.delete(type) },
  }
  const window = {
    localStorage: {
      getItem(key) {
        if (storageThrows) throw new Error('storage disabled')
        return store.has(key) ? store.get(key) : null
      },
      setItem(key, value) {
        if (storageThrows) throw new Error('storage disabled')
        store.set(key, String(value))
      },
    },
    matchMedia: () => mediaQuery,
    addEventListener(type, handler) { windowListeners.set(type, handler) },
    removeEventListener(type, handler) { windowListeners.delete(type) },
    // 同步执行定时器：测试里不需要等真实事件循环。
    setTimeout(handler) { timers.push(handler); return timers.length },
    clearTimeout() {},
  }
  return {
    window,
    document,
    attributes,
    setStoredTheme(value) { store.set(THEME_STORAGE_KEY, value) },
    emitWindow(type, event) { windowListeners.get(type)?.(event) },
    emitDocument(type, event) { documentListeners.get(type)?.(event) },
    emitMediaChange() { for (const handler of mediaListeners) handler({ matches: mediaQuery.matches }) },
    setSystemPrefersDark(value) { mediaQuery.matches = value },
    flushTimers() { for (const handler of timers.splice(0)) handler() },
    listenerCount() { return windowListeners.size + documentListeners.size + mediaListeners.size },
  }
}

test('主题偏好复用门户写入的 localStorage 键，缺失或非法时保持浅色', () => {
  assert.equal(THEME_STORAGE_KEY, 'basic-platform.portal-theme')
  assert.equal(DEFAULT_THEME_MODE, 'light')
  assert.equal(readThemePreference(createHarness().window), 'light')
  assert.equal(readThemePreference(createHarness({ stored: 'dark' }).window), 'dark')
  assert.equal(readThemePreference(createHarness({ stored: 'system' }).window), 'system')
  assert.equal(readThemePreference(createHarness({ stored: 'neon' }).window), 'light')
  assert.equal(readThemePreference(createHarness({ storageThrows: true }).window), 'light')
  assert.equal(systemPrefersDark(createHarness({ prefersDark: true }).window), true)
})

test('跟随系统只在 system 模式下生效，dark 偏好直接落到文档属性', () => {
  assert.equal(resolveDocumentTheme('system', true), 'dark')
  assert.equal(resolveDocumentTheme('system', false), 'light')
  assert.equal(resolveDocumentTheme('dark', false), 'dark')
  assert.equal(resolveDocumentTheme('light', true), 'light')
  assert.equal(resolveDocumentTheme('bogus', true), 'light')
})

test('根元素只写入 light / dark 两个取值', () => {
  const harness = createHarness()
  assert.equal(applyDocumentTheme('dark', harness.document), 'dark')
  assert.equal(harness.attributes.get('data-theme'), 'dark')
  assert.equal(applyDocumentTheme('light', harness.document), 'light')
  assert.equal(harness.attributes.get('data-theme'), 'light')
  assert.equal(applyDocumentTheme('system', harness.document), 'light')
})

test('安装时立即同步：已保存 dark 时根元素是 dark，未保存时是 light', () => {
  const dark = createHarness({ stored: 'dark' })
  const disposeDark = installDocumentThemeSync({ window: dark.window, document: dark.document })
  assert.equal(dark.attributes.get('data-theme'), 'dark')
  disposeDark()

  const fresh = createHarness()
  const disposeFresh = installDocumentThemeSync({ window: fresh.window, document: fresh.document })
  assert.equal(fresh.attributes.get('data-theme'), 'light')
  disposeFresh()
})

test('跨标签页 storage 事件会重新读取偏好', () => {
  const harness = createHarness()
  const dispose = installDocumentThemeSync({ window: harness.window, document: harness.document })
  assert.equal(harness.attributes.get('data-theme'), 'light')
  harness.setStoredTheme('dark')
  harness.emitWindow('storage', { key: THEME_STORAGE_KEY, newValue: 'dark' })
  assert.equal(harness.attributes.get('data-theme'), 'dark')
  harness.emitWindow('storage', { key: 'unrelated-key', newValue: 'x' })
  assert.equal(harness.attributes.get('data-theme'), 'dark')
  dispose()
})

test('system 模式下跟随系统深浅，并随系统变化实时更新', () => {
  const harness = createHarness({ stored: 'system', prefersDark: true })
  const dispose = installDocumentThemeSync({ window: harness.window, document: harness.document })
  assert.equal(harness.attributes.get('data-theme'), 'dark')
  harness.setSystemPrefersDark(false)
  harness.emitMediaChange()
  assert.equal(harness.attributes.get('data-theme'), 'light')
  dispose()
})

test('同标签页切换门户开关：点击主题选项后重读偏好（storage 事件不会在本标签页触发）', () => {
  assert.equal(THEME_SWITCHER_SELECTOR, '.subsystem-portal__theme-option')
  const harness = createHarness()
  const dispose = installDocumentThemeSync({ window: harness.window, document: harness.document })
  const target = {
    closest(selector) { return selector === THEME_SWITCHER_SELECTOR ? {} : null },
  }
  harness.setStoredTheme('dark')
  harness.emitDocument('click', { target })
  harness.flushTimers()
  assert.equal(harness.attributes.get('data-theme'), 'dark')

  // 其它按钮的点击不触发重读：偏好已改回 light，但文档仍停在 dark。
  harness.setStoredTheme('light')
  harness.emitDocument('click', { target: { closest: () => null } })
  harness.flushTimers()
  assert.equal(harness.attributes.get('data-theme'), 'dark')
  // 再点一次主题选项才同步到 light。
  harness.emitDocument('click', { target })
  harness.flushTimers()
  assert.equal(harness.attributes.get('data-theme'), 'light')
  dispose()
})

test('外部写入方可以广播主题变更事件，无需依赖门户按钮结构', () => {
  const harness = createHarness()
  const dispose = installDocumentThemeSync({ window: harness.window, document: harness.document })
  harness.setStoredTheme('dark')
  harness.emitWindow(THEME_PREFERENCE_CHANGED_EVENT, {})
  harness.flushTimers()
  assert.equal(harness.attributes.get('data-theme'), 'dark')
  dispose()
})

test('回到前台时重新核对偏好，卸载后不再改动文档', () => {
  const harness = createHarness()
  const dispose = installDocumentThemeSync({ window: harness.window, document: harness.document })
  harness.setStoredTheme('dark')
  harness.emitWindow('focus', {})
  assert.equal(harness.attributes.get('data-theme'), 'dark')
  dispose()
  assert.equal(harness.listenerCount(), 0, '卸载后必须移除全部监听')
  harness.setStoredTheme('light')
  harness.emitWindow('focus', {})
  harness.emitMediaChange()
  assert.equal(harness.attributes.get('data-theme'), 'dark', '已卸载的同步器不得再改文档')
})

test('syncDocumentTheme 可被路由切换等场景手动调用', () => {
  const harness = createHarness()
  assert.equal(syncDocumentTheme({ window: harness.window, document: harness.document }), 'light')
  harness.setStoredTheme('dark')
  assert.equal(syncDocumentTheme({ window: harness.window, document: harness.document }), 'dark')
  assert.equal(harness.attributes.get('data-theme'), 'dark')
})

test('没有 window/document 时安装是空操作（避免测试或预渲染环境报错）', () => {
  const dispose = installDocumentThemeSync({ window: null, document: null })
  assert.equal(typeof dispose, 'function')
  dispose()
})
