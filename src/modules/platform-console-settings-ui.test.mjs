import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const source = await readFile(
  new URL('./platform/views/PlatformConsoleView.vue', import.meta.url),
  'utf8',
)

test('基础平台页面不展示研发需求编号标签', () => {
  assert.doesNotMatch(source, /console-requirement-chip/)
  assert.doesNotMatch(source, /AUD-001|SYS-001|SYS-002 ~ SYS-004/)
  assert.match(source, /description: '审计事件、数据变更摘要与跨链路追溯'/)
  assert.match(source, /description: '身份、组织、角色与权限集中配置'/)
})

test('系统设置页只保留一层页面标题并由各模块展示自身标题', () => {
  const settingsTemplate = source.slice(
    source.indexOf('<section v-else-if="currentView === \'settings\''),
    // 壳层已抽到 AppShell.vue：设置分段结束于 #overlay 模板的起始，不能再锚定 </main>。
    source.indexOf('    <template #overlay>'),
  )

  assert.match(source, /<div v-if="currentView === 'audit'" class="console-page-head">/)
  assert.doesNotMatch(settingsTemplate, /class="console-page-head"/)
  assert.doesNotMatch(settingsTemplate, /class="settings-active-summary"/)
  // 页面级标题与审计页一致使用 <h1>（视觉尺寸由 settings-showcase.css 保留），
  // 卡片内标题仍为 <h2>，保持单层页面标题 + 模块自身标题的层级。
  assert.match(settingsTemplate, /<h1>系统设置<\/h1>/)
  assert.match(settingsTemplate, /<h2>平台基础信息<\/h2>/)
})

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

// P1-9：设置页签吸顶，面包屑带出当前页签。
test('设置页签在内容滚动时吸顶，且面包屑显示当前页签', async () => {
  const { readFile } = await import('node:fs/promises')
  const settingsCss = await readFile(new URL('./platform/styles/settings-showcase.css', import.meta.url), 'utf8')
  assert.match(settingsCss, /\.settings-tab-bar \{[^}]*position: sticky/, '页签条必须吸顶')
  assert.match(settingsCss, /\.settings-tab-bar \{[^}]*top: 64px/, '吸顶位置在共享顶栏之下')
  assert.match(settingsCss, /\.settings-tab-bar \{[^}]*background: var\(--surface-card\)/, '吸顶后必须有实底，避免内容透出')
  assert.match(source, /const settingsCrumb = activeSettingsTabLabel\.value/)
  assert.match(source, /`系统设置 · \$\{activeSettingsTabLabel\.value\}`/)
  assert.match(source, /crumb: settingsCrumb/, '设置页面包屑必须带当前页签')
})


// 2026-11-12 设置导航改造：11 个设置分区必须全部落入分组导航。
// 新增分区但忘记登记 SETTINGS_NAV_GROUPS 时，导航会少一项而内容仍可路由访问，
// 用户只能靠搜索找到它；这里把它锁成可失败的回归。
test('设置分区全部分组登记，新增分区不会从左侧导航消失', () => {
  const tabsSource = source.slice(source.indexOf('const settingsTabs = ['), source.indexOf('// 设置导航分组'))
  const tabKeys = [...tabsSource.matchAll(/\bkey: '([a-z]+)', label:/g)].map((match) => match[1])
  assert.equal(tabKeys.length, 11, '设置分区数量变化时需要同步更新本断言')

  const groupsSource = source.slice(source.indexOf('const SETTINGS_NAV_GROUPS'), source.indexOf('const SETTINGS_NAV_GROUPED_KEYS'))
  const groupedKeys = [...groupsSource.matchAll(/sections: \[([^\]]+)\]/g)]
    .flatMap((match) => [...match[1].matchAll(/'([a-z]+)'/g)].map((item) => item[1]))

  assert.deepEqual([...new Set(tabKeys)].sort(), [...new Set(groupedKeys)].sort(), '每个设置分区必须且只能登记一次')
  // 未登记分区仍会落到“其他”分组，不能静默丢项。
  assert.match(source, /const others = filteredSettingsTabs\.value\.filter/)
  assert.match(source, /groups\.push\(\{ key: 'other', label: '其他', tabs: others \}\)/)
})

test('设置导航按分组渲染，并在窄屏回退为吸顶横向分区条', async () => {
  assert.match(source, /v-for="group in filteredSettingsTabGroups"/)
  assert.match(source, /const filteredSettingsTabGroups = computed\(\(\) => \{/)
  const settingsCss = await readFile(new URL('./platform/styles/settings-showcase.css', import.meta.url), 'utf8')
  assert.match(settingsCss, /@media \(max-width: 1799px\)/, '窄屏必须回退为整宽横向分区条')
  assert.match(settingsCss, /\.settings-rail \{\s*display: contents;/, '回退时导航必须脱离卡片、按网格排布')
})

test('审计高级筛选默认收起，并提供可访问的展开开关', () => {
  assert.match(source, /const auditAdvancedOpen = ref\(false\)/)
  assert.match(source, /:aria-expanded="auditAdvancedOpen \? 'true' : 'false'"/)
  assert.match(source, /aria-controls="audit-advanced-filters"/)
  assert.match(source, /v-show="auditAdvancedOpen" id="audit-advanced-filters"/)
  assert.match(source, /activeAuditAdvancedCount/)
})

test('审计摄取健康度保留稳定锚点与四个指标块', () => {
  assert.match(source, /data-testid="audit-health-card"/)
  assert.match(source, /class="audit-health-grid"/)
  for (const label of ['近 24 小时接收', '累计接收', '来源未采集', '最后接收']) {
    assert.match(source, new RegExp(label), `健康度缺少 ${label}`)
  }
})
