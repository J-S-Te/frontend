<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { todayBusinessDate } from '../../shared/utils/businessTime.js'
import { canReviewRecognition, recognitionAmount, recognitionCandidateRows, recognitionInput } from '../recognition.js'

const props=defineProps({api:{type:Object,required:true},can:{type:Function,required:true},session:{type:Object,default:()=>({})},initialClaim:{type:String,default:''}})
const rows=ref([]),people=ref([]),keyword=ref(''),error=ref(''),notice=ref(''),busy=ref(false),offset=ref(0),editing=ref(null),candidate=ref(null),claimID=ref(props.initialClaim),sourceEnvironment=ref(''),project=ref(null)
const reviewNotes=reactive({})
const evidenceFile=ref(null),evidenceName=ref('')
let active=true,loadGeneration=0
const actor=computed(()=>props.session.user_id||'')
const canRecord=computed(()=>props.can('settlement.recognition.record'))
const canReview=computed(()=>props.can('settlement.recognition.review'))
const candidateRows=computed(()=>recognitionCandidateRows(candidate.value))
const witness=computed(()=>people.value.find(person=>person.user_id===form.organization_witness_id))
const form=reactive({})
const labels={DRAFT:'草稿',SUBMITTED:'待独立复核',RETURNED:'已退回',CONFIRMED:'已确认'}

// 用途：清空登记表单并保留当前服务端来源环境。
// 参数：无。
// 返回值：无；不影响服务端已保存事实。
function resetForm(){
  Object.keys(form).forEach(key=>delete form[key])
  Object.assign(form,{kind:'INCOME',cost_category:'',organization_id:'',organization_witness_id:'',identity_id:'',project_id:'',service_item_id:'',contract_snapshot_id:'',currency:'CNY',amount:'',tax:'0.00',tax_basis:'EXCLUSIVE',occurred_date:todayBusinessDate(),recognition_date:todayBusinessDate(),evidence_reference:'',note:'',source_system:'manual',source_environment:sourceEnvironment.value,source_fact_id:'',source_claim_id:'',source_effect_id:'',source_item_id:'',source_allocation_key:'',prepayment_basis:'',original_id:''})
  editing.value=null;project.value=null;evidenceFile.value=null;evidenceName.value=''
}

// 用途：读取当前范围内真实分页列表，过期响应及离开页面后的响应不落状态。
// 参数：无。
// 返回值：无；错误保留原列表并明确提示。
async function reload(){
  const generation=++loadGeneration
  try{const page=await props.api.list({limit:20,offset:offset.value});if(!active||generation!==loadGeneration)return;rows.value=page.items||[];sourceEnvironment.value=page.source_environment||'';if(!editing.value)form.source_environment=sourceEnvironment.value}
  catch(cause){if(active&&generation===loadGeneration)error.value=cause?.message||'确认账本读取失败'}
}

// 用途：搜索平台当前在职人员及有权组织，避免自由填写组织与人员身份。
// 参数：无。
// 返回值：无；依赖失败不制造候选。
async function searchPeople(){
  try{const page=await props.api.people(keyword.value);if(active)people.value=page.items||[]}
  catch(cause){if(active)error.value=cause?.message||'受控目录暂不可用'}
}

// 用途：从真实报销单读取冻结费用、有效付款及退款差异。
// 参数：无。
// 返回值：无；未知来源和冲正差异明确阻断选用。
async function readCandidates(){
  if(busy.value)return;busy.value=true;error.value=''
  try{const value=await props.api.candidates(claimID.value.trim());if(active)candidate.value=value}
  catch(cause){if(active)error.value=cause?.message||'候选读取失败'}finally{if(active)busy.value=false}
}

