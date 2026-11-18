<script setup>
// 「待办与通知」弹层内容（治理批次 3 第三步b，模板自 ProjectManagementView.vue 逐字迁移；
// 状态与行为由 useProjectNotifications composable 持有，经 props/事件接入）。
// DOM 由快照测试锁定；有意变更须同步更新 golden。
import EmptyHint from '@/modules/project_management/components/EmptyHint.vue'
import { approvalTypeLabel } from '../approvalTasks.js'

defineProps({
  count: { type: Number, default: 0 },
  loading: { type: Boolean, default: false },
  error: { type: String, default: '' },
  items: { type: Array, default: () => [] },
  actionId: { type: String, default: '' },
  approvals: { type: Array, default: () => [] },
  approvalLoading: { type: Boolean, default: false },
  approvalError: { type: String, default: '' },
  approvalActionId: { type: String, default: '' },
  showViewAll: { type: Boolean, default: false },
  showApprovalAll: { type: Boolean, default: false },
})

defineEmits(['open-item', 'view-all', 'open-approval', 'view-all-approvals'])
</script>

<template>
  <div id="project-notifications" class="pm-notifications" role="status" aria-live="polite">
    <div class="pm-popover-head"><b>待办与通知</b><span>{{ count }} 条</span></div>
    <section v-if="approvals.length || approvalLoading || approvalError" class="pm-notification-group" aria-label="待审批">
      <div class="pm-popover-subhead"><b>待审批</b><span>{{ approvals.length }} 条</span></div>
      <p v-if="approvalLoading" class="pm-notification-state">正在加载待审批…</p>
      <p v-else-if="approvalError" class="pm-notification-state danger">{{ approvalError }}</p>
      <button v-for="task in approvals" :key="task.id" :disabled="approvalActionId === task.id" @click="$emit('open-approval', task)"><i class="warning"></i><span><b>{{ approvalTypeLabel(task.type) }} · {{ task.site || '服务项' }}</b><small>{{ task.reason || '等待审批' }}</small></span></button>
      <button v-if="showApprovalAll" type="button" @click="$emit('view-all-approvals')">查看全部审批</button>
    </section>
    <section class="pm-notification-group" aria-label="未读通知">
      <div class="pm-popover-subhead"><b>未读通知</b><span>{{ items.length }} 条</span></div>
      <p v-if="loading" class="pm-notification-state">正在加载未读通知…</p>
      <p v-else-if="error" class="pm-notification-state danger">{{ error }}</p>
      <button v-for="item in items" :key="item.delivery_id" :disabled="actionId === item.delivery_id" @click="$emit('open-item', item)"><i :class="item.category === 'DEVIATION_REPORTED' ? 'danger' : 'warning'"></i><span><b>{{ item.title }}</b><small>{{ item.content }}</small></span></button>
      <EmptyHint v-if="!loading && !error && !items.length" message="暂无未读通知" />
      <button v-if="showViewAll" type="button" @click="$emit('view-all')">查看全部通知</button>
    </section>
  </div>
</template>
