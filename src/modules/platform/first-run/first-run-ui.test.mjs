import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const guide = await readFile(new URL('./components/FirstRunGuideHost.vue', import.meta.url), 'utf8')
const checklist = await readFile(new URL('./components/FirstRunChecklistPanel.vue', import.meta.url), 'utf8')
const styles = await readFile(new URL('./styles/first-run.css', import.meta.url), 'utf8')
const state = await readFile(new URL('./utils/firstRunState.js', import.meta.url), 'utf8')
const store = await readFile(new URL('./composables/useFirstRun.js', import.meta.url), 'utf8')
const portal = await readFile(new URL('../views/SubsystemPortalView.vue', import.meta.url), 'utf8')
const portalStyles = await readFile(new URL('../styles/subsystem-portal.css', import.meta.url), 'utf8')
const app = await readFile(new URL('../app/App.vue', import.meta.url), 'utf8')
const themeUtil = await readFile(new URL('../shared/composables/useDocumentTheme.js', import.meta.url), 'utf8')
const consoleIcon = await readFile(new URL('../../shared/components/ConsoleIcon.vue', import.meta.url), 'utf8')
const confirmDialog = await readFile(new URL('../../shared/components/ConfirmDialog.vue', import.meta.url), 'utf8')
const operationToast = await readFile(new URL('../../shared/components/OperationToast.vue', import.meta.url), 'utf8')
const appShell = await readFile(new URL('../../shared/components/AppShell.vue', import.meta.url), 'utf8')
const contractView = await readFile(new URL('../../contract_management/views/ContractManagementView.vue', import.meta.url), 'utf8')
const projectView = await readFile(new URL('../../project_management/views/ProjectManagementView.vue', import.meta.url), 'utf8')
const dataAnalysisView = await readFile(new URL('../../data_analysis/views/DashboardShellView.vue', import.meta.url), 'utf8')
const settlementView = await readFile(new URL('../../settlement/views/SettlementView.vue', import.meta.url), 'utf8')
const crmView = await readFile(new URL('../../customer_opportunity/views/CustomerOpportunityView.vue', import.meta.url), 'utf8')
const customerPortalView = await readFile(new URL('../../customer_portal/views/CustomerPortalView.vue', import.meta.url), 'utf8')
const platformConsoleView = await readFile(new URL('../views/PlatformConsoleView.vue', import.meta.url), 'utf8')

test('App.vue 全局挂载 GuideHost 与路由观察器，审计完成只在已有记录时写入', () => {
  assert.match(app, /import FirstRunGuideHost from '@\/modules\/platform\/first-run\/components\/FirstRunGuideHost\.vue'/)
  assert.match(app, /import \{ observeFirstRunRoute \} from '@\/modules\/platform\/first-run\/composables\/useFirstRun\.js'/)
  assert.match(app, /<FirstRunGuideHost \/>/)
  assert.match(app, /watch\(\(\) => route\.fullPath, \(\) => \{\s*observeFirstRunRoute\(route\)\s*\}, \{ immediate: true \}\)/)
  assert.match(store, /const stored = readFirstRunRecord\(state\.scope, currentStorage\(\)\)\s*if \(!stored\) return false\s*state\.record = stored/)
})

test('导览触发：按 route.name 选 guide、会话/页面就绪、600ms、首步锚点', () => {
  assert.match(guide, /firstRunGuideKeyForRouteName/)
  assert.match(guide, /const activeGuideKey = computed\(\(\) => firstRunGuideKeyForRouteName\(route\.name\)\)/)
  assert.match(guide, /FIRST_RUN_TOUR_STEP_DELAY_MS/)
  assert.match(guide, /shouldStartFirstRunTour/)
  assert.match(guide, /firstRun\.state\.catalogReady/)
  assert.match(guide, /document\.visibilityState === 'visible'/)
  assert.match(guide, /confirmDialogOpen/)
  assert.match(guide, /firstRun\.state\.tourVisible \|\| firstRun\.state\.checklistOpen/)
  assert.match(guide, /window\.setTimeout\(\(\) => \{\s*startTimer = 0\s*attemptStart\(\)\s*\}, FIRST_RUN_TOUR_STEP_DELAY_MS\)/)
  // 首步锚点缺失时整次不启动（门户 header / 子系统 nav），记录保持 pending。
  assert.match(guide, /if \(!anchorExists\(firstRunGuideSteps\(key\)\[0\]\.anchor\)\) return/)
  assert.match(guide, /firstRun\.beginTour\(\{ guideKey: key, hasAnchor: anchorExists \}\)/)
  // 缺锚步骤跳过：当前步骤锚点消失时前进到下一个可用步骤。
  assert.match(guide, /firstRun\.advanceTour\(\{ hasAnchor: anchorExists \}\)/)
  assert.match(state, /export function resolveNextTourStepIndex/)
  assert.match(state, /for \(let index = start; index < steps\.length; index \+= 1\)/)
})

