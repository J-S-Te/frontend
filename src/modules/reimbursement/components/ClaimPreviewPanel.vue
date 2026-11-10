<script setup>
import { formatMinor } from '../api/client.js'
const props=defineProps({value:{type:Object,default:null},busy:Boolean,error:String,enabled:Boolean,disabled:Boolean})
const emit=defineEmits(['refresh'])
</script>
<template>
  <section class="expense-panel" aria-label="标准与审批预览">
    <h3>标准与审批预览</h3>
    <p>按当前草稿、人员资料和已发布政策计算，不保存、不占票、不提交审批；正式提交时仍重新核验。</p>
    <button class="expense-button" :disabled="disabled || busy" @click="emit('refresh')">
      {{ busy ? '正在核对标准与当前审批资格…' : '更新标准与审批预览' }}</button>
    <p v-if="enabled">修改费用后自动重新预览；未返回新结果时不沿用旧结论。</p>
    <p v-if="error" role="alert">{{ error }}</p>
    <template v-if="value?.preview_only">
      <p>草稿版本 {{ value.expected_version }} · 预览规则 {{ value.rule_version }}</p>
      <article v-for="(item,index) in value.items" :key="item.id" class="expense-item">
        <strong>费用 {{ index+1 }} · {{ item.fee_type }}</strong>
        <p>标准 {{ item.standard_version_id }} / v{{ item.standard_policy_version }}
          · 本项限额 {{ formatMinor(item.standard_limit_minor) }} 元
          · 申请 {{ formatMinor(item.requested_minor) }} 元
          <span v-if="item.over_standard" class="expense-flag danger">超标准</span>
          <span v-else class="expense-flag">标准内</span></p>
        <p v-if="item.finance_review_required">此项需财务重点复核：{{ item.review_hints?.join('、') }}</p>
      </article>
      <h4>当前审批路径</h4>
      <ol><li v-for="node in value.approval_nodes" :key="node.node">
        {{ node.node_label || node.node_code }} · {{ node.assignee_subject_ids?.join('、') }}
        <span v-if="node.mode==='ALL'">（全部人员均须通过）</span>
      </li></ol>
      <p v-if="value.route_decision">额外节点：{{ value.route_decision.triggered ? '按当前规则需要' : '按当前规则不需要' }}。
        阈值与差旅结论以当前政策和正式提交核验为准。</p>
    </template>
  </section>
</template>
