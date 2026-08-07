<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import ConsoleIcon from '@/modules/platform/shared/components/ConsoleIcon.vue'
import PositionAuthorizationTemplates from '@/modules/platform/iam/components/PositionAuthorizationTemplates.vue'
import BatchUserImportDialog from '@/modules/platform/iam/components/BatchUserImportDialog.vue'
import AuthorizationEntryGuidance from '@/modules/platform/iam/components/AuthorizationEntryGuidance.vue'
import OrgUnitTree from '@/modules/platform/iam/components/OrgUnitTree.vue'
import PositionGroups from '@/modules/platform/iam/components/PositionGroups.vue'
import MembershipGroups from '@/modules/platform/iam/components/MembershipGroups.vue'
import {
  detailRows,
  detailTitle,
  displayLoginAccountType,
  displayMembershipType,
  displayMembershipValidity,
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
} from '@/modules/platform/iam/api/iam'
import { listApplications, listEnvironments } from '@/modules/platform/applications/api/applications'
import {
  AuthorizationError,
  deleteApplicationAccess,
  deleteSubjectApplicationAccess,
  getApplicationAccess,
  getApplicationAuthorizationCatalog,
  getSubjectApplicationAccess,
  updateApplicationAccess,
  updateSubjectApplicationAccess,
} from '@/modules/platform/iam/api/authorization'
import {
  assignableActiveCatalogRoles,
  catalogLastSyncedAt as readCatalogLastSyncedAt,
  catalogRolePermissions,
  catalogRoles,
  catalogSyncText as authorizationCatalogSyncText,
  catalogVersion,
  isAssignableActiveCatalogRole,
  isCatalogSynchronized,
} from '@/modules/platform/iam/utils/applicationAuthorizationCatalog'
import { authorizationEntryLayer } from '@/modules/platform/iam/utils/authorizationEntryLayer'
import {
  buildOrganizationTree,
  organizationDescendantIds,
} from '@/modules/platform/iam/utils/organizationTree'
import { groupPositionsByOrganization } from '@/modules/platform/iam/utils/positionGroups'
import {
  filteredMembershipsFromGroups,
  groupMembershipsByOrganization,
} from '@/modules/platform/iam/utils/membershipGroups'
import { loadAllCatalogPages } from '@/modules/platform/iam/utils/paginatedCatalog'
import { buildUserAuthorizationOverview } from '@/modules/platform/iam/utils/userAuthorizationOverview'
import { isCurrentAuthorizationRequest } from '@/modules/platform/iam/utils/requestVersion'
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
  // EmployeeOnboardingModal is owned by PlatformConsoleView, so its successful
  // completion must explicitly invalidate the IAM lists mounted here.
  refreshKey: { type: Number, default: 0 },
})
const emit = defineEmits(['toast', 'employee-onboarding'])

// 当前登录用户的权限集合（来自 /auth/me 的 permission_codes 字段）。
// 路由级守卫已在 router/index.js 完成认证；这里只用于按权限隐藏高危按钮。
// 真正的禁用/拒绝仍由后端执行，UI 隐藏只是体验优化。
const { refreshPrincipal } = useCurrentPrincipal()
// IAM 权限码和面板 OR 集合统一维护在 iamPermissions.js；这里仅消费真实权限。

const activePanel = ref('users')
const positionAuthorizationTemplates = ref(null)
const batchImportVisible = ref(false)
const detail = ref(null)
const loading = reactive({ users: false, accounts: false, organizations: false, positions: false, memberships: false, positionAuthorizationTemplates: false })
const errorMessage = ref('')
const pageSize = 50
const pagination = reactive({
  users: { page: 1, pageSize, total: 0 },
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
const organizations = ref([])
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
// 通用危险操作确认弹窗。所有 window.confirm 都应改为走这里，避免在 WebView / 某些
// PWA 容器中 confirm 静默失败导致危险操作被误判为取消。
const confirmDialog = ref(null) // { title, description, confirmText, cancelText, danger, busy, onConfirm }
function openConfirm({ title, description, confirmText = '确认', cancelText = '取消', danger = false, onConfirm }) {
  confirmDialog.value = { title, description, confirmText, cancelText, danger, busy: false, onConfirm }
}
function closeConfirm() {
  if (confirmDialog.value?.busy) return
  confirmDialog.value = null
}
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
const selectedApplicationCode = ref('')
const applicationEnvironments = ref([])
const applicationEnvironmentsLoading = ref(false)
// 用户详情弹窗内的“有效授权总览”卡片：逐个读取已接入应用的用户访问快照，
// 再按应用和来源合并展示；任一应用失败不会阻塞个人例外授权的维护。
const userAuthorizationPreview = ref(null)
const userAuthorizationPreviewLoading = ref(false)
const userAuthorizationPreviewUnavailable = ref(false)
const userAuthorizationPreviewErrorCount = ref(0)
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
})

const selectedApplication = computed(() => applications.value.find((item) => item.code === selectedApplicationCode.value) || null)
const authorizationCatalogRoles = computed(() => catalogRoles(authorizationCatalog.value))
const hasSynchronizedAuthorizationCatalog = computed(() => isCatalogSynchronized(authorizationCatalog.value))
const authorizationRoleOptions = computed(() => hasSynchronizedAuthorizationCatalog.value ? assignableActiveCatalogRoles(authorizationCatalog.value) : [])
const catalogRoleTotal = computed(() => authorizationCatalogRoles.value.length)
const catalogInactiveOrRestrictedRoleCount = computed(() => Math.max(catalogRoleTotal.value - authorizationRoleOptions.value.length, 0))
const catalogSyncText = computed(() => authorizationCatalogSyncText(authorizationCatalog.value))
const catalogLastSyncedAt = computed(() => readCatalogLastSyncedAt(authorizationCatalog.value))
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
// 用户详情弹窗「有效授权总览」派生数据。
// roles 项至少包含 { source_type, source_id, source_name, application_code, application_name, role_code, role_name }。
const userAuthorizationPreviewRoles = computed(() => Array.isArray(userAuthorizationPreview.value?.roles) ? userAuthorizationPreview.value.roles : [])
const userAuthorizationPreviewEffectiveRoles = computed(() => Array.isArray(userAuthorizationPreview.value?.effective_roles) ? userAuthorizationPreview.value.effective_roles : userAuthorizationPreviewRoles.value)
const userAuthorizationPreviewConflicts = computed(() => {
  const raw = userAuthorizationPreview.value?.conflicts
  if (Array.isArray(raw)) return raw.filter((item) => item !== null && item !== undefined && String(item).trim() !== '')
  return []
})
// 按来源类型分组（USER 直接 / ORG_UNIT 继承 / POSITION 继承）。未知来源归入 OTHER。
const userAuthorizationPreviewBySource = computed(() => {
  const groups = { USER: [], ORG_UNIT: [], POSITION: [], OTHER: [] }
  for (const role of userAuthorizationPreviewEffectiveRoles.value) {
    const type = String(role?.source_type || '').toUpperCase()
    const grantOrigin = String(role?.grant_origin || '').toUpperCase()
    if (type === 'USER' && grantOrigin && grantOrigin !== 'MANUAL') groups.OTHER.push(role)
    else if (type === 'USER' || type === 'ORG_UNIT' || type === 'POSITION') groups[type].push(role)
    else groups.OTHER.push(role)
  }
  return groups
})
// 合并去重：按 application_code + role_code 去重。冲突时只保留首条，供"最终生效"概览使用。
const userAuthorizationPreviewMerged = computed(() => {
  const seen = new Set()
  const merged = []
  for (const role of userAuthorizationPreviewEffectiveRoles.value) {
    const appCode = role?.application_code || ''
    const code = roleCode(role)
    if (!code) continue
    const key = `${appCode}::${code}`
    if (seen.has(key)) continue
    seen.add(key)
    merged.push(role)
  }
  return merged
})
const hasUserAuthorizationPreviewConflict = computed(() => userAuthorizationPreviewConflicts.value.length > 0)
// 模板里 v-for 用的"来源分组"驱动数组。顺序固定：个人直接 → 组织 → 岗位 → 其它。
const userAuthorizationPreviewSources = [
  { key: 'USER', label: '个人例外授权' },
  { key: 'ORG_UNIT', label: '组织单元继承' },
  { key: 'POSITION', label: '岗位继承' },
  { key: 'OTHER', label: '系统或其它来源' },
]
const selectedAuthorizationRoles = computed(() => authorizationRoleOptions.value.filter((role) => authorizationDraft.role_codes.includes(roleCode(role))))
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

