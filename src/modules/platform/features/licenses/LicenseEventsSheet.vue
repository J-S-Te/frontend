<script setup>
// 授权事件右侧抽屉（「查看全部」的落点）。
//
// 平台没有跨模块可复用的抽屉：pm-drawer 属于项目管理子系统，挂到平台控制台会
// 自带那边的一套令牌。这里只做三件事：结构（console-sheet 骨架在 console.css）、
// 列表（复用 LicenseEventRow）与服务端分页（复用 PaginationBar）。
//
// 数据由抽屉自己取：页内摘要展示的是「最近几条」，抽屉翻页不能顺手把页内那份改了
// （抽屉盖不住左侧页面，翻到第 5 页时页内跟着变会前后矛盾）。
//
// 层叠与无障碍沿用共享确认框那套：dialogLayers 负责层级与 Tab 归属，
// bodyScrollLock 负责背景滚动锁，Escape 只在自己是顶层时消费。
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import ConsoleIcon from '@/modules/shared/components/ConsoleIcon.vue'
import ListState from '@/modules/shared/components/ListState.vue'
import PaginationBar from '@/modules/shared/components/PaginationBar.vue'
import LicenseEventRow from './LicenseEventRow.vue'
import { getLicenseEvents } from './api.js'
import { formatUserError } from '@/modules/shared/utils/userError.js'
import { acquireBodyScrollLock, releaseBodyScrollLock } from '@/modules/shared/utils/bodyScrollLock.js'
import { focusTopDialogLayer, isTopDialogLayer, registerDialogLayer, removeDialogLayer } from '@/modules/shared/utils/dialogLayers.js'

const props = defineProps({
  open: { type: Boolean, default: false },
})

const emit = defineEmits(['close'])

// 服务端分页固定 20 条/页，与 /licenses/events 的默认页大小一致。
const pageSize = 20
const items = ref([])
const page = ref(1)
// 服务端 total；未知（首次加载或失败）时显示「共 — 条」，不显示假的 0。
const total = ref(null)
// 首次加载（还没有任何行）：显示紧凑 loading，不能先闪一条「0 条」。
const loading = ref(false)
// 后台刷新（已有行）：保留旧行，只把容器标成 aria-busy。
const refreshing = ref(false)
const error = ref('')

// loadEvents 用途：读取指定页的授权事件；已有行时保留旧行，只标记 aria-busy。
// 参数：target 为目标页码（默认第 1 页）。
// 返回值：无；失败时清空旧快照，错误态旁边不会挂着上一页的 total。
async function loadEvents(target = 1) {
  if (loading.value || refreshing.value) return
  if (items.value.length) refreshing.value = true
  else loading.value = true
  error.value = ''
  try {
    const result = await getLicenseEvents(target)
    items.value = Array.isArray(result?.items) ? result.items : []
    total.value = Number.isFinite(result?.total) ? result.total : null
    page.value = Number.isFinite(result?.page) && result.page > 0 ? result.page : target
  } catch (cause) {
    items.value = []
    total.value = null
    page.value = target
    error.value = formatUserError(cause, { fallback: '授权事件读取失败，请重试。' })
  } finally {
    loading.value = false
    refreshing.value = false
  }
}

const dialog = ref(null)
const closeButton = ref(null)
let previousFocus = null
let layerElement = null
let active = false

const busy = computed(() => loading.value || refreshing.value)
const totalLabel = computed(() => (Number.isFinite(total.value) ? total.value : '—'))
// 三态优先级与页内一致：loading > error > empty，失败绝不渲染成「暂无授权事件」。
const listState = computed(() => loading.value || Boolean(error.value) || !items.value.length)

// 每次打开都回第 1 页重新读取：上次翻到第几页、失败过没有都不该带进这一次。
watch(() => props.open, open => {
  if (!open) return
  items.value = []
  total.value = null
  page.value = 1
  error.value = ''
  loadEvents(1)
}, { immediate: true })

