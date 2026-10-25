<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router'
import { formatUserError } from '../../../shared/utils/userError.js'
import { createFormSnapshot, hasUnsavedChanges } from '../../../shared/utils/unsavedChanges.js'
import { useBeforeUnloadGuard } from '../../../shared/composables/useBeforeUnloadGuard.js'
import { useUrlFilterState } from '../../../shared/composables/useUrlFilterState.js'
import { useDialogFocusTrap } from '../../../shared/composables/useDialogFocusTrap.js'
import { useConfirmAction } from '@/modules/platform/shared/composables/useConfirmAction.js'
import { useOrganizationDirectory } from '@/modules/platform/iam/composables/useOrganizationDirectory.js'
import { includesFilter } from '@/modules/platform/iam/utils/listFilter'
import {
  defaultAccountValidUntil,
  optionalText,
  parseBatchUserRows,
  resolveExpiresAt,
  validateLocalAccountInput,
  validateUserInput,
} from '@/modules/platform/iam/utils/userInputValidation'
import ConsoleIcon from '@/modules/platform/shared/components/ConsoleIcon.vue'
import PositionAuthorizationTemplates from '@/modules/platform/iam/components/PositionAuthorizationTemplates.vue'
import BatchUserImportDialog from '@/modules/platform/iam/components/BatchUserImportDialog.vue'
import AuthorizationEntryGuidance from '@/modules/platform/iam/components/AuthorizationEntryGuidance.vue'
import EffectiveAuthorizationOverview from '@/modules/platform/iam/components/EffectiveAuthorizationOverview.vue'
import PersonalExceptionAuthorization from '@/modules/platform/iam/components/PersonalExceptionAuthorization.vue'
import OrgUnitTree from '@/modules/platform/iam/components/OrgUnitTree.vue'
import OrganizationDirectoryPanel from '@/modules/platform/iam/components/OrganizationDirectoryPanel.vue'
import IdentityEditorModal from '@/modules/platform/iam/components/IdentityEditorModal.vue'
import PositionGroups from '@/modules/platform/iam/components/PositionGroups.vue'
import MembershipGroups from '@/modules/platform/iam/components/MembershipGroups.vue'
import {
  detailRows,
  detailTitle,
  primaryDetailRows,
  technicalDetailRows,
  displayLoginAccountType,
  effectiveAccountStatus,
  displayMembershipType,
  displayStatus,
  formatDateTime,
} from '@/modules/platform/iam/utils/iamPresentation'
import {
  defaultMembershipOrganizationId,
  membershipOrganizationOptions,
  positionOrgUnitId,
} from '@/modules/platform/iam/utils/iamMembershipOptions'
import {
  IamError,
  createLocalAccount,
  createMembership,
  updateMembershipInheritance,
  createOrgUnit,
  deleteOrgUnit,
  createPosition,
  deletePosition,
  createUser,
  createUsersBatch,
  deleteUser,
  listAccounts,
  listMemberships,
  listOrgUnits,
  listPositions,
  listUsers,
  resetAccountPassword,
  updateAccountStatus,
  updateOrgUnit,
  updateUser,
} from '@/modules/platform/iam/api/iam'
import { listApplications, listEnvironments } from '@/modules/platform/applications/api/applications'
import {
  AuthorizationError,
  deleteApplicationAccess,
  deleteSubjectApplicationAccess,
  getApplicationAccess,
  getApplicationAuthorizationCatalog,
  getAuthorizationOverview,
  getSubjectApplicationAccess,
  updateApplicationAccess,
  updateSubjectApplicationAccess,
} from '@/modules/platform/iam/api/authorization'
import {
  assignableActiveCatalogRoles,
  catalogLastSyncedAt as readCatalogLastSyncedAt,
  catalogMaxEffectiveRoles,
  catalogRolePermissions,
  catalogRoles,
  catalogSyncText as authorizationCatalogSyncText,
  catalogVersion,
  isAssignableActiveCatalogRole,
  isCatalogSynchronized,
} from '@/modules/platform/iam/utils/applicationAuthorizationCatalog'
import { authorizationEntryLayer, duplicatedInheritedRoleCodes } from '@/modules/platform/iam/utils/authorizationEntryLayer'
import {
  buildOrganizationTree,
  organizationDescendantIds,
} from '@/modules/platform/iam/utils/organizationTree'
import { groupPositionsByOrganization } from '@/modules/platform/iam/utils/positionGroups'
import { buildPositionExportRows } from '@/modules/platform/iam/utils/treeExport'
import {
  filteredMembershipsFromGroups,
  groupMembershipsByOrganization,
} from '@/modules/platform/iam/utils/membershipGroups'
import { loadAllCatalogPages } from '@/modules/platform/iam/utils/paginatedCatalog'
import { toCsvText } from '@/modules/platform/iam/utils/csvExport'
import { useRelatedDataInvalidation } from '@/modules/platform/shared/composables/useRelatedDataInvalidation'
import { createRequestScope } from '@/modules/platform/shared/composables/requestScope'
import { RELATED_DATA } from '@/modules/platform/shared/utils/relatedDataInvalidation'
import { buildUserAuthorizationOverview } from '@/modules/platform/iam/utils/userAuthorizationOverview'
import { authorizationDraftFingerprint, isAuthorizationDraftDirty } from '@/modules/platform/iam/utils/effectiveAuthorizationOverview'
import { isCurrentAuthorizationRequest } from '@/modules/platform/iam/utils/requestVersion'
import { copyTextToClipboard, scheduleSensitiveClipboardClear } from '@/modules/shared/utils/clipboard'
import {
  hasAnyPermission,
  hasPermission,
  useCurrentPrincipal,
} from '@/modules/platform/auth/utils/principal'
import {
  IAM_PERMISSIONS,
  iamPanelPermissions,
  iamPanelReadPermission,
} from '@/modules/platform/iam/utils/iamPermissions'
import '@/modules/platform/iam/styles/iam-settings.css'

const props = defineProps({
  // EmployeeOnboardingModal 由 PlatformConsoleView 管理，因此成功完成后
  // 必须显式使此处已挂载的 IAM 列表失效。
  refreshKey: { type: Number, default: 0 },
})
const emit = defineEmits(['toast', 'employee-onboarding', 'personnel-change'])

// 当前登录用户的权限集合（来自 /auth/me 的 permission_codes 字段）。
// 路由级守卫已在 router/index.js 完成认证；这里只用于按权限隐藏高危按钮。
// 真正的禁用/拒绝仍由后端执行，UI 隐藏只是体验优化。
const { refreshPrincipal } = useCurrentPrincipal()
// IAM 权限码和面板 OR 集合统一维护在 iamPermissions.js；这里仅消费真实权限。

const activePanel = ref('users')
const positionAuthorizationTemplates = ref(null)
const batchImportVisible = ref(false)
const detail = ref(null)
const membershipInheritanceDraft = ref(true)
const membershipInheritanceSaving = ref(false)
const membershipInheritanceError = ref('')
const membershipInheritanceConflict = ref(false)
const validityEditor = ref(null)
const validitySaving = ref(false)
const loading = reactive({ users: false, accounts: false, organizations: false, positions: false, memberships: false, positionAuthorizationTemplates: false })
const errorMessage = ref('')
const pageSize = 50
const userPageSize = ref(50)
const pagination = reactive({
  users: { page: 1, pageSize: userPageSize.value, total: 0 },
  accounts: { page: 1, pageSize, total: 0 },
  organizations: { page: 1, pageSize, total: 0, serverPagingSupported: true },
  positions: { page: 1, pageSize, total: 0, serverPagingSupported: true },
  memberships: { page: 1, pageSize, total: 0, serverPagingSupported: true },
})
// 每次切换 panel / 翻页 / 重设筛选都会触发新的 load。上一次未完成的响应在返回时
// 必须被丢弃，否则会把旧页的 items / page 覆盖当前页，造成列表错位与 total 不一致。
const requestSeq = reactive({ users: 0, accounts: 0, organizations: 0, positions: 0, memberships: 0 })
const users = ref([])
const accounts = ref([])
// organizations 由 useOrganizationDirectory 持有（见 safeCall 之后的解构）。
const memberships = ref([])
const positions = ref([])
const passwordResetDialog = ref(null)
const temporaryPassword = ref(null)
const userDeletionDialog = ref(null)
const resettingPassword = ref(false)
const deletingUser = ref(false)
const deletingPositionId = ref('')
const deletingOrganizationId = ref('')
const updatingAccountId = ref('')
// 通用危险操作确认弹窗（回调式；busy 拒关、返回 false 保留弹窗、onCancel 空闲触发）。
// 模板绑定与事件次序保持原样，见 platform/shared/composables/useConfirmAction.js。
const { dialog: confirmDialog, openConfirm, closeConfirm, runConfirm } = useConfirmAction()
const applications = ref([])
const applicationsLoading = ref(false)
// 详情弹窗及其两层授权请求分别使用递增序号失效旧响应，避免快速切换用户或主体时
// 把上一主体的角色快照回写到当前弹窗。
const detailAuthorizationRequestSeq = ref(0)
const applicationsRequestSeq = ref(0)
const applicationAuthorizationRequestSeq = ref(0)
const authorizationCatalog = ref(null)
const authorizationCatalogLoading = ref(false)
const applicationAccess = ref(null)
const applicationAccessLoading = ref(false)
const applicationAccessSaving = ref(false)
const applicationAccessRevoking = ref(false)
const applicationAccessError = ref('')
// 服务端返回的可编辑授权集合一致快照版本（edit_revision，形如 "v1:<hex>"）。
// 只由同路径 GET/PUT 响应回填；保存与撤销时原样作为并发条件提交，
// 前端不推导、不修改、不因刷新失败清空它（旧值重试只会得到 409，宁误报不覆盖）。
const applicationAccessEditRevision = ref('')
// 保存/撤销撞上并发修改（409 APPLICATION_ACCESS_REVISION_CONFLICT）时的后端消息原文：
// 保留草稿并展示，绝不自动重新 GET 后用新版本重提——那会把其他管理员刚写入的授权静默覆盖。
const APPLICATION_ACCESS_REVISION_CONFLICT_MESSAGE = '应用授权已被其他管理员修改，请刷新读取最新授权后重试。'
// 应用授权编辑器的读取作用域：GET/刷新逐次 begin，响应与 finally 回写前先 isCurrent 校验，
// 切换主体/应用或关闭详情时 invalidate；组件卸载由 requestScope 内部的 onScopeDispose 兜底。
// 写操作（PUT/DELETE）保持既有 single-flight 与主体归属校验，不走“丢弃前一次结果”的竞态掩盖。
const applicationAccessRequestScope = createRequestScope()
// USER 新个人例外面板的草稿脏状态；父组件用它统一保护切应用、关闭详情和 ESC。
const personalExceptionDirty = ref(false)
const selectedApplicationCode = ref('')
const applicationEnvironments = ref([])
const applicationEnvironmentsLoading = ref(false)
// 用户详情弹窗内的“有效授权总览”卡片：逐个读取已接入应用的用户访问快照，
// 再按应用和来源合并展示；任一应用失败不会阻塞个人例外授权的维护。
const userAuthorizationPreview = ref(null)
const userAuthorizationPreviewLoading = ref(false)
const userAuthorizationPreviewUnavailable = ref(false)
const userAuthorizationPreviewErrorCount = ref(0)
// 保留每个目标应用的原始读取结果（成功/失败/加载中），使失败应用仍单独成行。
const userAuthorizationPreviewEntries = ref([])
// 初始总览读取的完整应用集合（包含基础平台本身），供全量刷新复用，避免刷新后丢行。
const userAuthorizationPreviewTargetApplications = ref([])
// 每个应用的重试序号：同一应用连续重试时，只允许最后一次响应回写。
const userAuthorizationPreviewRetryVersions = new Map()
// 用户详情的个人例外授权默认收起；只有显式展开或点击某应用的“管理个人例外”才显示。
const applicationAccessExpanded = ref(false)
// 已加载草稿的指纹；用于切换应用时保护未保存修改，不改变后端保存语义。
const authorizationDraftBaseline = ref('')
const authorizationOverview = ref(null)
const authorizationOverviewLoading = ref(false)
const authorizationOverviewUnavailable = ref(false)
const keycloakMappingState = computed(() => {
  const entries = authorizationOverview.value?.keycloak_sync || []
  const latest = entries[0]
  const status = String(latest?.status || latest?.state || '').toUpperCase()
  if (['FAILED', 'ERROR', 'CONFLICT'].includes(status)) return '冲突/失败'
  if (['PENDING', 'RUNNING', 'PROCESSING'].includes(status)) return '同步中'
  if (['COMPLETED', 'SUCCEEDED', 'SUCCESS', 'ACTIVE'].includes(status)) return '已同步'
  return entries.length ? '状态未知' : '未映射'
})
const keycloakExternalSubject = computed(() => {
  const account = (authorizationOverview.value?.accounts || []).find((item) => item.external_subject || item.keycloak_subject || item.subject)
  const raw = String(account?.external_subject || account?.keycloak_subject || account?.subject || '').trim()
  if (!raw) return '未返回'
  if (raw.length <= 8) return `${raw.slice(0, 2)}****`
  return `${raw.slice(0, 4)}****${raw.slice(-4)}`
})
const authorizationSubjectType = computed(() => {
  if (detail.value?.kind === 'user') return 'USER'
  if (detail.value?.kind === 'organization') return 'ORG_UNIT'
  if (detail.value?.kind === 'position') return 'POSITION'
  return ''
})
const authorizationSubjectId = computed(() => {
  if (authorizationSubjectType.value === 'USER') return detail.value?.item?.user_id || ''
  if (authorizationSubjectType.value === 'ORG_UNIT') return detail.value?.item?.org_unit_id || detail.value?.item?.id || ''
  if (authorizationSubjectType.value === 'POSITION') return detail.value?.item?.position_id || detail.value?.item?.id || ''
  return ''
})
const canReadApplicationAuthorization = computed(() => hasPermission(IAM_PERMISSIONS.roleBindingRead))
const canManageApplicationAuthorization = computed(() => hasPermission(IAM_PERMISSIONS.roleBindingUpdate))
const supportsApplicationAuthorization = computed(() => Boolean(
  canReadApplicationAuthorization.value && authorizationSubjectType.value && authorizationSubjectId.value,
))
const isUserAuthorizationSubject = computed(() => authorizationSubjectType.value === 'USER')
// 组织和岗位直绑仅用于发现、清理历史数据。标准授权必须由岗位授权模板产生，
// 前端不再为 ORG_UNIT / POSITION 暴露新增或覆盖入口；后端拒绝仍是最终安全边界。
const isLegacyStructuralAuthorizationSubject = computed(() => ['ORG_UNIT', 'POSITION'].includes(authorizationSubjectType.value))
const authorizationSubjectLabel = computed(() => {
  if (authorizationSubjectType.value === 'ORG_UNIT') return '组织单元'
  if (authorizationSubjectType.value === 'POSITION') return '岗位'
  return '用户'
})
const authorizationDraft = reactive({
  role_codes: [],
  scope_type: 'APPLICATION',
  environment_code: '',
  validity_mode: 'PERMANENT',
  valid_from: '',
  valid_until: '',
  apply_to_existing: false,
})

const selectedApplication = computed(() => applications.value.find((item) => item.code === selectedApplicationCode.value) || null)
const authorizationCatalogRoles = computed(() => catalogRoles(authorizationCatalog.value))
const hasSynchronizedAuthorizationCatalog = computed(() => isCatalogSynchronized(authorizationCatalog.value))
const authorizationRoleOptions = computed(() => hasSynchronizedAuthorizationCatalog.value ? assignableActiveCatalogRoles(authorizationCatalog.value) : [])
const catalogRoleTotal = computed(() => authorizationCatalogRoles.value.length)
const catalogInactiveOrRestrictedRoleCount = computed(() => Math.max(catalogRoleTotal.value - authorizationRoleOptions.value.length, 0))
const catalogSyncText = computed(() => authorizationCatalogSyncText(authorizationCatalog.value))
const catalogLastSyncedAt = computed(() => readCatalogLastSyncedAt(authorizationCatalog.value))
// 应用目录声明的最大有效角色数（0 表示不限制）。在保存前就提示管理员，避免选中超过
// 应用策略的角色后由后端 422 拒绝，用户只能看到笼统的“请求参数不合法”。
const authorizationMaxEffectiveRoles = computed(() => catalogMaxEffectiveRoles(authorizationCatalog.value))
// 本次保存实际会提交的去重直接角色数（只统计当前 ACTIVE 且可分配的目录角色，与
// applicationAccessPayload / 后端 validateDirectRoleLimit 的语义一致）。已在草稿中但不再
// 可分配的历史角色会在保存时被单独确认撤销，不计入这里。继承角色也不混入。
const authorizationSelectedDirectRoleCount = computed(() => {
  const selectableRoleCodes = new Set(authorizationRoleOptions.value.map((role) => roleCode(role)))
  return uniqueValues(authorizationDraft.role_codes.filter((code) => selectableRoleCodes.has(code))).length
})
// 勾选的直接角色数是否已经超过应用声明的最大有效角色数（该应用永远无法被授权）。
const authorizationDirectLimitExceeded = computed(() => {
  const maximum = authorizationMaxEffectiveRoles.value
  return maximum > 0 && authorizationSelectedDirectRoleCount.value > maximum
})
const applicationDirectRoles = computed(() => Array.isArray(applicationAccess.value?.direct_roles) ? applicationAccess.value.direct_roles : [])
// 编辑和历史清理只能操作 MANUAL 来源。TEMPLATE / SYSTEM 即使属于当前主体，
// 也只能通过岗位授权模板或系统流程维护，绝不能混入替换、撤销草稿。
const applicationManualRoles = computed(() => {
  if (Array.isArray(applicationAccess.value?.manual_roles)) return applicationAccess.value.manual_roles
  return applicationDirectRoles.value.filter((role) => {
    const origin = String(role?.grant_origin || '').trim().toUpperCase()
    if (origin) return origin === 'MANUAL'
    const sourceKind = String(role?.source_kind || '').trim().toUpperCase()
    return !sourceKind || sourceKind === 'MANUAL' || sourceKind === 'DIRECT'
  })
})
const unavailableDirectRoles = computed(() => applicationManualRoles.value.filter((role) => {
  const catalogRole = applicationRoleCatalogEntry(role)
  return !catalogRole || !isAssignableActiveCatalogRole(catalogRole)
}))
const applicationInheritedRoles = computed(() => Array.isArray(applicationAccess.value?.inherited_roles) ? applicationAccess.value.inherited_roles : [])
const applicationEffectiveRoles = computed(() => Array.isArray(applicationAccess.value?.roles) ? applicationAccess.value.roles : [])
const applicationAuthorizationState = computed(() => {
  const state = String(applicationAccess.value?.authorization_state || '').trim().toUpperCase()
  if (state) return state
  return applicationEffectiveRoles.value.length ? 'GRANTED' : 'UNAUTHORIZED'
})
const applicationAuthorizationConflicts = computed(() => uniqueValues(applicationAccess.value?.conflicts || []))
const hasApplicationAuthorizationConflict = computed(() => applicationAuthorizationState.value === 'CONFLICT')
const hasDirectApplicationAccess = computed(() => applicationManualRoles.value.length > 0)
const hasEffectiveApplicationAccess = computed(() => applicationAuthorizationState.value === 'GRANTED' && applicationEffectiveRoles.value.length > 0)
// 个人例外草稿是否与最近一次服务端结果不同。切换应用时据此保护未保存修改。
const hasUnsavedAuthorizationDraft = computed(() => isUserAuthorizationSubject.value
  ? personalExceptionDirty.value
  : isAuthorizationDraftDirty(authorizationDraftBaseline.value, authorizationDraft))
const authorizationEntryLayerInfo = computed(() => authorizationEntryLayer(authorizationSubjectType.value))
const authorizationEffectivePermissions = computed(() => {
  if (hasApplicationAuthorizationConflict.value) return []
  const roleCodes = uniqueValues([
    ...authorizationDraft.role_codes,
    ...applicationInheritedRoles.value.map((role) => roleCode(role)),
  ])
  const effectiveRoles = authorizationRoleOptions.value.filter((role) => roleCodes.includes(roleCode(role)))
  const rolePermissions = effectiveRoles.flatMap((role) => rolePermissionsFor(role))
  // 子系统权限目录是只读镜像。基础平台只预览目录声明的角色默认权限，
  // 不接受或叠加任何用户自定义业务权限；最终业务鉴权仍由子系统执行。
  return uniqueValues(rolePermissions.map((item) => permissionCode(item)))
})
// 草稿里被勾选、但当前 ACTIVE 目录里没有的角色。这些角色如果保存就会被服务端
// 拒绝或被静默丢弃，必须让用户在保存时显式确认是否撤销。
const authorizationRolesToRevoke = computed(() => {
  const selectableRoleCodes = new Set(authorizationRoleOptions.value.map((role) => roleCode(role)))
  return authorizationDraft.role_codes.filter((code) => !selectableRoleCodes.has(code))
})

