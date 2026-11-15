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

const participants = ref([])
const implementationParticipants = ref([])
const implementationCursor = ref('')
const participantCursor = ref('')
const participantError = ref('')
const participantNotice = ref('')
const participantBusy = ref(false)
const showAdd = ref(false)
const personnelOptions = ref([])
const personnelNames = ref({})
const personnelKeyword = ref('')
const personnelLoading = ref(false)
const personnelError = ref('')
const exceptionForm = ref({ subject_id: '', valid_until: defaultUntilDate(), reason: '项目费用协作' })
const canManage = computed(() => props.session?.permissions?.includes('project.expense_participant.manage') === true)
const canRead = computed(() => props.session?.permissions?.includes('project.reimbursement_spend.read') === true)
let sequence = 0
let participantSequence = 0
let participantContext = 0
let personnelSequence = 0

const today = todayBusinessDate()
const activeExceptions = computed(() => participants.value.filter((person) => person.status === 'ACTIVE'))

// 用途：把实施人员自动资格与项目例外合并成一张可核对的资格表。
// 自动资格来自服务端 implementation_participants，不要求人工再次登记。
const eligibilityRows = computed(() => {
  const rows = new Map()
  for (const person of implementationParticipants.value || []) {
    const id = String(person?.subject_id || '').trim()
    if (!id) continue
    rows.set(id, { ...person, subject_id: id, display_name: person.display_name || personnelNames.value[person.subject_id] || id, sourceLabel: '实施计划', explicit: false })
  }
  for (const person of participants.value || []) {
    const id = String(person?.subject_id || '').trim()
    if (!id) continue
    rows.set(id, { ...person, subject_id: id, display_name: person.display_name || personnelNames.value[person.subject_id] || id, sourceLabel: '项目例外', explicit: true })
  }
  return [...rows.values()]
})

function defaultUntilDate() {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(new Date(Date.now() + 365 * 86400000))
}

// 用途：读取当前项目的最小报销金额摘要，保持独立错误状态。
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

function money(value) {
  if (typeof value !== 'string' || !/^-?\d+$/.test(value)) return '不可用'
  const amount = BigInt(value)
  const abs = amount < 0n ? -amount : amount
  return `${amount < 0n ? '-' : ''}${abs / 100n}.${String(abs % 100n).padStart(2, '0')}`
}

function openReimbursement(create = false, claimID = '') {
  if (!compiled || (create && !canCreate.value)) return
  router.push({ name: 'reimbursement', params: { section: 'claims' },
    query: { ...(props.projectId ? { project_id: props.projectId } : {}), ...(create ? { create: '1' } : {}), ...(claimID ? { claim_id: claimID } : {}) } })
}

// 用途：读取项目例外和实施人员自动资格，分别保留各自分页。
// 参数：next 为例外翻页，implementationNext 为自动资格翻页。
// 返回值：无；权限撤销或会话切换后迟到的旧响应不写回。
async function loadParticipants(next = false, implementationNext = false) {
  if (!props.projectId || !canManage.value) return
  const ticket = ++participantSequence
  const project = props.projectId
  participantBusy.value = true
  participantError.value = ''
  try {
    const result = await getProjectExpenseParticipants(project,
      next ? participantCursor.value : '', implementationNext ? implementationCursor.value : '')
    if (ticket !== participantSequence || project !== props.projectId) return
    if (!Array.isArray(result.items)) throw new Error('例外名单响应不完整')
    if (!implementationNext) {
      participants.value = next ? [...participants.value, ...result.items] : result.items
      participantCursor.value = result.items.length === 20 ? result.items.at(-1).subject_id : ''
    }
    const page = result.implementation_participants
    if (!Array.isArray(page?.items)) throw new Error('项目服务未返回实施人员默认资格，请确认服务版本后重试')
    implementationParticipants.value = implementationNext
      ? [...implementationParticipants.value, ...page.items] : page.items
    implementationCursor.value = page.next_cursor || ''
    const names = { ...personnelNames.value }
    for (const person of page.items) {
      if (person?.subject_id && person.display_name) names[person.subject_id] = person.display_name
    }
    personnelNames.value = names
  } catch (cause) {
    if (ticket === participantSequence) participantError.value = cause.message || '参与名单暂不可用'
  } finally { if (ticket === participantSequence) participantBusy.value = false }
}

// 用途：只在展开例外表单时按关键词读取人员目录，避免打开项目就请求全量人员。
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

function toggleAdd() {
  showAdd.value = !showAdd.value
  if (showAdd.value) void loadPersonnel()
}

