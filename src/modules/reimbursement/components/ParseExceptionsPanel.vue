<script setup>
import { onMounted, ref } from 'vue'
import { reimbursementAPI as api } from '../api/reimbursement.js'
import { formatBusinessDateTime } from '../../shared/utils/businessTime.js'
import { failureMessage } from '../statusLabels.js'
import PaginationBar from '@/modules/shared/components/PaginationBar.vue'
import ErrorState from '../../shared/components/ErrorState.vue'
const emit=defineEmits(['open'])
const rows=ref([]),total=ref(0),page=ref(1),status=ref(''),busy=ref(false),error=ref('')
const dateFrom=ref(''),dateTo=ref('')
let sequence=0
const statuses={FAILED:'提取失败',NEEDS_REVIEW:'有候选，须人工复核',PARTIAL:'提取不完整'}

// 用途：读取本人尚未形成业务票据的最新解析异常，不伪造空发票。
// 参数：reset为更改筛选时回到第一页。
// 返回值：无；原件权限及最终状态由服务端校验，失败不显示为空目录。
async function load(reset=false) {
  if(reset)page.value=1
  const ticket=++sequence;busy.value=true;error.value=''
  try {
    const query=new URLSearchParams({page:String(page.value),page_size:'20'})
    if(status.value)query.set('status',status.value)
    if(dateFrom.value)query.set('date_from',dateFrom.value)
    if(dateTo.value)query.set('date_to',dateTo.value)
    const value=await api.request(`/parse-exceptions?${query}`)
    if(!Array.isArray(value.items) || !Number.isFinite(value.total))throw new Error('解析异常响应不完整')
    if(ticket===sequence){rows.value=value.items;total.value=value.total}
  }catch(cause){if(ticket===sequence){rows.value=[];error.value=cause.message}}
  finally{if(ticket===sequence)busy.value=false}
}
onMounted(()=>load())
</script>
<template>
  <section class="expense-panel" aria-label="原件解析待处理池">
    <h2>原件解析待处理池</h2>
    <p>仅显示本人原件的最新异常运行，且尚未形成业务发票。扫描件、轮廓文字、乱码和字段不完整不会被当成识别成功。
      请查看原件与已提取候选，必要时人工录入或更换原始电子票。</p>
    <div class="expense-form-grid"><label>解析状态<select v-model="status"><option value="">全部待处理</option>
      <option v-for="(label,key) in statuses" :key="key" :value="key">{{ label }}</option></select></label>
      <label>运行开始日期<input v-model="dateFrom" type="date"></label><label>运行结束日期<input v-model="dateTo" type="date"></label>
      <button class="expense-button" :disabled="busy" @click="load(true)">查询解析异常</button></div>
    <ErrorState v-if="error" compact title="解析异常读取失败" :error="error" retry-text="重新读取解析异常" @retry="load()" />
    <div class="expense-table"><table class="expense-table-body"><thead><tr><th scope="col">原件</th><th scope="col">状态与原因</th><th scope="col">候选组</th><th scope="col">运行时间</th><th scope="col">处理</th></tr></thead><tbody>
      <tr v-for="row in rows" :key="row.parse_run_id"><td>{{ row.original_name || row.document_id }}</td>
        <td>{{ statuses[row.parse_status] || '状态待确认' }} · {{ row.error_code ? failureMessage(row.error_code) : '请对照原件核对缺失或冲突字段' }}</td>
        <td>{{ row.parsed_candidate_count }} 组待核对；尚无可用业务发票</td>
        <td>{{ formatBusinessDateTime(row.created_at) }}</td><td>
          <button class="expense-button" @click="emit('open',row)">查看原件与人工处理</button></td></tr>
      <tr v-if="!rows.length&&!error&&!busy"><td colspan="5">当前范围没有待处理原件。</td></tr>
    </tbody></table></div>
    <PaginationBar label="原件解析待处理池分页" :page="page" :total="total" :page-size="20" :loading="busy"
      @change="nextPage => { page = nextPage; load() }" />
  </section>
</template>