function includesFilter(items, filter, fields) {
  const keyword = String(filter || '').trim().toLowerCase()
  if (!keyword) return items
  return items.filter((item) => fields
    .map((field) => {
      const value = field.split('.').reduce((acc, key) => (acc == null ? acc : acc[key]), item)
      return Array.isArray(value) ? value.join(' ') : value
    })
    .join(' ')
    .toLowerCase()
    .includes(keyword))
}

const filteredUsers = computed(() => includesFilter(users.value, panelFilters.users, ['display_name', 'employee_no', 'email', 'status']))
const filteredAccounts = computed(() => includesFilter(accounts.value, panelFilters.accounts, ['account_name', 'user_id', 'status']))
const filteredOrganizations = computed(() => includesFilter(organizations.value, panelFilters.organizations, ['code', 'name']))
const filteredPositions = computed(() => groupPositionsByOrganization(
  positions.value,
  organizations.value,
  panelFilters.positions,
).flatMap((group) => group.positions))
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

function accountsForUser(userId) {
  return accounts.value.filter((account) => account.user_id === userId)
}

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
  applications.value = []
  applicationsLoading.value = false
  authorizationCatalog.value = null
  authorizationCatalogLoading.value = false
  applicationAccess.value = null
  applicationAccessLoading.value = false
  applicationAccessError.value = ''
  selectedApplicationCode.value = ''
  applicationEnvironments.value = []
  applicationEnvironmentsLoading.value = false
  authorizationDraft.role_codes = []
  authorizationDraft.scope_type = 'APPLICATION'
  authorizationDraft.environment_code = ''
  authorizationDraft.validity_mode = 'PERMANENT'
  authorizationDraft.valid_from = ''
  authorizationDraft.valid_until = ''
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

// 草稿里勾选的每个角色都映射到原始 direct_role 的 signature。只有当用户当前
// 真正打算提交 2+ 个不同 signature 的角色时才视为冲突——避免"打开详情"就触发。
const authorizationHasMixedRoleSettings = computed(() => {
  const signatureByCode = new Map()
  applicationManualRoles.value.forEach((role) => {
    signatureByCode.set(roleCode(role), roleAuthorizationSignature(role))
  })
  const signatures = new Set()
  authorizationDraft.role_codes.forEach((code) => {
    const sig = signatureByCode.get(code)
    if (sig) signatures.add(sig)
  })
  return signatures.size > 1
})

const authorizationEnvironmentOptions = computed(() => applicationEnvironments.value
  .map((environment) => ({
    code: environment.environment_code || environment.environment || environment.code || '',
    name: environment.name || environment.display_name || environment.environment_code || environment.environment || environment.code || '未命名环境',
  }))
  .filter((environment) => environment.code))

function applyAuthorizationSettings(roles) {
  const firstRole = roles.find((role) => role && typeof role === 'object')
  const scopeType = normalizeScopeType(firstRole?.scope_type)
  authorizationDraft.scope_type = scopeType
  authorizationDraft.environment_code = scopeType === 'ENVIRONMENT' ? String(firstRole?.environment_code || '') : ''
  authorizationDraft.valid_from = toDateTimeLocal(firstRole?.valid_from)
  authorizationDraft.valid_until = toDateTimeLocal(firstRole?.valid_until)
  authorizationDraft.validity_mode = firstRole?.valid_from || firstRole?.valid_until ? 'RANGE' : 'PERMANENT'
}


async function openDetail(kind, item) {
  const detailRequestId = ++detailAuthorizationRequestSeq.value
  resetApplicationAuthorizationState()
  resetUserAuthorizationPreview()
  detail.value = { kind, item }
  if (kind === 'user' && canReadApplicationAuthorization.value) userAuthorizationPreviewLoading.value = true
  const loadedApplications = canReadApplicationAuthorization.value && ['user', 'organization', 'position'].includes(kind)
    ? await loadApplicationsForSubject()
    : []
  if (detailRequestId !== detailAuthorizationRequestSeq.value) return
  if (kind === 'user' && canReadApplicationAuthorization.value) {
    await loadUserAuthorizationPreview(item?.user_id || '', loadedApplications, detailRequestId)
  }
}

function closeDetail() {
  detailAuthorizationRequestSeq.value += 1
  detail.value = null
  resetApplicationAuthorizationState()
  resetUserAuthorizationPreview()
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
  userAuthorizationPreviewLoading.value = true
  try {
    const settled = await Promise.allSettled((Array.isArray(targetApplications) ? targetApplications : []).map(async (application) => {
      try {
        const access = await getApplicationAccess(userId, application.code)
        return { application, access }
      } catch (error) {
        if (error instanceof AuthorizationError && error.status === 404) return { application, access: null }
        throw error
      }
    }))
    if (!isCurrentRequest()) return
    const fulfilled = settled.filter((result) => result.status === 'fulfilled').map((result) => result.value)
    userAuthorizationPreviewErrorCount.value = settled.length - fulfilled.length
    userAuthorizationPreview.value = buildUserAuthorizationOverview(fulfilled)
    userAuthorizationPreviewUnavailable.value = settled.length > 0 && fulfilled.length === 0
  } catch (_error) {
    if (isCurrentRequest()) userAuthorizationPreviewUnavailable.value = true
  } finally {
    if (isCurrentRequest()) userAuthorizationPreviewLoading.value = false
  }
}

function resetUserAuthorizationPreview() {
  userAuthorizationPreview.value = null
  userAuthorizationPreviewLoading.value = false
  userAuthorizationPreviewUnavailable.value = false
  userAuthorizationPreviewErrorCount.value = 0
}

function applyApplicationAccess(access) {
  applicationAccess.value = access || null
  const manualRoles = Array.isArray(access?.manual_roles) ? access.manual_roles : []
  // 只把手工直绑角色放进可写草稿；模板和系统角色必须保留在其来源层，不能被个人保存覆盖。
  // 仍保留目录里已过期/不可分配的 MANUAL 角色，让用户显式确认是否撤销。
  // 之前按 ACTIVE 目录过滤会让“打开详情 → 保存”把历史角色默默清空。
  authorizationDraft.role_codes = uniqueValues(manualRoles.map((role) => roleCode(role)))
  applyAuthorizationSettings(manualRoles)
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
    applicationAccessError.value = error?.message || '读取应用列表失败。'
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
  const requestId = ++applicationAuthorizationRequestSeq.value
  selectedApplicationCode.value = applicationCode
  const requestIdentity = { version: requestId, subjectId, subjectType, applicationCode }
  const isCurrentRequest = () => isCurrentAuthorizationRequest(requestIdentity, {
    version: applicationAuthorizationRequestSeq.value,
    subjectId: authorizationSubjectId.value,
    subjectType: authorizationSubjectType.value,
    applicationCode: selectedApplicationCode.value,
  })
  authorizationCatalog.value = null
  applicationAccess.value = null
  authorizationDraft.role_codes = []
  authorizationDraft.scope_type = 'APPLICATION'
  authorizationDraft.environment_code = ''
  authorizationDraft.validity_mode = 'PERMANENT'
  authorizationDraft.valid_from = ''
  authorizationDraft.valid_until = ''
  applicationEnvironments.value = []
  applicationAccessError.value = ''
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
        applicationAccessError.value = error?.message || '读取应用环境失败。'
      }
    } finally {
      if (isCurrentRequest()) applicationEnvironmentsLoading.value = false
    }

    try {
      const catalog = await getApplicationAuthorizationCatalog(application.application_id || application.id)
      if (isCurrentRequest()) authorizationCatalog.value = catalog
    } catch (error) {
      if (isCurrentRequest()) applicationAccessError.value = error instanceof AuthorizationError ? error.message : (error?.message || '读取应用角色目录失败。')
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
    if (isCurrentRequest()) applicationAccessError.value = error instanceof AuthorizationError ? error.message : (error?.message || '读取应用访问授权失败。')
  } finally {
    if (isCurrentRequest()) {
      authorizationCatalogLoading.value = false
      applicationAccessLoading.value = false
    }
  }
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
    roles: validCodes.map((roleCode) => ({
      role_code: roleCode,
      scope_type: scopeType,
      environment_code: environmentCode,
      valid_from: validFrom,
      valid_until: validUntil,
    })),
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
  // 阻断：草稿里同时存在 2+ 个不同 scope/有效期 signature 的角色。
  // 直接保存会把所有角色统一成同一组 scope/有效期，其余配置会被静默抹平。
  if (authorizationHasMixedRoleSettings.value) {
    applicationAccessError.value = '当前勾选的角色包含不同的授权范围或有效期组合，保存会按当前统一设置替换全部角色。请在“标准继承授权（只读）”中删除冲突来源，或取消多余角色后重新提交。'
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
          await performSaveApplicationAccess()
        } finally {
          closeConfirm()
        }
      },
    })
    return
  }
  await performSaveApplicationAccess()
}

