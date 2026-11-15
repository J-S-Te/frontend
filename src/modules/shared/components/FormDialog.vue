<script setup>
import { computed, nextTick, onBeforeUnmount, ref, useId, useSlots, watch } from 'vue'
import { acquireBodyScrollLock, releaseBodyScrollLock } from '../utils/bodyScrollLock.js'
import { registerDialogLayer, removeDialogLayer, isTopDialogLayer, focusTopDialogLayer } from '../utils/dialogLayers.js'

// 共享表单/内容弹窗外壳：统一 Teleport、dialogLayers 顶层 Esc、焦点陷阱、body 滚动锁和还焦。
// 只提供结构与最小基线；各模块通过 overlay-class / panel-class / close-class 注入既有皮肤，避免一次迁移改变视觉。
const props = defineProps({
  open: { type: Boolean, default: false },
  title: { type: String, default: '' },
  description: { type: String, default: '' },
  titleId: { type: String, default: '' },
  descriptionId: { type: String, default: '' },
  overlayClass: { type: [String, Array, Object], default: '' },
  panelClass: { type: [String, Array, Object], default: '' },
  closeClass: { type: [String, Array, Object], default: '' },
  closeLabel: { type: String, default: '关闭弹窗' },
  hideClose: { type: Boolean, default: false },
  closeOnBackdrop: { type: Boolean, default: true },
  closeOnEsc: { type: Boolean, default: true },
  busy: { type: Boolean, default: false },
  initialFocus: { type: String, default: '' },
})
const emit = defineEmits(['close'])
const slots = useSlots()
const overlay = ref(null)
const panel = ref(null)
const fallbackTitleId = useId()
const fallbackDescriptionId = useId()
const resolvedTitleId = computed(() => props.titleId || fallbackTitleId)
const resolvedDescriptionId = computed(() => props.descriptionId || fallbackDescriptionId)
const hasCustomHeader = computed(() => Boolean(slots.header))
const hasHeading = computed(() => Boolean(props.title || hasCustomHeader.value))
const hasDescription = computed(() => Boolean(props.description || slots.description))
let previousFocus = null
let layerElement = null
let active = false

function focusable() {
  if (!panel.value) return []
  return [...panel.value.querySelectorAll(
    'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
  )].filter((element) => element.offsetParent !== null)
}

function focusInitial() {
  if (!panel.value) return
  const requested = props.initialFocus ? panel.value.querySelector(props.initialFocus) : null
  const controls = focusable()
  // 表单弹窗优先聚焦第一个可编辑控件；没有表单时才落到关闭按钮/面板。
  const firstControl = controls.find((element) => ['INPUT', 'SELECT', 'TEXTAREA'].includes(element.tagName))
  ;(requested || firstControl || controls[0] || panel.value).focus?.()
}

function onKeydown(event) {
  if (!isTopDialogLayer(layerElement)) return
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopImmediatePropagation()
    if (props.closeOnEsc && !props.busy) emit('close', 'escape')
    return
  }
  if (event.key !== 'Tab') return
  const items = focusable()
  if (!items.length) {
    event.preventDefault()
    panel.value?.focus?.()
    return
  }
  const first = items[0]
  const last = items[items.length - 1]
  if (event.shiftKey && (document.activeElement === first || !panel.value?.contains(document.activeElement))) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && (document.activeElement === last || !panel.value?.contains(document.activeElement))) {
    event.preventDefault()
    first.focus()
  }
}

async function activate() {
  if (active) return
  await nextTick()
  if (active || !props.open || !overlay.value || !panel.value) return
  active = true
  previousFocus = document.activeElement
  layerElement = overlay.value
  registerDialogLayer(layerElement)
  document.addEventListener('keydown', onKeydown, true)
  acquireBodyScrollLock()
  if (isTopDialogLayer(layerElement)) focusInitial()
}

function deactivate() {
  if (!active) return
  active = false
  document.removeEventListener('keydown', onKeydown, true)
  const wasTop = removeDialogLayer(layerElement)
  releaseBodyScrollLock()
  layerElement = null
  if (wasTop && !focusTopDialogLayer() && previousFocus?.isConnected && typeof previousFocus.focus === 'function') previousFocus.focus()
}

