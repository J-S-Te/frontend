<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { frontendModules } from '../../registry/compiledModules.js'
import { formatBusinessDateTime, todayBusinessDate } from '../../shared/utils/businessTime.js'
import { getProjectExpenseParticipants, putProjectExpenseParticipant, getProjectReimbursementSpend, listPersonnel } from '../api/projectManagement.js'

const props = defineProps({ session: { type: Object, default: null }, projectId: { type: String, default: '' }, projectStatus: { type: String, default: '' } })
const router = useRouter()
const loading = ref(false)
const error = ref('')
const rows = ref(null)
const cursor = ref('')
const compiled = frontendModules.some((module) => module.code === 'reimbursement')
const canCreate = computed(() => compiled && !!props.projectId && ['报告编制', '已完成'].includes(props.projectStatus))
const participants = ref(null)
const participantCursor = ref('')
const participantError = ref('')
const participantNotice = ref('')
const participantBusy = ref(false)
const implementationParticipants = ref(null)
const implementationCursor = ref('')
let participantSequence = 0
let participantContext = 0
const participantForm = ref({ subject_id:'',valid_from:`${todayBusinessDate()}T00:00`,valid_until:'',reason:'',version:0 })
const personnelOptions = ref([])
const personnelNames = ref({})
const personnelKeyword = ref('')
const personnelLoading = ref(false)
const personnelError = ref('')
const manualSubject = ref(false)
let personnelSequence = 0
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
// 参数：create为是否新建，claimID为服务器返回的既有报销单引用。
// 返回值：无；未编译报销模块时不跳转。
function openReimbursement(create = false, claimID = '') {
  if (!compiled || (create && !canCreate.value)) return
  router.push({ name: 'reimbursement', params: { section: 'claims' },
    query: { ...(props.projectId ? { project_id: props.projectId } : {}), ...(create ? { create: '1' } : {}), ...(claimID ? { claim_id: claimID } : {}) } })
}

// 用途：读取手工资格和实施人员默认资格，保留服务项边界及各自分页。
// 参数：next 为手工名单翻页，implementationNext 为默认名单翻页。
// 返回值：无；权限不足不请求，过期响应不改变当前项目状态。
async function loadParticipants(next = false, implementationNext = false) {
  if (!props.projectId || !canManage.value) return
  const ticket = ++participantSequence
  participantBusy.value = true
  participantError.value = ''
  try {
    const result = await getProjectExpenseParticipants(props.projectId,
      next ? participantCursor.value : '', implementationNext ? implementationCursor.value : '')
    if (ticket !== participantSequence) return
    if (!Array.isArray(result.items)) throw new Error('参与名单响应不完整')
    if (!implementationNext) {
      participants.value = result.items
      participantCursor.value = result.items.length === 20 ? result.items.at(-1).subject_id : ''
    }
    const page = result.implementation_participants
    if (!Array.isArray(page?.items)) throw new Error('项目服务未返回实施人员默认资格，请确认服务版本后重试')
    if (!next) {
      implementationParticipants.value = implementationNext
        ? [...(implementationParticipants.value || []), ...page.items] : page.items
      implementationCursor.value = page.next_cursor || ''
      personnelNames.value = { ...personnelNames.value,
        ...Object.fromEntries(page.items.map((person) => [person.subject_id, person.display_name])) }
    }
  } catch (cause) {
    if (ticket === participantSequence) participantError.value = cause.message || '参与名单暂不可用'
  } finally {
    if (ticket === participantSequence) participantBusy.value = false
  }
}

