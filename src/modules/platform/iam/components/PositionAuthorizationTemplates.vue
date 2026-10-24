<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { formatUserError } from '../../../shared/utils/userError.js'
import ConsoleIcon from '@/modules/platform/shared/components/ConsoleIcon.vue'
import RoleMultiSelect from './RoleMultiSelect.vue'
import {
  assignableActiveCatalogRoles,
  catalogMaxEffectiveRoles,
  catalogSyncText,
  catalogVersion,
  isCatalogSynchronized,
} from '@/modules/platform/iam/utils/applicationAuthorizationCatalog'
import { positionAuthorizationTargetCatalog } from '@/modules/platform/iam/utils/positionAuthorizationCatalog'
import { hasPermission } from '@/modules/platform/auth/utils/principal'
import { IAM_PERMISSIONS } from '@/modules/platform/iam/utils/iamPermissions'
import { inspectPositionTemplateDuplicates } from '@/modules/platform/iam/utils/positionAuthorizationDuplicates'
import { useRelatedDataInvalidation } from '@/modules/platform/shared/composables/useRelatedDataInvalidation'
import { RELATED_DATA } from '@/modules/platform/shared/utils/relatedDataInvalidation'
import {
  authorizationPositionGroupLabel,
  authorizationPositionOptionLabel,
  groupAuthorizationPositions,
} from '@/modules/platform/iam/utils/selectionCatalog'
import {
  createPositionAuthorizationTemplate,
  deletePositionAuthorizationTemplate,
  getPositionAuthorizationTemplate,
  updatePositionAuthorizationTemplate,
  listPositionAuthorizationTemplateAssignments,
  listPositionAuthorizationTargets,
  listPositionAuthorizationPositions,
  listPositionAuthorizationTemplates,
  previewPositionAuthorization,
  replacePositionAuthorizationTemplateAssignments,
} from '@/modules/platform/iam/api/positionAuthorization'

const emit = defineEmits(['toast'])
const canReadAuthorization = computed(() => hasPermission(IAM_PERMISSIONS.roleBindingRead))
const canManageAuthorization = computed(() => hasPermission(IAM_PERMISSIONS.roleBindingUpdate))
const loading = ref(false)
const saving = ref(false)
const templates = ref([])
const positions = ref([])
const applications = ref([])
const selectedPositionId = ref('')
const assignedTemplateIds = ref([])
// 保存原始映射时间窗；勾选集合不能承载每条映射的有效期。
const assignedTemplateEntries = ref([])
const duplicateCheckResult = ref(null)
const templatePage = ref(1)
const templatePageSize = 6
const editingTemplateId = ref('')
const editingTemplateVersion = ref(0)
// 通用确认弹窗。不用 window.confirm 是为了避免在 WebView 容器里静默失败。
const confirmDialog = ref(null)
// 目录重新读取后只清理确实失效的岗位选择并说明原因，不影响编辑器中已填写的模板内容。
const selectionNotice = ref('')
// 当前已加载完成的岗位及其加载状态：只有加载完成的当前岗位才允许保存映射。
const assignmentsLoading = ref(false)
const loadedAssignmentsPositionId = ref('')
// 不透明集合版本必须与读取到的岗位和条目一起更新，不能用新的 GET 给旧草稿补版本。
const assignmentsRevision = ref('')
const assignmentsNotice = ref('')
const savingAssignments = ref(false)
function openConfirm({ title, description, confirmText = '确认', danger = false, onConfirm }) {
  confirmDialog.value = { title, description, confirmText, danger, busy: false, onConfirm }
}
function closeConfirm() {
  if (confirmDialog.value?.busy) return
  confirmDialog.value = null
}
async function runConfirm() {
  const dialog = confirmDialog.value
  if (!dialog || dialog.busy) return
  dialog.busy = true
  try {
    const completed = await dialog.onConfirm()
    if (completed !== false && confirmDialog.value === dialog) confirmDialog.value = null
  } catch {
    // 业务回调负责展示错误提示；异常时保留弹窗，避免误判为成功。
  } finally {
    if (confirmDialog.value === dialog) dialog.busy = false
  }
}
const preview = ref(null)
// 编辑器内的"挂载预览"独立 state：与下方页面级 `preview` 共享同一接口，但保留专属 loading / unavailable 态，
// 以便在模板编辑卡片内独立显示骨架、错误与刷新按钮，而不影响已有的"授权预览与影响分析"卡片渲染。
const editorPreview = ref(null)
const editorPreviewLoading = ref(false)
const editorPreviewUnavailable = ref(false)
const positionPreviewRef = ref(null)
let editorPreviewRequest = 0
let previewRequest = 0
const emptySubsystemRole = () => ({
  application_id: '',
  role_ids: [],
  scope_type: 'TENANT',
  scope_id: '',
})
const form = ref({
  name: '',
  description: '',
  platform_application_id: '',
  platform_role_ids: [],
  platform_scope_type: 'TENANT',
  platform_scope_id: '',
  additional_roles: [],
})
const catalogs = ref({})

function items(data) { return Array.isArray(data?.items) ? data.items : (Array.isArray(data) ? data : []) }
function id(item, ...keys) { return keys.map((key) => item?.[key]).find(Boolean) || '' }
function applicationId(item) { return id(item, 'application_id', 'id') }
function positionId(item) { return id(item, 'position_id', 'id') }
function positionName(item) { return item?.name || item?.position_name || item?.code || item?.position_code || positionId(item) }
function templateId(item) { return id(item, 'template_id', 'id') }
function roleItems(catalog) {
  return assignableActiveCatalogRoles(catalog).filter((role) => Boolean(roleId(role)))
}

function catalogForApplication(applicationIdValue) {
  return catalogs.value[applicationIdValue] || null
}

function catalogIsReady(applicationIdValue) {
  return isCatalogSynchronized(catalogForApplication(applicationIdValue))
}

function maxEffectiveRolesFor(applicationIdValue) {
  return catalogMaxEffectiveRoles(catalogForApplication(applicationIdValue))
}

