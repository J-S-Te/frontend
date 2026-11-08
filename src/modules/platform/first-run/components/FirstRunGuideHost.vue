<script setup>
// 多导览浮层（全局唯一）。挂在 App.vue，按 route.name 选择当前 guide：
//   portal / platform(settings,audit) / contract / project / settlement /
//   customer_opportunity / customer_portal / data_analysis。
// 一次只展示一个 guide：进入新子系统时先关闭旧导览（落 skipped，不标记完成），再调度新 guide。
//
// 交互约定（产品最终决策）：
//   · 每 (tenant,user,guide,版本) 只自动出现一次；就绪后延迟 600ms；
//   · 子系统首次进入、会话/页面就绪、600ms；门户仍需 catalogReady（目录 settled）；
//   · Esc / “跳过导览” 直接进入终态，没有二次确认；遮罩点击不关闭；
//   · 层级 9000，低于确认框 10000 与 toast 12000；确认框打开时不启动也不抢键盘；
//   · 焦点锁在气泡内、锁定页面滚动、关闭还原焦点；role=dialog + aria-modal + aria-live；
//   · 缺锚点的步骤跳过；首步锚点（门户 header / 子系统 nav）缺失时整次不启动；
//   · 离开该子系统 / pagehide 时 running 落为 skipped，不自动续播；
//   · 子系统支持 `?guide=1` 强制当前 guide 重看（支持人员用），不新增常驻按钮；
//   · 窄屏（≤640px）改为底部面板，位置由 CSS 接管；深色沿用门户 token。
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { getCurrentPrincipal } from '@/modules/platform/auth/api/auth'
import { AUTHORIZATION_REFRESHED_EVENT } from '@/modules/platform/auth/utils/authorizationRefresh'
import { acquireBodyScrollLock, releaseBodyScrollLock } from '@/modules/shared/utils/bodyScrollLock'
import FirstRunChecklistPanel from './FirstRunChecklistPanel.vue'
import { firstRun } from '../composables/useFirstRun.js'
import {
  FIRST_RUN_ANCHOR_ATTRIBUTE,
  FIRST_RUN_PORTAL_GUIDE,
  FIRST_RUN_TOUR_STEP_DELAY_MS,
  FIRST_RUN_Z_INDEX,
  firstRunGuideKeyForRouteName,
  firstRunGuideSteps,
  resolveNextTourStepIndex,
  shouldStartFirstRunTour,
} from '../utils/firstRunState.js'
import '../styles/first-run.css'

const route = useRoute()
const router = useRouter()
const bubbleRef = ref(null)
const primaryButtonRef = ref(null)
const ringStyle = ref({})
const bubbleStyle = ref({})
const bubblePlacement = ref('below')
const narrowScreen = ref(false)

const titleId = 'first-run-tour-title'
const descriptionId = 'first-run-tour-description'

let narrowQuery = null
let startTimer = 0
let confirmObserver = null
let previousFocus = null
let tourListening = false
let previousGuideKey = ''
// 只允许最新一次 guide 准备流程写状态（切路由时丢弃迟到的 getCurrentPrincipal）。
let guidePreparationToken = 0

// 关闭导览的焦点兜底顺序：门户清单入口 → 子系统导航 → #main-content。
// 自动启动的导览没有“点击来源”，previousFocus 常是 body；不兜底会把键盘用户丢回页面开头。
const TOUR_FOCUS_FALLBACK_SELECTORS = Object.freeze([
  '[data-first-run-anchor="checklist-entry"]',
  '[data-first-run-anchor="checklist"]',
  '[data-first-run-anchor="subsystem-nav"]',
  '#main-content',
])

const activeGuideKey = computed(() => firstRunGuideKeyForRouteName(route.name))
const tourVisible = computed(() => firstRun.state.tourVisible)
const tourStep = firstRun.tourStep
const tourLabel = firstRun.tourLabel
const tourStepCount = firstRun.tourStepCount
const announcement = firstRun.tourAnnouncement

const stepNumber = computed(() => firstRun.state.tourIndex + 1)
const hasNextStep = computed(() => (
  tourStep.value
    ? resolveNextTourStepIndex(firstRun.state.tourIndex + 1, anchorExists, firstRun.tourSteps.value) >= 0
    : false
))

