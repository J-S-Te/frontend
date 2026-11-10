<script setup>
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { frontendModules } from '../../registry/compiledModules.js'
import { formatBusinessDateTime, todayBusinessDate } from '../../shared/utils/businessTime.js'
import { getProjectExpenseParticipants, putProjectExpenseParticipant, getProjectReimbursementSpend } from '../api/projectManagement.js'

const props = defineProps({ session: { type: Object, default: null }, projectId: { type: String, default: '' } })
const router = useRouter()
const loading = ref(false)
const error = ref('')
const rows = ref(null)
const cursor = ref('')
const compiled = frontendModules.some((module) => module.code === 'reimbursement')
const participants = ref(null)
const participantCursor = ref('')
const participantError = ref('')
const participantNotice = ref('')
const participantBusy = ref(false)
const participantForm = ref({ subject_id:'',valid_from:`${todayBusinessDate()}T00:00`,valid_until:'',reason:'',version:0 })
const canManage = computed(() => props.session?.permissions?.includes('project.expense_participant.manage') === true)
const canRead = computed(() => props.session?.permissions?.includes('project.reimbursement_spend.read') === true)
let sequence = 0

// 用途：读取当前项目的最小报销金额摘要，保持独立错误状态。
// 参数：next 为是否读取下一页。
// 返回值：无；无精确权限时不发请求。
async function load(next = false) {
  if (!props.projectId || !canRead.value) return
  const ticket = ++sequence
  loading.value = true; error.value = ''
  try {
    const result = await getProjectReimbursementSpend(props.projectId, next ? cursor.value : '')
    if (ticket !== sequence) return
    if (!Array.isArray(result.items) || result.metric !== 'paid_net_minor') throw new Error('项目支出响应不完整')
    rows.value = result.items
    cursor.value = result.items.length === 20 ? result.items.at(-1).claim_id : ''
  } catch (cause) { if (ticket === sequence) error.value = cause.message || '项目报销支出暂不可用' }
  finally { if (ticket === sequence) loading.value = false }
}

// 用途：精确展示整数分净支出，不跨模块导入报销业务代码。
// 参数：value 为服务端十进制字符串。
// 返回值：元金额文本；缺失或非法时显示不可用。
function money(value) {
  if (typeof value !== 'string' || !/^-?\d+$/.test(value)) return '不可用'
  const amount = BigInt(value)
  const abs = amount < 0n ? -amount : amount
  return `${amount < 0n ? '-' : ''}${abs / 100n}.${String(abs % 100n).padStart(2, '0')}`
}

// 用途：通过目标应用路由守卫建立报销会话，项目参数仅用于提示和过滤。
// 参数：create 为是否进入新建单据入口。
// 返回值：无；未编译报销模块时不跳转。
function openReimbursement(create = false, claimID = '') {
  if (!compiled) return
  router.push({ name: 'reimbursement', params: { section: 'claims' },
    query: { ...(props.projectId ? { project_id: props.projectId } : {}), ...(create ? { create: '1' } : {}), ...(claimID ? { claim_id: claimID } : {}) } })
}

// 用途：读取当前项目参与名单，资格管理权限不足时不触发任何接口。
// 参数：next 为是否读取下一页。
// 返回值：无；失败保留独立错误，名单不扩大项目读取能力。
async function loadParticipants(next = false) {
  if (!props.projectId || !canManage.value) return
  const project=props.projectId; participantBusy.value=true; participantError.value=''
  try {
    const result=await getProjectExpenseParticipants(project,next?participantCursor.value:'')
    if(project!==props.projectId||!canManage.value)return
    if(!Array.isArray(result.items))throw new Error('参与名单响应不完整')
    participants.value=result.items;participantCursor.value=result.items.length===20?result.items.at(-1).subject_id:''
  } catch(cause){if(project===props.projectId)participantError.value=cause.message}
  finally{participantBusy.value=false}
}

// 用途：按北京时间展示既有资格并绑定当前版本，保留独立编辑原因。
// 参数：row 为服务端当前资格。
// 返回值：无；不从主体名称推造身份。
function chooseParticipant(row) {
  const stamp=(value)=>value?new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',dateStyle:'short',timeStyle:'short',hour12:false}).format(new Date(value)).replace(' ','T'):''
  participantForm.value={subject_id:row.subject_id,version:row.version,valid_from:stamp(row.valid_from),valid_until:stamp(row.valid_until),reason:''}
}

// 用途：按当前版本修改或移除资格，冲突时读新名单并保留编辑表单。
// 参数：revoke 表示明确移除；不会物理删除历史授权。
// 返回值：无；未知结果先读名单核对，禁止伪造成功。
async function saveParticipant(revoke = false) {
  if(participantBusy.value||!canManage.value)return
  const project=props.projectId;participantBusy.value=true;participantError.value='';participantNotice.value=''
  try {
    const result=await putProjectExpenseParticipant(project,participantForm.value,revoke)
    if(project!==props.projectId)return
    participantForm.value.version=result.version
    participantNotice.value=revoke?'资格已移除，历史仍保留。':'资格已保存；有效期以北京时间解释。'
    await loadParticipants()
  } catch(cause) {
    if(project!==props.projectId)return
    participantError.value=cause.message
    if(cause.status===409||cause.outcomeUnknown){await loadParticipants();participantNotice.value='已重新读取当前名单；您的输入保留。请选择当前资格核对版本后再提交。'}
  } finally{participantBusy.value=false}
}

