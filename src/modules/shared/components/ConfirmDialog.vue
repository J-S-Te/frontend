<script setup>
import { nextTick, onBeforeUnmount, ref, useId, watch } from 'vue'
import { acquireBodyScrollLock, releaseBodyScrollLock } from '../utils/bodyScrollLock.js'
import { registerDialogLayer, removeDialogLayer, isTopDialogLayer, focusTopDialogLayer } from '../utils/dialogLayers.js'

const props = defineProps({
  open: { type: Boolean, default: true },
  title: { type: String, default: '' },
  description: { type: String, default: '' },
  confirmText: { type: String, default: '' },
  cancelText: { type: String, default: '取消' },
  danger: { type: Boolean, default: false },
  busy: { type: Boolean, default: false },
})

// 弹窗关闭后父级会立刻清空数据，渲染改用最近一次的显示快照，
// 避免退场动画期间标题和按钮被清空造成闪白。
const shown = ref({
  title: props.title,
  description: props.description,
  confirmText: props.confirmText,
  cancelText: props.cancelText,
  danger: props.danger,
  busy: props.busy,
})
const emit = defineEmits(['confirm', 'cancel'])
const dialog = ref(null)
const confirmButton = ref(null)
let previousFocus = null
let layerElement = null
let active = false
const descriptionId = useId()

function focusable() {
  if (!dialog.value) return []
  return [...dialog.value.querySelectorAll(
    'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
  )].filter((element) => element.offsetParent !== null)
}

function onKeydown(event) {
  if (!isTopDialogLayer(layerElement)) return
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopImmediatePropagation()
    if (!props.busy) emit('cancel')
    return
  }
  if (event.key !== 'Tab') return
  const items = focusable()
  if (!items.length) {
    event.preventDefault()
    dialog.value?.focus()
    return
  }
  const first = items[0]
  const last = items[items.length - 1]
  if (event.shiftKey && (document.activeElement === first || !dialog.value?.contains(document.activeElement))) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && (document.activeElement === last || !dialog.value?.contains(document.activeElement))) {
    event.preventDefault()
    first.focus()
  }
}

// activate 在弹窗真正显示后登记焦点层并锁定页面滚动。
// 参数：无。
// 返回值：无；重复调用或弹窗已关闭时直接返回。
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
  if (isTopDialogLayer(layerElement)) confirmButton.value?.focus()
}

// deactivate 在弹窗关闭或卸载时释放焦点层与滚动锁。
// 参数：无。
// 返回值：无；未激活时直接返回。
function deactivate() {
  if (!active) return
  active = false
  document.removeEventListener('keydown', onKeydown, true)
  const wasTop = removeDialogLayer(layerElement)
  releaseBodyScrollLock()
  layerElement = null
  if (wasTop && !focusTopDialogLayer() && previousFocus?.isConnected && typeof previousFocus.focus === 'function') previousFocus.focus()
}

watch(
  () => [props.title, props.description, props.confirmText, props.cancelText, props.danger, props.busy],
  () => {
    if (!props.open) return
    shown.value = {
      title: props.title,
      description: props.description,
      confirmText: props.confirmText,
      cancelText: props.cancelText,
      danger: props.danger,
      busy: props.busy,
    }
  },
  { immediate: true },
)

watch(
  () => props.open,
  (open) => {
    if (open) activate()
    else deactivate()
  },
  { immediate: true },
)

onBeforeUnmount(deactivate)
</script>

<template>
  <Teleport to="body">
    <Transition name="shared-confirm" appear>
      <div v-if="open" class="shared-confirm-mask" @click.self="!shown.busy && emit('cancel')">
        <section
          ref="dialog"
          class="shared-confirm"
          tabindex="-1"
          role="alertdialog"
          aria-modal="true"
          :aria-label="shown.title"
          :aria-describedby="shown.description ? descriptionId : undefined"
        >
          <header>
            <div>
              <p>{{ shown.danger ? '危险操作' : '请确认' }}</p>
              <h3>{{ shown.title }}</h3>
            </div>
            <button type="button" class="shared-confirm-close" :disabled="shown.busy" aria-label="关闭确认" @click="emit('cancel')">×</button>
          </header>
          <p v-if="shown.description" :id="descriptionId" class="shared-confirm-description">{{ shown.description }}</p>
          <footer>
            <button type="button" class="shared-confirm-button secondary" :disabled="shown.busy" @click="emit('cancel')">{{ shown.cancelText }}</button>
            <button
              ref="confirmButton"
              type="button"
              :class="['shared-confirm-button', shown.danger ? 'danger' : 'primary']"
              :disabled="shown.busy"
              @click="emit('confirm')"
            >{{ shown.busy ? '正在处理…' : shown.confirmText }}</button>
          </footer>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.shared-confirm-mask { position: fixed; inset: 0; z-index: 10000; display: grid; place-items: center; padding: 24px; background: rgba(15, 23, 42, .52); }
