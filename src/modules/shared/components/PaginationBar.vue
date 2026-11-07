<script setup>
// 统一分页条：「上一页 / 页码 / 第 N 页，共 M 条 / 下一页」，服务端返回 total 时
// 额外提供页码按钮、跳页输入与每页条数选择（20 / 50 / 100）。
//
// 设计取舍（跨模块统一时必须同时满足的几条）：
//   1) 只有一页且没有任何记录时不渲染——空列表下方不留一条全禁用的分页；
//      但页码 > 1 时即使当前页为空也必须保留，否则用户无法回到上一页。
//   2) 有记录一定展示总数：后端给 total 时读作「共 M 条」；只支持 offset 分页、
//      不返回总数的接口（结算明细）用 count 展示「第 N 页 · 本页 M 条」，不伪造总数。
//      total 未知时同理不渲染页码 / 跳页 / 页大小：这些控件依赖真实总页数。
//   3) 加载中不展示页码，改为占位文案，避免翻页时先闪一下「第 1 页，共 0 条」。
//   4) 禁用语义沿用各模块原值：首页禁用上一页；末页或无下一页时禁用下一页；
//      loading / disabled 时所有翻页控件都禁用。
//   5) 无障碍：根节点是带 aria-label 的 nav，所有按钮均为 type="button"，
//      当前页按钮带 aria-current="page"，同页多列表并存时用 label 区分。
import { computed, ref, watch } from 'vue'

const props = defineProps({
  // 当前页，从 1 开始。
  page: { type: Number, default: 1 },
  // 服务端返回的记录总数；接口不返回总数时传 null，由 count 承担展示与翻页判断。
  total: { type: Number, default: null },
  // 当前页实际条数；仅当 total 未知时使用。
  count: { type: Number, default: null },
  // 每页条数；用于由 total 推导是否还有下一页，也是页大小下拉的当前值。
  pageSize: { type: Number, default: 20 },
  // 页大小候选。默认与产品口径一致：20 / 50 / 100。
  pageSizeOptions: { type: Array, default: () => [20, 50, 100] },
  // 是否有下一页：null 表示由 total/pageSize 推导；offset 分页由调用方给出真实值。
  hasMore: { type: Boolean, default: null },
  loading: { type: Boolean, default: false },
  // 调用方自己的互斥态（如保存中不允许翻页）。
  disabled: { type: Boolean, default: false },
  // 无障碍名，同时用于区分同一页面上并存的多个列表。
  label: { type: String, default: '列表分页' },
  prevText: { type: String, default: '上一页' },
  nextText: { type: String, default: '下一页' },
  loadingText: { type: String, default: '正在加载…' },
})

const emit = defineEmits(['change', 'change-page-size'])

const pageNumber = computed(() => {
  const value = Math.trunc(Number(props.page))
  return Number.isFinite(value) && value > 0 ? value : 1
})

const hasTotal = computed(() => props.total !== null && props.total !== undefined && Number.isFinite(Number(props.total)))
const knownTotal = computed(() => (hasTotal.value ? Math.max(0, Math.trunc(Number(props.total))) : 0))
const knownCount = computed(() => (
  props.count === null || props.count === undefined || !Number.isFinite(Number(props.count))
    ? null
    : Math.max(0, Math.trunc(Number(props.count)))
))

const safePageSize = computed(() => Math.max(1, Math.trunc(Number(props.pageSize)) || 1))
const totalPages = computed(() => (hasTotal.value ? Math.max(1, Math.ceil(knownTotal.value / safePageSize.value)) : 0))

// 无记录且只有一页时不渲染：空列表不该出现一条全禁用的分页。
const visible = computed(() => knownTotal.value > 0 || (knownCount.value ?? 0) > 0 || pageNumber.value > 1)

const hasNextPage = computed(() => {
  if (props.hasMore !== null && props.hasMore !== undefined) return Boolean(props.hasMore)
  if (hasTotal.value) return pageNumber.value * safePageSize.value < knownTotal.value
  return false
})

const prevDisabled = computed(() => props.disabled || props.loading || pageNumber.value <= 1)
const nextDisabled = computed(() => props.disabled || props.loading || !hasNextPage.value)
const controlsDisabled = computed(() => props.disabled || props.loading)

// 页码窗口：总页数不超过 7 时全部展示；否则固定首尾页、当前页及左右一页，
// 中间用省略号占位，既保留全貌又不让页码条无限增长。
const pageItems = computed(() => {
  const count = totalPages.value
  if (!hasTotal.value || count <= 0) return []
  if (count <= 7) return Array.from({ length: count }, (_, index) => ({ type: 'page', value: index + 1 }))
  const keep = new Set([1, count, pageNumber.value - 1, pageNumber.value, pageNumber.value + 1]
    .filter((value) => value >= 1 && value <= count))
  const items = []
  let previous = 0
  for (const value of [...keep].sort((a, b) => a - b)) {
    if (previous && value - previous > 1) items.push({ type: 'gap', value: `${previous}-${value}` })
    items.push({ type: 'page', value })
    previous = value
  }
  return items
})