// 用途：把选定的批准费用预填为待独立确认草稿，不把付款当已确认成本。
// 参数：item为服务器冻结的单项分摊。
// 返回值：无；金额、税基、承担组织及凭证仍由财务核实。
function selectCandidate(item){
  resetForm();Object.assign(form,{kind:'COST',cost_category:'REIMBURSEMENT',source_system:'reimbursement',source_claim_id:candidate.value.claim.claim_id,source_effect_id:item.effect_id,source_item_id:item.item_id,source_allocation_key:item.allocation_key,source_fact_id:`${candidate.value.claim.claim_id}:${item.item_id}:${item.allocation_key.slice(0,8)}`,project_id:item.project_id,service_item_id:item.service_item_id||'',occurred_date:item.occurred_date,currency:candidate.value.claim.currency,amount:recognitionAmount(item.amount_minor),tax_basis:'INCLUSIVE'})
}

// 用途：校验精确项目引用并展示服务器确认的服务项候选。
// 参数：无。
// 返回值：无；权限或引用失效会显示错误。
async function validateProject(){
  try{const value=await props.api.project(form.project_id);if(active)project.value=value}
  catch(cause){if(active){project.value=null;error.value=cause?.message||'项目引用不可用'}}
}

// 用途：编辑本人草稿或建立关联原确认的冲回草稿，原确认内容保持不变。
// 参数：row为真实记录，reverse标识是否冲回。
// 返回值：无；冲回保留原来源与归属，使用新的确认日和理由。
function editRecord(row,reverse=false){
  resetForm();Object.assign(form,recognitionInput({...row,amount:recognitionAmount(row.amount_minor),tax:recognitionAmount(row.tax_minor)}),{amount:recognitionAmount(row.amount_minor),tax:recognitionAmount(row.tax_minor)})
  if(reverse){form.original_id=row.id;form.recognition_date=todayBusinessDate();form.note='';notice.value='请填写冲回金额及理由，提交后由其他财务人员独立复核'}else{editing.value={id:row.id,version:row.version}}
  if(form.project_id)validateProject()
}

// 用途：将选定证据实际上传并绑定文件网关，成功前不预填可确认引用。
// 参数：无，读取当前组织与选定文件。
// 返回值：无；失败保留文件供同摘要重试，不宣称上传成功。
async function uploadEvidence(){
  if(busy.value||!evidenceFile.value||!form.organization_id||!form.organization_witness_id)return
  busy.value=true;error.value=''
  try{const evidence=await props.api.uploadEvidence(evidenceFile.value,form.organization_id,form.organization_witness_id);if(!active)return;if(evidence.status!=='READY')throw new Error('证据尚未完成上传绑定');form.evidence_reference=evidence.evidence_reference;evidenceName.value=evidence.name;notice.value='财务证据已真实上传并绑定，仍需独立复核确认'}
  catch(cause){if(active)error.value=cause?.message||'证据上传未完成，请保留原件重试'}finally{if(active)busy.value=false}
}

// 用途：逐次通过服务端组织ACL下载本地财务证据引用。
// 参数：reference为当前真实记录中的证据引用。
// 返回值：无；失败明确提示，不从浏览器直接访问File Gateway文件标识。
async function downloadEvidence(reference){
  if(busy.value||!reference?.startsWith('file:'))return;busy.value=true;error.value=''
  try{await props.api.downloadEvidence(reference.slice(5))}catch(cause){if(active)error.value=cause?.message||'证据下载失败'}finally{if(active)busy.value=false}
}

// 用途：提交真实草稿或草稿修订，网络失败保留表单供同内容重试。
// 参数：无。
// 返回值：无；成功后刷新有界账本。
async function saveDraft(){
  if(busy.value||!canRecord.value)return;busy.value=true;error.value='';notice.value=''
  try{const input=recognitionInput(form);if(editing.value)await props.api.update(editing.value.id,{...input,expected_version:editing.value.version});else await props.api.create(input);if(!active)return;resetForm();notice.value='草稿已保存，提交并独立复核后才计入确认指标';await reload()}
  catch(cause){if(active)error.value=cause?.message||'草稿保存失败'}finally{if(active)busy.value=false}
}

