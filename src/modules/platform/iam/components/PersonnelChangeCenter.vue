<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { cancelPersonnelChange, completePersonnelHandoverItem, createPersonnelChange, listPersonnelChanges, listPersonnelHandoverItems, previewPersonnelChange, retryPersonnelHandover, submitPersonnelChange, transitionPersonnelChange } from '../api/personnelChanges.js'
import { listMemberships, listOrgUnits, listPositions, listUsers } from '../api/iam.js'
import { loadAllCatalogPages } from '../utils/paginatedCatalog.js'
import { useRelatedDataInvalidation } from '../../shared/composables/useRelatedDataInvalidation.js'
import { RELATED_DATA } from '../../shared/utils/relatedDataInvalidation.js'
import { getApplicationAccess } from '../api/authorization.js'
import { listApplications } from '../../applications/api/applications.js'
import ConsoleIcon from '../../shared/components/ConsoleIcon.vue'
import { hasPermission } from '../../auth/utils/principal.js'
import { useDictionaryOptions } from '../../dictionaries/composables/useDictionaryOptions.js'
import { formatUserError } from '../../../shared/utils/userError.js'

// 员工创建统一交由 PlatformConsoleView 持有的原子向导，人员异动中心只发起意图，
// 避免这里重新实现用户、账号、任职和岗位授权的非原子流程。
const props = defineProps({
  // 从用户详情「办理离职」进入时预填的人员标识；异动中心负责创建离职申请。
  prefillUserId: { type: String, default: '' },
})

const emit = defineEmits(['toast', 'employee-onboarding', 'prefill-consumed'])
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
const catalogsLoading = ref(false)
// 目录读取失败时把逐目录的受控提示写进页面既有 error 通道；catalogsFailed 只作为
// 提交闸门和 UI 条件，避免把“失败”伪装成“没有组织 / 岗位”。
const catalogsFailed = ref(false)
const catalogNotice = ref('')
const personConfirmed = ref(false)
const preview = ref(null)
const authorizationDetail = ref(null)
const authorizationLoading = ref(false)
const authorizationError = ref('')
const workflowAction = ref(null)
const workflowReference = ref('')
const workflowSaving = ref(false)
const handoverItems = ref([])
const handoverItemsLoaded = ref(false)
const handoverCrossSystemEnabled = ref(false)
// 首次提交使用弹窗已读取的交接项；失败后的重试先回读权威状态，
// 避免把“服务端已完成但响应丢失”的项再次写入（后端会拒绝重复完成）。
const handoverRetryPending = ref(false)
const handoverTargetUserId = ref('')
// 交接项全部完成、但排期请求未成功时，页面仍必须允许直接重试排期。
// 该纯函数只筛出未完成项：已完成项不得再次提交（后端重复完成会返回冲突）。
function isHandoverItemDone(item) {
  if (item?.batch_id && String(item?.status || '').toUpperCase() === 'COMPLETED') return false
  return ['COMPLETED', 'TRANSFERRED', 'SKIPPED'].includes(String(item?.status || '').toUpperCase())
}
function unfinishedHandoverItems(items) {
  return (Array.isArray(items) ? items : []).filter((item) => !isHandoverItemDone(item))
}
function handoverStatusLabel(item) {
  if (item.batch_id) return ({ PENDING: '远端待转移 / 待回执', TRANSFERRED: '远端已转移', SKIPPED: '远端已结清', FAILED: '远端拒绝转移', COMPLETED: '需核对远端回执' })[item.status] || '远端状态待核对'
  return isHandoverItemDone(item) ? '本地已确认' : '本地待确认'
}
function handoverFailureMessage(completedCount, reason) {
  const completed = Number(completedCount) || 0
  const detail = String(reason || '').slice(0, 180)
  const state = completed > 0
    ? `已确认完成 ${completed} 项责任交接；后续交接或排期尚未确认完成。`
    : '责任交接或排期尚未确认完成。'
  return `${state}可直接重试（无需关闭窗口）：系统会先核对权威交接状态，可刷新核对后重试；已完成项不会重复提交，勿重复提交已完成项。${detail}`
}
// 权威交接项读取完成且没有待完成项时，才提示“可直接重试排期”；
// 读取中不能把空数组误判为“已全部完成”。
const handoverNothingPending = computed(() => handoverItemsLoaded.value && unfinishedHandoverItems(handoverItems.value).length === 0)
const filters = reactive({ status: '', type: '', keyword: '' })
const form = reactive({ userId: '', type: 'TRANSFER', sourceMembershipId: '', targetOrgUnitId: '', targetPositionId: '', reason: '', effectiveDate: '', immediate: false })

// 异动类型的取值集合是后端异动流程的协议值（下方 requires* 分支按它判定），
// 字典只治理显示名称与排序；字典不可用（无权限/未配置/网络失败）时回退内置项，表单始终可用。
const fallbackTypeOptions = [
  ['PROMOTION', '晋升'], ['DEMOTION', '降职'], ['TRANSFER', '调岗'], ['TERMINATION', '离职'], ['REHIRE', '复职'],
]
const { options: dictionaryTypeOptions } = useDictionaryOptions('PERSONNEL_CHANGE_TYPE', {
  fallback: fallbackTypeOptions.map(([value, label]) => ({ value, label })),
})
const typeOptions = computed(() => dictionaryTypeOptions.value.map(({ value, label }) => [value, label]))
// 状态名称与后端统一状态机保持一致，页面操作不能自行派生或跳过阶段。
const statusLabels = { DRAFT: '待提交', PENDING_APPROVAL: '待审批', PENDING_HANDOVER: '待交接', SCHEDULED: '待生效', EXECUTED: '已执行', REJECTED: '已驳回', CANCELLED: '已取消' }
const typeLabel = (value) => typeOptions.value.find(([key]) => key === value)?.[1] || value || '—'
const requiresSourceMembership = computed(() => ['PROMOTION', 'DEMOTION', 'TRANSFER', 'TERMINATION'].includes(form.type))
const requiresTargetAssignment = computed(() => ['PROMOTION', 'DEMOTION', 'TRANSFER', 'REHIRE'].includes(form.type))
const canProcessApproval = computed(() => hasPermission('platform:user:update') && hasPermission('platform:approval:process'))
const canRead = computed(() => hasPermission('platform:user:read'))
const canUpdate = computed(() => hasPermission('platform:user:update'))
const canCreateEmployee = computed(() => hasPermission('platform:user:create'))
const availableUsers = computed(() => users.value.filter((item) => {
  const status = String(item.status || '').toUpperCase()
  return form.type === 'REHIRE' ? status === 'DISABLED' : status === 'ACTIVE'
}))

async function load() {
  if (!canRead.value) return
  loading.value = true; error.value = ''
  try { records.value = (await listPersonnelChanges(filters)).items } catch (e) { error.value = formatUserError(e, { method: 'GET', fallback: '加载异动单失败。' }) } finally { loading.value = false }
}

