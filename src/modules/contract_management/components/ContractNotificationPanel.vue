<script setup>
// 合同页「通知中心」面板（治理批次 3 合同页第三步，模板自 ContractManagementView.vue 逐字迁移）。
// v-if 由父组件的 Transition/条件承载不迁入；DOM 由快照测试对提取前 golden 逐字节锁定。
import { approvalNotificationTitle, approvalStatusLabel } from '@/modules/contract_management/utils/contractDisplay'
import PlatformNotificationInbox from '@/modules/shared/components/PlatformNotificationInbox.vue'

defineProps({
  approvals: { type: Array, default: () => [] },
  canProcess: { type: Boolean, default: false },
  showInbox: { type: Boolean, default: true },
})

defineEmits(['open-approval', 'view-all'])

</script>

<template>
  <div class="contract-notification-panel">
    <header><strong>通知中心</strong><span>{{ approvals.length }} 项待办</span></header>
    <template v-if="canProcess && approvals.length">
      <button v-for="approval in approvals.slice(0, 5)" :key="approval.id" type="button" @click="$emit('open-approval', approval)"><i class="warning"></i><span><strong>{{ approvalNotificationTitle(approval) }}</strong><small>事件：流程流转 · 当前节点：{{ approval.step }} · 状态：{{ approvalStatusLabel(approval.status) }}</small><small>点击查看并处理</small></span></button>
      <button v-if="approvals.length > 5" type="button" @click="$emit('view-all')"><i class="info"></i><span><strong>查看全部待处理事件</strong><small>还有 {{ approvals.length - 5 }} 项审批待办</small></span></button>
    </template>
    <p v-else class="contract-notification-empty">当前没有待处理流程事件。</p>
    <section v-if="showInbox" class="contract-inbox-section" aria-label="站内通知">
      <header><strong>站内通知</strong><small>本系统与跨系统提醒</small></header>
      <PlatformNotificationInbox app-code="contract_management" :page-size="5" />
    </section>
  </div>
</template>

<style scoped>
.contract-inbox-section{display:grid;gap:8px;margin-top:14px;padding-top:12px;border-top:1px solid #e2e8f0}
.contract-inbox-section>header{display:flex;align-items:baseline;justify-content:space-between;gap:8px}
.contract-inbox-section small{color:#64748b}
</style>
