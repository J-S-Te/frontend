<script setup>
import { computed, ref } from 'vue'
import { approvalNodeLabel } from '../rolePresentation.js'
import BusinessAttachmentSelect from './BusinessAttachmentSelect.vue'


const props = defineProps({
  item: { type: Object, required: true },
  itemNumber: { type: Number, default: 0 },
  references: { type: Array, default: () => [] },
  standardHints: { type: Array, default: () => [] },
  tailPolicies: { type: Array, default: () => [] },
  disabled: { type: Boolean, default: false },
  canDownload: { type: Boolean, default: false },
  names: { type: Object, default: () => ({}) },
})
const emit = defineEmits(['upload', 'download'])
const tailFiles = computed(() => [...new Set(String(props.item.historical_tail_evidence_text || '')
  .split(',').map((value) => value.trim()).filter(Boolean))].slice(0, 20))
const travelFiles = computed(() => [...new Set(String(props.item.travel_confirmation?.evidence_text || '')
  .split(',').map((value) => value.trim()).filter(Boolean))].slice(0, 20))
const assessments = { MATCH: '事实匹配', MISMATCH: '事实存在不一致', UNKNOWN: '事实未知',
  NOT_REQUESTED_LEGACY: '历史记录未请求交叉核验' }
// 同一费用项的证据按用途分开：尾款、差旅补证各自一组，避免和"无票/预付独立证明"混用。
const limitNotice = ref('')

// 用途：把选择器返回的文件引用写回尾款证据，超过20份时保留前20份并提示。
// 参数：ids 为选择器给出的文件引用数组。
// 返回值：无。
function setTailFiles(ids) {
  const values = Array.isArray(ids) ? ids : String(ids || '').split(',').filter(Boolean)
  limitNotice.value = values.length > 20 ? '每组证据最多20份，超出的选择未保存。' : ''
  props.item.historical_tail_evidence_text = values.slice(0, 20).join(',')
}

// 用途：把选择器返回的文件引用写回差旅人工确认证据。
// 参数：ids 为选择器给出的文件引用数组。
// 返回值：无。
function setTravelFiles(ids) {
  const values = Array.isArray(ids) ? ids : String(ids || '').split(',').filter(Boolean)
  limitNotice.value = values.length > 20 ? '每组证据最多20份，超出的选择未保存。' : ''
  if (!props.item.travel_confirmation) props.item.travel_confirmation = { decision: '', reason: '', evidence_text: '' }
  props.item.travel_confirmation.evidence_text = values.slice(0, 20).join(',')
}

// 用途：为查看证据按钮展示真实原名，缺少名称时不暴露文件内部引用。
// 参数：fileID 为附件引用；index 为当前证据列表的显示序号。
// 返回值：真实文件名或带序号的名称待核对说明。
function evidenceName(fileID, index) {
  const value = props.names[fileID]
  return typeof value === 'string' && value.trim() && value.trim() !== fileID
    ? value.trim() : `附件 ${index + 1}（名称待核对）`

}
</script>

