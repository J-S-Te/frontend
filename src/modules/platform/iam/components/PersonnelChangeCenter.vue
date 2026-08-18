<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { createPersonnelChange, listPersonnelChanges, previewPersonnelChange, submitPersonnelChange } from '../api/personnelChanges.js'
import { listMemberships, listOrgUnits, listPositions, listUsers } from '../api/iam.js'
import { getApplicationAccess } from '../api/authorization.js'
import { listApplications } from '../../applications/api/applications.js'
import ConsoleIcon from '../../shared/components/ConsoleIcon.vue'

// 员工创建统一交由 PlatformConsoleView 持有的原子向导，人员异动中心只发起意图，
// 避免这里重新实现用户、账号、任职和岗位授权的非原子流程。
const emit = defineEmits(['toast', 'employee-onboarding'])
const loading = ref(false)
const saving = ref(false)
const error = ref('')
const showForm = ref(false)
const records = ref([])
const users = ref([])
const positions = ref([])
const organizations = ref([])
const memberships = ref([])
const membershipsLoading = ref(false)
const preview = ref(null)
const authorizationDetail = ref(null)
const authorizationLoading = ref(false)
const authorizationError = ref('')
const filters = reactive({ status: '', type: '', keyword: '' })
const form = reactive({ userId: '', type: 'TRANSFER', sourceMembershipId: '', targetOrgUnitId: '', targetPositionId: '', reason: '', approvalNo: '', effectiveDate: '' })

const typeOptions = [
  ['PROMOTION', '晋升'], ['DEMOTION', '降职'], ['TRANSFER', '调岗'], ['TERMINATION', '离职'], ['REHIRE', '复职'],
]
const statusLabels = { DRAFT: '草稿', PENDING_APPROVAL: '待审批', PENDING_HANDOVER: '待交接', SCHEDULED: '待生效', EXECUTED: '已执行', REJECTED: '已驳回', CANCELLED: '已取消' }
const typeLabel = (value) => typeOptions.find(([key]) => key === value)?.[1] || value || '—'

async function load() {
  loading.value = true; error.value = ''
  try { records.value = (await listPersonnelChanges(filters)).items } catch (e) { error.value = e.message || '加载异动单失败' } finally { loading.value = false }
}

async function openForm() {
  showForm.value = true; preview.value = null
  if (!users.value.length) {
    try { users.value = (await listUsers({ page: 1, pageSize: 100, status: 'ACTIVE' })).items } catch { /* 表单仍可手工填写用户 ID */ }
  }
  if (!positions.value.length) {
    try { positions.value = (await listPositions({ page: 1, pageSize: 100, status: 'ACTIVE' })).items } catch { /* optional catalog */ }
  }
  if (!organizations.value.length) {
    try { organizations.value = (await listOrgUnits({ page: 1, pageSize: 100, status: 'ACTIVE' })).items } catch { /* optional catalog */ }
  }
}

async function loadUserMemberships() {
  memberships.value = []
  form.sourceMembershipId = ''
  if (!form.userId) return
  membershipsLoading.value = true
  try {
    const result = await listMemberships({ page: 1, pageSize: 100, keyword: form.userId, status: 'ACTIVE' })
    memberships.value = result.items.filter((item) => String(item.user_id || item.user?.id || '') === String(form.userId))
  } catch (e) {
    error.value = e.message || '加载当前任职关系失败'
  } finally {
    membershipsLoading.value = false
  }
}

function resetForm() { Object.assign(form, { userId: '', type: 'TRANSFER', sourceMembershipId: '', targetOrgUnitId: '', targetPositionId: '', reason: '', approvalNo: '', effectiveDate: '' }); memberships.value = []; preview.value = null }

