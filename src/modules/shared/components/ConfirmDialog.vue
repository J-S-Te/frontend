<script setup>
import { nextTick, onBeforeUnmount, onMounted, ref, useId } from 'vue'
import { acquireBodyScrollLock, releaseBodyScrollLock } from '../utils/bodyScrollLock.js'
import { registerDialogLayer, removeDialogLayer, isTopDialogLayer, focusTopDialogLayer } from '../utils/dialogLayers.js'

const props = defineProps({
  title: { type: String, required: true },
  description: { type: String, default: '' },
  confirmText: { type: String, default: '确认' },
  cancelText: { type: String, default: '取消' },
  danger: { type: Boolean, default: false },
  busy: { type: Boolean, default: false },
})
const emit = defineEmits(['confirm', 'cancel'])
const dialog = ref(null)
const confirmButton = ref(null)
let previousFocus = null
let layerElement = null
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

onMounted(async () => {
  previousFocus = document.activeElement
  layerElement = dialog.value?.parentElement
  registerDialogLayer(layerElement)
  document.addEventListener('keydown', onKeydown, true)
  acquireBodyScrollLock()
  await nextTick()
  if (isTopDialogLayer(layerElement)) confirmButton.value?.focus()
});

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeydown, true)
  const wasTop = removeDialogLayer(layerElement)
  releaseBodyScrollLock()
  if (wasTop && !focusTopDialogLayer() && previousFocus?.isConnected && typeof previousFocus.focus === 'function') previousFocus.focus()
})
</script>

<template>
  <Teleport to="body">
    <div class="shared-confirm-mask" @click.self="!busy && emit('cancel')">
      <section
        ref="dialog"
        class="shared-confirm"
        tabindex="-1"
        role="alertdialog"
        aria-modal="true"
        :aria-label="title"
        :aria-describedby="description ? descriptionId : undefined"
      >
        <header>
          <div>
            <p>{{ danger ? '危险操作' : '请确认' }}</p>
            <h3>{{ title }}</h3>
          </div>
          <button type="button" class="shared-confirm-close" :disabled="busy" aria-label="关闭确认" @click="emit('cancel')">×</button>
        </header>
        <p v-if="description" :id="descriptionId" class="shared-confirm-description">{{ description }}</p>
        <footer>
          <button type="button" class="shared-confirm-button secondary" :disabled="busy" @click="emit('cancel')">{{ cancelText }}</button>
          <button
            ref="confirmButton"
            type="button"
            :class="['shared-confirm-button', danger ? 'danger' : 'primary']"
            :disabled="busy"
            @click="emit('confirm')"
          >{{ busy ? '正在处理…' : confirmText }}</button>
        </footer>
      </section>
    </div>
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
</style>