async function performSaveApplicationAccess() {
  const subjectId = authorizationSubjectId.value
  const subjectType = authorizationSubjectType.value
  const applicationCode = selectedApplicationCode.value
  if (!subjectId || !subjectType || !applicationCode || applicationAccessSaving.value) return
  if (subjectType !== 'USER') {
    applicationAccessError.value = '该主体不允许保存直接角色。'
    return
  }
  applicationAccessSaving.value = true
  applicationAccessError.value = ''
  try {
    const access = subjectType === 'USER'
      ? await updateApplicationAccess(subjectId, applicationCode, applicationAccessPayload())
      : await updateSubjectApplicationAccess(subjectType, subjectId, applicationCode, applicationAccessPayload())
    applyApplicationAccess(access)
    emitToast(`${authorizationEntryLayerInfo.value.title}已保存。${subjectType === 'USER' ? '基础平台会在下一次请求立即按最新权限校验；已打开页面会自动刷新授权状态。' : '相关用户会按最新授权重新计算继承角色。'}`)
  } catch (error) {
    applicationAccessError.value = error instanceof AuthorizationError ? error.message : (error?.message || '保存应用访问授权失败。')
  } finally {
    applicationAccessSaving.value = false
  }
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
        if (subjectType === 'USER') await deleteApplicationAccess(subjectId, applicationCode)
        else await deleteSubjectApplicationAccess(subjectType, subjectId, applicationCode)
        await loadApplicationAuthorization(applicationCode)
        emitToast(isLegacyStructuralAuthorizationSubject.value
          ? `${authorizationSubjectLabel.value}历史直绑已清理；标准角色请在岗位授权模板中维护。`
          : isUserAuthorizationSubject.value && applicationInheritedRoles.value.length
          ? '个人例外授权已撤销；组织或岗位继承的标准授权仍然有效。'
          : `${authorizationEntryLayerInfo.value.title}已撤销。`)
      } catch (error) {
        applicationAccessError.value = error instanceof AuthorizationError ? error.message : (error?.message || '撤销应用访问失败。')
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

function asId(value) {
  if (!value) return '—'
  if (typeof value === 'string') return value
  if (typeof value === 'object' && value.id) return value.id
  return String(value)
}

async function copyText(value, { success = '已复制' } = {}) {
  if (!value) return
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value)
    } else {
      // 退化：选中文本 + execCommand。HTTP 站点 clipboard 不可用时仍可工作。
      const textarea = document.createElement('textarea')
      textarea.value = value
      textarea.style.position = 'fixed'
      textarea.style.opacity = '0'
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand('copy')
      document.body.removeChild(textarea)
    }
    emitToast(success)
  } catch {
    emitToast('复制失败，请手动选中复制。')
  }
}

