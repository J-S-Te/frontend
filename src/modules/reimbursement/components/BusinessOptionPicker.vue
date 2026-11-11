<script setup>
// 业务对象选择器：按名称搜索、分页加载既有选项接口，选择后只提交内部引用。
// 不再让用户手抄组织 ID、文件 ID 等内部标识；接口能力不足时由调用方说明缺口。
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { reimbursementAPI as api } from '../api/reimbursement.js'
import {
  hasMoreOptions, mergeOptionPage, normalizeOptionPage, optionEmptyText, optionQuery, optionValue,
} from '../optionPicker.js'

const props = defineProps({
  modelValue: { type: [String, Array], default: '' },
  // 固定选项接口路径；不允许调用方拼任意查询。
  path: { type: String, required: true },
  purpose: { type: String, default: '' },
  valueKey: { type: String, default: 'id' },
  labelKey: { type: String, default: 'name' },
  descriptionKey: { type: String, default: '' },
  multiple: { type: Boolean, default: false },
  // 业务对象名称，用于空结果、占位与"已保存引用"文案。
  objectLabel: { type: String, default: '选项' },
  placeholder: { type: String, default: '' },
  searchPlaceholder: { type: String, default: '输入业务名称关键词搜索' },
  emptyText: { type: String, default: '' },
  // 编辑既有单据时的当前业务名称；取不到时退回"已保存引用"，不展示可抄写的输入框。
  currentLabel: { type: String, default: '' },
  ariaLabel: { type: String, default: '业务对象选择' },
  disabled: { type: Boolean, default: false },
  preload: { type: Boolean, default: false },
  pageSize: { type: Number, default: 20 },
})
defineOptions({ inheritAttrs: false })
const emit = defineEmits(['update:modelValue', 'change'])

const items = ref([])
const total = ref(0)
const page = ref(1)
const keyword = ref('')
const loading = ref(false)
const loaded = ref(false)
const error = ref('')
const open = ref(false)
const known = ref({})
const root = ref(null)
const searchInput = ref(null)
let sequence = 0
let debounce = null

const selectedValues = computed(() => {
  if (props.multiple) {
    return (Array.isArray(props.modelValue) ? props.modelValue : [])
      .map((value) => String(value ?? '').trim()).filter(Boolean)
  }
  const single = String(props.modelValue ?? '').trim()
  return single ? [single] : []
})
const hasMore = computed(() => hasMoreOptions(items.value, total.value))
const empty = computed(() => loaded.value && !loading.value && !error.value && !items.value.length)
const emptyMessage = computed(() => props.emptyText || optionEmptyText(props.objectLabel, keyword.value))
// 触发按钮只显示业务名称，不再显示裸内部编号。
const triggerLabel = computed(() => {
  if (!selectedValues.value.length) return props.placeholder || `搜索并选择${props.objectLabel}`
  const labels = selectedValues.value.map((value, index) => labelOf(value, index))
  return props.multiple && labels.length > 2 ? `已选择 ${labels.length} 项${props.objectLabel}` : labels.join('、')
})
const chips = computed(() => selectedValues.value.map((value, index) => ({
  value, label: labelOf(value, index),
})))

// 用途：给出某个内部引用对应的业务名称，未知时用"已保存引用"占位。
// 参数：value 为内部引用，index 为多选时的顺序。
// 返回值：可展示名称，不回显可被抄写的输入框。
function labelOf(value, index = 0) {
  const cached = known.value[value]
  if (cached) return cached
  if (!props.multiple && props.currentLabel) return props.currentLabel
  return `${props.objectLabel}已保存引用${props.multiple ? ` ${index + 1}` : ''}`
}

// 用途：读取选项行显示名称，缺失时提示待完善而不是显示 ID。
// 参数：option 为选项行。
// 返回值：业务名称或占位文案。
function optionLabel(option) {
  const text = String(option?.[props.labelKey] ?? '').trim()
  return text || `${props.objectLabel}名称待完善`
}

// 用途：读取选项补充说明（受控引用、版本、状态），没有时不渲染空行。
// 参数：option 为选项行。
// 返回值：说明文本；未配置说明字段时为空串。
function optionDescription(option) {
  if (!props.descriptionKey) return ''
  return String(option?.[props.descriptionKey] ?? '').trim()
}

function isSelected(option) {
  return selectedValues.value.includes(optionValue(option, props.valueKey))
}

// 用途：按当前关键词与页码读取一页选项，迟到响应不覆盖新结果。
// 参数：options.reset 是否回到第一页，options.append 是否为加载更多。
// 返回值：无；失败保留可重试原因。
async function load({ reset = true, append = false } = {}) {
  const ticket = ++sequence
  loading.value = true
  error.value = ''
  if (reset) {
    page.value = 1
    if (!append) items.value = []
    loaded.value = false
  }
  try {
    const payload = await api.request(optionQuery(props.path, {
      keyword: keyword.value, page: page.value, purpose: props.purpose, pageSize: props.pageSize,
    }))
    if (ticket !== sequence) return
    const result = normalizeOptionPage(payload, { page: page.value, pageSize: props.pageSize })
    items.value = append ? mergeOptionPage(items.value, result.items, props.valueKey) : result.items
    total.value = result.total
    const cache = { ...known.value }
    for (const option of items.value) {
      const value = optionValue(option, props.valueKey)
      const label = String(option?.[props.labelKey] ?? '').trim()
      if (value && label) cache[value] = label
    }
    known.value = cache
    loaded.value = true
  } catch (cause) {
    if (ticket === sequence) error.value = cause?.message || '选项读取失败，请重试'
  } finally {
    if (ticket === sequence) loading.value = false
  }
}

