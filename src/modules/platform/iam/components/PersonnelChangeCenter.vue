<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { createPersonnelChange, listPersonnelChanges, previewPersonnelChange } from '../api/personnelChanges.js'
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
const form = reactive({ userId: '', type: 'TRANSFER', sourceMembershipId: '', targetOrgUnitId: '', targetPositionId: '', reason: '', effectiveDate: '' })

const typeOptions = [
  ['PROMOTION', '晋升'], ['DEMOTION', '降职'], ['TRANSFER', '调岗'], ['TERMINATION', '离职'], ['REHIRE', '复职'],
]
// 新配置由管理员直接生效排期；保留旧状态仅用于兼容历史数据，但不再向用户呈现审批语义。
const statusLabels = { DRAFT: '待配置', PENDING_APPROVAL: '待处理', PENDING_HANDOVER: '待交接', SCHEDULED: '待生效', EXECUTED: '已执行', REJECTED: '已关闭', CANCELLED: '已取消' }
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

function resetForm() { Object.assign(form, { userId: '', type: 'TRANSFER', sourceMembershipId: '', targetOrgUnitId: '', targetPositionId: '', reason: '', effectiveDate: '' }); memberships.value = []; preview.value = null }

const sourceMembershipOptions = computed(() => memberships.value.filter((item) => String(item.status || 'ACTIVE').toUpperCase() === 'ACTIVE'))
const targetPositionOptions = computed(() => positions.value.filter((item) => {
  const organizationId = item.org_unit_id || item.organization_id || item.orgUnitId
  return !form.targetOrgUnitId || String(organizationId) === String(form.targetOrgUnitId)
}))
function organizationName(id) { return organizations.value.find((item) => String(item.id || item.org_unit_id) === String(id))?.name || id || '未指定组织' }
function positionName(id) { return positions.value.find((item) => String(item.id || item.position_id) === String(id))?.name || id || '未指定岗位' }
function membershipLabel(item) {
  // /memberships 返回的是 user/org_unit/position 嵌套引用，兼容旧版平铺字段，
  // 避免原任职下拉只拿 ID 但无法展示当前中文组织和岗位。
  const organization = item.org_unit || item.organization || {}
  const position = item.position || {}
  const organizationId = item.org_unit_id || item.orgUnitId || item.organization_id || organization.id || organization.org_unit_id
  const positionId = item.position_id || item.positionId || position.id || position.position_id
  const organizationLabel = organization.name || organizationName(organizationId)
  const positionLabel = position.name || positionName(positionId)
  return `${organizationLabel} / ${positionLabel}${item.is_primary ? ' · 主组织' : ''}`
}

function onTargetOrganizationChange() {
  if (!targetPositionOptions.value.some((item) => String(item.id || item.position_id) === String(form.targetPositionId))) form.targetPositionId = ''
}

function payload() {
  return { user_id: form.userId, change_type: form.type, source_membership_id: form.sourceMembershipId || null, target_org_unit_id: form.targetOrgUnitId || null, target_position_id: form.targetPositionId || null, reason: form.reason, effective_at: form.effectiveDate ? `${form.effectiveDate}T00:00:00+08:00` : null }
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
    emit('toast', '人员异动配置已保存'); showForm.value = false; resetForm(); await load()
  } catch (e) { error.value = e.message || '保存异动单失败' } finally { saving.value = false }
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
function statusTone(value) {
  return {
    DRAFT: 'status-draft',
    PENDING_APPROVAL: 'status-pending',
    PENDING_HANDOVER: 'status-handover',
    SCHEDULED: 'status-scheduled',
    EXECUTED: 'status-executed',
    REJECTED: 'status-rejected',
    CANCELLED: 'status-cancelled',
  }[value] || 'status-neutral'
}
const summaryCards = computed(() => [
  { key: 'total', label: '全部异动单', value: records.value.length, hint: '当前筛选范围', icon: 'organization', tone: 'violet' },
  { key: 'scheduled', label: '待生效', value: records.value.filter((item) => item.status === 'SCHEDULED').length, hint: '按日期自动执行', icon: 'dashboard', tone: 'blue' },
  { key: 'executed', label: '已执行', value: records.value.filter((item) => item.status === 'EXECUTED').length, hint: '已完成变更', icon: 'save', tone: 'green' },
  { key: 'cancelled', label: '已取消', value: records.value.filter((item) => item.status === 'CANCELLED').length, hint: '已停止执行', icon: 'close', tone: 'orange' },
])
const visibleRecords = computed(() => records.value)
onMounted(load)
</script>