/**
 * 锚点查询：模板用 data-first-run-anchor 声明，导览不依赖组件实例。
 * 不可见（尺寸为 0 或 display:none）等同于缺失，避免气泡贴在隐藏元素上。
 */
function anchorElement(anchor) {
  if (typeof document === 'undefined') return null
  const element = document.querySelector(`[${FIRST_RUN_ANCHOR_ATTRIBUTE}="${anchor}"]`)
  if (!element || typeof element.getBoundingClientRect !== 'function') return null
  const rect = element.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return null
  return element
}

function anchorExists(anchor) {
  return Boolean(anchorElement(anchor))
}

/** 当前 guide 的启动前置条件（不含首步锚点；锚点在 attemptStart 里单独判定）。 */
function startOptions() {
  const key = activeGuideKey.value
  if (!key) return null
  return {
    guideKey: key,
    routeName: route.name,
    sessionReady: firstRun.isGuideReady(key),
    catalogReady: firstRun.state.catalogReady,
    pageVisible: typeof document !== 'undefined' && document.visibilityState === 'visible',
    confirmDialogOpen: typeof document !== 'undefined' && document.body?.dataset?.confirmDialogOpen === 'true',
    record: firstRun.state.record,
  }
}

/**
 * 是否允许排队启动：当前路由有 guide、记录为 pending、会话/页面就绪、
 * 没有确认框、也没有其它导览/清单占用。
 * @returns {boolean} 是否允许排队。
 */
function schedulingAllowed() {
  if (typeof document === 'undefined') return false
  if (firstRun.state.tourVisible || firstRun.state.checklistOpen) return false
  const options = startOptions()
  if (!options) return false
  // 先在“锚点未就绪”的状态下排队；600ms 后 attemptStart 再检查首步锚点。
  return shouldStartFirstRunTour({ ...options, firstAnchorAvailable: true })
}

function clearStartTimer() {
  window.clearTimeout(startTimer)
  startTimer = 0
}

function scheduleStart() {
  clearStartTimer()
  if (!schedulingAllowed()) return
  startTimer = window.setTimeout(() => {
    startTimer = 0
    attemptStart()
  }, FIRST_RUN_TOUR_STEP_DELAY_MS)
}

function attemptStart() {
  if (!schedulingAllowed()) return
  const key = activeGuideKey.value
  const options = startOptions()
  if (!options) return
  // 首步锚点缺失时整次不启动：门户 header / 子系统 nav 必须真实存在。
  // 记录保持 pending，不写入终态；下一次触发（路由/主体/可见性变化）会重新排队。
  if (!anchorExists(firstRunGuideSteps(key)[0].anchor)) return
  if (!shouldStartFirstRunTour({ ...options, firstAnchorAvailable: true })) return
  firstRun.beginTour({ guideKey: key, hasAnchor: anchorExists })
}

/**
 * 子系统 `?guide=1`：强制当前 guide 重看（支持人员用），然后从 URL 移除该参数，
 * 避免刷新后再次重看。不新增常驻按钮；门户仍走用户面板的“重新查看平台导览”。
 * @param {string} guideKey 当前 guide。
 * @returns {Promise<boolean>} 是否触发了重看。
 */
async function applyForcedGuide(guideKey) {
  if (!guideKey || guideKey === FIRST_RUN_PORTAL_GUIDE) return false
  if (String(route.query?.guide ?? '') !== '1') return false
  if (!firstRun.state.record) return false
  const restarted = firstRun.restartTour(guideKey)
  // 清掉 guide 参数；失败只影响 URL 是否干净，不影响已经写入的 pending。
  const query = { ...route.query }
  delete query.guide
  try {
    await router.replace({ path: route.path, query, hash: route.hash })
  } catch {
    // 路由守卫拒绝 replace 时保留原 URL，本次重看仍然生效。
  }
  return restarted
}

/**
 * 为当前 guide 准备主体与记录：
 *   · 门户由 SubsystemPortalView 调用 markPortalReady / setCatalogReady；
 *   · 子系统在路由守卫确认会话后，用平台主体确定 tenant/user 作用域并确保记录存在；
 *   · 平台会话不可用时无法确定作用域，宁可不展示也不写错记录。
 * @param {string} guideKey 当前 guide。
 */
