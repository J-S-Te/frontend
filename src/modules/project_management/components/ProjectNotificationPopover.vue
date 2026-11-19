<script setup>
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
    <div class="pm-popover-head"><b>通知中心</b><span>{{ count }} 条</span></div>
    <section class="pm-notification-group" aria-label="未读通知">
      <div class="pm-popover-subhead"><b>未读通知</b><span>{{ items.length }} 条</span></div>
      <p v-if="loading" class="pm-notification-state">正在加载未读通知…</p>
      <p v-else-if="error" class="pm-notification-state danger">{{ error }}</p>
      <button v-for="item in items" :key="item.delivery_id" :disabled="actionId === item.delivery_id" @click="$emit('open-item', item)"><i :class="item.category === 'DEVIATION_REPORTED' ? 'danger' : 'warning'"></i><span><b>{{ item.title }}</b><small>{{ item.content }}</small></span></button>
      <EmptyHint v-if="!loading && !error && !items.length" message="暂无未读通知" />
      <button v-if="showViewAll" type="button" class="pm-notification-view-all" @click="$emit('view-all')">查看全部通知</button>
    </section>
  </div>
</template>
