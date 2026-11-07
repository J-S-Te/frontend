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

test('App.vue 全局挂载 GuideHost 与路由观察器，审计完成只在已有记录时写入', () => {
  assert.match(app, /import FirstRunGuideHost from '@\/modules\/platform\/first-run\/components\/FirstRunGuideHost\.vue'/)
  assert.match(app, /import \{ observeFirstRunRoute \} from '@\/modules\/platform\/first-run\/composables\/useFirstRun\.js'/)
  assert.match(app, /<FirstRunGuideHost \/>/)
  assert.match(app, /watch\(\(\) => route\.fullPath, \(\) => \{\s*observeFirstRunRoute\(route\)\s*\}, \{ immediate: true \}\)/)
  // 观察器本身不创建记录，只在 observeRoute 内按“记录已存在”分支写入。
  assert.match(store, /const stored = readFirstRunRecord\(state\.scope, currentStorage\(\)\)\s*if \(!stored\) return false\s*state\.record = stored/)
})

test('导览触发条件：仅门户、会话与目录就绪、页面可见、无确认框、600ms 延迟', () => {
  assert.match(guide, /FIRST_RUN_TOUR_STEP_DELAY_MS/)
  assert.match(guide, /route\.name === 'portal'/)
  assert.match(guide, /firstRun\.state\.portalReady/)
  assert.match(guide, /document\.visibilityState === 'visible'/)
  assert.match(guide, /confirmDialogOpen !== 'true'/)
  // 清单面板打开时不叠加导览。
  assert.match(guide, /!firstRun\.state\.checklistOpen/)
  assert.match(guide, /window\.setTimeout\(\(\) => \{\s*startTimer = 0\s*attemptStart\(\)\s*\}, FIRST_RUN_TOUR_STEP_DELAY_MS\)/)
  // header 锚点缺失时整次不启动，记录保持 pending。
  assert.match(guide, /if \(!anchorExists\(FIRST_RUN_TOUR_STEPS\[0\]\.anchor\)\) return/)
  assert.match(guide, /firstRun\.beginTour\(\{ hasAnchor: anchorExists \}\)/)
  // 缺锚步骤跳过：当前步骤锚点消失时前进到下一个可用步骤。
  assert.match(guide, /firstRun\.advanceTour\(\{ hasAnchor: anchorExists \}\)/)
  assert.match(state, /export function resolveNextTourStepIndex/)
  assert.match(state, /for \(let index = start; index < FIRST_RUN_TOUR_STEPS\.length; index \+= 1\)/)
})