<template>
  <section class="console-card settings-card personnel-change-center">
    <div class="console-card-body">
      <div class="personnel-change-hero">
        <div class="personnel-change-hero-copy">
          <div class="iam-section-kicker"><span class="personnel-change-kicker-icon"><ConsoleIcon name="organization" /></span>PERSONNEL LIFECYCLE</div>
          <div><h2>人员异动中心</h2><p class="console-card-hint">由管理员统一配置员工入职、晋升、降职、调岗、离职和复职，按生效日期执行并保留权限变更轨迹。</p></div>
        </div>
        <div class="personnel-change-heading-actions"><button class="console-button secondary" type="button" @click="() => emit('employee-onboarding')"><ConsoleIcon name="user" />新增员工</button><button class="console-button primary" type="button" @click="openForm"><ConsoleIcon name="save" />新建异动单</button></div>
      </div>
      <div class="personnel-change-summary" aria-label="异动概览"><article v-for="card in summaryCards" :key="card.key" class="personnel-summary-card" :class="`tone-${card.tone}`"><span class="personnel-summary-icon"><ConsoleIcon :name="card.icon" /></span><div><span class="personnel-summary-label">{{ card.label }}</span><strong>{{ card.value }}</strong><small>{{ card.hint }}</small></div></article></div>
      <div class="personnel-change-flow" aria-label="人员异动流程"><div class="personnel-flow-title"><strong>管理员配置流程</strong><small>配置完成后按生效日期自动执行</small></div><ol><li><b>01</b><span>选择人员与任职</span></li><li><b>02</b><span>配置目标组织岗位</span></li><li><b>03</b><span>确认权限影响</span></li><li><b>04</b><span>按期生效</span></li></ol></div>
      <div class="personnel-change-toolbar"><label class="personnel-change-search"><ConsoleIcon name="search" /><input v-model="filters.keyword" placeholder="搜索人员或异动编号" @keyup.enter="load" /></label><label class="personnel-change-select"><span>类型</span><select v-model="filters.type" @change="load"><option value="">全部类型</option><option v-for="[key, label] in typeOptions" :key="key" :value="key">{{ label }}</option></select></label><label class="personnel-change-select"><span>状态</span><select v-model="filters.status" @change="load"><option value="">全部状态</option><option v-for="(label, key) in statusLabels" :key="key" :value="key">{{ label }}</option></select></label><button class="console-button secondary" type="button" :disabled="loading" @click="load"><ConsoleIcon name="reset" />刷新</button></div>
      <p v-if="error" class="login-target-module__error" role="alert">{{ error }}</p>
      <div v-if="loading" class="personnel-change-loading"><span class="personnel-loading-dot" />正在加载异动单…</div>
      <div v-else-if="!visibleRecords.length" class="settings-empty"><span class="settings-empty-icon"><ConsoleIcon name="organization" /></span><h3>暂无人员异动配置</h3><p>管理员创建异动配置后，系统会按生效日期自动执行。</p></div>
      <div v-else class="personnel-change-table-shell"><div class="personnel-change-table"><div class="personnel-change-row personnel-change-header"><span>人员</span><span>异动类型</span><span>组织 / 岗位变更</span><span>状态</span><span>生效日期</span><span>操作</span></div><div v-for="item in visibleRecords" :key="item.id || item.change_id" class="personnel-change-row"><span class="personnel-change-person"><span class="personnel-person-avatar">{{ userLabel(item).slice(0, 1) || '?' }}</span><span><strong>{{ userLabel(item) || '—' }}</strong><small class="console-mono">{{ item.user_id || item.userId || '人员信息' }}</small></span></span><span><span class="personnel-change-type">{{ typeLabel(item.change_type || item.type) }}</span><small class="personnel-change-code console-mono">{{ item.change_type || item.type || '—' }}</small></span><span class="personnel-change-move"><small>目标任职</small><strong>{{ organizationName(item.target_org_unit_id) }} / {{ positionName(item.target_position_id) }}</strong></span><span><span class="console-badge" :class="statusTone(item.status)">{{ statusLabels[item.status] || item.status || '—' }}</span></span><span class="personnel-change-date">{{ item.effective_at || item.effective_date || '—' }}</span><span class="personnel-change-actions"><button class="console-button compact" type="button" @click="openAuthorization(item)">授权概览</button></span></div></div></div>
    </div>
  </section>
  <div v-if="showForm" class="console-modal-backdrop" role="presentation" @click.self="showForm = false">
    <section class="console-detail-modal personnel-change-modal" role="dialog" aria-modal="true" aria-label="新建人员异动单"><header class="personnel-change-modal-header"><div><p class="console-modal-eyebrow"><span class="personnel-modal-eyebrow-icon"><ConsoleIcon name="organization" /></span>PERSONNEL CHANGE</p><h2>新建人员异动单</h2><p>管理员配置人员变更，确认后按生效日期自动执行。</p></div><button class="console-modal-close" type="button" aria-label="关闭新建人员异动单" @click="showForm = false">×</button></header>
      <div class="personnel-change-modal-body"><div class="personnel-change-form-intro"><span class="personnel-change-form-intro-icon"><ConsoleIcon name="info" /></span><div><strong>管理员直接配置，无需审批</strong><p>原任职用于确认当前关系，目标组织和岗位用于计算后续权限影响。</p></div></div>
      <div class="console-form-grid personnel-change-form-grid">
        <label class="console-form-item"><span>人员 *</span><select v-model="form.userId" @change="loadUserMemberships"><option value="">请选择人员</option><option v-for="item in users" :key="item.id || item.user_id" :value="item.id || item.user_id">{{ userLabel(item) }}</option></select></label>
        <label class="console-form-item"><span>异动类型 *</span><select v-model="form.type"><option v-for="[key, label] in typeOptions" :key="key" :value="key">{{ label }}</option></select></label>
        <label class="console-form-item"><span>原任职 *</span><select v-model="form.sourceMembershipId" :disabled="!form.userId || membershipsLoading" :required="['PROMOTION', 'DEMOTION', 'TRANSFER'].includes(form.type)"><option value="">{{ membershipsLoading ? '正在读取任职…' : '请选择原组织 / 原岗位' }}</option><option v-for="item in sourceMembershipOptions" :key="item.membership_id || item.id" :value="item.membership_id || item.id">{{ membershipLabel(item) }}</option></select><small>必须选择真实任职关系，不能只选岗位。</small></label>
        <label class="console-form-item"><span>新组织 *</span><select v-model="form.targetOrgUnitId" @change="onTargetOrganizationChange" :required="['PROMOTION', 'DEMOTION', 'TRANSFER'].includes(form.type)"><option value="">请选择目标组织</option><option v-for="item in organizations" :key="item.id || item.org_unit_id" :value="item.id || item.org_unit_id">{{ item.name }}</option></select></label>
        <label class="console-form-item"><span>新岗位 *</span><select v-model="form.targetPositionId" :disabled="!form.targetOrgUnitId" :required="['PROMOTION', 'DEMOTION', 'TRANSFER'].includes(form.type)"><option value="">{{ form.targetOrgUnitId ? '请选择目标岗位' : '请先选择目标组织' }}</option><option v-for="item in targetPositionOptions" :key="item.id || item.position_id" :value="item.id || item.position_id">{{ item.name || item.position_name || item.code }}</option></select><small>只展示属于目标组织的有效岗位。</small></label>
        <label class="console-form-item"><span>生效日期 *</span><input v-model="form.effectiveDate" type="date" /></label>
        <label class="console-form-item full"><span>变更原因 *</span><textarea v-model="form.reason" rows="3" placeholder="填写业务原因、交接说明或复职依据" /></label>
      </div>
      <div class="personnel-preview"><div class="personnel-preview-heading"><div><strong>权限影响预览</strong><p>确认岗位与组织变化带来的角色新增、移除和保留范围。</p></div><button class="console-button secondary compact" type="button" :disabled="saving || !form.userId" @click="loadPreview"><ConsoleIcon name="audit" />{{ saving ? '计算中…' : '生成预览' }}</button></div><div v-if="preview" class="personnel-preview-grid"><div class="preview-added"><span>新增角色</span><strong>{{ (preview.added_roles || preview.added || []).length }} 项</strong></div><div class="preview-removed"><span>移除角色</span><strong>{{ (preview.removed_roles || preview.removed || []).length }} 项</strong></div><div class="preview-kept"><span>保留角色</span><strong>{{ (preview.kept_roles || preview.kept || []).length }} 项</strong></div></div><p v-else class="console-card-hint">保存前生成平台及子系统角色的新增、移除、保留清单。</p></div></div>
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
.personnel-change-center > .console-card-body { padding: 0; }
.personnel-change-hero { display: flex; justify-content: space-between; gap: 2rem; padding: 1.75rem 1.9rem 1.55rem; background: linear-gradient(135deg, #f8fbff 0%, #eef5ff 100%); border-bottom: 1px solid var(--line-soft, #e5edf7); }
.personnel-change-hero-copy { display: grid; gap: .75rem; min-width: 0; }
.personnel-change-hero h2 { margin: 0; color: var(--text, #18253a); font-size: 1.55rem; letter-spacing: -.02em; }
.personnel-change-hero p { max-width: 720px; margin: .45rem 0 0; line-height: 1.65; }
.iam-section-kicker { display: inline-flex; align-items: center; gap: .5rem; color: var(--muted, #6f8098); font-size: .72rem; font-weight: 750; letter-spacing: .12em; }
.personnel-change-kicker-icon { display: inline-grid; place-items: center; width: 1.65rem; height: 1.65rem; color: #496fd0; background: #dfe9ff; border-radius: .55rem; }
.personnel-change-heading-actions { display: flex; align-items: center; gap: .6rem; flex-wrap: wrap; align-self: center; }
.personnel-change-heading-actions .console-button { white-space: nowrap; }
.personnel-change-summary { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: .85rem; padding: 1.25rem 1.9rem; }
.personnel-summary-card { display: flex; align-items: center; gap: .8rem; min-width: 0; padding: 1rem 1.05rem; border: 1px solid var(--line-soft, #e5edf7); border-radius: .8rem; background: var(--card, #fff); box-shadow: 0 4px 16px rgba(44, 71, 120, .045); }
.personnel-summary-icon { display: grid; flex: 0 0 auto; place-items: center; width: 2.35rem; height: 2.35rem; border-radius: .7rem; }
.personnel-summary-card > div { display: grid; gap: .12rem; min-width: 0; }
.personnel-summary-label, .personnel-summary-card small { color: var(--muted, #71829b); font-size: .78rem; }
.personnel-summary-card strong { color: var(--text, #18253a); font-size: 1.45rem; line-height: 1.1; }
.personnel-summary-card.tone-violet .personnel-summary-icon { color: #6e52c7; background: #eee9ff; }
.personnel-summary-card.tone-orange .personnel-summary-icon { color: #bd6b19; background: #fff0dc; }
.personnel-summary-card.tone-blue .personnel-summary-icon { color: #3c70c9; background: #e4efff; }
.personnel-summary-card.tone-green .personnel-summary-icon { color: #25835a; background: #e2f6eb; }
.personnel-change-flow { margin: 0 1.9rem 1.2rem; padding: 1rem 1.1rem; border: 1px solid var(--line-soft, #e5edf7); border-radius: .8rem; background: var(--sunken, #f8fafc); }
.personnel-flow-title { display: flex; align-items: baseline; justify-content: space-between; gap: 1rem; margin-bottom: .8rem; }
.personnel-flow-title strong { color: var(--text, #263650); font-size: .9rem; }
.personnel-flow-title small { color: var(--muted, #71829b); }
.personnel-change-flow ol { display: grid; grid-template-columns: repeat(4, 1fr); gap: .75rem; margin: 0; padding: 0; list-style: none; }
.personnel-change-flow li { display: flex; align-items: center; gap: .55rem; color: var(--secondary, #52647d); font-size: .82rem; }
.personnel-change-flow li:not(:last-child)::after { content: '→'; margin-left: auto; color: #a8b8cc; }
.personnel-change-flow b { display: grid; place-items: center; width: 1.65rem; height: 1.65rem; color: #496fd0; background: #e4edff; border-radius: 50%; font-size: .68rem; }
.personnel-change-toolbar { display: flex; align-items: end; gap: .65rem; margin: 0 1.9rem 1rem; padding: .75rem; border: 1px solid var(--line-soft, #e5edf7); border-radius: .75rem; background: var(--card, #fff); }
.personnel-change-search, .personnel-change-select { display: grid; gap: .28rem; }
.personnel-change-search { position: relative; flex: 1 1 20rem; }
.personnel-change-search > svg { position: absolute; left: .75rem; bottom: .65rem; color: var(--muted, #71829b); }
.personnel-change-search input { padding-left: 2.2rem; }
.personnel-change-select { flex: 0 1 10rem; }
.personnel-change-select span { color: var(--muted, #71829b); font-size: .72rem; }
.personnel-change-toolbar input, .personnel-change-toolbar select { width: 100%; min-height: 2.25rem; border: 1px solid var(--line-soft, #dce6f2); border-radius: .5rem; background: var(--sunken, #f8fafc); }
.personnel-change-toolbar input:focus, .personnel-change-toolbar select:focus { border-color: #7da3e8; box-shadow: 0 0 0 3px rgba(83, 129, 211, .12); outline: 0; }
.personnel-change-toolbar .console-button { min-height: 2.25rem; white-space: nowrap; }
.personnel-change-loading { display: flex; align-items: center; justify-content: center; gap: .55rem; min-height: 12rem; margin: 0 1.9rem 1.9rem; color: var(--muted, #71829b); }
.personnel-loading-dot { width: .55rem; height: .55rem; border-radius: 50%; background: #6e91dc; box-shadow: .85rem 0 #b8c9ea, 1.7rem 0 #e0e8f7; margin-right: 1.7rem; }
.personnel-change-center > .console-card-body > .settings-empty { margin: 0 1.9rem 1.9rem; border: 1px dashed var(--line-strong, #ccd8e8); border-radius: .8rem; }
.personnel-change-table-shell { margin: 0 1.9rem 1.9rem; overflow: hidden; border: 1px solid var(--line-soft, #e0e8f2); border-radius: .8rem; background: var(--card, #fff); }
.personnel-change-table { overflow-x: auto; }
.personnel-change-row { display: grid; grid-template-columns: 1.25fr .95fr 1.55fr .85fr 1.1fr 1.55fr; gap: .8rem; align-items: center; min-width: 920px; padding: .85rem 1rem; border-top: 1px solid var(--line-soft, #edf1f7); }
.personnel-change-row:first-child { border-top: 0; }
.personnel-change-header { color: var(--muted, #71829b); background: var(--sunken, #f8fafc); font-size: .74rem; font-weight: 700; }
.personnel-change-row:not(.personnel-change-header):hover { background: #fbfdff; }
.personnel-change-person, .personnel-change-person > span:last-child, .personnel-change-move { display: grid; gap: .18rem; min-width: 0; }
.personnel-change-person { display: flex; align-items: center; gap: .65rem; }
.personnel-person-avatar { display: grid; flex: 0 0 auto; place-items: center; width: 2rem; height: 2rem; color: #496fd0; background: #e4edff; border-radius: .65rem; font-weight: 750; }
.personnel-change-person strong, .personnel-change-move strong { overflow: hidden; color: var(--text, #263650); font-size: .84rem; text-overflow: ellipsis; white-space: nowrap; }
.personnel-change-person small, .personnel-change-move small, .personnel-change-code { color: var(--muted, #8190a5); font-size: .7rem; }
.personnel-change-type { color: var(--text, #34445d); font-weight: 650; }
.personnel-change-date { color: var(--secondary, #52647d); font-size: .8rem; }
.personnel-change-actions { display: flex; gap: .4rem; flex-wrap: wrap; }
.compact { min-height: 2rem; padding: .35rem .68rem; font-size: .75rem; }
.console-badge.status-draft, .console-badge.status-neutral, .console-badge.status-cancelled { color: #63748b; background: #edf1f5; }
.console-badge.status-pending { color: #a36213; background: #fff0d8; }
.console-badge.status-handover { color: #7351a9; background: #f0e9ff; }
.console-badge.status-scheduled { color: #2f65b4; background: #e6f0ff; }
.console-badge.status-executed { color: #20764e; background: #e0f5e9; }
.console-badge.status-rejected { color: #b34a4a; background: #ffebeb; }
.personnel-change-modal { width: min(860px, 100%); max-height: min(820px, calc(100vh - 40px)); overflow: hidden; border: 1px solid #dce7f5; box-shadow: 0 24px 70px rgba(28, 54, 98, .2); }
.personnel-change-modal-header { position: relative; overflow: hidden; padding: 1.45rem 1.75rem 1.25rem; background: linear-gradient(135deg, #f8fbff 0%, #edf4ff 100%); border-bottom: 1px solid var(--line-soft, #e5edf7); }
.personnel-change-modal-header::after { position: absolute; right: -4rem; bottom: -6rem; width: 15rem; height: 15rem; content: ''; border: 1.5rem solid rgba(110, 145, 220, .08); border-radius: 50%; }
.personnel-change-modal-header > div { position: relative; z-index: 1; }
.personnel-change-modal-header h2 { margin: .35rem 0 0; color: var(--text, #18253a); font-size: 1.35rem; letter-spacing: -.02em; }
.personnel-change-modal-header p:not(.console-modal-eyebrow) { margin: .4rem 0 0; color: var(--muted, #71829b); font-size: .78rem; line-height: 1.5; }
.personnel-modal-eyebrow-icon { display: inline-grid; place-items: center; width: 1.35rem; height: 1.35rem; margin-right: .35rem; color: #496fd0; background: #dfe9ff; border-radius: .4rem; vertical-align: middle; }
.personnel-modal-eyebrow-icon svg { width: .8rem; height: .8rem; }
.personnel-change-modal-body { max-height: calc(100vh - 180px); overflow-y: auto; padding: 1.35rem 1.75rem 1.5rem; }
.personnel-change-form-intro { display: flex; align-items: flex-start; gap: .7rem; margin-bottom: 1.15rem; padding: .8rem .9rem; border: 1px solid #dce8f7; border-radius: .7rem; background: #f7faff; }
.personnel-change-form-intro-icon { display: grid; flex: 0 0 auto; place-items: center; width: 1.9rem; height: 1.9rem; color: #4b70ca; background: #e3edff; border-radius: .55rem; }
.personnel-change-form-intro strong { color: #2d4f91; font-size: .82rem; }
.personnel-change-form-intro p { margin: .18rem 0 0; color: var(--muted, #71829b); font-size: .74rem; line-height: 1.5; }
.personnel-change-form-grid { padding: 1rem; border: 1px solid var(--line-soft, #e5edf7); border-radius: .75rem; background: #fff; }
.personnel-change-form-grid .console-form-item > span { color: var(--text, #34445d); font-weight: 650; }
.personnel-change-form-grid .console-form-item em { color: var(--muted, #8190a5); font-size: .7rem; font-style: normal; font-weight: 400; }
.personnel-change-form-grid textarea { min-height: 5.5rem; resize: vertical; }
.personnel-change-modal .full { grid-column: 1 / -1; }
.personnel-preview { margin-top: 1rem; padding: 1rem; border: 1px solid #dce8f7; border-radius: .75rem; background: linear-gradient(135deg, #f8fbff, #f3f7fd); }
.personnel-preview-heading { display: flex; align-items: center; justify-content: space-between; gap: 1rem; }
.personnel-preview-heading > div { min-width: 0; }
.personnel-preview-heading strong { color: var(--text, #263650); font-size: .9rem; }
.personnel-preview-heading p { margin: .25rem 0 0; color: var(--muted, #71829b); font-size: .73rem; }
.personnel-preview-heading .console-button { display: inline-flex; align-items: center; gap: .35rem; white-space: nowrap; }
.personnel-preview-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: .65rem; margin-top: .8rem; }
.personnel-preview-grid > div { padding: .75rem; border: 1px solid var(--line-soft, #e5edf7); border-radius: .55rem; background: var(--card, #fff); }
.personnel-preview-grid span { display: block; color: var(--muted, #71829b); font-size: .78rem; }
.personnel-preview-grid strong { display: block; margin-top: .25rem; color: var(--text, #263650); font-size: 1.15rem; }
.personnel-preview-grid .preview-added { border-top: 3px solid #49a978; }
.personnel-preview-grid .preview-added strong { color: #25835a; }
.personnel-preview-grid .preview-removed { border-top: 3px solid #db7777; }
.personnel-preview-grid .preview-removed strong { color: #b34a4a; }
.personnel-preview-grid .preview-kept { border-top: 3px solid #7094d6; }
.personnel-preview-grid .preview-kept strong { color: #3c70c9; }
.personnel-change-modal > .console-form-actions { margin: 0; padding: .9rem 1.75rem; border-top: 1px solid var(--line-soft, #e5edf7); background: rgba(255, 255, 255, .96); }
.personnel-authorization-modal { max-width: 900px; }
.personnel-authorization-list { display: grid; gap: .7rem; max-height: 55vh; overflow: auto; }
.personnel-authorization-card { padding: 1rem; border: 1px solid var(--line-soft, #e0e8f2); border-radius: .75rem; background: var(--card, #fff); }
.personnel-authorization-card-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 1rem; }
.personnel-authorization-card-head strong, .personnel-authorization-card-head small { display: block; }
.personnel-authorization-card-head small { margin-top: .2rem; color: var(--muted, #71829b); }
.personnel-role-list { display: grid; gap: .4rem; margin: .75rem 0 0; padding: 0; list-style: none; }
.personnel-role-list li { display: flex; justify-content: space-between; gap: 1rem; padding: .5rem .65rem; border-radius: .5rem; background: var(--sunken, #f8fafc); }
.personnel-role-list small { color: var(--muted, #71829b); white-space: nowrap; }
@media (max-width: 980px) {
  .personnel-change-summary { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .personnel-change-hero { align-items: flex-start; flex-direction: column; }
  .personnel-change-heading-actions { width: 100%; }
}
@media (max-width: 720px) {
  .personnel-change-hero, .personnel-change-summary { padding-right: 1rem; padding-left: 1rem; }
  .personnel-change-flow, .personnel-change-toolbar, .personnel-change-table-shell, .personnel-change-loading, .personnel-change-center > .console-card-body > .settings-empty { margin-right: 1rem; margin-left: 1rem; }
  .personnel-change-flow ol { grid-template-columns: repeat(2, 1fr); row-gap: .7rem; }
  .personnel-change-flow li:nth-child(2)::after { display: none; }
  .personnel-change-toolbar { align-items: stretch; flex-wrap: wrap; }
  .personnel-change-search, .personnel-change-select { flex: 1 1 100%; }
  .personnel-change-toolbar .console-button { width: 100%; justify-content: center; }
  .personnel-change-modal-header { padding: 1.2rem 1.15rem 1.1rem; }
  .personnel-change-modal-body { max-height: calc(100vh - 160px); padding: 1rem 1.15rem 1.25rem; }
  .personnel-change-form-grid { padding: .85rem; }
  .personnel-change-modal > .console-form-actions { padding-right: 1.15rem; padding-left: 1.15rem; }
}
@media (max-width: 480px) {
  .personnel-change-hero { padding-top: 1.25rem; padding-bottom: 1.25rem; }
  .personnel-change-summary { grid-template-columns: 1fr; padding-top: 1rem; padding-bottom: 1rem; }
  .personnel-change-heading-actions { flex-direction: column; }
  .personnel-change-heading-actions .console-button { width: 100%; justify-content: center; }
  .personnel-change-flow ol { grid-template-columns: 1fr; }
  .personnel-change-flow li::after { display: none; }
  .personnel-preview-grid { grid-template-columns: 1fr; }
  .personnel-preview-heading { align-items: stretch; flex-direction: column; }
  .personnel-preview-heading .console-button { justify-content: center; }
  .personnel-change-modal > .console-form-actions { flex-direction: column-reverse; }
  .personnel-change-modal > .console-form-actions .console-button { width: 100%; justify-content: center; }
}
</style>