async function prepareGuide(guideKey) {
  if (!guideKey) return
  const token = ++guidePreparationToken
  if (guideKey !== FIRST_RUN_PORTAL_GUIDE) {
    if (!firstRun.state.scope) {
      try {
        const principal = await getCurrentPrincipal()
        if (token !== guidePreparationToken || activeGuideKey.value !== guideKey) return
        firstRun.markGuideReady(principal)
      } catch {
        return
      }
    } else {
      firstRun.markGuideReady()
    }
    if (token !== guidePreparationToken || activeGuideKey.value !== guideKey) return
    await applyForcedGuide(guideKey)
    if (token !== guidePreparationToken || activeGuideKey.value !== guideKey) return
  }
  scheduleStart()
}

/**
 * 切步/启动前把锚点滚到视口中部再测量，避免气泡指向视口外。
 * 只在显式切步时调用；滚动/缩放回调只重新测量，不反向驱动滚动，避免滚动循环。
 */
function revealAnchorInView() {
  const step = tourStep.value
  if (!step || typeof window === 'undefined') return
  const element = anchorElement(step.anchor)
  if (!element || typeof element.scrollIntoView !== 'function') return
  try {
    element.scrollIntoView({ block: 'center', behavior: 'auto' })
  } catch {
    // 老浏览器不支持 options 时退回默认定位，不影响后续测量。
    element.scrollIntoView()
  }
}

/** 重新定位高亮环与气泡；当前步骤锚点消失时按“缺锚跳过该步”前进。 */
function positionTour() {
  if (!firstRun.state.tourVisible) return
  const step = tourStep.value
  if (!step) return
  const element = anchorElement(step.anchor)
  if (!element) {
    firstRun.advanceTour({ hasAnchor: anchorExists })
    return
  }
  const rect = element.getBoundingClientRect()
  // 高亮环与锚点同框：第 1 步门户锚点是整行页头，宽度等于视口宽，任何外扩描边都会在
  // 左右被视口裁掉；环本身用内描边（first-run.css），这里再把 left/top 收到 0 以上、
  // right/bottom 收进视口，保证 1366 / 1920 都不裁切。
  const viewportWidth = window.innerWidth
  const viewportHeight = window.innerHeight
  const ringLeft = Math.max(0, rect.left)
  const ringTop = Math.max(0, rect.top)
  ringStyle.value = {
    left: `${ringLeft}px`,
    top: `${ringTop}px`,
    width: `${Math.max(0, Math.min(rect.width, viewportWidth - ringLeft))}px`,
    height: `${Math.max(0, Math.min(rect.height, viewportHeight - ringTop))}px`,
  }
  if (narrowScreen.value) {
    // 窄屏用 CSS 底部面板，不写内联位置，避免盖掉媒体查询。
    bubbleStyle.value = {}
    return
  }
  const bubble = bubbleRef.value
  const width = bubble?.offsetWidth || 360
  const height = bubble?.offsetHeight || 240
  const margin = 16
  const gap = 14
  const spaceBelow = window.innerHeight - rect.bottom
  const placement = spaceBelow >= height + gap + margin ? 'below' : 'above'
  bubblePlacement.value = placement
  const top = placement === 'below' ? rect.bottom + gap : rect.top - height - gap
  const left = Math.min(
    Math.max(margin, rect.left + rect.width / 2 - width / 2),
    Math.max(margin, window.innerWidth - width - margin),
  )
  bubbleStyle.value = {
    left: `${left}px`,
    top: `${Math.max(margin, Math.min(top, window.innerHeight - height - margin))}px`,
  }
}

/**
 * 焦点锁：Tab / Shift+Tab 只在气泡内循环；Esc 直接进入终态（跳过导览）。
 * 确认框打开时让出键盘所有权，由确认框处理 Esc / Tab。
 */
function onTourKeydown(event) {
  if (!firstRun.state.tourVisible) return
  if (document.body?.dataset?.confirmDialogOpen === 'true') return
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    firstRun.finishTour('skipped')
    return
  }
  if (event.key !== 'Tab') return
  const bubble = bubbleRef.value
  if (!bubble) return
  const candidates = [...bubble.querySelectorAll(
    'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
  )].filter((element) => element.offsetParent !== null)
  if (!candidates.length) {
    event.preventDefault()
    bubble.focus()
    return
  }
  const first = candidates[0]
  const last = candidates.at(-1)
  if (event.shiftKey && (document.activeElement === first || !bubble.contains(document.activeElement))) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && (document.activeElement === last || !bubble.contains(document.activeElement))) {
    event.preventDefault()
    first.focus()
  }
}