// 用途：执行明确提交或独立复核，服务端继续复验版本、组织、来源与职责分离。
// 参数：row为当前记录，decision为空表示提交，否则为CONFIRMED或RETURNED。
// 返回值：无；失败保留真实状态及原因。
async function act(row,decision=''){
  if(busy.value)return;busy.value=true;error.value='';notice.value=''
  try{const input={expected_version:row.version,note:reviewNotes[row.id]||''};if(decision)await props.api.decision(row.id,{...input,decision});else await props.api.submit(row.id,input);if(active){notice.value=decision==='RETURNED'?'已退回并保留审核原因':'操作已保存';await reload()}}
  catch(cause){if(active)error.value=cause?.message||'财务动作失败'}finally{if(active)busy.value=false}
}

// 用途：切换真实有界列表页。
// 参数：direction为前后页方向。
// 返回值：无。
function turnPage(direction){if(busy.value)return;offset.value=Math.max(0,offset.value+direction*20);reload()}

resetForm()
onMounted(async()=>{await reload();if(canRecord.value){await searchPeople();if(props.initialClaim)await readCandidates()}})
onBeforeUnmount(()=>{active=false;loadGeneration++})
</script>

<template>
  <section class="console-card recognition-panel" aria-label="财务确认账本">
    <div class="console-card-header"><h2>收入与成本确认</h2><button type="button" :disabled="busy" @click="reload">刷新账本</button></div>
    <p class="muted">按财务独立复核事实统计，不含税净额与税额分列。付款、预付与已确认成本分别展示；旧历史未登记不代表零。</p>
    <p v-if="error" role="alert" class="recognition-error">{{ error }}</p><p v-if="notice" role="status">{{ notice }}</p>
    <details v-if="canRecord" :open="!!initialClaim"><summary>读取报销成本候选</summary>
      <p>每次完整读取最多1000单、10000分摊行或8MiB，超限明确失败。项目支出副本不会重复计入。</p>
      <form @submit.prevent="readCandidates"><label>报销单据引用 <input v-model="claimID" required maxlength="64"></label><button :disabled="busy">读取冻结费用</button></form>
      <p v-if="candidate?.blocked" role="alert">存在未处置的付款冲正差异，请先对原确认登记冲回并由他人复核；重新付款不会新增费用额度。</p>
      <p v-if="candidate?.claim?.status === 'UNKNOWN'">{{ candidate.claim.unknown_reason }}；暂不可确认成本。</p>
      <p v-if="candidate?.claim?.frozen_items?.some(item => item.expense_nature === 'PREPAYMENT')">预付款必须填写实际发生或摊销依据并独立确认，不能直接计入成本。</p>
      <ul><li v-for="item in candidateRows" :key="`${item.effect_id}:${item.item_id}:${item.allocation_key}`">{{ item.occurred_date }} · {{ item.expense_nature === 'PREPAYMENT' ? '预付费用' : '实际费用' }} · {{ recognitionAmount(item.amount_minor) }} {{ candidate.claim.currency }} <button type="button" :disabled="busy" @click="selectCandidate(item)">选用费用分摊</button></li></ul>
      <p v-if="candidate?.conflict_record_ids?.length">待冲回原确认：{{ candidate.conflict_record_ids.join('、') }}</p>
    </details>
    <details v-if="canRecord" open><summary>{{ form.original_id ? '登记独立冲回' : editing ? '修改本人草稿' : '登记确认草稿' }}</summary>
      <p v-if="form.original_id">净额与税额可分别冲回。仅处置残税时，不含税金额填0、税额填本次冲回额；或含税金额与税额填相同值。仍须关联原确认并由他人独立复核。</p>
      <form class="recognition-form" @submit.prevent="saveDraft">
        <label>事实种类<select v-model="form.kind" :disabled="!!editing || !!form.original_id || form.source_system === 'reimbursement'" @change="form.cost_category = form.kind === 'COST' ? 'OTHER' : ''"><option value="INCOME">收入</option><option value="COST">成本</option></select></label>
        <label v-if="form.kind === 'COST'">成本类别<select v-model="form.cost_category"><option value="LABOR">人工归属成本</option><option value="PROCUREMENT">采购</option><option value="EQUIPMENT">设备</option><option value="REIMBURSEMENT">报销费用</option><option value="OTHER">其他</option></select></label>
        <label>人员目录搜索<input v-model="keyword" maxlength="100"><button type="button" :disabled="busy" @click="searchPeople">查询人员与组织</button></label>
        <label>组织目录依据人员<select v-model="form.organization_witness_id" required><option value="">请选择在职人员</option><option v-for="person in people" :key="person.user_id" :value="person.user_id">{{ person.display_name }}</option></select></label>
        <label>成本承担/收入归属组织<select v-model="form.organization_id" required><option value="">请选择明确组织</option><option v-for="org in witness?.organizations || []" :key="org.organization_id" :value="org.organization_id">{{ org.organization_name }}</option></select></label>
        <label>实际归属人员（可不分配）<select v-model="form.identity_id"><option value="">未分配到个人</option><option v-for="person in people" :key="person.user_id" :value="person.user_id">{{ person.display_name }}</option></select></label>
        <label>币种<input v-model="form.currency" required maxlength="3" pattern="[A-Z]{3}"></label>
        <label>金额<input v-model="form.amount" required inputmode="decimal" maxlength="18" placeholder="0.00"></label>
        <label>明确税额<input v-model="form.tax" required inputmode="decimal" maxlength="18" placeholder="0.00"></label>
        <label>金额税基<select v-model="form.tax_basis" required><option value="EXCLUSIVE">以上金额不含税</option><option value="INCLUSIVE">以上金额含税</option></select></label>
        <label>业务发生日<input v-model="form.occurred_date" type="date" required :max="todayBusinessDate()"></label>
        <label>本次确认日<input v-model="form.recognition_date" type="date" required :max="todayBusinessDate()"></label>
        <div class="recognition-wide"><label>财务凭证原件（PDF/JPEG/PNG，最多10MiB）<input type="file" accept=".pdf,.jpg,.jpeg,.png" :disabled="busy" @change="evidenceFile = $event.target.files?.[0] || null"></label><button type="button" :disabled="busy || !evidenceFile || !form.organization_id || !form.organization_witness_id" @click="uploadEvidence">上传并绑定真实证据</button><span v-if="evidenceName">已就绪：{{ evidenceName }}</span></div>
        <p class="recognition-wide">旧会计凭证须具备原凭证操作权限与完整财务范围；只有本页新财务动作时，可上传本组织独立证据。</p>
        <label>已就绪证据或既有结算凭证引用<input v-model="form.evidence_reference" required maxlength="128" placeholder="上传就绪后自动回填，或选择已有结算凭证" :readonly="form.evidence_reference.startsWith('file:')"></label>
        <label>来源凭证行/事实标识<input v-model="form.source_fact_id" required maxlength="128" :readonly="!!editing || !!form.original_id || form.source_system === 'reimbursement'"></label>
        <label>项目引用（可选）<input v-model="form.project_id" maxlength="128"><button v-if="form.project_id" type="button" :disabled="busy" @click="validateProject">校验项目</button></label>
        <label v-if="project">{{ project.name }} · 服务项<select v-model="form.service_item_id"><option value="">不指定服务项</option><option v-for="id in project.service_item_ids" :key="id" :value="id">{{ id }}</option></select></label>
        <label v-if="form.source_claim_id">实际发生/摊销依据<textarea v-model="form.prepayment_basis" maxlength="2000" placeholder="预付转成本必须说明实际发生或摊销依据"></textarea></label>
        <label class="recognition-wide">{{ form.original_id ? '冲回理由及依据' : '确认说明及凭证依据' }}<textarea v-model="form.note" required maxlength="2000"></textarea></label>
        <div class="recognition-wide"><button :disabled="busy">{{ editing ? '保存草稿修订' : '保存待提交草稿' }}</button><button type="button" :disabled="busy" @click="resetForm">清空表单</button></div>
      </form>
    </details>
    <div class="recognition-table"><table><thead><tr><th>事实/期间</th><th>归属</th><th>未税净额 / 税额</th><th>状态与审核</th><th>操作</th></tr></thead>
      <tbody><tr v-for="row in rows" :key="row.id"><td>{{ row.original_id ? '冲回 · ' : '' }}{{ row.kind === 'INCOME' ? '收入' : '成本' }}<br>{{ row.recognition_date }}<small>发生：{{ row.occurred_date }}</small><small>{{ row.id }}</small></td><td>{{ row.organization_name }}<small>{{ row.identity_name || '未分配到个人' }}</small><small>{{ row.project_name }}</small><button v-if="row.evidence_reference?.startsWith('file:')" type="button" :disabled="busy" @click="downloadEvidence(row.evidence_reference)">下载财务证据</button></td><td>{{ recognitionAmount(row.original_id ? -row.net_minor : row.net_minor) }} / {{ recognitionAmount(row.original_id ? -row.tax_minor : row.tax_minor) }} {{ row.currency }}</td><td>{{ labels[row.status] || row.status }}<small>{{ row.review_note }}</small><small>登记：{{ row.created_by }}；复核：{{ row.reviewed_by || '待审' }}</small></td><td>
        <template v-if="canRecord && row.created_by === actor && ['DRAFT','RETURNED'].includes(row.status)"><button type="button" :disabled="busy" @click="editRecord(row)">修改草稿</button><button type="button" :disabled="busy" @click="act(row)">提交独立复核</button></template>
        <template v-if="canReview && canReviewRecognition(row, actor)"><textarea v-model="reviewNotes[row.id]" maxlength="2000" placeholder="复核说明（退回必填）" :aria-label="`复核说明 ${row.id}`"></textarea><button type="button" :disabled="busy" @click="act(row,'CONFIRMED')">独立确认</button><button type="button" :disabled="busy || !reviewNotes[row.id]?.trim()" @click="act(row,'RETURNED')">退回修改</button></template>
        <button v-if="canRecord && row.status === 'CONFIRMED' && !row.original_id" type="button" :disabled="busy" @click="editRecord(row,true)">登记冲回</button>
      </td></tr></tbody></table></div>
    <p v-if="!rows.length">当前范围暂无已登记事实；不代表外部账务为零。</p>
    <div><button type="button" :disabled="busy || offset === 0" @click="turnPage(-1)">上一页</button><span>第 {{ offset / 20 + 1 }} 页</span><button type="button" :disabled="busy || rows.length < 20" @click="turnPage(1)">下一页</button></div>
  </section>
</template>

<style scoped>
.recognition-panel{padding:20px}.recognition-panel details{margin:18px 0}.recognition-form{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;margin-top:16px}.recognition-form label{display:flex;flex-direction:column;gap:6px}.recognition-form input,.recognition-form select,.recognition-form textarea{min-width:0;padding:8px;border:1px solid var(--border-color,#cbd5e1);border-radius:6px}.recognition-wide{grid-column:1/-1}.recognition-table{overflow:auto;margin:16px 0}.recognition-table table{width:100%;min-width:780px;border-collapse:collapse}.recognition-table th,.recognition-table td{text-align:left;padding:10px;border-bottom:1px solid #dce2ea;vertical-align:top}.recognition-table small{display:block;color:#596579;margin-top:4px}.recognition-panel button{margin:4px;padding:6px 10px}.recognition-error{color:#b42318}@media(max-width:720px){.recognition-form{grid-template-columns:1fr}}
</style>
