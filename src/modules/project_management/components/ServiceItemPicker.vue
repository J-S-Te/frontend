<script setup>
import { computed, ref } from 'vue'
import ConsoleIcon from '@/modules/shared/components/ConsoleIcon.vue'
import { serviceItemLabel } from '../projectDisplay.js'

const props = defineProps({
  items: { type: Array, default: () => [] },
  projects: { type: Array, default: () => [] },
  selectedIds: { type: Array, default: () => [] },
  multiple: { type: Boolean, default: false },
  emptyText: { type: String, default: '暂无可选服务项' },
  hint: { type: String, default: '' },
})
const emit = defineEmits(['select', 'toggle'])

const keyword = ref('')
const projectByID = computed(() => new Map(props.projects.map(project => [project.id, project])))
const filteredItems = computed(() => {
  const query = keyword.value.trim().toLowerCase()
  if (!query) return props.items
  return props.items.filter((item) => [
    projectByID.value.get(item.project_id)?.name,
    item.id, item.site, item.category, item.batch, item.system, item.status,
  ].join(' ').toLowerCase().includes(query))
})
// 用途：按稳定编号判断服务项是否被选中。
// 参数：item 为当前卡片对应的服务项快照。
// 返回值：服务项编号是否包含在当前选中集合中。
function isSelected(item) {
  return props.selectedIds.includes(item.id)
}
// 用途：沿用单选或批量勾选事件，交由工作台处理当前服务项。
// 参数：item 为用户选择的原始服务项快照。
// 返回值：无。
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
        <input v-model="keyword" type="search" placeholder="搜索项目 / 系统 / 服务项编号"
          aria-label="搜索服务项队列" maxlength="100" />
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
          <b>{{ serviceItemLabel(item, projectByID.get(item.project_id)) }}</b>
          <small class="pm-service-code mono">服务项编号：{{ item.id }}</small>
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
