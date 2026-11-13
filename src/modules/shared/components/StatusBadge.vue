<script setup>
import { computed } from 'vue'
import { statusTone } from '../utils/statusTone.js'

// 共享状态徽章：语义 tone 与状态码映射集中在 utils/statusTone.js；
// 组件只负责结构、读屏文本和最小基线样式，各模块可通过 tone 或 class 注入皮肤。
const props = defineProps({
  status: { type: String, default: '' },
  tone: { type: String, default: '' },
  label: { type: String, default: '' },
  dot: { type: Boolean, default: false },
  size: { type: String, default: 'normal' },
})
const resolvedTone = computed(() => props.tone || statusTone(props.status))
const accessibleLabel = computed(() => props.label || props.status || '')
</script>

<template>
  <span
    class="ui-status-badge"
    :class="['ui-status-badge--' + resolvedTone, 'ui-status-badge--' + size]"
    :aria-label="accessibleLabel || undefined"
  >
    <i v-if="dot" class="ui-status-badge__dot" aria-hidden="true"></i>
    <slot>{{ label || status }}</slot>
  </span>
</template>

<style scoped>
.ui-status-badge {
  display: inline-flex;
  max-width: 100%;
  align-items: center;
  gap: 5px;
  padding: 4px 9px;
  color: var(--text-muted);
  font-size: 12px;
  font-weight: 600;
  line-height: 1.4;
  overflow-wrap: anywhere;
  border-radius: 7px;
  background: var(--surface-muted);
}
.ui-status-badge--small { padding: 3px 7px; font-size: 11px; }
.ui-status-badge--info { color: var(--primary-ink); background: var(--primary-soft); }
.ui-status-badge--success { color: var(--success-text); background: var(--success-soft); }
.ui-status-badge--warning { color: var(--warning-text); background: var(--warning-soft); }
.ui-status-badge--danger { color: var(--danger-text); background: var(--danger-soft); }
.ui-status-badge__dot {
  width: 6px;
  height: 6px;
  flex: 0 0 auto;
  border-radius: 50%;
  background: currentColor;
}
</style>
