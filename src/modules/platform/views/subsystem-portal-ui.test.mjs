import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('./SubsystemPortalView.vue', import.meta.url), 'utf8')
const styles = await readFile(new URL('../styles/subsystem-portal.css', import.meta.url), 'utf8')

test('internal subsystems open as a new page and fall back when popups are blocked', () => {
  const openSubsystem = source.slice(source.indexOf('function openSubsystem'), source.indexOf('function isProjectionRefreshPending'))
  assert.match(openSubsystem, /router\.resolve\(subsystem\.route\)/)
  assert.match(source, /function openSubsystemTarget\(targetURL\)/)
  assert.match(source, /window\.open\('', '_blank'\)/)
  assert.match(source, /opened\.opener = null\s*opened\.location\.replace\(target\)\s*return true/)
  assert.match(source, /window\.location\.assign\(target\)/)
  assert.doesNotMatch(source, /window\.open\(target, '_blank', 'noopener,noreferrer'\)/)
})

test('external subsystem addresses use the same popup fallback', () => {
  const openSubsystem = source.slice(source.indexOf('function openSubsystem'), source.indexOf('function isProjectionRefreshPending'))
  assert.match(openSubsystem, /openSubsystemTarget\(subsystem\.publicURL\)/)
  assert.match(openSubsystem, /openSubsystemTarget\(targetURL\)/)
})

test('门户会持续刷新未完成的用户授权投影，而不是依赖手工同步 Client 或刷新页面', () => {
  assert.match(source, /function isProjectionRefreshPending\(application\)/)
  assert.match(source, /application\?\.projection_ready === false/)
  assert.match(source, /\['PENDING', 'RUNNING', 'QUEUED', 'RETRYING', 'SYNCING'\]/)
  assert.match(source, /if \(status === 'FAILED'\) return false/)
  assert.match(source, /registeredSubsystems\.value\.some\(isProjectionRefreshPending\)/)
})

