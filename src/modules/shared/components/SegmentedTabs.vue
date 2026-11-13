<script setup>
import { nextTick, ref } from 'vue'

// 共享分段页签：统一 role=tablist/tab、aria-selected、roving tabindex 和方向键切换。
// 视觉只提供中性的最小基线；各模块可继续传入 settlement-tabs / contract-tabs 等皮肤类。
const props = defineProps({
  items: { type: Array, required: true },
  modelValue: { type: [String, Number], required: true },
  ariaLabel: { type: String, default: '' },
  disabled: { type: Boolean, default: false },
})
const emit = defineEmits(['update:modelValue', 'change'])
const tabRefs = ref([])

function isDisabled(item) {
  return props.disabled || Boolean(item?.disabled)
}

function isActive(item) {
  return String(item?.value) === String(props.modelValue)
}

function select(item, focus = false, focusIndex = -1) {
  if (!item || isDisabled(item) || isActive(item)) return
  emit('update:modelValue', item.value)
  emit('change', item.value)
  if (focus) nextTick(() => tabRefs.value[focusIndex >= 0 ? focusIndex : props.items.indexOf(item)]?.focus?.())
}

function enabledItems() {
  return props.items.map((item, index) => ({ item, index })).filter(({ item }) => !isDisabled(item))
}

function move(event, item) {
  const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End']
  if (!keys.includes(event.key)) return
  const list = enabledItems()
  if (!list.length) return
  event.preventDefault()
  const current = list.findIndex(({ item: candidate }) => candidate === item)
  const position = current < 0 ? 0 : current
  let next = position
  if (event.key === 'ArrowRight') next = (position + 1) % list.length
  if (event.key === 'ArrowLeft') next = (position - 1 + list.length) % list.length
  if (event.key === 'Home') next = 0
  if (event.key === 'End') next = list.length - 1
  const target = list[next]
  select(target.item, true, target.index)
}

function setTabRef(element, index) {
  if (element) tabRefs.value[index] = element
}
</script>

<template>
  <div class="ui-segmented-tabs" role="tablist" :aria-label="ariaLabel || undefined" aria-orientation="horizontal">
    <button
      v-for="(item, index) in items"
      :key="item.value"
      :ref="(element) => setTabRef(element, index)"
      type="button"
      role="tab"
      class="ui-segmented-tabs__tab"
      :class="{ active: isActive(item) }"
      :aria-selected="isActive(item)"
      :aria-controls="item.controls || undefined"
      :tabindex="isActive(item) ? 0 : -1"
      :disabled="isDisabled(item)"
      :title="item.title || undefined"
      @click="select(item)"
      @keydown="move($event, item)"
    >
      <span class="ui-segmented-tabs__label">{{ item.label }}</span>
      <i v-if="item.count !== undefined && item.count !== null" class="ui-segmented-tabs__count" aria-hidden="true">{{ item.count }}</i>
    </button>
  </div>
</template>

<style scoped>
.ui-segmented-tabs {
  display: flex;
  min-width: 0;
  gap: 4px;
  align-items: stretch;
  border-bottom: 1px solid var(--border);
}
.ui-segmented-tabs__tab {
  position: relative;
  display: inline-flex;
  min-height: 38px;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 8px 12px;
  color: var(--text-muted);
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  line-height: 1.2;
  white-space: nowrap;
  cursor: pointer;
  border: 0;
  border-radius: 7px 7px 0 0;
  background: transparent;
}
.ui-segmented-tabs__tab:hover:not(:disabled) {
  color: var(--text);
  background: var(--surface-muted);
}
.ui-segmented-tabs__tab[aria-selected="true"] {
  color: var(--primary-ink);
}
.ui-segmented-tabs__tab[aria-selected="true"]::after {
  position: absolute;
  right: 8px;
  bottom: -1px;
  left: 8px;
  height: 2px;
  content: "";
  border-radius: 2px 2px 0 0;
  background: currentColor;
}
.ui-segmented-tabs__tab:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: -2px;
}
.ui-segmented-tabs__tab:disabled {
  cursor: not-allowed;
  opacity: .55;
}
.ui-segmented-tabs__count {
  display: inline-grid;
  min-width: 17px;
  height: 17px;
  place-items: center;
  padding: 0 4px;
  color: var(--on-primary);
  font-size: 11px;
  font-style: normal;
  line-height: 1;
  border-radius: 9px;
  background: var(--danger);
}
@media (prefers-reduced-motion: reduce) {
  .ui-segmented-tabs__tab { transition: none; }
}
</style>
