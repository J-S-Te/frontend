<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { reimbursementAPI } from '../api/reimbursement.js'

const props = defineProps({
  modelValue: { type: String, default: '' },
  source: { type: String, default: '' },
  options: { type: Array, default: () => [] },
  extraParams: { type: Object, default: () => ({}) },
  valueKey: { type: String, default: 'id' },
  labelKey: { type: String, default: '' },
  label: { type: String, default: '业务对象' },
  selectedLabel: { type: String, default: '' },
  disabled: { type: Boolean, default: false },
  requiredSearch: { type: Boolean, default: false },
})
const emit = defineEmits(['update:modelValue', 'select'])
const query = ref('')
const remoteRows = ref([])
const loading = ref(false)
const error = ref('')
const page = ref(1)
const hasNext = ref(false)
const nextCursor = ref('')
const cursors = ref([''])
const chosenRow = ref(null)
let sequence = 0
let timer
const searchAllowed = computed(() => !props.disabled &&
  (!props.requiredSearch || !!query.value.trim()))
const visibleRows = computed(() => {
  const rows = props.source ? remoteRows.value : props.options
  const unique = new Map()
  for (const row of rows) {
    const key = rowKey(row)
    const name = rowLabel(row)
    if (!key || !name) continue
    if (!props.source && !name.toLowerCase().includes(query.value.trim().toLowerCase())) continue
    unique.set(key, row)
  }
  return [...unique.values()]
})
const keepSelected = computed(() => props.modelValue &&
  !visibleRows.value.some((row) => rowKey(row) === props.modelValue))
const retainedLabel = computed(() =>
  (props.selectedLabel.trim() !== props.modelValue ? props.selectedLabel.trim() : '') ||
  (rowKey(chosenRow.value) === props.modelValue ? rowLabel(chosenRow.value) : '') ||
  '已关联对象，请选择确认')

// 用途：读取对象的内部引用键，保持表单字符串契约。
// 参数：row为本地选项或服务端返回的业务对象。
// 返回值：合法字符串或数字键的字符串；其他值返回空串。
function rowKey(row) {
  const value = row?.[props.valueKey]
  if (typeof value === 'string') return value
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : ''
}

// 用途：只取业务名称展示，缺少名称时不退回内部ID。
// 参数：row为业务对象；名称字段可由调用方通过labelKey指定。
// 返回值：首个可用业务名称；没有名称返回空串并从可选项中排除。
function rowLabel(row) {
  for (const key of [props.labelKey, 'name', 'label', 'display_name', 'title',
    'full_name', 'account_name', 'project_name', 'subject_name', 'claim_no', 'invoice_no']) {
    const value = row?.[key]
    if (typeof value === 'string' && value.trim() && value.trim() !== rowKey(row)) {
      return value.trim()
    }
  }
  return ''
}