// 用途：从基础平台人员目录读取候选主体，避免手工输入无法核对的128位用户ID。
// 参数：无；关键词取自 personnelKeyword，为空时取第一页。
// 返回值：无；失败仅影响候选列表，不阻断已有资格编辑。
async function loadPersonnel() {
  if (!props.projectId || !canManage.value) return
  const ticket = ++personnelSequence
  personnelLoading.value = true; personnelError.value = ''
  try {
    const keyword = personnelKeyword.value.trim()
    const page = await listPersonnel({ page: 1, page_size: 50, ...(keyword ? { keyword } : {}) })
    if (ticket !== personnelSequence) return
    personnelOptions.value = page.items
      .map((person) => ({ id: String(person?.user_id || ''), name: person?.display_name || '未命名人员' }))
      .filter((person) => person.id)
    personnelNames.value = { ...personnelNames.value,
      ...Object.fromEntries(personnelOptions.value.map((person) => [person.id, person.name])) }
  } catch (cause) {
    if (ticket === personnelSequence) { personnelOptions.value = []; personnelError.value = cause.message || '人员目录暂不可用' }
  } finally { if (ticket === personnelSequence) personnelLoading.value = false }
}

// 用途：把主体ID显示为已读取到的人员姓名，未读取到时保留原始ID。
// 参数：id 为稳定主体标识。
// 返回值：可读人员名称；未知主体返回原ID。
function personnelLabel(id) {
  return personnelNames.value[id] || id
}

const personnelSelectOptions = computed(() => {
  const people = new Map((implementationParticipants.value || [])
    .map((person) => [person.subject_id, { id: person.subject_id, name: person.display_name }]))
  for (const person of personnelOptions.value) {
    if (!people.has(person.id)) people.set(person.id, person)
  }
  const options = [...people.values()].map((person) => ({
    id: person.id, label: `${person.name || person.id}（${person.id}）`,
  }))
  const selected = String(participantForm.value.subject_id || '').trim()
  if (selected && !options.some((person) => person.id === selected)) {
    const name = personnelNames.value[selected]
    options.unshift({ id: selected, label: name ? `${name}（${selected}）` : selected })
  }
  return options
})

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
  if (!props.projectId || participantBusy.value || !canManage.value) return
  const context = participantContext
  const project = props.projectId
  participantBusy.value = true
  participantError.value = ''
  participantNotice.value = ''
  try {
    const result = await putProjectExpenseParticipant(project, participantForm.value, revoke)
    if (context !== participantContext) return
    participantForm.value.version = result.version
    participantNotice.value = revoke ? '资格已移除，历史仍保留。' : '资格已保存；有效期以北京时间解释。'
    await loadParticipants()
  } catch (cause) {
    if (context !== participantContext) return
    participantError.value = cause.message
    if (cause.status === 409 || cause.outcomeUnknown) {
      await loadParticipants()
      if (context === participantContext) {
        participantNotice.value = '已重新读取当前名单；您的输入保留。请选择当前资格核对版本后再提交。'
      }
    }
  } finally {
    if (context === participantContext) participantBusy.value = false
  }
}

watch(() => [props.projectId, props.session?.tenant_id, props.session?.user_id,
  canRead.value, canManage.value], () => {
  ++participantContext
  ++participantSequence
  participantBusy.value = false
  implementationParticipants.value = null
  implementationCursor.value = ''
  ++sequence
  rows.value = null
  cursor.value = ''
  error.value = ''
  participants.value = null
  participantCursor.value = ''
  participantError.value = ''
  participantNotice.value = ''
  participantForm.value = {
    subject_id: '', valid_from: `${todayBusinessDate()}T00:00`,
    valid_until: '', reason: '', version: 0,
  }
  ++personnelSequence
  personnelOptions.value = []
  personnelNames.value = {}
  personnelKeyword.value = ''
  personnelError.value = ''
  personnelLoading.value = false
  manualSubject.value = false
  if (props.projectId && canManage.value) void loadParticipants()
}, { immediate: true })