test('多 guide 路由映射与一次只展示一个', () => {
  for (const [routeName, guideKey] of [
    ['portal', 'portal'], ['settings', 'platform'], ['audit', 'platform'],
    ['contract_management', 'contract'], ['project_management', 'project'],
    ['settlement', 'settlement'], ['customer_opportunity', 'customer_opportunity'],
    ['customer_portal', 'customer_portal'], ['data_analysis', 'data_analysis'],
  ]) {
    assert.match(state, new RegExp(`routeNames: Object\\.freeze\\(\\[[^\\]]*'${routeName}'[^\\]]*\\]\\)`), routeName)
    assert.match(state, new RegExp(`${guideKey}: Object\\.freeze\\(`), guideKey)
  }
  // 同一时刻只允许一个导览：已可见时任何 guide 都不再启动。
  assert.match(store, /if \(!state\.record \|\| !state\.scope \|\| state\.tourVisible\) return false/)
  // 每个 guide 的步骤集与当前展示 guide 绑定。
  assert.match(store, /const tourSteps = computed\(\(\) => firstRunGuideSteps\(state\.tourGuide \|\| FIRST_RUN_PORTAL_GUIDE\)\)/)
  assert.match(store, /const tourLabel = computed\(\(\) => firstRunGuideLabel\(state\.tourGuide \|\| FIRST_RUN_PORTAL_GUIDE\)\)/)
})