// 人员 / 岗位 / 组织目录每次都重新读取，并逐页读取完整目录。
//
// 旧实现用“数组非空就跳过”复用上一份快照，且只取第一页：新建员工或岗位后必须整页
// 刷新才能选到，超过 100 条时后续分页的合法选项永远不可用。
// 连续刷新（打开表单、写入后的失效通知、窗口聚焦）会并发多次读取；序号保证只有最后
// 一次读取的结果可以回写，避免写入前发起的慢响应把旧目录重新填回选择器。
let catalogsRequestSeq = 0

async function loadCatalogs() {
  if (!canUpdate.value) return
  const seq = ++catalogsRequestSeq
  catalogsLoading.value = true
  const failures = []
  const collect = (label, promise, assign) => promise
    .then((items) => {
      if (seq !== catalogsRequestSeq) return
      assign(items)
    })
    .catch((e) => {
      if (seq !== catalogsRequestSeq) return
      failures.push(`${label}：${formatUserError(e, { method: 'GET', fallback: `${label}暂时无法加载，请稍后重试。` }).slice(0, 120)}`)
    })
  await Promise.all([
    collect('人员目录', loadAllCatalogPages(listUsers, { pageSize: 100 }, (item) => item?.id || item?.user_id), (items) => { users.value = items }),
    collect('岗位目录', loadAllCatalogPages(listPositions, { pageSize: 100, status: 'ACTIVE' }, (item) => item?.position_id || item?.id), (items) => { positions.value = items }),
    collect('组织目录', loadAllCatalogPages(listOrgUnits, { pageSize: 100, status: 'ACTIVE' }, (item) => item?.org_unit_id || item?.id), (items) => { organizations.value = items }),
  ])
  if (seq !== catalogsRequestSeq) return false
  catalogsLoading.value = false
  error.value = failures.join('；')
  catalogsFailed.value = failures.length > 0
  dropInvalidSelections()
  return !catalogsFailed.value
}

// 目录重新读取后只清理确实失效的选择并说明原因，不重置原因、日期等已填写内容。
function dropInvalidSelections() {
  if (catalogsFailed.value) return
  const notices = []
  if (form.userId && !availableUsers.value.some((item) => String(item.id || item.user_id) === String(form.userId))) {
    form.userId = ''
    memberships.value = []
    personConfirmed.value = false
    notices.push('原选人员已停用或不再可见，已清除人员与原任职选择')
  }
  if (form.targetOrgUnitId && !organizations.value.some((item) => String(item.id || item.org_unit_id) === String(form.targetOrgUnitId))) {
    form.targetOrgUnitId = ''
    form.targetPositionId = ''
    notices.push('原选目标组织已停用或不再可见，已清除目标组织与岗位')
  } else if (form.targetPositionId && !targetPositionOptions.value.some((item) => String(item.id || item.position_id) === String(form.targetPositionId))) {
    form.targetPositionId = ''
    notices.push('原选目标岗位已停用或不再属于该组织，已清除目标岗位')
  }
  if (notices.length) catalogNotice.value = `${notices.join('；')}；其余已填写内容保持不变。`
}

async function openForm() {
  if (!canUpdate.value) return
  showForm.value = true; preview.value = null; error.value = ''; catalogNotice.value = ''
  await loadCatalogs()
}

// 由用户详情页发起：打开表单、预选离职类型和人员，并读取其当前有效任职。
async function openForUser(userId) {
  const normalized = String(userId || '').trim()
  if (!normalized || !canUpdate.value) return
  await openForm()
  // 先切换类型（类型 watcher 会清理失效的人员选择），再设置人员，最后读取任职。
  form.type = 'TERMINATION'
  form.userId = normalized
  await loadUserMemberships()
}

watch(() => props.prefillUserId, async (userId) => {
  if (!userId) return
  await openForUser(userId)
  emit('prefill-consumed')
}, { immediate: true })

watch(() => form.type, () => {
  preview.value = null
  if (!requiresSourceMembership.value) form.sourceMembershipId = ''
  if (!requiresTargetAssignment.value) {
    form.targetOrgUnitId = ''
    form.targetPositionId = ''
  }
  if (form.userId && !availableUsers.value.some((item) => String(item.id || item.user_id) === String(form.userId))) {
    form.userId = ''
    memberships.value = []
    personConfirmed.value = false
  }
})

async function loadUserMemberships() {
  memberships.value = []
  form.sourceMembershipId = ''
  personConfirmed.value = false
  if (!form.userId) return
  await refreshUserMemberships()
}

async function refreshUserMemberships() {
  if (!form.userId) return
  membershipsLoading.value = true
  try {
    const result = await listMemberships({ page: 1, pageSize: 100, keyword: form.userId, status: 'ACTIVE' })
    memberships.value = result.items.filter((item) => String(item.user_id || item.user?.id || '') === String(form.userId))
    personConfirmed.value = true
    const primary = memberships.value.find((item) => item.is_primary === true || String(item.membership_type || '').toUpperCase() === 'PRIMARY')
    const current = primary || (memberships.value.length === 1 ? memberships.value[0] : null)
    if (current) form.sourceMembershipId = current.membership_id || current.id || ''
  } catch (e) {
    error.value = formatUserError(e, { method: 'GET', fallback: '加载当前任职关系失败。' })
  } finally {
    membershipsLoading.value = false
  }
}

function resetForm() { Object.assign(form, { userId: '', type: 'TRANSFER', sourceMembershipId: '', targetOrgUnitId: '', targetPositionId: '', reason: '', effectiveDate: '', immediate: false }); memberships.value = []; preview.value = null; personConfirmed.value = false }
function closeForm() { showForm.value = false; resetForm(); error.value = '' }

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
  // 立即生效以提交时刻作为生效时间；勾选后无需再填日期。
  if (form.immediate) return { user_id: form.userId, change_type: form.type, source_membership_id: form.sourceMembershipId || null, target_org_unit_id: form.targetOrgUnitId || null, target_position_id: form.targetPositionId || null, reason: form.reason, effective_at: new Date().toISOString() }
  return { user_id: form.userId, change_type: form.type, source_membership_id: form.sourceMembershipId || null, target_org_unit_id: form.targetOrgUnitId || null, target_position_id: form.targetPositionId || null, reason: form.reason, effective_at: form.effectiveDate ? `${form.effectiveDate}T00:00:00+08:00` : null }
}

async function loadPreview() {
  if (!form.userId || !form.type) return
  saving.value = true; error.value = ''
  try { preview.value = await previewPersonnelChange(payload()) } catch (e) { error.value = formatUserError(e, { method: 'POST', fallback: '权限影响预览失败。' }) } finally { saving.value = false }
}

async function save() {
  if (catalogsLoading.value) { error.value = '正在读取最新人员、组织与岗位目录，请稍候再提交。'; return }
  if (catalogsFailed.value) { error.value = `关联目录尚未确认，请先重试读取：${error.value}`; return }
  if (!form.userId || !form.reason || (!form.immediate && !form.effectiveDate)) { error.value = '请填写人员、原因和生效日期（或勾选立即生效）'; return }
  if (requiresSourceMembership.value && !form.sourceMembershipId) { error.value = '晋升、降职、调岗和离职必须选择原任职'; return }
  if (requiresTargetAssignment.value && (!form.targetOrgUnitId || !form.targetPositionId)) { error.value = '晋升、降职、调岗和复职必须选择新组织和新岗位'; return }
  saving.value = true; error.value = ''
  try {
    await createPersonnelChange(payload())
    emit('toast', '异动单已保存，系统已按当前账号权限进入审批或排期流程'); showForm.value = false; resetForm(); await load()
  } catch (e) { error.value = formatUserError(e, { method: 'POST', fallback: '保存异动单失败。' }) } finally { saving.value = false }
}

