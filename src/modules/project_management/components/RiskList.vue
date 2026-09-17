<script setup>
import EmptyHint from './EmptyHint.vue'

defineProps({
  items: { type: Array, default: () => [] },
  emptyText: { type: String, default: '暂无风险待处理' },
})

defineEmits(['select'])
</script>

<template>
  <div class="pm-risk-list">
    <button v-for="item in items" :key="item.id" type="button" @click="$emit('select', item)">
      <span :class="item.level === '高' ? 'high' : 'medium'">{{ item.level }}</span>
      <div><b>{{ item.project }}</b><p>{{ item.issue }}</p></div>
      <time>{{ item.deadline }}</time>
    </button>
    <EmptyHint v-if="!items.length" :message="emptyText" />
  </div>
</template>