// 用途：以最小表单新增例外人员；默认今天生效、最长一年，不要求主体 ID/版本/状态。
async function addException() {
  if (!props.projectId || participantBusy.value || !canManage.value) return
  const project = props.projectId
  const context = participantContext
  participantBusy.value = true
  participantError.value = ''
  participantNotice.value = ''
  try {
    await putProjectExpenseParticipant(project, {
      subject_id: exceptionForm.value.subject_id,
      valid_from: `${today}T00:00`,
      valid_until: `${exceptionForm.value.valid_until || defaultUntilDate()}T23:59`,
      reason: exceptionForm.value.reason.trim() || '项目费用协作',
      version: 0,
    })
    if (context !== participantContext) return
    exceptionForm.value = { subject_id: '', valid_until: defaultUntilDate(), reason: '项目费用协作' }
    participantNotice.value = '例外人员已添加；报销项目选项会自动生效。'
    await loadParticipants()
  } catch (cause) {
    if (context === participantContext) participantError.value = cause.message || '添加例外失败'
  } finally { if (context === participantContext) participantBusy.value = false }
}

// 用途：按当前版本移除例外人员；历史保留，自动资格不受影响。
async function removeException(row) {
  if (!props.projectId || participantBusy.value || !canManage.value || !row?.person) return
  const context = participantContext
  participantBusy.value = true
  participantError.value = ''
  participantNotice.value = ''
  try {
    await putProjectExpenseParticipant(props.projectId, {
      subject_id: row.subject_id, version: row.person.version,
      valid_from: '', valid_until: '', reason: '移除项目例外',
    }, true)
    if (context !== participantContext) return
    participantNotice.value = '例外人员已移除；历史仍保留。'
    await loadParticipants()
  } catch (cause) {
    if (context === participantContext) participantError.value = cause.message || '移除例外失败'
  } finally { if (context === participantContext) participantBusy.value = false }
}

