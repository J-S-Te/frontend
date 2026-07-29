<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue'
import ConsoleIcon from '@/modules/platform/shared/components/ConsoleIcon.vue'
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
  getApplicationAccess,
  getApplicationAuthorizationCatalog,
  getContractApplicationAccess,
  updateApplicationAccess,
  updateContractApplicationAccess,
} from '@/modules/platform/iam/api/authorization'
import '@/modules/platform/iam/styles/iam-settings.css'

const emit = defineEmits(['toast'])

const activePanel = ref('users')
const detail = ref(null)
const loading = reactive({ users: false, accounts: false, organizations: false, positions: false, memberships: false })
const errorMessage = ref('')
const pageSize = 50
const pagination = reactive({
  users: { page: 1, pageSize, total: 0 },
  accounts: { page: 1, pageSize, total: 0 },
  organizations: { page: 1, pageSize, total: 0, serverPagingSupported: true },
  positions: { page: 1, pageSize, total: 0, serverPagingSupported: true },
  memberships: { page: 1, pageSize, total: 0 },
})
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
const updatingAccountId = ref('')
const applications = ref([])
const applicationsLoading = ref(false)
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
const authorizationUsingLegacyEndpoint = ref(false)
const authorizationDraft = reactive({
  role_codes: [],
  scope_type: 'APPLICATION',
  environment_code: '',
  validity_mode: 'PERMANENT',
  valid_from: '',
  valid_until: '',
})

const selectedApplication = computed(() => applications.value.find((item) => item.code === selectedApplicationCode.value) || null)
const authorizationRoleOptions = computed(() => Array.isArray(authorizationCatalog.value?.roles) ? authorizationCatalog.value.roles : [])
const selectedAuthorizationRoles = computed(() => authorizationRoleOptions.value.filter((role) => authorizationDraft.role_codes.includes(role.code)))
const authorizationEffectivePermissions = computed(() => {
  const rolePermissions = selectedAuthorizationRoles.value.flatMap((role) => rolePermissionsFor(role))
  const attachedPermissions = applicationAccess.value?.custom_permissions
    || applicationAccess.value?.additional_permissions
    || applicationAccess.value?.user_permissions
    || []
  return uniqueValues([...rolePermissions, ...attachedPermissions].map((item) => permissionCode(item)))
})

const panels = [
  { key: 'users', label: '用户', icon: 'user', description: '自然人主体、任职状态与跨系统统一用户标识' },
  { key: 'accounts', label: '登录账号', icon: 'account', description: '账号状态、密码与有效期统一管理' },
  { key: 'organizations', label: '组织单元', icon: 'organization', description: '组织单元层级、编码与排序' },
  { key: 'positions', label: '岗位', icon: 'organization', description: '组织内岗位定义，是任职关系和岗位授权的基础' },
  { key: 'memberships', label: '任职关系', icon: 'link', description: 'Membership 任职关系：主组织、兼岗、历史任职' },
]

const filters = reactive({ user: '', account: '', organization: '', position: '', membership: '' })

const panel = computed(() => panels.find((item) => item.key === activePanel.value) || panels[0])

const metrics = computed(() => [
  { label: '有效用户', value: pagination.users.total, note: '服务端分页总数 /api/v1/users', icon: 'user', tone: 'blue' },
  { label: '登录账号', value: pagination.accounts.total, note: '服务端分页总数（含未删除用户的停用账号）/api/v1/accounts', icon: 'account', tone: 'violet' },
  { label: '有效组织', value: pagination.organizations.total, note: '服务端分页总数 /api/v1/org-units', icon: 'organization', tone: 'green' },
  { label: '任职关系', value: pagination.memberships.total, note: '服务端分页总数 /api/v1/memberships', icon: 'link', tone: 'orange' },
])

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

const filteredUsers = computed(() => includesFilter(users.value, filters.user, ['display_name', 'employee_no', 'email', 'status']))
const filteredAccounts = computed(() => includesFilter(accounts.value, filters.account, ['account_name', 'user_id', 'status']))
const filteredOrganizations = computed(() => includesFilter(organizations.value, filters.organization, ['code', 'name']))
const filteredPositions = computed(() => includesFilter(
  positions.value.map((item) => ({ ...item, organization_name: positionOrganizationName(item) })),
  filters.position,
  ['code', 'name', 'organization_name'],
))
const filteredMemberships = computed(() => includesFilter(memberships.value, filters.membership, ['user.name', 'org_unit.name', 'position.name', 'membership_type']))

// 岗位列表仅展示名称和所属组织；岗位编码与内部主键仅用于筛选、接口调用和 Vue 行标识。
function positionOrganizationName(position) {
  if (position?.org_unit?.name) return position.org_unit.name
  const organizationId = positionOrgUnitId(position)
  if (!organizationId) return '—'
  return organizations.value.find((item) => (item.org_unit_id || item.id) === organizationId)?.name || '—'
}

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
  const permissions = role?.permissions || role?.permission_codes || role?.permissionCodes || []
  return Array.isArray(permissions) ? permissions : []
}

function rolePermissionCodes(role) {
  return uniqueValues(rolePermissionsFor(role).map((permission) => permissionCode(permission)))
}

function applicationDisplayName(application) {
  return application?.name || application?.display_name || application?.code || '未命名应用'
}

function catalogVersion(catalog) {
  return catalog?.catalog_version || catalog?.version || catalog?.metadata?.catalog_version || '—'
}

