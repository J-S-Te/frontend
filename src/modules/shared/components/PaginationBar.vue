<script setup>
// 统一分页条：「上一页 / 第 N 页，共 M 条 / 下一页」。
//
// 设计取舍（跨模块统一时必须同时满足的几条）：
//   1) 只有一页且没有任何记录时不渲染——空列表下方不留一条全禁用的分页；
//      但页码 > 1 时即使当前页为空也必须保留，否则用户无法回到上一页。
//   2) 有记录一定展示总数：后端给 total 时读作「共 M 条」；只支持 offset 分页、
//      不返回总数的接口（结算明细）用 count 展示「第 N 页 · 本页 M 条」，不伪造总数。
//   3) 加载中不展示页码，改为占位文案，避免翻页时先闪一下「第 1 页，共 0 条」。
//   4) 禁用语义沿用各模块原值：首页禁用上一页；末页或无下一页时禁用下一页；
//      loading / disabled 时两个按钮都禁用。
//   5) 无障碍：根节点是带 aria-label 的 nav，按钮均为 type="button"，
//      同页多列表并存时用 label 区分（如「合同台账分页」「应收计划分页」）。
import { computed } from 'vue'

const props = defineProps({
  // 当前页，从 1 开始。
  page: { type: Number, default: 1 },
  // 服务端返回的记录总数；接口不返回总数时传 null，由 count 承担展示与翻页判断。
  total: { type: Number, default: null },
  // 当前页实际条数；仅当 total 未知时使用。
  count: { type: Number, default: null },
  // 每页条数；用于由 total 推导是否还有下一页。
  pageSize: { type: Number, default: 20 },
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

const emit = defineEmits(['change'])

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

// 无记录且只有一页时不渲染：空列表不该出现一条全禁用的分页。
const visible = computed(() => knownTotal.value > 0 || (knownCount.value ?? 0) > 0 || pageNumber.value > 1)

const hasNextPage = computed(() => {
  if (props.hasMore !== null && props.hasMore !== undefined) return Boolean(props.hasMore)
  if (hasTotal.value) return pageNumber.value * Math.max(1, Math.trunc(Number(props.pageSize)) || 1) < knownTotal.value
  return false
})

const prevDisabled = computed(() => props.disabled || props.loading || pageNumber.value <= 1)
const nextDisabled = computed(() => props.disabled || props.loading || !hasNextPage.value)

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
</script>

<template>
  <nav v-if="visible" class="ui-pager" :aria-label="label">
    <button type="button" class="ui-pager__button" :disabled="prevDisabled" @click="goPrev">{{ prevText }}</button>
    <span class="ui-pager__status" :class="{ 'is-loading': loading }" aria-live="polite" aria-atomic="true">{{ statusText }}</span>
    <button type="button" class="ui-pager__button" :disabled="nextDisabled" @click="goNext">{{ nextText }}</button>
  </nav>
</template>