.shared-confirm { width: min(520px, 100%); border-radius: 16px; background: #fff; box-shadow: 0 24px 64px rgba(15, 23, 42, .24); overflow: hidden; }
.shared-confirm header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; padding: 24px 24px 0; }
.shared-confirm header p { margin: 0 0 4px; color: #b42318; font-size: 12px; font-weight: 700; letter-spacing: .08em; }
.shared-confirm header h3 { margin: 0; color: #1f2937; font-size: 20px; line-height: 1.4; }
.shared-confirm-close { border: 0; background: transparent; color: #64748b; font-size: 24px; line-height: 1; cursor: pointer; padding: 0 2px; }
.shared-confirm-close:disabled { cursor: not-allowed; opacity: .5; }
.shared-confirm-description { margin: 16px 24px 0; color: #475569; line-height: 1.75; white-space: pre-line; }
.shared-confirm footer { display: flex; justify-content: flex-end; gap: 12px; padding: 24px; }
.shared-confirm-button { border: 1px solid transparent; border-radius: 9px; padding: 10px 18px; font: inherit; font-weight: 600; cursor: pointer; }
.shared-confirm-button:disabled { cursor: not-allowed; opacity: .55; }
.shared-confirm-button.secondary { border-color: #cbd5e1; background: #fff; color: #334155; }
.shared-confirm-button.primary { background: #235fcb; color: #fff; }
.shared-confirm-button.danger { background: #b42318; color: #fff; }
@media (max-width: 520px) {
  .shared-confirm-mask { padding: 12px; }
  .shared-confirm footer { flex-direction: column-reverse; }
  .shared-confirm-button { width: 100%; }
}

/* Keep long titles and server messages inside the existing dialog. */
.shared-confirm-mask { overflow-y: auto; box-sizing: border-box; }
.shared-confirm { min-width: 0; box-sizing: border-box; max-height: calc(100dvh - 48px); overflow-y: auto; overflow-wrap: anywhere; }
.shared-confirm header > div { min-width: 0; }
.shared-confirm header > button { flex: 0 0 auto; }
.shared-confirm footer button { white-space: normal; overflow-wrap: anywhere; min-width: 0; }
@media (max-width: 520px) { .shared-confirm { max-height: calc(100dvh - 24px); } }

/* 进出场：遮罩淡入淡出，卡片轻微上浮缩放；退场约为进场的 65%。 */
.shared-confirm-enter-active,
.shared-confirm-leave-active {
  transition: opacity 200ms var(--ease-out);
}
.shared-confirm-leave-active { transition-duration: 130ms; }
.shared-confirm-enter-from,
.shared-confirm-leave-to { opacity: 0; }
.shared-confirm-enter-active .shared-confirm,
.shared-confirm-leave-active .shared-confirm {
  transition:
    opacity 200ms var(--ease-out),
    transform 200ms var(--ease-out);
}
.shared-confirm-leave-active .shared-confirm { transition-duration: 130ms; }
.shared-confirm-enter-from .shared-confirm {
  opacity: 0;
  transform: translateY(8px) scale(.96);
}
.shared-confirm-leave-to .shared-confirm {
  opacity: 0;
  transform: scale(.98);
}
@media (prefers-reduced-motion: reduce) {
  .shared-confirm-enter-from .shared-confirm,
  .shared-confirm-leave-to .shared-confirm { transform: none; }
}

/* 深色主题：共享确认弹窗的白卡、遮罩与深浅墨色；浅色声明未改。 */
[data-theme="dark"] .shared-confirm-mask {
  background: var(--overlay-scrim);
}
[data-theme="dark"] .shared-confirm {
  background: var(--surface-card);
  box-shadow: var(--shadow-modal);
}
[data-theme="dark"] .shared-confirm header p {
  color: var(--danger-text);
}
[data-theme="dark"] .shared-confirm header h3 {
  color: var(--text);
}
[data-theme="dark"] .shared-confirm-close {
  color: var(--text-muted);
}
[data-theme="dark"] .shared-confirm-description {
  color: var(--text-secondary);
}
[data-theme="dark"] .shared-confirm-button.secondary {
  color: var(--text-secondary);
  border-color: var(--border);
  background: var(--surface-raised);
}
</style>
