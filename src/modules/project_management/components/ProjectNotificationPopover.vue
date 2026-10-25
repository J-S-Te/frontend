<script setup>
// 「业务待办」通知弹层内容（治理批次 3 第三步b，模板自 ProjectManagementView.vue 逐字迁移；
// 状态与行为由 useProjectNotifications composable 持有，经 props/事件接入）。
// DOM 由快照测试对提取前 golden 逐字节锁定；Transition 动画仍由父组件包裹。
import EmptyHint from '@/modules/project_management/components/EmptyHint.vue'

defineProps({
  count: { type: Number, default: 0 },
  loading: { type: Boolean, default: false },
  error: { type: String, default: '' },
  items: { type: Array, default: () => [] },
  actionId: { type: String, default: '' },
  showViewAll: { type: Boolean, default: false },
})

defineEmits(['open-item', 'view-all'])
</script>

<template>
  <div id="project-notifications" class="pm-notifications" role="status" aria-live="polite">
    <div class="pm-popover-head"><b>业务待办</b><span>{{ count }} 条</span></div>
    <p v-if="loading" class="pm-notification-state">正在加载未读通知…</p>
    <p v-else-if="error" class="pm-notification-state danger">{{ error }}</p>
    <button v-for="item in items" :key="item.delivery_id" :disabled="actionId === item.delivery_id" @click="$emit('open-item', item)"><i :class="item.category === 'DEVIATION_REPORTED' ? 'danger' : 'warning'"></i><span><b>{{ item.title }}</b><small>{{ item.content }}</small></span></button>
    <EmptyHint v-if="!loading && !error && !items.length" message="暂无未读通知" />
    <button v-if="showViewAll" type="button" @click="$emit('view-all')">查看全部通知</button>
  </div>
</template>