// 用途：展开选择面板，首次展开时才请求选项，避免每个费用项都预加载。
// 参数：无。
// 返回值：无。
function show() {
  if (props.disabled) return
  open.value = true
  if (!loaded.value && !loading.value) void load()
  nextTick(() => searchInput.value?.focus?.({ preventScroll: true }))
}

function close() {
  open.value = false
  keyword.value = ''
}

function toggle() {
  if (open.value) close()
  else show()
}

// 用途：关键词变化后防抖重查第一页，输入过程中的旧请求结果不被采用。
// 参数：无。
// 返回值：无。
function search() {
  if (debounce) clearTimeout(debounce)
  debounce = setTimeout(() => { debounce = null; void load() }, 250)
}

// 用途：加载下一页并追加，保留已选中的业务名称。
// 参数：无。
// 返回值：无。
function loadMore() {
  if (!hasMore.value || loading.value) return
  page.value += 1
  void load({ reset: false, append: true })
}

// 用途：把选中项转换为内部引用后交给调用方，多选可再次点击取消。
// 参数：option 为被点击的选项行。
// 返回值：无；单选选中后收起面板。
function choose(option) {
  if (props.disabled) return
  const value = optionValue(option, props.valueKey)
  if (!value) return
  const label = String(option?.[props.labelKey] ?? '').trim()
  if (label) known.value = { ...known.value, [value]: label }
  if (props.multiple) {
    const next = selectedValues.value.includes(value)
      ? selectedValues.value.filter((item) => item !== value)
      : [...selectedValues.value, value]
    emit('update:modelValue', next)
    emit('change', next)
    return
  }
  emit('update:modelValue', value)
  emit('change', value)
  close()
}

// 用途：移除一个已保存引用，仍由调用方决定是否随表单提交。
// 参数：value 为内部引用。
// 返回值：无。
function remove(value) {
  if (props.disabled || !props.multiple) return
  const next = selectedValues.value.filter((item) => item !== value)
  emit('update:modelValue', next)
  emit('change', next)
}

// 用途：点到选择器外部时收起面板，避免浮层挡住后面的费用字段。
// 参数：event 为文档级指针事件。
// 返回值：无。
function onPointerDown(event) {
  if (!open.value) return
  if (root.value?.contains?.(event.target)) return
  close()
}

watch(() => props.disabled, (disabled) => { if (disabled) close() })
watch(() => props.path, () => { loaded.value = false; items.value = []; total.value = 0; error.value = '' })
if (props.preload && !props.disabled) void load()
onMounted(() => {
  if (typeof document !== 'undefined') document.addEventListener('pointerdown', onPointerDown, true)
})
onBeforeUnmount(() => {
  if (debounce) clearTimeout(debounce)
  if (typeof document !== 'undefined') document.removeEventListener('pointerdown', onPointerDown, true)
})
</script>

<template>
  <div ref="root" class="expense-option-picker" :class="{ open, disabled: disabled || undefined }" @keydown.esc="close">
    <button
      type="button"
      class="expense-option-trigger"
      :class="{ placeholder: !selectedValues.length }"
      :disabled="disabled"
      role="combobox"
      aria-haspopup="listbox"
      :aria-expanded="open"
      :aria-label="ariaLabel"
      v-bind="$attrs"
      @click="toggle"
    >
      <span>{{ triggerLabel }}</span><i aria-hidden="true" />
    </button>
    <div v-if="open" class="expense-option-menu">
      <label class="expense-option-search">
        <input
          ref="searchInput"
          v-model="keyword"
          type="search"
          maxlength="100"
          :placeholder="searchPlaceholder"
          :aria-label="searchPlaceholder"
          @input="search"
        >
      </label>
      <p v-if="loading" role="status">
        正在读取可选{{ objectLabel }}…
      </p>
      <p v-else-if="error" class="expense-option-error" role="alert">
        {{ error }}
        <button type="button" class="expense-button" @click="load()">
          重新读取
        </button>
      </p>
      <p v-else-if="empty" class="expense-option-empty" role="status">
        {{ emptyMessage }}
      </p>
      <ul v-else role="listbox" :aria-label="ariaLabel" :aria-multiselectable="multiple">
        <li v-for="option in items" :key="optionValue(option, valueKey)">
          <button
            type="button"
            role="option"
            :aria-selected="isSelected(option)"
            :class="{ selected: isSelected(option) }"
            @click="choose(option)"
          >
            <b>{{ optionLabel(option) }}</b>
            <small v-if="optionDescription(option)">{{ optionDescription(option) }}</small>
            <span v-if="isSelected(option)" aria-hidden="true">✓</span>
          </button>
        </li>
      </ul>
      <button
        v-if="loaded && !error && hasMore"
        type="button"
        class="expense-button expense-option-more"
        :disabled="loading"
        @click="loadMore"
      >
        加载更多（已显示 {{ items.length }} / 共 {{ total }} 项）
      </button>
    </div>
    <div v-if="multiple && chips.length" class="expense-option-chips">
      <span v-for="chip in chips" :key="chip.value">
        {{ chip.label }}
        <button
          type="button"
          :aria-label="`移除 ${chip.label}`"
          :disabled="disabled"
          @click="remove(chip.value)"
        >
          ×
        </button>
      </span>
    </div>
  </div>
</template>
