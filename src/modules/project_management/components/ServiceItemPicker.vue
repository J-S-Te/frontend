<script setup>
import { computed, ref } from 'vue'
import ConsoleIcon from '@/modules/platform/shared/components/ConsoleIcon.vue'

const props = defineProps({
  items: { type: Array, default: () => [] },
  selectedIds: { type: Array, default: () => [] },
  multiple: { type: Boolean, default: false },
  emptyText: { type: String, default: '暂无可选服务项' },
  hint: { type: String, default: '' },
})
const emit = defineEmits(['select', 'toggle'])

const keyword = ref('')
const filteredItems = computed(() => {
  const query = keyword.value.trim().toLowerCase()
  if (!query) return props.items
  return props.items.filter((item) => [item.id, item.site, item.category, item.batch, item.system, item.status].join(' ').toLowerCase().includes(query))
})
function isSelected(item) {
  return props.selectedIds.includes(item.id)
}
function choose(item) {
  if (props.multiple) emit('toggle', item)
  else emit('select', item)
}
</script>

<template>
  <div class="pm-picker">
    <div class="pm-picker-toolbar">
      <label class="pm-picker-search">
        <ConsoleIcon name="search" />
        <input v-model="keyword" type="search" placeholder="搜索服务项编号 / 场所 / 检测类别" />
      </label>
      <span class="pm-picker-count">{{ filteredItems.length }} / {{ items.length }} 项</span>
    </div>
    <div class="pm-picker-list" role="listbox" :aria-multiselectable="multiple">
      <button
        v-for="item in filteredItems"
        :key="item.id"
        type="button"
        class="pm-picker-card"
        :class="{ selected: isSelected(item) }"
        role="option"
        :aria-selected="isSelected(item)"
        @click="choose(item)"
      >
        <span class="pm-picker-mark" :class="{ checked: isSelected(item), multiple }" aria-hidden="true">
          <i></i>
        </span>
        <span class="pm-picker-body">
          <b class="mono">{{ item.id }}</b>
          <small>{{ item.site || '未设置场所' }}<template v-if="item.category"> · {{ item.category }}</template></small>
        </span>
        <span class="pm-picker-meta">
          <em v-if="item.batch" class="pm-picker-batch">{{ item.batch }}</em>
          <span class="pm-badge normal">{{ item.status }}</span>
        </span>
      </button>
      <p v-if="!filteredItems.length" class="pm-picker-empty">{{ items.length ? '没有匹配的服务项' : emptyText }}</p>
    </div>
    <p v-if="hint" class="pm-picker-hint">{{ hint }}</p>
  </div>
</template>
