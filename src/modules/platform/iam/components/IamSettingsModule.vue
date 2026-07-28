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
  createPosition,
  createUser,
  createUsersBatch,
  deleteUser,
  listAccounts,
  listMemberships,
  listOrgUnits,
  listPositions,
  listUsers,
  listIdentityProviders,
  listUserExternalIdentities,
  bindUserExternalIdentity,
  unbindUserExternalIdentity,
  resetAccountPassword,
  updateAccountStatus,
} from '@/modules/platform/iam/api/iam'
import {
  AuthorizationError,
  getContractApplicationAccess,
  updateContractApplicationAccess,
} from '@/modules/platform/iam/api/authorization'
import {
  CONTRACT_CUSTOM_PERMISSION_DEFINITIONS,
  CONTRACT_ROLE_DEFINITIONS,
  contractPermissionName,
  contractRole,
  effectiveContractPermissions,
} from '@/modules/shared/authz/sys004'
import '@/modules/platform/iam/styles/iam-settings.css'

const emit = defineEmits(['toast'])

const activePanel = ref('users')
const detail = ref(null)
const loading = reactive({ users: false, accounts: false, organizations: false, positions: false, memberships: false, externalIdentities: false })
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
const identityProviders = ref([])
const externalIdentities = ref([])
const selectedExternalIdentityUserId = ref('')
const passwordResetDialog = ref(null)
const temporaryPassword = ref(null)
const userDeletionDialog = ref(null)
const resettingPassword = ref(false)
const deletingUser = ref(false)
const updatingAccountId = ref('')
const contractAccess = ref(null)
const contractAccessLoading = ref(false)
const contractAccessSaving = ref(false)
const contractAccessError = ref('')
const contractAccessDraft = reactive({ role_code: '', custom_permissions: [] })

const selectedContractRole = computed(() => contractRole(contractAccessDraft.role_code))
const contractRolePermissions = computed(() => selectedContractRole.value?.permissions || [])
const contractEffectivePermissions = computed(() => effectiveContractPermissions(contractAccessDraft.role_code, contractAccessDraft.custom_permissions))
const contractCustomPermissionOptions = CONTRACT_CUSTOM_PERMISSION_DEFINITIONS
const contractRoleOptions = CONTRACT_ROLE_DEFINITIONS

