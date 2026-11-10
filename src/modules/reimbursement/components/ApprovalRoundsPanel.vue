<script setup>
import { ref, watch } from 'vue'
import { reimbursementAPI as api } from '../api/reimbursement.js'
import { approvalNodeLabel } from '../rolePresentation.js'
import { formatBusinessDateTime } from '../../shared/utils/businessTime.js'
import { claimChanges } from '../workspace.js'

const props = defineProps({ claimId: { type: String, required: true } })
const rounds = ref([])
const page = ref(1)
const total = ref(0)
const error = ref('')
let sequence = 0

// 用途：加载当前授权范围内各审批轮次及冻结责任，不从当前岗位推造历史。
// 参数：无。
// 返回值：无；迟到响应不覆盖另一单据。
async function load() {
  const ticket = ++sequence; error.value = ''
  try {
    const result = await api.request(`/claims/${encodeURIComponent(props.claimId)}/approval-rounds?page=${page.value}&page_size=10`)
    if (ticket !== sequence) return
    rounds.value = result.items; total.value = result.total
  } catch (cause) { if (ticket === sequence) error.value = cause.message }
}
watch(() => props.claimId, () => { page.value = 1; rounds.value = []; void load() }, { immediate: true })
watch(page, load)
</script>

<template>
  <article class="expense-item">
    <h3>审批轮次与责任来源</h3>
    <p v-if="error" role="alert">{{ error }}</p>
    <details v-for="round in rounds" :key="round.round">
      <summary>第 {{ round.round }} 轮 · {{ formatBusinessDateTime(round.created_at) }}</summary>
      <p>冻结内容摘要 {{ round.content_hash }} · 路由版本 {{ round.rule_version }}</p>
      <section v-if="rounds.some(previous=>previous.round===round.round-1)">
        <h4>与上一轮关键字段对比（金额为整数分）</h4>
        <p v-if="round.snapshot?.scope_limited">仅比较两轮共同可见的费用，不将范围变化视作整单业务变化。</p>
        <p v-for="(change,index) in claimChanges(rounds.find(previous=>previous.round===round.round-1)?.snapshot,round.snapshot)" :key="index">
          {{ change.label }}：{{ change.before }} → {{ change.after }}</p>
        <p v-if="!claimChanges(rounds.find(previous=>previous.round===round.round-1)?.snapshot,round.snapshot).length">当前可见关键字段没有变化。</p>
      </section>
      <p v-for="task in round.frozen_tasks" :key="task.id">{{ approvalNodeLabel(task.node_role || task.node_code) }} · 冻结受理人 {{ task.assignee_subject_id }} · 责任分摊 {{ task.allocation_keys?.join('、') }}</p>
      <div v-for="reference in round.references" :key="reference.project_id + reference.service_item_id">
        <p>项目 {{ reference.project_id }} / {{ reference.service_item_id || '项目级' }} · 引用版本 {{ reference.reference_version }}</p>
        <p v-for="person in reference.required_approver_refs" :key="person.node_role + person.subject_id">{{ approvalNodeLabel(person.node_role) }}：{{ person.subject_id }} · {{ person.source_field }} · 版本 {{ person.source_version || person.source_digest }}</p>
      </div>
      <p v-for="action in round.actions" :key="action.ID">{{ formatBusinessDateTime(action.CreatedAt) }} · {{ action.Actor }} · {{ action.Action }} · {{ action.Reason }}</p>
    </details>
    <button class="expense-button" :disabled="page <= 1" @click="page--">上一页</button>
    <span>第 {{ page }} 页，共 {{ total }} 轮</span>
    <button class="expense-button" :disabled="page * 10 >= total" @click="page++">下一页</button>
  </article>
</template>