function focusable() {
  if (!dialog.value) return []
  return [...dialog.value.querySelectorAll(
    'button:not([disabled]), [href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
  )].filter(element => element.offsetParent !== null)
}

// onKeydown 用途：只在自己是顶层时消费 Escape（下层弹窗不能跟着关），并维持 Tab 循环。
function onKeydown(event) {
  if (!isTopDialogLayer(layerElement)) return
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopImmediatePropagation()
    emit('close')
    return
  }
  if (event.key !== 'Tab') return
  // 局部变量刻意不叫 items：外层 items 是列表数据，同名会让人读错焦点列表。
  const targets = focusable()
  if (!targets.length) {
    event.preventDefault()
    dialog.value?.focus?.()
    return
  }
  const first = targets[0]
  const last = targets[targets.length - 1]
  if (event.shiftKey && (document.activeElement === first || !dialog.value?.contains(document.activeElement))) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && (document.activeElement === last || !dialog.value?.contains(document.activeElement))) {
    event.preventDefault()
    first.focus()
  }
}

// activate 用途：抽屉真正渲染后登记焦点层、锁背景滚动，并把焦点交给关闭按钮。
// 注意层级：registerDialogLayer 在已有 modal 之上再叠一层，抽屉不会盖不住下层确认框。
async function activate() {
  if (active) return
  await nextTick()
  if (active || !props.open || !dialog.value) return
  active = true
  previousFocus = document.activeElement
  layerElement = dialog.value.parentElement
  registerDialogLayer(layerElement)
  document.addEventListener('keydown', onKeydown, true)
  acquireBodyScrollLock()
  if (isTopDialogLayer(layerElement)) closeButton.value?.focus?.({ preventScroll: true })
}

// deactivate 用途：释放焦点层与滚动锁，并把焦点还给打开它的入口按钮。
function deactivate() {
  if (!active) return
  active = false
  document.removeEventListener('keydown', onKeydown, true)
  const wasTop = removeDialogLayer(layerElement)
  releaseBodyScrollLock()
  layerElement = null
  if (wasTop && !focusTopDialogLayer() && previousFocus?.isConnected && typeof previousFocus.focus === 'function') {
    previousFocus.focus({ preventScroll: true })
  }
  previousFocus = null
}

watch(() => props.open, open => (open ? activate() : deactivate()), { immediate: true })
onBeforeUnmount(deactivate)
</script>

<template>
  <Teleport to="body">
    <Transition name="console-sheet" appear>
      <div v-if="open" class="console-sheet-mask" @click.self="emit('close')">
        <section
          ref="dialog"
          class="console-sheet"
          role="dialog"
          aria-modal="true"
          aria-labelledby="license-events-sheet-title"
          tabindex="-1"
        >
          <header class="console-sheet__header">
            <div class="console-sheet__heading">
              <h2 id="license-events-sheet-title">授权事件</h2>
              <p class="console-sheet__sub">共 {{ totalLabel }} 条 · 只读 · 按时间倒序</p>
            </div>
            <button ref="closeButton" type="button" class="console-sheet__close" aria-label="关闭授权事件" @click="emit('close')">
              <ConsoleIcon name="close" />
            </button>
          </header>

          <div class="console-sheet__body" :aria-busy="busy ? 'true' : 'false'">
            <ListState
              v-if="listState"
              :loading="loading"
              :error="error"
              error-title="授权事件加载失败"
              empty-title="暂无授权事件。"
              retry-text="重新读取"
              compact
              @retry="loadEvents(page)"
            />
            <ol v-else class="console-sheet__list" aria-label="授权事件列表">
              <LicenseEventRow v-for="event in items" :key="event.id" :event="event" id-prefix="license-sheet-event" />
            </ol>
          </div>

          <footer class="console-sheet__footer">
            <PaginationBar
              label="授权事件分页"
              :page="page"
              :total="total"
              :page-size="pageSize"
              :loading="busy"
              @change="loadEvents($event)"
            />
          </footer>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>