const pageSizeChoices = computed(() => {
  // props 默认值在正常渲染时由 Vue 补齐；手工 setup 的测试只传必要 props，
  // 因此这里对空候选回落产品口径，避免页大小下拉意外只剩当前值。
  const configured = Array.isArray(props.pageSizeOptions) && props.pageSizeOptions.length
    ? props.pageSizeOptions
    : [20, 50, 100]
  const values = configured
    .map((value) => Math.trunc(Number(value)))
    .filter((value) => Number.isFinite(value) && value > 0)
  const unique = [...new Set(values)]
  if (!unique.includes(safePageSize.value)) unique.push(safePageSize.value)
  return unique.sort((a, b) => a - b)
})

// 跳页输入只保存草稿，提交时才校验并 emit；翻页成功后清空，避免残留旧目标。
const jumpDraft = ref('')
watch(() => props.page, () => { jumpDraft.value = '' })

// 加载中优先展示占位文案，其余情况按「有总数 → 共 M 条」「无总数 → 本页 M 条」逐级降级。
const statusText = computed(() => {
  if (props.loading) return props.loadingText
  if (hasTotal.value) return `第 ${pageNumber.value} 页，共 ${knownTotal.value} 条`
  if (knownCount.value !== null) return `第 ${pageNumber.value} 页 · ${knownCount.value} 条`
  return `第 ${pageNumber.value} 页`
})

function goTo(target) {
  const next = Math.max(1, Math.trunc(Number(target) || 1))
  if (next === pageNumber.value) return
  emit('change', next)
}

function goPrev() {
  if (prevDisabled.value) return
  goTo(pageNumber.value - 1)
}

function goNext() {
  if (nextDisabled.value) return
  goTo(pageNumber.value + 1)
}

function goToPage(target) {
  if (controlsDisabled.value) return
  const next = Math.min(Math.max(1, Math.trunc(Number(target) || 1)), totalPages.value || 1)
  goTo(next)
}

function submitJump() {
  if (controlsDisabled.value) return
  if (String(jumpDraft.value).trim() === '') return
  const parsed = Math.trunc(Number(jumpDraft.value))
  if (!Number.isFinite(parsed)) return
  jumpDraft.value = ''
  goToPage(parsed)
}

function changePageSize(event) {
  if (controlsDisabled.value) return
  const next = Math.trunc(Number(event?.target?.value))
  if (!Number.isFinite(next) || next <= 0 || next === safePageSize.value) return
  emit('change-page-size', next)
}
</script>

<template>
  <nav v-if="visible" class="ui-pager" :aria-label="label">
    <button type="button" class="ui-pager__button" :disabled="prevDisabled" @click="goPrev">{{ prevText }}</button>
    <template v-if="hasTotal">
      <button
        v-for="item in pageItems"
        :key="item.value"
        type="button"
        class="ui-pager__page"
        :class="{ 'is-active': item.type === 'page' && item.value === pageNumber, 'is-gap': item.type === 'gap' }"
        :disabled="controlsDisabled || item.type === 'gap'"
        :aria-current="item.type === 'page' && item.value === pageNumber ? 'page' : undefined"
        :aria-label="item.type === 'page' ? `第 ${item.value} 页` : undefined"
        @click="item.type === 'page' && goToPage(item.value)"
      >{{ item.type === 'gap' ? '…' : item.value }}</button>
    </template>
    <span class="ui-pager__status" :class="{ 'is-loading': loading }" aria-live="polite" aria-atomic="true">{{ statusText }}</span>
    <button type="button" class="ui-pager__button" :disabled="nextDisabled" @click="goNext">{{ nextText }}</button>
    <div v-if="hasTotal" class="ui-pager__extra">
      <label class="ui-pager__field">
        <span>跳至</span>
        <input
          v-model="jumpDraft"
          class="ui-pager__jump"
          type="number"
          inputmode="numeric"
          min="1"
          :max="totalPages"
          :disabled="controlsDisabled"
          :aria-label="`跳转页码（共 ${totalPages} 页）`"
          @keyup.enter="submitJump"
        />
        <span>页</span>
        <button type="button" class="ui-pager__button ui-pager__button--small" :disabled="controlsDisabled || !jumpDraft" @click="submitJump">跳转</button>
      </label>
      <label class="ui-pager__field">
        <span>每页</span>
        <select class="ui-pager__size" :value="safePageSize" :disabled="controlsDisabled" :aria-label="`每页条数（当前 ${safePageSize} 条）`" @change="changePageSize">
          <option v-for="size in pageSizeChoices" :key="size" :value="size">{{ size }}</option>
        </select>
        <span>条</span>
      </label>
    </div>
  </nav>
</template>