function roleId(role) { return id(role, 'role_id', 'id') }
function roleName(role) { return role?.name || role?.role_name || role?.code || roleId(role) }
function appName(app) { return app?.name || app?.application_name || app?.code || applicationId(app) }
function templateRoles(template) { return items(template?.roles) }
function templateRoleLabel(role) {
  return `${role?.application_name || role?.application_code || '应用'} / ${role?.role_name || role?.role_code || '未命名角色'}`
}
function templateRoleLabels(template) { return templateRoles(template).map(templateRoleLabel) }
function templateRoleApplicationId(role) { return String(role?.application_id || role?.applicationId || '').trim() }
function templateRoleScopeType(role) { return String(role?.scope_type || role?.scopeType || 'TENANT').trim() || 'TENANT' }
function templateRoleScopeId(role) { return templateRoleScopeType(role) === 'ENVIRONMENT' ? String(role?.scope_id || role?.scopeId || '').trim() : '' }

// 兼容旧版模板详情：部分历史数据只保存了应用/角色名称或编码，没有回传稳定 ID。
// 目标目录已经同时返回应用和角色的稳定 ID，因此编辑时按“ID → 编码 → 名称”顺序补全，
// 不改变展示语义，也不允许凭空生成角色 ID。
function resolveTemplateRole(role) {
  const applicationCode = String(role?.application_code || role?.applicationCode || '').trim()
  const applicationName = String(role?.application_name || role?.applicationName || '').trim()
  const application = applications.value.find((item) => {
    const itemId = applicationId(item)
    const itemCode = String(item?.application_code || item?.code || '').trim()
    const itemName = String(item?.application_name || item?.name || '').trim()
    return (templateRoleApplicationId(role) && itemId === templateRoleApplicationId(role))
      || (applicationCode && itemCode === applicationCode)
      || (applicationName && itemName === applicationName)
  })
  const resolvedApplicationId = templateRoleApplicationId(role) || applicationId(application)
  const targetRoles = Array.isArray(application?.roles) ? application.roles : []
  const roleCode = String(role?.role_code || role?.roleCode || '').trim()
  const roleName = String(role?.role_name || role?.roleName || '').trim()
  const targetRole = targetRoles.find((item) => {
    const itemId = roleId(item)
    const itemCode = String(item?.role_code || item?.code || '').trim()
    const itemName = String(item?.role_name || item?.name || '').trim()
    return (roleId(role) && itemId === roleId(role))
      || (roleCode && itemCode === roleCode)
      || (roleName && itemName === roleName)
  })
  return {
    application_id: resolvedApplicationId,
    role_id: roleId(role) || roleId(targetRole),
  }
}

// 将后端模板明细转换为编辑器的“主应用 + 追加应用”结构。模板角色可能来自旧版本
// 接口（ID 为数字或字符串、字段采用 camelCase），这里统一成字符串并按应用/范围分组，
// 确保销售模板同时包含合同管理和商机管理角色时，两组都会回填到编辑器。
function templateEditorForm(template) {
  const groups = new Map()
  templateRoles(template).forEach((role) => {
    const resolved = resolveTemplateRole(role)
    const applicationIdValue = resolved.application_id
    const scopeType = templateRoleScopeType(role)
    const scopeId = templateRoleScopeId(role)
    const roleIdValue = resolved.role_id
    if (!applicationIdValue || !roleIdValue) return
    const validFrom = role.valid_from ?? null
    const validUntil = role.valid_until ?? null
    const key = JSON.stringify([applicationIdValue, scopeType, scopeId, validFrom, validUntil])
    const group = groups.get(key) || {
      application_id: applicationIdValue,
      role_ids: [],
      scope_type: scopeType,
      scope_id: scopeId,
      valid_from: validFrom,
      valid_until: validUntil,
    }
    if (!group.role_ids.includes(roleIdValue)) group.role_ids.push(roleIdValue)
    groups.set(key, group)
  })
  const [primary, ...additional] = [...groups.values()]
  return {
    platform_application_id: primary?.application_id || '',
    platform_role_ids: primary?.role_ids || [],
    platform_scope_type: primary?.scope_type || 'TENANT',
    platform_scope_id: primary?.scope_id || '',
    platform_valid_from: primary?.valid_from ?? null,
    platform_valid_until: primary?.valid_until ?? null,
    valid_from: template?.valid_from ?? null,
    valid_until: template?.valid_until ?? null,
    additional_roles: additional,
  }
}
const templateApplications = computed(() => applications.value)
const activeTemplates = computed(() => templates.value.filter((template) => String(template?.status || '').toUpperCase() === 'ACTIVE'))
const templatePageCount = computed(() => Math.max(1, Math.ceil(activeTemplates.value.length / templatePageSize)))
const pagedActiveTemplates = computed(() => {
  const start = (templatePage.value - 1) * templatePageSize
  return activeTemplates.value.slice(start, start + templatePageSize)
})
const positionGroups = computed(() => groupAuthorizationPositions(positions.value))

function setTemplatePage(page) {
  templatePage.value = Math.min(Math.max(1, page), templatePageCount.value)
}

watch(activeTemplates, () => {
  if (templatePage.value > templatePageCount.value) templatePage.value = templatePageCount.value
})

