<script setup>
import { computed, ref } from 'vue'
import ConsoleIcon from '../../shared/components/ConsoleIcon.vue'

const props = defineProps({
  // 用途：限制可选文件格式，直接传给原生 file input，避免用户选错后再被服务端拒绝。
  accept: { type: String, default: '.pdf,.ofd,.png,.jpg,.jpeg' },
  // 用途：是否允许一次选择多份；批量上传与单份凭证共用同一外观。
  multiple: { type: Boolean, default: false },
  // 用途：禁用时保留说明但不可点击、不可拖放，与页面上其他保存中状态一致。
  disabled: { type: Boolean, default: false },
  // 用途：紧凑模式用于表单内单份凭证，标准模式用于上传工作台。
  compact: { type: Boolean, default: false },
  // 用途：主标题，说明这里要上传什么。
  title: { type: String, default: '拖拽文件到此处，或点击选择' },
  // 用途：辅助说明，交代格式、解析边界或人工复核要求。
  hint: { type: String, default: '' },
  // 用途：操作区文案，默认“选择文件”。
  actionLabel: { type: String, default: '选择文件' },
  // 用途：格式胶囊，标准模式展示；为空时按 accept 推导。
  formats: { type: Array, default: () => [] },
  // 用途：数量与体积上限说明，标准模式底部展示。
  limit: { type: String, default: '' },
  // 用途：无障碍名称，默认省略为标题。
  ariaLabel: { type: String, default: '' },
})
const emit = defineEmits(['files'])

const input = ref(null)
const dragOver = ref(false)
let depth = 0

// 用途：从 accept 字符串推导格式胶囊，避免模板再写一份格式清单。
// 参数：无。
// 返回值：如 PDF、OFD、PNG 的大写标签数组。
const chips = computed(() => {
  if (props.formats.length) return props.formats
  return props.accept.split(',').map((value) => value.trim().replace(/^\./, '')).filter(Boolean)
    .map((value) => value.toUpperCase())
})

// 用途：打开系统文件选择器；禁用或正在上传时不做任何事。
// 参数：无。
// 返回值：无。
function open() {
  if (props.disabled) return
  input.value?.click()
}

// 用途：把原生 change 事件归一化为纯文件数组，交给父层既有受控上传流程。
// 参数：event 为 input 的 change 事件。
// 返回值：无；除文件数组外同时透传原始事件，兼容既有父层事件契约。
function onChange(event) {
  const files = Array.from(event.target?.files || [])
  if (files.length) emit('files', files, event)
  if (input.value) input.value.value = ''
}

// 用途：拖入时进入高亮态；用 depth 计数抵消子元素 dragleave，避免闪烁。
// 参数：无。
// 返回值：无。
function onDragEnter() {
  if (props.disabled) return
  depth += 1
  dragOver.value = true
}

// 用途：离开拖拽区时退出高亮态。
// 参数：无。
// 返回值：无。
function onDragLeave() {
  depth = Math.max(0, depth - 1)
  if (!depth) dragOver.value = false
}

// 用途：接收拖放文件并复用与点击选择相同的校验路径。
// 参数：event 为 drop 事件。
// 返回值：无。
function onDrop(event) {
  depth = 0
  dragOver.value = false
  if (props.disabled) return
  const files = Array.from(event.dataTransfer?.files || [])
  if (files.length) emit('files', files, event)
}

// 用途：键盘用户用 Enter / Space 打开选择器，与鼠标点击等价。
// 参数：event 为键盘事件。
// 返回值：无。
function onKeydown(event) {
  if (event.key !== 'Enter' && event.key !== ' ') return
  event.preventDefault()
  open()
}
</script>

<template>
  <div
    class="expense-dropzone"
    :class="{
      'is-compact': compact,
      'is-dragover': dragOver,
      'is-disabled': disabled,
    }"
    role="button"
    :tabindex="disabled ? -1 : 0"
    :aria-disabled="disabled ? 'true' : 'false'"
    :aria-label="ariaLabel || title"
    @click="open"
    @keydown="onKeydown"
    @dragenter.prevent="onDragEnter"
    @dragover.prevent="onDragEnter"
    @dragleave.prevent="onDragLeave"
    @drop.prevent="onDrop"
  >
    <input
      ref="input"
      class="expense-dropzone__input"
      type="file"
      :accept="accept"
      :multiple="multiple"
      :disabled="disabled"
      tabindex="-1"
      @click.stop
      @change="onChange"
    >
    <span class="expense-dropzone__icon" aria-hidden="true">
      <ConsoleIcon name="nav-upload" />
    </span>
    <span class="expense-dropzone__copy">
      <span class="expense-dropzone__title">{{ title }}</span>
      <span v-if="hint" class="expense-dropzone__hint">{{ hint }}</span>
    </span>
    <span class="expense-dropzone__action" aria-hidden="true">{{ actionLabel }}</span>
    <span v-if="!compact && chips.length" class="expense-dropzone__chips" aria-hidden="true">
      <span v-for="chip in chips" :key="chip" class="expense-dropzone__chip">{{ chip }}</span>
    </span>
    <span v-if="!compact && limit" class="expense-dropzone__limit" aria-hidden="true">{{ limit }}</span>
  </div>
