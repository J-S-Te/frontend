<script setup>
// 通用筛选条：默认只展示前 N 个高频条件，其余收进“展开筛选”。
// 业务字段仍由调用方用 #fields 插槽提供，组件只负责折叠、展开与操作区对齐。
import { computed } from 'vue'

const props = defineProps({
  expanded: { type: Boolean, default: false },
  fieldCount: { type: Number, default: 0 },
  visibleCount: { type: Number, default: 3 },
  as: { type: String, default: 'div' },
  label: { type: String, default: '筛选条件' },
  expandText: { type: String, default: '展开筛选' },
  collapseText: { type: String, default: '收起筛选' },
})
const emit = defineEmits(['update:expanded'])
const overflow = computed(() => Number(props.fieldCount) > Number(props.visibleCount))
function toggle() {
  emit('update:expanded', !props.expanded)
}
</script>

<template>
  <component :is="as" class="ui-filter-bar" :class="{ 'is-expanded': expanded }" :aria-label="label">
    <div class="ui-filter-fields"><slot name="fields" /></div>
    <div class="ui-filter-actions">
      <slot name="actions" />
      <button v-if="overflow" type="button" class="ui-filter-toggle" :aria-expanded="expanded ? 'true' : 'false'" @click="toggle">
        {{ expanded ? collapseText : expandText }}
      </button>
    </div>
  </component>
</template>

<style scoped>
.ui-filter-bar {
  display: flex;
  align-items: flex-end;
  gap: 12px;
  min-width: 0;
}
.ui-filter-fields {
  display: flex;
  flex: 1 1 auto;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 10px 12px;
  min-width: 0;
}
.ui-filter-bar:not(.is-expanded) .ui-filter-fields > :nth-child(n + 4) {
  display: none;
}
.ui-filter-actions {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 8px;
  margin-left: auto;
}
.ui-filter-toggle {
  height: 32px;
  padding: 0 10px;
  color: var(--primary);
  font-size: var(--fs-sm);
  white-space: nowrap;
  cursor: pointer;
  border: 0;
  border-radius: var(--radius-control);
  background: transparent;
}
.ui-filter-toggle:hover {
  background: var(--primary-soft);
}
.ui-filter-toggle:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 2px;
}
@media (max-width: 640px) {
  .ui-filter-bar {
    align-items: stretch;
    flex-direction: column;
  }
  .ui-filter-actions {
    margin-left: 0;
  }
}
</style>
