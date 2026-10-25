<script setup>
// 阶段超时告警详情弹窗（治理批次 3 CRM 第三步，模板自 CustomerOpportunityView.vue 逐字迁移）。
// DOM 由快照测试对提取前 golden 逐字节锁定。
import { formatDate, stageAlertStatusText } from '@/modules/customer_opportunity/crmDisplay'

defineProps({
  alert: { type: Object, required: true },
})

defineEmits(['close', 'open'])
</script>

<template>
  <div class="crm-modal"><article><h2>阶段超时告警详情</h2><dl><dt>商机编号</dt><dd>{{ alert.opportunity_no }}</dd><dt>阶段</dt><dd>{{ alert.stage }}</dd><dt>状态</dt><dd>{{ stageAlertStatusText(alert.status) }}</dd><dt>阶段起算</dt><dd>{{ formatDate(alert.basis_at) }}</dd><dt>应提醒时间</dt><dd>{{ formatDate(alert.due_at) }}</dd><dt>阈值版本</dt><dd>{{ alert.threshold_version }}</dd><dt>触发时间</dt><dd>{{ formatDate(alert.sent_at) }}</dd><dt>已读时间</dt><dd>{{ formatDate(alert.read_at) }}</dd></dl><div class="crm-actions"><button @click="$emit('close')">关闭</button><button class="primary" @click="$emit('open')">{{ alert.status === 'UNREAD' ? '标为已读并打开商机' : '打开商机' }}</button></div></article></div>
</template>