function recordId(item) { return item.id || item.change_id }
async function openWorkflowAction(item) {
  const status = String(item.status || '').toUpperCase()
  if (status === 'DRAFT') {
    runSubmit(item)
    return
  }
  if (!canProcessApproval.value) return
  const termination = String(item.change_type || item.type || '').toUpperCase() === 'TERMINATION'
  if (status === 'PENDING_APPROVAL') {
    workflowAction.value = { item, kind: 'approval', toStatus: termination ? 'PENDING_HANDOVER' : 'SCHEDULED', title: '审批人员异动', prefix: '' }
  } else if (status === 'PENDING_HANDOVER') {
    // 交接凭据编号由服务端在排期时自动生成，操作者只选择接收人并确认。
    workflowAction.value = { item, kind: 'handover', toStatus: 'SCHEDULED', title: '确认交接完成并排期', prefix: '', autoReference: true }
    handoverRetryPending.value = false
    workflowSaving.value = true
    try {
      // 责任接收人必须是当前有效人员：每次打开交接都重新读取完整人员目录。
      await loadCatalogs()
      const result = await listPersonnelHandoverItems(recordId(item))
      handoverItems.value = result.items
      handoverCrossSystemEnabled.value = result.cross_system_enabled === true
      handoverItemsLoaded.value = true
    } catch (e) {
      error.value = formatUserError(e, { method: 'GET', fallback: '加载责任交接项失败。' })
      workflowAction.value = null
    } finally { workflowSaving.value = false }
  }
  workflowReference.value = workflowAction.value?.prefix || ''
}

function openCancelAction(item) {
  if (!canUpdate.value) return
  workflowAction.value = { item, kind: 'cancel', toStatus: 'CANCELLED', title: '取消人员异动单', prefix: '' }
  workflowReference.value = ''
}

// 已排期异动的立即执行：仅豁免生效时间闸门，审批/离职交接闸门在排期前已通过，
// 执行链路与定时执行完全一致（幂等锁定、不可变历史、完成通知）。
function openImmediateAction(item) {
  if (!canProcessApproval.value) return
  workflowAction.value = { item, kind: 'execute', title: '立即执行人员异动' }
}

async function runImmediateExecution() {
  workflowSaving.value = true; error.value = ''
  try {
    await transitionPersonnelChange(recordId(workflowAction.value.item), 'EXECUTED', '', { immediate: true })
    emit('toast', '人员异动已立即生效')
    workflowAction.value = null
    await load()
  } catch (e) { error.value = formatUserError(e, { method: 'POST', fallback: '立即执行失败。' }) }
  finally { workflowSaving.value = false }
}

async function runSubmit(item) {
  workflowSaving.value = true; error.value = ''
  try { await submitPersonnelChange(recordId(item)); emit('toast', '异动单已提交审批'); await load() }
  catch (e) { error.value = formatUserError(e, { method: 'POST', fallback: '提交审批失败。' }) }
  finally { workflowSaving.value = false }
}

function closeWorkflowAction() {
  if (workflowSaving.value) return
  workflowAction.value = null; workflowReference.value = ''; handoverItems.value = []; handoverItemsLoaded.value = false; handoverRetryPending.value = false; handoverTargetUserId.value = ''
}

async function confirmWorkflowAction() {
  if (workflowAction.value?.kind === 'cancel') {
    workflowSaving.value = true; error.value = ''
    try {
      await cancelPersonnelChange(recordId(workflowAction.value.item))
      emit('toast', '异动单已取消')
      workflowAction.value = null
      await load()
    } catch (e) { error.value = formatUserError(e, { method: 'POST', fallback: '取消异动单失败。' }) }
    finally { workflowSaving.value = false }
    return
  }
  if (workflowAction.value?.kind === 'execute') {
    await runImmediateExecution()
    return
  }
  // 交接排期（autoReference）不要求手工凭据：服务端在排期时自动生成 HANDOVER- 编号。
  const autoReference = Boolean(workflowAction.value?.autoReference)
  const reference = workflowReference.value.trim()
  if (!autoReference && !reference) { error.value = '请填写审批或交接凭据编号'; return }
  if (!autoReference && workflowAction.value?.prefix && !reference.toUpperCase().startsWith(workflowAction.value.prefix)) { error.value = `凭据必须以 ${workflowAction.value.prefix} 开头`; return }
  workflowSaving.value = true; error.value = ''
  let completedHandoverCount = 0
  try {
    if (workflowAction.value?.kind === 'handover') {
      if (handoverCrossSystemEnabled.value) {
        const batch = await retryPersonnelHandover(recordId(workflowAction.value.item))
        if (!['FROZEN', 'TRANSFERRING', 'COMPLETED'].includes(batch?.status)) throw new Error('责任发现尚未完成，请核对系统状态后重试。')
        handoverRetryPending.value = true
      }
      if (handoverRetryPending.value) {
        // 上一次交接/排期失败后重试：先回读权威交接状态，已完成项不再写入
        // （后端对重复完成返回冲突）；全部完成时跳过写入，直接重试排期。
        const latest = await listPersonnelHandoverItems(recordId(workflowAction.value.item))
        handoverItems.value = latest.items
        handoverItemsLoaded.value = true
      }
      const pending = unfinishedHandoverItems(handoverItems.value)
      if (pending.length && !handoverTargetUserId.value && pending.some((item) => !item.batch_id || !item.target_owner_id)) { error.value = '请选择责任接收人'; return }
      for (const item of pending) {
        const result = item.batch_id
          ? await completePersonnelHandoverItem(recordId(workflowAction.value.item), item.id, item.target_owner_id || handoverTargetUserId.value)
          : await completePersonnelHandoverItem(recordId(workflowAction.value.item), item.id, handoverTargetUserId.value)
        Object.assign(item, result)
        if (!isHandoverItemDone(item)) {
          handoverRetryPending.value = true
          error.value = handoverFailureMessage(completedHandoverCount, item.status === 'FAILED' ? '远端拒绝转移，请核对承接人资格或取消本次异动。' : '远端回执尚未确认完成，请稍后重试。')
          return
        }
        completedHandoverCount += 1
      }
    }
    const result = await transitionPersonnelChange(recordId(workflowAction.value.item), workflowAction.value.toStatus, autoReference ? '' : reference)
    const generatedReference = result?.handover_reference || result?.handoverReference || ''
    emit('toast', autoReference ? `交接完成并已排期，交接凭据 ${generatedReference || '已由系统生成'}` : `${workflowAction.value.title}成功`)
    workflowAction.value = null; workflowReference.value = ''; handoverItems.value = []; handoverItemsLoaded.value = false; handoverRetryPending.value = false; handoverTargetUserId.value = ''
    await load()
  } catch (e) {
    const reason = formatUserError(e, { method: 'POST', fallback: '异动流程处理失败。' })
    if (workflowAction.value?.kind === 'handover') {
      handoverRetryPending.value = true
      error.value = handoverFailureMessage(completedHandoverCount, reason)
    } else {
      error.value = reason
    }
  }
  finally { workflowSaving.value = false }
}