// 每个 panel 使用自身资源的 read/create/update/delete OR 集合决定是否显示，
// 不再把 user:read 当成整个 IAM 的共同入口。readPermission 只控制列表读取和刷新。
const panels = [
  { key: 'organizations', groupKey: 'foundation', label: '组织单元', icon: 'organization', description: '只维护人员归属和组织层级，不承载日常应用授权' },
  { key: 'positions', groupKey: 'foundation', label: '岗位', icon: 'organization', description: '定义人员职责；标准应用角色通过岗位授权模板统一配置' },
  { key: 'users', groupKey: 'people', label: '用户', icon: 'user', description: '员工应通过“新增员工”一次完成用户、账号与任职；直接角色仅用于个人例外' },
  { key: 'accounts', groupKey: 'people', label: '登录账号', icon: 'account', description: '只管理登录凭证、状态和有效期，不作为授权主体' },
  { key: 'memberships', groupKey: 'people', label: '任职关系', icon: 'link', description: 'Membership 任职关系：主组织、兼岗、历史任职' },
  { key: 'positionAuthorizationTemplates', groupKey: 'authorization', label: '岗位授权模板', icon: 'shield', description: '标准授权入口：岗位映射到各应用实际角色，由有效任职关系动态继承' },
].map((item) => ({
  ...item,
  permissions: iamPanelPermissions(item.key),
  readPermission: iamPanelReadPermission(item.key),
}))

// 3 个工作流阶段。运维的典型路径：先建基础数据（组织 / 岗位）→ 录入人员（用户 / 账号 / 任职）→
// 配置授权（岗位授权模板）。阶段顺序就是用户使用顺序，不允许随意调整。
// panels 字段是各阶段下挂的 panel key 列表；模板里再按 key 反查 `panels` 拿到完整定义。
const panelGroups = [
  { key: 'foundation', label: '基础数据', icon: 'organization', panels: ['organizations', 'positions'] },
  { key: 'people', label: '人员', icon: 'user', panels: ['users', 'accounts', 'memberships'] },
  { key: 'authorization', label: '授权', icon: 'shield', panels: ['positionAuthorizationTemplates'] },
]

// 各 panel 独立的筛选输入；切换 panel 时不会把旧 panel 的关键字带过来。
// key 必须与 `pagination` 的 key 一一对应，`load*` 会按当前 panel 读取对应字段。
const panelFilters = reactive({ users: '', accounts: '', organizations: '', positions: '', memberships: '' })

function canAccessPanel(item) {
  return Boolean(item) && hasAnyPermission(item.permissions)
}

function canReadPanel(item) {
  return Boolean(item?.readPermission) && hasPermission(item.readPermission)
}

const visiblePanels = computed(() => panels.filter(canAccessPanel))
const panel = computed(() => visiblePanels.value.find((item) => item.key === activePanel.value) || visiblePanels.value[0] || panels[0])
const canReadActivePanel = computed(() => canReadPanel(panels.find((item) => item.key === activePanel.value)))

const activePanelItemsCount = computed(() => {
  if (activePanel.value === 'users') return filteredUsers.value.length
  if (activePanel.value === 'accounts') return filteredAccounts.value.length
  if (activePanel.value === 'organizations') return filteredOrganizations.value.length
  if (activePanel.value === 'positions') return filteredPositions.value.length
  if (activePanel.value === 'memberships') return filteredMemberships.value.length
  return 0
})

// 侧边 nav 直接消费的分组视图：保留阶段标题、阶段完成度、按权限隐藏子 panel。
// 任何阶段下没有可见 panel（例如没有任何 role-binding 权限）就直接整组隐藏。
const route = useRoute()
const router = useRouter()
const iamPanelKeys = new Set(panels.map((panel) => panel.key))
useUrlFilterState({
  route,
  router,
  fields: { panel: activePanel },
  normalize: (value) => iamPanelKeys.has(value) ? value : 'users',
})

watch(() => props.initialPanel, (panel) => {
  if (panel && iamPanelKeys.has(panel)) activePanel.value = panel
}, { immediate: true })

const visiblePanelGroups = computed(() => panelGroups
  .map((group) => {
    const groupPanels = group.panels
      .map((key) => panels.find((item) => item.key === key))
      .filter((item) => item && canAccessPanel(item))
    return { ...group, panels: groupPanels }
  })
  .filter((group) => group.panels.length > 0))

// 阶段完成度：仅读现有 pagination[key].total 与 loading[key]，不重写数据加载逻辑。
// 返回值：'loading'（任一 panel 还在请求）/ 'complete'（全部 panel 已加载且 total > 0）/
// 'partial'（已加载完成但部分 total === 0）/ 'empty'（已加载完成但全部 total === 0）。
// positionAuthorizationTemplates 不在 pagination / loading 里，单独走默认 'idle' 灰点。
const groupCompletion = computed(() => {
  const result = {}
  for (const group of panelGroups) {
    const totals = group.panels
      .map((key) => panels.find((item) => item.key === key))
      .filter(canAccessPanel)
      .map((item) => {
        if (item.key === 'positionAuthorizationTemplates') return null
        return pagination[item.key] ? pagination[item.key].total : null
      })
    const realTotals = totals.filter((value) => value !== null)
    if (realTotals.length === 0) {
      result[group.key] = 'idle'
      continue
    }
    if (group.panels.some((key) => key !== 'positionAuthorizationTemplates' && loading[key])) {
      result[group.key] = 'loading'
      continue
    }
    const nonZero = realTotals.filter((value) => value > 0).length
    if (nonZero === realTotals.length) result[group.key] = 'complete'
    else if (nonZero === 0) result[group.key] = 'empty'
    else result[group.key] = 'partial'
  }
  return result
})

// 阶段计数文本：基础数据 "组织 3 · 岗位 5"、人员 "用户 8 · 账号 12 · 任职 5"。
// 数据来源仍是现有 pagination[key].total，零值显示 "0" 而不是隐藏，方便用户看到"建好/没建"。
// 授权组无对应 pagination，返回空字符串，由模板自行决定是否显示。
const groupCountLabel = computed(() => {
  const result = {}
  for (const group of panelGroups) {
    const segments = []
    for (const key of group.panels) {
      if (key === 'positionAuthorizationTemplates') continue
      const panelDef = panels.find((item) => item.key === key)
      const total = pagination[key] ? pagination[key].total : null
      if (panelDef && canAccessPanel(panelDef) && total !== null) segments.push(`${panelDef.label} ${total}`)
    }
    result[group.key] = segments.join(' · ')
  }
  return result
})

const metrics = computed(() => [
  { panelKey: 'users', label: '有效用户', value: pagination.users.total, note: '服务端分页总数 /api/v1/users', icon: 'user', tone: 'blue' },
  { panelKey: 'accounts', label: '登录账号', value: pagination.accounts.total, note: '服务端分页总数（含未删除用户的停用账号）/api/v1/accounts', icon: 'account', tone: 'violet' },
  { panelKey: 'organizations', label: '有效组织', value: pagination.organizations.total, note: '服务端分页总数 /api/v1/org-units', icon: 'organization', tone: 'green' },
  { panelKey: 'memberships', label: '任职关系', value: pagination.memberships.total, note: '服务端分页总数 /api/v1/memberships', icon: 'link', tone: 'orange' },
].filter((metric) => canAccessPanel(panels.find((item) => item.key === metric.panelKey))))

// includesFilter 已提取到 utils/listFilter.js，供各面板过滤计算共用。

const filteredUsers = computed(() => includesFilter(users.value, panelFilters.users, ['display_name', 'employee_no', 'email', 'status']))
const filteredAccounts = computed(() => includesFilter(accounts.value, panelFilters.accounts, ['account_name', 'user_id', 'status']))
// 组织的过滤与导出计算在 useOrganizationDirectory 内（filteredOrganizations 等）。
const filteredPositions = computed(() => groupPositionsByOrganization(
  positions.value,
  organizations.value,
  panelFilters.positions,
).flatMap((group) => (group.positions || []).map((position) => ({
  ...position,
  // 分组结果携带的是组织节点，导出时必须把组织上下文回填到每一条岗位记录；
  // 不能把组织节点本身当成岗位行导出。
  organization_id: group.organization_id,
  organization_name: group.organization_name,
  organization_code: group.organization_code,
  organization_path: group.organization_path,
}))))
const positionExportRows = computed(() => buildPositionExportRows(
  positions.value,
  organizations.value,
  new Set(filteredPositions.value.map((item) => String(item.position_id || item.id || ''))),
))
// 任职搜索必须在完整数据集上同时匹配用户、组织和岗位；CSV 直接消费相同结果，
// 与页面折叠状态无关，确保导出的是完整搜索结果而不是当前可见卡片。
const filteredMemberships = computed(() => filteredMembershipsFromGroups(groupMembershipsByOrganization(
  memberships.value,
  organizations.value,
  panelFilters.memberships,
)))

const selectedPasswordResetAccount = computed(() => {
  const dialog = passwordResetDialog.value
  if (!dialog) return null
  return dialog.accounts.find((account) => account.account_id === dialog.accountId) || null
})

function emitToast(message) {
  emit('toast', message)
}

function selectPanel(key) {
  activePanel.value = key
  detail.value = null
}

function uniqueValues(values) {
  return [...new Set(values.filter((value) => String(value || '').trim()).map((value) => String(value).trim()))].sort()
}

function roleCode(role) {
  return typeof role === 'string' ? role : role?.code || role?.role_code || ''
}

function permissionCode(permission) {
  if (typeof permission === 'string') return permission
  return permission?.code || permission?.permission_code || ''
}

function permissionName(permission) {
  if (typeof permission === 'string') {
    const catalogPermission = authorizationCatalog.value?.permissions?.find((item) => item.code === permission)
    return catalogPermission?.name || permission
  }
  return permission?.name || permission?.code || permission?.permission_code || '未命名权限'
}

function rolePermissionsFor(role) {
  return catalogRolePermissions(role)
}

function rolePermissionCodes(role) {
  return uniqueValues(rolePermissionsFor(role).map((permission) => permissionCode(permission)))
}



function roleDefaultPermissionSummary(role) {
  const permissions = rolePermissionCodes(role)
  if (!permissions.length) return '子系统未声明默认权限'
  const labels = permissions.slice(0, 3).map((permission) => permissionName(permission))
  return permissions.length > labels.length ? `${labels.join('、')} 等 ${permissions.length} 项` : labels.join('、')
}

function applicationRoleCatalogEntry(role) {
  const code = roleCode(role)
  return authorizationCatalogRoles.value.find((item) => roleCode(item) === code) || null
}

function applicationRoleName(role) {
  const catalogRole = applicationRoleCatalogEntry(role)
  return role?.name || role?.display_name || catalogRole?.name || catalogRole?.display_name || roleCode(role) || '未命名角色'
}

function onExceptionRoleToggle(code, event) {
  const roleCodeValue = String(code || '').trim()
  if (!roleCodeValue || !event?.target?.checked) return
  if (confirmDialog.value) {
    authorizationDraft.role_codes = authorizationDraft.role_codes.filter((item) => item !== roleCodeValue)
    return
  }
  const duplicateCodes = duplicatedInheritedRoleCodes([roleCodeValue], applicationInheritedRoles.value)
  if (!duplicateCodes.length) return

  // 先撤销 v-model 刚加入的角色；只有管理员在确认弹窗中选择继续时才重新加入，
  // 避免关闭弹窗或点击取消后草稿仍然残留重复的个人例外角色。
  authorizationDraft.role_codes = authorizationDraft.role_codes.filter((item) => item !== roleCodeValue)
  const inheritedRole = applicationInheritedRoles.value.find((role) => roleCode(role) === roleCodeValue)
  const name = applicationRoleName(inheritedRole || { code: roleCodeValue })
  openConfirm({
    title: '确认添加重复例外角色',
    description: `角色“${name}”已经通过岗位或组织授权模板获得。再次添加个人例外不会增加实际权限，但会增加后续排查和回收成本。\n\n仍要添加这个个人例外角色吗？`,
    confirmText: '仍然添加',
    cancelText: '取消勾选',
      onConfirm: () => {
        if (!authorizationDraft.role_codes.includes(roleCodeValue)) {
          authorizationDraft.role_codes = [...authorizationDraft.role_codes, roleCodeValue]
        }
        // 通用确认按钮会先把弹窗标记为 busy；这里直接清理弹窗，避免 closeConfirm
        // 因 busy 状态拒绝关闭而让“仍然添加”后的提示残留在页面上。
        confirmDialog.value = null
      },
  })
}

function authorizationSourceTypeName(role) {
  const type = String(role?.source_type || '').toUpperCase()
  if (type === 'ORG_UNIT') return '组织单元'
  if (type === 'POSITION') return '岗位'
  if (type === 'USER') return '用户直接授权'
  return type || '未知来源'
}

function authorizationSourceName(role) {
  return role?.source_name || role?.source_id || '—'
}

function authorizationScopeText(role) {
  if (normalizeScopeType(role?.scope_type) === 'ENVIRONMENT') {
    return `指定环境：${role?.environment_code || '未指定'}`
  }
  return '整个应用'
}

function authorizationValidityText(role) {
  if (!role?.valid_from && !role?.valid_until) return '长期有效'
  const start = role?.valid_from ? formatDateTime(role.valid_from) : '立即生效'
  const end = role?.valid_until ? formatDateTime(role.valid_until) : '长期有效'
  return `${start} 至 ${end}`
}

function applicationDisplayName(application) {
  return application?.name || application?.display_name || application?.code || '未命名应用'
}

function resetApplicationAuthorizationState() {
  applicationsRequestSeq.value += 1
  applicationAuthorizationRequestSeq.value += 1
  // 编辑器读取作用域整体失效：关闭或重开详情后，在途 GET 的数据/错误回写与
  // finally 清理都不再命中当前状态（组件卸载由 requestScope 自动兜底）。
  applicationAccessRequestScope.invalidate()
  applications.value = []
  applicationsLoading.value = false
  authorizationCatalog.value = null
  authorizationCatalogLoading.value = false
  applicationAccess.value = null
  applicationAccessLoading.value = false
  applicationAccessError.value = ''
  applicationAccessEditRevision.value = ''
  personalExceptionDirty.value = false
  selectedApplicationCode.value = ''
  applicationAccessExpanded.value = false
  authorizationDraftBaseline.value = ''
  applicationEnvironments.value = []
  applicationEnvironmentsLoading.value = false
  authorizationDraft.role_codes = []
  authorizationDraft.scope_type = 'APPLICATION'
  authorizationDraft.environment_code = ''
  authorizationDraft.validity_mode = 'PERMANENT'
  authorizationDraft.valid_from = ''
  authorizationDraft.valid_until = ''
  authorizationDraft.apply_to_existing = false
}

