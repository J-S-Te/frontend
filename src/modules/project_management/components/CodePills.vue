<script setup>
import { capabilityCodeCategory } from '../capabilityCode.js'

defineProps({
  codes: { type: Array, default: () => [] },
  emptyText: { type: String, default: '—' },
  // categorized 为 true 时按业务类别着色；默认关闭，保持抽屉等既有用法逐字节不变。
  categorized: { type: Boolean, default: false },
  category: { type: String, default: '' },
})
</script>

<template>
  <span v-if="!codes.length">{{ emptyText }}</span>
  <span v-else class="pm-code-pills">
    <span
      v-for="code in codes"
      :key="code"
      class="pm-code-pill"
      :class="categorized ? `pm-code-pill--${capabilityCodeCategory(code, category)}` : undefined"
      :title="categorized ? `${code} · ${capabilityCodeCategory(code, category)}` : undefined"
    >{{ code }}</span>
  </span>
</template>
