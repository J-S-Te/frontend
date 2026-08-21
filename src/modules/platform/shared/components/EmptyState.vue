<script setup>
// 空状态：图标 + 主标题 + 可选副标题 + 自定义操作（如「重置筛选」）。
// icon 名称沿用 ConsoleIcon 的命名空间（info / search / bell 等）。
import ConsoleIcon from './ConsoleIcon.vue'

defineProps({
  title: { type: String, default: '暂无数据' },
  description: { type: String, default: '' },
  icon: { type: String, default: 'info' },
  compact: { type: Boolean, default: false },
})
</script>

<template>
  <div class="ui-state" :class="{ 'ui-state--compact': compact }">
    <ConsoleIcon :name="icon" class="ui-state__icon" />
    <b class="ui-state__title">{{ title }}</b>
    <span v-if="description" class="ui-state__description">{{ description }}</span>
    <slot />
  </div>
</template>