async function rejectWorkflowAction() {
  const reference = workflowReference.value.trim()
  if (!reference) { error.value = '请填写驳回原因或审批记录编号'; return }
  workflowSaving.value = true; error.value = ''
  try {
    await transitionPersonnelChange(recordId(workflowAction.value.item), 'REJECTED', reference)
    emit('toast', '异动单已驳回')
    workflowAction.value = null; workflowReference.value = ''
    await load()
  } catch (e) { error.value = formatUserError(e, { method: 'POST', fallback: '驳回异动单失败。' }) }
  finally { workflowSaving.value = false }
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
    const failed = settled.filter((entry) => entry.status === 'rejected')
    if (failed.length) {
      const reason = formatUserError(failed[0].reason, { method: 'GET', fallback: '暂时无法读取该人员的应用授权，请确认授权读取权限。' })
      authorizationError.value = `${failed.length} 个应用的授权信息未能读取，当前概览可能不完整。${reason.slice(0, 180)}`
    }
  } catch (e) {
    authorizationError.value = formatUserError(e, { method: 'GET', fallback: '加载人员授权失败。' })
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

function authorizationFailureMessage(value) {
  return formatUserError(value, { method: 'GET', fallback: '该应用授权暂时无法确认，请联系管理员核对。' })
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

function userLabel(item) { return item?.user_display_name || item?.display_name || item?.name || item?.user_id || item?.id || '' }
function targetAssignmentLabel(item) {
  if (String(item.change_type || item.type).toUpperCase() === 'TERMINATION') return '离职后不保留任职'
  const organization = item.target_organization_name || organizationName(item.target_org_unit_id)
  const position = item.target_position_name || positionName(item.target_position_id)
  return `${organization} / ${position}`
}
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
  { key: 'scheduled', label: '待生效', value: records.value.filter((item) => item.status === 'SCHEDULED').length, hint: '到生效日期自动执行，也可立即生效', icon: 'dashboard', tone: 'blue' },
  { key: 'executed', label: '已执行', value: records.value.filter((item) => item.status === 'EXECUTED').length, hint: '已完成变更', icon: 'save', tone: 'green' },
  { key: 'cancelled', label: '已取消', value: records.value.filter((item) => item.status === 'CANCELLED').length, hint: '已停止执行', icon: 'close', tone: 'orange' },
])
const visibleRecords = computed(() => records.value)
// 组织 / 岗位 / 人员 / 任职在其他入口写入后，立即重新读取目录；表单已打开时
// 只清理确实失效的选择，不打断正在填写的异动单。
useRelatedDataInvalidation((event) => {
  if (event.type === 'session') return
  // 与手动打开表单相同的权限前提：缺少读取或更新权限的账号不会因为共享刷新而额外发起目录请求。
  if (!canUpdate.value || !canRead.value) return
  loadCatalogs().catch(() => {})
}, {
  kinds: [RELATED_DATA.ORGANIZATIONS, RELATED_DATA.POSITIONS, RELATED_DATA.PEOPLE, RELATED_DATA.MEMBERSHIPS],
})

onMounted(() => { if (canRead.value) load() })
</script>

