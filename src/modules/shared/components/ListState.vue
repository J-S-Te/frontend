<script setup>
// 列表三态闸门：把「加载中 / 失败 / 空」的优先级收敛到一处。
//
// 为什么需要这一层：改造前各模块把三态写成互不相干的条件（或干脆没有失败分支），
// CRM 的失败请求会渲染成「暂无符合条件的客户」，用户以为筛选条件没匹配到，
// 而不是「请求失败了，可以重试」。优先级写在这里，任何接入的列表都不会再退回去：
//   1) loading → LoadingState（不看 error、不看空）
//   2) error   → ErrorState，带重试（失败永不渲染成空状态）
//   3) 其余    → EmptyState，空状态的动作由调用方用 #empty-action 提供
//
// 本组件只负责「该显示哪个状态」，不包裹表格：数据区仍由调用方用自己的 v-if 控制，
// 所以既有的表格 / 卡片直接子元素选择器（.crm-panel > table 等）不受影响。
import LoadingState from './LoadingState.vue'
import ErrorState from './ErrorState.vue'
import EmptyState from './EmptyState.vue'

const props = defineProps({
  loading: { type: Boolean, default: false },
  // 失败原因：字符串或 Error 对象，原样交给 ErrorState 做用户化处理。
  error: { type: [String, Object, Error], default: '' },
  // 失败标题：默认沿用 ErrorState 的「加载失败」；有明确分类时可覆盖（如「客户列表加载失败」）。
  errorTitle: { type: String, default: '加载失败' },
  // 是否显示重试按钮；默认显示，失败恢复是这一层的核心目的。
  retry: { type: Boolean, default: true },
  retryText: { type: String, default: '重新加载' },
  loadingTitle: { type: String, default: '加载中…' },
  loadingDescription: { type: String, default: '' },
  emptyTitle: { type: String, default: '暂无数据' },
  emptyDescription: { type: String, default: '' },
  emptyIcon: { type: String, default: 'info' },
  compact: { type: Boolean, default: false },
})

const emit = defineEmits(['retry'])

const hasError = () => Boolean(props.error)
</script>

<template>
  <LoadingState v-if="loading" :title="loadingTitle" :description="loadingDescription" :compact="compact" />
  <ErrorState
    v-else-if="hasError()"
    :error="error"
    :title="errorTitle"
    :retry="retry"
    :retry-text="retryText"
    :compact="compact"
    @retry="emit('retry')"
  />
  <EmptyState v-else :title="emptyTitle" :description="emptyDescription" :icon="emptyIcon" :compact="compact">
    <slot name="empty-action" />
    <slot name="empty" />
  </EmptyState>
</template>