</template>

<style scoped>
.expense-dropzone {
  position: relative;
  display: grid;
  grid-template-columns: 48px minmax(0, 1fr) auto;
  grid-template-areas:
    'icon copy action'
    'chips chips chips'
    'limit limit limit';
  align-items: center;
  column-gap: 14px;
  row-gap: 12px;
  min-height: 168px;
  padding: 20px;
  border: 1px dashed var(--border);
  border-radius: var(--radius-lg);
  background: var(--surface-muted);
  color: var(--text-secondary);
  text-align: left;
  cursor: pointer;
  transition: border-color var(--duration-fast, 150ms) var(--ease-out),
    background var(--duration-fast, 150ms) var(--ease-out);
}

.expense-dropzone.is-compact {
  grid-template-columns: 36px minmax(0, 1fr) auto;
  grid-template-areas: 'icon copy action';
  min-height: 64px;
  padding: 12px 14px;
  row-gap: 0;
  background: var(--surface-card);
}

.expense-dropzone:hover:not(.is-disabled),
.expense-dropzone.is-dragover:not(.is-disabled) {
  border-color: var(--primary);
  background: var(--primary-soft);
}

.expense-dropzone:focus-visible {
  outline: none;
  border-color: var(--primary);
  box-shadow: 0 0 0 3px var(--primary-soft);
}

.expense-dropzone.is-disabled {
  opacity: .6;
  cursor: not-allowed;
}

.expense-dropzone__input {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  border: 0;
  opacity: 0;
  pointer-events: none;
}

.expense-dropzone__icon {
  grid-area: icon;
  display: grid;
  place-items: center;
  width: 48px;
  height: 48px;
  border: 1px solid var(--line-soft);
  border-radius: var(--radius-sm);
  background: var(--surface-card);
  color: var(--primary);
}

.expense-dropzone.is-compact .expense-dropzone__icon {
  width: 36px;
  height: 36px;
}

.expense-dropzone__icon svg {
  width: 22px;
  height: 22px;
}

.expense-dropzone.is-compact .expense-dropzone__icon svg {
  width: 18px;
  height: 18px;
}

.expense-dropzone__copy {
  grid-area: copy;
  display: grid;
  gap: 4px;
  min-width: 0;
}

.expense-dropzone__title {
  color: var(--text);
  font-size: var(--fs-body, 14px);
  font-weight: 600;
  line-height: 1.4;
}

.expense-dropzone.is-compact .expense-dropzone__title {
  font-size: var(--fs-sm, 13px);
}

.expense-dropzone__hint {
  color: var(--text-muted);
  font-size: var(--fs-xs, 12px);
  line-height: 1.6;
  overflow-wrap: anywhere;
}

.expense-dropzone__action {
  grid-area: action;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 34px;
  padding: 0 14px;
  border: 1px solid var(--primary);
  border-radius: var(--radius-sm);
  background: var(--primary);
  color: var(--on-primary, #fff);
  font-size: var(--fs-sm, 13px);
  font-weight: 600;
  white-space: nowrap;
}

.expense-dropzone.is-compact .expense-dropzone__action {
  min-height: 30px;
  padding: 0 10px;
  font-size: var(--fs-xs, 12px);
}

.expense-dropzone.is-compact .expense-dropzone__hint {
  display: none;
}

.expense-dropzone__chips {
  grid-area: chips;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.expense-dropzone__chip {
  display: inline-flex;
  align-items: center;
  height: 22px;
  padding: 0 8px;
  border: 1px solid var(--line-soft);
  border-radius: 999px;
  background: var(--surface-card);
  color: var(--text-muted);
  font-size: var(--fs-xs, 12px);
  font-weight: 600;
  letter-spacing: .02em;
}

.expense-dropzone__limit {
  grid-area: limit;
  color: var(--text-muted);
  font-size: var(--fs-xs, 12px);
  line-height: 1.5;
}
</style>
