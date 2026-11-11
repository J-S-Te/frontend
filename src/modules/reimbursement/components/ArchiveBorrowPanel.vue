<script setup>
import { ref,onMounted } from 'vue'
import { onBeforeRouteLeave } from 'vue-router'
import { reimbursementAPI as api,publicPrefix } from '../api/reimbursement.js'
import { createCommandRunner, timeoutSignal } from '../api/client.js'
import { formatBusinessDateTime } from '../../shared/utils/businessTime.js'
import PaginationBar from '@/modules/shared/components/PaginationBar.vue'
import ErrorState from '../../shared/components/ErrorState.vue'
import { borrowStatusLabels, failureMessage, packageStatusLabels } from '../statusLabels.js'

const props=defineProps({archives:{type:Object,default:null}})
const rows=ref([]),total=ref(0),page=ref(1),status=ref(''),reason=ref(''),reviewReason=ref('')
const days=ref(7),error=ref(''),busy=ref(false),pending=ref(null)
const runner=createCommandRunner(api)
let sequence=0
// 字典收敛（整改）：借阅与文件包状态文案统一来自 statusLabels.js 权威来源。
const statusLabels=borrowStatusLabels
const packageLabels=packageStatusLabels

// 用途：分页读取本人或当前可审核的借阅申请，不根据前端角色扩大范围。
// 参数：无。
// 返回值：无；失败显示错误并保留选择。
async function load() {
 const ticket=++sequence;error.value=''
 try {
  const query=new URLSearchParams({page:String(page.value),page_size:'20'})
  if(status.value)query.set('status',status.value)
  const value=await api.request(`/archive-borrows?${query}`)
  if(ticket===sequence){rows.value=value.items;total.value=value.total}
 }catch(cause){if(ticket===sequence)error.value=cause.message}
}

// 用途：发送借阅申请或独立审批，未知结果保留原命令供确认。
// 参数：operation为固定动作，path为固定业务坐标，payload为当前版本与原因。
// 返回值：无；成功后刷新真实列表。
async function send(operation,path,payload) {
 if(busy.value||pending.value)return
 busy.value=true;error.value=''
 try {await runner.execute(operation,path,payload);await load()}
 catch(cause){error.value=cause.message}
 finally{pending.value=runner.pending();busy.value=false}
}

// 用途：申请当前可见封存版本，借阅不授予原范围外的访问。
// 参数：archive为服务端返回的不可变封存版本。
// 返回值：无；需1至7天和明确用途，最终由服务端校验。
function request(archive) {
 if(!reason.value.trim()){error.value='请填写借阅用途';return}
 return send('archive.borrow.request',`/archives/${encodeURIComponent(archive.id)}/borrow-requests`,{
  expected_version:archive.package_version,reason:reason.value.trim(),requested_days:Number(days.value)})
}

// 用途：独立审核当前申请，使用借阅版本防止并发重复批准。
// 参数：row为当前申请，decision为APPROVE或REJECT。
// 返回值：无；当前权限及申请人资格仍由服务端重核。
function decide(row,decision) {
 if(!reviewReason.value.trim()){error.value='请填写审核原因';return}
 return send('archive.borrow.decide',`/archive-borrows/${encodeURIComponent(row.id)}/decisions`,{
  expected_version:row.version,decision,reason:reviewReason.value.trim()})
}

// 用途：查询后重用原命令恢复未知借阅结果，不另起申请。
// 参数：无。
// 返回值：无；尚未确认则继续保留本页。
async function retry() {
 busy.value=true;error.value=''
 try {await runner.retry();await load()}
 catch(cause){error.value=cause.message}
 finally{pending.value=runner.pending();busy.value=false}
}