async function load() {
  if (!canReadAuthorization.value) return
  loading.value = true
  try {
    // 专用目标端点同时返回稳定平台角色 ID 和编辑器所需的授权目录就绪状态。这里不能调用
    // 更宽泛的应用目录 API：角色绑定管理员可能合理地没有 platform:application:read。
    const [templateResult, positionResult, targetResult] = await Promise.allSettled([
      listPositionAuthorizationTemplates(),
      listPositionAuthorizationPositions(),
      listPositionAuthorizationTargets(),
    ])
    const failures = []
    if (templateResult.status === 'fulfilled') templates.value = items(templateResult.value)
    else failures.push(templateResult.reason)
    if (positionResult.status === 'fulfilled') positions.value = items(positionResult.value)
    else failures.push(positionResult.reason)
    if (targetResult.status === 'fulfilled') {
      const targetApplications = items(targetResult.value)
      const nextCatalogs = {}
      applications.value = targetApplications
      targetApplications.forEach((application) => {
        nextCatalogs[applicationId(application)] = positionAuthorizationTargetCatalog(application)
      })
      catalogs.value = nextCatalogs
    } else {
      applications.value = []
      catalogs.value = {}
      failures.push(targetResult.reason)
    }
    if (!selectedPositionId.value && positions.value.length) selectedPositionId.value = positionId(positions.value[0])
    if (selectedPositionId.value && !positions.value.some((item) => positionId(item) === selectedPositionId.value)) {
      // 岗位已停用或不再可见：清除选择并说明原因，避免继续显示该岗位的授权预览。
      selectionNotice.value = '原选岗位已停用或不再对当前账号可见，已清除岗位选择；请重新选择岗位后再查看授权预览。'
      selectedPositionId.value = ''
      assignedTemplateIds.value = []
      preview.value = null
      editorPreview.value = null
    }
    if (selectedPositionId.value) await loadAssignments()
    if (failures.length) {
      const error = failures[0]
      emit('toast', formatUserError(error, { fallback: '部分岗位授权数据读取失败，请检查当前账号权限。' }))
    }
  } finally {
    loading.value = false
  }
}

// 岗位切换会连续触发多次读取：上一次岗位的绑定可能在切换之后才返回。若不校验，
// A 岗位的模板会被填进已切到 B 的勾选状态，随后"保存岗位映射"就把 A 的模板写给 B。
// 序号 + 岗位 ID 双重校验保证只有当前岗位的响应可以回写，加载完成前也不允许保存。
let assignmentsRequestSeq = 0

async function loadAssignments() {
  duplicateCheckResult.value = null
  const seq = ++assignmentsRequestSeq
  assignmentsLoading.value = false
  loadedAssignmentsPositionId.value = ''
  assignmentsRevision.value = ''
  assignmentsNotice.value = ''
  const positionId = String(selectedPositionId.value || '')
  // 岗位一切换就使旧预览失效，无需等待新映射请求完成。
  previewRequest += 1
  editorPreviewRequest += 1
  preview.value = null
  editorPreview.value = null
  editorPreviewLoading.value = false
  editorPreviewUnavailable.value = false
  assignedTemplateEntries.value = []
  if (!positionId || !canReadAuthorization.value) {
    assignmentsLoading.value = false
    loadedAssignmentsPositionId.value = ''
    assignedTemplateIds.value = []
    preview.value = null
    editorPreview.value = null
    editorPreviewUnavailable.value = false
    return
  }
  assignmentsLoading.value = true
  loadedAssignmentsPositionId.value = ''
  assignedTemplateIds.value = []
  try {
    const data = await listPositionAuthorizationTemplateAssignments(positionId)
    if (!isCurrentAssignmentsRequest(seq, positionId)) return
    assignedTemplateEntries.value = items(data).filter((item) => String(item?.status || '').toUpperCase() === 'ACTIVE')
    assignedTemplateIds.value = assignedTemplateEntries.value.map((item) => item.template?.template_id || item.template_id)
    loadedAssignmentsPositionId.value = positionId
    assignmentsRevision.value = typeof data?.revision === 'string' && data.revision.trim() ? data.revision : ''
    if (!assignmentsRevision.value) assignmentsNotice.value = '未能读取岗位映射版本，请重新加载岗位映射后核对再保存。'
    // 页面级 preview 与编辑器挂载预览共用同一接口，并行拉取避免遮挡主流程。
    await Promise.all([loadPreview(), loadEditorPreview()])
  } catch (error) {
    if (!isCurrentAssignmentsRequest(seq, positionId)) return
    loadedAssignmentsPositionId.value = ''
    assignmentsRevision.value = ''
    emit('toast', formatUserError(error, { fallback: '读取岗位授权配置失败。' }))
  } finally {
    if (seq === assignmentsRequestSeq) assignmentsLoading.value = false
  }
}

function isCurrentAssignmentsRequest(seq, positionId) {
  return seq === assignmentsRequestSeq && positionId === String(selectedPositionId.value || '')
}

function onApplicationChange(row) { row.role_ids = [] }
function onPlatformApplicationChange() { form.value.platform_role_ids = [] }
function addAdditionalRoleGroup() { form.value.additional_roles.push(emptySubsystemRole()) }
function removeAdditionalRoleGroup(index) { form.value.additional_roles.splice(index, 1) }
function resetTemplateForm() {
  form.value = {
    name: '',
    description: '',
    platform_application_id: '',
    platform_role_ids: [],
    platform_scope_type: 'TENANT',
    platform_scope_id: '',
    additional_roles: [],
  }
  editingTemplateId.value = ''
  editingTemplateVersion.value = 0
}
async function editTemplate(template) {
  if (!canManageAuthorization.value || saving.value) return
  let fullTemplate = template
  // 列表摘要或旧缓存可能没有 roles；编辑时补读详情，确保历史授权完整回填。
  if (!templateRoles(fullTemplate).length && templateId(template)) {
    saving.value = true
    try {
      fullTemplate = await getPositionAuthorizationTemplate(templateId(template))
    } catch (error) {
      emit('toast', formatUserError(error, { fallback: '读取模板授权明细失败。' }))
      return
    } finally {
      saving.value = false
    }
  }
  const editorRoles = templateEditorForm(fullTemplate)
  if (!editorRoles.platform_application_id || !editorRoles.platform_role_ids.length) {
    emit('toast', '该模板当前没有可编辑的应用角色。')
    return
  }
  editingTemplateId.value = templateId(fullTemplate)
  editingTemplateVersion.value = Number(fullTemplate.version || 0)
  form.value = {
    name: fullTemplate.name || '',
    description: fullTemplate.description || '',
    ...editorRoles,
  }
  window.setTimeout(() => document.querySelector('.iam-template-editor')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0)
}