// 用途：构造固定站内来源的查询，只发送显式额外条件及当前搜索分页字段。
// 参数：target为目标页，cursor为服务端上一页给出的不透明游标。
// 返回值：站内API路径；外部URL或非法来源抛出配置错误。
function requestPath(target, cursor) {
  if (!/^\/(?!\/)[^\\?#\s]*$/.test(props.source)) throw new Error('invalid source')
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(props.extraParams)) {
    if (['string', 'number', 'boolean'].includes(typeof value)) params.set(key, String(value))
  }
  params.set('keyword', query.value.trim())
  params.set('page', String(target))
  params.set('page_size', '20')
  params.delete('cursor')
  if (cursor) params.set('cursor', cursor)
  return `${props.source}?${params}`
}

// 用途：读取一页业务对象，失败关闭并防止旧搜索结果覆盖新条件。
// 参数：target为目标页，cursor为本页所需游标，缺省读取第一页。
// 返回值：异步完成信号；错误仅进入可重试状态，不清除父表单已有值。
async function loadPage(target = 1, cursor = '') {
  clearTimeout(timer)
  const current = ++sequence
  remoteRows.value = []
  error.value = ''
  loading.value = false
  hasNext.value = false
  if (!props.source || !searchAllowed.value) return
  let path
  try { path = requestPath(target, cursor) }
  catch { error.value = '选择来源配置不可用，请联系管理员。'; return }
  loading.value = true
  page.value = target
  try {
    const result = await reimbursementAPI.request(path)
    if (current !== sequence) return
    const rows = Array.isArray(result) ? result : result?.items
    if (!Array.isArray(rows)) throw new Error('invalid page')
    remoteRows.value = rows
    nextCursor.value = typeof result.next_cursor === 'string' ? result.next_cursor : ''
    hasNext.value = Object.hasOwn(result, 'next_cursor') ? !!nextCursor.value :
      Number.isFinite(result.total) ? target * 20 < result.total : rows.length === 20
  } catch {
    if (current === sequence) error.value = '加载失败，请重试。'
  } finally {
    if (current === sequence) loading.value = false
  }
}

// 用途：以当前搜索词重新查询第一页，取消尚未触发的防抖任务。
// 参数：无。
// 返回值：异步查询完成信号；本地选项直接由响应式过滤展示。
function searchNow() {
  cursors.value = ['']
  page.value = 1
  return loadPage()
}

// 用途：本地即时过滤或防抖查询远程对象，输入变化立即作废旧请求。
// 参数：event为原生搜索输入事件。
// 返回值：无；不会将自由文本写入父表单。
function changeSearch(event) {
  if (props.disabled) return
  query.value = String(event.target.value).slice(0, 128)
  if (!props.source) return
  clearTimeout(timer)
  sequence++
  remoteRows.value = []
  loading.value = false
  error.value = ''
  hasNext.value = false
  timer = setTimeout(searchNow, 250)
}

// 用途：逐页读取候选对象，不预取或无限加载。
// 参数：direction为前页-1或后页1。
// 返回值：异步读取信号；禁用、加载中或超过页界时不请求。
function turnPage(direction) {
  if (props.disabled || loading.value || (direction > 0 ? !hasNext.value : page.value <= 1)) return
  const target = page.value + direction
  if (direction > 0) cursors.value[target - 1] = nextCursor.value
  return loadPage(target, cursors.value[target - 1] || '')
}

// 用途：发射用户明确选择的内部引用及原始对象，不接受页外或自由文本值。
// 参数：event为原生下拉选择事件。
// 返回值：无；清空时发射空字符串和null，禁用或加载中不发射。
function choose(event) {
  if (props.disabled || loading.value) return
  const key = event.target.value
  const row = visibleRows.value.find((value) => rowKey(value) === key)
  if (key !== '' && !row) return
  chosenRow.value = row || null
  emit('update:modelValue', key)
  emit('select', row || null)
}

watch(() => [props.source, props.disabled, props.requiredSearch, JSON.stringify(props.extraParams)], () => {
  chosenRow.value = null
  searchNow()
}, { immediate: true })
onBeforeUnmount(() => { clearTimeout(timer); sequence++ })
</script>

<template>
  <div class="expense-object-select">
    <label>{{ label }}搜索
      <input type="search" :value="query" :disabled="disabled" maxlength="128"
        placeholder="输入业务名称搜索" autocomplete="off" @input="changeSearch"
        @keydown.enter.prevent="searchNow">
    </label>
    <button v-if="source" type="button" class="expense-button" :disabled="!searchAllowed"
      @click="searchNow">搜索</button>
    <label>{{ label }}
      <select :value="modelValue" :disabled="disabled || loading" @change="choose">
        <option value="">请选择{{ label }}</option>
        <option v-if="keepSelected" :value="modelValue" disabled>{{ retainedLabel }}</option>
        <option v-for="row in visibleRows" :key="rowKey(row)" :value="rowKey(row)">
          {{ rowLabel(row) }}
        </option>
      </select>
    </label>
    <p v-if="loading" role="status">正在加载{{ label }}…</p>
    <p v-else-if="error" role="alert">{{ error }}
      <button type="button" class="expense-button" :disabled="!searchAllowed"
        @click="loadPage(page, cursors[page - 1] || '')">重试</button>
    </p>
    <p v-else-if="requiredSearch && !query.trim()" role="status">请输入业务名称后搜索。</p>
    <p v-else-if="!visibleRows.length" role="status">没有匹配的{{ label }}。</p>
    <div v-if="source" class="expense-object-pages">
      <button type="button" class="expense-button" :disabled="disabled || loading || page <= 1"
        @click="turnPage(-1)">上一页</button>
      <span>第 {{ page }} 页</span>
      <button type="button" class="expense-button" :disabled="disabled || loading || !hasNext"
        @click="turnPage(1)">下一页</button>
    </div>
  </div>
</template>

<style scoped>
.expense-object-select { min-width: 0; }
.expense-object-pages { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.expense-object-select p { overflow-wrap: anywhere; }
</style>