watch(() => [props.projectId, canRead.value, canManage.value], () => {
  ++sequence; rows.value = null; cursor.value = ''; error.value = ''; participants.value=null; participantCursor.value=''; participantError.value=''; participantNotice.value=''; participantForm.value={subject_id:'',valid_from:`${todayBusinessDate()}T00:00`,valid_until:'',reason:'',version:0}
}, { immediate: true })
</script>

<template>
  <section class="pm-panel" aria-label="项目报销支出">
    <header>
      <div>
        <p class="pm-panel-kicker">
          费用协作
        </p>
        <h2>
          {{ projectId ? '相关报销与项目支出' : '费用资格与报销入口' }}
        </h2>
      </div>
    </header>
    <p v-if="!projectId">
      当前会话不含项目工作区读取能力。费用参与资格请进入报销系统按权威项目选项查询。
    </p>
    <div class="pm-actions-bar">
      <template v-if="compiled">
        <button class="pm-button" @click="openReimbursement(false)">
          相关报销
        </button>
        <button class="pm-button" @click="openReimbursement(true)">
          新建报销
        </button>
      </template>
      <span v-else>
        当前发行未包含报销模块
      </span>
      <button
        v-if="projectId && canRead"
        class="pm-button"
        :disabled="loading"
        @click="load(false)"
      >
        {{ loading ? '读取中…' : '查询报销支出' }}
      </button>
    </div>
    <p v-if="projectId && !canRead">
      当前账号未获项目报销支出查看权限。
    </p>
    <p v-if="error" role="alert">
      {{ error }}
    </p>
    <div v-if="rows" class="pm-table-scroll">
      <table class="pm-table">
        <thead>
          <tr>
            <th>
              来源单号
            </th>
            <th>
              本项目已付净额
            </th>
            <th>费用类别（本项目净额）</th>
            <th>最近付款时间</th>
            <th>
              币种
            </th>
            <th>
              投影版本
            </th>
            <th>
              同步时间
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="row.claim_id">
            <td>
              <button v-if="compiled" class="pm-link" @click="openReimbursement(false,row.claim_id)">{{ row.claim_no }}</button>
              <span v-else>{{ row.claim_no }}</span>
            </td>
            <td>
              {{ money(row.paid_net_minor) }}
            </td>
            <td><p v-for="category in row.fee_categories || []" :key="category.fee_type">{{ category.fee_type }}：{{ money(category.paid_net_minor) }} 元</p></td>
            <td>{{ row.last_payment_occurred_at ? formatBusinessDateTime(row.last_payment_occurred_at) : '未记录' }}</td>
            <td>
              {{ row.currency }}
            </td>
            <td>
              {{ row.projection_revision }}
            </td>
            <td>
              {{ row.updated_at }}
            </td>
          </tr>
          <tr v-if="!rows.length">
            <td colspan="7">
              本项目暂无已同步的报销支出
            </td>
          </tr>
        </tbody>
      </table>
      <button v-if="cursor" class="pm-button" :disabled="loading" @click="load(true)">
        下一页
      </button>
    </div>
    <section v-if="projectId && canManage" aria-label="项目费用参与资格">
      <h3>项目费用参与资格</h3>
      <p>名单仅授予报销引用资格；生效和到期按北京时间，最长366天。移除保留历史。</p>
      <button class="pm-button" :disabled="participantBusy" @click="loadParticipants(false)">读取当前名单</button>
      <p v-if="participantError" role="alert">{{ participantError }}</p>
      <p v-if="participantNotice" role="status">{{ participantNotice }}</p>
      <div v-if="participants" class="pm-table-scroll"><table class="pm-table"><thead><tr><th>稳定主体</th><th>状态</th><th>有效期（北京时间）</th><th>版本</th><th>操作</th></tr></thead><tbody>
        <tr v-for="person in participants" :key="person.subject_id"><td>{{ person.subject_id }}</td><td>{{ person.status }}</td><td>{{ formatBusinessDateTime(person.valid_from) }} 至 {{ formatBusinessDateTime(person.valid_until) }}</td><td>{{ person.version }}</td><td><button class="pm-button" @click="chooseParticipant(person)">选择当前版本</button></td></tr>
        <tr v-if="!participants.length"><td colspan="5">当前没有显式参与资格。</td></tr>
      </tbody></table><button v-if="participantCursor" class="pm-button" :disabled="participantBusy" @click="loadParticipants(true)">下一页</button></div>
      <fieldset :disabled="participantBusy"><legend>新增或调整资格</legend>
        <label>人员稳定主体ID<input v-model="participantForm.subject_id" maxlength="128"></label>
        <label>生效时间（北京时间）<input v-model="participantForm.valid_from" type="datetime-local"></label>
        <label>到期时间（北京时间）<input v-model="participantForm.valid_until" type="datetime-local"></label>
        <label>原因<textarea v-model="participantForm.reason" maxlength="1000" /></label>
        <p>当前版本 {{ participantForm.version }}，新增为0；调整前请从名单选择当前记录。</p>
        <button class="pm-button" @click="saveParticipant(false)">保存资格</button>
        <button class="pm-button" :disabled="!participantForm.version" @click="saveParticipant(true)">移除资格</button>
      </fieldset>
    </section>
  </section>
</template>