function requestClose(reason = 'button') {
  if (props.busy) return
  if (reason === 'backdrop' && !props.closeOnBackdrop) return
  if (reason === 'escape' && !props.closeOnEsc) return
  emit('close', reason)
}

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
    <Transition name="ui-form-dialog" appear>
      <div
        v-if="open"
        ref="overlay"
        class="ui-form-dialog"
        :class="overlayClass"
        @mousedown.self="requestClose('backdrop')"
      >
        <article
          ref="panel"
          class="ui-form-dialog__panel"
          :class="panelClass"
          role="dialog"
          aria-modal="true"
          :aria-labelledby="hasHeading ? resolvedTitleId : undefined"
          :aria-describedby="hasDescription ? resolvedDescriptionId : undefined"
          tabindex="-1"
        >
          <header v-if="hasHeading || !hideClose" class="ui-form-dialog__header">
            <div class="ui-form-dialog__heading">
              <slot name="header">
                <h2 v-if="title" :id="resolvedTitleId" class="ui-form-dialog__title">{{ title }}</h2>
                <p v-if="description" :id="resolvedDescriptionId" class="ui-form-dialog__description">{{ description }}</p>
              </slot>
            </div>
            <button
              v-if="!hideClose"
              type="button"
              class="ui-form-dialog__close"
              :class="closeClass"
              :disabled="busy"
              :aria-label="closeLabel"
              @click="requestClose('button')"
            >×</button>
          </header>
          <div class="ui-form-dialog__body">
            <slot />
          </div>
          <footer v-if="$slots.footer" class="ui-form-dialog__footer">
            <slot name="footer" />
          </footer>
        </article>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.ui-form-dialog {
  position: fixed;
  z-index: var(--z-modal, 10000);
  inset: 0;
  display: grid;
  box-sizing: border-box;
  place-items: center;
  padding: 24px;
  overflow-y: auto;
  background: var(--overlay-scrim);
}
.ui-form-dialog__panel {
  display: flex;
  width: min(680px, 100%);
  max-height: calc(100dvh - 48px);
  flex-direction: column;
  box-sizing: border-box;
  overflow: auto;
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 14px;
  background: var(--surface-card);
  box-shadow: var(--shadow-modal);
  outline: none;
}
.ui-form-dialog__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 20px 22px 0;
}
.ui-form-dialog__heading {
  min-width: 0;
  flex: 1;
}
.ui-form-dialog__title {
  margin: 0;
  color: var(--text-strong);
  font-size: 18px;
  line-height: 1.35;
  overflow-wrap: anywhere;
}
.ui-form-dialog__description {
  margin: 7px 0 0;
  color: var(--text-muted);
  font-size: 13px;
  line-height: 1.65;
  overflow-wrap: anywhere;
}
.ui-form-dialog__close {
  display: grid;
  width: 32px;
  height: 32px;
  flex: 0 0 auto;
  place-items: center;
  padding: 0;
  color: var(--text-muted);
  font-size: 22px;
  line-height: 1;
  cursor: pointer;
  border: 0;
  border-radius: 7px;
  background: transparent;
}
.ui-form-dialog__close:hover:not(:disabled) {
  color: var(--text);
  background: var(--surface-hover);
}
.ui-form-dialog__close:disabled {
  cursor: not-allowed;
  opacity: .55;
}
.ui-form-dialog__body {
  min-height: 0;
  padding: 16px 22px 20px;
  overflow-wrap: anywhere;
}
.ui-form-dialog__footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 0 22px 20px;
}
.ui-form-dialog-enter-active,
.ui-form-dialog-leave-active { transition: opacity 180ms ease; }
.ui-form-dialog-leave-active { transition-duration: 120ms; }
.ui-form-dialog-enter-from,
.ui-form-dialog-leave-to { opacity: 0; }
.ui-form-dialog-enter-active .ui-form-dialog__panel,
.ui-form-dialog-leave-active .ui-form-dialog__panel {
  transition: transform 180ms ease, opacity 180ms ease;
}
.ui-form-dialog-enter-from .ui-form-dialog__panel {
  opacity: 0;
  transform: translateY(8px) scale(.985);
}
.ui-form-dialog-leave-to .ui-form-dialog__panel {
  opacity: 0;
  transform: scale(.99);
}
@media (max-width: 520px) {
  .ui-form-dialog { padding: 10px; }
  .ui-form-dialog__panel { max-height: calc(100dvh - 20px); }
  .ui-form-dialog__header { padding: 16px 16px 0; }
  .ui-form-dialog__body { padding: 14px 16px 16px; }
  .ui-form-dialog__footer { flex-direction: column-reverse; padding: 0 16px 16px; }
  .ui-form-dialog__footer :deep(button) { width: 100%; }
}
@media (prefers-reduced-motion: reduce) {
  .ui-form-dialog-enter-active,
  .ui-form-dialog-leave-active,
  .ui-form-dialog-enter-active .ui-form-dialog__panel,
  .ui-form-dialog-leave-active .ui-form-dialog__panel { transition: none; }
}
</style>
