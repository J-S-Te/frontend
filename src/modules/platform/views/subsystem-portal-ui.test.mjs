import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('./SubsystemPortalView.vue', import.meta.url), 'utf8')

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