const panels = [
  { key: 'users', label: '用户', icon: 'user', description: '自然人主体、任职状态与跨系统统一用户标识' },
  { key: 'accounts', label: '登录账号', icon: 'account', description: '账号状态、认证来源与外部身份绑定' },
  { key: 'organizations', label: '组织单元', icon: 'organization', description: '组织单元层级、编码与排序' },
  { key: 'positions', label: '岗位', icon: 'organization', description: '组织内岗位定义，是任职关系和岗位授权的基础' },
  { key: 'memberships', label: '任职关系', icon: 'link', description: 'Membership 任职关系：主组织、兼岗、历史任职' },
  { key: 'external-identities', label: '外部身份', icon: 'account', description: '为用户绑定、查看和解绑第三方身份提供商' },
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

async function openDetail(kind, item) {
  contractAccess.value = null
  contractAccessError.value = ''
  contractAccessDraft.role_code = ''
  contractAccessDraft.custom_permissions = []
  detail.value = { kind, item }
  if (kind === 'user') await loadContractAccess(item.user_id)
}

function closeDetail() {
  detail.value = null
  contractAccess.value = null
  contractAccessError.value = ''
}

function applyContractAccess(access) {
  contractAccess.value = access
  contractAccessDraft.role_code = access?.role?.code || ''
  contractAccessDraft.custom_permissions = Array.isArray(access?.custom_permissions) ? [...access.custom_permissions] : []
}

async function loadContractAccess(userId) {
  if (!userId || contractAccessLoading.value) return
  contractAccessLoading.value = true
  contractAccessError.value = ''
  try {
    applyContractAccess(await getContractApplicationAccess(userId))
  } catch (error) {
    if (error instanceof AuthorizationError && error.status === 404) {
      applyContractAccess(null)
      return
    }
    contractAccessError.value = error instanceof AuthorizationError ? error.message : (error?.message || '读取合同系统权限失败。')
  } finally {
    contractAccessLoading.value = false
  }
}

async function saveContractAccess() {
  const userId = detail.value?.kind === 'user' ? detail.value.item?.user_id : ''
  if (!userId || contractAccessSaving.value) return
  if (!contractAccessDraft.role_code) {
    contractAccessError.value = '请选择一个合同系统预置角色。'
    return
  }
  contractAccessSaving.value = true
  contractAccessError.value = ''
  try {
    const access = await updateContractApplicationAccess(userId, {
      roleCode: contractAccessDraft.role_code,
      customPermissions: contractAccessDraft.role_code === 'admin' ? [] : contractAccessDraft.custom_permissions,
    })
    applyContractAccess(access)
    emitToast('合同系统角色与附加权限已保存。权限将在用户重新登录或会话续签后生效。')
  } catch (error) {
    contractAccessError.value = error instanceof AuthorizationError ? error.message : (error?.message || '保存合同系统权限失败。')
  } finally {
    contractAccessSaving.value = false
  }
}

watch(() => contractAccessDraft.role_code, (roleCode) => {
  if (roleCode === 'admin') contractAccessDraft.custom_permissions = []
})

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




async function loadIdentityProviders() {
  const data = await safeCall('externalIdentities', () => listIdentityProviders({ page: 1, pageSize: 100 }))
  if (data) identityProviders.value = data.items.filter((item) => (item.status || '').toUpperCase() === 'ACTIVE')
}

async function loadExternalIdentities() {
  if (!selectedExternalIdentityUserId.value) {
    externalIdentities.value = []
    return
  }
  const data = await safeCall('externalIdentities', () => listUserExternalIdentities(selectedExternalIdentityUserId.value))
  if (data) externalIdentities.value = data
}

async function reloadActive() {
  switch (activePanel.value) {
    case 'users': await loadUsers(); break
    case 'accounts': await loadAccounts(); break
    case 'organizations': await loadOrganizations(); break
    case 'positions': await loadPositions(); break
    case 'memberships': await loadMemberships(); break
    case 'external-identities': await Promise.all([loadUsers(), loadIdentityProviders(), loadExternalIdentities()]); break
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
const activeLoading = computed(() => loading[activePanel.value === 'external-identities' ? 'externalIdentities' : activePanel.value])

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

watch(selectedExternalIdentityUserId, () => {
  if (activePanel.value === 'external-identities') loadExternalIdentities()
})

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
  user: () => ({ display_name: '', email: '', mobile: '', status: 'ACTIVE' }),
  'user-batch': () => ({ rows: '', status: 'ACTIVE' }),
  account: () => ({ account_name: '', user_id: '', initial_password: '', validity_mode: 'TEMPORARY', valid_until: defaultAccountValidUntil() }),
  organization: () => ({ name: '', parent_id: '', sort_order: 0 }),
  position: () => ({ org_unit_id: '', name: '' }),
  membership: () => ({ user_id: '', org_unit_id: '', position_id: '', membership_type: 'PRIMARY', validity_mode: 'LONG_TERM', effective_from: '', effective_to: '' }),
  'external-identity': () => ({ user_id: selectedExternalIdentityUserId.value || '', provider_code: '', external_subject: '' }),
}

const panelToKind = {
  users: 'user',
  accounts: 'account',
  organizations: 'organization',
  positions: 'position',
  memberships: 'membership',
  'external-identities': 'external-identity',
}

const editorLabels = {
  user: '用户',
  'user-batch': '批量用户',
  account: '登录账号',
  organization: '组织单元',
  position: '岗位',
  membership: '任职关系',
  'external-identity': '外部身份绑定',
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

  if (['account', 'membership', 'external-identity'].includes(kind) && !users.value.length) loadUsers()
  if (kind === 'position' && !organizations.value.length) loadOrganizations()
  if (kind === 'membership') {
    const referenceLoads = []
    if (!organizations.value.length) referenceLoads.push(loadOrganizations())
    if (!positions.value.length) referenceLoads.push(loadPositions())
    selectDefaultMembershipOrganization()
    if (referenceLoads.length) Promise.all(referenceLoads).then(selectDefaultMembershipOrganization)
  }
  if (kind === 'external-identity' && !identityProviders.value.length) loadIdentityProviders()
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

async function removeExternalIdentity(binding) {
  const userId = selectedExternalIdentityUserId.value
  if (!userId || !binding?.binding_id) return
  try {
    await unbindUserExternalIdentity({ userId, bindingId: binding.binding_id, version: binding.version || 0 })
    await loadExternalIdentities()
    emitToast('外部身份已解绑。')
  } catch (error) {
    emitToast(error instanceof IamError ? error.message : (error?.message || '解绑外部身份失败。'))
  }
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
      result = await createUser(userInput)
      successMessage = `用户 ${result?.display_name || form.display_name} 已创建，员工编号已自动生成并绑定普通用户角色。`
      await loadUsers()
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
      result = await createOrgUnit({
        parentId: form.parent_id || null,
        name: String(form.name).trim(),
        sortOrder: Number(form.sort_order) || 0,
      })
      successMessage = `组织 ${result?.name || form.name} 已创建，编码 ${result?.code || '已由系统生成'}。`
      await loadOrganizations()
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
    } else if (kind === 'external-identity') {
      if (!form.user_id || !form.provider_code || !String(form.external_subject || '').trim()) {
        throw new IamError('请选择用户、身份提供商并填写外部主体标识。')
      }
      result = await bindUserExternalIdentity({
        userId: form.user_id,
        providerCode: form.provider_code,
        externalSubject: String(form.external_subject).trim(),
      })
      selectedExternalIdentityUserId.value = form.user_id
      await loadExternalIdentities()
      successMessage = `外部身份绑定 ${result.binding_id || ''} 已写入 MySQL。`
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
  if (!selectedExternalIdentityUserId.value && users.value[0]) {
    selectedExternalIdentityUserId.value = users.value[0].user_id
  }
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
            <tr v-for="item in filteredOrganizations" :key="item.org_unit_id"><td><strong>{{ item.name }}</strong><span class="console-entity-meta console-mono">{{ item.code }} · {{ item.org_unit_id }}</span></td><td class="console-mono">{{ item.parent_id || '—' }}</td><td>{{ item.sort_order ?? 0 }}</td><td><span class="console-badge" :class="(item.status || '').toUpperCase() === 'ACTIVE' ? 'status-active' : 'status-disabled'">{{ displayStatus(item.status) }}</span></td><td class="console-actions-cell"><button class="console-text-button" type="button" @click="openDetail('organization', item)">详情</button></td></tr>
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

        <section v-else-if="activePanel === 'external-identities'" class="iam-table-section">
          <div class="iam-filter-row"><label><span>用户</span><select v-model="selectedExternalIdentityUserId"><option value="">请选择用户</option><option v-for="item in users" :key="item.user_id" :value="item.user_id">{{ item.display_name }} · {{ item.user_id }}</option></select></label><span>{{ selectedExternalIdentityUserId ? `${externalIdentities.length} 条绑定` : '选择用户后查看绑定' }}</span></div>
          <p class="iam-form-alert"><ConsoleIcon name="info" />为保护外部身份隐私，列表不会回显外部主体标识。</p>
          <div class="console-table-card"><div class="console-table-scroll"><table class="console-data-table iam-data-table"><thead><tr><th>绑定 ID</th><th>身份提供商</th><th>状态</th><th>绑定时间</th><th class="console-actions-cell">操作</th></tr></thead><tbody>
            <tr v-if="loading.externalIdentities"><td class="console-empty" colspan="5">正在读取外部身份…</td></tr>
            <tr v-else-if="!selectedExternalIdentityUserId"><td class="console-empty" colspan="5">请选择用户。</td></tr>
            <tr v-else-if="!externalIdentities.length"><td class="console-empty" colspan="5">该用户暂无外部身份绑定。</td></tr>
            <tr v-for="item in externalIdentities" :key="item.binding_id"><td class="console-mono">{{ item.binding_id }}</td><td class="console-mono">{{ item.provider_id }}</td><td><span class="console-badge" :class="(item.status || '').toUpperCase() === 'ACTIVE' ? 'status-active' : 'status-disabled'">{{ displayStatus(item.status) }}</span></td><td class="console-mono">{{ formatDateTime(item.bound_at) }}</td><td class="console-actions-cell"><button class="console-text-button danger" type="button" @click="removeExternalIdentity(item)">解绑</button></td></tr>
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
        <section v-if="detail.kind === 'user'" class="iam-detail-section iam-contract-access">
          <div class="iam-detail-section-head">
            <div><h4>合同系统权限</h4><p>每个用户只绑定一个预置角色；最终权限为角色默认权限与附加权限的并集。</p></div>
            <span v-if="contractAccess" class="iam-contract-revision">策略版本 {{ contractAccess.authz_revision }}</span>
          </div>
          <p v-if="contractAccessLoading" class="iam-empty-inline">正在读取合同系统权限…</p>
          <template v-else>
            <p v-if="contractAccessError" class="login-target-module__error" role="alert">{{ contractAccessError }}</p>
            <div class="iam-contract-access-form">
              <label><span>预置角色 *</span><select v-model="contractAccessDraft.role_code"><option value="">请选择角色</option><option v-for="role in contractRoleOptions" :key="role.code" :value="role.code">{{ role.name }} · {{ role.code }}</option></select></label>
              <p class="iam-field-help">角色由 SYS-004 固化，普通管理界面不能新增、修改或删除角色。</p>
              <div class="iam-contract-permission-block"><strong>角色默认权限</strong><p v-if="!contractRolePermissions.length" class="iam-empty-inline">选择角色后显示默认权限。</p><div v-else class="iam-contract-permission-tags"><span v-for="permission in contractRolePermissions" :key="permission"><b>{{ contractPermissionName(permission) }}</b><code>{{ permission }}</code></span></div></div>
              <fieldset :disabled="!contractAccessDraft.role_code || contractAccessDraft.role_code === 'admin' || contractAccessSaving">
                <legend>附加权限（只增加，不抵消默认权限）</legend>
                <p v-if="contractAccessDraft.role_code === 'admin'" class="iam-field-help">超级管理员通过 all 获得全部权限，不配置附加权限。</p>
                <div v-else class="iam-contract-permission-checks"><label v-for="permission in contractCustomPermissionOptions" :key="permission.code"><input v-model="contractAccessDraft.custom_permissions" type="checkbox" :value="permission.code" /><span><b>{{ permission.name }}</b><code>{{ permission.code }}</code></span></label></div>
              </fieldset>
              <div class="iam-contract-permission-block effective"><strong>最终有效权限预览</strong><div class="iam-contract-permission-tags"><span v-for="permission in contractEffectivePermissions" :key="permission"><b>{{ contractPermissionName(permission) }}</b><code>{{ permission }}</code></span></div><p class="iam-field-help">服务端保存时会重新计算，前端不会提交 effective_permissions。</p></div>
            </div>
          </template>
        </section>
        <footer><button class="console-button ghost" type="button" :disabled="contractAccessSaving" @click="closeDetail">关闭</button><button v-if="detail.kind === 'user'" class="console-button primary" type="button" :disabled="contractAccessLoading || contractAccessSaving" @click="saveContractAccess"><ConsoleIcon name="save" />{{ contractAccessSaving ? '保存中…' : '保存合同权限' }}</button></footer>
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
        <header><div><p>新增</p><h3>新增 {{ editor.label }}</h3></div><button class="console-modal-close" type="button" aria-label="关闭表单" :disabled="saving" @click="closeEditor"><ConsoleIcon name="close" /></button></header>
        <form class="iam-editor-form" @submit.prevent="saveEditor">
          <template v-if="editor.kind === 'user'">
            <p class="iam-form-alert"><ConsoleIcon name="info" />员工编号由后端自动生成；创建成功后自动绑定“普通用户”角色。</p>
            <label><span>展示姓名 *</span><input v-model="form.display_name" required maxlength="100" placeholder="例如：张三" /></label>
            <label><span>邮箱</span><input v-model="form.email" type="email" placeholder="例如：zhang.san@example.com" /></label>
            <label><span>手机</span><input v-model="form.mobile" maxlength="32" placeholder="例如：13800000000" /></label>
            <label><span>状态</span><select v-model="form.status"><option value="ACTIVE">启用</option><option value="DISABLED">停用</option></select></label>
          </template>
          <template v-else-if="editor.kind === 'user-batch'">
            <p class="iam-form-alert"><ConsoleIcon name="info" />每行一位用户，格式为“姓名,邮箱,手机号”；邮箱和手机号可留空，一次最多 100 位。整批数据在一个事务中创建，任一行失败会全部回滚。</p>
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
          <template v-else-if="editor.kind === 'external-identity'">
            <label><span>用户 *</span><select v-model="form.user_id" required><option value="">请选择用户</option><option v-for="item in users" :key="item.user_id" :value="item.user_id">{{ item.display_name }} · {{ item.user_id }}</option></select></label>
            <label><span>身份提供商 *</span><select v-model="form.provider_code" required><option value="">请选择提供商</option><option v-for="item in identityProviders" :key="item.provider_id || item.code" :value="item.code">{{ item.display_name || item.code }} · {{ item.code }}</option></select></label>
            <label class="full"><span>外部主体标识 *</span><input v-model="form.external_subject" required autocomplete="off" placeholder="例如：IdP 中的 subject / immutable ID" /><small class="iam-field-help">该值只在提交时发送给后端，不会在本页面回显。</small></label>
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
