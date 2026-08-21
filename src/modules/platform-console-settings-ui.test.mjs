import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const source = await readFile(
  new URL('./platform/views/PlatformConsoleView.vue', import.meta.url),
  'utf8',
)

test('设置搜索会将被过滤的当前 tab 同步到第一个匹配项', () => {
  const watcher = source.slice(
    source.indexOf('watch(filteredSettingsTabs'),
    source.indexOf('watch(auditApplication'),
  )

  assert.match(watcher, /if \(currentView\.value !== 'settings' \|\| !tabs\.length\) return/)
  assert.match(watcher, /tabs\.some\(\(tab\) => tab\.key === activeSettingsTab\.value\)/)
  assert.match(watcher, /const nextSection = tabs\[0\]\.key/)
  assert.match(watcher, /router\.replace\(\{ name: 'settings', params: \{ section: nextSection \} \}\)/)
})

test('设置搜索无结果时隐藏当前模块内容', () => {
  assert.match(source, /const hasActiveFilteredSettingsTab = computed\(\(\) => \(/)
  assert.match(source, /filteredSettingsTabs\.value\.some\(\(tab\) => tab\.key === activeSettingsTab\.value\)/)
  assert.match(source, /v-if="hasActiveFilteredSettingsTab && activeSettingsMeta"/)
  assert.match(source, /v-if="hasActiveFilteredSettingsTab && activeSettingsTab === 'base'"/)
  assert.doesNotMatch(source, /v-else-if="!hasNoVisibleSettingsTab && activeSettingsTab ===/)
})

test('离开设置页时清空 tab 搜索关键字', () => {
  const watcher = source.slice(
    source.indexOf('watch(currentView'),
    source.indexOf('watch(filteredSettingsTabs'),
  )

  assert.match(watcher, /if \(view !== 'settings'\) \{\s*\/\/[^\n]+\s*settingsTabKeyword\.value = ''/)
})

test('审计结果与风险筛选复用已导入的稳定枚举字典', () => {
  assert.match(source, /Object\.entries\(AUDIT_RESULT_LABELS\).*value === label/)
  assert.match(source, /Object\.entries\(AUDIT_RISK_LABELS\).*value === label/)
  assert.doesNotMatch(source, /Object\.entries\((?:RESULT_LABELS|RISK_LABELS)\)/)
})