// 用途：下载前刷新借阅状态，服务端再核对期限、当前范围、绑定及哈希。
// 参数：row为本人已批准且生成物完成的借阅。
// 返回值：无；错误不下载空包，不把审批受理当文件就绪。
async function download(row) {
 if(busy.value)return
 busy.value=true;error.value=''
 try {
  const current=await api.request(`/archive-borrows/${encodeURIComponent(row.id)}`)
  if(!current.allowed_actions?.includes('DOWNLOAD'))throw new Error('当前借阅尚不可下载，请核对期限和文件包状态')
  const response=await fetch(`${publicPrefix}/api/v1/archive-borrows/${encodeURIComponent(row.id)}/download`,{
   method:'POST',credentials:'include',headers:{'X-CSRF-Token':'1'},signal:timeoutSignal(60000)})
  if(!response.ok){const result=await response.json().catch(()=>({}));throw new Error(result.message||'借阅下载失败')}
  if(!response.headers.get('content-type')?.includes('application/zip'))throw new Error('文件包响应格式不正确')
  const blob=await response.blob()
  if(blob.size>20*1024*1024)throw new Error('文件包超过20MiB边界')
  const url=URL.createObjectURL(blob),link=document.createElement('a')
  link.href=url;link.download=`reimbursement-borrow-${row.id}.zip`;link.click()
  setTimeout(()=>URL.revokeObjectURL(url),1000)
 }catch(cause){error.value=cause.message}
 finally{busy.value=false}
}
onBeforeRouteLeave(()=>!pending.value)
onMounted(load)
</script>
<template>
 <section class="expense-panel">
  <h2>受控档案借阅</h2><p>仅可申请已有整单读取范围的档案，由独立档案人员审核，最长7天。下载逐次重验当前权限；借阅不扩大财务数据范围。</p>
  <ErrorState v-if="error" compact title="档案借阅未完成" :error="error" :retry="false" />
  <div v-if="pending" class="expense-alert warning">原命令 {{ pending.command_id }} 结果未确认，请保留本页。
   <button class="expense-button" :disabled="busy" @click="retry">查询并重试原命令</button></div>
  <fieldset :disabled="busy||!!pending"><label>借阅用途<textarea v-model="reason" maxlength="2000" /></label>
   <label>借阅天数<input v-model.number="days" type="number" min="1" max="7"></label>
   <div v-for="archive in props.archives?.items || []" :key="archive.id" class="expense-actions">
    <span>封存版本 {{ archive.package_version }}</span><button v-if="archive.status==='SEALED'" class="expense-button" @click="request(archive)">申请此版本借阅</button>
   </div></fieldset>
  <div class="expense-actions"><label>申请状态<select v-model="status" @change="page=1;load()"><option value="">全部</option><option v-for="value in ['PENDING','APPROVED','REJECTED','EXPIRED']" :key="value" :value="value">{{ statusLabels[value] }}</option></select></label>
   <button class="expense-button" @click="load">刷新借阅状态</button></div>
  <label>独立审核原因<textarea v-model="reviewReason" maxlength="2000" :disabled="busy||!!pending" /></label>
  <article v-for="row in rows" :key="row.id" class="expense-item">
   <h3>档案 {{ row.archive_id }} · {{ statusLabels[row.status] || '状态待确认' }}</h3><p>申请人 {{ row.requester_subject_id }} · 用途 {{ row.reason }}</p>
   <p>审核人 {{ row.approver_subject_id || '待审核' }} · 文件包 {{ packageLabels[row.package_status] || (row.package_status ? '状态待确认' : '未生成') }} · 到期 {{ row.expires_at ? formatBusinessDateTime(row.expires_at) : '批准后生效' }}</p>
   <p v-if="row.last_error" role="alert">{{ failureMessage(row.last_error) }}</p>
   <div class="expense-actions"><button v-for="action in (row.allowed_actions || [])" :key="action" class="expense-button" :disabled="busy||!!pending"
     @click="action==='DOWNLOAD'?download(row):decide(row,action)">{{ {APPROVE:'批准借阅',REJECT:'拒绝',DOWNLOAD:'下载借阅包'}[action] || '办理' }}</button></div>
  </article>
  <p v-if="!error&&!rows.length">当前范围没有借阅申请。</p>
  <PaginationBar label="档案借阅分页" :page="page" :total="total" :page-size="20" :loading="busy"
   @change="nextPage => { page = nextPage; load() }" />
 </section>
</template>