async function createTemplate() {
  if (!canManageAuthorization.value) return
  const name = String(form.value.name || '').trim()
  const roles = []
  ;(Array.isArray(form.value.platform_role_ids) ? form.value.platform_role_ids : []).forEach((roleIdValue) => {
    if (!form.value.platform_application_id || !roleIdValue) return
    roles.push({
      application_id: form.value.platform_application_id,
      role_id: roleIdValue,
      scope_type: form.value.platform_scope_type,
      scope_id: form.value.platform_scope_type === 'ENVIRONMENT'
        ? String(form.value.platform_scope_id || '').trim()
        : '',
      valid_from: form.value.platform_valid_from ?? null,
      valid_until: form.value.platform_valid_until ?? null,
    })
  })
  form.value.additional_roles.forEach((row) => {
    ;(Array.isArray(row.role_ids) ? row.role_ids : []).forEach((roleIdValue) => {
      if (!row.application_id || !roleIdValue) return
      roles.push({
        application_id: row.application_id,
        role_id: roleIdValue,
        scope_type: row.scope_type || 'TENANT',
        scope_id: row.scope_type === 'ENVIRONMENT' ? String(row.scope_id || '').trim() : '',
        valid_from: row.valid_from ?? null,
        valid_until: row.valid_until ?? null,
      })
    })
  })
  if (!name || !roles.length) {
    emit('toast', '请填写模板名称并选择一个应用角色。')
    return
  }
  saving.value = true
  try {
    const payload = {
      name,
      description: String(form.value.description || '').trim(),
      status: 'ACTIVE',
      valid_from: form.value.valid_from ?? null,
      valid_until: form.value.valid_until ?? null,
      roles,
    }
    if (editingTemplateId.value) {
      await updatePositionAuthorizationTemplate(editingTemplateId.value, { ...payload, version: editingTemplateVersion.value })
      emit('toast', '岗位授权模板已更新。')
    } else {
      await createPositionAuthorizationTemplate(payload)
      emit('toast', '标准岗位授权模板已创建。')
    }
    resetTemplateForm()
    await load()
  } catch (error) {
    emit('toast', formatUserError(error, { fallback: '创建岗位授权模板失败。' }))
  } finally {
    saving.value = false
  }
}

async function saveAssignments() {
  if (!canManageAuthorization.value || saving.value) return
  const positionId = String(selectedPositionId.value || '')
  if (!positionId) return
  // 目录尚未确认或仍停留在上一个岗位时不允许保存：勾选状态可能属于另一个岗位。
  if (assignmentsLoading.value || loadedAssignmentsPositionId.value !== positionId) {
    emit('toast', '正在读取该岗位的现有模板映射，请等待加载完成后再保存。')
    return
  }
  const expectedRevision = assignmentsRevision.value
  if (!expectedRevision) {
    emit('toast', assignmentsNotice.value || '未能读取岗位映射版本，请重新加载岗位映射后核对再保存。')
    return
  }
  const seq = assignmentsRequestSeq
  saving.value = true
  savingAssignments.value = true
  try {
    const assignments = assignedTemplateIds.value.map((template_id) => {
      const existing = assignedTemplateEntries.value.find((item) => (item.template?.template_id || item.template_id) === template_id)
      return { template_id, status: 'ACTIVE', valid_from: existing?.valid_from ?? null, valid_until: existing?.valid_until ?? null }
    })
    const data = await replacePositionAuthorizationTemplateAssignments(positionId, assignments, expectedRevision)
    if (!isCurrentAssignmentsRequest(seq, positionId)) return
    // 只接收本次 PUT 的原子快照；重读可能已包含别人的下一次改动。
    const revision = typeof data?.revision === 'string' && data.revision.trim() ? data.revision : ''
    assignmentsRevision.value = ''
    if (!Array.isArray(data?.items) || !revision) {
      assignmentsNotice.value = '岗位映射已保存，但未能读取保存后的版本，请重新加载岗位映射后核对。'
      emit('toast', assignmentsNotice.value)
      return
    }
    assignedTemplateEntries.value = data.items.filter((item) => String(item?.status || '').toUpperCase() === 'ACTIVE')
    assignedTemplateIds.value = assignedTemplateEntries.value.map((item) => item.template?.template_id || item.template_id)
    assignmentsRevision.value = revision
    assignmentsNotice.value = ''
    await Promise.all([loadPreview(), loadEditorPreview()])
    if (!isCurrentAssignmentsRequest(seq, positionId)) return
    runAssignmentDuplicateCheck(false)
    emit('toast', '标准岗位授权模板映射已保存；有效任职关系将动态继承这些角色。')
  } catch (error) {
    if (!isCurrentAssignmentsRequest(seq, positionId)) return
    const message = formatUserError(error, { fallback: '保存岗位授权配置失败。' })
    if (Number(error?.status) === 409) {
      assignmentsRevision.value = ''
      assignmentsNotice.value = `${message} 当前草稿已保留，请重新加载岗位映射后核对再保存。`
      emit('toast', assignmentsNotice.value)
    } else {
      emit('toast', message)
    }
  } finally {
    savingAssignments.value = false
    saving.value = false
  }
}

function runAssignmentDuplicateCheck(notify = true) {
  if (!selectedPositionId.value) {
    if (notify) emit('toast', '请先选择需要查重的目标岗位。')
    return null
  }
  duplicateCheckResult.value = inspectPositionTemplateDuplicates(activeTemplates.value, assignedTemplateIds.value)
  if (!notify) return duplicateCheckResult.value
  if (!assignedTemplateIds.value.length) {
    emit('toast', '当前岗位尚未勾选授权模板，没有需要查重的内容。')
  } else if (duplicateCheckResult.value.duplicate_group_count) {
    emit('toast', `查重完成：发现 ${duplicateCheckResult.value.duplicate_group_count} 组重复权限，请核对来源模板。`)
  } else {
    emit('toast', '查重完成：所选模板之间没有重复权限。')
  }
  return duplicateCheckResult.value
}

function duplicateScopeLabel(item) {
  return item.scope_type === 'ENVIRONMENT' ? `环境范围（${item.scope_id || '未指定环境'}）` : '租户范围'
}

