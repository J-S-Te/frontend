<script setup>
defineProps({
  codes: { type: Array, default: () => [] },
  emptyText: { type: String, default: '—' },
})
</script>

<template>
  <span v-if="!codes.length">{{ emptyText }}</span>
  <span v-else class="pm-code-pills">
    <span v-for="code in codes" :key="code" class="pm-code-pill">{{ code }}</span>
  </span>
</template>