const sourceMembershipOptions = computed(() => memberships.value.filter((item) => String(item.status || 'ACTIVE').toUpperCase() === 'ACTIVE'))
const targetPositionOptions = computed(() => positions.value.filter((item) => {
  const organizationId = item.org_unit_id || item.organization_id || item.orgUnitId
  return !form.targetOrgUnitId || String(organizationId) === String(form.targetOrgUnitId)
}))
function organizationName(id) { return organizations.value.find((item) => String(item.id || item.org_unit_id) === String(id))?.name || id || '未指定组织' }
function positionName(id) { return positions.value.find((item) => String(item.id || item.position_id) === String(id))?.name || id || '未指定岗位' }
function membershipLabel(item) {
  const organizationId = item.org_unit_id || item.orgUnitId || item.organization_id
  const positionId = item.position_id || item.positionId
  return `${organizationName(organizationId)} / ${positionName(positionId)}${item.is_primary ? ' · 主组织' : ''}`
}

function onTargetOrganizationChange() {
  if (!targetPositionOptions.value.some((item) => String(item.id || item.position_id) === String(form.targetPositionId))) form.targetPositionId = ''
}

function payload() {
  return { user_id: form.userId, change_type: form.type, source_membership_id: form.sourceMembershipId || null, target_org_unit_id: form.targetOrgUnitId || null, target_position_id: form.targetPositionId || null, reason: form.reason, approval_reference: form.approvalNo || null, effective_at: form.effectiveDate ? `${form.effectiveDate}T00:00:00+08:00` : null }
}

async function loadPreview() {
  if (!form.userId || !form.type) return
  saving.value = true; error.value = ''
  try { preview.value = await previewPersonnelChange(payload()) } catch (e) { error.value = e.message || '权限影响预览失败' } finally { saving.value = false }
}

async function save() {
  if (!form.userId || !form.reason || !form.effectiveDate) { error.value = '请填写人员、原因和生效日期'; return }
  if (['PROMOTION', 'DEMOTION', 'TRANSFER'].includes(form.type) && (!form.sourceMembershipId || !form.targetOrgUnitId || !form.targetPositionId)) { error.value = '调岗、晋升和降职必须选择原任职、新组织和新岗位'; return }
  saving.value = true; error.value = ''
  try {
    await createPersonnelChange(payload())
    emit('toast', '人员异动单已保存'); showForm.value = false; resetForm(); await load()
  } catch (e) { error.value = e.message || '保存异动单失败' } finally { saving.value = false }
}

async function submit(id) {
  try { await submitPersonnelChange(id); emit('toast', '异动单已提交审批'); await load() } catch (e) { error.value = e.message || '提交审批失败' }
}

async function openAuthorization(item) {
  const userId = item?.user_id || item?.userId || item?.id
  if (!userId) return
  authorizationDetail.value = { userId, userName: item.user_name || item.display_name || userId, rows: [] }
  authorizationLoading.value = true
  authorizationError.value = ''
  try {
    const apps = (await listApplications({ page: 1, pageSize: 100, status: 'ACTIVE' })).items || []
    const settled = await Promise.allSettled(apps.map(async (app) => ({ app, access: await getApplicationAccess(userId, app.code) })))
    authorizationDetail.value.rows = settled.filter((entry) => entry.status === 'fulfilled').map((entry) => entry.value)
    if (!authorizationDetail.value.rows.length && apps.length) authorizationError.value = '暂时无法读取该人员的应用授权，请确认授权读取权限。'
  } catch (e) {
    authorizationError.value = e.message || '加载人员授权失败'
  } finally {
    authorizationLoading.value = false
  }
}

function closeAuthorization() {
  if (authorizationLoading.value) return
  authorizationDetail.value = null
  authorizationError.value = ''
}

function effectiveRoles(access) {
  return Array.isArray(access?.roles) ? access.roles : []
}

function roleSource(role) {
  const type = String(role?.source_type || role?.subject_type || '').toUpperCase()
  const origin = String(role?.grant_origin || role?.source_kind || '').toUpperCase()
  if (type === 'POSITION') return '岗位继承'
  if (type === 'ORG_UNIT') return '组织继承'
  if (origin === 'MANUAL' || type === 'USER' || !type) return '个人例外'
  return '系统同步'
}