function goNext() {
  firstRun.advanceTour({ hasAnchor: anchorExists })
}

function goPrevious() {
  firstRun.retreatTour({ hasAnchor: anchorExists })
}

function skipTour() {
  firstRun.finishTour('skipped')
}

function onWindowResize() {
  positionTour()
}

function onWindowScroll() {
  positionTour()
}

function onVisibilityChange() {
  if (document.visibilityState === 'visible') scheduleStart()
}

function onAuthorizationRefreshed(event) {
  const principal = event?.detail?.principal
  firstRun.bindPrincipal(principal)
  const key = activeGuideKey.value
  if (key && key !== FIRST_RUN_PORTAL_GUIDE && firstRun.state.scope) firstRun.markGuideReady()
  scheduleStart()
}

function syncNarrowScreen(event) {
  narrowScreen.value = Boolean(event?.matches ?? narrowQuery?.matches)
  positionTour()
}

/**
 * 关闭导览时还原焦点：优先启动前元素；它不可连接、就是 body 或已禁用/隐藏时，
 * 依次退到门户清单入口、子系统导航与 #main-content，绝不把焦点留在已卸载的气泡或 body 上。
 * @returns {Element|null} 实际焦点落点；没有可聚焦目标时返回 null。
 */
function restoreFocusAfterTour() {
  const previous = previousFocus
  previousFocus = null
  if (previous && previous !== document.body && previous.isConnected && typeof previous.focus === 'function') {
    previous.focus()
    return previous
  }
  for (const selector of TOUR_FOCUS_FALLBACK_SELECTORS) {
    const candidate = document.querySelector?.(selector)
    if (!candidate || candidate === document.body) continue
    if (typeof candidate.focus !== 'function') continue
    // 上手记录未就绪时清单入口是 disabled，隐藏元素也没有焦点，继续往下兜底。
    if (candidate.disabled === true) continue
    if (typeof candidate.getClientRects === 'function' && candidate.getClientRects().length === 0) continue
    candidate.focus()
    return candidate
  }
  return null
}

function syncTourListeners(visible) {
  if (visible && !tourListening) {
    tourListening = true
    previousFocus = document.activeElement
    document.addEventListener('keydown', onTourKeydown, true)
    window.addEventListener('resize', onWindowResize, { passive: true })
    window.addEventListener('scroll', onWindowScroll, true)
    acquireBodyScrollLock()
    return
  }
  if (!visible && tourListening) {
    tourListening = false
    document.removeEventListener('keydown', onTourKeydown, true)
    window.removeEventListener('resize', onWindowResize)
    window.removeEventListener('scroll', onWindowScroll, true)
    releaseBodyScrollLock()
    restoreFocusAfterTour()
  }
}

/** 启动或切步后：滚动到锚点 → 测量 → 聚焦主按钮。 */
async function revealCurrentStep() {
  await nextTick()
  revealAnchorInView()
  primaryButtonRef.value?.focus()
  positionTour()
}

watch(() => firstRun.state.tourVisible, async (visible) => {
  syncTourListeners(visible)
  if (!visible) return
  await revealCurrentStep()
})

watch(() => firstRun.state.tourIndex, async (index) => {
  if (index < 0) return
  await revealCurrentStep()
})

watch(
  () => [
    route.name,
    firstRun.state.portalReady,
    firstRun.state.catalogReady,
    firstRun.state.record,
    firstRun.state.checklistOpen,
    firstRun.state.tourVisible,
  ],
  () => {
    if (!firstRun.state.tourVisible) scheduleStart()
  },
)

// guide 切换：进入新子系统先关旧导览（running → skipped，不标记 done），再准备新 guide。
// 同一 guide 内切 section 不会触发这里的关闭逻辑。
watch(activeGuideKey, (next) => {
  const previous = previousGuideKey
  previousGuideKey = next
  if (previous && previous !== next) firstRun.interruptTour(previous)
  if (!next) {
    // 登录页 / 错误页等未登记路由：不自动跨页，直接中断当前导览。
    firstRun.interruptTour()
    return
  }
  void prepareGuide(next)
}, { immediate: true })