<template>
  <section class="expense-evidence" aria-label="历史尾款与差旅事实">
    <h4>项目状态与权威差旅事实</h4>
    <p>实施准备、行程安排均不是出差审批。选择已终止项目只用于申请后端尾款政策，不表示已获准报销。</p>
    <article v-for="(reference, index) in references" :key="index">
      <template v-if="reference">
        <strong>{{ reference.project_name || reference.project_id }} / {{ reference.service_item_id || '项目级' }}</strong>
        <p>项目：{{ reference.project_status || '状态未返回' }}
          · 服务项：{{ reference.service_item_status || '未选择或状态未返回' }}</p>
        <p v-if="!reference.eligible && reference.participant_eligible">
          当前仍具费用参与资格，但状态阻断正常报销；历史尾款须有效政策、证据及额外审批。
        </p>
        <p v-if="reference.reason_codes?.length">引用原因：{{ reference.reason_codes.join('、') }}</p>
        <details v-if="reference.required_approver_refs?.length">
          <summary>项目权威岗位来源（不由本地人员映射覆盖）</summary>
          <ul><li v-for="approver in reference.required_approver_refs"
            :key="`${approver.node_role}/${approver.subject_id}/${approver.source_field}`">
            {{ approvalNodeLabel(approver.node_role) }} · 主体 {{ approver.subject_id }}
            · 来源 {{ approver.source_field }}
            <span v-if="approver.source_version"> · 来源版本 {{ approver.source_version }}</span>
            <span v-if="approver.source_digest"> · 目录摘要 {{ approver.source_digest }}</span>
            <span v-if="approver.source_org_id"> · 授权组织 {{ approver.source_org_id }}</span>
          </li></ul>
        </details>
        <dl v-if="reference.travel_snapshot" class="expense-grid">
          <div><dt>行程来源事实</dt><dd>{{ reference.travel_snapshot.status }} / {{ reference.travel_snapshot.mode }}</dd></div>
          <div><dt>起止地点</dt><dd>{{ reference.travel_snapshot.origin || '未知' }} → {{ reference.travel_snapshot.destination || '未知' }}</dd></div>
          <div><dt>行程日期</dt><dd>{{ reference.travel_snapshot.departure_date || '未知' }} 至 {{ reference.travel_snapshot.return_date || '未知' }}</dd></div>
          <div><dt>交通 / 住宿安排</dt><dd>{{ reference.travel_snapshot.transport || '未知' }} / {{ reference.travel_snapshot.accommodation_need || '未知' }}</dd></div>
          <div><dt>本人是否在原行程中</dt><dd>{{ reference.travel_snapshot.actor_in_travelers === true ? '是' : reference.travel_snapshot.actor_in_travelers === false ? '否' : '未知' }}</dd></div>
          <div><dt>现场 / 日期事实比较</dt><dd>{{ reference.travel_snapshot.site_match_status || 'UNKNOWN' }} / {{ reference.travel_snapshot.date_match_status || 'UNKNOWN' }}</dd></div>
          <div><dt>城市代码事实</dt><dd>{{ reference.travel_snapshot.city_code_status || 'UNKNOWN' }}</dd></div>
          <div><dt>来源事件 / 内容版本</dt><dd>{{ reference.travel_snapshot.source_event_id || '未记录' }} · {{ reference.travel_snapshot.source_event_version || '未知' }}</dd></div>
        </dl>
        <p v-if="reference.travel_snapshot?.reason_codes?.length">行程事实说明：{{ reference.travel_snapshot.reason_codes.join('、') }}</p>
      </template>
      <p v-else>尚未加载此分摊的权威项目引用，请查询项目选项；不能据缺少事实推断有资格或已批准差旅。</p>
    </article>

    <details :open="!!item.historical_tail_reason || !!item.historical_tail_applications?.length">
      <summary>历史尾款申请与证据</summary>
      <fieldset :disabled="disabled">
        <label>终止前费用及尾款申请原因<textarea v-model="item.historical_tail_reason" maxlength="2000" /></label>
        <p>尾款证据最多20份；PDF / PNG / JPEG 单份最多20MiB。</p>
        <BusinessAttachmentSelect :model-value="item.historical_tail_evidence_text" @update:model-value="setTailFiles"
          purpose="reimbursement.claim.evidence" :disabled="disabled" :names="names"
          @upload="emit('upload', $event, 'claimTail')" />

      </fieldset>
      <div class="expense-actions"><button v-for="(file, index) in tailFiles" :key="file"
        class="expense-button" :disabled="!canDownload" @click="emit('download', file)">查看尾款证据 {{ evidenceName(file, index) }}</button></div>
      <p>新证据先保存到草稿，再按当前单据范围申请查看。</p>
      <p>费用截止日按费用发生日核对，政策有效期按提交业务日核对；填写原因不会自动启用历史尾款政策。</p>
      <p v-for="policy in tailPolicies" :key="policy.id">可见政策提示 {{ policy.id }} · v{{ policy.version }}
        · 项目 {{ policy.project_id }} · {{ policy.enabled ? '配置已启用，仍待提交复核' : '配置未启用' }}
        · 费用截止 {{ policy.expense_cutoff }} · 提交有效期 {{ policy.valid_from }} 至 {{ policy.valid_until }}</p>
      <article v-for="(application, index) in item.historical_tail_applications || []" :key="index">
        <p>服务端采用的尾款政策快照：{{ application.policy?.id }} · v{{ application.policy?.version }}
          · 项目 {{ application.project_id }} / {{ application.service_item_id || '项目级' }}</p>
        <p>费用截止 {{ application.policy?.expense_cutoff }} · 提交有效期
          {{ application.policy?.valid_from }} 至 {{ application.policy?.valid_until || '持续有效' }}</p>
        <p>终止事实：{{ application.termination_reasons?.join('、') }}；最终仍以该轮审批结论为准。</p>
      </article>
    </details>

    <h4>差旅核对与人工决定</h4>
    <p v-if="item.requires_travel_facts === true">当前有效标准要求核对差旅事实。</p>
    <p v-else-if="item.requires_travel_facts === false">当前标准不要求差旅事实，不必填写人工确认。</p>
    <p v-else>是否要求差旅事实由服务端有效标准判断；页面不自行增加强制条件。</p>
    <p v-for="standard in standardHints" :key="standard.id">标准提示 {{ standard.id }} · v{{ standard.version }}
      · 职级 {{ standard.grade }} · 城市等级 {{ standard.city_level || '未指定' }}
      · {{ standard.requires_travel_facts ? '要求差旅事实' : '不要求差旅事实' }}
      · 有效期 {{ standard.valid_from }} 至 {{ standard.valid_until || '持续有效' }}；最终匹配由服务端判定。</p>
    <p v-if="item.travel_assessment">
      服务端评估：{{ assessments[item.travel_assessment.status] || item.travel_assessment.status }}
      <span v-if="item.travel_assessment.confirmed_unknown">（未知事实已人工补证，状态仍为UNKNOWN）</span>
    </p>
    <p v-if="item.travel_assessment?.reason_codes?.length">评估依据：{{ item.travel_assessment.reason_codes.join('、') }}</p>
    <section v-if="item.travel_assessment?.references?.some((value) => value.cross_check)">
      <h4>申报与票据行程交叉核验</h4>
      <p>票面行程来自人工票面复核，不代表自动识别或税务验真；补证不会把未知事实变成匹配。</p>
      <article v-for="reference in item.travel_assessment.references.filter((value) => value.cross_check)"
        :key="`${reference.project_id}/${reference.service_item_id || ''}`" class="expense-item">
        <strong>{{ reference.project_id }} / {{ reference.service_item_id || '项目级' }}</strong>
        <p>交叉结论：{{ assessments[reference.cross_check.status] || reference.cross_check.status }}
          · 项目事实：{{ assessments[reference.cross_check.project_status] || reference.cross_check.project_status }}</p>
        <p v-if="reference.cross_check.reason_codes?.length">核对依据：{{ reference.cross_check.reason_codes.join('、') }}</p>
        <p v-for="invoice in reference.cross_check.invoices || []" :key="invoice.invoice_id">
          发票 {{ invoice.invoice_id }} · {{ assessments[invoice.status] || invoice.status }}
          · {{ invoice.source_kind === 'MANUAL_FACE_CONFIRMATION' ? '人工票面复核' : '未提供票面事实' }}
          <span v-if="invoice.reason_codes?.length"> · {{ invoice.reason_codes.join('、') }}</span>
        </p>
      </article>
    </section>
    <details :open="!!item.travel_confirmation?.decision">
      <summary>按需补充差旅人工决定（不替代权威评估）</summary>
      <fieldset :disabled="disabled">
        <label>人工决定<select v-model="item.travel_confirmation.decision">
          <option value="">不提交人工决定</option>
          <option value="CONFIRMED_UNKNOWN">确认事实未知并补充说明证据，仍保持UNKNOWN</option>
          <option value="ACKNOWLEDGED_MISMATCH">承认事实不一致并申请额外审批</option>
        </select></label>
        <label>人工依据<textarea v-model="item.travel_confirmation.reason" maxlength="2000" /></label>
        <p>差旅佐证最多20份，不自动解析为发票。</p>
        <BusinessAttachmentSelect :model-value="item.travel_confirmation.evidence_text" @update:model-value="setTravelFiles"
          purpose="reimbursement.claim.evidence" :disabled="disabled" :names="names"
          @upload="emit('upload', $event, 'claimTravel')" />

      </fieldset>
      <div class="expense-actions"><button v-for="(file, index) in travelFiles" :key="file"
        class="expense-button" :disabled="!canDownload" @click="emit('download', file)">查看差旅证据 {{ evidenceName(file, index) }}</button></div>
    </details>
    <p v-if="limitNotice" class="expense-alert warning" role="status">
      {{ limitNotice }}
    </p>
  </section>
</template>