onBeforeUnmount(() => {
  ++sequence
  ++participantSequence
  ++participantContext
  ++personnelSequence
})
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
        <button class="pm-button" :disabled="!canCreate" @click="openReimbursement(true)">
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
    <p v-if="projectId && !canCreate">项目进入报告编制或已完成后可新建报销；已有报销仍可查询。</p>
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
            <th scope="col">
              来源单号
            </th>
            <th scope="col">
              本项目已付净额
            </th>
            <th scope="col">费用类别（本项目净额）</th>
            <th scope="col">最近付款时间</th>
            <th scope="col">
              币种
            </th>
            <th scope="col">
              投影版本
            </th>
            <th scope="col">
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
      <p>实施人员默认具备其参与服务项的报销引用资格，随当前实施计划变化，无需重复保存。</p>
      <p>其他人员可添加额外项目资格；生效和到期按北京时间，最长366天。移除保留历史。</p>
      <button class="pm-button" :disabled="participantBusy" @click="loadParticipants(false)">{{ participantBusy ? '读取中…' : '刷新当前名单' }}</button>
      <p v-if="participantError" role="alert">{{ participantError }}</p>
      <p v-if="participantNotice" role="status">{{ participantNotice }}</p>
      <div v-if="implementationParticipants" class="pm-table-scroll">
        <h4>默认参与资格（实施人员）</h4>
        <table class="pm-table">
          <thead>
            <tr>
              <th scope="col">人员</th><th scope="col">所属服务项</th><th scope="col">资格来源</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="person in implementationParticipants"
              :key="`${person.service_item_id}:${person.resource_id}`"
            >
              <td>{{ person.display_name || person.subject_id }}<br><small>{{ person.subject_id }}</small></td>
              <td>{{ person.service_item_id }}</td><td>实施计划自动生效</td>
            </tr>
            <tr v-if="!implementationParticipants.length">
              <td colspan="3">当前没有已关联平台账号的实施人员；请在实施计划与人员资质中维护。</td>
            </tr>
          </tbody>
        </table>
        <button v-if="implementationCursor" class="pm-button" :disabled="participantBusy" @click="loadParticipants(false, true)">更多实施人员</button>
      </div>
      <h4 v-if="participants">额外项目资格（人工维护）</h4>
      <div v-if="participants" class="pm-table-scroll"><table class="pm-table"><thead><tr><th scope="col">稳定主体</th><th scope="col">状态</th><th scope="col">有效期（北京时间）</th><th scope="col">版本</th><th scope="col">操作</th></tr></thead><tbody>
        <tr v-for="person in participants" :key="person.subject_id"><td>{{ personnelLabel(person.subject_id) }}<br><small>{{ person.subject_id }}</small></td><td>{{ person.status }}</td><td>{{ formatBusinessDateTime(person.valid_from) }} 至 {{ formatBusinessDateTime(person.valid_until) }}</td><td>{{ person.version }}</td><td><button class="pm-button" @click="chooseParticipant(person)">选择当前版本</button></td></tr>
        <tr v-if="!participants.length"><td colspan="5">当前没有显式参与资格。</td></tr>
      </tbody></table><button v-if="participantCursor" class="pm-button" :disabled="participantBusy" @click="loadParticipants(true)">下一页</button></div>
      <p>默认资格仅适用于对应服务项；移除额外项目资格不影响实施计划产生的默认资格。</p>
      <fieldset :disabled="participantBusy"><legend>新增或调整额外项目资格</legend>
        <label v-if="!manualSubject">人员稳定主体
          <select v-model="participantForm.subject_id" :disabled="personnelLoading">
            <option value="">请选择人员</option>
            <option v-for="person in personnelSelectOptions" :key="person.id" :value="person.id">{{ person.label }}</option>
          </select>
        </label>
        <label v-else>人员稳定主体ID<input v-model="participantForm.subject_id" maxlength="128" placeholder="手动输入权威主体ID"></label>
        <label><input v-model="manualSubject" type="checkbox"> 手动输入主体 ID</label>
        <div v-if="!manualSubject" class="pm-actions-bar">
          <input v-model="personnelKeyword" maxlength="64" placeholder="按姓名或工号搜索人员目录" @keyup.enter="loadPersonnel">
          <button class="pm-button" :disabled="personnelLoading" @click="loadPersonnel">{{ personnelLoading ? '查询中…' : '查询人员目录' }}</button>
        </div>
        <p v-if="personnelError" role="alert">{{ personnelError }}；可勾选“手动输入主体 ID”继续保存。</p>
        <p v-if="participantForm.subject_id && !manualSubject">已选主体：{{ personnelLabel(participantForm.subject_id) }}（{{ participantForm.subject_id }}）</p>
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