// 同一 guide 内通过 `?guide=1` 触发重看（路由名不变，上面的 watcher 不会重复执行）。
watch(() => route.query?.guide, () => {
  const key = activeGuideKey.value
  if (!key) return
  if (String(route.query?.guide ?? '') === '1') void prepareGuide(key)
})

// pagehide 覆盖刷新、关闭标签页、前进后退缓存等不经过路由 watcher 的离开方式。
function onPageHide() {
  firstRun.interruptTour()
}

onMounted(() => {
  narrowQuery = typeof window.matchMedia === 'function'
    ? window.matchMedia('(max-width: 640px)')
    : null
  narrowScreen.value = Boolean(narrowQuery?.matches)
  narrowQuery?.addEventListener?.('change', syncNarrowScreen)
  window.addEventListener(AUTHORIZATION_REFRESHED_EVENT, onAuthorizationRefreshed)
  window.addEventListener('pagehide', onPageHide)
  document.addEventListener('visibilitychange', onVisibilityChange)
  // 确认框开关只通过 body.dataset.confirmDialogOpen 暴露：关闭后重新排队，打开期间不启动。
  if (typeof MutationObserver !== 'undefined' && document.body) {
    confirmObserver = new MutationObserver(() => {
      if (document.body?.dataset?.confirmDialogOpen !== 'true') scheduleStart()
    })
    confirmObserver.observe(document.body, { attributes: true, attributeFilter: ['data-confirm-dialog-open'] })
  }
  // 首次挂载可能已经停在某个子系统：把主体/记录准备好后立即排队。
  if (activeGuideKey.value) void prepareGuide(activeGuideKey.value)
  scheduleStart()
})

onBeforeUnmount(() => {
  clearStartTimer()
  syncTourListeners(false)
  narrowQuery?.removeEventListener?.('change', syncNarrowScreen)
  confirmObserver?.disconnect()
  confirmObserver = null
  window.removeEventListener(AUTHORIZATION_REFRESHED_EVENT, onAuthorizationRefreshed)
  window.removeEventListener('pagehide', onPageHide)
  document.removeEventListener('visibilitychange', onVisibilityChange)
})
</script>

<template>
  <Teleport to="body">
    <Transition name="first-run-fade">
      <div
        v-if="tourVisible && tourStep"
        class="first-run-tour"
        :style="{ zIndex: FIRST_RUN_Z_INDEX }"
        data-first-run-layer="tour"
      >
        <!-- 遮罩点击是受控的空操作：不会关闭导览，也不会把点击透传给页面。 -->
        <div class="first-run-tour__mask" aria-hidden="true" @click.stop></div>
        <div class="first-run-tour__ring" :style="ringStyle" aria-hidden="true"></div>

        <section
          ref="bubbleRef"
          class="first-run-tour__bubble"
          :class="[`is-${bubblePlacement}`, { 'is-sheet': narrowScreen }]"
          :style="bubbleStyle"
          role="dialog"
          aria-modal="true"
          :aria-labelledby="titleId"
          :aria-describedby="descriptionId"
          tabindex="-1"
          @click.stop
        >
          <p class="first-run-tour__progress">
            <span>{{ tourLabel }}</span>
            <span>{{ stepNumber }} / {{ tourStepCount }}</span>
          </p>
          <h2 :id="titleId" class="first-run-tour__title">{{ tourStep.title }}</h2>
          <p :id="descriptionId" class="first-run-tour__description">{{ tourStep.description }}</p>
          <p class="first-run-sr-only" role="status" aria-live="polite">{{ announcement }}</p>

          <footer class="first-run-tour__actions">
            <button type="button" class="first-run-button is-ghost" @click="skipTour">跳过导览</button>
            <div class="first-run-tour__nav">
              <button
                v-if="firstRun.state.tourIndex > 0"
                type="button"
                class="first-run-button is-secondary"
                @click="goPrevious"
              >上一步</button>
              <button
                ref="primaryButtonRef"
                type="button"
                class="first-run-button is-primary"
                @click="goNext"
              >{{ hasNextStep ? '下一步' : '完成' }}</button>
            </div>
          </footer>
        </section>
      </div>
    </Transition>
  </Teleport>

  <FirstRunChecklistPanel />
</template>
