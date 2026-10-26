<script setup>
import { nextTick, onBeforeUnmount, onMounted, ref, useId } from 'vue'
import { acquireBodyScrollLock, releaseBodyScrollLock } from '../utils/bodyScrollLock.js'
import { registerDialogLayer, removeDialogLayer, isTopDialogLayer, focusTopDialogLayer } from '../utils/dialogLayers.js'

const props = defineProps({
  title: { type: String, required: true },
  description: { type: String, default: '' },
  label: { type: String, default: '说明' },
  placeholder: { type: String, default: '' },
  confirmText: { type: String, default: '提交' },
  cancelText: { type: String, default: '取消' },
  minlength: { type: Number, default: 0 },
  maxlength: { type: Number, default: 1000 },
  busy: { type: Boolean, default: false },
  error: { type: String, default: '' },
  initialValue: { type: String, default: '' },
})
const emit = defineEmits(['confirm', 'cancel'])
const value = ref(props.initialValue)
const input = ref(null)
const dialog = ref(null)
let previousFocus = null
let layerElement = null
const descriptionId = useId()

onMounted(async () => {
  previousFocus = document.activeElement
  layerElement = dialog.value?.parentElement
  registerDialogLayer(layerElement)
  document.addEventListener('keydown', onKeydown, true)
  acquireBodyScrollLock()
  await nextTick()
  if (isTopDialogLayer(layerElement)) input.value?.focus()
})
onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeydown, true)
  const wasTop = removeDialogLayer(layerElement)
  releaseBodyScrollLock()
  if (wasTop && !focusTopDialogLayer() && previousFocus?.isConnected && typeof previousFocus.focus === 'function') previousFocus.focus()
})

function cancel() {
  if (!props.busy) emit('cancel')
}
function submit() {
  if (!props.busy) emit('confirm', value.value)
}
function onKeydown(event) {
  if (!isTopDialogLayer(layerElement)) return
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopImmediatePropagation()
    cancel()
    return
  }
  if (event.key !== 'Tab' || !dialog.value) return
  const items = [...dialog.value.querySelectorAll('button:not([disabled]), textarea:not([disabled])')]
  if (!items.length) {
    event.preventDefault()
    dialog.value.focus()
    return
  }
  const first = items[0], last = items[items.length - 1]
  if (event.shiftKey && (document.activeElement === first || !dialog.value.contains(document.activeElement))) {
    event.preventDefault(); last.focus()
  } else if (!event.shiftKey && (document.activeElement === last || !dialog.value.contains(document.activeElement))) {
    event.preventDefault(); first.focus()
  }
}
</script>

<template>
  <Teleport to="body">
    <div class="shared-prompt-mask" @click.self="cancel">
      <section ref="dialog" tabindex="-1" class="shared-prompt" role="dialog" aria-modal="true" :aria-label="title" :aria-describedby="description ? descriptionId : undefined">
        <header>
          <div><p>需要补充说明</p><h3>{{ title }}</h3></div>
          <button type="button" aria-label="关闭" :disabled="busy" @click="cancel">×</button>
        </header>
        <p v-if="description" :id="descriptionId" class="shared-prompt-description">{{ description }}</p>
        <label class="shared-prompt-field">
          <span>{{ label }}</span>
          <textarea
            ref="input"
            v-model="value"
            :placeholder="placeholder"
            :maxlength="maxlength"
            :minlength="minlength"
            :disabled="busy"
            rows="5"
          ></textarea>
          <small>{{ value.length }} / {{ maxlength }}</small>
        </label>
        <p v-if="error" class="shared-prompt-error" role="alert">{{ error }}</p>
        <footer>
          <button type="button" class="shared-prompt-button secondary" :disabled="busy" @click="cancel">{{ cancelText }}</button>
          <button type="button" class="shared-prompt-button primary" :disabled="busy || value.trim().length < minlength" @click="submit">{{ busy ? '正在提交…' : confirmText }}</button>
        </footer>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.shared-prompt-mask { position: fixed; inset: 0; z-index: 10000; display: grid; place-items: center; padding: 24px; background: rgba(15, 23, 42, .52); }
.shared-prompt { width: min(560px, 100%); border-radius: 16px; background: #fff; box-shadow: 0 24px 64px rgba(15, 23, 42, .24); }
.shared-prompt header { display: flex; justify-content: space-between; gap: 16px; padding: 24px 24px 0; }
.shared-prompt header p { margin: 0 0 4px; color: #235fcb; font-size: 12px; font-weight: 700; letter-spacing: .08em; }
.shared-prompt header h3 { margin: 0; color: #1f2937; font-size: 20px; line-height: 1.4; }
.shared-prompt header button { border: 0; background: transparent; color: #64748b; font-size: 24px; line-height: 1; cursor: pointer; }
.shared-prompt-description { margin: 14px 24px 0; color: #475569; line-height: 1.7; }
.shared-prompt-field { display: block; margin: 18px 24px 0; }
.shared-prompt-field > span { display: block; margin-bottom: 8px; color: #334155; font-weight: 600; }
.shared-prompt-field textarea { box-sizing: border-box; width: 100%; padding: 10px 12px; border: 1px solid #cbd5e1; border-radius: 8px; color: #1f2937; font: inherit; line-height: 1.6; resize: vertical; }
.shared-prompt-field small { display: block; margin-top: 4px; color: #64748b; text-align: right; }
.shared-prompt-error { margin: 10px 24px 0; color: #b42318; line-height: 1.6; }
.shared-prompt footer { display: flex; justify-content: flex-end; gap: 12px; padding: 22px 24px 24px; }
.shared-prompt-button { border: 1px solid transparent; border-radius: 9px; padding: 10px 18px; font: inherit; font-weight: 600; cursor: pointer; }
.shared-prompt-button:disabled { cursor: not-allowed; opacity: .55; }
.shared-prompt-button.secondary { border-color: #cbd5e1; background: #fff; color: #334155; }
.shared-prompt-button.primary { background: #235fcb; color: #fff; }
@media (max-width: 520px) { .shared-prompt-mask { padding: 12px; } .shared-prompt footer { flex-direction: column-reverse; } .shared-prompt-button { width: 100%; } }

/* Keep long titles and server messages inside the existing dialog. */
.shared-prompt-mask { overflow-y: auto; box-sizing: border-box; }
.shared-prompt { min-width: 0; box-sizing: border-box; max-height: calc(100dvh - 48px); overflow-y: auto; overflow-wrap: anywhere; }
.shared-prompt header > div { min-width: 0; }
.shared-prompt header > button { flex: 0 0 auto; align-self: flex-start; }
.shared-prompt footer button { white-space: normal; overflow-wrap: anywhere; min-width: 0; }
@media (max-width: 520px) { .shared-prompt { max-height: calc(100dvh - 24px); } }
</style>