function syncStatus(access) {
  const state = String(access?.authorization_state || '').toUpperCase()
  if (state === 'CONFLICT') return '冲突'
  if (state === 'GRANTED') return '已同步'
  return '未授权'
}

function userLabel(item) { return item?.display_name || item?.name || item?.user_id || item?.id || '' }
const visibleRecords = computed(() => records.value)
onMounted(load)
</script>

<template>
  <section class="console-card settings-card personnel-change-center">
    <div class="console-card-body">
      <div class="personnel-change-heading"><div><h2>人员工作台</h2><p class="console-card-hint">统一处理员工入职、晋升、降职、调岗、离职和复职，保留审批、交接及权限变更轨迹。</p></div><div class="personnel-change-heading-actions"><button class="console-button primary" type="button" @click="() => emit('employee-onboarding')"><ConsoleIcon name="user" />新增员工</button><button class="console-button ghost" type="button" @click="openForm"><ConsoleIcon name="plus" />新建异动单</button></div></div>
      <div class="personnel-change-filters"><input v-model="filters.keyword" placeholder="搜索人员或审批单号" @keyup.enter="load" /><select v-model="filters.type" @change="load"><option value="">全部类型</option><option v-for="[key, label] in typeOptions" :key="key" :value="key">{{ label }}</option></select><select v-model="filters.status" @change="load"><option value="">全部状态</option><option v-for="(label, key) in statusLabels" :key="key" :value="key">{{ label }}</option></select><button class="console-button ghost" type="button" :disabled="loading" @click="load">刷新</button></div>
      <p v-if="error" class="login-target-module__error" role="alert">{{ error }}</p>
      <p v-if="loading" class="console-card-hint">正在加载异动单…</p>
      <div v-else-if="!visibleRecords.length" class="settings-empty"><span class="settings-empty-icon"><ConsoleIcon name="organization" /></span><h3>暂无人员异动单</h3><p>新建异动单后，系统会在审批完成且到达生效日期时自动执行。</p></div>
      <div v-else class="personnel-change-table"><div class="personnel-change-row personnel-change-header"><span>人员</span><span>异动类型</span><span>组织 / 岗位变更</span><span>状态</span><span>生效日期</span><span>操作</span></div><div v-for="item in visibleRecords" :key="item.id || item.change_id" class="personnel-change-row"><span>{{ item.user_name || item.display_name || item.user_id || '—' }}</span><span>{{ typeLabel(item.change_type || item.type) }}</span><span><small>{{ item.source_membership_id || '当前任职' }}</small><strong>{{ organizationName(item.target_org_unit_id) }} / {{ positionName(item.target_position_id) }}</strong></span><span><span class="console-badge">{{ statusLabels[item.status] || item.status || '—' }}</span></span><span>{{ item.effective_at || item.effective_date || '—' }}</span><span class="personnel-change-actions"><button class="console-button compact" type="button" @click="openAuthorization(item)">授权概览</button><button v-if="item.status === 'DRAFT'" class="console-button compact" type="button" @click="submit(item.id || item.change_id)">提交审批</button></span></div></div>
    </div>
  </section>
  <div v-if="showForm" class="console-modal-backdrop" role="presentation" @click.self="showForm = false">
    <section class="console-detail-modal personnel-change-modal" role="dialog" aria-modal="true" aria-label="新建人员异动单"><header><div><p class="console-modal-eyebrow">PERSONNEL CHANGE</p><h2>新建人员异动单</h2></div><button class="console-modal-close" type="button" @click="showForm = false">×</button></header>
      <div class="console-form-grid"><label class="console-form-item"><span>人员 *</span><select v-model="form.userId" @change="loadUserMemberships"><option value="">请选择人员</option><option v-for="item in users" :key="item.id || item.user_id" :value="item.id || item.user_id">{{ userLabel(item) }}</option></select></label><label class="console-form-item"><span>异动类型 *</span><select v-model="form.type"><option v-for="[key, label] in typeOptions" :key="key" :value="key">{{ label }}</option></select></label><label class="console-form-item"><span>原任职 *</span><select v-model="form.sourceMembershipId" :disabled="!form.userId || membershipsLoading" :required="['PROMOTION', 'DEMOTION', 'TRANSFER'].includes(form.type)"><option value="">{{ membershipsLoading ? '正在读取任职…' : '请选择原组织 / 原岗位' }}</option><option v-for="item in sourceMembershipOptions" :key="item.membership_id || item.id" :value="item.membership_id || item.id">{{ membershipLabel(item) }}</option></select><small>必须选择真实任职关系，不能只选岗位。</small></label><label class="console-form-item"><span>新组织 *</span><select v-model="form.targetOrgUnitId" @change="onTargetOrganizationChange" :required="['PROMOTION', 'DEMOTION', 'TRANSFER'].includes(form.type)"><option value="">请选择目标组织</option><option v-for="item in organizations" :key="item.id || item.org_unit_id" :value="item.id || item.org_unit_id">{{ item.name }}</option></select></label><label class="console-form-item"><span>新岗位 *</span><select v-model="form.targetPositionId" :disabled="!form.targetOrgUnitId" :required="['PROMOTION', 'DEMOTION', 'TRANSFER'].includes(form.type)"><option value="">{{ form.targetOrgUnitId ? '请选择目标岗位' : '请先选择目标组织' }}</option><option v-for="item in targetPositionOptions" :key="item.id || item.position_id" :value="item.id || item.position_id">{{ item.name || item.position_name || item.code }}</option></select><small>只展示属于目标组织的有效岗位。</small></label><label class="console-form-item"><span>审批单号</span><input v-model="form.approvalNo" placeholder="可选" /></label><label class="console-form-item"><span>生效日期 *</span><input v-model="form.effectiveDate" type="date" /></label><label class="console-form-item full"><span>变更原因 *</span><textarea v-model="form.reason" rows="3" placeholder="填写业务原因、交接说明或复职依据" /></label></div>
      <div class="personnel-preview"><div class="personnel-preview-heading"><strong>权限影响预览</strong><button class="console-button ghost compact" type="button" :disabled="saving || !form.userId" @click="loadPreview">{{ saving ? '计算中…' : '生成预览' }}</button></div><div v-if="preview" class="personnel-preview-grid"><div><span>新增角色</span><strong>{{ (preview.added_roles || preview.added || []).length }} 项</strong></div><div><span>移除角色</span><strong>{{ (preview.removed_roles || preview.removed || []).length }} 项</strong></div><div><span>保留角色</span><strong>{{ (preview.kept_roles || preview.kept || []).length }} 项</strong></div></div><p v-else class="console-card-hint">提交前生成平台及子系统角色的新增、移除、保留清单。</p></div>
      <footer class="console-form-actions"><button class="console-button ghost" type="button" @click="showForm = false">取消</button><button class="console-button primary" type="button" :disabled="saving" @click="save">{{ saving ? '保存中…' : '保存异动单' }}</button></footer>
    </section>
  </div>
  <div v-if="authorizationDetail" class="console-modal-backdrop" role="presentation" @click.self="closeAuthorization">
    <section class="console-detail-modal personnel-authorization-modal" role="dialog" aria-modal="true" aria-label="人员授权概览">
      <header><div><p class="console-modal-eyebrow">PERSON AUTHORIZATION WORKBENCH</p><h2>{{ authorizationDetail.userName }} · 授权概览</h2><p class="console-card-hint">统一查看岗位继承、组织继承、个人例外及应用同步状态。</p></div><button class="console-modal-close" type="button" @click="closeAuthorization">×</button></header>
      <p v-if="authorizationError" class="login-target-module__error" role="alert">{{ authorizationError }}</p>
      <p v-if="authorizationLoading" class="console-card-hint">正在读取已接入应用的有效授权…</p>
      <div v-else-if="!authorizationDetail.rows.length" class="settings-empty"><h3>暂无应用授权</h3><p>该人员当前没有可展示的应用权限，或尚未同步应用角色目录。</p></div>
      <div v-else class="personnel-authorization-list">
        <article v-for="row in authorizationDetail.rows" :key="row.app.id || row.app.code" class="personnel-authorization-card">
          <div class="personnel-authorization-card-head"><div><strong>{{ row.app.name || row.app.code }}</strong><small class="console-mono">{{ row.app.code }}</small></div><span class="console-badge" :class="{ 'status-active': syncStatus(row.access) === '已同步', 'status-disabled': syncStatus(row.access) === '冲突' }">{{ syncStatus(row.access) }}</span></div>
          <p v-if="row.access?.authorization_error" class="iam-field-help">{{ row.access.authorization_error }}</p>
          <ul v-if="effectiveRoles(row.access).length" class="personnel-role-list"><li v-for="(role, index) in effectiveRoles(row.access)" :key="`${role.role_code || role.code}-${index}`"><span>{{ role.role_name || role.name || role.role_code || role.code }}</span><small>{{ roleSource(role) }}</small></li></ul><p v-else class="iam-empty-inline">该应用暂无生效角色。</p>
        </article>
      </div>
    </section>
  </div>
