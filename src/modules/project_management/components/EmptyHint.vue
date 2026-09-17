<script setup>
defineProps({
  message: { type: String, required: true },
})
</script>

<template>
  <div class="pm-empty-mini" role="status">{{ message }}</div>
</template>
