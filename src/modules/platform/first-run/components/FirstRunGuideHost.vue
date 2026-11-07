<script setup>
// 平台导览浮层（全局唯一）。挂在 App.vue，只有 /portal 且会话与目录就绪时才可能展示，
// 不在门户页面时只观察路由（用于第 ⑤ 项审计完成），不写任何新记录。
//
// 交互约定（产品最终决策）：
//   · 就绪后延迟 600ms 启动，每 (tenant,user,版本) 只自动出现一次；
//   · Esc / “跳过导览” 直接进入终态，没有二次确认；遮罩点击不关闭；
//   · 层级 9000，低于确认框 10000 与 toast 12000；确认框打开时不启动也不抢键盘；
//   · 焦点锁在气泡内、锁定页面滚动、关闭还原焦点；role=dialog + aria-modal + aria-live；
//   · 锚点缺失的步骤跳过；门户 header 锚点缺失时整次不启动；
//   · 窄屏（≤640px）改为底部面板，位置由 CSS 接管。
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { AUTHORIZATION_REFRESHED_EVENT } from '@/modules/platform/auth/utils/authorizationRefresh'
import { acquireBodyScrollLock, releaseBodyScrollLock } from '@/modules/shared/utils/bodyScrollLock'
import FirstRunChecklistPanel from './FirstRunChecklistPanel.vue'
import { firstRun } from '../composables/useFirstRun.js'
import {
  FIRST_RUN_ANCHOR_ATTRIBUTE,
  FIRST_RUN_TOUR_STEP_DELAY_MS,
  FIRST_RUN_TOUR_STEPS,
  FIRST_RUN_Z_INDEX,
  resolveNextTourStepIndex,
} from '../utils/firstRunState.js'
import '../styles/first-run.css'

const route = useRoute()
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

// 关闭导览的焦点兜底顺序：门户清单入口 → #main-content。自动启动的导览没有“点击
// 来源”，previousFocus 常是 body；不兜底会把键盘用户丢回页面开头。
const TOUR_FOCUS_FALLBACK_SELECTORS = Object.freeze([
  '[data-first-run-anchor="checklist-entry"]',
  '[data-first-run-anchor="checklist"]',
  '#main-content',
])

const tourVisible = computed(() => firstRun.state.tourVisible)
const tourStep = firstRun.tourStep
const announcement = firstRun.tourAnnouncement

const stepNumber = computed(() => firstRun.state.tourIndex + 1)
const hasNextStep = computed(() => (
  tourStep.value
    ? resolveNextTourStepIndex(firstRun.state.tourIndex + 1, anchorExists) >= 0
    : false
))

/**
 * 锚点查询：门户模板用 data-first-run-anchor 声明，导览不依赖组件实例。
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

/** 600ms 延迟启动：条件变化随时可以取消，绝不重复排队。 */
function schedulingAllowed() {
  if (typeof document === 'undefined') return false
  return route.name === 'portal'
    && firstRun.state.portalReady
    // 目录只控制导览调度：主体已就绪但目录未 settled 时先不启动。
    && firstRun.state.catalogReady
    && !firstRun.state.tourVisible
    && !firstRun.state.checklistOpen
    // 只有 pending 会自动启动；running 已由 interruptTour 落为 skipped，绝不续播。
    && firstRun.state.record?.tour === 'pending'
    && document.visibilityState === 'visible'
    && document.body?.dataset?.confirmDialogOpen !== 'true'
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
  if (!schedulingAllowed()) {
    // 条件暂时不满足（例如确认框刚打开）：等下一次触发，不自行轮询。
    return
  }
  // header 锚点缺失时整次不启动，记录保持 pending，不写入终态。
  if (!anchorExists(FIRST_RUN_TOUR_STEPS[0].anchor)) return
  firstRun.beginTour({ hasAnchor: anchorExists })
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
  // 高亮环与锚点同框：第 1 步锚点是整行页头，宽度等于视口宽，任何外扩描边都会在
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
  scheduleStart()
}

function syncNarrowScreen(event) {
  narrowScreen.value = Boolean(event?.matches ?? narrowQuery?.matches)
  positionTour()
}

/**
 * 关闭导览时还原焦点：优先启动前元素；它不可连接、就是 body 或已禁用/隐藏时，
 * 依次退到门户清单入口与 #main-content，绝不把焦点留在已卸载的气泡或 body 上。
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
    firstRun.state.record?.tour,
    firstRun.state.record?.step,
    firstRun.state.checklistOpen,
  ],
  () => scheduleStart(),
)

// 离开 /portal 时把正在展示的导览落为 skipped：不自动续播，重看入口仍可重开。
watch(() => route.name, (name) => {
  if (name !== 'portal') firstRun.interruptTour()
}, { immediate: true })

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
  // 首次挂载可能已经停在 /audit：直接访问时是否补记由 App.vue 的观察器与
  // authorization-refreshed 事件共同决定，这里只负责门户导览的调度。
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
        <!-- 遮罩点击是受控的空操作：不会关闭导览，也不会把点击透传给门户页面。 -->
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
            <span>平台导览</span>
            <span>{{ stepNumber }} / {{ FIRST_RUN_TOUR_STEPS.length }}</span>
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