async function loadPreview() {
  const requestId = ++previewRequest
  const positionId = String(selectedPositionId.value || '')
  preview.value = null
  if (!positionId) return
  const isCurrent = () => requestId === previewRequest && positionId === String(selectedPositionId.value || '')
  try {
    const result = await previewPositionAuthorization({ position_id: positionId, inherit_authorization: true })
    if (isCurrent()) preview.value = result
  } catch {
    if (isCurrent()) preview.value = null
  }
}

// 后端 preview 接口是 position 级别（不是 template / user 级别），因此编辑器内的"挂载预览"
// 只能展示"该岗位当前已分配模板将产生的角色与 CONFLICT"，不能直接模拟"未保存草稿"的影响。
// 在面板文案中明确说明这一限制，并在模板保存后引导用户到"将模板应用到岗位"完成分配。
async function loadEditorPreview() {
  const requestId = ++editorPreviewRequest
  const positionId = String(selectedPositionId.value || '')
  const isCurrent = () => requestId === editorPreviewRequest && positionId === String(selectedPositionId.value || '')
  editorPreview.value = null
  if (!positionId) {
    editorPreviewLoading.value = false
    editorPreview.value = null
    editorPreviewUnavailable.value = false
    return
  }
  editorPreviewLoading.value = true
  editorPreviewUnavailable.value = false
  try {
    const result = await previewPositionAuthorization({ position_id: positionId, inherit_authorization: true })
    if (!isCurrent()) return
    editorPreview.value = result
  } catch {
    if (!isCurrent()) return
    editorPreview.value = null
    editorPreviewUnavailable.value = true
  } finally {
    if (isCurrent()) editorPreviewLoading.value = false
  }
}

async function deleteTemplate(template) {
  if (!canManageAuthorization.value) return
  openConfirm({
    title: '确认删除岗位授权模板',
    description: `确认删除岗位授权模板“${template.name}”吗？\n\n删除后：\n1. 该模板不再出现在岗位映射列表；\n2. 该模板生成的岗位角色授权将被撤销；\n3. 用户、岗位或组织的手工授权不会被删除；\n4. 授权和审计历史仍会保留。`,
    confirmText: '确认删除',
    danger: true,
    onConfirm: async () => {
      try {
        await deletePositionAuthorizationTemplate(templateId(template), template.version)
        assignedTemplateIds.value = assignedTemplateIds.value.filter((idValue) => idValue !== templateId(template))
        emit('toast', '岗位授权模板已删除，相关岗位继承授权已撤销。')
        await load()
      } catch (error) {
        emit('toast', formatUserError(error, { fallback: '删除岗位授权模板失败。' }))
        return false
      } finally {
        closeConfirm()
      }
    },
  })
}

const selectedPosition = computed(() => positions.value.find((item) => positionId(item) === selectedPositionId.value))
const isEditingTemplate = computed(() => Boolean(editingTemplateId.value))

// 本地模板草稿统计：模板保存当前下拉框选中的应用角色。
const templateDraftStats = computed(() => {
  const valid = form.value.platform_role_ids.length
    ? [{
      application_id: form.value.platform_application_id,
      scope_type: form.value.platform_scope_type,
      role_count: form.value.platform_role_ids.length,
    }]
    : []
  const additional = form.value.additional_roles.filter((row) => (
    row.application_id && Array.isArray(row.role_ids) && row.role_ids.length
  ))
  return {
    totalRows: valid.length + additional.length,
    validRows: valid.length + additional.length,
    distinctApps: new Set([...valid.map((row) => row.application_id), ...additional.map((row) => row.application_id)]).size,
    environmentRows:
      valid.filter((row) => row.scope_type === 'ENVIRONMENT').length
      + additional.filter((row) => row.scope_type === 'ENVIRONMENT').length,
  }
})
const editorPreviewRoles = computed(() => Array.isArray(editorPreview.value?.roles) ? editorPreview.value.roles : [])
const editorPreviewConflicts = computed(() => Array.isArray(editorPreview.value?.conflicts) ? editorPreview.value.conflicts : [])

function scrollToPositionPreview() {
  const target = positionPreviewRef.value
  if (!target) return
  target.scrollIntoView({ behavior: 'smooth', block: 'center' })
  // 滚动到位后给现有预览卡片一个 1.6s 的描边高亮，便于用户在多卡片页面定位。
  target.classList.add('is-flash')
  window.setTimeout(() => target.classList.remove('is-flash'), 1600)
}

// 岗位目录、授权模板、岗位映射或角色目录在其他入口变更后，立即重新读取目录与预览；
// 预览是按岗位现算的，目录变化后旧预览不再代表当前授权。
function handleRelatedAuthorizationChange(event) {
  if (event.type === 'session') return
  if (!canReadAuthorization.value) return
  // API 成功会同步发布通知：本次映射保存直接使用 PUT 快照；冲突草稿等显式重载。
  if (savingAssignments.value || assignmentsNotice.value) return
  selectionNotice.value = ''
  load()
}
useRelatedDataInvalidation(handleRelatedAuthorizationChange, {
  kinds: [
    RELATED_DATA.POSITIONS,
    RELATED_DATA.AUTHORIZATION_TEMPLATES,
    RELATED_DATA.ROLE_CATALOG,
    RELATED_DATA.APPLICATIONS,
  ],
})

watch(selectedPositionId, loadAssignments)
watch(assignedTemplateIds, () => { duplicateCheckResult.value = null }, { deep: true })
defineExpose({ reload: load })
onMounted(() => {
  if (canReadAuthorization.value) load()
})
</script>