test('门户动效具备粒子上限、页面休眠、精细指针和减少动态效果保护', () => {
  assert.match(source, /Math\.max\(16, Math\.min\(48,/)
  assert.match(source, /document\.visibilityState === 'visible'/)
  assert.match(source, /\(hover: hover\) and \(pointer: fine\)/)
  assert.match(source, /prefers-reduced-motion: reduce/)
  assert.match(source, /Math\.min\(index, 7\) \* 45/)
  assert.match(source, /@pointermove="handleCardPointerMove"/)
  assert.match(source, /@pointercancel="resetCardTransform"/)
})

test('门户支持浅色、深色和跟随系统三态主题并持久化用户选择', () => {
  assert.match(source, /PORTAL_THEME_STORAGE_KEY = 'basic-platform\.portal-theme'/)
  assert.match(source, /\{ value: 'light', label: '浅色' \}/)
  assert.match(source, /\{ value: 'dark', label: '深色' \}/)
  assert.match(source, /\{ value: 'system', label: '跟随系统' \}/)
  assert.match(source, /window\.matchMedia\('\(prefers-color-scheme: dark\)'\)/)
  assert.match(source, /window\.localStorage\.setItem\(PORTAL_THEME_STORAGE_KEY, nextTheme\)/)
  assert.match(source, /:data-theme="resolvedTheme"/)
  assert.match(source, /:aria-pressed="themeMode === option\.value"/)
})

test('门户在桌面端按卡片数量自适应一屏，分页交给统一 PaginationBar', () => {
  assert.match(source, /portalGridForCount/)
  assert.match(source, /portalPageItems/)
  assert.match(source, /const visibleSubsystems = computed/)
  assert.match(source, /v-for="\(subsystem, index\) in visibleSubsystems"/)
  assert.match(source, /:data-density="portalGrid\.density"/)
  assert.match(source, /--portal-grid-max-width/)
  // 分页由 shared/components/PaginationBar.vue 接管：页码 / 总量 / 每页条数都要真的传进去，
  // 翻页仍走原来的 changePortalPage（它负责把页码夹在有效范围内）。
  assert.match(source, /import PaginationBar from '@\/modules\/shared\/components\/PaginationBar\.vue'/)
  assert.match(source, /<PaginationBar[\s\S]{0,300}label="子系统分页"/)
  assert.match(source, /<PaginationBar[\s\S]{0,400}:page="portalPage"/)
  assert.match(source, /:total="subsystems\.length"/)
  assert.match(source, /:page-size="PORTAL_PAGE_SIZE"/)
  assert.match(source, /@change="changePortalPage"/)
  // 自绘的分页箭头按钮与「第 N / M 页」计数器必须消失。
  assert.doesNotMatch(source, /aria-label="上一页"/)
  assert.doesNotMatch(source, /aria-label="下一页"/)
  assert.doesNotMatch(source, /第 \{\{ portalPage \}\} \/ \{\{ portalTotalPages \}\} 页/)
  assert.doesNotMatch(source, /v-if="portalTotalPages > 1"/)
  // 门户不再给共享分页条自绘按钮样式，也不再自己决定对齐方式：
  // 对齐与控件尺寸由共享分页条统一（桌面右对齐、窄屏左对齐），这里只保留外距。
  assert.doesNotMatch(styles, /\.subsystem-portal__pagination button/)
  assert.doesNotMatch(styles, /\.subsystem-portal__pagination \{[^}]*(justify-content: center)/)
  assert.match(styles, /\.subsystem-portal__pagination \{[^}]*flex: 0 0 auto/)
  assert.match(styles, /--border: var\(--portal-border\)/)
  assert.match(styles, /--text-muted: var\(--portal-text-muted\)/)
  assert.match(styles, /height:\s*100dvh/)
  assert.match(styles, /grid-template-columns:\s*repeat\(var\(--portal-columns, 3\), minmax\(0, 1fr\)\)/)
  assert.match(styles, /grid-template-rows:\s*repeat\(var\(--portal-rows, 2\), minmax\(0, 1fr\)\)/)
  assert.match(styles, /@media \(min-width: 901px\) and \(max-height: 820px\)/)
  assert.match(styles, /@media \(max-width: 900px\)[\s\S]*overflow:\s*visible/)
})

// 用途：从真实门户组件提取命名函数并注入隔离依赖，执行真实分支。
// 参数：source 为组件源码，name 为函数名，scope 为替代的响应式状态、存储读取与 DOM。
// 返回值：可执行的组件函数；找不到函数时测试失败。
function operation(source, name, scope) {
  const start = source.indexOf(`function ${name}(`)
  assert.ok(start >= 0, `缺少函数 ${name}`)
  const end = source.indexOf('\n}', start)
  assert.ok(end > start, `无法确定 ${name} 的函数体`)
  return new Function(...Object.keys(scope), `${source.slice(start, end + 2)}; return ${name}`)(...Object.values(scope))
}

test('主题跟随：跨标签页主题键、同页主题事件与切回标签页都重投根元素', () => {
  const applied = []
  // 用可变闭包模拟 localStorage 与系统深色：事件处理里重新读取才会看到新值。
  let storedTheme = 'light'
  let prefersDark = true
  const scope = {
    themeMode: { value: 'dark' },
    systemPrefersDark: { value: false },
    readStoredPortalThemeOrNull: () => storedTheme,
    readSystemPrefersDark: () => prefersDark,
    syncPortalDocumentTheme: () => { applied.push('apply') },
    PORTAL_THEME_STORAGE_KEY: 'basic-platform.portal-theme',
    THEME_STORAGE_KEY: 'basic-platform.portal-theme',
    document: { visibilityState: 'visible' },
  }
  const syncFromStorage = operation(source, 'syncPortalThemeFromStorage', scope)
  const onStorage = operation(source, 'onPortalThemeStorage', {
    ...scope,
    syncPortalThemeFromStorage: syncFromStorage,
  })

  // 无关的存储键不能打断门户：不重读偏好、也不改写根元素。
  assert.equal(onStorage({ key: 'basic-platform.first-run|v1|t:x|u:y' }), false)
  assert.deepEqual(applied, [])
  assert.equal(scope.themeMode.value, 'dark')

  // 门户主题键与全局偏好键是同一个键：另一标签页改动后立即重读并应用（含系统深色）。
  assert.equal(onStorage({ key: scope.THEME_STORAGE_KEY }), true)
  assert.equal(scope.themeMode.value, 'light')
  assert.equal(scope.systemPrefersDark.value, true)
  assert.deepEqual(applied, ['apply'])

  // storage.clear() 的 key === null 也要重新读取，否则会停留在旧主题。
  assert.equal(onStorage({ key: null }), true)
  assert.equal(applied.length, 2)
  // 缺事件对象（部分测试替身/老浏览器）按“未知键”兜底重读，不静默跳过。
  assert.equal(onStorage(undefined), true)
  assert.equal(applied.length, 3)

  // 同标签页其它外壳广播主题事件时同样同步重投（不排队到下一帧）。
  storedTheme = 'system'
  prefersDark = true
  const onPreferenceChanged = operation(source, 'syncPortalThemeFromStorage', scope)
  onPreferenceChanged()
  assert.equal(scope.themeMode.value, 'system')
  assert.equal(scope.systemPrefersDark.value, true)
  assert.equal(applied.length, 4)

  // 页面隐藏时不做任何写入；切回可见时补读系统主题，保证浮层与门户同色。
  const onVisibility = operation(source, 'onPortalVisibilityChangeForTheme', {
    ...scope,
    syncPortalThemeFromStorage: syncFromStorage,
  })
  scope.document.visibilityState = 'hidden'
  assert.equal(onVisibility(), false)
  assert.equal(applied.length, 4)
  scope.document.visibilityState = 'visible'
  assert.equal(onVisibility(), true)
  assert.equal(applied.length, 5)

  // 存储被禁用或从未写过偏好：保留当前会话内的选择，不被默认深色覆盖。
  storedTheme = null
  scope.themeMode.value = 'light'
  syncFromStorage()
  assert.equal(scope.themeMode.value, 'light')
  assert.equal(applied.length, 6)
})

test('门户主区提供 #main-content 落点，供跳转链接与导览关闭兜底聚焦', () => {
  assert.match(source, /id="main-content"[\s\S]{0,160}class="subsystem-portal"[\s\S]{0,400}tabindex="-1"/)
})