test('切换子系统先关旧导览（落 skipped，不标记旧 guide 完成），离开/ pagehide 落 skipped', () => {
  // guide 切换 watcher：旧 guide 只调用 interruptTour，绝不 finishTour('done')。
  assert.match(guide, /watch\(activeGuideKey, \(next\) => \{[\s\S]{0,700}previousGuideKey = next[\s\S]{0,200}if \(previous && previous !== next\) firstRun\.interruptTour\(previous\)/)
  const switchBlock = guide.slice(
    guide.indexOf('watch(activeGuideKey'),
    guide.indexOf('// 同一 guide 内通过 `?guide=1`'),
  )
  assert.match(switchBlock, /firstRun\.interruptTour\(previous\)/)
  assert.doesNotMatch(switchBlock, /finishTour\('done'\)/)
  // 未登记路由直接中断当前导览，不自动跨页。
  assert.match(guide, /if \(!next\) \{[\s\S]{0,120}firstRun\.interruptTour\(\)/)
  assert.match(guide, /function onPageHide\(\) \{\s*firstRun\.interruptTour\(\)\s*\}/)
  assert.match(guide, /window\.addEventListener\('pagehide', onPageHide\)/)
  // store 侧：中断写 skipped（按 guide），不写 done。
  assert.match(store, /function interruptTour\(guideKey = state\.tourGuide \|\| FIRST_RUN_PORTAL_GUIDE\)/)
  assert.match(store, /withTourFinished\(base, 'skipped', nowIso\(\), key\)/)
})

test('子系统 ?guide=1 强制当前 guide 重看，并清理 URL 参数', () => {
  assert.match(guide, /String\(route\.query\?\.guide \?\? ''\) !== '1'/)
  assert.match(guide, /firstRun\.restartTour\(guideKey\)/)
  assert.match(guide, /delete query\.guide/)
  assert.match(guide, /router\.replace\(\{ path: route\.path, query, hash: route\.hash \}\)/)
  // 门户不通过 ?guide=1 重看；门户仍走用户面板“重新查看平台导览”。
  assert.match(guide, /if \(!guideKey \|\| guideKey === FIRST_RUN_PORTAL_GUIDE\) return false/)
  assert.doesNotMatch(portal, /route\.query\.guide/)
})

test('Esc / 跳过 = 终态、遮罩点击不关闭、层级 9000 低于确认框与 toast', () => {
  assert.match(guide, /event\.key === 'Escape'[\s\S]{0,220}firstRun\.finishTour\('skipped'\)/)
  assert.match(guide, /class="first-run-tour__mask" aria-hidden="true" @click\.stop/)
  assert.doesNotMatch(guide, /first-run-tour__mask[^>]*@click="(goNext|skipTour|close)/)
  assert.doesNotMatch(guide, /first-run-tour__mask[^>]*@click\.self=/)

  assert.match(state, /FIRST_RUN_Z_INDEX = 9000/)
  assert.match(state, /FIRST_RUN_CHECKLIST_Z_INDEX = 9100/)
  assert.match(guide, /:style="\{ zIndex: FIRST_RUN_Z_INDEX \}"/)
  assert.match(styles, /--first-run-tour-layer: 9000/)
  assert.match(styles, /--first-run-checklist-layer: 9100/)
  assert.match(styles, /--first-run-panel-layer: 1/)
  assert.match(styles, /\.first-run-tour \{[^}]*z-index: var\(--first-run-tour-layer\)/)
  assert.match(styles, /\.first-run-tour__ring \{[^}]*z-index: var\(--first-run-tour-layer\)/)
  assert.match(styles, /\.first-run-tour__bubble \{[^}]*z-index: var\(--first-run-tour-layer\)/)
  assert.match(styles, /\.first-run-checklist \{[^}]*z-index: var\(--first-run-checklist-layer\)/)
  assert.match(styles, /\.first-run-checklist__panel \{[^}]*z-index: var\(--first-run-panel-layer\)/)
  assert.doesNotMatch(styles, /z-index:\s*\d/)
  assert.match(confirmDialog, /z-index: 10000/)
  assert.match(operationToast, /z-index: 12000/)
  assert.doesNotMatch(guide, /z-index:\s*10000/)
})

test('焦点锁、滚动锁、关闭还原焦点与 aria 语义', () => {
  assert.match(guide, /role="dialog"/)
  assert.match(guide, /aria-modal="true"/)
  assert.match(guide, /aria-live="polite"/)
  assert.match(guide, /aria-labelledby="titleId"/)
  assert.match(guide, /aria-describedby="descriptionId"/)
  assert.match(guide, /acquireBodyScrollLock\(\)/)
  assert.match(guide, /releaseBodyScrollLock\(\)/)
  assert.match(guide, /document\.addEventListener\('keydown', onTourKeydown, true\)/)
  assert.match(guide, /if \(event\.key !== 'Tab'\) return/)
  assert.match(guide, /previousFocus = document\.activeElement/)
  assert.match(guide, /releaseBodyScrollLock\(\)\s*restoreFocusAfterTour\(\)/)
  assert.match(guide, /if \(document\.body\?\.dataset\?\.confirmDialogOpen === 'true'\) return/)
})

// 用途：从真实组件源码提取命名函数并注入隔离依赖，执行真实分支。
// 参数：source 为组件源码，name 为函数名，scope 为替代外部状态与 DOM。
// 返回值：可执行的组件函数；找不到函数时测试失败。
function componentFunction(source, name, scope) {
  const start = source.indexOf(`function ${name}(`)
  assert.ok(start >= 0, `缺少函数 ${name}`)
  const end = source.indexOf('\n}', start)
  assert.ok(end > start, `无法确定 ${name} 的函数体`)
  return new Function(...Object.keys(scope), `${source.slice(start, end + 2)}; return ${name}`)(...Object.values(scope))
}

test('导览关闭焦点兜底：body/不可连接时给门户清单入口或子系统导航，再退到 #main-content', () => {
  const fallbackBlock = guide.match(/const TOUR_FOCUS_FALLBACK_SELECTORS = Object\.freeze\(\[([\s\S]*?)\]\)/)?.[1] || ''
  assert.match(fallbackBlock, /'\[data-first-run-anchor="checklist-entry"\]'/)
  assert.match(fallbackBlock, /'\[data-first-run-anchor="checklist"\]'/)
  assert.match(fallbackBlock, /'\[data-first-run-anchor="subsystem-nav"\]'/)
  assert.match(fallbackBlock, /'#main-content'/)
  assert.match(guide, /previous && previous !== document\.body && previous\.isConnected/)

  const body = { tag: 'body', isConnected: true }
  const entrySelector = '[data-first-run-anchor="checklist-entry"]'
  const navSelector = '[data-first-run-anchor="subsystem-nav"]'
  const mainSelector = '#main-content'
  function target(extra = {}) {
    return {
      focused: false,
      isConnected: true,
      disabled: false,
      getClientRects: () => [{}],
      focus() { this.focused = true },
      ...extra,
    }
  }
  function restore({ previousFocus, targets }) {
    const restoreFn = componentFunction(guide, 'restoreFocusAfterTour', {
      previousFocus,
      TOUR_FOCUS_FALLBACK_SELECTORS: [entrySelector, navSelector, mainSelector],
      document: {
        body,
        querySelector: (selector) => targets[selector] || null,
      },
    })
    return restoreFn()
  }

  const origin = target()
  const entry = target()
  assert.equal(restore({ previousFocus: origin, targets: { [entrySelector]: entry } }), origin)
  assert.equal(origin.focused, true)
  assert.equal(entry.focused, false)

  const bodyEntry = target()
  assert.equal(restore({ previousFocus: body, targets: { [entrySelector]: bodyEntry } }), bodyEntry)
  assert.equal(bodyEntry.focused, true)

  const removed = target({ isConnected: false })
  const removedEntry = target()
  assert.equal(restore({ previousFocus: removed, targets: { [entrySelector]: removedEntry } }), removedEntry)
  assert.equal(removed.focused, false)

  // 门户入口不存在（例如子系统页面）：退到子系统导航。
  const nav = target()
  assert.equal(restore({ previousFocus: body, targets: { [navSelector]: nav } }), nav)
  assert.equal(nav.focused, true)

  const disabledEntry = target({ disabled: true })
  const main = target()
  assert.equal(restore({ previousFocus: null, targets: { [entrySelector]: disabledEntry, [mainSelector]: main } }), main)
  assert.equal(main.focused, true)
  const hiddenEntry = target({ getClientRects: () => [] })
  const hiddenMain = target()
  assert.equal(restore({ previousFocus: body, targets: { [entrySelector]: hiddenEntry, [mainSelector]: hiddenMain } }), hiddenMain)

  assert.equal(restore({ previousFocus: body, targets: {} }), null)
})

test('窄屏 ≤640px 底部面板，深色只用 token（无 data-theme 字面量、无十六进制色）', () => {
  assert.match(guide, /matchMedia\('\(max-width: 640px\)'\)/)
  assert.match(styles, /@media \(max-width: 640px\)/)
  assert.match(styles, /\.first-run-tour__bubble\.is-sheet \{[^}]*bottom: 12px/)
  assert.match(styles, /\.first-run-checklist__panel \{[^}]*align-self: end/)
  assert.doesNotMatch(styles, /\[data-theme=/)
  assert.doesNotMatch(styles, /#[0-9a-fA-F]{3,8}\b/)
  assert.match(styles, /var\(--surface-card\)/)
  assert.match(styles, /var\(--text\)/)
  assert.match(styles, /var\(--border\)/)
  assert.match(styles, /var\(--primary\)/)
  assert.match(styles, /var\(--shadow-modal\)/)
  assert.match(styles, /var\(--overlay-scrim/)
})

test('门户按顺序声明 5 个锚点并在真实事件里驱动清单', () => {
  for (const anchor of ['portal-header', 'subsystem-cards', 'theme-switcher', 'user-panel', 'checklist-entry']) {
    assert.match(portal, new RegExp(`data-first-run-anchor="${anchor}"`), `缺少锚点 ${anchor}`)
  }
  assert.match(portal, /import \{ firstRun \} from '@\/modules\/platform\/first-run\/composables\/useFirstRun\.js'/)
  assert.match(portal, /const checklistSummary = firstRun\.checklistSummary/)

  assert.match(portal, /if \(userMenuOpen\.value\) firstRun\.markTaskCompleted\('userPanel'\)/)
  assert.match(portal, /if \(openSubsystemTarget\(targetURL\)\) firstRun\.markTaskCompleted\('subsystem'\)/)
  assert.match(portal, /if \(openSubsystemTarget\(subsystem\.publicURL\)\) firstRun\.markTaskCompleted\('subsystem'\)/)
  assert.match(portal, /const changed = themeMode\.value !== nextTheme/)
  assert.match(portal, /if \(changed\) firstRun\.markTaskCompleted\('theme'\)/)
  assert.doesNotMatch(portal, /markTaskCompleted\('firstAccount'\)/)
  assert.doesNotMatch(portal, /markTaskCompleted\('audit'\)/)
})

test('主体确定即创建记录：不再等目录；目录只通过 catalogReady 控制导览', () => {
  assert.match(portal, /firstRun\.markPortalReady\(principal\)/)
  assert.match(portal, /firstRun\.setCatalogReady\(!subsystemCatalogLoading\.value\)/)
  assert.match(portal, /firstRun\.markPortalUnready\(\)/)
  assert.match(portal, /if \(principalLoading\) return/)
  assert.match(portal, /if \(!principal\) \{[\s\S]{0,160}firstRun\.bindPrincipal\(null\)/)
  assert.match(store, /function markPortalReady\(principal = undefined\)/)
  assert.match(store, /function setCatalogReady\(ready\)/)
  assert.match(store, /catalogReady: false/)
  assert.match(store, /ensureFirstRunRecord\(state\.scope, currentStorage\(\)\)/)
  assert.match(state, /export function ensureFirstRunRecord\(scope, storage = undefined\) \{\s*if \(!scope\) return null/)
})

test('上手清单入口：header n/m、页脚入口、未就绪 loading/disabled、重看/重置', () => {
  assert.match(portal, /class="subsystem-portal__guide-entry"/)
  assert.match(portal, /data-first-run-anchor="checklist-entry"/)
  assert.match(portal, /:disabled="!checklistReady"/)
  assert.match(portal, /:aria-busy="checklistReady \? 'false' : 'true'"/)
  assert.match(portal, /class="subsystem-portal__guide-entry-count">\{\{ checklistSummary\.done \}\}\/\{\{ checklistSummary\.total \}\}/)
  assert.match(portal, /class="subsystem-portal__guide-footer-entry"/)
  assert.match(portal, /@click="openFirstRunChecklist"/)
  assert.match(portal, /重新查看平台导览/)
  assert.match(portal, /重置上手清单/)
  assert.match(portal, /const checklistReady = computed\(\(\) => firstRun\.state\.portalReady && Boolean\(firstRun\.state\.record\)\)/)
  assert.match(portal, /function openFirstRunChecklist\(\) \{\s*if \(!checklistReady\.value\) return\s*firstRun\.openChecklist\(\)\s*\}/)
  assert.match(portal, /function restartFirstRunTour\(\)/)
  assert.match(portal, /function resetFirstRunChecklist\(\)/)
  assert.match(portalStyles, /\.subsystem-portal__guide-entry \{[^}]*var\(--portal-text-secondary\)/)
  assert.match(portalStyles, /\.subsystem-portal__guide-entry:disabled \{[^}]*cursor: progress/)
  assert.match(portalStyles, /@media \(max-width: 650px\) \{[\s\S]{0,500}\.subsystem-portal__guide-entry \{ width: 100%; justify-content: center; \}/)
})

test('页头清单入口用清单/任务语义图标，而不是保存/下载形状', () => {
  const entryBlock = portal.slice(
    portal.indexOf('class="subsystem-portal__guide-entry"'),
    portal.indexOf('class="subsystem-portal__user-menu"'),
  )
  assert.match(entryBlock, /<ConsoleIcon name="audit" \/>/)
  assert.doesNotMatch(entryBlock, /<ConsoleIcon name="save" \/>/)
  assert.match(consoleIcon, /^\s*audit: \[/m)
  assert.doesNotMatch(consoleIcon, /^\s*checklist: \[/m)
})

test('用户面板重看导览/重置清单在记录未就绪时禁用并给出载入提示', () => {
  const panelBlock = portal.slice(
    portal.indexOf('class="subsystem-portal__user-panel-actions"'),
    portal.indexOf('class="subsystem-portal__logout-button"'),
  )
  assert.match(panelBlock, /:disabled="!checklistReady"/)
  assert.match(panelBlock, /:aria-disabled="checklistReady \? 'false' : 'true'"/)
  assert.match(panelBlock, /上手记录载入中/)
  assert.match(panelBlock, /@click="restartFirstRunTour"/)
  assert.match(panelBlock, /@click="resetFirstRunChecklist"/)
  assert.match(portal, /function restartFirstRunTour\(\) \{\s*if \(!checklistReady\.value\) return false/)
  assert.match(portal, /function resetFirstRunChecklist\(\) \{\s*if \(!checklistReady\.value\) return false/)
  assert.match(portalStyles, /\.subsystem-portal__user-panel-action:disabled \{[^}]*cursor: progress/)
})

test('第 1 步整行高亮环用内描边并夹取视口，1366/1920 不裁切', () => {
  const ringBlock = styles.slice(
    styles.indexOf('.first-run-tour__ring {'),
    styles.indexOf('.first-run-tour__bubble {'),
  )
  assert.match(ringBlock, /box-shadow: inset 0 0 0 4px var\(--primary-soft\)/)
  assert.doesNotMatch(ringBlock, /box-shadow:\s*0 0 0/)
  assert.doesNotMatch(ringBlock, /outline:/)
  assert.match(ringBlock, /box-sizing: border-box/)
  assert.match(guide, /const ringLeft = Math\.max\(0, rect\.left\)/)
  assert.match(guide, /const ringTop = Math\.max\(0, rect\.top\)/)
  assert.match(guide, /width: `\$\{Math\.max\(0, Math\.min\(rect\.width, viewportWidth - ringLeft\)\)\}px`/)
  assert.match(guide, /height: `\$\{Math\.max\(0, Math\.min\(rect\.height, viewportHeight - ringTop\)\)\}px`/)
})

test('门户主题临时同步根元素：挂载/主题变化应用，卸载恢复原值', () => {
  assert.match(portal, /import \{ createDocumentThemeOverride \} from '@\/modules\/platform\/shared\/composables\/useDocumentTheme'/)
  assert.match(portal, /const documentThemeOverride = createDocumentThemeOverride\(\)/)
  assert.match(portal, /function syncPortalDocumentTheme\(\) \{\s*documentThemeOverride\.apply\(resolvedTheme\.value\)\s*\}/)
  assert.match(portal, /onMounted\(\(\) => \{[\s\S]{0,200}syncPortalDocumentTheme\(\)/)
  assert.match(portal, /watch\(resolvedTheme, \(\) => \{\s*syncPortalDocumentTheme\(\)/)
  assert.match(portal, /onBeforeUnmount\(\(\) => \{[\s\S]{0,800}documentThemeOverride\.restore\(\)/)
  assert.match(themeUtil, /export function createDocumentThemeOverride/)
  assert.match(themeUtil, /root\.dataset\.theme = value/)
  assert.match(themeUtil, /delete root\.dataset\.theme/)
})

test('主题跟随不靠 focus：跨标签页 storage / 主题事件 / 切回标签页都重投根元素', () => {
  assert.match(portal, /window\.addEventListener\('storage', onPortalThemeStorage\)/)
  assert.match(portal, /document\.addEventListener\('visibilitychange', onPortalVisibilityChangeForTheme\)/)
  assert.match(portal, /window\.addEventListener\(THEME_PREFERENCE_CHANGED_EVENT, syncPortalThemeFromStorage\)/)
  assert.match(portal, /window\.removeEventListener\('storage', onPortalThemeStorage\)/)
  assert.match(portal, /document\.removeEventListener\('visibilitychange', onPortalVisibilityChangeForTheme\)/)
  assert.match(portal, /window\.removeEventListener\(THEME_PREFERENCE_CHANGED_EVENT, syncPortalThemeFromStorage\)/)
  assert.match(portal, /event\.key !== PORTAL_THEME_STORAGE_KEY && event\.key !== THEME_STORAGE_KEY/)
  assert.match(portal, /import \{[\s\S]{0,160}THEME_PREFERENCE_CHANGED_EVENT,[\s\S]{0,160}THEME_STORAGE_KEY,[\s\S]{0,160}\} from '@\/modules\/shared\/theme\/themePreference\.js'/)
  assert.match(portal, /function syncPortalThemeFromStorage\(\) \{[\s\S]{0,200}if \(storedTheme\) themeMode\.value = storedTheme[\s\S]{0,160}systemPrefersDark\.value = readSystemPrefersDark\(\)[\s\S]{0,80}syncPortalDocumentTheme\(\)/)
  assert.match(portal, /function readStoredPortalTheme\(\) \{\s*return readStoredPortalThemeOrNull\(\) \|\| 'dark'\s*\}/)
  assert.match(portal, /function onPortalVisibilityChangeForTheme\(\) \{\s*if \(document\.visibilityState !== 'visible'\) return false\s*syncPortalThemeFromStorage\(\)/)
  assert.doesNotMatch(portal, /THEME_PREFERENCE_CHANGED_EVENT[\s\S]{0,120}setTimeout/)
})

test('清单面板只展示真实状态，探测失败提供重试且不代操作', () => {
  assert.match(checklist, /role="dialog"/)
  assert.match(checklist, /aria-modal="true"/)
  assert.match(checklist, /上手清单/)
  assert.match(checklist, /\{\{ item\.done \? '已完成' : '待完成' \}\}/)
  assert.match(checklist, /v-if="item\.key === 'firstAccount'"/)
  assert.match(checklist, /v-if="firstRun\.state\.probeStatus === 'error' \|\| firstRun\.state\.probeStatus === 'incomplete'"/)
  assert.match(checklist, /@click="retryProbe"/)
  assert.match(checklist, /不会代替你打开页面或提交数据/)
  assert.doesNotMatch(checklist, /@click="(markDone|completeTask|openSubsystem|setPortalTheme)/)
})

test('第 ④ 项探测：只读 GET /users?page=1&page_size=1、total>=1 完成、动态 import IAM', () => {
  assert.match(store, /loadUsersFn\(\{ page: 1, pageSize: 1 \}\)/)
  assert.match(store, /const total = Number\(result\?\.total\)/)
  assert.match(store, /Number\.isFinite\(total\) && total >= 1/)
  assert.doesNotMatch(store, /total > 1/)
  assert.match(store, /await import\('\.\.\/\.\.\/iam\/api\/iam\.js'\)/)
  assert.doesNotMatch(store, /import \{ listUsers \} from '\.\.\/\.\.\/iam\/api\/iam\.js'/)
  assert.match(store, /state\.probeStatus = 'error'[\s\S]{0,160}return false/)
  assert.match(state, /FIRST_RUN_USER_READ_PERMISSION = 'platform:user:read'/)
  assert.match(state, /FIRST_RUN_AUDIT_PERMISSION = 'platform:audit:view'/)
  assert.match(state, /permission: FIRST_RUN_USER_READ_PERMISSION/)
  assert.match(state, /permission: FIRST_RUN_AUDIT_PERMISSION/)
  assert.match(checklist, /检测到租户内已有业务账号（系统自动检测）/)
  assert.match(checklist, /尚未检测到业务账号/)
})

test('导览中断与竞态：pagehide/离开落 skipped、探测按 scope+generation 丢弃', () => {
  assert.match(guide, /function onPageHide\(\) \{\s*firstRun\.interruptTour\(\)\s*\}/)
  assert.match(guide, /window\.addEventListener\('pagehide', onPageHide\)/)
  assert.match(guide, /firstRun\.state\.catalogReady/)
  assert.match(guide, /shouldStartFirstRunTour/)
  assert.match(guide, /firstRun\.isGuideReady\(key\)/)
  assert.match(store, /function interruptTour\(guideKey = state\.tourGuide \|\| FIRST_RUN_PORTAL_GUIDE\)/)
  assert.match(store, /withTourFinished\(base, 'skipped', nowIso\(\), key\)/)
  assert.match(store, /const probePromises = new Map\(\)/)
  assert.match(store, /let probeGeneration = 0/)
  assert.match(store, /const generation = probeGeneration/)
  assert.match(store, /if \(scope !== state\.scope \|\| generation !== probeGeneration\) return false/)
  assert.match(store, /probeGeneration \+= 1/)
  assert.match(store, /probePromises\.get\(scope\)/)
})

test('多标签页：监听 storage（当前 scope 键）、写前重读、任务 OR / 每个 guide 终态单调', () => {
  assert.match(store, /window\.addEventListener\('storage', onStorage\)/)
  assert.match(store, /function handleStorageEvent\(event\)/)
  assert.match(store, /firstRunStorageKey\(state\.scope\)/)
  assert.match(store, /mergeFirstRunRecords\(state\.record, stored\)/)
  assert.match(store, /function baseRecord\(\)/)
  assert.match(state, /export function mergeFirstRunRecords\(current, incoming\)/)
  assert.match(state, /tasks\[key\] = a\.tasks\[key\] === true \|\| b\.tasks\[key\] === true/)
  assert.match(state, /FIRST_RUN_GUIDE_KEYS\.forEach\(\(guideKey\) => \{/)
  assert.match(state, /isFirstRunTourTerminal/)
})

test('切步/启动前先 scrollIntoView 到视口中部再测量', () => {
  assert.match(guide, /function revealAnchorInView\(\)/)
  assert.match(guide, /element\.scrollIntoView\(\{ block: 'center', behavior: 'auto' \}\)/)
  assert.match(guide, /async function revealCurrentStep\(\) \{[\s\S]{0,120}revealAnchorInView\(\)[\s\S]{0,80}positionTour\(\)/)
  assert.match(guide, /function onWindowScroll\(\) \{\s*positionTour\(\)\s*\}/)
  assert.match(guide, /function onWindowResize\(\) \{\s*positionTour\(\)\s*\}/)
})

test('六个子系统壳层 + 平台控制台补齐统一锚点', () => {
  // 共享外壳统一提供导航与主操作区；各 AppShell 模块的返回门户项显式声明 anchor。
  assert.match(appShell, /data-first-run-anchor="subsystem-nav"/)
  assert.match(appShell, /data-first-run-anchor="subsystem-title"/)
  assert.match(appShell, /:data-first-run-anchor="item\.anchor \|\| undefined"/)
  for (const [name, source] of [
    ['结算', settlementView], ['CRM', crmView], ['客户门户', customerPortalView], ['平台控制台', platformConsoleView],
  ]) {
    assert.match(source, /anchor: ["']subsystem-portal["']/, `${name} 缺少返回门户锚点声明`)
  }

  // 私有壳层各自声明三处锚点。
  for (const [name, source] of [
    ['合同', contractView], ['项目', projectView], ['数据看板', dataAnalysisView],
  ]) {
    assert.match(source, /data-first-run-anchor="subsystem-nav"/, `${name} 缺少导航锚点`)
    assert.match(source, /data-first-run-anchor="subsystem-title"/, `${name} 缺少标题/主操作区锚点`)
    assert.match(source, /data-first-run-anchor="subsystem-portal"/, `${name} 缺少返回门户锚点`)
  }
  // 不新增导航结构：仍复用既有“返回子系统门户”入口。
  for (const source of [contractView, projectView, dataAnalysisView]) {
    assert.match(source, /返回子系统门户/)
  }
})