<template>
  <section class="iam-table-section iam-position-authorization">
    <div v-if="canManageAuthorization" class="console-table-card iam-template-editor">
      <header class="iam-template-card-head">
        <div class="iam-template-card-title">
          <span class="iam-template-card-icon"><ConsoleIcon name="shield" /></span>
          <div>
            <h4>{{ isEditingTemplate ? '编辑岗位授权模板' : '新建岗位授权模板' }}</h4>
            <p>把岗位与应用角色建立标准映射，员工任职生效后即可动态继承平台及子系统权限。</p>
          </div>
        </div>
        <span class="iam-standard-authorization-badge">标准授权</span>
      </header>
      <div class="iam-template-grid">
        <label><span>模板名称 *</span><input v-model="form.name" placeholder="例如 销售人员授权模板"  maxlength="128"/></label>
        <label class="full"><span>说明</span><input v-model="form.description" placeholder="说明适用岗位和授权范围"  maxlength="1000"/></label>
      </div>
      <div class="iam-template-guidance">
        <ConsoleIcon name="info" />
        <p>{{ isEditingTemplate ? '以下内容已从现有模板回填。可调整应用和角色，保存时保留模板及各组角色原有效期；本页面不编辑日期。' : '模板可选择一个应用并多选角色，也可追加多个子系统及其多个角色。下拉框同时展示基础平台和所有已同步子系统，角色目录由各应用维护并只读同步，保存时按稳定角色 ID 写入。' }}</p>
      </div>
      <div v-if="isEditingTemplate" class="iam-template-editing-notice">
        <ConsoleIcon name="edit" />
        <span>正在编辑：{{ form.name }}<small>已回填 {{ templateDraftStats.validRows }} 个应用角色</small></span>
        <button class="console-text-button" type="button" :disabled="saving" @click="resetTemplateForm">取消编辑</button>
      </div>
      <p v-if="!loading && !applications.length" class="iam-field-help">暂无可授权的目标应用。请确认应用已启用；子系统还需要成功同步至少一个 ACTIVE 且可分配的角色。</p>
      <div class="iam-template-roles">
          <div class="iam-template-role-row iam-template-primary-role-row">
            <div class="iam-template-catalog-field">
              <select v-model="form.platform_application_id" aria-label="选择应用" @change="onPlatformApplicationChange"><option value="">选择应用（平台或子系统）</option><option v-for="app in templateApplications" :key="applicationId(app)" :value="applicationId(app)">{{ appName(app) }}</option></select>
              <small v-if="form.platform_application_id">目录 {{ catalogVersion(catalogForApplication(form.platform_application_id)) }} · {{ catalogSyncText(catalogForApplication(form.platform_application_id)) }}</small>
            </div>
            <RoleMultiSelect
              v-model="form.platform_role_ids"
              :roles="roleItems(catalogForApplication(form.platform_application_id))"
              :ready="Boolean(form.platform_application_id && catalogIsReady(form.platform_application_id))"
              :max-effective-roles="maxEffectiveRolesFor(form.platform_application_id)"
            />
            <select v-model="form.platform_scope_type"><option value="TENANT">租户范围</option><option value="ENVIRONMENT">环境范围</option></select>
            <input v-if="form.platform_scope_type === 'ENVIRONMENT'" v-model="form.platform_scope_id" placeholder="环境 ID"  maxlength="128"/>
          </div>
          <div
            v-for="(row, index) in form.additional_roles"
            :key="`additional-role-${index}`"
            class="iam-template-role-row iam-template-subsystem-role-row"
          >
            <div class="iam-template-catalog-field">
              <select v-model="row.application_id" aria-label="选择追加子系统" @change="onApplicationChange(row)">
                <option value="">选择追加应用</option>
                <option v-for="app in templateApplications" :key="applicationId(app)" :value="applicationId(app)">{{ appName(app) }}</option>
              </select>
              <small v-if="row.application_id">目录 {{ catalogVersion(catalogForApplication(row.application_id)) }} · {{ catalogSyncText(catalogForApplication(row.application_id)) }}</small>
            </div>
            <RoleMultiSelect
              v-model="row.role_ids"
              :roles="roleItems(catalogForApplication(row.application_id))"
              :ready="Boolean(row.application_id && catalogIsReady(row.application_id))"
              :max-effective-roles="maxEffectiveRolesFor(row.application_id)"
              empty-text="请先选择已同步应用"
            />
            <select v-model="row.scope_type"><option value="TENANT">租户范围</option><option value="ENVIRONMENT">环境范围</option></select>
            <input v-if="row.scope_type === 'ENVIRONMENT'" v-model="row.scope_id" placeholder="环境 ID"  maxlength="128"/>
            <button class="console-text-button danger" type="button" @click="removeAdditionalRoleGroup(index)">移除</button>
          </div>
          <button class="console-button ghost small iam-template-add-role-button" type="button" @click="addAdditionalRoleGroup">
            <ConsoleIcon name="plus" />追加子系统
          </button>
      </div>
      <div class="iam-template-mount-preview" aria-label="挂载预览（保存前影响分析）">
        <div class="iam-template-mount-head">
          <span class="iam-template-card-icon is-green"><ConsoleIcon name="shield" /></span>
          <div>
            <h5>挂载预览（保存前影响分析）</h5>
            <p>左侧"本地模板草稿"实时统计当前编辑内容；右侧"岗位实时影响"展示下方所选岗位当前已分配模板产生的角色与 CONFLICT。模板保存后还要在下方"将模板应用到岗位"中分配到岗位，授权才会对任职用户实际生效。</p>
          </div>
        </div>
        <div class="iam-template-mount-grid">
          <div class="iam-mount-tile is-local">
            <div class="iam-mount-tile-head"><span class="iam-mount-tile-dot is-local" />本地模板草稿</div>
            <dl>
              <div><dt>已配置角色</dt><dd>{{ templateDraftStats.validRows }}<small> / {{ templateDraftStats.totalRows }} 行</small></dd></div>
              <div><dt>涉及应用</dt><dd>{{ templateDraftStats.distinctApps }}</dd></div>
              <div><dt>环境范围</dt><dd>{{ templateDraftStats.environmentRows }}</dd></div>
            </dl>
            <p v-if="!templateDraftStats.validRows" class="iam-mount-tile-empty">尚未选择任何"应用 + 实际角色"，保存后不会继承任何应用角色。</p>
          </div>
          <div v-if="selectedPositionId" class="iam-mount-tile is-impact">
            <div class="iam-mount-tile-head">
              <span class="iam-mount-tile-dot" :class="editorPreviewConflicts.length ? 'is-warn' : 'is-ok'" />
              岗位实时影响 · {{ positionName(selectedPosition) }}
            </div>
            <p v-if="editorPreviewLoading" class="iam-mount-tile-loading">正在读取该岗位的授权模板…</p>
            <template v-else-if="editorPreviewUnavailable">
              <p class="iam-mount-tile-empty">授权预览接口暂不可用，请稍后重试或点击"刷新预览"。不影响模板保存；模板分配到岗位后即可在下方"授权预览与影响分析"中查看。</p>
            </template>
            <template v-else-if="editorPreview">
              <dl>
                <div class="is-ok"><dt>将成功继承</dt><dd>{{ editorPreviewRoles.length }}<small>个角色</small></dd></div>
                <div :class="editorPreviewConflicts.length ? 'is-warn' : 'is-ok'"><dt>CONFLICT</dt><dd>{{ editorPreviewConflicts.length }}<small>条</small></dd></div>
              </dl>
              <p v-if="!editorPreviewRoles.length" class="iam-mount-tile-empty">该岗位当前没有任何可继承的角色。请在下方"将模板应用到岗位"中勾选本模板并点击"保存岗位映射"，再回到这里刷新。</p>
              <ul v-if="editorPreviewConflicts.length" class="iam-mount-conflicts">
                <li v-for="(line, index) in editorPreviewConflicts" :key="`editor-conflict-${index}`">{{ line }}</li>
              </ul>
              <p class="iam-mount-tile-foot">当前接口仅返回该岗位已分配模板的角色总数与冲突消息；CONFLICT 来源（USER / ORG_UNIT / POSITION）需要后端扩展分类字段后才能逐项展示。</p>
            </template>
            <p v-else class="iam-mount-tile-empty">暂无预览数据，请点击"刷新预览"重新读取。</p>
          </div>
          <div v-else class="iam-mount-tile is-muted">
            <div class="iam-mount-tile-head"><span class="iam-mount-tile-dot is-muted" />岗位实时影响</div>
            <p class="iam-mount-tile-empty">请先在下方"将模板应用到岗位"中选择一个岗位，再查看该岗位当前已分配模板的实时影响。模板保存并完成岗位分配后，本面板会同步显示"将成功继承 / CONFLICT"的具体数量。</p>
          </div>
        </div>
        <div class="iam-template-mount-actions">
          <button class="console-button ghost small" type="button" :disabled="!selectedPositionId || editorPreviewLoading" @click="loadEditorPreview">
            <ConsoleIcon name="reset" />{{ editorPreviewLoading ? '刷新中…' : '刷新预览' }}
          </button>
          <button class="console-text-button" type="button" :disabled="!selectedPositionId" @click="scrollToPositionPreview">查看完整预览</button>
        </div>
      </div>
      <div class="iam-panel-actions"><button class="console-text-button" type="button" :disabled="!selectedPositionId" @click="scrollToPositionPreview">预览影响</button><button v-if="editingTemplateId" class="console-button ghost small" type="button" :disabled="saving" @click="resetTemplateForm">取消编辑</button><button class="console-button primary small" type="button" :disabled="saving" @click="createTemplate"><ConsoleIcon name="save" />{{ editingTemplateId ? '保存模板修改' : '创建模板' }}</button></div>
    </div>

    <p v-if="canReadAuthorization && !canManageAuthorization" class="iam-field-help" role="status">当前为只读模式：可以查看模板、岗位映射和授权预览，但不能创建、修改或删除模板。</p>

    <div class="console-table-card iam-standard-authorization-card">
      <header class="iam-template-mapping-head">
        <div class="iam-template-card-title">
          <span class="iam-template-card-icon is-green"><ConsoleIcon name="link" /></span>
          <div>
            <h4>将模板应用到岗位</h4>
            <p>选择岗位并勾选模板，保存后由有效任职关系自动继承对应应用角色。</p>
          </div>
        </div>
        <div class="iam-template-mapping-actions">
          <label class="iam-template-position-field">
            <span>目标岗位</span>
            <select v-model="selectedPositionId" class="iam-template-position-select">
              <option value="" disabled>请选择岗位</option>
              <option v-if="!positions.length" value="" disabled>暂无可映射岗位</option>
              <optgroup
                v-for="group in positionGroups"
                :key="group.organization_id || group.organization_name"
                :label="authorizationPositionGroupLabel(group)"
              >
                <option v-for="position in group.positions" :key="positionId(position)" :value="positionId(position)">{{ authorizationPositionOptionLabel(position) }}</option>
              </optgroup>
            </select>
          </label>
          <button class="console-button ghost small" type="button" :disabled="!selectedPositionId || loading || assignmentsLoading" @click="runAssignmentDuplicateCheck(true)"><ConsoleIcon name="search" />一键查重</button>
          <button v-if="canManageAuthorization" class="console-button primary small" type="button" :disabled="saving || !selectedPositionId || assignmentsLoading || !assignmentsRevision || loadedAssignmentsPositionId !== String(selectedPositionId || '')" @click="saveAssignments"><ConsoleIcon name="save" />{{ assignmentsLoading ? '读取中…' : '保存岗位映射' }}</button>
        </div>
      </header>
      <p v-if="selectionNotice" class="login-target-module__error" role="alert">{{ selectionNotice }}</p>
      <p v-if="assignmentsNotice" class="login-target-module__error" role="alert">
        {{ assignmentsNotice }}
        <button class="console-text-button" type="button" :disabled="saving || assignmentsLoading" @click="loadAssignments">重新加载岗位映射</button>
      </p>
      <p v-if="selectedPosition" class="iam-field-help">{{ positionName(selectedPosition) }} 的有效任职关系会动态继承下列标准模板；任职勾选“参与岗位授权继承”后才会生效。个人、岗位和组织的例外授权不会被模板覆盖或删除。</p>
      <section
        v-if="duplicateCheckResult"
        class="iam-template-duplicate-result"
        :class="duplicateCheckResult.duplicate_group_count ? 'has-duplicates' : 'is-clean'"
        role="status"
        aria-live="polite"
      >
        <header>
          <span class="iam-template-card-icon" :class="duplicateCheckResult.duplicate_group_count ? 'is-warn' : 'is-green'"><ConsoleIcon :name="duplicateCheckResult.duplicate_group_count ? 'info' : 'save'" /></span>
          <div>
            <h5>{{ duplicateCheckResult.duplicate_group_count ? `发现 ${duplicateCheckResult.duplicate_group_count} 组重复权限` : '查重通过，未发现重复权限' }}</h5>
            <p>已检查 {{ duplicateCheckResult.selected_template_count }} 个模板、{{ duplicateCheckResult.checked_role_count }} 条有效角色配置；查重依据为应用、角色、授权范围及有效期交集。</p>
          </div>
        </header>
        <ul v-if="duplicateCheckResult.duplicates.length" class="iam-template-duplicate-list">
          <li v-for="duplicate in duplicateCheckResult.duplicates" :key="duplicate.key">
            <div><strong>{{ duplicate.application_name }} / {{ duplicate.role_name }}</strong><span>{{ duplicateScopeLabel(duplicate) }}</span></div>
            <p>重复来源：{{ duplicate.templates.map((item) => item.template_name).join('、') }}</p>
          </li>
        </ul>
        <p v-else class="iam-template-duplicate-clean">所选模板不会在同一有效期内重复授予相同范围的应用角色，可以继续保存岗位映射。</p>
        <p v-if="duplicateCheckResult.empty_templates.length" class="iam-template-duplicate-note">以下模板没有可参与查重的有效角色：{{ duplicateCheckResult.empty_templates.map((item) => item.template_name).join('、') }}</p>
        <p v-if="duplicateCheckResult.missing_template_ids.length" class="iam-template-duplicate-note">有 {{ duplicateCheckResult.missing_template_ids.length }} 个已选模板已不在当前目录，请刷新页面后重新选择。</p>
      </section>
      <div v-if="loading" class="console-empty">正在读取模板…</div>
      <div v-else-if="!activeTemplates.length" class="console-empty">暂无可用授权模板，请先创建模板。</div>
      <div v-else class="iam-template-assignment-list">
        <div v-for="template in pagedActiveTemplates" :key="templateId(template)" class="iam-template-assignment-row">
          <label class="iam-template-assignment">
            <input v-model="assignedTemplateIds" type="checkbox" :value="templateId(template)" :disabled="!canManageAuthorization" />
            <span class="iam-template-assignment-content">
              <span class="iam-template-assignment-topline"><strong>{{ template.name }}</strong><b>{{ template.affected_users || 0 }} 位受影响用户</b></span>
              <small>{{ template.code }}</small>
              <span v-if="templateRoleLabels(template).length" class="iam-template-role-tags">
                <em v-for="roleLabel in templateRoleLabels(template).slice(0, 2)" :key="roleLabel">{{ roleLabel }}</em>
                <em v-if="templateRoleLabels(template).length > 2" class="is-more">+{{ templateRoleLabels(template).length - 2 }}</em>
              </span>
              <small v-else class="is-muted">未配置角色</small>
            </span>
          </label>
          <div v-if="canManageAuthorization" class="iam-template-row-actions"><button class="console-text-button" type="button" :disabled="saving" @click="editTemplate(template)">编辑</button><button class="console-text-button danger iam-template-delete" type="button" :disabled="saving" @click="deleteTemplate(template)">删除模板</button></div>
        </div>
      </div>
      <nav v-if="activeTemplates.length > templatePageSize" class="iam-template-pagination" aria-label="授权模板分页">
        <span>共 {{ activeTemplates.length }} 个模板</span>
        <div class="iam-template-pagination-controls">
          <button class="console-button ghost small" type="button" :disabled="templatePage === 1" @click="setTemplatePage(templatePage - 1)">上一页</button>
          <span>第 {{ templatePage }} / {{ templatePageCount }} 页</span>
          <button class="console-button ghost small" type="button" :disabled="templatePage === templatePageCount" @click="setTemplatePage(templatePage + 1)">下一页</button>
        </div>
      </nav>
    </div>

    <div v-if="preview" ref="positionPreviewRef" class="console-table-card iam-authorization-preview"><h4>授权预览与影响分析</h4><p v-if="preview.conflicts?.length" class="login-target-module__error">{{ preview.conflicts.join('；') }}</p><p v-else class="iam-field-help">以下为该岗位模板产生的角色；用户同时有多个有效任职时，实际权限是全部有效来源的并集。</p><ul><li v-for="role in preview.roles || []" :key="`${role.template_id}-${role.role_id}`"><strong>{{ role.application_name || role.application_code }}</strong> / {{ role.role_name || role.role_code }} <small>来源：{{ role.template_name }}</small></li><li v-if="!(preview.roles || []).length">当前岗位没有从模板获得有效应用角色。</li></ul></div>

    <!-- 通用确认弹窗（替代 window.confirm） -->
    <div v-if="confirmDialog && canManageAuthorization" class="iam-modal-backdrop" role="presentation" @click.self="closeConfirm">
      <section class="iam-modal iam-confirm-modal" role="dialog" aria-modal="true" :aria-label="confirmDialog.title">
        <header><div><p>{{ confirmDialog.danger ? '危险操作' : '请确认' }}</p><h3>{{ confirmDialog.title }}</h3></div><button class="console-modal-close" type="button" :aria-label="`关闭${confirmDialog.title}`" :disabled="confirmDialog.busy" @click="closeConfirm"><ConsoleIcon name="close" /></button></header>
        <div class="iam-confirm-body"><p style="white-space: pre-line;">{{ confirmDialog.description }}</p></div>
        <footer>
          <button class="console-button ghost" type="button" :disabled="confirmDialog.busy" @click="closeConfirm">取消</button>
          <button :class="['console-button', confirmDialog.danger ? 'iam-danger-button' : 'primary']" type="button" :disabled="confirmDialog.busy" @click="runConfirm">{{ confirmDialog.confirmText }}</button>
        </footer>
      </section>
    </div>
  </section>
</template>
