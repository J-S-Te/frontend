<script setup>
import { computed } from 'vue'

const props = defineProps({
  percent: { type: [String, Number], default: 0 },
  compact: { type: Boolean, default: false },
})

const normalizedPercent = computed(() => Math.min(100, Math.max(0, Number(props.percent) || 0)))
</script>

<template>
  <div :class="compact ? 'pm-inline-progress' : 'pm-progress-cell'">
    <template v-if="compact">
      <i :style="{ width: `${normalizedPercent}%` }"></i>
    </template>
    <template v-else>
      <div class="pm-inline-progress"><i :style="{ width: `${normalizedPercent}%` }"></i></div>
      <small>{{ normalizedPercent }}%</small>
    </template>
  </div>
</template>
