<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, useId } from 'vue'
import { acquireBodyScrollLock, releaseBodyScrollLock } from '../utils/bodyScrollLock.js'
import { registerDialogLayer, removeDialogLayer, isTopDialogLayer, focusTopDialogLayer } from '../utils/dialogLayers.js'

const props = defineProps({
  title: { type: String, required: true },
  description: { type: String, default: '' },
  label: { type: String, default: '说明' },
  placeholder: { type: String, default: '' },
  confirmText: { type: String, required: true },
  fields: { type: Array, default: () => [] },
  danger: { type: Boolean, default: false },
  busyText: { type: String, default: '' },
  cancelText: { type: String, default: '取消' },
  minlength: { type: Number, default: 0 },
  maxlength: { type: Number, default: 1000 },
  busy: { type: Boolean, default: false },
  error: { type: String, default: '' },
  initialValue: { type: String, default: '' },
})
const emit = defineEmits(['confirm', 'cancel'])
const value = ref(props.initialValue)
const form = ref(null)
const values = reactive(Object.fromEntries(
  props.fields.map(field => [field.name, String(field.initialValue ?? '')]),
))
const valid = computed(() => props.fields.length
  ? props.fields.every(field => {
    const text = String(values[field.name] ?? '').trim()
    if (field.required && !text) return false
    if (text && text.length < (field.minlength || 0)) return false
    return text.length <= (field.maxlength ?? 1000)
  })
  : value.value.trim().length >= props.minlength)

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
  if (isTopDialogLayer(layerElement)) {
    const firstInput = form.value?.querySelector('input, textarea')
    firstInput?.focus()
  }
})
onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeydown, true)
  const wasTop = removeDialogLayer(layerElement)
  releaseBodyScrollLock()
  if (wasTop && !focusTopDialogLayer() && previousFocus?.isConnected && typeof previousFocus.focus === 'function') previousFocus.focus()
})

// cancel 关闭输入弹窗且不提交业务操作。
// 参数：无。
// 返回值：无；忙碌时保持弹窗。
function cancel() {
  if (!props.busy) emit('cancel')
}
// submit 在输入完整且原生字段约束通过后返回用户填写的值。
// 参数：无。
// 返回值：无；无效或忙碌时不触发提交事件。
function submit() {
  if (props.busy || !valid.value || !form.value?.reportValidity()) return
  emit('confirm', props.fields.length ? { ...values } : value.value)
}
// onKeydown 将键盘操作限制在最上层弹窗中。
// 参数：event 为键盘事件。
// 返回值：无；Escape 取消，Tab 在可用控件间循环。
function onKeydown(event) {
  if (!isTopDialogLayer(layerElement)) return
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopImmediatePropagation()
    cancel()
    return
  }
  if (event.key !== 'Tab' || !dialog.value) return
  const items = [...dialog.value.querySelectorAll('button:not([disabled]), input:not([disabled]), textarea:not([disabled])')]
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
        <form ref="form" @submit.prevent="submit">
          <template v-if="fields.length">
            <label v-for="field in fields" :key="field.name" class="shared-prompt-field">
              <span>{{ field.label }}</span>
              <textarea v-if="field.type === 'textarea'" v-model="values[field.name]"
                :required="field.required" :minlength="field.minlength"
                :maxlength="field.maxlength ?? 1000" :placeholder="field.placeholder"
                :disabled="busy" rows="4"></textarea>
              <input v-else v-model="values[field.name]" :type="field.type || 'text'"
                :required="field.required" :minlength="field.minlength"
                :maxlength="field.maxlength ?? 1000" :placeholder="field.placeholder"
                :disabled="busy" />
            </label>
          </template>
          <label v-else class="shared-prompt-field">
            <span>{{ label }}</span>
            <textarea
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
            <button
              type="submit"
              :class="['shared-prompt-button', danger ? 'danger' : 'primary']"
              :disabled="busy || !valid"
            >{{ busy ? (busyText || `${confirmText}中…`) : confirmText }}</button>
          </footer>
        </form>
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
.shared-prompt-field textarea, .shared-prompt-field input { box-sizing: border-box; width: 100%; padding: 10px 12px; border: 1px solid #cbd5e1; border-radius: 8px; color: #1f2937; font: inherit; line-height: 1.6; resize: vertical; }
.shared-prompt-field small { display: block; margin-top: 4px; color: #64748b; text-align: right; }
.shared-prompt-error { margin: 10px 24px 0; color: #b42318; line-height: 1.6; }
.shared-prompt footer { display: flex; justify-content: flex-end; gap: 12px; padding: 22px 24px 24px; }
.shared-prompt-button { border: 1px solid transparent; border-radius: 9px; padding: 10px 18px; font: inherit; font-weight: 600; cursor: pointer; }
.shared-prompt-button:disabled { cursor: not-allowed; opacity: .55; }
.shared-prompt-button.secondary { border-color: #cbd5e1; background: #fff; color: #334155; }
.shared-prompt-button.primary { background: #235fcb; color: #fff; }
.shared-prompt-button.danger { background: #b42318; color: #fff; }
@media (max-width: 520px) { .shared-prompt-mask { padding: 12px; } .shared-prompt footer { flex-direction: column-reverse; } .shared-prompt-button { width: 100%; } }

/* Keep long titles and server messages inside the existing dialog. */
.shared-prompt-mask { overflow-y: auto; box-sizing: border-box; }
.shared-prompt { min-width: 0; box-sizing: border-box; max-height: calc(100dvh - 48px); overflow-y: auto; overflow-wrap: anywhere; }
.shared-prompt header > div { min-width: 0; }
.shared-prompt header > button { flex: 0 0 auto; align-self: flex-start; }
.shared-prompt footer button { white-space: normal; overflow-wrap: anywhere; min-width: 0; }
@media (max-width: 520px) { .shared-prompt { max-height: calc(100dvh - 24px); } }

/* 深色主题：共享输入弹窗的白卡、遮罩、输入框与墨色；浅色声明未改。 */
[data-theme="dark"] .shared-prompt-mask {
  background: var(--overlay-scrim);
}
[data-theme="dark"] .shared-prompt {
  background: var(--surface-card);
  box-shadow: var(--shadow-modal);
}
[data-theme="dark"] .shared-prompt header p {
  color: var(--primary-ink);
}
[data-theme="dark"] .shared-prompt header h3 {
  color: var(--text);
}
[data-theme="dark"] .shared-prompt header button {
  color: var(--text-muted);
}
[data-theme="dark"] .shared-prompt-description {
  color: var(--text-secondary);
}
[data-theme="dark"] .shared-prompt-field > span {
  color: var(--text-secondary);
}
[data-theme="dark"] .shared-prompt-field textarea,
[data-theme="dark"] .shared-prompt-field input {
  border-color: var(--border);
  background: var(--surface-input);
  color: var(--text);
}
[data-theme="dark"] .shared-prompt-field small {
  color: var(--text-muted);
}
[data-theme="dark"] .shared-prompt-error {
  color: var(--danger-text);
}
[data-theme="dark"] .shared-prompt-button.secondary {
  color: var(--text-secondary);
  border-color: var(--border);
  background: var(--surface-raised);
}
</style>