test('Esc / 跳过 = 终态、遮罩点击不关闭、层级 9000 低于确认框与 toast', () => {
  assert.match(guide, /event\.key === 'Escape'[\s\S]{0,220}firstRun\.finishTour\('skipped'\)/)
  assert.match(guide, /class="first-run-tour__mask" aria-hidden="true" @click\.stop/)
  assert.doesNotMatch(guide, /first-run-tour__mask[^>]*@click="(goNext|skipTour|close)/)
  assert.doesNotMatch(guide, /first-run-tour__mask[^>]*@click\.self=/)

  assert.match(state, /FIRST_RUN_Z_INDEX = 9000/)
  assert.match(state, /FIRST_RUN_CHECKLIST_Z_INDEX = 9100/)
  assert.match(guide, /:style="\{ zIndex: FIRST_RUN_Z_INDEX \}"/)
  // 层级字面量只允许出现在自定义属性定义中，使用侧必须是 var()（设计 token 门禁）。
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
  // 关闭时还原焦点；启动前元素不可连接或是 body 时按下面的兜底规则处理。
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

test('导览关闭焦点兜底：body/不可连接时给清单入口，再退到 #main-content', () => {
  // 兜底顺序写在源码常量里，门户清单入口优先，其次 #main-content。
  const fallbackBlock = guide.match(/const TOUR_FOCUS_FALLBACK_SELECTORS = Object\.freeze\(\[([\s\S]*?)\]\)/)?.[1] || ''
  assert.match(fallbackBlock, /'\[data-first-run-anchor="checklist-entry"\]'/)
  assert.match(fallbackBlock, /'\[data-first-run-anchor="checklist"\]'/)
  assert.match(fallbackBlock, /'#main-content'/)
  // body 永远不是可接受的落点。
  assert.match(guide, /previous && previous !== document\.body && previous\.isConnected/)

  const body = { tag: 'body', isConnected: true }
  const entrySelector = '[data-first-run-anchor="checklist-entry"]'
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
      TOUR_FOCUS_FALLBACK_SELECTORS: [entrySelector, mainSelector],
      document: {
        body,
        querySelector: (selector) => targets[selector] || null,
      },
    })
    return restoreFn()
  }

  // ① 启动前元素仍可连接：直接还给它，不再兜底。
  const origin = target()
  const entry = target()
  assert.equal(restore({ previousFocus: origin, targets: { [entrySelector]: entry } }), origin)
  assert.equal(origin.focused, true)
  assert.equal(entry.focused, false)

  // ② 自动启动时 previousFocus 就是 body：焦点给门户清单入口。
  const bodyEntry = target()
  assert.equal(restore({ previousFocus: body, targets: { [entrySelector]: bodyEntry } }), bodyEntry)
  assert.equal(bodyEntry.focused, true)

  // ③ 启动前元素已从 DOM 移除：同样兜底到清单入口。
  const removed = target({ isConnected: false })
  const removedEntry = target()
  assert.equal(restore({ previousFocus: removed, targets: { [entrySelector]: removedEntry } }), removedEntry)
  assert.equal(removed.focused, false)

  // ④ 清单入口还没就绪（disabled）或不存在：退到 #main-content。
  const disabledEntry = target({ disabled: true })
  const main = target()
  assert.equal(restore({ previousFocus: null, targets: { [entrySelector]: disabledEntry, [mainSelector]: main } }), main)
  assert.equal(main.focused, true)
  const hiddenEntry = target({ getClientRects: () => [] })
  const hiddenMain = target()
  assert.equal(restore({ previousFocus: body, targets: { [entrySelector]: hiddenEntry, [mainSelector]: hiddenMain } }), hiddenMain)

  // ⑤ 两个兜底都不存在：返回 null，不抛错也不把焦点留给 body。
  assert.equal(restore({ previousFocus: body, targets: {} }), null)
})