<template>
  <section class="console-card settings-card personnel-change-center">
    <div class="console-card-body">
      <div class="personnel-change-hero">
        <div class="personnel-change-hero-copy">
          <div class="iam-section-kicker"><span class="personnel-change-kicker-icon"><ConsoleIcon name="organization" /></span>PERSONNEL LIFECYCLE</div>
          <div><h2>人员异动中心</h2><p class="console-card-hint">由管理员统一配置员工入职、晋升、降职、调岗、离职和复职，按生效日期执行（支持立即生效）并保留权限变更轨迹。</p></div>
        </div>
        <div class="personnel-change-heading-actions"><button v-if="canCreateEmployee" class="console-button secondary" type="button" @click="() => emit('employee-onboarding')"><ConsoleIcon name="user" />新增员工</button><button v-if="canUpdate" class="console-button primary" type="button" @click="openForm"><ConsoleIcon name="save" />新建异动单</button></div>
      </div>
      <div class="personnel-change-summary" aria-label="异动概览"><article v-for="card in summaryCards" :key="card.key" class="personnel-summary-card" :class="`tone-${card.tone}`"><span class="personnel-summary-icon"><ConsoleIcon :name="card.icon" /></span><div><span class="personnel-summary-label">{{ card.label }}</span><strong>{{ card.value }}</strong><small>{{ card.hint }}</small></div></article></div>
      <div class="personnel-change-flow" aria-label="人员异动流程"><div class="personnel-flow-title"><strong>人员异动流程</strong><small>离职必须完成审批与交接，其他异动按账号权限进入审批或排期</small></div><ol><li><b>01</b><span>选择人员与任职</span></li><li><b>02</b><span>配置并校验异动</span></li><li><b>03</b><span>审批与离职交接</span></li><li><b>04</b><span>按期或立即生效</span></li></ol></div>
      <div v-if="canRead" class="personnel-change-toolbar"><label class="personnel-change-search"><ConsoleIcon name="search" /><input v-model="filters.keyword" placeholder="搜索人员姓名、异动编号或审批凭据" @keyup.enter="load"  maxlength="100"/></label><label class="personnel-change-select"><span>类型</span><select v-model="filters.type" @change="load"><option value="">全部类型</option><option v-for="[key, label] in typeOptions" :key="key" :value="key">{{ label }}</option></select></label><label class="personnel-change-select"><span>状态</span><select v-model="filters.status" @change="load"><option value="">全部状态</option><option v-for="(label, key) in statusLabels" :key="key" :value="key">{{ label }}</option></select></label><button class="console-button secondary" type="button" :disabled="loading" @click="load"><ConsoleIcon name="reset" />刷新</button></div>
      <p v-if="error" class="login-target-module__error" role="alert">{{ error }}</p>
      <div v-if="!canRead" class="settings-empty"><span class="settings-empty-icon"><ConsoleIcon name="organization" /></span><h3>没有人员异动读取权限</h3><p>请联系平台管理员授予 platform:user:read 后再查看异动单。</p></div>
      <div v-else-if="loading" class="personnel-change-loading"><span class="personnel-loading-dot" />正在加载异动单…</div>
      <div v-else-if="!visibleRecords.length" class="settings-empty"><span class="settings-empty-icon"><ConsoleIcon name="organization" /></span><template v-if="error"><h3>异动信息暂时无法展示</h3><p>请处理上方提示后刷新，当前不能确认是否存在异动单。</p></template><template v-else><h3>暂无人员异动配置</h3><p>管理员创建异动配置后，系统会按生效日期自动执行，已排期异动也可由管理员立即执行。</p></template></div>
      <div v-else class="personnel-change-table-shell"><div class="personnel-change-table"><div class="personnel-change-row personnel-change-header"><span>人员</span><span>异动类型</span><span>组织 / 岗位变更</span><span>状态</span><span>生效日期</span><span>操作</span></div><div v-for="item in visibleRecords" :key="item.id || item.change_id" class="personnel-change-row"><span class="personnel-change-person"><span class="personnel-person-avatar">{{ userLabel(item).slice(0, 1) || '?' }}</span><span><strong>{{ userLabel(item) || '—' }}</strong><small class="console-mono">{{ item.user_id || item.userId || '人员信息' }}</small></span></span><span><span class="personnel-change-type">{{ typeLabel(item.change_type || item.type) }}</span><small class="personnel-change-code console-mono">{{ item.change_type || item.type || '—' }}</small></span><span class="personnel-change-move"><small>目标任职</small><strong>{{ targetAssignmentLabel(item) }}</strong></span><span><span class="console-badge" :class="statusTone(item.status)">{{ statusLabels[item.status] || item.status || '—' }}</span></span><span class="personnel-change-date">{{ item.effective_at || item.effective_date || '—' }}</span><span class="personnel-change-actions"><button class="console-button compact" type="button" @click="openAuthorization(item)">授权概览</button><button v-if="canUpdate && item.status === 'DRAFT'" class="console-button compact primary" type="button" :disabled="workflowSaving" @click="openWorkflowAction(item)">提交审批</button><button v-else-if="canProcessApproval && ['PENDING_APPROVAL', 'PENDING_HANDOVER'].includes(item.status)" class="console-button compact primary" type="button" :disabled="workflowSaving" @click="openWorkflowAction(item)">{{ item.status === 'PENDING_HANDOVER' ? '完成交接' : '审批处理' }}</button><button v-if="canProcessApproval && item.status === 'SCHEDULED'" class="console-button compact primary" type="button" :disabled="workflowSaving" @click="openImmediateAction(item)">立即生效</button><button v-if="canUpdate && ['DRAFT', 'PENDING_APPROVAL', 'PENDING_HANDOVER', 'SCHEDULED'].includes(item.status)" class="console-button compact ghost" type="button" :disabled="workflowSaving" @click="openCancelAction(item)">取消</button></span></div></div></div>
    </div>
  </section>
  <div v-if="showForm" class="console-modal-backdrop" role="presentation" @click.self="closeForm">
    <section class="console-detail-modal personnel-change-modal" role="dialog" aria-modal="true" aria-label="新建人员异动单"><header class="personnel-change-modal-header"><div><p class="console-modal-eyebrow"><span class="personnel-modal-eyebrow-icon"><ConsoleIcon name="organization" /></span>PERSONNEL CHANGE</p><h2>新建人员异动单</h2><p>系统校验真实任职关系，并按异动类型和当前账号权限进入审批或排期。</p></div><button class="console-modal-close" type="button" aria-label="关闭新建人员异动单" @click.stop="closeForm">×</button></header>
      <div class="personnel-change-modal-body"><div class="personnel-change-form-intro"><span class="personnel-change-form-intro-icon"><ConsoleIcon name="info" /></span><div><strong>离职必须审批并完成责任交接</strong><p>普通管理员创建的异动单进入审批；超级管理员仅可直接排期非离职异动。</p></div></div>
      <p v-if="error" class="login-target-module__error" role="alert">{{ error }}</p>
      <p v-if="catalogsLoading" class="console-card-hint" role="status">正在读取最新人员、组织与岗位目录…读取完成前不能提交，避免选到已停用的组织或岗位。</p>
      <p v-else-if="catalogsFailed" class="login-target-module__error" role="alert">
        关联目录读取失败：{{ error }}
        <button class="console-button ghost small" type="button" @click="loadCatalogs"><ConsoleIcon name="reset" />重试读取</button>
      </p>
      <p v-if="catalogNotice" class="login-target-module__error" role="status">{{ catalogNotice }}</p>
      <div class="console-form-grid personnel-change-form-grid">
        <label class="console-form-item personnel-user-picker"><span>人员 *</span><div class="personnel-user-picker-row"><select v-model="form.userId" @change="loadUserMemberships"><option value="">{{ form.type === 'REHIRE' ? '请选择已禁用人员' : '请选择在职人员' }}</option><option v-for="item in availableUsers" :key="item.id || item.user_id" :value="item.id || item.user_id">{{ userLabel(item) }}</option></select><button class="console-button secondary compact" type="button" :disabled="!form.userId || membershipsLoading" @click="refreshUserMemberships">{{ membershipsLoading ? '读取中…' : (personConfirmed ? '已确认' : '确认人员') }}</button></div><small>{{ form.type === 'REHIRE' ? '复职只允许选择已禁用人员，并将重新建立有效任职。' : '选择人员后系统会读取当前有效组织和岗位。' }}</small></label>
        <label class="console-form-item"><span>异动类型 *</span><select v-model="form.type"><option v-for="[key, label] in typeOptions" :key="key" :value="key">{{ label }}</option></select></label>
        <label class="console-form-item"><span>原任职<span v-if="requiresSourceMembership"> *</span><em v-else>（复职可不填）</em></span><select v-model="form.sourceMembershipId" :disabled="!personConfirmed || membershipsLoading" :required="requiresSourceMembership"><option value="">{{ !personConfirmed ? '请先确认人员' : (membershipsLoading ? '正在读取任职…' : '请选择原组织 / 原岗位') }}</option><option v-for="item in sourceMembershipOptions" :key="item.membership_id || item.id" :value="item.membership_id || item.id">{{ membershipLabel(item) }}</option></select><div v-if="personConfirmed && sourceMembershipOptions.length" class="personnel-current-memberships"><span v-for="item in sourceMembershipOptions" :key="item.membership_id || item.id" class="personnel-current-membership">当前：{{ membershipLabel(item) }}</span></div><small>{{ requiresSourceMembership ? '必须选择属于该人员的有效任职关系。' : '复职按人员离职状态校验，不要求历史任职。' }}</small></label>
        <label class="console-form-item"><span>新组织<span v-if="requiresTargetAssignment"> *</span><em v-else>（离职不填）</em></span><select v-model="form.targetOrgUnitId" @change="onTargetOrganizationChange" :required="requiresTargetAssignment"><option value="">请选择目标组织</option><option v-for="item in organizations" :key="item.id || item.org_unit_id" :value="item.id || item.org_unit_id">{{ item.name }}</option></select></label>
        <label class="console-form-item"><span>新岗位<span v-if="requiresTargetAssignment"> *</span><em v-else>（离职不填）</em></span><select v-model="form.targetPositionId" :disabled="!form.targetOrgUnitId" :required="requiresTargetAssignment"><option value="">{{ form.targetOrgUnitId ? '请选择目标岗位' : '请先选择目标组织' }}</option><option v-for="item in targetPositionOptions" :key="item.id || item.position_id" :value="item.id || item.position_id">{{ item.name || item.position_name || item.code }}</option></select><small>{{ requiresTargetAssignment ? '只展示属于目标组织的有效岗位。' : '离职不需要填写目标组织和岗位。' }}</small></label>
        <label class="console-form-item"><span>生效日期 {{ form.immediate ? '' : '*' }}</span><input v-model="form.effectiveDate" type="date" :disabled="form.immediate" /></label>
        <label class="console-form-item"><span>立即生效</span><input v-model="form.immediate" type="checkbox" /><small class="console-card-hint">勾选后以提交时刻作为生效时间，异动单排期后可立即执行</small></label>
        <label class="console-form-item full"><span>变更原因 *</span><textarea v-model="form.reason" rows="3" placeholder="填写业务原因、交接说明或复职依据"  maxlength="500"/></label>
      </div>
      <div class="personnel-preview"><div class="personnel-preview-heading"><div><strong>权限影响预览</strong><p>确认岗位与组织变化带来的角色新增、移除和保留范围。</p></div><button class="console-button secondary compact" type="button" :disabled="saving || !form.userId" @click="loadPreview"><ConsoleIcon name="audit" />{{ saving ? '计算中…' : '生成预览' }}</button></div><div v-if="preview" class="personnel-preview-grid"><div class="preview-added"><span>新增角色</span><strong>{{ (preview.added_roles || preview.added || []).length }} 项</strong></div><div class="preview-removed"><span>移除角色</span><strong>{{ (preview.removed_roles || preview.removed || []).length }} 项</strong></div><div class="preview-kept"><span>保留角色</span><strong>{{ (preview.kept_roles || preview.kept || []).length }} 项</strong></div></div><p v-else class="console-card-hint">保存前生成平台及子系统角色的新增、移除、保留清单。</p></div></div>
      <footer class="console-form-actions"><button class="console-button ghost" type="button" @click="closeForm">取消</button><button class="console-button primary" type="button" :disabled="saving || catalogsLoading || catalogsFailed" @click="save">{{ saving ? '保存中…' : '保存异动单' }}</button></footer>
    </section>
  </div>
  <div v-if="workflowAction" class="console-modal-backdrop" role="presentation" @click.self="closeWorkflowAction">
    <section class="console-detail-modal personnel-workflow-modal" role="dialog" aria-modal="true" :aria-label="workflowAction.title">
      <header><div><p class="console-modal-eyebrow">人员异动流程</p><h2>{{ workflowAction.title }}</h2><p>凭据将随状态流转留存，用于审批和交接审计。</p></div><button class="console-modal-close" type="button" :disabled="workflowSaving" @click="closeWorkflowAction">×</button></header>
      <div class="console-modal-body"><p v-if="error" class="login-target-module__error" role="alert">{{ error }}</p><p v-if="workflowAction.kind === 'cancel'" class="console-card-hint">取消后该异动单不可恢复，也不会在生效日期执行。</p><p v-else-if="workflowAction.kind === 'execute'" class="console-card-hint">立即执行会马上变更该人员的任职与权限，并注销其现有登录会话（含下游单点登录），对方需重新登录获取新身份；执行后不可撤销，请确认审批与交接均已完成。</p><template v-else><div v-if="workflowAction.kind === 'handover'" class="personnel-handover-panel"><label v-if="!handoverNothingPending" class="console-form-item"><span>责任接收人 *</span><select v-model="handoverTargetUserId"><option value="">请选择在职接收人</option><option v-for="user in users.filter((candidate) => String(candidate.status || '').toUpperCase() === 'ACTIVE' && String(candidate.id || candidate.user_id) !== String(workflowAction.item.user_id))" :key="user.id || user.user_id" :value="user.id || user.user_id">{{ userLabel(user) }}</option></select></label><ul class="personnel-handover-list"><li v-for="item in handoverItems" :key="item.id"><span>{{ item.system }} · {{ item.resource_type }}</span><strong>{{ handoverStatusLabel(item) }}</strong><small v-if="item.next_retry_at">下次重试：{{ item.next_retry_at }}</small><small v-if="item.last_error_code">{{ item.last_error_code }}</small></li></ul><p v-if="handoverNothingPending" class="console-card-hint" role="status">责任交接项已全部完成，可直接点击「完成交接并排期」重试排期；系统会核对权威交接状态，不会重复写入已完成项。</p><p class="console-card-hint">本地责任由管理员确认；远端责任按机器协议转移并核对回执，全部成功后才允许排期离职，并自动生成交接凭据，无需手工填写编号；排期未成功时可直接重试，已完成项不会重复提交。</p></div><label v-if="!workflowAction.autoReference" class="console-form-item"><span>{{ workflowAction.prefix ? '交接凭据编号' : '审批凭据或驳回原因' }} *</span><input v-model="workflowReference" :placeholder="workflowAction.prefix ? '例如 HANDOVER-20260918-001' : '通过时填写审批记录编号，驳回时填写原因'"  maxlength="128"/></label></template></div>
      <footer class="console-form-actions"><button class="console-button ghost" type="button" :disabled="workflowSaving" @click="closeWorkflowAction">返回</button><button v-if="workflowAction.kind === 'approval'" class="console-button danger" type="button" :disabled="workflowSaving" @click="rejectWorkflowAction">驳回</button><button class="console-button primary" type="button" :disabled="workflowSaving" @click="confirmWorkflowAction">{{ workflowSaving ? '处理中…' : (workflowAction.kind === 'cancel' ? '确认取消' : (workflowAction.kind === 'execute' ? '确认立即执行' : (workflowAction.kind === 'handover' ? '完成交接并排期' : (workflowAction.kind === 'approval' ? '通过' : '确认完成')))) }}</button></footer>
    </section>
  </div>
  <div v-if="authorizationDetail" class="console-modal-backdrop" role="presentation" @click.self="closeAuthorization">
    <section class="console-detail-modal personnel-authorization-modal" role="dialog" aria-modal="true" aria-label="人员授权概览">
      <header><div><p class="console-modal-eyebrow">PERSON AUTHORIZATION WORKBENCH</p><h2>{{ authorizationDetail.userName }} · 授权概览</h2><p class="console-card-hint">统一查看岗位继承、组织继承、个人例外及应用同步状态。</p></div><button class="console-modal-close" type="button" @click="closeAuthorization">×</button></header>
      <p v-if="authorizationError" class="login-target-module__error" role="alert">{{ authorizationError }}</p>
      <p v-if="authorizationLoading" class="console-card-hint">正在读取已接入应用的有效授权…</p>
      <div v-else-if="!authorizationDetail.rows.length" class="settings-empty"><template v-if="authorizationError"><h3>授权信息暂时无法确认</h3><p>请处理上方提示后重新读取，当前不能判断该人员是否拥有应用权限。</p></template><template v-else><h3>暂无应用授权</h3><p>该人员当前没有可展示的应用权限，或尚未同步应用角色目录。</p></template></div>
      <div v-else class="personnel-authorization-list">
        <article v-for="row in authorizationDetail.rows" :key="row.app.id || row.app.code" class="personnel-authorization-card">
          <div class="personnel-authorization-card-head"><div><strong>{{ row.app.name || row.app.code }}</strong><small class="console-mono">{{ row.app.code }}</small></div><span class="console-badge" :class="{ 'status-active': syncStatus(row.access) === '已同步', 'status-disabled': syncStatus(row.access) === '冲突' }">{{ syncStatus(row.access) }}</span></div>
          <p v-if="row.access?.authorization_error" class="iam-field-help">{{ authorizationFailureMessage(row.access.authorization_error) }}</p>
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
.personnel-change-hero h2 { margin: 0; color: var(--text, #18253a); font-size: 22px; letter-spacing: -.02em; }
.personnel-change-hero p { max-width: 720px; margin: .45rem 0 0; line-height: 1.65; }
.iam-section-kicker { display: inline-flex; align-items: center; gap: .5rem; color: var(--muted, #6f8098); font-size: 11.5px; font-weight: 750; letter-spacing: .12em; }
.personnel-change-kicker-icon { display: inline-grid; place-items: center; width: 1.65rem; height: 1.65rem; color: #496fd0; background: #dfe9ff; border-radius: .55rem; }
.personnel-change-heading-actions { display: flex; align-items: center; gap: .6rem; flex-wrap: wrap; align-self: center; }
.personnel-change-heading-actions .console-button { white-space: nowrap; }
.personnel-handover-panel { display: grid; gap: .8rem; margin-bottom: .9rem; padding: .9rem; border: 1px solid var(--line-soft, #e5edf7); border-radius: .75rem; background: var(--sunken, #f8fafc); }
.personnel-handover-list { display: grid; gap: .45rem; margin: 0; padding: 0; list-style: none; }
.personnel-handover-list li { display: flex; justify-content: space-between; gap: 1rem; padding: .55rem .65rem; color: var(--secondary, #52647d); background: var(--card, #fff); border-radius: .55rem; }
.personnel-handover-list strong { color: #a15c16; font-size: 12px; }
.personnel-change-summary { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: .85rem; padding: 1.25rem 1.9rem; }
.personnel-summary-card { display: flex; align-items: center; gap: .8rem; min-width: 0; padding: 1rem 1.05rem; border: 1px solid var(--line-soft, #e5edf7); border-radius: .8rem; background: var(--card, #fff); box-shadow: 0 4px 16px rgba(44, 71, 120, .045); }
.personnel-summary-icon { display: grid; flex: 0 0 auto; place-items: center; width: 2.35rem; height: 2.35rem; border-radius: .7rem; }
.personnel-summary-card > div { display: grid; gap: .12rem; min-width: 0; }
.personnel-summary-label, .personnel-summary-card small { color: var(--muted, #71829b); font-size: 12.5px; }
.personnel-summary-card strong { color: var(--text, #18253a); font-size: 22px; line-height: 1.1; }
.personnel-summary-card.tone-violet .personnel-summary-icon { color: #6e52c7; background: #eee9ff; }
.personnel-summary-card.tone-orange .personnel-summary-icon { color: #bd6b19; background: #fff0dc; }
.personnel-summary-card.tone-blue .personnel-summary-icon { color: #3c70c9; background: #e4efff; }
.personnel-summary-card.tone-green .personnel-summary-icon { color: #25835a; background: #e2f6eb; }
.personnel-change-flow { margin: 0 1.9rem 1.2rem; padding: 1rem 1.1rem; border: 1px solid var(--line-soft, #e5edf7); border-radius: .8rem; background: var(--sunken, #f8fafc); }
.personnel-flow-title { display: flex; align-items: baseline; justify-content: space-between; gap: 1rem; margin-bottom: .8rem; }
.personnel-flow-title strong { color: var(--text, #263650); font-size: 14px; }
.personnel-flow-title small { color: var(--muted, #71829b); }
.personnel-change-flow ol { display: grid; grid-template-columns: repeat(4, 1fr); gap: .75rem; margin: 0; padding: 0; list-style: none; }
.personnel-change-flow li { display: flex; align-items: center; gap: .55rem; color: var(--secondary, #52647d); font-size: 13px; }
.personnel-change-flow li:not(:last-child)::after { content: '→'; margin-left: auto; color: #a8b8cc; }
.personnel-change-flow b { display: grid; place-items: center; width: 1.65rem; height: 1.65rem; color: #496fd0; background: #e4edff; border-radius: var(--radius-pill); font-size: 11px; }
.personnel-change-toolbar { display: flex; align-items: end; gap: .65rem; margin: 0 1.9rem 1rem; padding: .75rem; border: 1px solid var(--line-soft, #e5edf7); border-radius: .75rem; background: var(--card, #fff); }
.personnel-change-search, .personnel-change-select { display: grid; gap: .28rem; }
.personnel-change-search { position: relative; flex: 1 1 20rem; }
.personnel-change-search > svg { position: absolute; left: .75rem; bottom: .65rem; color: var(--muted, #71829b); }
.personnel-change-search input { padding-left: 2.2rem; }
.personnel-change-select { flex: 0 1 10rem; }
.personnel-change-select span { color: var(--muted, #71829b); font-size: 11.5px; }
.personnel-change-toolbar input, .personnel-change-toolbar select { width: 100%; min-height: 2.25rem; border: 1px solid var(--line-soft, #dce6f2); border-radius: .5rem; background: var(--sunken, #f8fafc); }
.personnel-change-toolbar input:focus, .personnel-change-toolbar select:focus { border-color: #7da3e8; box-shadow: 0 0 0 3px rgba(83, 129, 211, .12); outline: 0; }
.personnel-change-toolbar .console-button { min-height: 2.25rem; white-space: nowrap; }
.personnel-change-loading { display: flex; align-items: center; justify-content: center; gap: .55rem; min-height: 12rem; margin: 0 1.9rem 1.9rem; color: var(--muted, #71829b); }
.personnel-loading-dot { width: .55rem; height: .55rem; border-radius: var(--radius-pill); background: #6e91dc; box-shadow: .85rem 0 #b8c9ea, 1.7rem 0 #e0e8f7; margin-right: 1.7rem; }
.personnel-change-center > .console-card-body > .settings-empty { margin: 0 1.9rem 1.9rem; border: 1px dashed var(--line-strong, #ccd8e8); border-radius: .8rem; }
.personnel-change-table-shell { margin: 0 1.9rem 1.9rem; overflow: hidden; border: 1px solid var(--line-soft, #e0e8f2); border-radius: .8rem; background: var(--card, #fff); }
.personnel-change-table { overflow-x: auto; }
.personnel-change-row { display: grid; grid-template-columns: 1.25fr .95fr 1.55fr .85fr 1.1fr 1.55fr; gap: .8rem; align-items: center; min-width: 920px; padding: .85rem 1rem; border-top: 1px solid var(--line-soft, #edf1f7); }
.personnel-change-row:first-child { border-top: 0; }
.personnel-change-header { color: var(--muted, #71829b); background: var(--sunken, #f8fafc); font-size: 11.5px; font-weight: 700; }
.personnel-change-row:not(.personnel-change-header):hover { background: #fbfdff; }
.personnel-change-person, .personnel-change-person > span:last-child, .personnel-change-move { display: grid; gap: .18rem; min-width: 0; }
.personnel-change-person { display: flex; align-items: center; gap: .65rem; }
.personnel-person-avatar { display: grid; flex: 0 0 auto; place-items: center; width: 2rem; height: 2rem; color: #496fd0; background: #e4edff; border-radius: .65rem; font-weight: 750; }
.personnel-change-person strong, .personnel-change-move strong { overflow: hidden; color: var(--text, #263650); font-size: 13px; text-overflow: ellipsis; white-space: nowrap; }
.personnel-change-person small, .personnel-change-move small, .personnel-change-code { color: var(--muted, #8190a5); font-size: 11.5px; }
.personnel-change-type { color: var(--text, #34445d); font-weight: 650; }
.personnel-change-date { color: var(--secondary, #52647d); font-size: 13px; }
.personnel-change-actions { display: flex; gap: .4rem; flex-wrap: wrap; }
.compact { min-height: 2rem; padding: .35rem .68rem; font-size: 11.5px; }
.console-badge.status-draft, .console-badge.status-neutral, .console-badge.status-cancelled { color: #63748b; background: #edf1f5; }
.console-badge.status-pending { color: #a36213; background: #fff0d8; }
.console-badge.status-handover { color: #7351a9; background: #f0e9ff; }
.console-badge.status-scheduled { color: #2f65b4; background: #e6f0ff; }
.console-badge.status-executed { color: #20764e; background: #e0f5e9; }
.console-badge.status-rejected { color: #b34a4a; background: #ffebeb; }
.personnel-change-modal { display: flex; width: min(860px, 100%); max-height: min(820px, calc(100vh - 40px)); flex-direction: column; overflow: hidden; border: 1px solid #dce7f5; box-shadow: 0 24px 70px rgba(28, 54, 98, .2); }
.personnel-change-modal-header { position: relative; display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; overflow: hidden; padding: 1.45rem 1.75rem 1.25rem; background: linear-gradient(135deg, #f8fbff 0%, #edf4ff 100%); border-bottom: 1px solid var(--line-soft, #e5edf7); }
.personnel-change-modal-header::after { position: absolute; right: -4rem; bottom: -6rem; width: 15rem; height: 15rem; pointer-events: none; content: ''; border: 1.5rem solid rgba(110, 145, 220, .08); border-radius: var(--radius-pill); }
.personnel-change-modal-header .console-modal-close { position: relative; z-index: 2; flex: 0 0 auto; }
.personnel-change-modal-header > div { position: relative; z-index: 1; }
.personnel-change-modal-header h2 { margin: .35rem 0 0; color: var(--text, #18253a); font-size: 22px; letter-spacing: -.02em; }
.personnel-change-modal-header p:not(.console-modal-eyebrow) { margin: .4rem 0 0; color: var(--muted, #71829b); font-size: 12.5px; line-height: 1.5; }
.personnel-modal-eyebrow-icon { display: inline-grid; place-items: center; width: 1.35rem; height: 1.35rem; margin-right: .35rem; color: #496fd0; background: #dfe9ff; border-radius: .4rem; vertical-align: middle; }
.personnel-modal-eyebrow-icon svg { width: .8rem; height: .8rem; }
.personnel-change-modal-body { min-height: 0; flex: 1 1 auto; overflow-y: auto; padding: 1.35rem 1.75rem 1.5rem; }
.personnel-change-form-intro { display: flex; align-items: flex-start; gap: .7rem; margin-bottom: 1.15rem; padding: .8rem .9rem; border: 1px solid #dce8f7; border-radius: .7rem; background: #f7faff; }
.personnel-change-form-intro-icon { display: grid; flex: 0 0 auto; place-items: center; width: 1.9rem; height: 1.9rem; color: #4b70ca; background: #e3edff; border-radius: .55rem; }
.personnel-change-form-intro strong { color: #2d4f91; font-size: 13px; }
.personnel-change-form-intro p { margin: .18rem 0 0; color: var(--muted, #71829b); font-size: 11.5px; line-height: 1.5; }
.personnel-change-form-grid { padding: 1rem; border: 1px solid var(--line-soft, #e5edf7); border-radius: .75rem; background: #fff; }
.personnel-change-form-grid .console-form-item > span { color: var(--text, #34445d); font-weight: 650; }
.personnel-user-picker-row { display: flex; align-items: stretch; gap: .5rem; }
.personnel-user-picker-row select { flex: 1 1 auto; min-width: 0; }
.personnel-user-picker-row .console-button { flex: 0 0 auto; white-space: nowrap; }
.personnel-current-memberships { display: flex; flex-wrap: wrap; gap: .35rem; margin-top: .35rem; }
.personnel-current-membership { padding: .25rem .5rem; color: #2d4f91; border: 1px solid #dce8f7; border-radius: .4rem; background: #f1f6ff; font-size: 11.5px; }
.personnel-change-form-grid .console-form-item em { color: var(--muted, #8190a5); font-size: 11.5px; font-style: normal; font-weight: 400; }
.personnel-change-form-grid textarea { min-height: 5.5rem; resize: vertical; }
.personnel-change-modal .full { grid-column: 1 / -1; }
.personnel-preview { margin-top: 1rem; padding: 1rem; border: 1px solid #dce8f7; border-radius: .75rem; background: linear-gradient(135deg, #f8fbff, #f3f7fd); }
.personnel-preview-heading { display: flex; align-items: center; justify-content: space-between; gap: 1rem; }
.personnel-preview-heading > div { min-width: 0; }
.personnel-preview-heading strong { color: var(--text, #263650); font-size: 14px; }
.personnel-preview-heading p { margin: .25rem 0 0; color: var(--muted, #71829b); font-size: 11.5px; }
.personnel-preview-heading .console-button { display: inline-flex; align-items: center; gap: .35rem; white-space: nowrap; }
.personnel-preview-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: .65rem; margin-top: .8rem; }
.personnel-preview-grid > div { padding: .75rem; border: 1px solid var(--line-soft, #e5edf7); border-radius: .55rem; background: var(--card, #fff); }
.personnel-preview-grid span { display: block; color: var(--muted, #71829b); font-size: 12.5px; }
.personnel-preview-grid strong { display: block; margin-top: .25rem; color: var(--text, #263650); font-size: 16px; }
.personnel-preview-grid .preview-added { border-top: 3px solid #49a978; }
.personnel-preview-grid .preview-added strong { color: #25835a; }
.personnel-preview-grid .preview-removed { border-top: 3px solid #db7777; }
.personnel-preview-grid .preview-removed strong { color: #b34a4a; }
.personnel-preview-grid .preview-kept { border-top: 3px solid #7094d6; }
.personnel-preview-grid .preview-kept strong { color: #3c70c9; }
.personnel-change-modal > .console-form-actions { position: relative; z-index: 2; flex: 0 0 auto; margin: 0; padding: .9rem 1.75rem; border-top: 1px solid var(--line-soft, #e5edf7); background: rgba(255, 255, 255, .98); box-shadow: 0 -4px 14px rgba(28, 54, 98, .06); }
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
