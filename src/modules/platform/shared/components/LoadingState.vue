<script setup>
// 加载中状态：统一展示旋转图标 + 主标题 + 可选副标题。
// 保持与 EmptyState / ErrorState 一致的视觉与排版，便于组合到任意容器。
defineProps({
  title: { type: String, default: '加载中…' },
  description: { type: String, default: '' },
  // 当父容器较矮时（如行内筛选项），用 compact 缩到 120px，避免大块空白。
  compact: { type: Boolean, default: false },
})
</script>

<template>
  <div class="ui-state" :class="{ 'ui-state--compact': compact }" role="status" aria-live="polite">
    <div class="ui-state__spinner" aria-hidden="true" />
    <b class="ui-state__title">{{ title }}</b>
    <span v-if="description" class="ui-state__description">{{ description }}</span>
    <slot />
  </div>
</template>
