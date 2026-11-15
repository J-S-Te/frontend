<script setup>
import { computed, nextTick, ref } from 'vue'
import { activeTabIndex, nextTabIndex } from '../utils/tabNavigation.js'

// 共享分段页签：统一 role=tablist/tab、aria-selected、roving tabindex 和方向键切换。
// 视觉只提供中性的最小基线；各模块可继续传入 settlement-tabs / contract-tabs 等皮肤类。
const props = defineProps({
  items: { type: Array, required: true },
  modelValue: { type: [String, Number], required: true },
  ariaLabel: { type: String, default: '' },
  disabled: { type: Boolean, default: false },
  orientation: { type: String, default: 'horizontal' },
})
const emit = defineEmits(['update:modelValue', 'change'])
const tabRefs = ref([])
const focusIndex = computed(() => props.disabled ? -1
  : activeTabIndex(props.items, props.modelValue))

// isDisabled 判断页签是否因组级或单项限制而不可操作。
// 参数：item 为当前页签配置。
// 返回值：禁用时为 true。
function isDisabled(item) {
  return props.disabled || Boolean(item?.disabled)
}

// isActive 判断当前页签是否对应业务选中值。
// 参数：item 为当前页签配置。
// 返回值：标识匹配时为 true，兼容数值标识。
function isActive(item) {
  return String(item?.value) === String(props.modelValue)
}

// select 请求业务切换并按键盘导航目标移动焦点。
// 参数：item 为目标配置；focus 为是否还焦；focusIndex 为目标位置。
// 返回值：无；禁用项不发事件，当前项仅移动焦点而不重复发事件。
function select(item, focus = false, focusIndex = -1) {
  if (!item || isDisabled(item)) return
  if (!isActive(item)) {
    emit('update:modelValue', item.value)
    emit('change', item.value)
  }
  if (focus) nextTick(() => {
    const index = focusIndex >= 0 ? focusIndex : props.items.indexOf(item)
    tabRefs.value[index]?.focus?.()
  })
}

// move 处理 ArrowLeft/ArrowRight、Home/End，纵向改用上下键，保留组合快捷键。
// 参数：event 为键盘事件；item 为当前获得焦点的页签。
// 返回值：无；仅消费有效导航键，禁用组不切换也不拦截按键。
function move(event, item) {
  if (props.disabled || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return
  const target = nextTabIndex(props.items, props.items.indexOf(item), event.key, props.orientation)
  if (target < 0) return
  event.preventDefault()
  select(props.items[target], true, target)
}

// setTabRef 保存按钮引用，供方向键切换后定位焦点。
// 参数：element 为按钮或卸载时的 null；index 为页签下标。
// 返回值：无；卸载时清除引用。
function setTabRef(element, index) {
  tabRefs.value[index] = element
}
</script>

<template>
  <div class="ui-segmented-tabs" role="tablist" :aria-label="ariaLabel || undefined" :aria-orientation="orientation">
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
      :tabindex="index === focusIndex ? 0 : -1"
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