</template>

<style scoped>
.personnel-change-heading,.personnel-preview-heading{display:flex;align-items:center;justify-content:space-between;gap:1rem}.personnel-change-heading-actions{display:flex;gap:.5rem;flex-wrap:wrap}.personnel-change-filters{display:flex;gap:.65rem;margin:1rem 0;flex-wrap:wrap}.personnel-change-filters input,.personnel-change-filters select{min-width:10rem}.personnel-change-table{border:1px solid var(--console-border,#dbe5f2);border-radius:12px;overflow:auto}.personnel-change-row{display:grid;grid-template-columns:1.2fr 1fr 1fr 1fr 1.2fr 1.4fr;gap:.7rem;align-items:center;padding:.8rem 1rem;border-top:1px solid var(--console-border,#edf1f7);min-width:860px}.personnel-change-header{border-top:0;background:#f7faff;font-weight:600}.personnel-change-actions{display:flex;gap:.35rem;flex-wrap:wrap}.personnel-change-modal{max-width:820px}.personnel-change-modal .full{grid-column:1/-1}.personnel-preview{margin-top:1rem;padding:1rem;border-radius:10px;background:#f7faff}.personnel-preview-grid{display:flex;gap:2rem;margin-top:.8rem}.personnel-preview-grid span{display:block;color:#71829b;font-size:.85rem}.personnel-preview-grid strong{font-size:1.15rem}.compact{padding:.35rem .7rem;font-size:.85rem}.personnel-authorization-modal{max-width:900px}.personnel-authorization-list{display:grid;gap:.7rem;max-height:55vh;overflow:auto}.personnel-authorization-card{padding:1rem;border:1px solid var(--console-border,#dbe5f2);border-radius:12px;background:#fbfdff}.personnel-authorization-card-head{display:flex;justify-content:space-between;align-items:flex-start;gap:1rem}.personnel-authorization-card-head strong,.personnel-authorization-card-head small{display:block}.personnel-authorization-card-head small{margin-top:.2rem;color:#71829b}.personnel-role-list{list-style:none;padding:0;margin:.75rem 0 0;display:grid;gap:.4rem}.personnel-role-list li{display:flex;justify-content:space-between;gap:1rem;padding:.45rem .6rem;border-radius:8px;background:#f2f6fc}.personnel-role-list small{color:#5b75a0;white-space:nowrap}
</style>