test('窄屏 ≤640px 底部面板，深色只用 token（无 data-theme 字面量、无十六进制色）', () => {
  assert.match(guide, /matchMedia\('\(max-width: 640px\)'\)/)
  assert.match(styles, /@media \(max-width: 640px\)/)
  assert.match(styles, /\.first-run-tour__bubble\.is-sheet \{[^}]*bottom: 12px/)
  assert.match(styles, /\.first-run-checklist__panel \{[^}]*align-self: end/)
  // 深色主题完全由 :root[data-theme="dark"] 的 token 覆盖，浮层不得自带一套深色字面量。
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

  // ① 打开用户面板：只有真的展开才记完成。
  assert.match(portal, /if \(userMenuOpen\.value\) firstRun\.markTaskCompleted\('userPanel'\)/)
  // ② 进入任一业务子系统：只有入口真的被打开才记完成。
  assert.match(portal, /if \(openSubsystemTarget\(targetURL\)\) firstRun\.markTaskCompleted\('subsystem'\)/)
  assert.match(portal, /if \(openSubsystemTarget\(subsystem\.publicURL\)\) firstRun\.markTaskCompleted\('subsystem'\)/)
  // ③ 切换主题：只有值真的变化才记完成。
  assert.match(portal, /const changed = themeMode\.value !== nextTheme/)
  assert.match(portal, /if \(changed\) firstRun\.markTaskCompleted\('theme'\)/)
  // ④⑤ 由探测与全局路由观察器负责，门户不得直接伪造完成。
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
  // 无记录时绝不写：ensureFirstRunRecord 明确拒绝空作用域。
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
  // 入口样式走门户 token，窄屏时占满一行；未就绪有可见的加载/禁用态。
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
  // 图标名必须来自 ConsoleIcon 现有图标表（不新增图标库、不改依赖）。
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
  // 程序化调用也守一道，不在无记录时静默失败。
  assert.match(portal, /function restartFirstRunTour\(\) \{\s*if \(!checklistReady\.value\) return false/)
  assert.match(portal, /function resetFirstRunChecklist\(\) \{\s*if \(!checklistReady\.value\) return false/)
  assert.match(portalStyles, /\.subsystem-portal__user-panel-action:disabled \{[^}]*cursor: progress/)
})

test('第 1 步整行高亮环用内描边并夹取视口，1366/1920 不裁切', () => {
  const ringBlock = styles.slice(
    styles.indexOf('.first-run-tour__ring {'),
    styles.indexOf('.first-run-tour__bubble {'),
  )
  // 门户页头是整行锚点：外扩阴影会被视口左右裁断，只允许 inset 内描边。
  assert.match(ringBlock, /box-shadow: inset 0 0 0 4px var\(--primary-soft\)/)
  assert.doesNotMatch(ringBlock, /box-shadow:\s*0 0 0/)
  assert.doesNotMatch(ringBlock, /outline:/)
  assert.match(ringBlock, /box-sizing: border-box/)
  // 位置按视口夹取：right/bottom 不越过视口，任何宽度下都不裁切。
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
  // 挂载时注册三类监听，离开门户时全部移除，避免卸载后继续改写 <html>。
  assert.match(portal, /window\.addEventListener\('storage', onPortalThemeStorage\)/)
  assert.match(portal, /document\.addEventListener\('visibilitychange', onPortalVisibilityChangeForTheme\)/)
  assert.match(portal, /window\.addEventListener\(THEME_PREFERENCE_CHANGED_EVENT, syncPortalThemeFromStorage\)/)
  assert.match(portal, /window\.removeEventListener\('storage', onPortalThemeStorage\)/)
  assert.match(portal, /document\.removeEventListener\('visibilitychange', onPortalVisibilityChangeForTheme\)/)
  assert.match(portal, /window\.removeEventListener\(THEME_PREFERENCE_CHANGED_EVENT, syncPortalThemeFromStorage\)/)
  // 门户主题键与全局偏好键是同一份存储的两种引用：两个都要响应，无关键忽略。
  assert.match(portal, /event\.key !== PORTAL_THEME_STORAGE_KEY && event\.key !== THEME_STORAGE_KEY/)
  assert.match(portal, /import \{[\s\S]{0,160}THEME_PREFERENCE_CHANGED_EVENT,[\s\S]{0,160}THEME_STORAGE_KEY,[\s\S]{0,160}\} from '@\/modules\/shared\/theme\/themePreference\.js'/)
  // 重读偏好 + 系统深色后立即重写根元素（不经过 nextTick / focus）。
  assert.match(portal, /function syncPortalThemeFromStorage\(\) \{[\s\S]{0,200}if \(storedTheme\) themeMode\.value = storedTheme[\s\S]{0,160}systemPrefersDark\.value = readSystemPrefersDark\(\)[\s\S]{0,80}syncPortalDocumentTheme\(\)/)
  // 没有已保存偏好（存储禁用/从未写过）时保留会话内选择，不被默认深色覆盖。
  assert.match(portal, /function readStoredPortalTheme\(\) \{\s*return readStoredPortalThemeOrNull\(\) \|\| 'dark'\s*\}/)
  // 隐藏时不做写入，可见时才补一次；这样切回标签页也能跟上系统主题。
  assert.match(portal, /function onPortalVisibilityChangeForTheme\(\) \{\s*if \(document\.visibilityState !== 'visible'\) return false\s*syncPortalThemeFromStorage\(\)/)
  // 主题事件处理同步执行，不能被延迟到下一次渲染。
  assert.doesNotMatch(portal, /THEME_PREFERENCE_CHANGED_EVENT[\s\S]{0,120}setTimeout/)
})

test('清单面板只展示真实状态，探测失败提供重试且不代操作', () => {
  assert.match(checklist, /role="dialog"/)
  assert.match(checklist, /aria-modal="true"/)
  assert.match(checklist, /上手清单/)
  assert.match(checklist, /{{ item\.done \? '已完成' : '待完成' }}/)
  assert.match(checklist, /v-if="item\.key === 'firstAccount'"/)
  // 文案说“创建后可重新检测”，按钮必须同时出现在 error 与 incomplete 两种状态。
  assert.match(checklist, /v-if="firstRun\.state\.probeStatus === 'error' \|\| firstRun\.state\.probeStatus === 'incomplete'"/)
  assert.match(checklist, /@click="retryProbe"/)
  assert.match(checklist, /不会代替你打开页面或提交数据/)
  // 面板里除关闭/重试外没有代替用户完成任务的按钮。
  assert.doesNotMatch(checklist, /@click="(markDone|completeTask|openSubsystem|setPortalTheme)/)
})

test('第 ④ 项探测：只读 GET /users?page=1&page_size=1、total>=1 完成、动态 import IAM', () => {
  assert.match(store, /loadUsersFn\(\{ page: 1, pageSize: 1 \}\)/)
  assert.match(store, /const total = Number\(result\?\.total\)/)
  // 后端 /users 的 total 已排除初始化超管：有任一业务账号即完成。
  assert.match(store, /Number\.isFinite\(total\) && total >= 1/)
  assert.doesNotMatch(store, /total > 1/)
  // 探测 API 动态 import，避免 IAM 客户端进入首屏 chunk。
  assert.match(store, /await import\('\.\.\/\.\.\/iam\/api\/iam\.js'\)/)
  assert.doesNotMatch(store, /import \{ listUsers \} from '\.\.\/\.\.\/iam\/api\/iam\.js'/)
  // 失败只更新提示并保持未完成。
  assert.match(store, /state\.probeStatus = 'error'[\s\S]{0,160}return false/)
  assert.match(state, /FIRST_RUN_USER_READ_PERMISSION = 'platform:user:read'/)
  assert.match(state, /FIRST_RUN_AUDIT_PERMISSION = 'platform:audit:view'/)
  assert.match(state, /permission: FIRST_RUN_USER_READ_PERMISSION/)
  assert.match(state, /permission: FIRST_RUN_AUDIT_PERMISSION/)
  // 完整/未完成文案按“租户内业务账号”口径。
  assert.match(checklist, /检测到租户内已有业务账号（系统自动检测）/)
  assert.match(checklist, /尚未检测到业务账号/)
})

test('导览中断与竞态：pagehide/离开门户落 skipped、探测按 scope+generation 丢弃', () => {
  assert.match(guide, /function onPageHide\(\) \{\s*firstRun\.interruptTour\(\)\s*\}/)
  assert.match(guide, /window\.addEventListener\('pagehide', onPageHide\)/)
  assert.match(guide, /watch\(\(\) => route\.name, \(name\) => \{\s*if \(name !== 'portal'\) firstRun\.interruptTour\(\)/)
  assert.match(guide, /firstRun\.state\.catalogReady/)
  assert.match(guide, /firstRun\.state\.record\?\.tour === 'pending'/)
  assert.doesNotMatch(guide, /record\?\.tour === 'pending'\) \|\|/)
  assert.match(store, /function interruptTour\(\)/)
  assert.match(store, /withTourFinished\(base, 'skipped', nowIso\(\)\)/)
  assert.match(store, /const probePromises = new Map\(\)/)
  assert.match(store, /let probeGeneration = 0/)
  assert.match(store, /const generation = probeGeneration/)
  assert.match(store, /if \(scope !== state\.scope \|\| generation !== probeGeneration\) return false/)
  assert.match(store, /probeGeneration \+= 1/)
  assert.match(store, /probePromises\.get\(scope\)/)
})

test('多标签页：监听 storage（当前 scope 键）、写前重读、任务 OR / 终态单调', () => {
  assert.match(store, /window\.addEventListener\('storage', onStorage\)/)
  assert.match(store, /function handleStorageEvent\(event\)/)
  assert.match(store, /firstRunStorageKey\(state\.scope\)/)
  assert.match(store, /mergeFirstRunRecords\(state\.record, stored\)/)
  assert.match(store, /function baseRecord\(\)/)
  assert.match(store, /mergeFirstRunRecords\(state\.record, stored\)/)
  assert.match(state, /export function mergeFirstRunRecords\(current, incoming\)/)
  assert.match(state, /tasks\[key\] = a\.tasks\[key\] === true \|\| b\.tasks\[key\] === true/)
  assert.match(state, /isFirstRunTourTerminal/)
})

test('切步/启动前先 scrollIntoView 到视口中部再测量', () => {
  assert.match(guide, /function revealAnchorInView\(\)/)
  assert.match(guide, /element\.scrollIntoView\(\{ block: 'center', behavior: 'auto' \}\)/)
  assert.match(guide, /async function revealCurrentStep\(\) \{[\s\S]{0,120}revealAnchorInView\(\)[\s\S]{0,80}positionTour\(\)/)
  // 滚动/缩放回调只重测量，不能反向驱动滚动形成循环。
  assert.match(guide, /function onWindowScroll\(\) \{\s*positionTour\(\)\s*\}/)
  assert.match(guide, /function onWindowResize\(\) \{\s*positionTour\(\)\s*\}/)
})