watch(() => [props.projectId, props.session?.tenant_id, props.session?.user_id,
  canRead.value, canManage.value], () => {
  ++participantContext
  ++participantSequence
  participantBusy.value = false
  ++sequence
  rows.value = null
  cursor.value = ''
  error.value = ''
  participants.value = []
  implementationParticipants.value = []
  implementationCursor.value = ''
  participantCursor.value = ''
  participantError.value = ''
  participantNotice.value = ''
  showAdd.value = false
  exceptionForm.value = { subject_id: '', valid_until: defaultUntilDate(), reason: '项目费用协作' }
  ++personnelSequence
  personnelOptions.value = []
  personnelNames.value = {}
  personnelKeyword.value = ''
  personnelError.value = ''
  personnelLoading.value = false
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
        <p class="pm-panel-kicker">费用协作</p>
        <h2>{{ projectId ? '相关报销与项目支出' : '费用资格与报销入口' }}</h2>
      </div>
    </header>
    <p v-if="!projectId">当前会话不含项目工作区读取能力。费用参与资格请进入报销系统按权威项目选项查询。</p>
    <div class="pm-actions-bar">
      <template v-if="compiled">
        <button class="pm-button" @click="openReimbursement(false)">相关报销</button>
        <button class="pm-button" :disabled="!canCreate" @click="openReimbursement(true)">新建报销</button>
      </template>
      <span v-else>当前发行未包含报销模块</span>
      <button v-if="projectId && canRead" class="pm-button" :disabled="loading" @click="load(false)">
        {{ loading ? '读取中…' : '查询报销支出' }}
      </button>
    </div>
    <p v-if="projectId && !canCreate">项目进入报告编制或已完成后可新建报销；已有报销仍可查询。</p>
    <p v-if="projectId && !canRead">当前账号未获项目报销支出查看权限。</p>
    <p v-if="error" role="alert">{{ error }}</p>
    <div v-if="rows" class="pm-table-scroll">
      <table class="pm-table">
        <thead><tr><th scope="col">来源单号</th><th scope="col">本项目已付净额</th><th scope="col">费用类别（本项目净额）</th><th scope="col">最近付款时间</th><th scope="col">币种</th><th scope="col">投影版本</th><th scope="col">同步时间</th></tr></thead>
        <tbody>
          <tr v-for="row in rows" :key="row.claim_id">
            <td><button v-if="compiled" class="pm-link" @click="openReimbursement(false,row.claim_id)">{{ row.claim_no }}</button><span v-else>{{ row.claim_no }}</span></td>
            <td>{{ money(row.paid_net_minor) }}</td>
            <td><p v-for="category in row.fee_categories || []" :key="category.fee_type">{{ category.fee_type }}：{{ money(category.paid_net_minor) }} 元</p></td>
            <td>{{ row.last_payment_occurred_at ? formatBusinessDateTime(row.last_payment_occurred_at) : '未记录' }}</td>
            <td>{{ row.currency }}</td><td>{{ row.projection_revision }}</td><td>{{ row.updated_at }}</td>
          </tr>
          <tr v-if="!rows.length"><td colspan="7">本项目暂无已同步的报销支出</td></tr>
        </tbody>
      </table>
      <button v-if="cursor" class="pm-button" :disabled="loading" @click="load(true)">下一页</button>
    </div>

    <section v-if="projectId && canManage" class="pm-expense-eligibility" aria-label="项目费用参与资格">
      <div class="pm-expense-eligibility__head">
        <div>
          <h3>例外人员</h3>
          <p>项目负责人、服务项负责人和实施人员由项目角色自动判定，无需在此维护；本表只维护额外例外人员。</p>
        </div>
        <div class="pm-actions-bar">
          <button class="pm-button" :disabled="participantBusy" @click="loadParticipants()">{{ participantBusy ? '读取中…' : '刷新' }}</button>
          <button class="pm-button" @click="toggleAdd">{{ showAdd ? '收起例外' : '添加例外' }}</button>
        </div>
      </div>
      <p class="pm-expense-eligibility__summary">当前例外 {{ activeExceptions.length }} 人；实施人员自动资格 {{ implementationParticipants.length }} 人，二者合并展示但不重复写入。</p>
      <div v-if="implementationParticipants.length" class="pm-expense-defaults">
        <h4>实施人员自动资格</h4>
        <p>由服务端实施计划和项目角色自动判定，不需要人工再次登记；打开面板不会拉取全员目录。</p>
        <ul>
          <li v-for="person in implementationParticipants" :key="person.subject_id">{{ person.display_name || personnelNames[person.subject_id] || person.subject_id }}<small v-if="person.service_item_id"> · 服务项 {{ person.service_item_id }}</small></li>
        </ul>
        <button v-if="implementationCursor" class="pm-button" :disabled="participantBusy" @click="loadParticipants(false, true)">更多自动资格</button>
      </div>
      <p v-if="participantError" role="alert">{{ participantError }}</p>
      <p v-if="participantNotice" role="status">{{ participantNotice }}</p>
      <div class="pm-table-scroll">
        <table class="pm-table">
          <thead><tr><th scope="col">人员</th><th scope="col">有效期（北京时间）</th><th scope="col">状态</th><th scope="col">操作</th></tr></thead>
          <tbody>
            <tr v-for="person in activeExceptions" :key="person.subject_id">
              <td>{{ personnelNames[person.subject_id] || person.subject_id }}<br><small v-if="personnelNames[person.subject_id]">{{ person.subject_id }}</small></td>
              <td>{{ formatBusinessDateTime(person.valid_from) }} 至 {{ formatBusinessDateTime(person.valid_until) }}</td>
              <td>生效中</td>
              <td><button class="pm-link" :disabled="participantBusy" @click="removeException({ subject_id: person.subject_id, person })">移除</button></td>
            </tr>
            <tr v-if="!activeExceptions.length"><td colspan="4">当前没有额外例外人员；自动资格无需维护。</td></tr>
          </tbody>
        </table>
      </div>
      <button v-if="participantCursor" class="pm-button" :disabled="participantBusy" @click="loadParticipants(true)">更多例外</button>

      <div v-if="showAdd" class="pm-expense-form">
        <label>人员
          <select v-model="exceptionForm.subject_id" :disabled="participantBusy || personnelLoading">
            <option value="">请选择人员</option>
            <option v-for="person in personnelOptions" :key="person.id" :value="person.id">{{ person.name }}</option>
          </select>
        </label>
        <label>截止日期
          <input v-model="exceptionForm.valid_until" type="date" :min="today">
        </label>
        <label>原因
          <input v-model="exceptionForm.reason" maxlength="200" placeholder="例如：项目售前支持">
        </label>
        <button class="pm-button" :disabled="participantBusy || !exceptionForm.subject_id" @click="addException">添加</button>
      </div>
      <div v-if="showAdd" class="pm-actions-bar">
        <input v-model="personnelKeyword" maxlength="64" placeholder="按姓名或工号搜索人员目录" @keyup.enter="loadPersonnel">
        <button class="pm-button" :disabled="personnelLoading" @click="loadPersonnel">{{ personnelLoading ? '查询中…' : '搜索人员' }}</button>
        <span>默认今天生效、最长一年；人员目录不可用时暂不能添加。</span>
      </div>
      <p v-if="personnelError" role="alert">{{ personnelError }}</p>
    </section>
  </section>
</template>

<style scoped>
.pm-expense-eligibility{margin-top:28px;padding-top:20px;border-top:1px solid var(--pm-border)}
.pm-expense-eligibility__head{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap}
.pm-expense-eligibility h3{margin:0 0 6px}
.pm-expense-eligibility__summary{color:var(--pm-muted);margin:10px 0 12px}.pm-expense-defaults{margin:10px 0 16px;padding:12px;border:1px solid var(--pm-border);border-radius:8px;background:var(--pm-surface,#f8fafc)}.pm-expense-defaults h4{margin:0 0 6px}.pm-expense-defaults p{margin:0 0 8px;color:var(--pm-muted)}.pm-expense-defaults ul{margin:0;padding-inline-start:18px}
.pm-expense-form{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;align-items:end;margin-top:14px}
.pm-expense-form label{display:grid;gap:6px}
</style>
