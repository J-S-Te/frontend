<script setup>
import { computed, nextTick, onBeforeUnmount, reactive, ref, useId, watch } from 'vue'
import { acquireBodyScrollLock, releaseBodyScrollLock } from '../utils/bodyScrollLock.js'
import { registerDialogLayer, removeDialogLayer, isTopDialogLayer, focusTopDialogLayer } from '../utils/dialogLayers.js'

const props = defineProps({
  open: { type: Boolean, default: true },
  title: { type: String, default: '' },
  description: { type: String, default: '' },
  label: { type: String, default: '说明' },
  placeholder: { type: String, default: '' },
  confirmText: { type: String, default: '' },
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

// 弹窗关闭后父级会立刻清空数据，渲染改用最近一次的显示快照，
// 避免退场动画期间标题、说明和按钮被清空造成闪白。
const shown = ref({
  title: props.title,
  description: props.description,
  label: props.label,
  placeholder: props.placeholder,
  confirmText: props.confirmText,
  fields: props.fields,
  danger: props.danger,
  busyText: props.busyText,
  cancelText: props.cancelText,
  minlength: props.minlength,
  maxlength: props.maxlength,
  busy: props.busy,
  error: props.error,
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
let active = false
const descriptionId = useId()

// resetForm 把输入值恢复为本次弹窗的初始内容。
// 参数：无。
// 返回值：无；多字段与单字段输入都会重置。
function resetForm() {
  value.value = props.initialValue
  for (const key of Object.keys(values)) delete values[key]
  for (const field of props.fields) values[field.name] = String(field.initialValue ?? '')
}

// activate 在弹窗真正显示后登记焦点层、锁定滚动并聚焦首个输入框。
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
  if (isTopDialogLayer(layerElement)) {
    const firstInput = form.value?.querySelector('input, textarea')
    firstInput?.focus()
  }
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
  () => [
    props.title, props.description, props.label, props.placeholder, props.confirmText,
    props.fields, props.danger, props.busyText, props.cancelText, props.minlength,
    props.maxlength, props.busy, props.error,
  ],
  () => {
    if (!props.open) return
    shown.value = {
      title: props.title,
      description: props.description,
      label: props.label,
      placeholder: props.placeholder,
      confirmText: props.confirmText,
      fields: props.fields,
      danger: props.danger,
      busyText: props.busyText,
      cancelText: props.cancelText,
      minlength: props.minlength,
      maxlength: props.maxlength,
      busy: props.busy,
      error: props.error,
    }
  },
  { immediate: true },
)

watch(
  () => props.open,
  (open) => {
    if (open) {
      resetForm()
      activate()
    } else {
      deactivate()
    }
  },
  { immediate: true },
)

onBeforeUnmount(deactivate)

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
    <Transition name="shared-prompt" appear>
      <div v-if="open" class="shared-prompt-mask" @click.self="cancel">
        <section ref="dialog" tabindex="-1" class="shared-prompt" role="dialog" aria-modal="true" :aria-label="shown.title" :aria-describedby="shown.description ? descriptionId : undefined">
          <header>
            <div><p>需要补充说明</p><h3>{{ shown.title }}</h3></div>
            <button type="button" aria-label="关闭" :disabled="shown.busy" @click="cancel">×</button>
          </header>
          <p v-if="shown.description" :id="descriptionId" class="shared-prompt-description">{{ shown.description }}</p>
          <form ref="form" @submit.prevent="submit">
            <template v-if="shown.fields.length">
              <label v-for="field in shown.fields" :key="field.name" class="shared-prompt-field">
                <span>{{ field.label }}</span>
                <textarea v-if="field.type === 'textarea'" v-model="values[field.name]"
                  :required="field.required" :minlength="field.minlength"
                  :maxlength="field.maxlength ?? 1000" :placeholder="field.placeholder"
                  :disabled="shown.busy" rows="4"></textarea>
                <input v-else v-model="values[field.name]" :type="field.type || 'text'"
                  :required="field.required" :minlength="field.minlength"
                  :maxlength="field.maxlength ?? 1000" :placeholder="field.placeholder"
                  :disabled="shown.busy" />
              </label>
            </template>
            <label v-else class="shared-prompt-field">
              <span>{{ shown.label }}</span>
              <textarea
                v-model="value"
                :placeholder="shown.placeholder"
                :maxlength="shown.maxlength"
                :minlength="shown.minlength"
                :disabled="shown.busy"
                rows="5"
              ></textarea>
              <small>{{ value.length }} / {{ shown.maxlength }}</small>
            </label>
            <p v-if="shown.error" class="shared-prompt-error" role="alert">{{ shown.error }}</p>
            <footer>
              <button type="button" class="shared-prompt-button secondary" :disabled="shown.busy" @click="cancel">{{ shown.cancelText }}</button>
              <button
                type="submit"
                :class="['shared-prompt-button', shown.danger ? 'danger' : 'primary']"
                :disabled="shown.busy || !valid"
              >{{ shown.busy ? (shown.busyText || `${shown.confirmText}中…`) : shown.confirmText }}</button>
            </footer>
          </form>
        </section>
      </div>
    </Transition>
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

/* 进出场：遮罩淡入淡出，卡片轻微上浮缩放；退场约为进场的 65%。 */
.shared-prompt-enter-active,
.shared-prompt-leave-active {
  transition: opacity 200ms var(--ease-out);
}
.shared-prompt-leave-active { transition-duration: 130ms; }
.shared-prompt-enter-from,
.shared-prompt-leave-to { opacity: 0; }
.shared-prompt-enter-active .shared-prompt,
.shared-prompt-leave-active .shared-prompt {
  transition:
    opacity 200ms var(--ease-out),
    transform 200ms var(--ease-out);
}
.shared-prompt-leave-active .shared-prompt { transition-duration: 130ms; }
.shared-prompt-enter-from .shared-prompt {
  opacity: 0;
  transform: translateY(8px) scale(.96);
}
.shared-prompt-leave-to .shared-prompt {
  opacity: 0;
  transform: scale(.98);
}
@media (prefers-reduced-motion: reduce) {
  .shared-prompt-enter-from .shared-prompt,
  .shared-prompt-leave-to .shared-prompt { transform: none; }
}

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