function resetApplicationAuthorizationState() {
  authorizationCatalog.value = null
  applicationAccess.value = null
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
  authorizationUsingLegacyEndpoint.value = false
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

const authorizationHasMixedRoleSettings = computed(() => {
  const roles = Array.isArray(applicationAccess.value?.roles) ? applicationAccess.value.roles : []
  return new Set(roles.map(roleAuthorizationSignature)).size > 1
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
  resetApplicationAuthorizationState()
  detail.value = { kind, item }
  if (kind === 'user') await loadApplicationsForUser(item.user_id)
}

function closeDetail() {
  detail.value = null
  resetApplicationAuthorizationState()
}

function applyApplicationAccess(access) {
  applicationAccess.value = access || null
  const roles = Array.isArray(access?.roles)
    ? access.roles
    : (access?.role ? [access.role] : [])
  authorizationDraft.role_codes = uniqueValues(roles.map((role) => typeof role === 'string' ? role : role?.code || role?.role_code))
  applyAuthorizationSettings(roles)
}

function applyLegacyApplicationAccess(access) {
  authorizationUsingLegacyEndpoint.value = true
  applyApplicationAccess(access)
}

async function loadApplicationsForUser(userId) {
  if (!userId || applicationsLoading.value) return
  applicationsLoading.value = true
  applicationAccessError.value = ''
  try {
    const data = await listApplications({ page: 1, pageSize: 100, status: 'ACTIVE' })
    applications.value = Array.isArray(data) ? data : (data?.items || [])
    const preferredCode = selectedApplicationCode.value && applications.value.some((item) => item.code === selectedApplicationCode.value)
      ? selectedApplicationCode.value
      : applications.value[0]?.code || ''
    selectedApplicationCode.value = preferredCode
    if (preferredCode) await loadApplicationAuthorization(userId, preferredCode)
  } catch (error) {
    applications.value = []
    applicationAccessError.value = error?.message || '读取应用列表失败。'
  } finally {
    applicationsLoading.value = false
  }
}

async function loadApplicationAuthorization(userId, applicationCode = selectedApplicationCode.value) {
  if (!userId || !applicationCode || applicationAccessLoading.value) return
  const application = applications.value.find((item) => item.code === applicationCode)
  if (!application) return
  selectedApplicationCode.value = applicationCode
  authorizationCatalog.value = null
  applicationAccess.value = null
  authorizationDraft.role_codes = []
  authorizationDraft.scope_type = 'APPLICATION'
  authorizationDraft.environment_code = ''
  authorizationDraft.validity_mode = 'PERMANENT'
  authorizationDraft.valid_from = ''
  authorizationDraft.valid_until = ''
  applicationEnvironments.value = []
  authorizationUsingLegacyEndpoint.value = false
  applicationAccessError.value = ''
  authorizationCatalogLoading.value = true
  applicationAccessLoading.value = true
  try {
    applicationEnvironmentsLoading.value = true
    try {
      const environmentData = await listEnvironments({ applicationId: application.application_id || application.id, page: 1, pageSize: 100, status: 'ACTIVE' })
      applicationEnvironments.value = Array.isArray(environmentData) ? environmentData : (environmentData?.items || [])
    } catch (error) {
      applicationEnvironments.value = []
      applicationAccessError.value = error?.message || '读取应用环境失败。'
    } finally {
      applicationEnvironmentsLoading.value = false
    }

    try {
      authorizationCatalog.value = await getApplicationAuthorizationCatalog(application.application_id || application.id)
    } catch (error) {
      applicationAccessError.value = error instanceof AuthorizationError ? error.message : (error?.message || '读取应用角色目录失败。')
    } finally {
      authorizationCatalogLoading.value = false
    }

    try {
      applyApplicationAccess(await getApplicationAccess(userId, applicationCode))
    } catch (error) {
      if (error instanceof AuthorizationError && error.status === 404 && applicationCode === 'contract_management') {
        applyLegacyApplicationAccess(await getContractApplicationAccess(userId))
      } else if (error instanceof AuthorizationError && error.status === 404) {
        applyApplicationAccess(null)
      } else {
        throw error
      }
    }
  } catch (error) {
    applicationAccessError.value = error instanceof AuthorizationError ? error.message : (error?.message || '读取应用访问授权失败。')
  } finally {
    authorizationCatalogLoading.value = false
    applicationAccessLoading.value = false
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
  const scopeType = authorizationDraft.scope_type === 'ENVIRONMENT' ? 'ENVIRONMENT' : 'APPLICATION'
  const environmentCode = scopeType === 'ENVIRONMENT' ? String(authorizationDraft.environment_code || '').trim() : null
  const validFrom = authorizationDraft.validity_mode === 'RANGE' ? toRFC3339(authorizationDraft.valid_from) : null
  const validUntil = authorizationDraft.validity_mode === 'RANGE' ? toRFC3339(authorizationDraft.valid_until) : null
  return {
    roles: authorizationDraft.role_codes.map((roleCode) => ({
      role_code: roleCode,
      scope_type: scopeType,
      environment_code: environmentCode,
      valid_from: validFrom,
      valid_until: validUntil,
    })),
  }
}

async function saveApplicationAccess() {
  const userId = detail.value?.kind === 'user' ? detail.value.item?.user_id : ''
  const applicationCode = selectedApplicationCode.value
  if (!userId || !applicationCode || applicationAccessSaving.value) return
  if (authorizationDraft.scope_type === 'ENVIRONMENT' && !authorizationDraft.environment_code) {
    applicationAccessError.value = '选择环境级授权时必须指定一个有效环境。'
    return
  }
  if (authorizationDraft.validity_mode === 'RANGE' && authorizationDraft.valid_from && authorizationDraft.valid_until && new Date(authorizationDraft.valid_until) <= new Date(authorizationDraft.valid_from)) {
    applicationAccessError.value = '失效时间必须晚于生效时间。'
    return
  }
  if (authorizationUsingLegacyEndpoint.value) {
    if (authorizationDraft.role_codes.length !== 1) {
      applicationAccessError.value = '当前后端仍使用合同系统兼容接口，只支持单角色保存；请先升级通用授权接口。'
      return
    }
    applicationAccessSaving.value = true
    applicationAccessError.value = ''
    try {
      const access = await updateContractApplicationAccess(userId, {
        roleCode: authorizationDraft.role_codes[0],
        customPermissions: [],
      })
      applyLegacyApplicationAccess(access)
      emitToast('应用角色已保存。权限将在用户重新登录或会话续签后生效。')
    } catch (error) {
      applicationAccessError.value = error instanceof AuthorizationError ? error.message : (error?.message || '保存应用访问授权失败。')
    } finally {
      applicationAccessSaving.value = false
    }
    return
  }
  applicationAccessSaving.value = true
  applicationAccessError.value = ''
  try {
    const access = await updateApplicationAccess(userId, applicationCode, applicationAccessPayload())
    applyApplicationAccess(access)
    emitToast('应用角色集合已保存。权限将在用户重新登录或会话续签后生效。')
  } catch (error) {
    applicationAccessError.value = error instanceof AuthorizationError ? error.message : (error?.message || '保存应用访问授权失败。')
  } finally {
    applicationAccessSaving.value = false
  }
}

async function revokeApplicationAccess() {
  const userId = detail.value?.kind === 'user' ? detail.value.item?.user_id : ''
  const applicationCode = selectedApplicationCode.value
  if (!userId || !applicationCode || applicationAccessRevoking.value) return
  if (!window.confirm(`确认撤销用户“${detail.value.item?.display_name || userId}”的“${applicationDisplayName(selectedApplication.value)}”访问权限吗？`)) return
  applicationAccessRevoking.value = true
  applicationAccessError.value = ''
  try {
    await deleteApplicationAccess(userId, applicationCode)
    applyApplicationAccess(null)
    emitToast('应用访问已撤销。用户将不再获得该应用的门户入口。')
  } catch (error) {
    applicationAccessError.value = error instanceof AuthorizationError ? error.message : (error?.message || '撤销应用访问失败。')
  } finally {
    applicationAccessRevoking.value = false
  }
}

function resetFilters() {
  Object.keys(filters).forEach((key) => { filters[key] = '' })
  emitToast('已清空筛选条件。')
}

function asId(value) {
  if (!value) return '—'
  if (typeof value === 'string') return value
  if (typeof value === 'object' && value.id) return value.id
  return String(value)
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
  const data = await safeCall('users', () => listUsers({ page, pageSize, keyword: filters.user, status: 'ACTIVE' }))
  if (data) updatePage('users', data, users)
}

async function loadAccounts(page = pagination.accounts.page) {
  const data = await safeCall('accounts', () => listAccounts({ page, pageSize, keyword: filters.account }))
  if (data) updatePage('accounts', data, accounts)
}

async function loadOrganizations(page = pagination.organizations.page) {
  const data = await safeCall('organizations', () => listOrgUnits({ page, pageSize, keyword: filters.organization, status: 'ACTIVE' }))
  if (data) updatePage('organizations', data, organizations, { verifyPageSize: true })
}

async function loadPositions(page = pagination.positions.page) {
  const data = await safeCall('positions', () => listPositions({ page, pageSize, keyword: filters.position, status: 'ACTIVE' }))
  if (data) updatePage('positions', data, positions, { verifyPageSize: true })
}

async function loadMemberships(page = pagination.memberships.page) {
  const data = await safeCall('memberships', () => listMemberships({ page, pageSize, keyword: filters.membership, status: 'ACTIVE' }))
  if (data) updatePage('memberships', data, memberships)
}



async function reloadActive() {
  switch (activePanel.value) {
    case 'users': await loadUsers(); break
    case 'accounts': await loadAccounts(); break
    case 'organizations': await loadOrganizations(); break
    case 'positions': await loadPositions(); break
    case 'memberships': await loadMemberships(); break
    default: break
  }
}

function pageTotal(key) {
  return Math.max(1, Math.ceil(pagination[key].total / pagination[key].pageSize))
}

function goToPage(key, page) {
  const next = Math.min(Math.max(1, page), pageTotal(key))
  if (next === pagination[key].page) return
  pagination[key].page = next
  reloadActive()
}

const activePagination = computed(() => pagination[activePanel.value] || null)
const activeServerPagingUnavailable = computed(() => activePagination.value?.serverPagingSupported === false)
const activeLoading = computed(() => loading[activePanel.value])

watch(activePanel, () => {
  detail.value = null
  reloadActive()
})

let filterTimer
watch(filters, () => {
  clearTimeout(filterTimer)
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

// Password reset is keyed by account_id. When started from a user row, the matching account is
// resolved by its user_id so that a password is never reset for an unrelated login account.
function openPasswordResetForAccount(account) {
  if (!account?.account_id) {
    emitToast('未找到可重置密码的登录账号。')
    return
  }
  passwordResetDialog.value = { accountId: account.account_id, accounts: [account], userName: '' }
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
  }
}

function closePasswordResetDialog() {
  if (resettingPassword.value) return
  passwordResetDialog.value = null
}

async function confirmPasswordReset() {
  const account = selectedPasswordResetAccount.value
  if (!account?.account_id || resettingPassword.value) return

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
    }
    await loadAccounts()
    emitToast('密码已重置，请立即复制临时密码并通过安全渠道交付。')
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

// Closing this dialog clears the plaintext from browser memory. The password cannot be viewed
// again from this page; an administrator must initiate another reset if it was not copied.
function closeTemporaryPassword() {
  temporaryPassword.value = null
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

async function removeOrganization(organization) {
  if (!organization?.org_unit_id) return
  const version = Number(organization.version)
  if (!Number.isInteger(version) || version < 1) {
    emitToast('组织版本信息无效，请刷新列表后重试。')
    return
  }
  if (!window.confirm(`确认删除组织“${organization.name}”吗？其岗位和任职关系将一并停用。`)) return
  try {
    await deleteOrgUnit({ orgUnitId: organization.org_unit_id, version })
    if (detail.value?.kind === 'organization' && detail.value.item?.org_unit_id === organization.org_unit_id) closeDetail()
    await Promise.all([loadOrganizations(), loadPositions(), loadMemberships()])
    emitToast(`组织 ${organization.name} 已删除，相关岗位和任职关系已停用。`)
  } catch (error) {
    emitToast(error instanceof IamError ? error.message : (error?.message || '删除组织失败。'))
  }
}

// ---- 新增（对接真实 API）----
const editor = ref(null) // { kind, label }
const form = reactive({})
const saving = ref(false)
const initialPasswordVisible = ref(false)

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
  membership: () => ({ user_id: '', org_unit_id: '', position_id: '', membership_type: 'PRIMARY', validity_mode: 'LONG_TERM', effective_from: '', effective_to: '' }),
}

const panelToKind = {
  users: 'user',
  accounts: 'account',
  organizations: 'organization',
  positions: 'position',
  memberships: 'membership',
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
  if (passwordLength < 12 || passwordLength > 128) throw new IamError('初始密码长度必须为 12–128 个字符。')
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

onMounted(async () => {
  await Promise.all([loadUsers(), loadAccounts(), loadOrganizations(), loadPositions(), loadMemberships()])
})
</script>

<template>
  <section class="iam-settings" aria-label="身份、组织与授权设置">
    <div class="iam-summary-grid">
      <article v-for="metric in metrics" :key="metric.label" class="iam-summary-card" :class="metric.tone">
        <span class="iam-summary-icon"><ConsoleIcon :name="metric.icon" /></span>
        <div><small>{{ metric.label }}</small><strong>{{ metric.value }}</strong><p>{{ metric.note }}</p></div>
      </article>
    </div>

    <p v-if="errorMessage" class="login-target-module__error" role="alert">{{ errorMessage }}</p>

    <div class="iam-workspace">
      <aside class="iam-panel-nav" aria-label="身份与授权功能导航">
        <button
          v-for="item in panels"
          :key="item.key"
          type="button"
          :class="{ active: activePanel === item.key }"
          @click="selectPanel(item.key)"
        >
          <ConsoleIcon :name="item.icon" />
          <span>{{ item.label }}</span>
        </button>
      </aside>

      <section class="iam-panel-content">
        <header class="iam-panel-head">
          <div><h3>{{ panel.label }}</h3><p>{{ panel.description }}</p></div>
          <div class="iam-panel-actions">
            <button class="console-button ghost small" type="button" @click="resetFilters"><ConsoleIcon name="reset" />清空筛选</button>
            <button class="console-button ghost small" type="button" :disabled="activeLoading" @click="reloadActive"><ConsoleIcon name="refresh" />刷新</button>
            <button v-if="activePanel === 'users'" class="console-button ghost small" type="button" @click="openEditor('user-batch')"><ConsoleIcon name="plus" />批量新增用户</button>
            <button class="console-button primary small" type="button" :disabled="!panelToKind[activePanel]" @click="openEditorForActivePanel"><ConsoleIcon name="plus" />新增{{ editorLabels[panelToKind[activePanel]] || '' }}</button>
          </div>
        </header>

        <section v-if="activePanel === 'users'" class="iam-table-section">
          <div class="iam-filter-row"><label class="console-search-field"><ConsoleIcon name="search" /><input v-model="filters.user" type="search" placeholder="姓名 / 工号 / 邮箱 / 状态" /></label><span>{{ filteredUsers.length }} / 共 {{ pagination.users.total }} 位用户</span></div>
          <div class="console-table-card"><div class="console-table-scroll"><table class="console-data-table iam-data-table"><thead><tr><th>用户</th><th>工号</th><th>邮箱</th><th>状态</th><th>更新时间</th><th class="console-actions-cell">操作</th></tr></thead><tbody>
            <tr v-if="loading.users"><td class="console-empty" colspan="6">正在读取用户…</td></tr>
            <tr v-else-if="!filteredUsers.length"><td class="console-empty" colspan="6">暂无用户记录。</td></tr>
            <tr v-for="item in filteredUsers" :key="item.user_id"><td><strong class="console-entity-name">{{ item.display_name }}</strong><span class="console-entity-meta console-mono">{{ item.user_id }}</span></td><td class="console-mono">{{ item.employee_no || '—' }}</td><td>{{ item.email || '—' }}</td><td><span class="console-badge" :class="(item.status || '').toUpperCase() === 'ACTIVE' ? 'status-active' : 'status-disabled'">{{ displayStatus(item.status) }}</span></td><td class="console-mono">{{ formatDateTime(item.updated_at) }}</td><td class="console-actions-cell"><button class="console-text-button" type="button" @click="openDetail('user', item)">详情</button><button class="console-text-button danger" type="button" @click="openUserDeletionDialog(item)">删除</button></td></tr>
          </tbody></table></div></div>
        </section>

        <section v-else-if="activePanel === 'accounts'" class="iam-table-section iam-accounts-panel">
          <div class="iam-filter-row iam-account-filter-row"><label class="console-search-field"><ConsoleIcon name="search" /><input v-model="filters.account" type="search" placeholder="搜索账号、用户 ID 或状态" /></label><span>{{ filteredAccounts.length }} / 共 {{ pagination.accounts.total }} 个账号</span></div>
          <div class="console-table-card iam-account-table-card"><div class="console-table-scroll"><table class="console-data-table iam-data-table"><thead><tr><th>登录账号</th><th>关联用户</th><th>认证方式</th><th>有效时间</th><th>状态</th><th>更新时间</th><th class="console-actions-cell">操作</th></tr></thead><tbody>
            <tr v-if="loading.accounts"><td class="console-empty" colspan="7">正在读取登录账号…</td></tr>
            <tr v-else-if="!filteredAccounts.length"><td class="console-empty" colspan="7">暂无登录账号记录。可点击右上角“新增登录账号”创建。</td></tr>
            <tr v-for="item in filteredAccounts" :key="item.account_id"><td><div class="iam-account-identity"><span class="iam-account-avatar">{{ (item.account_name || '?').slice(0, 1).toUpperCase() }}</span><span><strong>{{ item.account_name }}</strong><small class="console-mono">{{ item.account_id }}</small></span></div></td><td><span class="iam-linked-user"><ConsoleIcon name="user" />{{ item.user_id || '—' }}</span></td><td><div class="iam-auth-tags"><span class="iam-type-tag">{{ displayLoginAccountType(item).split(' / ')[0] }}</span><span class="iam-source-tag">{{ displayLoginAccountType(item).split(' / ')[1] }}</span></div></td><td><div class="iam-validity"><span class="iam-validity-chip" :class="item.valid_until ? 'is-temporary' : 'is-permanent'">{{ item.valid_until ? '临时账号' : '永久账号' }}</span><small>{{ item.valid_until ? formatDateTime(item.valid_until) : '长期有效' }}</small></div></td><td><span class="console-badge" :class="(item.status || '').toUpperCase() === 'ACTIVE' ? 'status-active' : 'status-disabled'">{{ displayStatus(item.status) }}</span></td><td class="console-mono iam-account-updated">{{ formatDateTime(item.updated_at) }}</td><td class="console-actions-cell iam-account-actions"><button class="console-text-button" type="button" @click="openDetail('account', item)">详情</button><button v-if="isAccountStatusManageable(item.status)" class="console-text-button" :class="{ danger: (item.status || '').toUpperCase() === 'ACTIVE' }" type="button" :disabled="updatingAccountId === item.account_id" @click="toggleAccountStatus(item)">{{ updatingAccountId === item.account_id ? '处理中…' : ((item.status || '').toUpperCase() === 'ACTIVE' ? '停用' : '启用') }}</button><button class="console-text-button danger" type="button" @click="openPasswordResetForAccount(item)">重置密码</button></td></tr>
          </tbody></table></div></div>
        </section>

        <section v-else-if="activePanel === 'organizations'" class="iam-table-section">
          <div class="iam-filter-row"><label class="console-search-field"><ConsoleIcon name="search" /><input v-model="filters.organization" type="search" placeholder="组织编码 / 名称" /></label><span>{{ filteredOrganizations.length }} / 共 {{ pagination.organizations.total }} 个组织</span></div>
          <p v-if="pagination.organizations.serverPagingSupported === false && pagination.organizations.total > pagination.organizations.pageSize" class="iam-server-limit-note">当前后端尚未按 page / page_size 分页组织列表；为避免只在首批数据中翻页，已隐藏分页操作。请先完成后端分页改造。</p>
          <div class="console-table-card"><div class="console-table-scroll"><table class="console-data-table iam-data-table"><thead><tr><th>组织单元</th><th>上级组织 ID</th><th>排序</th><th>状态</th><th class="console-actions-cell">操作</th></tr></thead><tbody>
            <tr v-if="loading.organizations"><td class="console-empty" colspan="5">正在读取组织…</td></tr>
            <tr v-else-if="!filteredOrganizations.length"><td class="console-empty" colspan="5">暂无组织记录。</td></tr>
            <tr v-for="item in filteredOrganizations" :key="item.org_unit_id"><td><strong>{{ item.name }}</strong><span class="console-entity-meta console-mono">{{ item.code }} · {{ item.org_unit_id }}</span></td><td class="console-mono">{{ item.parent_id || '—' }}</td><td>{{ item.sort_order ?? 0 }}</td><td><span class="console-badge" :class="(item.status || '').toUpperCase() === 'ACTIVE' ? 'status-active' : 'status-disabled'">{{ displayStatus(item.status) }}</span></td><td class="console-actions-cell"><button class="console-text-button" type="button" @click="openDetail('organization', item)">详情</button><button class="console-text-button" type="button" @click="openOrganizationEditor(item)">编辑</button><button class="console-text-button danger" type="button" @click="removeOrganization(item)">删除</button></td></tr>
          </tbody></table></div></div>
        </section>

        <section v-else-if="activePanel === 'positions'" class="iam-table-section">
          <div class="iam-filter-row"><label class="console-search-field"><ConsoleIcon name="search" /><input v-model="filters.position" type="search" placeholder="岗位编码 / 名称 / 所属组织" /></label><span>{{ filteredPositions.length }} / 共 {{ pagination.positions.total }} 个岗位</span></div>
          <p v-if="pagination.positions.serverPagingSupported === false && pagination.positions.total > pagination.positions.pageSize" class="iam-server-limit-note">当前后端尚未按 page / page_size 分页岗位列表；为避免只在首批数据中翻页，已隐藏分页操作。请先完成后端分页改造。</p>
          <div class="console-table-card"><div class="console-table-scroll"><table class="console-data-table iam-data-table"><thead><tr><th>岗位</th><th>所属组织</th><th>状态</th><th class="console-actions-cell">操作</th></tr></thead><tbody>
            <tr v-if="loading.positions"><td class="console-empty" colspan="4">正在读取岗位…</td></tr>
            <tr v-else-if="!filteredPositions.length"><td class="console-empty" colspan="4">暂无岗位记录。</td></tr>
            <tr v-for="item in filteredPositions" :key="item.position_id || item.id"><td><strong>{{ item.name }}</strong></td><td>{{ item.organization_name }}</td><td><span class="console-badge" :class="(item.status || '').toUpperCase() === 'ACTIVE' ? 'status-active' : 'status-disabled'">{{ displayStatus(item.status) }}</span></td><td class="console-actions-cell"><button class="console-text-button" type="button" @click="openDetail('position', item)">详情</button></td></tr>
          </tbody></table></div></div>
        </section>

        <section v-else-if="activePanel === 'memberships'" class="iam-table-section">
          <div class="iam-filter-row"><label class="console-search-field"><ConsoleIcon name="search" /><input v-model="filters.membership" type="search" placeholder="用户 / 组织 / 岗位" /></label><span>{{ filteredMemberships.length }} / 共 {{ pagination.memberships.total }} 条任职关系</span></div>
          <div class="console-table-card"><div class="console-table-scroll"><table class="console-data-table iam-data-table"><thead><tr><th>用户</th><th>组织</th><th>岗位</th><th>任职类型</th><th>有效期</th><th class="console-actions-cell">操作</th></tr></thead><tbody>
            <tr v-if="loading.memberships"><td class="console-empty" colspan="6">正在读取任职关系…</td></tr>
            <tr v-else-if="!filteredMemberships.length"><td class="console-empty" colspan="6">暂无任职关系。</td></tr>
            <tr v-for="item in filteredMemberships" :key="item.membership_id || item.id"><td>{{ item.user?.name || item.user?.display_name || item.user_id || '—' }}</td><td>{{ item.org_unit?.name || item.org_unit_id || '—' }}</td><td>{{ item.position?.name || item.position_id || '—' }}</td><td>{{ displayMembershipType(item.membership_type) }}</td><td>{{ displayMembershipValidity(item) }}</td><td class="console-actions-cell"><button class="console-text-button" type="button" @click="openDetail('membership', item)">详情</button></td></tr>
          </tbody></table></div></div>
        </section>

        <nav v-if="activePagination && activePagination.total > activePagination.pageSize && !activeServerPagingUnavailable" class="iam-pagination" aria-label="列表分页">
          <button class="console-button ghost small" type="button" :disabled="activePagination.page <= 1" @click="goToPage(activePanel, activePagination.page - 1)">上一页</button>
          <span>第 {{ activePagination.page }} / {{ pageTotal(activePanel) }} 页，共 {{ activePagination.total }} 条</span>
          <button class="console-button ghost small" type="button" :disabled="activePagination.page >= pageTotal(activePanel)" @click="goToPage(activePanel, activePagination.page + 1)">下一页</button>
        </nav>
      </section>
    </div>

    <div v-if="detail" class="iam-modal-backdrop" role="presentation" @click.self="closeDetail">
      <section class="iam-modal" role="dialog" aria-modal="true" aria-label="身份授权详情">
        <header><div><p>详情</p><h3>{{ detailTitle(detail) }}</h3></div><button class="console-modal-close" type="button" aria-label="关闭详情" @click="closeDetail"><ConsoleIcon name="close" /></button></header>
        <div class="iam-detail-grid">
          <template v-for="row in detailRows(detail)" :key="row.label">
            <div><span>{{ row.label }}</span><strong>{{ row.value }}</strong></div>
          </template>
        </div>
        <section v-if="detail.kind === 'user'" class="iam-detail-section iam-application-access">
          <div class="iam-detail-section-head">
            <div><h4>应用访问授权</h4><p>平台角色与业务应用角色彼此隔离。选择应用后，平台从该应用提交的角色目录中加载角色；保存时会完整替换用户在当前应用中的角色集合。</p></div>
            <div class="iam-application-access-badges"><span v-if="selectedApplication" class="iam-application-badge">{{ applicationDisplayName(selectedApplication) }} · {{ selectedApplication.code }}</span><span v-if="authorizationCatalog" class="iam-application-badge">目录版本 {{ catalogVersion(authorizationCatalog) }}</span></div>
          </div>
          <p v-if="applicationsLoading" class="iam-empty-inline">正在读取应用列表…</p>
          <template v-else-if="!applications.length">
            <p class="iam-empty-inline">当前没有可授权的应用。</p>
          </template>
          <template v-else>
            <p v-if="applicationAccessError" class="login-target-module__error" role="alert">{{ applicationAccessError }}</p>
            <div class="iam-application-access-form">
              <label><span>应用 *</span><select v-model="selectedApplicationCode" :disabled="applicationAccessLoading || applicationAccessSaving || applicationAccessRevoking" @change="loadApplicationAuthorization(detail.item.user_id, selectedApplicationCode)"><option v-for="application in applications" :key="application.application_id || application.id || application.code" :value="application.code">{{ applicationDisplayName(application) }} · {{ application.code }}</option></select></label>
              <div class="iam-application-meta"><span>应用归属：<strong>{{ selectedApplication?.name || selectedApplication?.display_name || '—' }}</strong></span><span>应用编码：<code>{{ selectedApplication?.code || '—' }}</code></span><span>目录版本：<strong>{{ catalogVersion(authorizationCatalog) }}</strong></span><span v-if="authorizationUsingLegacyEndpoint" class="is-legacy">合同旧接口兼容模式</span></div>
              <div class="iam-application-scope-grid">
                <label><span>授权范围 *</span><select v-model="authorizationDraft.scope_type" :disabled="authorizationUsingLegacyEndpoint || applicationAccessLoading || applicationAccessSaving || applicationAccessRevoking" @change="onAuthorizationScopeChange"><option value="APPLICATION">整个应用</option><option value="ENVIRONMENT" :disabled="!authorizationEnvironmentOptions.length">指定环境</option></select></label>
                <label v-if="authorizationDraft.scope_type === 'ENVIRONMENT'"><span>环境 *</span><select v-model="authorizationDraft.environment_code" :disabled="authorizationUsingLegacyEndpoint || applicationEnvironmentsLoading || applicationAccessSaving || applicationAccessRevoking"><option value="">请选择环境</option><option v-for="environment in authorizationEnvironmentOptions" :key="environment.code" :value="environment.code">{{ environment.name }} · {{ environment.code }}</option></select><small v-if="applicationEnvironmentsLoading">正在读取环境…</small></label>
                <label><span>有效期 *</span><select v-model="authorizationDraft.validity_mode" :disabled="authorizationUsingLegacyEndpoint || applicationAccessSaving || applicationAccessRevoking" @change="onAuthorizationValidityChange"><option value="PERMANENT">长期有效</option><option value="RANGE">指定有效期</option></select></label>
              </div>
              <div v-if="authorizationDraft.validity_mode === 'RANGE'" class="iam-application-validity-grid"><label><span>生效时间</span><input v-model="authorizationDraft.valid_from" type="datetime-local" :disabled="authorizationUsingLegacyEndpoint || applicationAccessSaving || applicationAccessRevoking" /></label><label><span>失效时间</span><input v-model="authorizationDraft.valid_until" type="datetime-local" :disabled="authorizationUsingLegacyEndpoint || applicationAccessSaving || applicationAccessRevoking" /></label></div>
              <p v-if="authorizationHasMixedRoleSettings" class="iam-field-help iam-application-scope-warning">当前用户的角色存在不同授权范围或有效期；本次保存会按上方设置统一替换所选角色集合。</p>
              <p v-if="authorizationCatalogLoading || applicationAccessLoading" class="iam-empty-inline">正在读取应用角色与当前授权…</p>
              <template v-else>
                <div v-if="!authorizationRoleOptions.length" class="iam-application-empty-catalog"><strong>暂无可分配角色目录</strong><p>该应用尚未同步角色目录，平台不会猜测或内置业务角色。请由应用负责人同步授权目录后再分配角色。</p></div>
                <fieldset v-else class="iam-application-role-fieldset" :disabled="applicationAccessSaving || applicationAccessRevoking">
                  <legend>应用角色（可多选）</legend>
                  <div class="iam-application-role-list"><label v-for="role in authorizationRoleOptions" :key="role.role_id || role.id || role.code" class="iam-application-role-option" :class="{ selected: authorizationDraft.role_codes.includes(role.code) }"><input v-model="authorizationDraft.role_codes" type="checkbox" :value="role.code" /><span class="iam-application-role-copy"><strong>{{ role.name || role.display_name || role.code }}</strong><code>{{ role.code }}</code><small v-if="role.description">{{ role.description }}</small><small>{{ rolePermissionCodes(role).length }} 项权限</small></span></label></div>
                </fieldset>
                <div class="iam-application-permission-block effective"><div class="iam-application-permission-head"><strong>有效权限预览</strong><span>{{ authorizationEffectivePermissions.length }} 项</span></div><p v-if="!authorizationEffectivePermissions.length" class="iam-empty-inline">当前未选择角色，保存后该用户不会获得此应用的访问授权。</p><div v-else class="iam-application-permission-tags"><span v-for="permission in authorizationEffectivePermissions" :key="permission"><b>{{ permissionName(permission) }}</b><code>{{ permission }}</code></span></div><p class="iam-field-help">权限由所选角色的权限并集组成；平台前端只提交角色编码、授权范围和有效期，不提交前端计算的有效权限。</p></div>
              </template>
            </div>
          </template>
        </section>
        <footer><button class="console-button ghost" type="button" :disabled="applicationAccessSaving || applicationAccessRevoking" @click="closeDetail">关闭</button><button v-if="detail.kind === 'user' && selectedApplicationCode && applicationAccess" class="console-button danger" type="button" :disabled="applicationAccessSaving || applicationAccessRevoking" @click="revokeApplicationAccess">{{ applicationAccessRevoking ? '撤销中…' : '撤销应用访问' }}</button><button v-if="detail.kind === 'user' && selectedApplicationCode" class="console-button primary" type="button" :disabled="applicationsLoading || authorizationCatalogLoading || applicationAccessLoading || applicationAccessSaving || applicationAccessRevoking || !authorizationRoleOptions.length" @click="saveApplicationAccess"><ConsoleIcon name="save" />{{ applicationAccessSaving ? '保存中…' : '保存角色集合' }}</button></footer>
      </section>
    </div>

    <div v-if="passwordResetDialog" class="iam-modal-backdrop" role="presentation" @click.self="closePasswordResetDialog">
      <section class="iam-modal iam-confirm-modal" role="dialog" aria-modal="true" aria-label="确认重置密码">
        <header><div><p>敏感操作</p><h3>确认重置密码</h3></div><button class="console-modal-close" type="button" aria-label="关闭密码重置确认" :disabled="resettingPassword" @click="closePasswordResetDialog"><ConsoleIcon name="close" /></button></header>
        <div class="iam-confirm-body">
          <p>系统将为下列登录账号生成新的临时密码。旧密码将立即失效，临时密码只会在下一步显示一次。</p>
          <label v-if="passwordResetDialog.accounts.length > 1"><span>关联登录账号</span><select v-model="passwordResetDialog.accountId"><option v-for="account in passwordResetDialog.accounts" :key="account.account_id" :value="account.account_id">{{ account.account_name || account.account_id }}（{{ account.account_id }}）</option></select></label>
          <dl v-if="selectedPasswordResetAccount" class="iam-confirm-summary"><div><dt>登录账号</dt><dd>{{ selectedPasswordResetAccount.account_name || selectedPasswordResetAccount.account_id }}</dd></div><div><dt>账号 ID</dt><dd class="console-mono">{{ selectedPasswordResetAccount.account_id }}</dd></div><div v-if="passwordResetDialog.userName"><dt>关联用户</dt><dd>{{ passwordResetDialog.userName }}</dd></div></dl>
        </div>
        <footer><button class="console-button ghost" type="button" :disabled="resettingPassword" @click="closePasswordResetDialog">取消</button><button class="console-button primary" type="button" :disabled="!selectedPasswordResetAccount || resettingPassword" @click="confirmPasswordReset">{{ resettingPassword ? '正在重置…' : '确认重置' }}</button></footer>
      </section>
    </div>

    <div v-if="temporaryPassword" class="iam-modal-backdrop" role="presentation" @click.self="closeTemporaryPassword">
      <section class="iam-modal iam-temporary-password-modal" role="dialog" aria-modal="true" aria-label="一次性临时密码">
        <header><div><p>请立即保存</p><h3>一次性临时密码</h3></div><button class="console-modal-close" type="button" aria-label="关闭临时密码" @click="closeTemporaryPassword"><ConsoleIcon name="close" /></button></header>
        <div class="iam-confirm-body"><p>账号 <strong>{{ temporaryPassword.accountName }}</strong> 的密码已重置。关闭此窗口后，临时密码将从当前页面清除；如未保存，只能再次重置。</p><code class="iam-one-time-password">{{ temporaryPassword.value }}</code><p class="iam-one-time-warning">请仅通过受控的安全渠道交付给用户，不要粘贴到工单、聊天记录或日志中。</p></div>
        <footer><button class="console-button ghost" type="button" @click="closeTemporaryPassword">我已保存</button><button class="console-button primary" type="button" @click="copyTemporaryPassword">复制临时密码</button></footer>
      </section>
    </div>

    <div v-if="userDeletionDialog" class="iam-modal-backdrop" role="presentation" @click.self="closeUserDeletionDialog">
      <section class="iam-modal iam-confirm-modal" role="dialog" aria-modal="true" aria-label="确认删除用户">
        <header><div><p>危险操作</p><h3>确认删除用户</h3></div><button class="console-modal-close" type="button" aria-label="关闭删除用户确认" :disabled="deletingUser" @click="closeUserDeletionDialog"><ConsoleIcon name="close" /></button></header>
        <div class="iam-confirm-body"><p>确认删除用户 <strong>{{ userDeletionDialog.display_name || userDeletionDialog.user_id }}</strong> 吗？该操作不可恢复；关联登录账号和任职关系将同步删除，当前登录会话也会立即失效。</p><dl class="iam-confirm-summary"><div><dt>用户 ID</dt><dd class="console-mono">{{ userDeletionDialog.user_id }}</dd></div><div><dt>当前版本</dt><dd>{{ userDeletionDialog.version ?? 0 }}</dd></div></dl></div>
        <footer><button class="console-button ghost" type="button" :disabled="deletingUser" @click="closeUserDeletionDialog">取消</button><button class="console-button iam-danger-button" type="button" :disabled="deletingUser" @click="confirmUserDeletion">{{ deletingUser ? '正在删除…' : '确认删除' }}</button></footer>
      </section>
    </div>

    <div v-if="editor" class="iam-modal-backdrop" role="presentation" @click.self="closeEditor">
      <section class="iam-modal iam-editor-modal" role="dialog" aria-modal="true" aria-label="新增身份授权配置">
        <header><div><p>{{ editor.mode === 'edit' ? '编辑' : '新增' }}</p><h3>{{ editor.mode === 'edit' ? '编辑' : '新增' }} {{ editor.label }}</h3></div><button class="console-modal-close" type="button" aria-label="关闭表单" :disabled="saving" @click="closeEditor"><ConsoleIcon name="close" /></button></header>
        <form class="iam-editor-form" @submit.prevent="saveEditor">
          <template v-if="editor.kind === 'user'">
            <p class="iam-form-alert"><ConsoleIcon name="info" />员工编号由后端自动生成；本次会同时创建该用户的本地登录账号。</p>
            <label><span>展示姓名 *</span><input v-model="form.display_name" required maxlength="100" placeholder="例如：张三" /></label>
            <label><span>邮箱</span><input v-model="form.email" type="email" placeholder="例如：zhang.san@example.com" /></label>
            <label><span>手机</span><input v-model="form.mobile" maxlength="32" placeholder="例如：13800000000" /></label>
            <label><span>状态</span><select v-model="form.status"><option value="ACTIVE">启用</option><option value="DISABLED">停用</option></select></label>
            <label><span>登录账号 *</span><input v-model="form.account_name" required minlength="3" maxlength="64" placeholder="例如：zhang.san" /><small class="iam-field-help">账号必须唯一，以字母或数字开头。</small></label>
            <label><span>初始密码 *</span><div class="iam-password-field"><input v-model="form.initial_password" :type="initialPasswordVisible ? 'text' : 'password'" required minlength="12" maxlength="128" autocomplete="new-password" /><button type="button" :aria-label="initialPasswordVisible ? '隐藏密码' : '显示密码'" @click="initialPasswordVisible = !initialPasswordVisible"><ConsoleIcon :name="initialPasswordVisible ? 'eye-off' : 'eye'" /></button></div></label>
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
            <label class="iam-account-field"><span>初始密码 *</span><div class="iam-password-field"><input id="initial-password" v-model="form.initial_password" required minlength="12" maxlength="128" :type="initialPasswordVisible ? 'text' : 'password'" autocomplete="new-password" placeholder="请妥善记录，将仅返回一次" /><button class="iam-password-toggle" type="button" :aria-label="initialPasswordVisible ? '隐藏初始密码' : '显示初始密码'" :title="initialPasswordVisible ? '隐藏密码' : '显示密码'" @click="initialPasswordVisible = !initialPasswordVisible"><svg v-if="!initialPasswordVisible" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5c-5 0-9.3 3-11 7 1.7 4 6 7 11 7s9.3-3 11-7c-1.7-4-6-7-11-7Zm0 12c-3.8 0-7.2-2-8.8-5C4.8 9 8.2 7 12 7s7.2 2 8.8 5c-1.6 3-5 5-8.8 5Zm0-8a3 3 0 1 0 0 6 3 3 0 0 0 0-6Zm0 4a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z" /></svg><svg v-else viewBox="0 0 24 24" aria-hidden="true"><path d="m3.3 2-1.4 1.4 3 3A12.7 12.7 0 0 0 1 12c1.7 4 6 7 11 7 1.8 0 3.5-.4 5-1l3.6 3.6 1.4-1.4L3.3 2ZM12 17c-3.8 0-7.2-2-8.8-5 .8-1.5 1.9-2.7 3.2-3.5l2.1 2.1A3.5 3.5 0 0 0 13.4 15l2 2c-1 .3-2.2.5-3.4.5V17Zm-1.6-4.5 2.1 2.1a1.6 1.6 0 0 1-2.1-2.1ZM12 7c3.8 0 7.2 2 8.8 5a9.5 9.5 0 0 1-2.1 2.8l1.4 1.4A12 12 0 0 0 23 12c-1.7-4-7-7-11-7-.8 0-1.6.1-2.4.2l1.7 1.7.7.1Zm.9 2.1 3 3a4 4 0 0 0-3-3Z" /></svg></button></div><small class="iam-field-help">12–128 个字符，不含空白，并同时包含大写字母、小写字母、数字和特殊字符。</small></label>
            <div class="iam-validity-picker full"><span>有效时间 *</span><div class="iam-validity-options" role="radiogroup" aria-label="账号有效时间"><button type="button" :class="{ active: form.validity_mode === 'TEMPORARY' }" role="radio" :aria-checked="form.validity_mode === 'TEMPORARY'" @click="form.validity_mode = 'TEMPORARY'"><strong>临时账号</strong><small>默认有效 1 天，可自定义截止时间</small></button><button type="button" :class="{ active: form.validity_mode === 'PERMANENT' }" role="radio" :aria-checked="form.validity_mode === 'PERMANENT'" @click="form.validity_mode = 'PERMANENT'"><strong>永久账号</strong><small>长期有效，仍可随时停用</small></button></div></div>
            <label v-if="form.validity_mode === 'TEMPORARY'" class="full iam-account-expiry-field"><span>有效截止时间 *</span><input v-model="form.valid_until" type="datetime-local" required /><small class="iam-field-help">到期后，账号将无法继续登录；请选择晚于当前时间的日期和时间。</small></label>
          </template>
          <template v-else-if="editor.kind === 'organization'">
            <label><span>组织名称 *</span><input v-model="form.name" required /></label>
            <label><span>组织编码</span><input value="提交后由系统自动生成" disabled /><small class="iam-field-help">编码由后端统一生成，创建后可在组织列表和详情中查看。</small></label>
            <label><span>上级组织（留空为根）</span><select v-model="form.parent_id"><option value="">无（根组织）</option><option v-for="item in organizations" :key="item.org_unit_id" :value="item.org_unit_id">{{ item.name }} · {{ item.code }} · {{ item.org_unit_id }}</option></select></label>
            <label><span>排序</span><input v-model.number="form.sort_order" type="number" /></label>
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
