<script setup>
defineProps({
  count: { type: Number, default: null },
  variant: { type: String, default: 'search' },
  resetLabel: { type: String, default: '重置' },
})

defineEmits(['reset'])
</script>

<template>
  <section :class="variant === 'flat' ? 'pm-filters pm-filters-flat pm-monitor-filters' : 'pm-search-bar'">
    <slot />
    <slot name="tags" />
    <div class="pm-actions-row">
      <button class="pm-button ghost" type="button" @click="$emit('reset')">{{ resetLabel }}</button>
      <span v-if="count !== null" class="pm-filter-count">{{ count }} 条结果</span>
    </div>
  </section>
</template>