function toDateTimeLocal(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (number) => String(number).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function toRFC3339(value) {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function normalizeScopeType(value) {
  return String(value || '').toUpperCase() === 'ENVIRONMENT' ? 'ENVIRONMENT' : 'APPLICATION'
}

function roleAuthorizationSignature(role) {
  return [
    normalizeScopeType(role?.scope_type),
    String(role?.environment_code || ''),
    String(role?.valid_from || ''),
    String(role?.valid_until || ''),
  ].join('|')
}

// 不同时间窗可原样往返；这里只提示差异，只有显式统一设置才覆盖已有配置。
const authorizationHasMixedRoleSettings = computed(() => {
  const selected = new Set(authorizationDraft.role_codes)
  return new Set(applicationManualRoles.value.filter((role) => selected.has(roleCode(role)))
    .map(roleAuthorizationSignature)).size > 1
})

// 后端拒绝同码多条输入；保留历史数据并明确要求管理员选择清理或统一，不能静默折叠。
const authorizationHasRepeatedManualRoles = computed(() => {
  if (authorizationDraft.apply_to_existing) return false
  const selected = new Set(authorizationDraft.role_codes)
  const seen = new Set()
  return applicationManualRoles.value.some((role) => {
    const code = roleCode(role)
    if (!selected.has(code)) return false
    if (seen.has(code)) return true
    seen.add(code)
    return false
  })
})

const authorizationEnvironmentOptions = computed(() => applicationEnvironments.value
  .map((environment) => ({
    code: environment.environment_code || environment.environment || environment.code || '',
    name: environment.name || environment.display_name || environment.environment_code || environment.environment || environment.code || '未命名环境',
  }))
  .filter((environment) => environment.code))

function applyAuthorizationSettings(roles) {
  authorizationDraft.apply_to_existing = false
  const firstRole = roles.find((role) => role && typeof role === 'object')
  const scopeType = normalizeScopeType(firstRole?.scope_type)
  authorizationDraft.scope_type = scopeType
  authorizationDraft.environment_code = scopeType === 'ENVIRONMENT' ? String(firstRole?.environment_code || '') : ''
  authorizationDraft.valid_from = toDateTimeLocal(firstRole?.valid_from)
  authorizationDraft.valid_until = toDateTimeLocal(firstRole?.valid_until)
  authorizationDraft.validity_mode = firstRole?.valid_from || firstRole?.valid_until ? 'RANGE' : 'PERMANENT'
}


let iamListScrollY = 0

async function openDetail(kind, item) {
  if (!detail.value && typeof window !== 'undefined') iamListScrollY = window.scrollY || 0
  membershipInheritanceDraft.value = item?.inherit_authorization !== false
  membershipInheritanceError.value = ''
  membershipInheritanceConflict.value = false
  const detailRequestId = ++detailAuthorizationRequestSeq.value
  resetApplicationAuthorizationState()
  resetUserAuthorizationPreview()
  detail.value = { kind, item }
  if (kind === 'user') loadAuthorizationOverview(item?.user_id || '', detailRequestId)
  if (kind === 'user' && canReadApplicationAuthorization.value) userAuthorizationPreviewLoading.value = true
  const loadedApplications = canReadApplicationAuthorization.value && ['user', 'organization', 'position'].includes(kind)
    ? await loadApplicationsForSubject()
    : []
  if (detailRequestId !== detailAuthorizationRequestSeq.value) return
  if (kind === 'user' && canReadApplicationAuthorization.value) {
    await loadUserAuthorizationPreview(item?.user_id || '', loadedApplications, detailRequestId)
  }
}

async function loadAuthorizationOverview(userId, detailRequestId = detailAuthorizationRequestSeq.value) {
  authorizationOverview.value = null
  authorizationOverviewUnavailable.value = false
  if (!userId) return
  authorizationOverviewLoading.value = true
  try {
    const overview = await getAuthorizationOverview(userId)
    if (detailRequestId !== detailAuthorizationRequestSeq.value || detail.value?.item?.user_id !== userId) return
    authorizationOverview.value = overview
  } catch (_error) {
    if (detailRequestId === detailAuthorizationRequestSeq.value) authorizationOverviewUnavailable.value = true
  } finally {
    if (detailRequestId === detailAuthorizationRequestSeq.value) authorizationOverviewLoading.value = false
  }
}

async function saveMembershipInheritance() {
  const target = detail.value
  if (target?.kind !== 'membership' || membershipInheritanceSaving.value || membershipInheritanceConflict.value ||
      !hasPermission(IAM_PERMISSIONS.membershipUpdate)) return
  if (membershipInheritanceDraft.value === (target.item.inherit_authorization !== false)) return
  membershipInheritanceSaving.value = true
  membershipInheritanceError.value = ''
  try {
    const updated = await updateMembershipInheritance(target.item, membershipInheritanceDraft.value)
    if (detail.value !== target) return
    target.item = { ...target.item, ...updated }
    membershipInheritanceDraft.value = target.item.inherit_authorization !== false
    emitToast('岗位授权继承设置已保存。')
    await loadMemberships()
  } catch (error) {
    if (detail.value !== target) return
    membershipInheritanceConflict.value = error?.status === 409 || error?.status === 404
    membershipInheritanceError.value = membershipInheritanceConflict.value
      ? '任职已被修改或不可用。请重新读取列表，打开详情核对后再保存。'
      : formatUserError(error, '岗位授权继承设置保存失败。')
  } finally {
    membershipInheritanceSaving.value = false
  }
}

function closeDetail() {
  detailAuthorizationRequestSeq.value += 1
  personalExceptionDirty.value = false
  detail.value = null
  resetApplicationAuthorizationState()
  resetUserAuthorizationPreview()
  authorizationOverview.value = null
  authorizationOverviewLoading.value = false
  authorizationOverviewUnavailable.value = false
  nextTick(() => {
    if (typeof window !== 'undefined' && iamListScrollY >= 0) window.scrollTo({ top: iamListScrollY, behavior: 'auto' })
  })
}

async function loadUserAuthorizationPreview(userId, targetApplications = applications.value, detailRequestId = detailAuthorizationRequestSeq.value) {
  // 按应用读取后端已经计算好的用户有效授权。岗位模板预览接口只接受 position_id，
  // 不能拿 user_id 代替；这里必须使用真实的用户应用访问接口做跨应用聚合。
  userAuthorizationPreview.value = null
  userAuthorizationPreviewUnavailable.value = false
  userAuthorizationPreviewErrorCount.value = 0
  const isCurrentRequest = () => detailRequestId === detailAuthorizationRequestSeq.value
    && detail.value?.kind === 'user'
    && String(detail.value?.item?.user_id || '') === String(userId || '')
  if (!userId) {
    userAuthorizationPreviewLoading.value = false
    userAuthorizationPreviewUnavailable.value = true
    return
  }
  if (!Array.isArray(targetApplications)) {
    userAuthorizationPreviewLoading.value = false
    userAuthorizationPreviewUnavailable.value = true
    return
  }
  if (isCurrentRequest()) userAuthorizationPreviewTargetApplications.value = [...targetApplications]
  userAuthorizationPreviewLoading.value = true
  userAuthorizationPreviewEntries.value = []
  userAuthorizationPreviewRetryVersions.clear()
  userAuthorizationPreview.value = null
  userAuthorizationPreviewErrorCount.value = 0
  try {
    const entries = await Promise.all((Array.isArray(targetApplications) ? targetApplications : []).map(async (application) => {
      try {
        return { application, access: await getApplicationAccess(userId, application.code) }
      } catch (error) {
        return { application, error: formatUserError(error, { fallback: '读取应用授权失败。' }) }
      }
    }))
    if (!isCurrentRequest()) return
    userAuthorizationPreviewEntries.value = entries
    applyUserAuthorizationPreviewEntries(entries)
    userAuthorizationPreviewUnavailable.value = entries.length > 0 && entries.every((entry) => entry.error)
  } catch (_error) {
    if (isCurrentRequest()) userAuthorizationPreviewUnavailable.value = true
  } finally {
    if (isCurrentRequest()) userAuthorizationPreviewLoading.value = false
  }
}

function applyUserAuthorizationPreviewEntries(entries) {
  userAuthorizationPreview.value = buildUserAuthorizationOverview(entries)
  userAuthorizationPreviewErrorCount.value = entries.filter((entry) => entry.error).length
}

async function retryUserAuthorizationPreview(applicationCode, { silent = false } = {}) {
  const code = String(applicationCode || '').trim()
  const userId = detail.value?.kind === 'user' ? detail.value?.item?.user_id : ''
  if (!code || !userId) return
  const entries = userAuthorizationPreviewEntries.value
  const index = entries.findIndex((entry) => String(entry?.application?.code || '').trim() === code)
  if (index < 0 || entries[index].loading) return
  const application = entries[index].application
  const retryVersion = (userAuthorizationPreviewRetryVersions.get(code) || 0) + 1
  userAuthorizationPreviewRetryVersions.set(code, retryVersion)
  const next = silent
    ? entries.map((entry) => ({ ...entry }))
    : entries.map((entry, entryIndex) => entryIndex === index ? { application, loading: true } : entry)
  if (!silent) {
    userAuthorizationPreviewEntries.value = next
    applyUserAuthorizationPreviewEntries(next)
  }
  const requestId = detailAuthorizationRequestSeq.value
  const isCurrentRequest = () => requestId === detailAuthorizationRequestSeq.value &&
    userAuthorizationPreviewRetryVersions.get(code) === retryVersion &&
    detail.value?.kind === 'user' && detail.value?.item?.user_id === userId
  try {
    const access = await getApplicationAccess(userId, code)
    if (!isCurrentRequest()) return
    next[index] = { application, access }
  } catch (error) {
    if (!isCurrentRequest()) return
    next[index] = { application, error: formatUserError(error, { fallback: '读取应用授权失败。' }) }
  } finally {
    if (isCurrentRequest()) {
      userAuthorizationPreviewEntries.value = next
      applyUserAuthorizationPreviewEntries(next)
      userAuthorizationPreviewUnavailable.value = next.length > 0 && next.every((entry) => entry.error)
    }
  }
}

async function refreshUserAuthorizationPreview() {
  const userId = detail.value?.kind === 'user' ? detail.value?.item?.user_id : ''
  const targets = userAuthorizationPreviewTargetApplications.value.length
    ? userAuthorizationPreviewTargetApplications.value
    : applications.value
  if (!userId || !canReadApplicationAuthorization.value || !targets.length || userAuthorizationPreviewLoading.value) return
  await loadUserAuthorizationPreview(userId, targets, detailAuthorizationRequestSeq.value)
}

function resetUserAuthorizationPreview() {
  userAuthorizationPreview.value = null
  userAuthorizationPreviewLoading.value = false
  userAuthorizationPreviewUnavailable.value = false
  userAuthorizationPreviewErrorCount.value = 0
  userAuthorizationPreviewEntries.value = []
  userAuthorizationPreviewTargetApplications.value = []
  userAuthorizationPreviewRetryVersions.clear()
}

function applyApplicationAccess(access) {
  applicationAccess.value = access || null
  // 快照版本只来自服务端响应（GET/PUT 返回的 edit_revision）；404/空视图时回空，
  // 让下一次写入退回兼容态而不是拿着陈旧版本反复冲突。
  applicationAccessEditRevision.value = String(access?.edit_revision || '')
  personalExceptionDirty.value = false
  const manualRoles = Array.isArray(access?.manual_roles) ? access.manual_roles : []
  // 只把手工直绑角色放进可写草稿；模板和系统角色必须保留在其来源层，不能被个人保存覆盖。
  // 仍保留目录里已过期/不可分配的 MANUAL 角色，让用户显式确认是否撤销。
  // 之前按 ACTIVE 目录过滤会让“打开详情 → 保存”把历史角色默默清空。
  authorizationDraft.role_codes = uniqueValues(manualRoles.map((role) => roleCode(role)))
  applyAuthorizationSettings(manualRoles)
  authorizationDraftBaseline.value = authorizationDraftFingerprint(authorizationDraft)
}


async function loadApplicationsForSubject() {
  const subjectId = authorizationSubjectId.value
  const subjectType = authorizationSubjectType.value
  if (!subjectId || !subjectType) return null
  const requestId = ++applicationsRequestSeq.value
  const requestIdentity = { version: requestId, subjectId, subjectType, applicationCode: '' }
  const isCurrentRequest = () => isCurrentAuthorizationRequest(requestIdentity, {
    version: applicationsRequestSeq.value,
    subjectId: authorizationSubjectId.value,
    subjectType: authorizationSubjectType.value,
    applicationCode: '',
  })
  applicationsLoading.value = true
  applicationAccessError.value = ''
  try {
    const allApps = await loadAllCatalogPages(
      listApplications,
      { pageSize: 100, status: 'ACTIVE' },
      (application) => application.application_id || application.id || application.code,
    )
    if (!isCurrentRequest()) return null
    // 个人例外授权只对已经接入基础平台（存在 environment 记录）的应用开放。
    // 未接入的子系统登记没有可授权的入口，列出来只会让用户误解为可操作。
    const onboarded = await filterOnboardedApplications(allApps)
    if (!isCurrentRequest()) return null
    // 基础平台自身的 PLATFORM 角色（尤其是 platform-super-admin）不属于子系统个人例外授权，
    // 后端会通过受保护的通用角色绑定入口管理；在这里隐藏，避免用户选择后得到 422。
    const assignableApplications = onboarded.filter((item) => String(item?.code || '').trim().toLowerCase() !== 'platform')
    applications.value = assignableApplications
    const preferredCode = selectedApplicationCode.value && assignableApplications.some((item) => item.code === selectedApplicationCode.value)
      ? selectedApplicationCode.value
      : assignableApplications[0]?.code || ''
    selectedApplicationCode.value = preferredCode
    if (preferredCode) await loadApplicationAuthorization(preferredCode)
    if (!isCurrentRequest()) return null
    return onboarded
  } catch (error) {
    if (!isCurrentRequest()) return null
    applications.value = []
    applicationAccessError.value = formatUserError(error, { fallback: '读取应用列表失败。' })
    return null
  } finally {
    if (isCurrentRequest()) applicationsLoading.value = false
  }
}

async function filterOnboardedApplications(apps) {
  if (!Array.isArray(apps) || apps.length === 0) return []
  const probes = await Promise.all(apps.map(async (app) => {
    const id = app.application_id || app.id
    if (!id) return null
    try {
      const envData = await listEnvironments({ applicationId: id, pageSize: 1, status: 'ACTIVE' })
      const count = Array.isArray(envData?.items) ? envData.items.length
        : (typeof envData?.total === 'number' ? envData.total : 0)
      return count > 0 ? app : null
    } catch (_error) {
      return app // 探测失败时保留原项，避免静默把可用应用也隐藏
    }
  }))
  return probes.filter((item) => item !== null)
}

async function loadApplicationAuthorization(applicationCode = selectedApplicationCode.value) {
  const subjectId = authorizationSubjectId.value
  const subjectType = authorizationSubjectType.value
  if (!subjectId || !subjectType || !applicationCode) return
  const application = applications.value.find((item) => item.code === applicationCode)
  if (!application) return
  // 序号仍服务于写入归属：读取开始即让在途 PUT/DELETE 的“当前主体”判断失效。
  applicationAuthorizationRequestSeq.value += 1
  // 读取作用域：contextKey 绑定当前业务对象（主体+应用）。重复读取或切换对象时，
  // 旧请求的数据/错误回写与 finally 清理都会因 isCurrent 不命中而被整体丢弃。
  const accessTicket = applicationAccessRequestScope.begin(`${subjectType}:${subjectId}:${applicationCode}`)
  const isCurrentRequest = () => applicationAccessRequestScope.isCurrent(accessTicket)
  selectedApplicationCode.value = applicationCode
  authorizationCatalog.value = null
  applicationAccess.value = null
  authorizationDraft.role_codes = []
  authorizationDraft.scope_type = 'APPLICATION'
  authorizationDraft.environment_code = ''
  authorizationDraft.validity_mode = 'PERMANENT'
  authorizationDraft.valid_from = ''
  authorizationDraft.valid_until = ''
  authorizationDraft.apply_to_existing = false
  authorizationDraftBaseline.value = ''
  personalExceptionDirty.value = false
  applicationEnvironments.value = []
  applicationAccessError.value = ''
  applicationAccessEditRevision.value = ''
  authorizationCatalogLoading.value = true
  applicationAccessLoading.value = true
  try {
    applicationEnvironmentsLoading.value = true
    try {
      const environmentData = await listEnvironments({ applicationId: application.application_id || application.id, page: 1, pageSize: 100, status: 'ACTIVE' })
      if (isCurrentRequest()) applicationEnvironments.value = Array.isArray(environmentData) ? environmentData : (environmentData?.items || [])
    } catch (error) {
      if (isCurrentRequest()) {
        applicationEnvironments.value = []
        applicationAccessError.value = formatUserError(error, { fallback: '读取应用环境失败。' })
      }
    } finally {
      if (isCurrentRequest()) applicationEnvironmentsLoading.value = false
    }

    try {
      const catalog = await getApplicationAuthorizationCatalog(application.application_id || application.id)
      if (isCurrentRequest()) authorizationCatalog.value = catalog
    } catch (error) {
      if (isCurrentRequest()) applicationAccessError.value = formatUserError(error, { fallback: '读取应用角色目录失败。' })
    } finally {
      if (isCurrentRequest()) authorizationCatalogLoading.value = false
    }

    try {
      const access = subjectType === 'USER'
        ? await getApplicationAccess(subjectId, applicationCode)
        : await getSubjectApplicationAccess(subjectType, subjectId, applicationCode)
      if (isCurrentRequest()) applyApplicationAccess(access)
    } catch (error) {
      if (error instanceof AuthorizationError && error.status === 404) {
        if (isCurrentRequest()) applyApplicationAccess(null)
      } else {
        throw error
      }
    }
  } catch (error) {
    if (isCurrentRequest()) applicationAccessError.value = formatUserError(error, { fallback: '读取应用访问授权失败。' })
  } finally {
    if (isCurrentRequest()) {
      authorizationCatalogLoading.value = false
      applicationAccessLoading.value = false
    }
  }
}

function toggleApplicationAccessExpanded() {
  applicationAccessExpanded.value = !applicationAccessExpanded.value
}

function requestApplicationSelection(nextCode) {
  const next = String(nextCode || '').trim()
  const previous = selectedApplicationCode.value
  if (!next || next === previous) return
  const selectApplication = async () => {
    selectedApplicationCode.value = next
    await loadApplicationAuthorization(next)
  }
  if (hasUnsavedAuthorizationDraft.value) {
    openConfirm({
      title: '切换应用？',
      description: '当前个人例外授权有未保存修改。切换应用会清空这些修改，是否继续？',
      confirmText: '丢弃并切换',
      danger: true,
      onConfirm: selectApplication,
    })
    return
  }
  void selectApplication()
}

function onApplicationSelectionChange(event) {
  const next = String(event?.target?.value || '').trim()
  const previous = selectedApplicationCode.value
  if (!next || next === previous) {
    if (event?.target) event.target.value = previous
    return
  }
  if (hasUnsavedAuthorizationDraft.value) {
    if (event?.target) event.target.value = previous
    openConfirm({
      title: '切换应用？',
      description: '当前个人例外授权有未保存修改。切换应用会清空这些修改，是否继续？',
      confirmText: '丢弃并切换',
      danger: true,
      onConfirm: async () => {
        selectedApplicationCode.value = next
        await loadApplicationAuthorization(next)
      },
      onCancel: () => {
        if (event?.target) event.target.value = previous
      },
    })
    return
  }
  selectedApplicationCode.value = next
  void loadApplicationAuthorization(next)
}

async function manageUserApplicationAccess(applicationCode) {
  if (!isUserAuthorizationSubject.value || !canManageApplicationAuthorization.value) return
  applicationAccessExpanded.value = true
  const code = String(applicationCode || '').trim()
  if (!code) return
  if (!applications.value.some((application) => application.code === code)) {
    if (applicationsLoading.value) return
    await loadApplicationsForSubject()
  }
  if (applications.value.some((application) => application.code === code)) requestApplicationSelection(code)
}

function onAuthorizationScopeChange() {
  if (authorizationDraft.scope_type === 'APPLICATION') authorizationDraft.environment_code = ''
  if (authorizationDraft.scope_type === 'ENVIRONMENT' && !authorizationDraft.environment_code) {
    authorizationDraft.environment_code = authorizationEnvironmentOptions.value[0]?.code || ''
  }
}

function onAuthorizationValidityChange() {
  if (authorizationDraft.validity_mode === 'PERMANENT') {
    authorizationDraft.valid_from = ''
    authorizationDraft.valid_until = ''
  }
}

function applicationAccessPayload() {
  // 仅序列化当前 ACTIVE 目录里可选的角色。不可分配的角色会在保存前的确认弹窗
  // 里被显式告知用户并由他们决定是否从草稿中移除。
  const selectableRoleCodes = new Set(authorizationRoleOptions.value.map((role) => roleCode(role)))
  const validCodes = authorizationDraft.role_codes.filter((code) => selectableRoleCodes.has(code))
  authorizationDraft.role_codes = validCodes
  const scopeType = authorizationDraft.scope_type === 'ENVIRONMENT' ? 'ENVIRONMENT' : 'APPLICATION'
  const environmentCode = scopeType === 'ENVIRONMENT' ? String(authorizationDraft.environment_code || '').trim() : null
  const validFrom = authorizationDraft.validity_mode === 'RANGE' ? toRFC3339(authorizationDraft.valid_from) : null
  const validUntil = authorizationDraft.validity_mode === 'RANGE' ? toRFC3339(authorizationDraft.valid_until) : null
  return {
    roles: validCodes.flatMap((code) => {
      const existing = applicationManualRoles.value.filter((role) => roleCode(role) === code)
      if (existing.length && !authorizationDraft.apply_to_existing) {
        return existing.map((role) => ({
          role_code: code,
          scope_type: normalizeScopeType(role.scope_type),
          environment_code: normalizeScopeType(role.scope_type) === 'ENVIRONMENT' ? role.environment_code : null,
          valid_from: role.valid_from ?? null,
          valid_until: role.valid_until ?? null,
        }))
      }
      return [{ role_code: code, scope_type: scopeType, environment_code: environmentCode, valid_from: validFrom, valid_until: validUntil }]
    }),
  }
}

async function saveApplicationAccess() {
  const subjectId = authorizationSubjectId.value
  const subjectType = authorizationSubjectType.value
  const applicationCode = selectedApplicationCode.value
  if (!subjectId || !subjectType || !applicationCode || applicationAccessSaving.value) return
  if (subjectType !== 'USER') {
    applicationAccessError.value = '组织和岗位直绑已停用新增与修改；请使用岗位授权模板配置标准角色，历史直绑只能撤销清理。'
    return
  }
  if (!authorizationRoleOptions.value.length) {
    applicationAccessError.value = '该应用目录中没有可分配的 ACTIVE 角色，无法保存授权。'
    return
  }
  if (authorizationDraft.scope_type === 'ENVIRONMENT' && !authorizationDraft.environment_code) {
    applicationAccessError.value = '选择环境级授权时必须指定一个有效环境。'
    return
  }
  if (authorizationDraft.validity_mode === 'RANGE' && authorizationDraft.valid_from && authorizationDraft.valid_until && new Date(authorizationDraft.valid_until) <= new Date(authorizationDraft.valid_from)) {
    applicationAccessError.value = '失效时间必须晚于生效时间。'
    return
  }
  // 阻断：勾选的直接角色数超过应用目录声明的最大有效角色数。该集合永远无法被授权，
  // 后端也会以同样的策略拒绝；在本地提前拦截并把具体限制说清楚，避免用户只看到“请求参数不合法”。
  if (authorizationDirectLimitExceeded.value) {
    applicationAccessError.value = `当前勾选了 ${authorizationSelectedDirectRoleCount.value} 个例外角色，超过该应用允许的最大有效角色数（${authorizationMaxEffectiveRoles.value} 个）。请取消多余角色后再保存。`
    return
  }
  if (authorizationHasRepeatedManualRoles.value) {
    applicationAccessError.value = '当前同一角色含有多条人工授权，服务端不支持同时替换。请取消该角色以撤销全部人工条目，或勾选“将当前范围/有效期统一应用到已有角色”后保存。原有授权尚未改变。'
    return
  }
  // 阻断：草稿里包含不再处于 ACTIVE 目录的角色；要求用户显式确认这些角色会被撤销。
  if (authorizationRolesToRevoke.value.length) {
    const names = authorizationRolesToRevoke.value.map((code) => {
      const role = applicationManualRoles.value.find((item) => roleCode(item) === code)
      return applicationRoleName(role || { code })
    })
    openConfirm({
      title: '确认撤销不在当前目录中的角色',
      description: `以下 ${names.length} 个角色已不在当前 ACTIVE 目录中，继续保存将自动撤销它们：\n${names.join('、')}\n\n是否继续保存？`,
      confirmText: '撤销并保存',
      danger: true,
      onConfirm: async () => {
        try {
          return await performSaveApplicationAccess()
        } finally {
          closeConfirm()
        }
      },
    })
    return
  }
  await performSaveApplicationAccess()
}

// 后端并发修改拒绝：409 + APPLICATION_ACCESS_REVISION_CONFLICT。命中时调用方必须
// 保留草稿、展示后端消息原文，且不得自动重新 GET 后重提（见方案 409 冲突处理）。
function isApplicationAccessRevisionConflict(error) {
  return error instanceof AuthorizationError
    && Number(error.status) === 409
    && String(error.code || '').trim().toUpperCase() === 'APPLICATION_ACCESS_REVISION_CONFLICT'
}

// 写入响应回到浏览器时的状态归属校验：主体类型、主体 ID 与应用编码都仍是提交时的对象。
// 写入本身以请求发起时的主体为准（服务端不会串人）；这里只决定结果能否回填当前编辑器。
function isCurrentApplicationAccessSubject(subjectType, subjectId, applicationCode) {
  return authorizationSubjectType.value === subjectType
    && authorizationSubjectId.value === subjectId
    && selectedApplicationCode.value === applicationCode
}

async function performSaveApplicationAccess() {
  const subjectId = authorizationSubjectId.value
  const subjectType = authorizationSubjectType.value
  const applicationCode = selectedApplicationCode.value
  if (!subjectId || !subjectType || !applicationCode || applicationAccessSaving.value) return false
  if (subjectType !== 'USER') {
    applicationAccessError.value = '该主体不允许保存直接角色。'
    return false
  }
  applicationAccessSaving.value = true
  applicationAccessError.value = ''
  // 保存期间用户可能关闭 A 的详情并打开 B。写入本身以请求发起时的主体为准（服务端不会串人），
  // 但响应回到浏览器时必须再校验一次当前主体：否则 A 的角色会被写进 B 的草稿，接着一次
  // 普通保存就会把 A 的角色提交给 B。
  const requestIdentity = { version: applicationAuthorizationRequestSeq.value, subjectId, subjectType, applicationCode }
  const isCurrentSubject = () => isCurrentAuthorizationRequest(requestIdentity, {
    version: applicationAuthorizationRequestSeq.value,
    subjectId: authorizationSubjectId.value,
    subjectType: authorizationSubjectType.value,
    applicationCode: selectedApplicationCode.value,
  })
  try {
    // USER 路径携带打开编辑器或最后一次成功读取时的 edit_revision 作为乐观并发条件；
    // 子系统主体直绑接口没有版本契约，保持原样。PUT 成功响应即新 Access（含新版本）。
    const access = subjectType === 'USER'
      ? await updateApplicationAccess(subjectId, applicationCode, { ...applicationAccessPayload(), expectedRevision: applicationAccessEditRevision.value })
      : await updateSubjectApplicationAccess(subjectType, subjectId, applicationCode, applicationAccessPayload())
    if (!isCurrentSubject()) {
      // 保存已成功，但不回填草稿：当前草稿属于另一个主体。
      emitToast('授权已保存；当前已切换到其他主体，本次结果不会覆盖当前草稿。')
      return true
    }
    applyApplicationAccess(access)
    if (userAuthorizationPreview.value) void retryUserAuthorizationPreview(applicationCode, { silent: true })
    emitToast(`${authorizationEntryLayerInfo.value.title}已保存。${subjectType === 'USER' ? '基础平台会在下一次请求立即按最新权限校验；已打开页面会自动刷新授权状态。' : '相关用户会按最新授权重新计算继承角色。'}`)
    return true
  } catch (error) {
    if (isCurrentSubject()) {
      // 版本冲突：保留草稿与全部输入，只提示并发修改；由管理员手动刷新后继续编辑。
      // 绝不自动重新 GET 后用新版本重提，也绝不在这里清空或回填草稿。
      applicationAccessError.value = isApplicationAccessRevisionConflict(error)
        ? formatUserError(error, { fallback: APPLICATION_ACCESS_REVISION_CONFLICT_MESSAGE })
        : formatUserError(error, { fallback: '保存应用访问授权失败。' })
    }
    return false
  } finally {
    applicationAccessSaving.value = false
  }
}

function requestCloseDetail() {
  if (hasUnsavedAuthorizationDraft.value) {
    openConfirm({
      title: '关闭详情？',
      description: isUserAuthorizationSubject.value
        ? '当前个人例外授权有未保存修改。关闭详情会放弃这些修改，是否继续？'
        : '当前授权表单有未保存修改。关闭详情会放弃这些修改，是否继续？',
      confirmText: '放弃并关闭',
      cancelText: '继续编辑',
      danger: true,
      onConfirm: () => {
        personalExceptionDirty.value = false
        closeDetail()
        return true
      },
    })
    return
  }
  closeDetail()
}

function onPersonalExceptionDirtyChange(value) {
  personalExceptionDirty.value = Boolean(value)
}

function onPersonalExceptionApplicationChange(payload) {
  const event = payload?.event || { target: { value: payload?.code || '' } }
  onApplicationSelectionChange(event)
}

async function refreshPersonalExceptionOverview(applicationCode) {
  const userId = detail.value?.kind === 'user' ? detail.value?.item?.user_id : ''
  if (!userId || !applicationCode) return true
  const entries = userAuthorizationPreviewEntries.value
  if (Array.isArray(entries) && entries.some((entry) => String(entry?.application?.code || '') === applicationCode)) {
    await retryUserAuthorizationPreview(applicationCode)
    const current = userAuthorizationPreviewEntries.value.find((entry) => String(entry?.application?.code || '') === applicationCode)
    return !current?.error
  }
  if (applications.value.length) {
    await loadUserAuthorizationPreview(userId, applications.value, detailAuthorizationRequestSeq.value)
    return !userAuthorizationPreviewUnavailable.value
  }
  return true
}

// 第一阶段沿用完整集合 PUT，并以打开编辑器/最后一次成功读取时的 edit_revision 作为
// 乐观并发条件：并发修改返回 409 时保留草稿，由管理员刷新后重试，而不是静默覆盖。
// 前端预读/脏检查只能发现部分变化，不能替代这个服务端版本条件。
function performPersonalExceptionSave({ payload, summary, title = '确认保存个人例外授权', confirmText = '确认保存', danger = false }) {
  const subjectId = authorizationSubjectId.value
  const subjectType = authorizationSubjectType.value
  const applicationCode = selectedApplicationCode.value
  if (!payload || !Array.isArray(payload.roles) || subjectType !== 'USER' || !subjectId || !applicationCode || applicationAccessSaving.value) return
  openConfirm({
    title,
    description: summary + '\n\n确认提交这次个人例外授权变更吗？',
    confirmText,
    danger,
    onConfirm: async () => {
      if (applicationAccessSaving.value) return false
      applicationAccessSaving.value = true
      applicationAccessError.value = ''
      const requestIdentity = { version: applicationAuthorizationRequestSeq.value, subjectId, subjectType, applicationCode }
      const isCurrentSubject = () => isCurrentAuthorizationRequest(requestIdentity, {
        version: applicationAuthorizationRequestSeq.value,
        subjectId: authorizationSubjectId.value,
        subjectType: authorizationSubjectType.value,
        applicationCode: selectedApplicationCode.value,
      })
      try {
        const access = await updateApplicationAccess(subjectId, applicationCode, { roles: payload.roles, expectedRevision: applicationAccessEditRevision.value })
        if (!isCurrentSubject()) {
          emitToast('个人例外授权已保存；当前已切换到其他主体，本次结果不会覆盖当前草稿。')
          return true
        }
        applyApplicationAccess(access)
        personalExceptionDirty.value = false
        emitToast('个人例外授权已保存。基础平台会在下一次请求立即按最新权限校验；已打开页面会自动刷新授权状态。')
        void refreshPersonalExceptionOverview(applicationCode).then((refreshed) => {
          if (!refreshed) emitToast('个人例外授权已保存，但有效授权总览刷新失败，请刷新页面核对。')
        })
        return true
      } catch (error) {
        if (isCurrentSubject()) {
          // 版本冲突：保留草稿与全部输入，只提示并发修改；由管理员手动刷新后继续编辑。
          applicationAccessError.value = isApplicationAccessRevisionConflict(error)
            ? formatUserError(error, { fallback: APPLICATION_ACCESS_REVISION_CONFLICT_MESSAGE })
            : formatUserError(error, { fallback: '保存个人例外授权失败。' })
        }
        return false
      } finally {
        // 单飞标志属于组件级互斥：本次写入已落定就必须释放，否则切换主体后
        // 新主体的保存会永久卡在“进行中”。响应能否回填仍由 isCurrentSubject 把关。
        applicationAccessSaving.value = false
      }
    },
  })
}

function savePersonalException({ payload, summary } = {}) {
  performPersonalExceptionSave({ payload, summary })
}

function revokePersonalExceptionRole({ payload, summary } = {}) {
  performPersonalExceptionSave({
    payload,
    summary,
    title: '确认撤销角色个人例外',
    confirmText: '确认撤销',
    danger: true,
  })
}

function revokeAllPersonalExceptions({ count = 0, inheritedCount = 0 } = {}) {
  const subjectId = authorizationSubjectId.value
  const subjectType = authorizationSubjectType.value
  const applicationCode = selectedApplicationCode.value
  if (subjectType !== 'USER' || !subjectId || !applicationCode || applicationAccessRevoking.value) return
  const inheritedNote = inheritedCount
    ? '岗位/组织继承来源不会被删除，仍按原规则生效。'
    : '本次只删除该应用下的个人例外，不会新增或删除岗位/组织继承来源。'
  openConfirm({
    title: '确认撤销全部个人例外',
    description: '将撤销“' + applicationDisplayName(selectedApplication.value) + '”下该用户的 ' + count + ' 项个人例外（包含待生效记录）。\n\n' + inheritedNote,
    confirmText: '确认全部撤销',
    danger: true,
    onConfirm: async () => {
      if (applicationAccessRevoking.value) return false
      applicationAccessRevoking.value = true
      applicationAccessError.value = ''
      try {
        await deleteApplicationAccess(subjectId, applicationCode, { expectedRevision: applicationAccessEditRevision.value })
        if (isCurrentApplicationAccessSubject(subjectType, subjectId, applicationCode)) {
          personalExceptionDirty.value = false
          await loadApplicationAuthorization(applicationCode)
          if (applicationAccessError.value) {
            // 写入已成功（HTTP 200）；随后的列表/详情读取失败只说明展示未更新，
            // 不得回退为未撤销状态，也不得把读取失败报成撤销失败。
            emitToast('个人例外已撤销，但最新展示读取失败，请刷新页面核对。')
          } else {
            emitToast('该应用下的个人例外已全部撤销；岗位/组织继承来源不受影响。')
            void refreshPersonalExceptionOverview(applicationCode).then((refreshed) => {
              if (!refreshed) emitToast('个人例外已撤销，但有效授权总览刷新失败，请刷新页面核对。')
            })
          }
        } else {
          emitToast('个人例外已撤销；当前已切换到其他主体，本次结果不会覆盖当前草稿。')
        }
        return true
      } catch (error) {
        if (isCurrentApplicationAccessSubject(subjectType, subjectId, applicationCode)) {
          // 版本冲突：保留草稿并展示后端消息原文；不得自动重取重发撤销请求。
          applicationAccessError.value = isApplicationAccessRevisionConflict(error)
            ? formatUserError(error, { fallback: APPLICATION_ACCESS_REVISION_CONFLICT_MESSAGE })
            : formatUserError(error, { fallback: '撤销个人例外失败。' })
        }
        return false
      } finally {
        applicationAccessRevoking.value = false
      }
    },
  })
}

async function revokeApplicationAccess() {
  const subjectId = authorizationSubjectId.value
  const subjectType = authorizationSubjectType.value
  const applicationCode = selectedApplicationCode.value
  if (!subjectId || !subjectType || !applicationCode || applicationAccessRevoking.value) return
  const subjectName = detail.value?.item?.display_name || detail.value?.item?.name || subjectId
  const inheritedNote = isLegacyStructuralAuthorizationSubject.value
    ? '清理后请通过岗位授权模板维护标准应用角色；组织不再承载授权，岗位不再直接绑定角色。'
    : isUserAuthorizationSubject.value && applicationInheritedRoles.value.length
    ? '撤销后，组织或岗位继承的标准授权仍然有效，不会被删除。'
    : `撤销后，将删除该${authorizationSubjectLabel.value}在当前应用下的例外角色绑定。`
  openConfirm({
    title: isLegacyStructuralAuthorizationSubject.value ? '确认清理历史直绑' : '确认撤销个人例外',
    description: `确认${isLegacyStructuralAuthorizationSubject.value ? '清理' : '撤销'}${authorizationSubjectLabel.value}“${subjectName}”在“${applicationDisplayName(selectedApplication.value)}”下的${isLegacyStructuralAuthorizationSubject.value ? '历史直绑' : '个人例外'}吗？\n\n${inheritedNote}`,
    confirmText: isLegacyStructuralAuthorizationSubject.value ? '确认清理' : '确认撤销',
    danger: true,
    onConfirm: async () => {
      if (applicationAccessRevoking.value) return
      applicationAccessRevoking.value = true
      applicationAccessError.value = ''
      try {
        if (subjectType === 'USER') await deleteApplicationAccess(subjectId, applicationCode, { expectedRevision: applicationAccessEditRevision.value })
        else await deleteSubjectApplicationAccess(subjectType, subjectId, applicationCode)
        if (isCurrentApplicationAccessSubject(subjectType, subjectId, applicationCode)) {
          await loadApplicationAuthorization(applicationCode)
          if (userAuthorizationPreview.value && selectedApplicationCode.value === applicationCode) {
            void retryUserAuthorizationPreview(applicationCode, { silent: true })
          }
          if (applicationAccessError.value) {
            // 写入已成功（HTTP 200）；随后的读取失败只说明展示未更新，
            // 不得回退为未撤销状态，也不得把读取失败报成撤销失败。
            emitToast(`${authorizationEntryLayerInfo.value.title}已撤销，但最新展示读取失败，请刷新页面核对。`)
          } else {
            emitToast(isLegacyStructuralAuthorizationSubject.value
              ? `${authorizationSubjectLabel.value}历史直绑已清理；标准角色请在岗位授权模板中维护。`
              : isUserAuthorizationSubject.value && applicationInheritedRoles.value.length
              ? '个人例外授权已撤销；组织或岗位继承的标准授权仍然有效。'
              : `${authorizationEntryLayerInfo.value.title}已撤销。`)
          }
        } else {
          // 已切换主体：不再让旧撤销触发的重读把新主体的应用选择拉回旧值。
          emitToast(`${authorizationEntryLayerInfo.value.title}已撤销；当前已切换到其他主体，本次结果不会覆盖当前草稿。`)
        }
      } catch (error) {
        if (isCurrentApplicationAccessSubject(subjectType, subjectId, applicationCode)) {
          // 版本冲突：保留草稿并展示后端消息原文；不得自动重取重发撤销请求。
          applicationAccessError.value = isApplicationAccessRevisionConflict(error)
            ? formatUserError(error, { fallback: APPLICATION_ACCESS_REVISION_CONFLICT_MESSAGE })
            : formatUserError(error, { fallback: '撤销应用访问失败。' })
        }
        return false
      } finally {
        applicationAccessRevoking.value = false
        closeConfirm()
      }
    },
  })
}

function resetFilters() {
  Object.keys(panelFilters).forEach((key) => { panelFilters[key] = '' })
  emitToast('已清空筛选条件。')
}

async function copyText(value, { success = '已复制' } = {}) {
  if (!value) return false
  try {
    await copyTextToClipboard(value)
    emitToast(success)
    return true
  } catch {
    emitToast('复制失败，请手动选中复制。')
    return false
  }
}

function downloadCsv(filename, headers, rows) {
  // 转义统一由 utils/csvExport.js 负责：结构转义 + 公式前缀中和。
  const csv = toCsvText(headers, rows)
  // 加 BOM 让 Excel 识别 UTF-8。
  const blob = new Blob(['\ufeff', csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function exportActivePanelCsv() {
  const key = activePanel.value
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  if (key === 'users') {
    downloadCsv(`iam-users-${stamp}.csv`,
      ['用户 ID', '姓名', '工号', '邮箱', '手机号（脱敏）', '主组织 ID', '任职状态', '用户状态', '版本', '更新时间'],
      filteredUsers.value.map((item) => [
        item.user_id || item.id || '',
        item.display_name || item.name || '',
        item.employee_no || '',
        item.email || '',
        item.mobile_masked || '',
        item.primary_org_id || item.primary_organization_id || '',
        item.employment_status || '',
        displayStatus(item.status),
        item.version ?? '',
        formatDateTime(item.updated_at),
      ]))
  } else if (key === 'accounts') {
    downloadCsv(`iam-accounts-${stamp}.csv`,
      ['账号 ID', '登录账号', '关联用户 ID', '关联用户姓名', '账号类型', '认证来源', '密码状态', '有效截止时间', '状态', '版本', '更新时间'],
      filteredAccounts.value.map((item) => {
        const accountType = displayLoginAccountType(item).split(' / ')
        return [
          item.account_id || item.id || '',
          item.account_name || item.username || '',
          item.user_id || item.user?.id || '',
          item.user?.display_name || item.user?.name || '',
          accountType[0] || '',
          accountType[1] || '',
          item.password_initialized === false ? '待初始化密码' : '已初始化密码',
          item.valid_until ? formatDateTime(item.valid_until) : '长期有效',
          displayStatus(item.status),
          item.version ?? '',
          formatDateTime(item.updated_at),
        ]
      }))
  } else if (key === 'organizations') {
    downloadCsv(`iam-organizations-${stamp}.csv`,
      ['树状名称', '组织 ID', '组织编码', '组织名称', '上级组织 ID', '上级组织名称', '组织路径', '层级', '显示顺序', '状态', '版本', '更新时间'],
      organizationExportRows.value.map((item) => {
        const id = item.id
        const context = item
        const parentId = item.parent_id || ''
        const parent = organizations.value.find((candidate) => String(candidate.org_unit_id || candidate.id || '') === String(parentId))
        return [
          item.treeName,
          id,
          item.code || '',
          item.name || '',
          parentId,
          parent?.name || (parentId ? '上级组织不可见' : ''),
          context.path || item.name || item.code || id,
          context.depth ?? '',
          item.sort_order ?? 0,
          displayStatus(item.status),
          item.version ?? '',
          formatDateTime(item.updated_at),
        ]
      }))
  } else if (key === 'positions') {
    downloadCsv(`iam-positions-${stamp}.csv`,
      ['树状名称', '岗位 ID', '岗位编码', '岗位名称', '组织 ID', '组织编码', '所属组织', '组织路径', '状态', '版本', '更新时间'],
      positionExportRows.value.map((item) => [
        item.treeName,
        item.id,
        item.code || '',
        item.name || item.position_name || '',
        item.organization_id || item.org_unit_id || '',
        item.organization_code || '',
        item.organization_name || '',
        item.organization_path || '',
        displayStatus(item.status),
        item.version ?? '',
        formatDateTime(item.updated_at),
      ]))
  } else if (key === 'memberships') {
    downloadCsv(`iam-memberships-${stamp}.csv`,
      ['任职 ID', '用户 ID', '用户姓名', '组织 ID', '组织编码', '组织名称', '组织路径', '岗位 ID', '岗位编码', '岗位名称', '任职类型', '是否主组织', '是否继承岗位授权', '生效时间', '失效时间', '状态', '版本', '更新时间'],
      filteredMemberships.value.map((item) => {
        const membershipId = item.membership_id || item.id || ''
        const userId = item.user_id || item.user?.id || ''
        const organizationId = item.org_unit_id || item.org_unit?.id || item.org_unit?.org_unit_id || ''
        const positionId = item.position_id || item.position?.id || ''
        const organization = organizations.value.find((candidate) => String(candidate.org_unit_id || candidate.id || '') === String(organizationId))
        const position = positions.value.find((candidate) => String(candidate.position_id || candidate.id || '') === String(positionId))
        const context = organizationExportContext.value.get(String(organizationId)) || {}
        return [
          membershipId,
          userId,
          item.user?.display_name || item.user?.name || '',
          organizationId,
          organization?.code || '',
          item.org_unit?.name || organization?.name || '',
          context.path || organization?.name || organizationId,
          positionId,
          position?.code || '',
          item.position?.name || position?.name || '',
          displayMembershipType(item.membership_type),
          item.is_primary ? '是' : '否',
          item.inherit_authorization === false ? '不继承' : '继承',
          formatDateTime(item.effective_from || item.valid_from),
          formatDateTime(item.effective_to || item.valid_until),
          displayStatus(item.status),
          item.version ?? '',
          formatDateTime(item.updated_at),
        ]
      }))
  } else {
    emitToast('当前面板暂不支持导出。')
  }
}

async function safeCall(kind, fn) {
  loading[kind] = true
  errorMessage.value = ''
  try {
    return await fn()
  } catch (error) {
    const label = panels.find((item) => item.key === kind)?.label || '相关数据'
    errorMessage.value = formatUserError(error, { fallback: `${label}加载失败，请稍后重试。` })
    return null
  } finally {
    loading[kind] = false
  }
}

function updatePage(key, data, items, { verifyPageSize = false } = {}) {
  pagination[key].page = data.page || 1
  pagination[key].pageSize = data.pageSize || pageSize
  pagination[key].total = data.total || 0
  if (verifyPageSize) pagination[key].serverPagingSupported = pagination[key].pageSize === pageSize
  items.value = data.items
}

// 组织目录状态与加载（治理批次 2 第二步）：organizations/加载/过滤/导出计算收编到
// useOrganizationDirectory；编辑器与删除编排仍留在本组件（跨面板协调属父组件职责）。
// 置于 safeCall/updatePage 之后，保持既有测试的函数体切片区间不变。
const {
  organizations,
  loadOrganizations,
  filteredOrganizations,
  organizationExportRows,
  organizationExportContext,
} = useOrganizationDirectory({ canReadPanel, panels, requestSeq, pagination, safeCall, panelFilters, listOrgUnits })

async function loadUsers(page = pagination.users.page) {
  if (!canReadPanel(panels.find((item) => item.key === 'users'))) return
  const seq = ++requestSeq.users
  const data = await safeCall('users', () => listUsers({ page, pageSize: userPageSize.value, keyword: panelFilters.users, status: 'ACTIVE' }))
  if (seq !== requestSeq.users) return
  if (data) updatePage('users', data, users)
}

function changeUserPageSize() {
  pagination.users.page = 1
  // 变更每页条数后以第一页重新查询，防止旧页码在新总页数下落到空页。
  requestSeq.users += 1
  loadUsers(1)
}

async function loadAccounts(page = pagination.accounts.page) {
  if (!canReadPanel(panels.find((item) => item.key === 'accounts'))) return
  const seq = ++requestSeq.accounts
  const data = await safeCall('accounts', () => listAccounts({ page, pageSize, keyword: panelFilters.accounts }))
  if (seq !== requestSeq.accounts) return
  if (data) updatePage('accounts', data, accounts)
}

async function loadPositions() {
  if (!canReadPanel(panels.find((item) => item.key === 'positions'))) return
  const seq = ++requestSeq.positions
  // 分组必须拥有同一组织下的全部岗位。按后端最大页长读取全部授权可见岗位，搜索在
  // 前端同时匹配岗位与组织名称，避免同一组织被服务端分页拆成多个不完整分组。
  const groupedPageSize = 100
  const data = await safeCall('positions', async () => {
    const items = []
    const seenIds = new Set()
    let page = 1
    let total = 0

    while (page === 1 || items.length < total) {
      const result = await listPositions({ page, pageSize: groupedPageSize, status: 'ACTIVE' })
      total = result.total
      let added = 0
      for (const item of result.items) {
        const id = String(item.position_id || item.id || '')
        if (!id || seenIds.has(id)) continue
        seenIds.add(id)
        items.push(item)
        added += 1
      }
      if (!result.items.length || added === 0) break
      page += 1
    }

    const complete = items.length >= total
    return { items, total, pageSize: complete ? Math.max(total, groupedPageSize) : groupedPageSize }
  })
  if (seq !== requestSeq.positions) return
  if (data) {
    pagination.positions.page = 1
    pagination.positions.pageSize = data.pageSize
    pagination.positions.total = data.total
    pagination.positions.serverPagingSupported = data.items.length >= data.total
    positions.value = data.items
  }
}

async function loadMemberships() {
  if (!canReadPanel(panels.find((item) => item.key === 'memberships'))) return
  const seq = ++requestSeq.memberships
  // 组织分组不能只基于当前分页，否则同一组织会被拆分且数量失真。逐页读取完整的
  // 授权可见任职目录，按稳定 ID 去重；关键字留在前端匹配以保留完整组织上下文。
  const groupedPageSize = 100
  const data = await safeCall('memberships', async () => {
    const items = []
    const seenIds = new Set()
    let page = 1
    let total = 0

    while (page === 1 || items.length < total) {
      const result = await listMemberships({ page, pageSize: groupedPageSize, status: 'ACTIVE' })
      total = result.total
      let added = 0
      for (const item of result.items) {
        const id = String(item.membership_id || item.id || '')
        if (!id || seenIds.has(id)) continue
        seenIds.add(id)
        items.push(item)
        added += 1
      }
      if (!result.items.length || added === 0) break
      page += 1
    }

    const complete = items.length >= total
    return { items, total, pageSize: complete ? Math.max(total, groupedPageSize) : groupedPageSize }
  })
  if (seq !== requestSeq.memberships) return
  if (data) {
    pagination.memberships.page = 1
    pagination.memberships.pageSize = data.pageSize
    pagination.memberships.total = data.total
    pagination.memberships.serverPagingSupported = data.items.length >= data.total
    memberships.value = data.items
  }
}



async function reloadActive() {
  const active = panels.find((item) => item.key === activePanel.value)
  if (!canReadPanel(active)) return
  switch (activePanel.value) {
    case 'users': await loadUsers(); break
    case 'accounts': await loadAccounts(); break
    case 'organizations': await loadOrganizations(); break
    case 'positions': await loadPositions(); break
    case 'memberships': await loadMemberships(); break
    case 'positionAuthorizationTemplates': await positionAuthorizationTemplates.value?.reload(); break
    default: break
  }
}

async function reloadVisiblePanels() {
  const loaders = {
    users: loadUsers,
    accounts: loadAccounts,
    organizations: loadOrganizations,
    positions: loadPositions,
    memberships: loadMemberships,
  }
  await Promise.all(visiblePanels.value
    .filter(canReadPanel)
    .map((panel) => loaders[panel.key])
    .filter(Boolean)
    .map((loader) => loader()))
}

function pageTotal(key) {
  return Math.max(1, Math.ceil(pagination[key].total / pagination[key].pageSize))
}

function goToPage(key, page) {
  const next = Math.min(Math.max(1, page), pageTotal(key))
  if (next === pagination[key].page) return
  pagination[key].page = next
  // 让上一次同 panel 的 load 自然失效，避免快速翻页时旧页响应覆盖新页。
  if (requestSeq[key] !== undefined) requestSeq[key] += 1
  reloadActive()
}

const activePagination = computed(() => pagination[activePanel.value] || null)
const activeServerPagingUnavailable = computed(() => activePagination.value?.serverPagingSupported === false)
const activeLoading = computed(() => loading[activePanel.value])

let filterTimer

watch(visiblePanels, (items) => {
  if (items.length && !items.some((item) => item.key === activePanel.value)) {
    activePanel.value = items[0].key
  }
}, { immediate: true })

// 切换 panel 时同步清理挂起的筛选防抖和上次未完成的列表请求，
// 避免“上一个 panel 的筛选触发的 load” 在新 panel 落地后把列表覆盖。
watch(activePanel, () => {
  clearTimeout(filterTimer)
  filterTimer = 0
  // 序号递增会在下一次 reload 时让上一次响应自然失效。
  Object.keys(requestSeq).forEach((key) => { requestSeq[key] += 1 })
  detail.value = null
  reloadActive()
})

watch(() => props.refreshKey, (current, previous) => {
  if (!current || current === previous) return
  // 员工入职成功会改变三个列表和全部五个汇总数量。
  // 同时使所有可见 IAM 列表失效；各加载器自身的
  // 请求序号仍用于防止旧响应在竞态中覆盖新结果。
  detail.value = null
  Object.keys(requestSeq).forEach((key) => { requestSeq[key] += 1 })
  reloadVisiblePanels()
})

watch(panelFilters, () => {
  clearTimeout(filterTimer)
  // 组织树、岗位和任职分组均已一次性读取完整数据，并在前端保留组织上下文，无需重复请求。
  if (['organizations', 'positions', 'memberships'].includes(activePanel.value)) return
  filterTimer = setTimeout(() => {
    const key = activePanel.value
    if (pagination[key]) pagination[key].page = 1
    reloadActive()
  }, 250)
}, { deep: true })


function isAccountStatusManageable(status) {
  return ['ACTIVE', 'DISABLED'].includes(String(status || '').toUpperCase())
}

async function toggleAccountStatus(account) {
  if (!account?.account_id || !isAccountStatusManageable(account.status) || updatingAccountId.value) return
  const version = Number(account.version)
  if (!Number.isInteger(version) || version < 1) {
    emitToast('账号版本信息无效，请刷新列表后重试。')
    return
  }
  const next = String(account.status).toUpperCase() === 'ACTIVE' ? 'DISABLED' : 'ACTIVE'
  updatingAccountId.value = account.account_id
  try {
    const updated = await updateAccountStatus({ accountId: account.account_id, status: next, version })
    Object.assign(account, updated)
    emitToast(`账号已${next === 'ACTIVE' ? '启用' : '停用'}。`)
  } catch (error) {
    emitToast(formatUserError(error, { fallback: '账号状态更新失败。' }))
  } finally {
    updatingAccountId.value = ''
  }
}

function openValidityEditor(kind, item) {
  const validUntil = item?.valid_until ? toDateTimeLocal(item.valid_until) : defaultAccountValidUntil()
  validityEditor.value = {
    kind,
    item,
    mode: item?.valid_until ? 'TEMPORARY' : 'PERMANENT',
    valid_until: validUntil,
  }
}

function closeValidityEditor() {
  if (!validitySaving.value) validityEditor.value = null
}

async function saveValidity() {
  const draft = validityEditor.value
  if (!draft || validitySaving.value) return
  const validUntil = draft.mode === 'PERMANENT' ? null : resolveExpiresAt(draft.valid_until)
  if (draft.mode !== 'PERMANENT' && (!validUntil || new Date(validUntil).getTime() <= Date.now())) {
    emitToast('有效截止时间必须晚于当前时间。')
    return
  }
  const item = draft.item
  const version = Number(item?.version)
  if (!Number.isInteger(version) || version < 1) {
    emitToast('版本信息无效，请刷新后重试。')
    return
  }
  validitySaving.value = true
  try {
    let updated
    if (draft.kind === 'user') {
      updated = await updateUser({
        userId: item.user_id,
        displayName: item.display_name,
        employeeNo: item.employee_no || '',
        email: item.email || '',
        mobile: undefined,
        status: item.status,
        version,
        validUntil,
        updateValidity: true,
      })
    } else {
      updated = await updateAccountStatus({
        accountId: item.account_id,
        status: item.status,
        version,
        validUntil,
        updateValidity: true,
      })
    }
    Object.assign(item, updated)
    if (detail.value?.item === item) detail.value.item = item
    emitToast(`${draft.kind === 'user' ? '用户' : '账号'}有效期已更新。`)
    validityEditor.value = null
  } catch (error) {
    emitToast(formatUserError(error, { fallback: '有效期更新失败。' }))
  } finally {
    validitySaving.value = false
  }
}

// 密码重置始终以用户详情中选定的 account_id 为键；多账号用户必须逐个明确操作，
// 不能仅凭姓名或 user_id 猜测目标登录账号。
function openPasswordResetForAccount(account, userName = '') {
  if (!account?.account_id) {
    emitToast('未找到可重置密码的登录账号。')
    return
  }
  passwordResetDialog.value = { accountId: account.account_id, accounts: [account], userName, initialize: account.password_initialized === false }
}

function openPasswordResetFromUserDetail(account) {
  if (!isUserAuthorizationSubject.value) return
  openPasswordResetForAccount(account, detail.value?.item?.display_name || detail.value?.item?.name || '')
}

function closePasswordResetDialog() {
  if (resettingPassword.value) return
  passwordResetDialog.value = null
}

async function confirmPasswordReset() {
  const account = selectedPasswordResetAccount.value
  if (!account?.account_id || resettingPassword.value) return
  const initializing = account.password_initialized === false
  let passwordResetConfirmed = false

  resettingPassword.value = true
  try {
    const result = await resetAccountPassword({ accountId: account.account_id, version: account.version || 0 })
    if (!result?.temporary_password) {
      throw new IamError('后端未返回一次性临时密码，无法安全完成密码重置。')
    }
    passwordResetDialog.value = null
    temporaryPassword.value = {
      accountId: result.account_id || account.account_id,
      accountName: account.account_name || account.account_id,
      value: result.temporary_password,
      initialized: initializing,
    }
    passwordResetConfirmed = true
    const userId = detail.value?.kind === 'user' ? detail.value.item?.user_id : ''
    await Promise.all([
      loadAccounts(),
      userId ? loadAuthorizationOverview(userId, detailAuthorizationRequestSeq.value) : Promise.resolve(),
    ])
    emitToast(initializing ? '登录密码已初始化，请立即复制并通过安全渠道交付。' : '密码已重置，请立即复制临时密码并通过安全渠道交付。')
  } catch (error) {
    const reason = formatUserError(error, { fallback: '请刷新账号列表核对状态。' }).slice(0, 180)
    emitToast(passwordResetConfirmed
      ? `密码已${initializing ? '初始化' : '重置'}，但账号列表未刷新。${reason}请先安全交付当前一次性临时密码，勿重复重置。`
      : formatUserError(error, { fallback: '密码重置失败。' }))
  } finally {
    resettingPassword.value = false
  }
}

async function copyTemporaryPassword() {
  const value = temporaryPassword.value?.value
  if (!value) return
  const copied = await copyText(value, { success: '临时密码已复制，请立即通过安全渠道交付。' })
  if (!copied) return
  // SEC-X10：临时密码是敏感明文，复制成功后安排延时自动清除剪贴板；
  // 非安全上下文（HTTP 回退复制）无法在复制之后回写剪贴板，降级为手动覆盖提示。
  const { supported } = scheduleSensitiveClipboardClear(value)
  if (!supported) {
    emitToast('当前浏览器环境无法自动清除剪贴板，交付后请手动覆盖剪贴板内容。')
  }
}

// 临时密码揭示状态：默认遮罩，避免屏幕共享/截屏/拼写补全等渠道意外泄露。
const temporaryPasswordVisible = ref(false)
function revealTemporaryPassword() {
  if (!temporaryPassword.value?.value) return
  temporaryPasswordVisible.value = true
}
function hideTemporaryPassword() {
  temporaryPasswordVisible.value = false
}

// 关闭弹窗会清除浏览器内存中的明文；此页面无法再次查看，未复制时只能由管理员重新发起重置。
function closeTemporaryPassword() {
  temporaryPassword.value = null
  temporaryPasswordVisible.value = false
}

function openUserDeletionDialog(user) {
  if (!user?.user_id) {
    emitToast('未找到要删除的用户。')
    return
  }
  userDeletionDialog.value = user
}

function closeUserDeletionDialog() {
  if (deletingUser.value) return
  userDeletionDialog.value = null
}

async function confirmUserDeletion() {
  const user = userDeletionDialog.value
  if (!user?.user_id || deletingUser.value) return

  deletingUser.value = true
  try {
    await deleteUser({ userId: user.user_id, version: user.version || 0 })
    userDeletionDialog.value = null
    if (detail.value?.kind === 'user' && detail.value.item?.user_id === user.user_id) closeDetail()
    await Promise.all([loadUsers(), loadAccounts(), loadMemberships()])
    emitToast(`用户 ${user.display_name || user.user_id} 已删除，关联登录账号和任职关系已同步删除。`)
  } catch (error) {
    emitToast(formatUserError(error, { fallback: '删除用户失败。' }))
  } finally {
    deletingUser.value = false
  }
}

// 离职不能走「直接 PATCH 用户为 DISABLED」的旁路：
// 该路径会立刻停用账号、凭据、任职和会话，绕过异动审批与责任交接，而且请求携带的
// mobile:"" 会把手机号密文与摘要写成 NULL。这里改为把员工带到人员异动中心发起离职申请，
// 由既有的审批与交接链路执行；查询与目录刷新沿用异动中心自己的逻辑。
function terminateEmployee(user) {
  if (!user?.user_id || (user.status || '').toUpperCase() !== 'ACTIVE') return
  openConfirm({
    title: '离职必须通过人员异动中心办理',
    description: `离职会停用 ${user.display_name || user.user_id} 的账号、凭据、任职和登录会话，必须经过异动审批与责任交接。确认后将前往「人员异动中心」为该员工创建离职申请。`,
    confirmText: '前往人员异动中心',
    danger: true,
    onConfirm: async () => {
      emit('personnel-change', { user_id: user.user_id, display_name: user.display_name })
      return true
    },
  })
}

async function openOrganizationEditor(organization) {
  if (!organization?.org_unit_id) return
  openEditor('organization')
  Object.assign(form, {
    name: organization.name || '',
    parent_id: organization.parent_id || '',
    sort_order: Number(organization.sort_order || 0),
  })
  editor.value = { kind: 'organization', label: '组织单元', mode: 'edit', orgUnitId: organization.org_unit_id, version: organization.version }
  markEditorClean()
}

function openChildOrganizationEditor(parent) {
  const parentId = String(parent?.org_unit_id || parent?.id || '')
  if (!parentId) return
  openEditor('organization')
  form.parent_id = parentId
  markEditorClean()
}

function openPositionEditorForOrganization(group) {
  const organizationId = String(group?.organization_id || group?.org_unit_id || group?.id || '')
  if (!organizationId) return
  openEditor('position')
  form.org_unit_id = organizationId
  markEditorClean()
}

async function removeOrganization(organization) {
  if (!organization?.org_unit_id || deletingOrganizationId.value) return
  const version = Number(organization.version)
  if (!Number.isInteger(version) || version < 1) {
    emitToast('组织版本信息无效，请刷新列表后重试。')
    return
  }
  openConfirm({
    title: '确认删除组织',
    description: `确认删除组织“${organization.name}”吗？其岗位和任职关系将一并停用，且当前操作不可恢复。`,
    confirmText: '确认删除',
    danger: true,
    onConfirm: async () => {
      if (deletingOrganizationId.value) return
      deletingOrganizationId.value = organization.org_unit_id
      try {
        await deleteOrgUnit({ orgUnitId: organization.org_unit_id, version })
        if (detail.value?.kind === 'organization' && detail.value.item?.org_unit_id === organization.org_unit_id) closeDetail()
        await Promise.all([loadOrganizations(), loadPositions(), loadMemberships()])
        emitToast(`组织 ${organization.name} 已删除，相关岗位和任职关系已停用。`)
      } catch (error) {
        emitToast(formatUserError(error, { fallback: '删除组织失败。' }))
        return false
      } finally {
        deletingOrganizationId.value = ''
        closeConfirm()
      }
    },
  })
}

async function removePosition(position) {
  const positionId = position?.position_id || position?.id
  if (!positionId || deletingPositionId.value) return
  const version = Number(position.version)
  if (!Number.isInteger(version) || version < 1) {
    emitToast('岗位版本信息无效，请刷新列表后重试。')
    return
  }
  openConfirm({
    title: '确认删除岗位',
    description: `确认删除岗位“${position.name}”吗？\n\n删除后：\n1. 岗位将被停用并从可选岗位中移除；\n2. 关联的有效任职关系将一并停用；\n3. 该岗位继承的应用角色将失效；\n4. 历史记录仍会保留。`,
    confirmText: '确认删除',
    danger: true,
    onConfirm: async () => {
      if (deletingPositionId.value) return
      deletingPositionId.value = positionId
      try {
        await deletePosition({ positionId, version })
        if (detail.value?.kind === 'position' && (detail.value.item?.position_id || detail.value.item?.id) === positionId) closeDetail()
        await Promise.all([loadPositions(), loadMemberships()])
        emitToast(`岗位 ${position.name || positionId} 已删除，相关任职关系和岗位继承授权已停用。`)
      } catch (error) {
        emitToast(formatUserError(error, { fallback: '删除岗位失败。' }))
        return false
      } finally {
        deletingPositionId.value = ''
        closeConfirm()
      }
    },
  })
}

// ---- 新增（对接真实 API）----
const editor = ref(null) // { kind, label }
const editorModal = ref(null)
// 编辑器表单位于 IdentityEditorModal 子组件；焦点陷阱容器经子组件 expose 的 form 元素获取。
const editorElement = computed(() => editorModal.value?.formEl ?? null)
const form = reactive({})
const editorInitialSnapshot = ref('')
const saving = ref(false)

function markEditorClean() {
  editorInitialSnapshot.value = createFormSnapshot(form)
}

useBeforeUnloadGuard(computed(() => Boolean(editor.value) && hasUnsavedChanges(editorInitialSnapshot.value, form)))
useDialogFocusTrap({ active: computed(() => Boolean(editor.value)), container: editorElement, initialFocus: 'input:not([type="hidden"]), select, textarea' })

onBeforeRouteLeave(() => {
  if (!editor.value) return true
  if (saving.value) return false
  if (!hasUnsavedChanges(editorInitialSnapshot.value, form)) return true
  return new Promise((resolve) => {
    openConfirm({
      title: '离开当前设置页面？',
      description: '编辑器还有未保存的修改。离开后这些内容不会保留。',
      confirmText: '离开并放弃',
      cancelText: '留在当前页',
      danger: true,
      onConfirm: () => {
        resolve(true)
        return true
      },
      onCancel: () => resolve(false),
    })
  })
})

// 编辑组织时不能将自身或任一下级选作上级。后端仍会执行最终的防环校验，这里只负责
// 在选择阶段排除必然无效的选项，让调整层级时更直观。
const organizationParentOptions = computed(() => {
  const editingId = editor.value?.kind === 'organization' && editor.value?.mode === 'edit'
    ? String(editor.value.orgUnitId || '')
    : ''
  if (!editingId) return organizations.value
  const excludedIds = organizationDescendantIds(buildOrganizationTree(organizations.value), editingId)
  excludedIds.add(editingId)
  return organizations.value.filter((item) => !excludedIds.has(String(item.org_unit_id || item.id || '')))
})

// 后端要求岗位必须归属当前选择的组织。仅暴露该组织下的岗位，避免提交
// 三个 ID 都存在、但岗位和组织并不匹配的组合（该组合会被 API 拒绝）。
const membershipOrganizations = computed(() => membershipOrganizationOptions(organizations.value, positions.value))

const membershipPositions = computed(() => {
  const orgUnitId = form.org_unit_id
  if (!orgUnitId) return []
  return positions.value.filter((item) => positionOrgUnitId(item) === orgUnitId)
})

function selectDefaultMembershipOrganization() {
  if (editor.value?.kind !== 'membership' || form.org_unit_id) return
  form.org_unit_id = defaultMembershipOrganizationId(organizations.value, positions.value)
}

watch(() => form.org_unit_id, (orgUnitId) => {
  if (editor.value?.kind !== 'membership') return
  const selectedPositionExists = membershipPositions.value.some(
    (item) => (item.position_id || item.id) === form.position_id,
  )
  if (!orgUnitId || !selectedPositionExists) form.position_id = ''
})

const editorTemplates = {
  user: () => ({ display_name: '', email: '', mobile: '', status: 'ACTIVE', account_name: '', initial_password: '', validity_mode: 'TEMPORARY', valid_until: defaultAccountValidUntil() }),
  'user-batch': () => ({ rows: '', status: 'ACTIVE' }),
  account: () => ({ account_name: '', user_id: '', initial_password: '', validity_mode: 'TEMPORARY', valid_until: defaultAccountValidUntil() }),
  organization: () => ({ name: '', parent_id: '', sort_order: 0, status: 'ACTIVE' }),
  position: () => ({ org_unit_id: '', name: '' }),
  membership: () => ({ user_id: '', org_unit_id: '', position_id: '', membership_type: 'PRIMARY', validity_mode: 'LONG_TERM', effective_from: '', effective_to: '', inherit_authorization: true }),
}

const panelToKind = {
  users: 'user',
  accounts: 'account',
  organizations: 'organization',
  positions: 'position',
  memberships: 'membership',
}

// 各 panel 的“新增”所需权限。模板里直接调用，避免在多处分散布尔表达式。
function panelCreatePermission(panelKey) {
  if (panelKey === 'users') return IAM_PERMISSIONS.userCreate
  if (panelKey === 'accounts') return IAM_PERMISSIONS.accountCreate
  if (panelKey === 'organizations') return IAM_PERMISSIONS.organizationCreate
  if (panelKey === 'positions') return IAM_PERMISSIONS.positionCreate
  if (panelKey === 'memberships') return IAM_PERMISSIONS.membershipCreate
  return ''
}

const editorLabels = {
  user: '用户',
  'user-batch': '批量用户',
  account: '登录账号',
  organization: '组织单元',
  position: '岗位',
  membership: '任职关系',
}

function openEditor(kind) {
  if (!editorTemplates[kind]) {
    emitToast(`暂不支持新增 ${editorLabels[kind] || kind}。`)
    return
  }
  Object.keys(form).forEach((key) => delete form[key])
  editorSelectionNotice.value = ''
  Object.assign(form, editorTemplates[kind]())
  editor.value = { kind, label: editorLabels[kind] }
  markEditorClean()

  loadEditorReferences(kind)
}

// 关联编辑器打开时重新读取它依赖的目录。
//
// 旧实现按“数组为空才加载”复用内存目录：在别处新建的组织或岗位不会出现在下拉里，
// 用户只能整页刷新。这里改为每次打开都重新读取；读取有明确状态，失败时显示错误并
// 提供重试，而不是把失败伪装成“没有这个组织 / 岗位”。
const editorReferencesError = ref('')
// 关联编辑器（新增账号 / 新增任职）使用完整用户目录：面板列表是"当前页 + 当前筛选"，
// 直接复用会让管理员只能选到这一页的 50 人。这里逐页读取与面板筛选无关的完整目录。
const editorUsers = ref([])

function loadEditorReferences(kind) {
  editorReferencesError.value = ''
  const loads = []
  if (['account', 'membership', 'user'].includes(kind)) loads.push(loadEditorUserDirectory())
  if (kind === 'position' || kind === 'membership') loads.push(loadOrganizations())
  if (kind === 'membership') {
    loads.push(loadPositions())
    selectDefaultMembershipOrganization()
  }
  if (!loads.length) return
  // 面板读取用 safeCall 把失败写进 errorMessage 而不抛出；这里只汇报本次读取新增的失败，
  // 不会把其他面板的历史错误显示成编辑器错误。
  const previousError = errorMessage.value
  Promise.all(loads)
    .then(() => {
      if (errorMessage.value && errorMessage.value !== previousError) editorReferencesError.value = errorMessage.value
      dropInvalidEditorSelections()
      if (kind === 'membership') selectDefaultMembershipOrganization()
    })
    .catch((error) => {
      editorReferencesError.value = formatUserError(error, { fallback: '关联目录读取失败，请重试。' })
    })
}

// 目录重新读取后只清理确实失效的选择，并说明原因；其他已填写字段一律保留。
const editorSelectionNotice = ref('')

function dropInvalidEditorSelections() {
  const kind = editor.value?.kind
  if (kind === 'membership') {
    const organizationId = String(form.org_unit_id || '')
    if (organizationId && !organizations.value.some((item) => String(item.org_unit_id || item.id || '') === organizationId)) {
      form.org_unit_id = ''
      form.position_id = ''
      editorSelectionNotice.value = '原选组织已停用或不再对当前账号可见，已清除组织与岗位选择；其余已填写内容保持不变。'
      return
    }
    const selectedPositionId = String(form.position_id || '')
    if (selectedPositionId && !membershipPositions.value.some((item) => String(item.position_id || item.id || '') === selectedPositionId)) {
      form.position_id = ''
      editorSelectionNotice.value = '原选岗位已停用或不再属于所选组织，已清除岗位选择；其余已填写内容保持不变。'
    }
    return
  }
  if (kind === 'account') {
    const selectedUserId = String(form.user_id || '')
    if (selectedUserId && !users.value.some((item) => String(item.user_id || item.id || '') === selectedUserId)) {
      form.user_id = ''
      editorSelectionNotice.value = '原选关联用户已停用或不再可见，已清除关联用户；其余已填写内容保持不变。'
    }
  }
}

// 逐页读取完整用户目录供编辑器选择；失败时保留上一次可用值并报错，不伪装成空目录。
let editorUsersRequestSeq = 0

async function loadEditorUserDirectory() {
  const seq = ++editorUsersRequestSeq
  try {
    const items = await loadAllCatalogPages(
      listUsers,
      { pageSize: 100 },
      (item) => item?.user_id || item?.id,
    )
    if (seq !== editorUsersRequestSeq) return
    editorUsers.value = items
  } catch (error) {
    if (seq !== editorUsersRequestSeq) return
    throw error
  }
}

// 编辑器依赖目录的读取状态：用于展示“读取中 / 读取失败”，避免空下拉被误读为无数据。
const editorReferenceKeys = computed(() => {
  const kind = editor.value?.kind
  if (kind === 'membership') return ['users', 'organizations', 'positions']
  if (kind === 'account' || kind === 'user') return ['users']
  if (kind === 'position') return ['organizations']
  return []
})
const editorReferencesLoading = computed(() => editorReferenceKeys.value.some((key) => loading[key]))

function openEditorForActivePanel() {
  const kind = panelToKind[activePanel.value]
  if (kind) openEditor(kind)
}

function openEmployeeOnboarding() {
  // EmployeeOnboardingModal 由平台视图统一持有，IAM 只发出工作流意图，避免在此处
  // 再实现一套非原子的“先建用户、再补账号和任职”流程。
  emit('employee-onboarding')
}

// 批量导入在后端事务中同时创建用户和主任职关系，因此提交成功后刷新关联列表。
async function refreshAfterBatchImport() {
  // 人员与任职目录由 iam API 的失效通知统一触发重载；账号目录不在通知范围内，
  // 批量导入会生成账号，因此这里额外确认一次。
  await loadAccounts()
}

function closeEditorNow() {
  editor.value = null
  editorInitialSnapshot.value = ''
  saving.value = false
}

function closeEditor() {
  // 提交中的关闭按钮和遮罩点击都不能清掉正在执行的保存状态。
  if (saving.value) return
  if (editor.value && hasUnsavedChanges(editorInitialSnapshot.value, form)) {
    openConfirm({
      title: '放弃未保存的编辑？',
      description: '当前表单还有未保存的内容。放弃后这些修改不会保留，已填写的其他字段也会一起丢失。',
      confirmText: '放弃修改',
      cancelText: '继续编辑',
      danger: true,
      onConfirm: () => {
        closeEditorNow()
        return true
      },
    })
    return
  }
  closeEditorNow()
}

// 输入校验与规范化纯函数已提取到 utils/userInputValidation.js（行为契约由其单测固化）。

async function saveEditor() {
  if (!editor.value || saving.value) return
  const { kind } = editor.value
  saving.value = true
  try {
    let result
    let successMessage
    if (kind === 'user') {
      const userInput = validateUserInput({
        displayName: form.display_name,
        email: form.email,
        mobile: form.mobile,
        status: form.status,
      })
      const accountInput = validateLocalAccountInput(form.account_name, form.initial_password)
      const validUntil = form.validity_mode === 'PERMANENT' ? null : resolveExpiresAt(form.valid_until)
      if (form.validity_mode !== 'PERMANENT' && (!validUntil || new Date(validUntil).getTime() <= Date.now())) {
        throw new IamError('临时账号的有效截止时间必须晚于当前时间。')
      }
      result = await createUser(userInput)
      try {
        await createLocalAccount({
          userId: result?.user_id || result?.id,
          accountName: accountInput.accountName,
          initialPassword: accountInput.password,
          validUntil,
        })
      } catch (accountError) {
        await Promise.all([loadUsers(), loadAccounts()])
        const partialError = new IamError('用户已创建，但登录账号创建尚未确认完成。', {
          status: accountError?.status, code: accountError?.code, traceId: accountError?.traceId,
          details: accountError?.details, cause: accountError,
        })
        partialError.partialCompletion = { userCreated: true, accountCreated: false }
        partialError.context = accountError?.context
        partialError.requestID = accountError?.requestID || accountError?.requestId || ''
        partialError.request_method = accountError?.request_method
        throw partialError
      }
      successMessage = `用户 ${result?.display_name || form.display_name} 与登录账号 ${accountInput.accountName} 已创建。`
      await Promise.all([loadUsers(), loadAccounts()])
    } else if (kind === 'user-batch') {
      const items = parseBatchUserRows(form.rows, form.status)
      result = await createUsersBatch(items)
      const createdCount = Array.isArray(result?.items) ? result.items.length : items.length
      successMessage = `已批量创建 ${createdCount} 位用户，并自动生成员工编号、绑定普通用户角色。`
      await loadUsers()
    } else if (kind === 'account') {
      const accountInput = validateLocalAccountInput(form.account_name, form.initial_password)
      if (!form.user_id) throw new IamError('请选择关联用户；当前接口只创建个人本地账号。')
      const validUntil = form.validity_mode === 'PERMANENT' ? null : resolveExpiresAt(form.valid_until)
      if (form.validity_mode !== 'PERMANENT' && (!validUntil || new Date(validUntil).getTime() <= Date.now())) {
        throw new IamError('临时账号的有效截止时间必须晚于当前时间。')
      }
      result = await createLocalAccount({
        userId: form.user_id,
        accountName: accountInput.accountName,
        initialPassword: accountInput.password,
        validUntil,
      })
      successMessage = `账号 ${result?.account_name || form.account_name} 已写入 MySQL。`
      await loadAccounts()
    } else if (kind === 'organization') {
      if (!form.name) throw new IamError('请填写组织名称。')
      const payload = {
        parentId: form.parent_id || null,
        name: String(form.name).trim(),
        sortOrder: Number(form.sort_order) || 0,
      }
      if (editor.value.mode === 'edit') {
        result = await updateOrgUnit({ ...payload, orgUnitId: editor.value.orgUnitId, version: editor.value.version })
        successMessage = `组织 ${result?.name || form.name} 已更新。`
      } else {
        result = await createOrgUnit(payload)
        successMessage = `组织 ${result?.name || form.name} 已创建，编码 ${result?.code || '已由系统生成'}。`
      }
      // 组织写入会同时影响组织、岗位与任职目录；失效通知由 iam API 在写入确认后发布，
      // 本组件与兄弟组件通过统一订阅重新读取，不再只刷新自身列表。
    } else if (kind === 'position') {
      if (!form.org_unit_id || !form.name) throw new IamError('请选择组织并填写岗位名称。')
      result = await createPosition({
        orgUnitId: form.org_unit_id,
        name: String(form.name).trim(),
      })
      successMessage = `岗位 ${result?.name || form.name} 已创建，编码 ${result?.code || '已由系统生成'}。`
    } else if (kind === 'membership') {
      if (!form.user_id || !form.org_unit_id || !form.position_id) throw new IamError('请选择用户、组织和岗位。')
      const positionMatchesOrganization = membershipPositions.value.some(
        (item) => (item.position_id || item.id) === form.position_id,
      )
      if (!positionMatchesOrganization) throw new IamError('请选择当前组织下的岗位。')
      const shortTerm = form.validity_mode === 'SHORT_TERM'
      if (shortTerm && (!form.effective_from || !form.effective_to)) {
        throw new IamError('短期任职必须同时填写生效日期和失效日期。')
      }
      if (shortTerm && form.effective_from > form.effective_to) {
        throw new IamError('生效日期不能晚于失效日期。')
      }
      result = await createMembership({
        userId: form.user_id,
        orgUnitId: form.org_unit_id,
        positionId: form.position_id,
        membershipType: form.membership_type || 'PRIMARY',
        effectiveFrom: shortTerm ? form.effective_from : null,
        effectiveTo: shortTerm ? form.effective_to : null,
        inheritAuthorization: form.inherit_authorization !== false,
      })
      successMessage = `任职关系 ${result?.membership_id || ''} 已创建（${shortTerm ? '短期' : '长期'}生效）。`
    } else {
      throw new IamError('未实现的编辑类型。')
    }
    emitToast(successMessage)
    closeEditorNow()
  } catch (error) {
    if (kind === 'membership' && error instanceof IamError && error.status === 404) {
      emitToast('所选用户、组织或岗位已失效，或者岗位不属于所选组织。请刷新数据后重新选择。')
    } else if (error?.partialCompletion?.userCreated === true) {
      const reason = formatUserError(error.cause || error, { method: 'POST', fallback: '请核对现有用户及账号记录。' }).slice(0, 180)
      emitToast(`用户已创建，但登录账号创建尚未确认完成。${reason}请先在“登录账号”页面核对后补建，勿重复新增用户。`)
    } else {
      emitToast(formatUserError(error, { fallback: '保存失败。' }))
    }
  } finally {
    saving.value = false
  }
}

// 全局 ESC 关闭当前打开的模态框。Vue 的 @keydown.esc 只在元素有焦点时触发，
// 模态框通常没有焦点，所以挂到 document 上。
function onGlobalKeydown(event) {
  if (event?.key !== 'Escape') return
  // 优先级：临时密码 > 用户删除 > 通用 confirm > 重置密码 > 详情/编辑器
  if (temporaryPassword.value) {
    if (!temporaryPasswordVisible.value) closeTemporaryPassword()
  } else if (userDeletionDialog.value && !deletingUser.value) {
    closeUserDeletionDialog()
  } else if (confirmDialog.value) {
    closeConfirm()
  } else if (passwordResetDialog.value && !resettingPassword.value) {
    closePasswordResetDialog()
  } else if (detail.value) {
    requestCloseDetail()
  } else if (editor.value && !saving.value) {
    closeEditor()
  }
}

// 关联数据失效订阅：本组件与其他管理入口（人员异动中心、员工入职向导、应用接入）
// 写入组织 / 岗位 / 人员 / 任职后，立即重载对应面板，不再要求整页刷新。
// 面板读取保留原有权限判断和请求序号保护，无读取权限的账号不会因此产生越权请求。
useRelatedDataInvalidation((event) => {
  if (event.type === 'session') return
  const kinds = new Set(event.kinds)
  if (kinds.has(RELATED_DATA.ORGANIZATIONS)) {
    loadOrganizations()
    loadPositions()
    loadMemberships()
  } else if (kinds.has(RELATED_DATA.POSITIONS)) {
    loadPositions()
    loadMemberships()
  }
  if (kinds.has(RELATED_DATA.PEOPLE)) loadUsers()
  if (kinds.has(RELATED_DATA.MEMBERSHIPS)) loadMemberships()
}, {
  kinds: [
    RELATED_DATA.ORGANIZATIONS,
    RELATED_DATA.POSITIONS,
    RELATED_DATA.PEOPLE,
    RELATED_DATA.MEMBERSHIPS,
  ],
})

onMounted(async () => {
  if (typeof window !== 'undefined') {
    window.addEventListener('keydown', onGlobalKeydown)
  }
  // 先获取 permission_codes，再只加载当前账号具有对应 read 权限的目录，
  // 避免角色绑定管理员因为缺少 user:read 等无关权限产生一组 403。
  await refreshPrincipal().catch(() => null)
  await reloadVisiblePanels()
})
onBeforeUnmount(() => {
  if (typeof window !== 'undefined') {
    window.removeEventListener('keydown', onGlobalKeydown)
  }
})
</script>

<template>
  <section class="iam-settings" aria-label="身份、组织与授权设置">
    <section class="iam-management-guide" aria-labelledby="iam-management-guide-title">
      <div class="iam-management-guide-copy">
        <span class="iam-section-kicker"><span></span>推荐管理流程</span>
        <h3 id="iam-management-guide-title">按归属、职责和例外分层管理</h3>
        <p>组织只维护归属，岗位定义职责，岗位授权模板是标准应用角色的唯一日常配置入口。新增员工统一创建用户、登录账号和任职；只有个人确有特殊需要时，才在用户详情中追加例外角色。</p>
      </div>
      <ol class="iam-management-flow" aria-label="推荐管理步骤">
        <li><strong>组织归属</strong><span>维护部门和层级</span></li>
        <li><strong>岗位职责</strong><span>定义岗位及所属组织</span></li>
        <li><strong>岗位模板</strong><span>配置标准应用角色</span></li>
        <li><strong>新增员工</strong><span>原子创建用户、账号、任职</span></li>
        <li><strong>个人例外</strong><span>仅在用户详情补充</span></li>
      </ol>
    </section>

    <div class="iam-summary-grid">
      <article v-for="metric in metrics" :key="metric.label" class="iam-summary-card" :class="metric.tone">
        <span class="iam-summary-icon"><ConsoleIcon :name="metric.icon" /></span>
        <div><small>{{ metric.label }}</small><strong>{{ metric.value }}</strong><p>{{ metric.note }}</p></div>
      </article>
    </div>

    <p v-if="errorMessage" class="login-target-module__error" role="alert">{{ errorMessage }}</p>
    <p v-if="!canReadActivePanel" class="iam-field-help" role="status">当前账号可以进入此面板，但没有对应的读取权限；列表与刷新已禁用，管理按钮仍按各自 create/update/delete 权限显示。</p>

    <div class="iam-workspace">
      <aside class="iam-panel-nav" aria-label="身份与授权功能导航">
        <div
          v-for="group in visiblePanelGroups"
          :key="group.key"
          class="iam-panel-group"
        >
          <div class="iam-panel-group-title" :aria-label="group.label">
            <span
              class="iam-panel-group-dot"
              :class="`is-${groupCompletion[group.key]}`"
              :title="groupCompletion[group.key] === 'complete' ? '本阶段数据齐全' : groupCompletion[group.key] === 'partial' ? '本阶段部分数据缺失' : groupCompletion[group.key] === 'loading' ? '正在加载' : '尚未开始'"
            ></span>
            <span class="iam-panel-group-name">{{ group.label }}</span>
            <span v-if="groupCountLabel[group.key]" class="iam-panel-group-count">{{ groupCountLabel[group.key] }}</span>
          </div>
          <button
            v-for="item in group.panels"
            :key="item.key"
            type="button"
            :class="{ active: activePanel === item.key }"
            @click="selectPanel(item.key)"
          >
            <ConsoleIcon :name="item.icon" />
            <span>{{ item.label }}</span>
          </button>
        </div>
      </aside>

      <section class="iam-panel-content">
        <header class="iam-panel-head">
          <div><h3>{{ panel.label }}</h3><p>{{ panel.description }}</p></div>
          <div class="iam-panel-actions">
            <button class="console-button ghost small" type="button" @click="resetFilters"><ConsoleIcon name="reset" />清空筛选</button>
            <button class="console-button ghost small" type="button" :disabled="activeLoading || !canReadActivePanel" @click="reloadActive"><ConsoleIcon name="refresh" />刷新</button>
            <button v-if="canReadActivePanel && ['users', 'accounts', 'organizations', 'positions', 'memberships'].includes(activePanel)" class="console-button ghost small" type="button" :disabled="!activePanelItemsCount" @click="exportActivePanelCsv" title="导出当前筛选结果为 CSV"><ConsoleIcon name="download" />导出 CSV</button>
            <template v-if="activePanel === 'users' && hasPermission(IAM_PERMISSIONS.userCreate)">
              <button class="console-button ghost small" type="button" @click="batchImportVisible = true"><ConsoleIcon name="download" />批量导入用户</button>
              <button class="console-button primary small" type="button" @click="openEmployeeOnboarding"><ConsoleIcon name="user" />新增员工</button>
            </template>
            <button v-else-if="panelToKind[activePanel] && hasPermission(panelCreatePermission(activePanel))" class="console-button primary small" type="button" :disabled="!panelToKind[activePanel]" @click="openEditorForActivePanel"><ConsoleIcon name="plus" />{{ activePanel === 'accounts' ? '补建登录账号' : `新增${editorLabels[panelToKind[activePanel]] || ''}` }}</button>
          </div>
        </header>

        <p v-if="activePanel === 'users'" class="iam-panel-policy-note"><ConsoleIcon name="info" /><span><strong>用户与人员一一对应：</strong>“新增员工”必须同时建立任职关系；用户列表只展示已具备任职关系的人员。登录账号仍可单独补建。</span></p>
        <p v-else-if="activePanel === 'accounts'" class="iam-panel-policy-note"><ConsoleIcon name="info" /><span><strong>账号只负责认证：</strong>不提供账号级角色授权入口；此处维护账号状态与有效期，密码初始化或重置请进入关联用户的“用户详情”办理。</span></p>
        <p v-else-if="activePanel === 'organizations'" class="iam-panel-policy-note"><ConsoleIcon name="info" /><span><strong>组织只表达人员归属：</strong>应用角色请配置到岗位授权模板。组织详情仅展示并允许清理历史直绑，不允许新增或修改。</span></p>
        <p v-else-if="activePanel === 'positions'" class="iam-panel-policy-note"><ConsoleIcon name="info" /><span><strong>岗位表达职责：</strong>岗位与应用角色的标准映射统一在“岗位授权模板”维护。岗位详情仅用于清理历史直绑。</span></p>
        <p v-else-if="activePanel === 'memberships'" class="iam-panel-policy-note"><ConsoleIcon name="info" /><span><strong>任职连接人员与职责：</strong>开启“参与岗位授权继承”后，用户会动态获得该岗位授权模板中的标准角色。</span></p>

        <section v-if="activePanel === 'users' && canReadActivePanel" class="iam-table-section">
          <div class="iam-filter-row iam-user-filter-row"><label class="console-search-field"><ConsoleIcon name="search" /><input v-model="panelFilters.users" type="search" placeholder="姓名 / 工号 / 邮箱 / 状态"  maxlength="100"/></label><div class="iam-user-list-controls"><label>每页<select v-model.number="userPageSize" aria-label="用户列表每页条数" @change="changeUserPageSize"><option :value="20">20</option><option :value="50">50</option><option :value="100">100</option></select> 条</label><span>本页 {{ filteredUsers.length }} 位 / 共 {{ pagination.users.total }} 位</span></div></div>
          <div class="console-table-card iam-user-table-card"><div class="console-table-scroll"><table class="console-data-table iam-data-table iam-user-table">
            <thead><tr><th>用户</th><th>工号</th><th>邮箱</th><th>手机号</th><th>状态</th><th>更新时间</th><th class="console-actions-cell">操作</th></tr></thead><tbody>
            <tr v-if="loading.users"><td class="console-empty" colspan="7">正在读取用户…</td></tr>
            <tr v-else-if="!filteredUsers.length"><td class="console-empty" colspan="7">暂无用户记录。</td></tr>
            <tr v-for="item in filteredUsers" :key="item.user_id"><td data-label="用户"><strong class="console-entity-name iam-table-truncate" :title="item.display_name || ''">{{ item.display_name }}</strong><small>{{ item.valid_until ? `有效至 ${formatDateTime(item.valid_until)}` : '长期有效' }}</small></td><td data-label="工号" class="console-mono iam-user-employee-cell"><span class="iam-table-truncate" :title="item.employee_no || ''">{{ item.employee_no || '—' }}</span></td><td data-label="邮箱" class="iam-user-email-cell"><span class="iam-table-truncate" :title="item.email || ''">{{ item.email || '—' }}</span></td><td data-label="手机号" class="console-mono iam-user-mobile-cell"><span class="iam-table-truncate" :title="item.mobile_masked || ''">{{ item.mobile_masked || '—' }}</span></td><td data-label="状态"><span class="console-badge" :class="(item.status || '').toUpperCase() === 'ACTIVE' && (!item.valid_until || new Date(item.valid_until).getTime() > Date.now()) ? 'status-active' : 'status-disabled'">{{ item.valid_until && new Date(item.valid_until).getTime() <= Date.now() ? '已过期' : displayStatus(item.status) }}</span></td><td data-label="更新时间" class="console-mono iam-user-updated-cell"><span class="iam-table-truncate" :title="formatDateTime(item.updated_at)">{{ formatDateTime(item.updated_at) }}</span></td><td data-label="操作" class="console-actions-cell"><button class="console-text-button" type="button" @click="openDetail('user', item)">详情</button><button v-if="hasPermission(IAM_PERMISSIONS.userUpdate)" class="console-text-button" type="button" @click="openValidityEditor('user', item)">有效期</button><button v-if="hasPermission(IAM_PERMISSIONS.userDelete)" class="console-text-button danger" type="button" @click="openUserDeletionDialog(item)">删除</button></td></tr>
          </tbody></table></div></div>
        </section>

        <section v-else-if="activePanel === 'accounts' && canReadActivePanel" class="iam-table-section iam-accounts-panel">
          <div class="iam-filter-row iam-account-filter-row"><label class="console-search-field"><ConsoleIcon name="search" /><input v-model="panelFilters.accounts" type="search" placeholder="搜索账号、用户 ID 或状态"  maxlength="100"/></label><span>{{ filteredAccounts.length }} / 共 {{ pagination.accounts.total }} 个账号</span></div>
          <div class="console-table-card iam-account-table-card"><div class="console-table-scroll"><table class="console-data-table iam-data-table iam-account-table">
            <thead><tr><th>登录账号</th><th>关联用户</th><th>认证方式</th><th>有效时间</th><th>状态</th><th>更新时间</th><th class="console-actions-cell">操作</th></tr></thead><tbody>
            <tr v-if="loading.accounts"><td class="console-empty" data-empty="true" colspan="7">正在读取登录账号…</td></tr>
            <tr v-else-if="!filteredAccounts.length"><td class="console-empty" colspan="7">暂无登录账号记录。新增员工请使用统一流程；如用户档案已存在，可点击右上角“补建登录账号”。</td></tr>
            <tr v-for="item in filteredAccounts" :key="item.account_id"><td data-label="登录账号"><div class="iam-account-identity"><span class="iam-account-avatar">{{ (item.account_name || '?').slice(0, 1).toUpperCase() }}</span><span><strong :title="item.account_name || ''">{{ item.account_name }}</strong></span></div></td><td data-label="关联用户"><span class="iam-linked-user" :title="`${item.user?.display_name || item.user?.name || '—'}${item.user_id ? `（${item.user_id}）` : ''}`"><ConsoleIcon name="user" /><span class="iam-linked-user-name">{{ item.user?.display_name || item.user?.name || '—' }}</span></span></td><td data-label="认证方式"><div class="iam-auth-tags"><span class="iam-type-tag">{{ displayLoginAccountType(item).split(' / ')[0] }}</span><span class="iam-source-tag">{{ displayLoginAccountType(item).split(' / ')[1] }}</span><span v-if="item.password_initialized === false" class="iam-source-tag">待初始化密码</span></div></td><td data-label="有效时间"><div class="iam-validity"><span class="iam-validity-chip" :class="item.valid_until ? 'is-temporary' : 'is-permanent'">{{ item.valid_until ? '临时账号' : '永久账号' }}</span><small>{{ item.valid_until ? formatDateTime(item.valid_until) : '长期有效' }}</small></div></td><td data-label="状态"><span class="console-badge" :class="effectiveAccountStatus(item) === 'ACTIVE' ? 'status-active' : 'status-disabled'">{{ displayStatus(effectiveAccountStatus(item)) }}</span></td><td data-label="更新时间" class="console-mono iam-account-updated">{{ formatDateTime(item.updated_at) }}</td><td data-label="操作" class="console-actions-cell iam-account-actions"><button class="console-text-button" type="button" @click="openDetail('account', item)">详情</button><button v-if="hasPermission(IAM_PERMISSIONS.accountUpdate)" class="console-text-button" type="button" @click="openValidityEditor('account', item)">有效期</button><button v-if="isAccountStatusManageable(effectiveAccountStatus(item)) && hasPermission(IAM_PERMISSIONS.accountUpdate)" class="console-text-button" :class="{ danger: effectiveAccountStatus(item) === 'ACTIVE' }" type="button" :disabled="updatingAccountId === item.account_id" @click="toggleAccountStatus(item)">{{ updatingAccountId === item.account_id ? '处理中…' : (effectiveAccountStatus(item) === 'ACTIVE' ? '停用' : '启用') }}</button></td></tr>
          </tbody></table></div></div>
        </section>

        <OrganizationDirectoryPanel
          v-else-if="activePanel === 'organizations' && canReadActivePanel"
          :organizations="organizations"
          :filtered-organizations="filteredOrganizations"
          :panel-filters="panelFilters"
          :pagination="pagination"
          :loading="loading"
          :deleting-organization-id="deletingOrganizationId"
          :can-create="hasPermission(IAM_PERMISSIONS.organizationCreate)"
          :can-update="hasPermission(IAM_PERMISSIONS.organizationUpdate)"
          :can-delete="hasPermission(IAM_PERMISSIONS.organizationDelete)"
          @copy-id="(item) => copyText(item.org_unit_id || item.id, { success: '组织 ID 已复制' })"
          @create-child="openChildOrganizationEditor"
          @detail="(item) => openDetail('organization', item)"
          @edit="openOrganizationEditor"
          @remove="removeOrganization"
        />
        <section v-else-if="activePanel === 'positions' && canReadActivePanel" class="iam-table-section iam-positions-panel">
          <div class="iam-filter-row"><label class="console-search-field"><ConsoleIcon name="search" /><input v-model="panelFilters.positions" type="search" placeholder="搜索岗位名称、编码或所属组织"  maxlength="100"/></label><span>{{ filteredPositions.length }} / 共 {{ pagination.positions.total }} 个岗位</span></div>
          <p v-if="pagination.positions.serverPagingSupported === false" class="iam-server-limit-note">未能读取全部岗位数据，当前分组可能不完整。请检查岗位列表接口是否能继续翻页。</p>
          <PositionGroups
            :positions="positions"
            :organizations="organizations"
            :keyword="panelFilters.positions"
            :loading="loading.positions"
            :can-create="hasPermission(IAM_PERMISSIONS.positionCreate)"
            :can-delete="hasPermission(IAM_PERMISSIONS.positionDelete)"
            :deleting-id="deletingPositionId"
            @create="openPositionEditorForOrganization"
            @detail="(item) => openDetail('position', item)"
            @remove="removePosition"
          />
        </section>

        <PositionAuthorizationTemplates v-else-if="activePanel === 'positionAuthorizationTemplates' && canReadActivePanel" ref="positionAuthorizationTemplates" @toast="emitToast" />

        <section v-else-if="activePanel === 'memberships' && canReadActivePanel" class="iam-table-section iam-memberships-panel">
          <div class="iam-filter-row"><label class="console-search-field"><ConsoleIcon name="search" /><input v-model="panelFilters.memberships" type="search" placeholder="搜索用户、组织或岗位"  maxlength="100"/></label><span>{{ filteredMemberships.length }} / 共 {{ pagination.memberships.total }} 条任职关系</span></div>
          <p v-if="pagination.memberships.serverPagingSupported === false" class="iam-server-limit-note">未能读取全部任职关系，当前组织分组可能不完整。请检查任职列表接口是否能继续翻页。</p>
          <MembershipGroups
            :memberships="memberships"
            :organizations="organizations"
            :keyword="panelFilters.memberships"
            :loading="loading.memberships"
            @detail="(item) => openDetail('membership', item)"
          />
        </section>

        <nav v-if="activePagination && activePagination.total > activePagination.pageSize && !activeServerPagingUnavailable" class="iam-pagination" aria-label="列表分页">
          <button class="console-button ghost small" type="button" :disabled="activePagination.page <= 1" @click="goToPage(activePanel, activePagination.page - 1)">上一页</button>
          <span>第 {{ activePagination.page }} / {{ pageTotal(activePanel) }} 页，共 {{ activePagination.total }} 条</span>
          <button class="console-button ghost small" type="button" :disabled="activePagination.page >= pageTotal(activePanel)" @click="goToPage(activePanel, activePagination.page + 1)">下一页</button>
        </nav>
      </section>
    </div>

    <div v-if="detail" class="iam-modal-backdrop" role="presentation" @click.self="closeDetail">
      <section class="iam-modal" :class="{ 'iam-user-detail-modal': isUserAuthorizationSubject }" role="dialog" aria-modal="true" aria-label="身份授权详情">
        <header><div><p>详情</p><h3>{{ detailTitle(detail) }}</h3></div><button class="console-modal-close" type="button" aria-label="关闭详情" @click="closeDetail"><ConsoleIcon name="close" /></button></header>
        <div v-if="isUserAuthorizationSubject" class="iam-user-detail-hero">
          <span class="iam-user-detail-avatar">{{ String(detail.item?.display_name || detail.item?.name || '?').trim().slice(0, 1) }}</span>
          <div class="iam-user-detail-identity">
            <div class="iam-user-detail-name-row"><h4>{{ detail.item?.display_name || detail.item?.name || '未命名用户' }}</h4><span class="console-badge" :class="String(detail.item?.status || '').toUpperCase() === 'ACTIVE' ? 'status-active' : 'status-disabled'">{{ displayStatus(detail.item?.status) }}</span></div>
            <p><span>{{ detail.item?.employee_no || '未生成员工编号' }}</span><i /> <span>{{ detail.item?.email || '未填写邮箱' }}</span></p>
          </div>
          <div class="iam-user-detail-hero-note"><ConsoleIcon name="link" /><span>人员主档案<br /><small>任职关系统一维护</small></span></div>
          <button v-if="hasPermission(IAM_PERMISSIONS.userUpdate) && String(detail.item?.status || '').toUpperCase() === 'ACTIVE'" class="console-button danger small" type="button" @click="terminateEmployee(detail.item)">办理离职</button>
        </div>
        <div class="iam-detail-grid">
          <template v-for="row in primaryDetailRows(detail)" :key="row.label">
            <div><span>{{ row.label }}</span><strong>{{ row.value }}</strong></div>
          </template>
        </div>
        <details v-if="technicalDetailRows(detail).length" class="iam-detail-technical">
          <summary>技术信息（ID、版本与关联引用）</summary>
          <div class="iam-detail-grid">
            <template v-for="row in technicalDetailRows(detail)" :key="row.label">
              <div><span>{{ row.label }}</span><strong class="iam-technical-value">{{ row.value }}</strong></div>
            </template>
          </div>
        </details>
        <section v-if="detail.kind === 'membership'" class="iam-detail-section">
          <div class="iam-detail-section-head"><div><h4>岗位授权继承</h4><p>开启后，此任职参与岗位模板角色的授权计算；关闭后，此任职不再提供继承授权。个人单独授权按原规则保留。</p></div></div>
          <label class="iam-checkbox-field"><input v-model="membershipInheritanceDraft" type="checkbox" :disabled="!hasPermission(IAM_PERMISSIONS.membershipUpdate) || membershipInheritanceSaving || membershipInheritanceConflict" /><span>参与岗位授权继承</span></label>
          <p class="iam-field-help">实际生效范围受岗位模板、任职及各层有效期限制；开启时由服务端检查可委派权限。</p>
          <p v-if="!hasPermission(IAM_PERMISSIONS.membershipUpdate)" class="iam-field-help">当前账号没有修改任职关系的权限。</p>
          <p v-if="membershipInheritanceError" role="alert">{{ membershipInheritanceError }}</p>
          <button v-if="hasPermission(IAM_PERMISSIONS.membershipUpdate)" class="console-button primary small" type="button" :disabled="membershipInheritanceSaving || membershipInheritanceConflict || membershipInheritanceDraft === (detail.item.inherit_authorization !== false)" @click="saveMembershipInheritance">{{ membershipInheritanceSaving ? '保存中…' : '保存继承设置' }}</button>
          <button v-if="membershipInheritanceConflict" class="console-button small" type="button" @click="closeDetail(); loadMemberships()">重新读取列表</button>
        </section>
        <section v-if="isUserAuthorizationSubject" class="iam-detail-section iam-user-account-section">
          <div class="iam-detail-section-head"><div><h4>登录账号与口令</h4><p>用户名用于登录基础平台；密码初始化与重置统一在用户详情中办理。</p></div></div>
          <p v-if="authorizationOverviewLoading" class="iam-empty-inline">正在读取登录账号…</p>
          <p v-else-if="authorizationOverviewUnavailable" class="iam-empty-inline">登录账号暂不可用，请稍后重试。</p>
          <p v-else-if="!authorizationOverview?.accounts.length" class="iam-empty-inline">该用户尚未关联登录账号，请先在“登录账号”页面补建账号。</p>
          <div v-else class="iam-user-account-list">
            <article v-for="account in authorizationOverview.accounts" :key="account.account_id" class="iam-user-account-card">
              <div class="iam-user-account-name"><span>用户名</span><strong>{{ account.account_name || '—' }}</strong><small class="console-mono">账号 ID：{{ account.account_id || '—' }}</small></div>
              <div class="iam-user-account-meta"><span class="console-badge" :class="effectiveAccountStatus(account) === 'ACTIVE' ? 'status-active' : 'status-disabled'">{{ displayStatus(effectiveAccountStatus(account)) }}</span><small>{{ displayLoginAccountType(account) }} · {{ account.valid_until ? `有效至 ${formatDateTime(account.valid_until)}` : '长期有效' }}</small></div>
              <button v-if="hasPermission(IAM_PERMISSIONS.accountPasswordReset)" class="console-button danger small" type="button" @click="openPasswordResetFromUserDetail(account)">{{ account.password_initialized === false ? '初始化密码' : '重置密码' }}</button>
            </article>
          </div>
          <p v-if="authorizationOverview?.accounts.length && !hasPermission(IAM_PERMISSIONS.accountPasswordReset)" class="iam-field-help" role="status">当前账号只有查看权限，缺少“重置账号密码”权限。</p>
        </section>
        <section v-if="isUserAuthorizationSubject" class="iam-detail-section iam-person-authorization-summary">
          <div class="iam-detail-section-head"><div><h4>人员状态与交接摘要</h4><p>账号、任职、待处理异动、业务交接和 Keycloak 同步状态均来自基础平台只读汇总接口。</p></div></div>
          <p v-if="authorizationOverviewLoading" class="iam-empty-inline">正在读取人员状态摘要…</p>
          <p v-else-if="authorizationOverviewUnavailable" class="iam-empty-inline">人员状态摘要暂不可用，不影响下方授权维护，请稍后重试。</p>
          <div v-else-if="authorizationOverview" class="iam-person-summary-grid">
            <div><span>登录账号</span><strong>{{ authorizationOverview.accounts.length }} 个</strong><small>{{ authorizationOverview.accounts.filter((item) => String(item.status || '').toUpperCase() === 'ACTIVE').length }} 个启用</small></div>
            <div><span>有效任职</span><strong>{{ authorizationOverview.memberships.filter((item) => String(item.status || '').toUpperCase() === 'ACTIVE').length }} 个</strong><small>历史任职 {{ authorizationOverview.memberships.length }} 个</small></div>
            <div><span>待处理异动</span><strong>{{ authorizationOverview.pending_changes.length }} 单</strong><small>{{ authorizationOverview.pending_changes[0]?.status || '无待处理异动' }}</small></div>
            <div><span>交接责任</span><strong>{{ authorizationOverview.handover.length }} 项</strong><small>{{ authorizationOverview.handover.length ? '需完成后方可离职' : '无未完成交接' }}</small></div>
            <div><span>Keycloak 映射</span><strong>{{ keycloakMappingState }}</strong><small>Subject：{{ keycloakExternalSubject }}</small></div>
          </div>
        </section>
        <section v-if="isUserAuthorizationSubject && canReadApplicationAuthorization" class="iam-detail-section iam-effective-authorization-overview">
          <div class="iam-detail-section-head">
            <div>
              <h4>有效授权总览</h4>
              <p>查看各应用当前授权及其来源。</p>
            </div>
            <button type="button" class="console-button ghost small" :disabled="userAuthorizationPreviewLoading" @click="refreshUserAuthorizationPreview">刷新全部</button>
          </div>
          <EffectiveAuthorizationOverview
            :key="authorizationSubjectId"
            :applications="userAuthorizationPreview?.applications || []"
            :loading="userAuthorizationPreviewLoading"
            :unavailable="userAuthorizationPreviewUnavailable"
            :error-count="userAuthorizationPreviewErrorCount"
            :can-manage="canManageApplicationAuthorization"
            @retry="retryUserAuthorizationPreview"
            @manage="manageUserApplicationAccess"
          />
        </section>

        <section v-if="supportsApplicationAuthorization" class="iam-detail-section iam-application-access">
          <div class="iam-detail-section-head">
            <div>
              <h4>{{ isLegacyStructuralAuthorizationSubject ? `${authorizationSubjectLabel}历史直绑（只读清理）` : authorizationEntryLayerInfo.title }}</h4>
              <p v-if="isLegacyStructuralAuthorizationSubject">组织和岗位不再提供应用角色新增或修改入口。此处只读展示历史直绑；如仍有历史角色，可逐应用撤销清理。标准授权请转到“岗位授权模板”。</p>
              <p v-else>此处只处理标准岗位授权之外的个人补充角色。应用角色目录、默认权限和角色权限关系均由子系统维护并只读同步到基础平台。</p>
            </div>
            <div class="iam-application-access-badges">
              <button v-if="isUserAuthorizationSubject" type="button" class="console-button ghost" :aria-expanded="applicationAccessExpanded" @click="toggleApplicationAccessExpanded">{{ applicationAccessExpanded ? '收起管理' : '展开管理' }}</button>
              <template v-if="!isUserAuthorizationSubject || applicationAccessExpanded">
                <span v-if="selectedApplication" class="iam-application-badge">{{ applicationDisplayName(selectedApplication) }} · {{ selectedApplication.code }}</span>
                <span v-if="authorizationCatalog" class="iam-application-badge">目录版本 {{ catalogVersion(authorizationCatalog) }}</span>
                <span v-if="authorizationCatalog" class="iam-application-badge" :class="{ 'is-warning': ['已过期', '同步失败', '状态未知'].includes(catalogSyncText) }">同步状态 {{ catalogSyncText }}</span>
                <span v-if="hasApplicationAuthorizationConflict" class="iam-application-badge is-conflict">授权冲突 · {{ applicationAuthorizationConflicts.length }} 个不同角色</span>
                <span v-else-if="hasEffectiveApplicationAccess" class="iam-application-badge">有效访问 · {{ applicationEffectiveRoles.length }} 个角色来源</span>
                <span v-if="isUserAuthorizationSubject && personalExceptionDirty" class="iam-application-badge is-warning">有未保存修改</span>
              </template>
            </div>
          </div>
          <template v-if="isUserAuthorizationSubject">
            <PersonalExceptionAuthorization
              v-show="applicationAccessExpanded"
              :application="selectedApplication"
              :applications="applications"
              :selected-application-code="selectedApplicationCode"
              :access="applicationAccess"
              :catalog="authorizationCatalog"
              :environments="authorizationEnvironmentOptions"
              :load-state="{ loading: applicationsLoading || applicationAccessLoading, catalogLoading: authorizationCatalogLoading, environmentsLoading: applicationEnvironmentsLoading, error: applicationAccessError }"
              :can-manage="canManageApplicationAuthorization"
              :busy="applicationAccessSaving || applicationAccessRevoking"
              :error="applicationAccessError"
              @create="applicationAccessExpanded = true"
              @edit="applicationAccessExpanded = true"
              @select-application="onPersonalExceptionApplicationChange"
              @submit="savePersonalException"
              @revoke-role="revokePersonalExceptionRole"
              @revoke-all="revokeAllPersonalExceptions"
              @retry="loadApplicationAuthorization(selectedApplicationCode)"
              @dirty-change="onPersonalExceptionDirtyChange"
            />
            <p v-if="!applicationAccessExpanded" class="iam-field-help">
              个人例外授权默认收起；{{ personalExceptionDirty ? '当前有未保存修改，展开后继续编辑。' : '展开后可查看和调整个人补充角色。' }}
              组织或岗位继承的标准授权仍由岗位授权模板维护。
            </p>
          </template>
          <template v-else>
          <p v-if="applicationsLoading" class="iam-empty-inline">正在读取应用列表…</p>
          <template v-else-if="!applications.length">
            <p class="iam-empty-inline">当前没有可授权的应用。</p>
          </template>
          <template v-else>
            <p v-if="applicationAccessError" class="login-target-module__error" role="alert">{{ applicationAccessError }}</p>
            <div v-if="hasApplicationAuthorizationConflict" class="login-target-module__error" role="alert">
              当前有效角色组合不符合该应用的角色数量策略（{{ applicationAuthorizationConflicts.join('、') || '角色来源冲突' }}）。系统已拒绝门户入口、OIDC 授权和权限并集；请清理重复或多余的个人例外、组织历史直绑或岗位模板来源，直至符合应用策略。
            </div>
            <div class="iam-application-access-form">
              <div v-if="isLegacyStructuralAuthorizationSubject" class="iam-legacy-binding-notice" role="note">
                <ConsoleIcon name="shield" />
                <div><strong>该入口已进入只读清理模式</strong><p>不能新增、勾选、改范围或改有效期。请先在岗位授权模板建立标准映射，再撤销这里遗留的直绑角色；服务端拒绝仍作为最终安全边界。</p></div>
              </div>
              <AuthorizationEntryGuidance
                v-if="isUserAuthorizationSubject"
                :subject-type="authorizationSubjectType"
                :selected-role-codes="authorizationDraft.role_codes"
                :inherited-roles="applicationInheritedRoles"
                :role-name="applicationRoleName"
              />
              <label><span>应用 *</span><select :value="selectedApplicationCode" :disabled="applicationAccessLoading || applicationAccessSaving || applicationAccessRevoking" @change="onApplicationSelectionChange($event)"><option v-for="application in applications" :key="application.application_id || application.id || application.code" :value="application.code">{{ applicationDisplayName(application) }} · {{ application.code }}</option></select></label>
              <div class="iam-application-meta"><span>授权主体：<strong>{{ authorizationSubjectLabel }}</strong></span><span>应用编码：<code>{{ selectedApplication?.code || '—' }}</code></span><span>目录版本：<strong>{{ catalogVersion(authorizationCatalog) }}</strong></span><span>目录同步：<strong>{{ catalogSyncText }}</strong></span><span>{{ isLegacyStructuralAuthorizationSubject ? '目录角色' : '可分配角色' }}：<strong>{{ authorizationRoleOptions.length }} / {{ catalogRoleTotal }}</strong></span><span v-if="authorizationMaxEffectiveRoles">最大有效角色：<strong>{{ authorizationMaxEffectiveRoles }}</strong></span><span v-if="catalogLastSyncedAt">最近同步：<strong>{{ formatDateTime(catalogLastSyncedAt) }}</strong></span></div>
              <p v-if="authorizationCatalog && !hasSynchronizedAuthorizationCatalog" class="iam-empty-inline">角色目录当前为“{{ catalogSyncText }}”，为避免使用过期或不完整的应用角色，暂不允许新增或修改授权；请等待子系统重新同步目录。</p>
              <div v-if="isUserAuthorizationSubject" class="iam-application-scope-grid">
                <label><span>例外授权范围 *</span><select v-model="authorizationDraft.scope_type" :disabled="applicationAccessLoading || applicationAccessSaving || applicationAccessRevoking" @change="onAuthorizationScopeChange"><option value="APPLICATION">整个应用</option><option value="ENVIRONMENT" :disabled="!authorizationEnvironmentOptions.length">指定环境</option></select></label>
                <label v-if="authorizationDraft.scope_type === 'ENVIRONMENT'"><span>环境 *</span><select v-model="authorizationDraft.environment_code" :disabled="applicationEnvironmentsLoading || applicationAccessSaving || applicationAccessRevoking"><option value="">请选择环境</option><option v-for="environment in authorizationEnvironmentOptions" :key="environment.code" :value="environment.code">{{ environment.name }} · {{ environment.code }}</option></select><small v-if="applicationEnvironmentsLoading">正在读取环境…</small></label>
                <label><span>例外授权有效期 *</span><select v-model="authorizationDraft.validity_mode" :disabled="applicationAccessSaving || applicationAccessRevoking" @change="onAuthorizationValidityChange"><option value="PERMANENT">长期有效</option><option value="RANGE">指定有效期</option></select></label>
              </div>
              <div v-if="isUserAuthorizationSubject && authorizationDraft.validity_mode === 'RANGE'" class="iam-application-validity-grid"><label><span>生效时间</span><input v-model="authorizationDraft.valid_from" type="datetime-local" :disabled="applicationAccessSaving || applicationAccessRevoking" /></label><label><span>失效时间</span><input v-model="authorizationDraft.valid_until" type="datetime-local" :disabled="applicationAccessSaving || applicationAccessRevoking" /></label></div>
              <label v-if="isUserAuthorizationSubject" class="iam-checkbox-field"><input v-model="authorizationDraft.apply_to_existing" type="checkbox" :disabled="applicationAccessSaving || applicationAccessRevoking" /><span>将当前范围/有效期统一应用到已有角色</span></label>
              <p v-if="isUserAuthorizationSubject" class="iam-field-help">默认保留已勾选角色的原范围和有效期（含未来生效授权）；当前表单设置仅用于新增角色。取消某个角色会撤销该角色的全部人工条目。</p>
              <p v-if="isUserAuthorizationSubject && authorizationHasMixedRoleSettings && !authorizationDraft.apply_to_existing" class="iam-field-help iam-application-scope-warning">当前角色具有不同范围或有效期，保存时将逐条保留。</p>
              <div v-if="isUserAuthorizationSubject && applicationManualRoles.length" class="iam-application-permission-block">
                <div class="iam-application-permission-head"><strong>现有人工分配（含未来生效）</strong><span>{{ applicationManualRoles.length }} 条</span></div>
                <div class="iam-application-role-list"><div v-for="(role, index) in applicationManualRoles" :key="`${roleCode(role)}-manual-${index}`" class="iam-application-role-option"><span class="iam-application-role-copy"><strong>{{ applicationRoleName(role) }}</strong><small>范围：{{ authorizationScopeText(role) }}</small><small>有效期：{{ authorizationValidityText(role) }}</small></span></div></div>
              </div>
              <p v-if="authorizationCatalogLoading || applicationAccessLoading" class="iam-empty-inline">正在读取应用角色与当前授权…</p>
              <template v-else>
                <div v-if="isLegacyStructuralAuthorizationSubject" class="iam-application-permission-block">
                  <div class="iam-application-permission-head"><strong>当前历史手工直绑（只读）</strong><span>{{ applicationManualRoles.length }} 个角色</span></div>
                  <p v-if="!applicationManualRoles.length" class="iam-empty-inline">当前应用没有需要清理的组织或岗位历史手工直绑。</p>
                  <div v-else class="iam-application-role-list">
                    <div v-for="(role, index) in applicationManualRoles" :key="`${roleCode(role)}-${index}`" class="iam-application-role-option selected is-unavailable">
                      <span class="iam-application-role-copy">
                        <strong>{{ applicationRoleName(role) }}</strong><code>{{ roleCode(role) }}</code>
                        <small>范围：{{ authorizationScopeText(role) }}</small>
                        <small>有效期：{{ authorizationValidityText(role) }}</small>
                      </span>
                    </div>
                  </div>
                </div>
                <div v-else-if="!authorizationRoleOptions.length" class="iam-application-empty-catalog"><strong>{{ authorizationCatalog ? '目录中暂无可分配的 ACTIVE 角色' : '暂无可分配角色目录' }}</strong><p>{{ authorizationCatalog ? '当前角色目录仅包含停用、不可分配或已弃用角色。请由子系统维护角色目录后再进行授权。' : '该应用尚未同步角色目录，平台不会猜测、内置或编辑子系统业务角色与权限。请由应用负责人同步授权目录后再分配角色。' }}</p></div>
                <fieldset v-else class="iam-application-role-fieldset" :disabled="applicationAccessSaving || applicationAccessRevoking">
                  <legend>例外角色（只可选择目录 ACTIVE 角色）</legend>
                  <p class="iam-field-help">角色和默认权限来自子系统角色目录，只读展示。基础平台仅保存“主体 / 应用 / 角色 / 范围 / 有效期”，不会提交其他子系统的自定义业务权限。</p>
                  <p v-if="authorizationMaxEffectiveRoles" class="iam-field-help">该应用限制每个用户最多 {{ authorizationMaxEffectiveRoles }} 个有效角色（含个人例外与组织/岗位继承）。当前已勾选 <strong>{{ authorizationSelectedDirectRoleCount }}</strong> 个直接例外角色。</p>
                  <p v-if="authorizationDirectLimitExceeded" class="iam-field-help iam-application-scope-warning" role="alert">已勾选 {{ authorizationSelectedDirectRoleCount }} 个例外角色，超过该应用允许的最大有效角色数（{{ authorizationMaxEffectiveRoles }} 个）；请取消多余角色后再保存。</p>
                  <p v-if="catalogInactiveOrRestrictedRoleCount" class="iam-field-help">目录中另有 {{ catalogInactiveOrRestrictedRoleCount }} 个停用或不可分配角色，已从可选项中排除。</p>
                  <p v-if="!authorizationDraft.role_codes.length && !unavailableDirectRoles.length" class="iam-empty-inline">{{ authorizationEntryLayerInfo.empty }}</p>
                  <div class="iam-application-role-list"><label v-for="role in authorizationRoleOptions" :key="role.role_id || role.id || roleCode(role)" class="iam-application-role-option" :class="{ selected: authorizationDraft.role_codes.includes(roleCode(role)) }"><input v-model="authorizationDraft.role_codes" type="checkbox" :value="roleCode(role)" @change="onExceptionRoleToggle(roleCode(role), $event)" /><span class="iam-application-role-copy"><strong>{{ role.name || role.display_name || roleCode(role) }}</strong><code>{{ roleCode(role) }}</code><small v-if="role.description">{{ role.description }}</small><small class="iam-application-role-status">ACTIVE · {{ rolePermissionCodes(role).length }} 项默认权限</small><small class="iam-application-role-summary">来源：{{ authorizationEntryLayerInfo.title }} · 默认能力（子系统只读）：{{ roleDefaultPermissionSummary(role) }}</small></span></label></div>
                </fieldset>
                <!-- 不在当前 ACTIVE 目录中的历史例外角色：保留在草稿（已勾选、不可改），保存时弹窗要求用户显式确认撤销。 -->
                <fieldset v-if="isUserAuthorizationSubject && unavailableDirectRoles.length" class="iam-application-role-fieldset iam-application-unavailable" :disabled="applicationAccessSaving || applicationAccessRevoking">
                  <legend>已不再可分配（{{ unavailableDirectRoles.length }}）</legend>
                  <p class="iam-field-help iam-application-catalog-warning">以下角色在历史直绑中保留，但已不在当前 ACTIVE 目录中。保存时会被要求显式确认撤销。</p>
                  <div class="iam-application-role-list">
                    <label v-for="role in unavailableDirectRoles" :key="`unavail-${roleCode(role)}`" class="iam-application-role-option selected is-unavailable">
                      <input type="checkbox" :checked="authorizationDraft.role_codes.includes(roleCode(role))" disabled />
                      <span class="iam-application-role-copy">
                        <strong>{{ applicationRoleName(role) }}</strong><code>{{ roleCode(role) }}</code>
                        <small class="iam-application-role-status">不在当前 ACTIVE 目录</small>
                      </span>
                    </label>
                  </div>
                </fieldset>

                <div v-if="isUserAuthorizationSubject" class="iam-application-permission-block">
                  <div class="iam-application-permission-head"><strong>标准继承授权（只读）</strong><span>{{ applicationInheritedRoles.length }} 个角色</span></div>
                  <p v-if="!applicationInheritedRoles.length" class="iam-empty-inline">当前没有来自组织单元或岗位的继承角色。</p>
                  <div v-else class="iam-application-role-list">
                    <div v-for="(role, index) in applicationInheritedRoles" :key="`${roleCode(role)}-${role.source_type || 'source'}-${role.source_id || index}`" class="iam-application-role-option selected">
                      <span class="iam-application-role-copy">
                        <strong>{{ applicationRoleName(role) }}</strong><code>{{ roleCode(role) }}</code>
                        <small>来源：{{ authorizationSourceTypeName(role) }} · {{ authorizationSourceName(role) }}</small>
                        <small>范围：{{ authorizationScopeText(role) }}</small>
                        <small>有效期：{{ authorizationValidityText(role) }}</small>
                      </span>
                    </div>
                  </div>
                  <p class="iam-field-help">继承角色由组织单元或岗位产生；标准岗位角色应在“岗位授权模板”中维护。保存或撤销个人例外授权不会删除这些标准授权。</p>
                </div>

                <div class="iam-application-permission-block effective"><div class="iam-application-permission-head"><strong>角色默认权限摘要（只读）</strong><span>{{ authorizationEffectivePermissions.length }} 项</span></div><p v-if="hasApplicationAuthorizationConflict" class="iam-empty-inline">角色存在冲突，服务端不会计算或签发权限并集。请先处理冲突来源。</p><p v-else-if="!authorizationEffectivePermissions.length" class="iam-empty-inline">当前直接角色与继承角色没有可展示的默认权限；请由子系统同步完整角色目录。最终业务鉴权仍由子系统执行。</p><div v-else class="iam-application-permission-tags"><span v-for="permission in authorizationEffectivePermissions" :key="permission"><b>{{ permissionName(permission) }}</b><code>{{ permission }}</code></span></div><p class="iam-field-help">该摘要只来自子系统已同步角色的默认权限，供授权预览与影响分析使用。基础平台不提供新增、删除或覆盖其他子系统业务权限的入口；保存时只提交上方勾选的例外角色。</p></div>
                <p v-if="isUserAuthorizationSubject && !canManageApplicationAuthorization" class="iam-field-help" role="status">当前账号只有查看权限，缺少“更新角色绑定”权限，因此不能保存个人例外授权。请让平台安全管理员为该账号授予 <code>platform:role-binding:update</code>。</p>
              </template>
            </div>
          </template>
          </template>
        </section>
        <footer>
          <button class="console-button ghost" type="button" :disabled="applicationAccessSaving || applicationAccessRevoking" @click="requestCloseDetail">关闭</button>
          <button v-if="!isUserAuthorizationSubject && supportsApplicationAuthorization && selectedApplicationCode && hasDirectApplicationAccess && canManageApplicationAuthorization" class="console-button danger" type="button" :disabled="applicationAccessSaving || applicationAccessRevoking" @click="revokeApplicationAccess">{{ applicationAccessRevoking ? '清理中…' : '清理历史直绑' }}</button>
        </footer>
      </section>
    </div>

    <div v-if="passwordResetDialog" class="iam-modal-backdrop" role="presentation" @click.self="closePasswordResetDialog">
      <section class="iam-modal iam-confirm-modal" role="dialog" aria-modal="true" aria-label="确认重置密码">
        <header><div><p>敏感操作</p><h3>确认重置密码</h3></div><button class="console-modal-close" type="button" aria-label="关闭密码重置确认" :disabled="resettingPassword" @click="closePasswordResetDialog"><ConsoleIcon name="close" /></button></header>
        <div class="iam-confirm-body">
          <p>{{ selectedPasswordResetAccount?.password_initialized === false ? '系统将为该预置登录账号生成首个临时密码。密码只会在下一步显示一次。' : '系统将为下列登录账号生成新的临时密码。旧密码将立即失效，临时密码只会在下一步显示一次。' }}</p>
          <label v-if="passwordResetDialog.accounts.length > 1"><span>关联登录账号</span><select v-model="passwordResetDialog.accountId"><option v-for="account in passwordResetDialog.accounts" :key="account.account_id" :value="account.account_id">{{ account.account_name || account.account_id }}（{{ account.account_id }}）</option></select></label>
          <dl v-if="selectedPasswordResetAccount" class="iam-confirm-summary"><div><dt>登录账号</dt><dd>{{ selectedPasswordResetAccount.account_name || selectedPasswordResetAccount.account_id }}</dd></div><div><dt>账号 ID</dt><dd class="console-mono">{{ selectedPasswordResetAccount.account_id }}</dd></div><div v-if="passwordResetDialog.userName"><dt>关联用户</dt><dd>{{ passwordResetDialog.userName }}</dd></div></dl>
        </div>
        <footer><button class="console-button ghost" type="button" :disabled="resettingPassword" @click="closePasswordResetDialog">取消</button><button class="console-button primary" type="button" :disabled="!selectedPasswordResetAccount || resettingPassword" @click="confirmPasswordReset">{{ resettingPassword ? (selectedPasswordResetAccount?.password_initialized === false ? '正在初始化…' : '正在重置…') : (selectedPasswordResetAccount?.password_initialized === false ? '确认初始化' : '确认重置') }}</button></footer>
      </section>
    </div>

    <div v-if="temporaryPassword" class="iam-modal-backdrop" role="presentation" @click.self="closeTemporaryPassword">
      <section class="iam-modal iam-temporary-password-modal" role="dialog" aria-modal="true" aria-label="一次性临时密码">
        <header><div><p>请立即保存</p><h3>一次性临时密码</h3></div><button class="console-modal-close" type="button" aria-label="关闭临时密码" @click="closeTemporaryPassword"><ConsoleIcon name="close" /></button></header>
        <div class="iam-confirm-body">
          <p>账号 <strong>{{ temporaryPassword.accountName }}</strong> 的密码已{{ temporaryPassword.initialized ? '初始化' : '重置' }}。关闭此窗口后，临时密码将从当前页面清除；如未保存，只能再次生成。</p>
          <!-- 默认遮罩，避免截屏/屏幕共享/拼写自动补全意外泄露；点揭示按钮才显示一次。 -->
          <code class="iam-one-time-password" :class="{ 'is-masked': !temporaryPasswordVisible }" @click="revealTemporaryPassword" :title="temporaryPasswordVisible ? '点击隐藏' : '点击揭示一次'">{{ temporaryPasswordVisible ? temporaryPassword.value : '••••••••••••••••（点击揭示）' }}</code>
          <p class="iam-one-time-warning">请仅通过受控的安全渠道交付给用户，不要粘贴到工单、聊天记录或日志中。揭示后请尽快复制或记录。</p>
        </div>
        <footer><button class="console-button ghost" type="button" @click="closeTemporaryPassword">我已保存</button><button class="console-button ghost" type="button" :disabled="!temporaryPasswordVisible" @click="hideTemporaryPassword">隐藏</button><button class="console-button primary" type="button" @click="copyTemporaryPassword">复制临时密码</button></footer>
      </section>
    </div>

    <div v-if="userDeletionDialog" class="iam-modal-backdrop" role="presentation" @click.self="closeUserDeletionDialog">
      <section class="iam-modal iam-confirm-modal" role="dialog" aria-modal="true" aria-label="确认删除用户">
        <header><div><p>危险操作</p><h3>确认删除用户</h3></div><button class="console-modal-close" type="button" aria-label="关闭删除用户确认" :disabled="deletingUser" @click="closeUserDeletionDialog"><ConsoleIcon name="close" /></button></header>
        <div class="iam-confirm-body"><p>确认删除用户 <strong>{{ userDeletionDialog.display_name || userDeletionDialog.user_id }}</strong> 吗？该操作不可恢复；关联登录账号和任职关系将同步删除，当前登录会话也会立即失效。</p><dl class="iam-confirm-summary"><div><dt>用户 ID</dt><dd class="console-mono">{{ userDeletionDialog.user_id }}</dd></div><div><dt>当前版本</dt><dd>{{ userDeletionDialog.version ?? 0 }}</dd></div></dl></div>
        <footer><button class="console-button ghost" type="button" :disabled="deletingUser" @click="closeUserDeletionDialog">取消</button><button class="console-button iam-danger-button" type="button" :disabled="deletingUser" @click="confirmUserDeletion">{{ deletingUser ? '正在删除…' : '确认删除' }}</button></footer>
      </section>
    </div>

    <!-- 通用危险/重要操作确认弹窗。替代所有 window.confirm，避免 WebView 下静默失败。 -->
    <div v-if="confirmDialog" class="iam-modal-backdrop" role="presentation" @click.self="closeConfirm" @keydown.esc="closeConfirm">
      <section class="iam-modal iam-confirm-modal" role="dialog" aria-modal="true" :aria-label="confirmDialog.title" @keydown.esc="closeConfirm">
        <header><div><p>{{ confirmDialog.danger ? '危险操作' : '请确认' }}</p><h3>{{ confirmDialog.title }}</h3></div><button class="console-modal-close" type="button" :aria-label="`关闭${confirmDialog.title}`" :disabled="confirmDialog.busy" @click="closeConfirm"><ConsoleIcon name="close" /></button></header>
        <div class="iam-confirm-body">
          <p style="white-space: pre-line;">{{ confirmDialog.description }}</p>
        </div>
        <footer>
          <button class="console-button ghost" type="button" :disabled="confirmDialog.busy" @click="closeConfirm">{{ confirmDialog.cancelText }}</button>
          <button :class="['console-button', confirmDialog.danger ? 'iam-danger-button' : 'primary']" type="button" :disabled="confirmDialog.busy" @click="runConfirm">{{ confirmDialog.confirmText }}</button>
        </footer>
      </section>
    </div>

    <BatchUserImportDialog
      v-if="batchImportVisible"
      :organizations="organizations"
      :positions="positions"
      :catalogs-loading="loading.organizations || loading.positions"
      :catalogs-error="errorMessage"
      @close="batchImportVisible = false"
      @completed="refreshAfterBatchImport"
      @toast="emitToast"
    />

    <div v-if="validityEditor" class="iam-modal-backdrop" role="presentation" @click.self="closeValidityEditor">
      <section class="iam-modal iam-editor-modal" role="dialog" aria-modal="true" aria-label="修改有效期">
        <header><div><p>身份生命周期</p><h3>修改{{ validityEditor.kind === 'user' ? '用户' : '账号' }}有效期</h3></div><button class="console-modal-close" type="button" :disabled="validitySaving" @click="closeValidityEditor"><ConsoleIcon name="close" /></button></header>
        <form class="iam-editor-form" @submit.prevent="saveValidity">
          <p class="iam-form-alert full"><ConsoleIcon name="info" />用户到期会使其全部登录账号和现有会话失效；账号到期仅影响当前账号。恢复长期有效后可以重新登录，但不会恢复已经撤销的会话。</p>
          <label class="full"><span>有效方式 *</span><select v-model="validityEditor.mode"><option value="PERMANENT">长期有效</option><option value="TEMPORARY">指定截止时间</option></select></label>
          <label v-if="validityEditor.mode === 'TEMPORARY'" class="full"><span>有效截止时间 *</span><input v-model="validityEditor.valid_until" required type="datetime-local" /></label>
          <div class="console-form-actions full"><button class="console-button ghost" type="button" :disabled="validitySaving" @click="closeValidityEditor">取消</button><button class="console-button primary" type="submit" :disabled="validitySaving">{{ validitySaving ? '保存中…' : '保存有效期' }}</button></div>
        </form>
      </section>
    </div>

    <IdentityEditorModal
      v-if="editor"
      ref="editorModal"
      :editor="editor"
      :form="form"
      :saving="saving"
      :references-loading="editorReferencesLoading"
      :references-error="editorReferencesError"
      :selection-notice="editorSelectionNotice"
      :users="editorUsers"
      :organizations="organizations"
      :parent-options="organizationParentOptions"
      :membership-organizations="membershipOrganizations"
      :membership-positions="membershipPositions"
      @close="closeEditor"
      @save="saveEditor"
      @reload-references="loadEditorReferences(editor.kind)"
    />
  </section>
</template>