function escapeCsvCell(value) {
  if (value === null || value === undefined) return ''
  const text = String(value)
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`
  }
  return text
}

function downloadCsv(filename, headers, rows) {
  const csv = [headers.map(escapeCsvCell).join(','), ...rows.map((row) => row.map(escapeCsvCell).join(','))].join('\r\n')
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
      ['用户 ID', '姓名', '工号', '邮箱', '手机号（脱敏）', '状态', '更新时间'],
      filteredUsers.value.map((item) => [item.user_id, item.display_name, item.employee_no || '', item.email || '', item.mobile_masked || '', displayStatus(item.status), formatDateTime(item.updated_at)]))
  } else if (key === 'accounts') {
    downloadCsv(`iam-accounts-${stamp}.csv`,
      ['账号 ID', '账号名', '关联用户', '类型', '认证', '状态', '有效时间', '更新时间'],
      filteredAccounts.value.map((item) => [item.account_id, item.account_name, item.user_id || '', displayLoginAccountType(item).split(' / ')[0], displayLoginAccountType(item).split(' / ')[1], displayStatus(item.status), item.valid_until ? formatDateTime(item.valid_until) : '长期有效', formatDateTime(item.updated_at)]))
  } else if (key === 'organizations') {
    downloadCsv(`iam-organizations-${stamp}.csv`,
      ['组织 ID', '编码', '名称', '上级 ID', '显示顺序', '状态'],
      filteredOrganizations.value.map((item) => [item.org_unit_id, item.code || '', item.name, item.parent_id || '', item.sort_order ?? 0, displayStatus(item.status)]))
  } else if (key === 'positions') {
    downloadCsv(`iam-positions-${stamp}.csv`,
      ['岗位 ID', '名称', '所属组织', '状态'],
      filteredPositions.value.map((item) => [item.position_id || item.id, item.name, item.organization_name || '', displayStatus(item.status)]))
  } else if (key === 'memberships') {
    downloadCsv(`iam-memberships-${stamp}.csv`,
      ['任职 ID', '用户', '组织', '岗位', '任职类型', '是否继承', '有效期'],
      filteredMemberships.value.map((item) => [item.membership_id || item.id, item.user?.name || item.user_id || '', item.org_unit?.name || item.org_unit_id || '', item.position?.name || item.position_id || '', displayMembershipType(item.membership_type), item.inherit_authorization === false ? '不继承' : '继承', displayMembershipValidity(item)]))
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
    errorMessage.value = error instanceof IamError || error instanceof AuthorizationError ? error.message : `${kind} 加载失败。`
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

async function loadUsers(page = pagination.users.page) {
  if (!canReadPanel(panels.find((item) => item.key === 'users'))) return
  const seq = ++requestSeq.users
  const data = await safeCall('users', () => listUsers({ page, pageSize, keyword: panelFilters.users, status: 'ACTIVE' }))
  if (seq !== requestSeq.users) return
  if (data) updatePage('users', data, users)
}

async function loadAccounts(page = pagination.accounts.page) {
  if (!canReadPanel(panels.find((item) => item.key === 'accounts'))) return
  const seq = ++requestSeq.accounts
  const data = await safeCall('accounts', () => listAccounts({ page, pageSize, keyword: panelFilters.accounts }))
  if (seq !== requestSeq.accounts) return
  if (data) updatePage('accounts', data, accounts)
}

async function loadOrganizations() {
  if (!canReadPanel(panels.find((item) => item.key === 'organizations'))) return
  const seq = ++requestSeq.organizations
  // 树结构必须同时拥有父节点和子节点。按后端允许的最大页长读取全部授权可见组织，
  // 搜索留在前端执行，避免服务端关键字过滤后只返回子节点而丢失其祖先上下文。
  const treePageSize = 100
  const data = await safeCall('organizations', async () => {
    const items = []
    const seenIds = new Set()
    let page = 1
    let total = 0

    while (page === 1 || items.length < total) {
      const result = await listOrgUnits({ page, pageSize: treePageSize, status: 'ACTIVE' })
      total = result.total
      let added = 0
      for (const item of result.items) {
        const id = String(item.org_unit_id || item.id || '')
        if (!id || seenIds.has(id)) continue
        seenIds.add(id)
        items.push(item)
        added += 1
      }
      if (!result.items.length || added === 0) break
      page += 1
    }

    const complete = items.length >= total
    return { items, total, page: 1, pageSize: complete ? Math.max(total, treePageSize) : treePageSize }
  })
  if (seq !== requestSeq.organizations) return
  if (data) {
    pagination.organizations.page = 1
    pagination.organizations.pageSize = data.pageSize
    pagination.organizations.total = data.total
    pagination.organizations.serverPagingSupported = data.items.length >= data.total
    organizations.value = data.items
  }
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
  // A successful employee onboarding changes three lists and all five summary
  // totals. Invalidate every visible IAM list together, while each loader's
  // request sequence still prevents an older response from winning a race.
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
    emitToast(error.message || '账号状态更新失败。')
  } finally {
    updatingAccountId.value = ''
  }
}

// 密码重置以 account_id 为键。从用户行发起时先用 user_id 解析关联账号，绝不能重置无关登录账号。
function openPasswordResetForAccount(account) {
  if (!account?.account_id) {
    emitToast('未找到可重置密码的登录账号。')
    return
  }
  passwordResetDialog.value = { accountId: account.account_id, accounts: [account], userName: '', initialize: account.password_initialized === false }
}

function openPasswordResetForUser(user) {
  const linkedAccounts = accountsForUser(user?.user_id)
  if (!linkedAccounts.length) {
    emitToast('该用户没有可管理的登录账号，无法重置密码。')
    return
  }
  passwordResetDialog.value = {
    accountId: linkedAccounts[0].account_id,
    accounts: linkedAccounts,
    userName: user.display_name || user.user_id,
    initialize: linkedAccounts[0].password_initialized === false,
  }
}

function closePasswordResetDialog() {
  if (resettingPassword.value) return
  passwordResetDialog.value = null
}

async function confirmPasswordReset() {
  const account = selectedPasswordResetAccount.value
  if (!account?.account_id || resettingPassword.value) return
  const initializing = account.password_initialized === false

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
    await loadAccounts()
    emitToast(initializing ? '登录密码已初始化，请立即复制并通过安全渠道交付。' : '密码已重置，请立即复制临时密码并通过安全渠道交付。')
  } catch (error) {
    emitToast(error instanceof IamError ? error.message : (error?.message || '密码重置失败。'))
  } finally {
    resettingPassword.value = false
  }
}

async function copyTemporaryPassword() {
  const value = temporaryPassword.value?.value
  if (!value) return
  try {
    await navigator.clipboard.writeText(value)
    emitToast('临时密码已复制，请立即通过安全渠道交付。')
  } catch {
    emitToast('浏览器未允许复制，请手动复制临时密码。')
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
    emitToast(error instanceof IamError ? error.message : (error?.message || '删除用户失败。'))
  } finally {
    deletingUser.value = false
  }
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
}

function openChildOrganizationEditor(parent) {
  const parentId = String(parent?.org_unit_id || parent?.id || '')
  if (!parentId) return
  openEditor('organization')
  form.parent_id = parentId
}

function openPositionEditorForOrganization(group) {
  const organizationId = String(group?.organization_id || group?.org_unit_id || group?.id || '')
  if (!organizationId) return
  openEditor('position')
  form.org_unit_id = organizationId
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
        emitToast(error instanceof IamError ? error.message : (error?.message || '删除组织失败。'))
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
        emitToast(error instanceof IamError ? error.message : (error?.message || '删除岗位失败。'))
      } finally {
        deletingPositionId.value = ''
        closeConfirm()
      }
    },
  })
}

// ---- 新增（对接真实 API）----
const editor = ref(null) // { kind, label }
const form = reactive({})
const saving = ref(false)
const initialPasswordVisible = ref(false)

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
  initialPasswordVisible.value = false
  Object.assign(form, editorTemplates[kind]())
  editor.value = { kind, label: editorLabels[kind] }

  if (['account', 'membership'].includes(kind) && !users.value.length) loadUsers()
  if (kind === 'position' && !organizations.value.length) loadOrganizations()
  if (kind === 'membership') {
    const referenceLoads = []
    if (!organizations.value.length) referenceLoads.push(loadOrganizations())
    if (!positions.value.length) referenceLoads.push(loadPositions())
    selectDefaultMembershipOrganization()
    if (referenceLoads.length) Promise.all(referenceLoads).then(selectDefaultMembershipOrganization)
  }
}

function openEditorForActivePanel() {
  const kind = panelToKind[activePanel.value]
  if (kind) openEditor(kind)
}

function openEmployeeOnboarding() {
  // EmployeeOnboardingModal 由平台视图统一持有，IAM 只发出工作流意图，避免在此处
  // 再实现一套非原子的“先建用户、再补账号和任职”流程。
  emit('employee-onboarding')
}

// 批量导入只创建用户档案（不创建账号 / 任职），因此只需刷新 users 列表。
async function refreshAfterBatchImport() {
  await loadUsers()
}

function closeEditor() {
  editor.value = null
  initialPasswordVisible.value = false
  saving.value = false
}

function defaultAccountValidUntil() {
  const date = new Date(Date.now() + 24 * 60 * 60 * 1000)
  const localOffset = date.getTimezoneOffset() * 60 * 1000
  return new Date(date.getTime() - localOffset).toISOString().slice(0, 16)
}

function resolveExpiresAt(value) {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function optionalText(value) {
  const normalized = String(value ?? '').trim()
  return normalized || null
}

function validateUserInput({ displayName, email, mobile, status }, rowLabel = '') {
  const prefix = rowLabel ? `${rowLabel}：` : ''
  const normalizedName = String(displayName ?? '').trim()
  if (!normalizedName) throw new IamError(`${prefix}请填写用户姓名。`)
  if (Array.from(normalizedName).length > 100) throw new IamError(`${prefix}用户姓名不能超过 100 个字符。`)

  const normalizedEmail = optionalText(email)
  if (normalizedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    throw new IamError(`${prefix}邮箱格式不正确。`)
  }

  const normalizedMobile = optionalText(mobile)
  if (normalizedMobile) {
    if (Array.from(normalizedMobile).length > 32) throw new IamError(`${prefix}手机号不能超过 32 个字符。`)
    const compactMobile = normalizedMobile.replace(/[\s-]/g, '')
    if (!/^\+?\d+$/.test(compactMobile)) throw new IamError(`${prefix}手机号只能包含数字、空格、连字符或开头的加号。`)
  }

  return {
    displayName: normalizedName,
    email: normalizedEmail,
    mobile: normalizedMobile,
    status: status || 'ACTIVE',
  }
}

function parseBatchUserRows(value, status) {
  const rows = String(value ?? '')
    .split(/\r?\n/)
    .map((row) => row.trim())
    .filter(Boolean)
  if (!rows.length) throw new IamError('请至少填写一行用户数据。')
  if (rows.length > 100) throw new IamError('一次最多批量创建 100 位用户。')

  return rows.map((row, index) => {
    const columns = row.split(/[,，]/).map((column) => column.trim())
    if (columns.length > 3) throw new IamError(`第 ${index + 1} 行：字段过多，请使用“姓名,邮箱,手机号”格式。`)
    return validateUserInput({
      displayName: columns[0],
      email: columns[1],
      mobile: columns[2],
      status,
    }, `第 ${index + 1} 行`)
  })
}

function validateLocalAccountInput(accountName, password) {
  const normalizedAccountName = String(accountName ?? '').trim()
  const accountLength = Array.from(normalizedAccountName).length
  if (accountLength < 3 || accountLength > 64) throw new IamError('账号名长度必须为 3–64 个字符。')
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(normalizedAccountName)) {
    throw new IamError('账号名必须以字母或数字开头，且只能包含字母、数字、点、下划线和连字符。')
  }

  const normalizedPassword = String(password ?? '')
  const passwordLength = Array.from(normalizedPassword).length
  if (passwordLength < 8 || passwordLength > 128) throw new IamError('初始密码长度必须为 8–128 个字符。')
  if (/\s/.test(normalizedPassword)) throw new IamError('初始密码不能包含空白字符。')
  if (!/[A-Z]/.test(normalizedPassword) || !/[a-z]/.test(normalizedPassword) || !/\d/.test(normalizedPassword) || !/[^A-Za-z0-9]/.test(normalizedPassword)) {
    throw new IamError('初始密码必须同时包含大写字母、小写字母、数字和特殊字符。')
  }
  return { accountName: normalizedAccountName, password: normalizedPassword }
}

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
        throw new IamError(`用户已创建，但登录账号创建失败：${accountError?.message || '请在“登录账号”页面补建账号。'}`, { status: accountError?.status, code: accountError?.code })
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
      await Promise.all([loadOrganizations(), loadPositions(), loadMemberships()])
    } else if (kind === 'position') {
      if (!form.org_unit_id || !form.name) throw new IamError('请选择组织并填写岗位名称。')
      result = await createPosition({
        orgUnitId: form.org_unit_id,
        name: String(form.name).trim(),
      })
      successMessage = `岗位 ${result?.name || form.name} 已创建，编码 ${result?.code || '已由系统生成'}。`
      await loadPositions()
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
      await loadMemberships()
    } else {
      throw new IamError('未实现的编辑类型。')
    }
    emitToast(successMessage)
    closeEditor()
  } catch (error) {
    if (kind === 'membership' && error instanceof IamError && error.status === 404) {
      emitToast('所选用户、组织或岗位已失效，或者岗位不属于所选组织。请刷新数据后重新选择。')
    } else {
      emitToast(error instanceof IamError || error instanceof AuthorizationError ? error.message : (error?.message || '保存失败。'))
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
    closeDetail()
  } else if (editor.value && !saving.value) {
    closeEditor()
  }
}

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
            <button v-if="activePanel === 'users' && hasPermission(IAM_PERMISSIONS.userCreate)" class="console-button primary small" type="button" @click="openEmployeeOnboarding"><ConsoleIcon name="user" />新增员工</button>
            <button v-else-if="panelToKind[activePanel] && hasPermission(panelCreatePermission(activePanel))" class="console-button primary small" type="button" :disabled="!panelToKind[activePanel]" @click="openEditorForActivePanel"><ConsoleIcon name="plus" />{{ activePanel === 'accounts' ? '补建登录账号' : `新增${editorLabels[panelToKind[activePanel]] || ''}` }}</button>
          </div>
        </header>

        <p v-if="activePanel === 'users'" class="iam-panel-policy-note"><ConsoleIcon name="info" /><span><strong>用户与人员一一对应：</strong>“新增员工”必须同时建立任职关系；用户列表只展示已具备任职关系的人员。登录账号仍可单独补建。</span></p>
        <p v-else-if="activePanel === 'accounts'" class="iam-panel-policy-note"><ConsoleIcon name="info" /><span><strong>账号只负责认证：</strong>不提供账号级角色授权入口；新增员工请使用统一流程，“补建登录账号”仅用于修复缺失凭证，已有账号可在此维护状态、密码与有效期。</span></p>
        <p v-else-if="activePanel === 'organizations'" class="iam-panel-policy-note"><ConsoleIcon name="info" /><span><strong>组织只表达人员归属：</strong>应用角色请配置到岗位授权模板。组织详情仅展示并允许清理历史直绑，不允许新增或修改。</span></p>
        <p v-else-if="activePanel === 'positions'" class="iam-panel-policy-note"><ConsoleIcon name="info" /><span><strong>岗位表达职责：</strong>岗位与应用角色的标准映射统一在“岗位授权模板”维护。岗位详情仅用于清理历史直绑。</span></p>
        <p v-else-if="activePanel === 'memberships'" class="iam-panel-policy-note"><ConsoleIcon name="info" /><span><strong>任职连接人员与职责：</strong>开启“参与岗位授权继承”后，用户会动态获得该岗位授权模板中的标准角色。</span></p>

        <section v-if="activePanel === 'users' && canReadActivePanel" class="iam-table-section">
          <div class="iam-filter-row"><label class="console-search-field"><ConsoleIcon name="search" /><input v-model="panelFilters.users" type="search" placeholder="姓名 / 工号 / 邮箱 / 状态" /></label><span>{{ filteredUsers.length }} / 共 {{ pagination.users.total }} 位用户</span></div>
          <div class="console-table-card iam-user-table-card"><div class="console-table-scroll"><table class="console-data-table iam-data-table iam-user-table">
            <thead><tr><th>用户</th><th>工号</th><th>邮箱</th><th>手机号</th><th>状态</th><th>更新时间</th><th class="console-actions-cell">操作</th></tr></thead><tbody>
            <tr v-if="loading.users"><td class="console-empty" colspan="7">正在读取用户…</td></tr>
            <tr v-else-if="!filteredUsers.length"><td class="console-empty" colspan="7">暂无用户记录。</td></tr>
            <tr v-for="item in filteredUsers" :key="item.user_id"><td data-label="用户"><strong class="console-entity-name iam-table-truncate" :title="item.display_name || ''">{{ item.display_name }}</strong></td><td data-label="工号" class="console-mono iam-user-employee-cell"><span class="iam-table-truncate" :title="item.employee_no || ''">{{ item.employee_no || '—' }}</span></td><td data-label="邮箱" class="iam-user-email-cell"><span class="iam-table-truncate" :title="item.email || ''">{{ item.email || '—' }}</span></td><td data-label="手机号" class="console-mono iam-user-mobile-cell"><span class="iam-table-truncate" :title="item.mobile_masked || ''">{{ item.mobile_masked || '—' }}</span></td><td data-label="状态"><span class="console-badge" :class="(item.status || '').toUpperCase() === 'ACTIVE' ? 'status-active' : 'status-disabled'">{{ displayStatus(item.status) }}</span></td><td data-label="更新时间" class="console-mono iam-user-updated-cell"><span class="iam-table-truncate" :title="formatDateTime(item.updated_at)">{{ formatDateTime(item.updated_at) }}</span></td><td data-label="操作" class="console-actions-cell"><button class="console-text-button" type="button" @click="openDetail('user', item)">详情</button><button v-if="hasPermission(IAM_PERMISSIONS.userDelete)" class="console-text-button danger" type="button" @click="openUserDeletionDialog(item)">删除</button></td></tr>
          </tbody></table></div></div>
        </section>

        <section v-else-if="activePanel === 'accounts' && canReadActivePanel" class="iam-table-section iam-accounts-panel">
          <div class="iam-filter-row iam-account-filter-row"><label class="console-search-field"><ConsoleIcon name="search" /><input v-model="panelFilters.accounts" type="search" placeholder="搜索账号、用户 ID 或状态" /></label><span>{{ filteredAccounts.length }} / 共 {{ pagination.accounts.total }} 个账号</span></div>
          <div class="console-table-card iam-account-table-card"><div class="console-table-scroll"><table class="console-data-table iam-data-table iam-account-table">
            <thead><tr><th>登录账号</th><th>关联用户</th><th>认证方式</th><th>有效时间</th><th>状态</th><th>更新时间</th><th class="console-actions-cell">操作</th></tr></thead><tbody>
            <tr v-if="loading.accounts"><td class="console-empty" data-empty="true" colspan="7">正在读取登录账号…</td></tr>
            <tr v-else-if="!filteredAccounts.length"><td class="console-empty" colspan="7">暂无登录账号记录。新增员工请使用统一流程；如用户档案已存在，可点击右上角“补建登录账号”。</td></tr>
            <tr v-for="item in filteredAccounts" :key="item.account_id"><td data-label="登录账号"><div class="iam-account-identity"><span class="iam-account-avatar">{{ (item.account_name || '?').slice(0, 1).toUpperCase() }}</span><span><strong :title="item.account_name || ''">{{ item.account_name }}</strong></span></div></td><td data-label="关联用户"><span class="iam-linked-user" :title="`${item.user?.display_name || item.user?.name || '—'}${item.user_id ? `（${item.user_id}）` : ''}`"><ConsoleIcon name="user" /><span class="iam-linked-user-name">{{ item.user?.display_name || item.user?.name || '—' }}</span></span></td><td data-label="认证方式"><div class="iam-auth-tags"><span class="iam-type-tag">{{ displayLoginAccountType(item).split(' / ')[0] }}</span><span class="iam-source-tag">{{ displayLoginAccountType(item).split(' / ')[1] }}</span><span v-if="item.password_initialized === false" class="iam-source-tag">待初始化密码</span></div></td><td data-label="有效时间"><div class="iam-validity"><span class="iam-validity-chip" :class="item.valid_until ? 'is-temporary' : 'is-permanent'">{{ item.valid_until ? '临时账号' : '永久账号' }}</span><small>{{ item.valid_until ? formatDateTime(item.valid_until) : '长期有效' }}</small></div></td><td data-label="状态"><span class="console-badge" :class="(item.status || '').toUpperCase() === 'ACTIVE' ? 'status-active' : 'status-disabled'">{{ displayStatus(item.status) }}</span></td><td data-label="更新时间" class="console-mono iam-account-updated">{{ formatDateTime(item.updated_at) }}</td><td data-label="操作" class="console-actions-cell iam-account-actions"><button class="console-text-button" type="button" @click="openDetail('account', item)">详情</button><button v-if="isAccountStatusManageable(item.status) && hasPermission(IAM_PERMISSIONS.accountUpdate)" class="console-text-button" :class="{ danger: (item.status || '').toUpperCase() === 'ACTIVE' }" type="button" :disabled="updatingAccountId === item.account_id" @click="toggleAccountStatus(item)">{{ updatingAccountId === item.account_id ? '处理中…' : ((item.status || '').toUpperCase() === 'ACTIVE' ? '停用' : '启用') }}</button><button v-if="hasPermission(IAM_PERMISSIONS.accountPasswordReset)" class="console-text-button danger" type="button" @click="openPasswordResetForAccount(item)">{{ item.password_initialized === false ? '初始化密码' : '重置密码' }}</button></td></tr>
          </tbody></table></div></div>
        </section>

        <section v-else-if="activePanel === 'organizations' && canReadActivePanel" class="iam-table-section iam-organizations-panel">
          <div class="iam-filter-row"><label class="console-search-field"><ConsoleIcon name="search" /><input v-model="panelFilters.organizations" type="search" placeholder="搜索组织名称或编码" /></label><span>{{ filteredOrganizations.length }} / 共 {{ pagination.organizations.total }} 个组织</span></div>
          <p v-if="pagination.organizations.serverPagingSupported === false" class="iam-server-limit-note">未能读取全部组织数据，当前树可能不完整。请检查组织列表接口是否能继续翻页。</p>
          <OrgUnitTree
            :organizations="organizations"
            :keyword="panelFilters.organizations"
            :loading="loading.organizations"
            :can-create="hasPermission(IAM_PERMISSIONS.organizationCreate)"
            :can-update="hasPermission(IAM_PERMISSIONS.organizationUpdate)"
            :can-delete="hasPermission(IAM_PERMISSIONS.organizationDelete)"
            :deleting-id="deletingOrganizationId"
            @copy-id="(item) => copyText(item.org_unit_id || item.id, { success: '组织 ID 已复制' })"
            @create-child="openChildOrganizationEditor"
            @detail="(item) => openDetail('organization', item)"
            @edit="openOrganizationEditor"
            @remove="removeOrganization"
          />
        </section>

        <section v-else-if="activePanel === 'positions' && canReadActivePanel" class="iam-table-section iam-positions-panel">
          <div class="iam-filter-row"><label class="console-search-field"><ConsoleIcon name="search" /><input v-model="panelFilters.positions" type="search" placeholder="搜索岗位名称、编码或所属组织" /></label><span>{{ filteredPositions.length }} / 共 {{ pagination.positions.total }} 个岗位</span></div>
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
          <div class="iam-filter-row"><label class="console-search-field"><ConsoleIcon name="search" /><input v-model="panelFilters.memberships" type="search" placeholder="搜索用户、组织或岗位" /></label><span>{{ filteredMemberships.length }} / 共 {{ pagination.memberships.total }} 条任职关系</span></div>
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
        </div>
        <div class="iam-detail-grid">
          <template v-for="row in detailRows(detail)" :key="row.label">
            <div><span>{{ row.label }}</span><strong>{{ row.value }}</strong></div>
          </template>
        </div>
        <section v-if="isUserAuthorizationSubject && canReadApplicationAuthorization" class="iam-detail-section iam-effective-authorization-overview">
          <div class="iam-detail-section-head">
            <div>
              <h4>有效授权总览</h4>
              <p>汇总该用户在所有已接入应用中的角色来源：个人例外、组织继承、岗位模板继承，以及只读的系统来源。最终入口授权以“合并去重后的角色”为准；冲突时相关应用会拒绝入口授权，请先处理冲突来源。</p>
            </div>
            <div class="iam-application-access-badges">
              <span class="iam-application-badge">合并 {{ userAuthorizationPreviewMerged.length }} 个角色</span>
              <span class="iam-application-badge">个人例外 {{ userAuthorizationPreviewBySource.USER.length }}</span>
              <span class="iam-application-badge">组织 {{ userAuthorizationPreviewBySource.ORG_UNIT.length }}</span>
              <span class="iam-application-badge">岗位 {{ userAuthorizationPreviewBySource.POSITION.length }}</span>
              <span v-if="hasUserAuthorizationPreviewConflict" class="iam-application-badge is-conflict">授权冲突 · {{ userAuthorizationPreviewConflicts.length }} 项</span>
            </div>
          </div>
          <p v-if="userAuthorizationPreviewLoading" class="iam-empty-inline">正在汇总该用户的有效授权…</p>
          <template v-else-if="userAuthorizationPreviewUnavailable">
            <p class="iam-empty-inline">当前无法读取该用户的应用授权总览；不影响下方个人例外授权的查看与维护，请稍后重试。</p>
          </template>
          <template v-else>
            <p v-if="userAuthorizationPreviewErrorCount" class="iam-field-help">有 {{ userAuthorizationPreviewErrorCount }} 个应用暂时读取失败，以下仅展示其余应用的有效授权。</p>
            <p v-if="hasUserAuthorizationPreviewConflict" class="login-target-module__error" role="alert">
              检测到 {{ userAuthorizationPreviewConflicts.length }} 处授权冲突：{{ userAuthorizationPreviewConflicts.join('；') }}。相关应用会拒绝门户入口、OIDC 授权和权限并集；请清理重复或多余来源，直至符合各应用的角色数量策略。
            </p>
            <p v-if="!userAuthorizationPreviewRoles.length" class="iam-empty-inline">该用户当前在已接入应用中没有生效的个人例外、组织继承、岗位继承或系统角色。</p>
            <div v-else class="iam-effective-authorization-grid">
              <div v-for="source in userAuthorizationPreviewSources" :key="source.key" class="iam-effective-authorization-card">
                <div class="iam-effective-authorization-head">
                  <strong>{{ source.label }}</strong>
                  <span>{{ userAuthorizationPreviewBySource[source.key].length }} 个角色</span>
                </div>
                <p v-if="!userAuthorizationPreviewBySource[source.key].length" class="iam-empty-inline">该来源当前没有生效角色。</p>
                <ul v-else class="iam-effective-authorization-list">
                  <li v-for="(role, index) in userAuthorizationPreviewBySource[source.key]" :key="`${source.key}-${roleCode(role)}-${role.source_id || index}`">
                    <span class="iam-effective-authorization-app">{{ role.application_name || role.application_code || '—' }}</span>
                    <span class="iam-effective-authorization-role"><strong>{{ role.name || role.display_name || roleCode(role) || '未命名角色' }}</strong><code>{{ roleCode(role) }}</code></span>
                    <small v-if="role.source_name || role.source_id">来源：{{ role.source_name || role.source_id }}</small>
                  </li>
                </ul>
              </div>
            </div>
            <p class="iam-field-help">如需新增个人例外授权，请使用下方"{{ authorizationEntryLayerInfo.title }}"区域；不要把已由组织或岗位自动继承的角色重复写入个人层。</p>
          </template>
        </section>

        <section v-if="supportsApplicationAuthorization" class="iam-detail-section iam-application-access">
          <div class="iam-detail-section-head">
            <div>
              <h4>{{ isLegacyStructuralAuthorizationSubject ? `${authorizationSubjectLabel}历史直绑（只读清理）` : authorizationEntryLayerInfo.title }}</h4>
              <p v-if="isLegacyStructuralAuthorizationSubject">组织和岗位不再提供应用角色新增或修改入口。此处只读展示历史直绑；如仍有历史角色，可逐应用撤销清理。标准授权请转到“岗位授权模板”。</p>
              <p v-else>此处只处理标准岗位授权之外的个人补充角色。应用角色目录、默认权限和角色权限关系均由子系统维护并只读同步到基础平台。</p>
            </div>
            <div class="iam-application-access-badges">
              <span v-if="selectedApplication" class="iam-application-badge">{{ applicationDisplayName(selectedApplication) }} · {{ selectedApplication.code }}</span>
              <span v-if="authorizationCatalog" class="iam-application-badge">目录版本 {{ catalogVersion(authorizationCatalog) }}</span>
              <span v-if="authorizationCatalog" class="iam-application-badge" :class="{ 'is-warning': ['已过期', '同步失败', '状态未知'].includes(catalogSyncText) }">同步状态 {{ catalogSyncText }}</span>
              <span v-if="hasApplicationAuthorizationConflict" class="iam-application-badge is-conflict">授权冲突 · {{ applicationAuthorizationConflicts.length }} 个不同角色</span>
              <span v-else-if="hasEffectiveApplicationAccess" class="iam-application-badge">有效访问 · {{ applicationEffectiveRoles.length }} 个角色来源</span>
            </div>
          </div>
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
              <label><span>应用 *</span><select v-model="selectedApplicationCode" :disabled="applicationAccessLoading || applicationAccessSaving || applicationAccessRevoking" @change="loadApplicationAuthorization(selectedApplicationCode)"><option v-for="application in applications" :key="application.application_id || application.id || application.code" :value="application.code">{{ applicationDisplayName(application) }} · {{ application.code }}</option></select></label>
              <div class="iam-application-meta"><span>授权主体：<strong>{{ authorizationSubjectLabel }}</strong></span><span>应用编码：<code>{{ selectedApplication?.code || '—' }}</code></span><span>目录版本：<strong>{{ catalogVersion(authorizationCatalog) }}</strong></span><span>目录同步：<strong>{{ catalogSyncText }}</strong></span><span>{{ isLegacyStructuralAuthorizationSubject ? '目录角色' : '可分配角色' }}：<strong>{{ authorizationRoleOptions.length }} / {{ catalogRoleTotal }}</strong></span><span v-if="catalogLastSyncedAt">最近同步：<strong>{{ formatDateTime(catalogLastSyncedAt) }}</strong></span></div>
              <p v-if="authorizationCatalog && !hasSynchronizedAuthorizationCatalog" class="iam-empty-inline">角色目录当前为“{{ catalogSyncText }}”，为避免使用过期或不完整的应用角色，暂不允许新增或修改授权；请等待子系统重新同步目录。</p>
              <div v-if="isUserAuthorizationSubject" class="iam-application-scope-grid">
                <label><span>例外授权范围 *</span><select v-model="authorizationDraft.scope_type" :disabled="applicationAccessLoading || applicationAccessSaving || applicationAccessRevoking" @change="onAuthorizationScopeChange"><option value="APPLICATION">整个应用</option><option value="ENVIRONMENT" :disabled="!authorizationEnvironmentOptions.length">指定环境</option></select></label>
                <label v-if="authorizationDraft.scope_type === 'ENVIRONMENT'"><span>环境 *</span><select v-model="authorizationDraft.environment_code" :disabled="applicationEnvironmentsLoading || applicationAccessSaving || applicationAccessRevoking"><option value="">请选择环境</option><option v-for="environment in authorizationEnvironmentOptions" :key="environment.code" :value="environment.code">{{ environment.name }} · {{ environment.code }}</option></select><small v-if="applicationEnvironmentsLoading">正在读取环境…</small></label>
                <label><span>例外授权有效期 *</span><select v-model="authorizationDraft.validity_mode" :disabled="applicationAccessSaving || applicationAccessRevoking" @change="onAuthorizationValidityChange"><option value="PERMANENT">长期有效</option><option value="RANGE">指定有效期</option></select></label>
              </div>
              <div v-if="isUserAuthorizationSubject && authorizationDraft.validity_mode === 'RANGE'" class="iam-application-validity-grid"><label><span>生效时间</span><input v-model="authorizationDraft.valid_from" type="datetime-local" :disabled="applicationAccessSaving || applicationAccessRevoking" /></label><label><span>失效时间</span><input v-model="authorizationDraft.valid_until" type="datetime-local" :disabled="applicationAccessSaving || applicationAccessRevoking" /></label></div>
              <p v-if="isUserAuthorizationSubject && authorizationHasMixedRoleSettings" class="iam-field-help iam-application-scope-warning">当前勾选的角色包含不同的授权范围或有效期组合，<strong>保存已被阻断</strong>。请取消多余角色，或切换到“整个应用 + 长期有效”并重新勾选。</p>
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
                  <p v-if="catalogInactiveOrRestrictedRoleCount" class="iam-field-help">目录中另有 {{ catalogInactiveOrRestrictedRoleCount }} 个停用或不可分配角色，已从可选项中排除。</p>
                  <p v-if="!authorizationDraft.role_codes.length && !unavailableDirectRoles.length" class="iam-empty-inline">{{ authorizationEntryLayerInfo.empty }}</p>
                  <div class="iam-application-role-list"><label v-for="role in authorizationRoleOptions" :key="role.role_id || role.id || roleCode(role)" class="iam-application-role-option" :class="{ selected: authorizationDraft.role_codes.includes(roleCode(role)) }"><input v-model="authorizationDraft.role_codes" type="checkbox" :value="roleCode(role)" /><span class="iam-application-role-copy"><strong>{{ role.name || role.display_name || roleCode(role) }}</strong><code>{{ roleCode(role) }}</code><small v-if="role.description">{{ role.description }}</small><small class="iam-application-role-status">ACTIVE · {{ rolePermissionCodes(role).length }} 项默认权限</small><small class="iam-application-role-summary">来源：{{ authorizationEntryLayerInfo.title }} · 默认能力（子系统只读）：{{ roleDefaultPermissionSummary(role) }}</small></span></label></div>
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
        </section>
        <footer><button class="console-button ghost" type="button" :disabled="applicationAccessSaving || applicationAccessRevoking" @click="closeDetail">关闭</button><button v-if="supportsApplicationAuthorization && selectedApplicationCode && hasDirectApplicationAccess && canManageApplicationAuthorization" class="console-button danger" type="button" :disabled="applicationAccessSaving || applicationAccessRevoking" @click="revokeApplicationAccess">{{ applicationAccessRevoking ? '撤销中…' : (isLegacyStructuralAuthorizationSubject ? '清理历史直绑' : '撤销个人例外') }}</button><button v-if="isUserAuthorizationSubject && selectedApplicationCode && canManageApplicationAuthorization" class="console-button primary" type="button" :disabled="applicationsLoading || authorizationCatalogLoading || applicationAccessLoading || applicationAccessSaving || applicationAccessRevoking || !authorizationRoleOptions.length" @click="saveApplicationAccess"><ConsoleIcon name="save" />{{ applicationAccessSaving ? '保存中…' : '保存个人例外' }}</button></footer>
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
          <button :class="['console-button', confirmDialog.danger ? 'iam-danger-button' : 'primary']" type="button" :disabled="confirmDialog.busy" @click="async () => { if (confirmDialog.busy) return; confirmDialog.busy = true; try { await confirmDialog.onConfirm() } catch { /* 错误已由各 handler 自身处理 */ } finally { if (confirmDialog) confirmDialog.busy = false } }">{{ confirmDialog.confirmText }}</button>
        </footer>
      </section>
    </div>

    <BatchUserImportDialog
      v-if="batchImportVisible"
      :organizations="organizations"
      @close="batchImportVisible = false"
      @completed="refreshAfterBatchImport"
      @toast="emitToast"
    />

    <div v-if="editor" class="iam-modal-backdrop" role="presentation" @click.self="closeEditor">
      <section class="iam-modal iam-editor-modal" role="dialog" aria-modal="true" aria-label="新增身份授权配置">
        <header><div><p>{{ editor.mode === 'edit' ? '编辑' : '新增' }}</p><h3>{{ editor.mode === 'edit' ? '编辑' : '新增' }} {{ editor.label }}</h3></div><button class="console-modal-close" type="button" aria-label="关闭表单" :disabled="saving" @click="closeEditor"><ConsoleIcon name="close" /></button></header>
        <form class="iam-editor-form" @submit.prevent="saveEditor">
          <template v-if="editor.kind === 'user'">
            <p class="iam-form-alert"><ConsoleIcon name="info" />员工编号由后端自动生成；本次会同时创建该用户的本地登录账号。</p>
            <label><span>展示姓名 *</span><input v-model="form.display_name" required maxlength="100" placeholder="例如：张三" /></label>
            <label><span>邮箱</span><input v-model="form.email" type="email" placeholder="例如：zhang.san@example.com" /></label>
            <label><span>手机号</span><input v-model="form.mobile" maxlength="32" placeholder="例如：13800000000" /></label>
            <label><span>状态</span><select v-model="form.status"><option value="ACTIVE">启用</option><option value="DISABLED">停用</option></select></label>
            <label><span>登录账号 *</span><input v-model="form.account_name" required minlength="3" maxlength="64" placeholder="例如：zhang.san" /><small class="iam-field-help">账号必须唯一，以字母或数字开头。</small></label>
            <label><span>初始密码 *</span><div class="iam-password-field"><input v-model="form.initial_password" :type="initialPasswordVisible ? 'text' : 'password'" required minlength="8" maxlength="128" autocomplete="new-password" /><button type="button" :aria-label="initialPasswordVisible ? '隐藏密码' : '显示密码'" @click="initialPasswordVisible = !initialPasswordVisible"><ConsoleIcon :name="initialPasswordVisible ? 'eye-off' : 'eye'" /></button></div></label>
            <label><span>账号有效期 *</span><select v-model="form.validity_mode"><option value="TEMPORARY">临时（默认 1 天）</option><option value="PERMANENT">永久</option></select></label>
            <label v-if="form.validity_mode !== 'PERMANENT'"><span>有效截止时间 *</span><input v-model="form.valid_until" required type="datetime-local" /></label>
          </template>
          <template v-else-if="editor.kind === 'user-batch'">
            <p class="iam-form-alert"><ConsoleIcon name="info" />每行一位用户，格式为“姓名,邮箱,手机号”；邮箱和手机号可留空，一次最多 100 位。批量创建仅建立用户档案；登录账号请在“登录账号”中按需创建。</p>
            <label class="full"><span>用户数据 *</span><textarea v-model="form.rows" required rows="10" placeholder="张三,zhang.san@example.com,13800000000&#10;李四,,13900000000&#10;王五"></textarea></label>
            <label><span>统一状态</span><select v-model="form.status"><option value="ACTIVE">启用</option><option value="DISABLED">停用</option></select></label>
            <p class="iam-field-help full">员工编号由后端逐条自动生成，每位用户都会自动绑定“普通用户”角色。</p>
          </template>
          <template v-else-if="editor.kind === 'account'">
            <div class="iam-account-editor-intro full">
              <span><ConsoleIcon name="account" /></span>
              <div><strong>创建本地登录账号</strong><p>账号将关联到一位平台用户。初始密码仅用于首次登录，请通过安全渠道交付。</p></div>
              <small>01 / 03</small>
            </div>
            <label class="iam-account-field"><span>账号 *</span><input v-model="form.account_name" required minlength="3" maxlength="64" placeholder="例如：zhang.san" /><small class="iam-field-help">3–64 个字符，以字母或数字开头，仅可使用字母、数字、点、下划线和连字符。</small></label>
            <label class="iam-account-field"><span>关联用户 *</span>
              <select v-model="form.user_id" required>
                <option value="">请选择用户</option>
                <option v-for="item in users" :key="item.user_id" :value="item.user_id">{{ item.display_name }}（{{ item.employee_no || item.user_id }}）</option>
              </select>
              <small class="iam-field-help">一个账号只关联一位用户，避免使用名称进行关联。</small>
            </label>
            <label class="iam-account-field"><span>账号类型</span><input value="个人账号 / 本地密码" disabled /><small class="iam-field-help">当前新增接口创建个人本地账号，使用账号名和密码登录。</small></label>
            <label class="iam-account-field"><span>初始密码 *</span><div class="iam-password-field"><input id="initial-password" v-model="form.initial_password" required minlength="8" maxlength="128" :type="initialPasswordVisible ? 'text' : 'password'" autocomplete="new-password" placeholder="请妥善记录，将仅返回一次" /><button class="iam-password-toggle" type="button" :aria-label="initialPasswordVisible ? '隐藏初始密码' : '显示初始密码'" :title="initialPasswordVisible ? '隐藏密码' : '显示密码'" @click="initialPasswordVisible = !initialPasswordVisible"><svg v-if="!initialPasswordVisible" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5c-5 0-9.3 3-11 7 1.7 4 6 7 11 7s9.3-3 11-7c-1.7-4-6-7-11-7Zm0 12c-3.8 0-7.2-2-8.8-5C4.8 9 8.2 7 12 7s7.2 2 8.8 5c-1.6 3-5 5-8.8 5Zm0-8a3 3 0 1 0 0 6 3 3 0 0 0 0-6Zm0 4a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z" /></svg><svg v-else viewBox="0 0 24 24" aria-hidden="true"><path d="m3.3 2-1.4 1.4 3 3A12.7 12.7 0 0 0 1 12c1.7 4 6 7 11 7 1.8 0 3.5-.4 5-1l3.6 3.6 1.4-1.4L3.3 2ZM12 17c-3.8 0-7.2-2-8.8-5 .8-1.5 1.9-2.7 3.2-3.5l2.1 2.1A3.5 3.5 0 0 0 13.4 15l2 2c-1 .3-2.2.5-3.4.5V17Zm-1.6-4.5 2.1 2.1a1.6 1.6 0 0 1-2.1-2.1ZM12 7c3.8 0 7.2 2 8.8 5a9.5 9.5 0 0 1-2.1 2.8l1.4 1.4A12 12 0 0 0 23 12c-1.7-4-7-7-11-7-.8 0-1.6.1-2.4.2l1.7 1.7.7.1Zm.9 2.1 3 3a4 4 0 0 0-3-3Z" /></svg></button></div><small class="iam-field-help">8–128 个字符，不含空白，并同时包含大写字母、小写字母、数字和特殊字符。</small></label>
            <div class="iam-validity-picker full"><span>有效时间 *</span><div class="iam-validity-options" role="radiogroup" aria-label="账号有效时间"><button type="button" :class="{ active: form.validity_mode === 'TEMPORARY' }" role="radio" :aria-checked="form.validity_mode === 'TEMPORARY'" @click="form.validity_mode = 'TEMPORARY'"><strong>临时账号</strong><small>默认有效 1 天，可自定义截止时间</small></button><button type="button" :class="{ active: form.validity_mode === 'PERMANENT' }" role="radio" :aria-checked="form.validity_mode === 'PERMANENT'" @click="form.validity_mode = 'PERMANENT'"><strong>永久账号</strong><small>长期有效，仍可随时停用</small></button></div></div>
            <label v-if="form.validity_mode === 'TEMPORARY'" class="full iam-account-expiry-field"><span>有效截止时间 *</span><input v-model="form.valid_until" type="datetime-local" required /><small class="iam-field-help">到期后，账号将无法继续登录；请选择晚于当前时间的日期和时间。</small></label>
          </template>
          <template v-else-if="editor.kind === 'organization'">
            <label><span>组织名称 *</span><input v-model="form.name" required /></label>
            <label><span>组织编码</span><input value="提交后由系统自动生成" disabled /><small class="iam-field-help">编码由后端统一生成，创建后可在组织列表和详情中查看。</small></label>
            <label><span>上级组织（留空为根）</span><select v-model="form.parent_id"><option value="">无（根组织）</option><option v-for="item in organizationParentOptions" :key="item.org_unit_id" :value="item.org_unit_id">{{ item.name }} · {{ item.code }}</option></select><small class="iam-field-help">编辑时不会显示当前组织及其下级，避免形成循环层级。</small></label>
            <label><span>显示顺序</span><input v-model.number="form.sort_order" type="number" min="0" step="10" /><small class="iam-field-help">数字越小，在同一上级组织下越靠前；建议使用 10、20、30，便于后续插入。</small></label>
          </template>
          <template v-else-if="editor.kind === 'position'">
            <label><span>所属组织 *</span><select v-model="form.org_unit_id" required><option value="">请选择组织</option><option v-for="item in organizations" :key="item.org_unit_id" :value="item.org_unit_id">{{ item.name }} · {{ item.code }}</option></select></label>
            <label><span>岗位编码</span><input value="提交后由系统自动生成" disabled /><small class="iam-field-help">编码由后端统一生成，格式为 POS-&lt;ULID&gt;，创建后可在岗位列表和详情中查看。</small></label>
            <label><span>岗位名称 *</span><input v-model="form.name" required placeholder="例如：研发经理" /></label>
          </template>
          <template v-else-if="editor.kind === 'membership'">
            <label><span>用户 *</span><select v-model="form.user_id" required><option value="">请选择用户</option><option v-for="item in users" :key="item.user_id" :value="item.user_id">{{ item.display_name }} · {{ item.employee_no || item.user_id }}</option></select></label>
            <label><span>组织 *</span><select v-model="form.org_unit_id" required><option value="">请选择组织</option><option v-for="item in membershipOrganizations" :key="item.org_unit_id || item.id" :value="item.org_unit_id || item.id">{{ item.name }} · {{ item.position_count }} 个岗位</option></select><small class="iam-field-help">系统会默认选择一个已有岗位的组织；切换组织后只能选择该组织下的岗位。</small></label>
            <label><span>岗位 *</span><select v-model="form.position_id" :disabled="!form.org_unit_id || !membershipPositions.length" required><option value="">{{ !form.org_unit_id ? '请先选择组织' : (membershipPositions.length ? '请选择岗位' : '当前组织暂无岗位') }}</option><option v-for="item in membershipPositions" :key="item.position_id || item.id" :value="item.position_id || item.id">{{ item.name }}</option></select><small v-if="form.org_unit_id && !membershipPositions.length" class="iam-field-help">当前组织下暂无可用岗位，请先在“岗位”页面为该组织新增岗位。</small></label>
            <label><span>任职类型 *</span><select v-model="form.membership_type"><option value="PRIMARY">主组织</option><option value="SECONDARY">次组织 / 兼岗</option></select></label>
            <label><span>生效方式 *</span><select v-model="form.validity_mode"><option value="LONG_TERM">长期生效</option><option value="SHORT_TERM">短期生效</option></select><small class="iam-field-help">长期任职不设置日期；短期任职必须填写完整起止日期。</small></label>
            <label v-if="form.validity_mode === 'SHORT_TERM'"><span>生效日期 *</span><input v-model="form.effective_from" required type="date" /></label>
            <label v-if="form.validity_mode === 'SHORT_TERM'"><span>失效日期 *</span><input v-model="form.effective_to" required type="date" /></label>
            <label class="full iam-checkbox-field"><input v-model="form.inherit_authorization" type="checkbox" /><span>参与岗位授权继承</span><small class="iam-field-help">这是标准授权开关：开启后，该任职会动态继承岗位授权模板映射的应用角色；关闭不会影响用户详情中单独配置的个人例外。</small></label>
          </template>
          <p class="iam-form-alert"><ConsoleIcon name="info" />提交后由 Go API 写入 MySQL，并生成审计事件。</p>
          <footer>
            <button class="console-button ghost" type="button" :disabled="saving" @click="closeEditor">取消</button>
            <button class="console-button primary" type="submit" :disabled="saving"><ConsoleIcon name="save" />{{ saving ? '保存中…' : '保存' }}</button>
          </footer>
        </form>
      </section>
    </div>
  </section>
</template>
