import { createRequest, API_BASE_URL } from '../../shared/api/request.js'

export class IamError extends Error {
  constructor(message, options = {}) {
    super(message)
    this.name = 'IamError'
    this.status = options.status || 0
    this.code = options.code || ''
    this.traceId = options.traceId || ''
    this.details = options.details || null
    // 保留原始错误对象，便于上层排查网络层、JSON 解析等非 HTTP 失败。
    this.cause = options.cause || null
  }
}



const request = createRequest({ ErrorClass: IamError, networkMessage: '无法连接 IAM 服务，请确认后端服务已启动。', failureMessage: 'IAM 请求失败。' })

function pageQuery(parameters = {}) {
  const search = new URLSearchParams()
  Object.entries(parameters).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return
    search.set(key, String(value))
  })
  const encoded = search.toString()
  return encoded ? `?${encoded}` : ''
}

function normalize(value) {
  if (!value || typeof value !== 'object') {
    return { items: [], total: 0, page: 1, pageSize: 20 }
  }
  return {
    items: Array.isArray(value.items) ? value.items : [],
    total: Number(value.total || 0),
    page: Number(value.page || 1),
    pageSize: Number(value.page_size || 20),
  }
}

// --- Users ---

export function listUsers({ page = 1, pageSize = 50, keyword = '', status = '' } = {}) {
  return request(`/users${pageQuery({ page, page_size: pageSize, keyword, 'filter[status]': status })}`).then(normalize)
}

export function getUser(userId) {
  return request(`/users/${encodeURIComponent(userId)}`)
}

export function createUser({ displayName, email = null, mobile = null, status = 'ACTIVE' }) {
  return request('/users', {
    method: 'POST',
    body: JSON.stringify({ display_name: displayName, email, mobile, status }),
  })
}

// 原子员工入职契约：后端在同一事务内创建用户及可选本地账号、任职，调用方无需在
// 部分成功后重试账号写入。
export function createEmployee({ user, account = null, membership = null }) {
  return request('/employees', {
    method: 'POST',
    body: JSON.stringify({ user, account, membership }),
  })
}

function employeeEndpointUnavailable(error) {
  // 只有这些响应能确认 /employees 能力未部署或未启用。其他失败可能已执行过原子写入，
  // 不能降级重试，否则可能创建重复账号。
  return [404, 405, 501].includes(Number(error?.status))
}

function employeeOnboardingPartialError(message, error) {
  return new IamError(message, {
    status: error?.status,
    code: error?.code,
    traceId: error?.traceId,
  })
}

// UI 始终优先调用 POST /employees。仅在后端分阶段发布且端点明确不可用时，才按文档
// 兼容路径依次调用 users → 可选 accounts → 可选 memberships；每步最多一次，避免重试
// 意外创建第二个本地账号。兼容路径不是原子事务，失败时会返回已完成阶段供人工处置。
export async function onboardEmployee({ user, account = null, membership = null }) {
  try {
    const result = await createEmployee({ user, account, membership })
    return { ...result, onboarding_mode: 'ATOMIC' }
  } catch (error) {
    if (!employeeEndpointUnavailable(error)) throw error
  }

  if (!membership) {
    throw new IamError('用户必须与任职关系一起创建；当前服务端未提供原子员工入职接口。')
  }

  const userResult = await createUser({
    displayName: user?.display_name,
    email: user?.email ?? null,
    mobile: user?.mobile ?? null,
    status: user?.status || 'ACTIVE',
  })
  const userId = userResult?.user_id || userResult?.id
  if (!userId) {
    throw new IamError('员工档案已创建，但服务端未返回用户 ID；未继续创建账号或任职关系。')
  }

  let accountResult = null
  if (account) {
    try {
      accountResult = await createLocalAccount({
        userId,
        accountName: account.account_name,
        initialPassword: account.initial_password,
        validUntil: account.valid_until ?? null,
      })
    } catch (error) {
      throw employeeOnboardingPartialError(
        `员工档案已创建，但本地账号未创建。为避免重复账号，系统没有自动重试：${error?.message || '请在“登录账号”中补建。'}`,
        error,
      )
    }
  }

  let membershipResult = null
  if (membership) {
    try {
      membershipResult = await createMembership({
        userId,
        orgUnitId: membership.org_unit_id,
        positionId: membership.position_id,
        membershipType: membership.membership_type || 'PRIMARY',
        effectiveFrom: membership.effective_from ?? null,
        effectiveTo: membership.effective_to ?? null,
        inheritAuthorization: membership.inherit_authorization !== false,
      })
    } catch (error) {
      throw employeeOnboardingPartialError(
        `员工档案${account ? '和本地账号' : ''}已创建，但任职关系未创建。为避免重复写入，系统没有自动重试：${error?.message || '请在“任职关系”中补建。'}`,
        error,
      )
    }
  }

  return {
    user: userResult,
    account: accountResult,
    membership: membershipResult,
    onboarding_mode: 'COMPATIBILITY',
  }
}

// 最多原子创建 100 个用户。工号和默认平台角色由后端管理；可选应用角色属于 USER
// 例外授权，标准人员权限必须来自任职关系和岗位授权模板。
export function createUsersBatch(items) {
  return request('/users/batch', {
    method: 'POST',
    body: JSON.stringify({
      items: items.map((item) => ({
        display_name: item.displayName,
        email: item.email,
        mobile: item.mobile,
        status: item.status || 'ACTIVE',
        application_roles: Array.isArray(item.applicationRoles)
          ? item.applicationRoles.map((role) => ({
            ...(role.applicationCode ? { application_code: role.applicationCode } : {}),
            ...(role.applicationName ? { application_name: role.applicationName } : {}),
            ...(role.roleCode ? { role_code: role.roleCode } : {}),
            ...(role.roleName ? { role_name: role.roleName } : {}),
          }))
          : [],
      })),
    }),
  })
}

// 批量创建员工：用户、主任职关系和可选应用角色在平台后端同一事务中写入。
export function createEmployeesBatch(items) {
  return request('/employees/batch', {
    method: 'POST',
    body: JSON.stringify({
      items: items.map((item) => ({
        display_name: item.displayName,
    email: item.email,
    mobile: item.mobile,
    status: item.status || 'ACTIVE',
    line_no: item.lineNo,
    organization: item.organizationName,
        organization_name: item.organizationName,
        position: item.positionName,
        position_name: item.positionName,
        application_roles: Array.isArray(item.applicationRoles)
          ? item.applicationRoles.map((role) => ({
            ...(role.applicationCode ? { application_code: role.applicationCode } : {}),
            ...(role.applicationName ? { application_name: role.applicationName } : {}),
            ...(role.roleCode ? { role_code: role.roleCode } : {}),
            ...(role.roleName ? { role_name: role.roleName } : {}),
          }))
          : [],
      })),
    }),
  })
}


export function updateUser({ userId, displayName, employeeNo = '', email = '', mobile = '', status, version }) {
  return request(`/users/${encodeURIComponent(userId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ display_name: displayName, employee_no: employeeNo, email, mobile, status, version }),
  })
}

// 业务删除由后端原子完成关联登录账号、任职的停用隐藏以及活跃会话撤销；version 防止旧页面误删新版本。
export function deleteUser({ userId, version }) {
  return request(`/users/${encodeURIComponent(userId)}`, {
    method: 'DELETE',
    body: JSON.stringify({ version }),
  })
}

// --- Accounts ---

export function listAccounts({ page = 1, pageSize = 50, keyword = '', status = '' } = {}) {
  return request(`/accounts${pageQuery({ page, page_size: pageSize, keyword, 'filter[status]': status })}`).then(normalize)
}

export function createLocalAccount({ userId, accountName, initialPassword, validUntil = null }) {
  return request('/accounts', {
    method: 'POST',
    body: JSON.stringify({ user_id: userId, account_name: accountName, initial_password: initialPassword, valid_until: validUntil }),
  })
}

export function updateAccountStatus({ accountId, status, version }) {
  return request(`/accounts/${encodeURIComponent(accountId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ status, version }),
  })
}

// 密码重置由服务端生成一次性临时密码；前端不接收或提交管理员自选的新密码。
export function resetAccountPassword({ accountId, version }) {
  return request(`/accounts/${encodeURIComponent(accountId)}/password/reset`, {
    method: 'POST',
    body: JSON.stringify({ version }),
  })
}

// --- Org Units ---

export function listOrgUnits({ page = 1, pageSize = 100, keyword = '', status = 'ACTIVE' } = {}) {
  return request(`/org-units${pageQuery({ page, page_size: pageSize, keyword, 'filter[status]': status })}`).then(normalize)
}

export function createOrgUnit({ parentId = null, name, sortOrder = 0 }) {
  return request('/org-units', {
    method: 'POST',
    body: JSON.stringify({ parent_id: parentId, name, sort_order: sortOrder }),
  })
}

export function updateOrgUnit({ orgUnitId, parentId = null, name, sortOrder = 0, version }) {
  return request(`/org-units/${encodeURIComponent(orgUnitId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ parent_id: parentId, name, sort_order: sortOrder, version }),
  })
}

export function deleteOrgUnit({ orgUnitId, version }) {
  return request(`/org-units/${encodeURIComponent(orgUnitId)}`, {
    method: 'DELETE',
    body: JSON.stringify({ version }),
  })
}

// --- Positions ---

export function listPositions({ page = 1, pageSize = 100, keyword = '', status = 'ACTIVE' } = {}) {
  return request(`/positions${pageQuery({ page, page_size: pageSize, keyword, 'filter[status]': status })}`).then(normalize)
}

export function createPosition({ orgUnitId, name }) {
  return request('/positions', {
    method: 'POST',
    body: JSON.stringify({ org_unit_id: orgUnitId, name }),
  })
}

export function deletePosition({ positionId, version }) {
  return request(`/positions/${encodeURIComponent(positionId)}`, {
    method: 'DELETE',
    body: JSON.stringify({ version }),
  })
}

// --- Memberships ---

export function listMemberships({ page = 1, pageSize = 50, keyword = '', status = '' } = {}) {
  return request(`/memberships${pageQuery({ page, page_size: pageSize, keyword, 'filter[status]': status })}`).then(normalize)
}

export function createMembership({
  userId,
  orgUnitId,
  positionId,
  membershipType = 'PRIMARY',
  effectiveFrom = null,
  effectiveTo = null,
  inheritAuthorization = true,
}) {
  return request('/memberships', {
    method: 'POST',
    body: JSON.stringify({
      user_id: userId,
      org_unit_id: orgUnitId,
      position_id: positionId,
      membership_type: membershipType,
      effective_from: effectiveFrom,
      effective_to: effectiveTo,
      inherit_authorization: inheritAuthorization !== false,
    }),
  })
}

// 更新完整的带生效期任职关系；显式 inheritAuthorization 决定该任职是否参与岗位模板授权继承。
export function updateMembership({
  membershipId,
  orgUnitId,
  positionId,
  membershipType = 'PRIMARY',
  effectiveFrom = null,
  effectiveTo = null,
  inheritAuthorization = true,
  status = 'ACTIVE',
  version,
}) {
  return request(`/memberships/${encodeURIComponent(membershipId)}`, {
    method: 'PATCH',
    body: JSON.stringify({
      org_unit_id: orgUnitId,
      position_id: positionId,
      membership_type: membershipType,
      effective_from: effectiveFrom,
      effective_to: effectiveTo,
      inherit_authorization: inheritAuthorization !== false,
      status,
      version,
    }),
  })
}

// 兼容仅更新状态的调用方：省略 inheritAuthorization 表示保留既有继承选择，不能静默重新开启。
export function updateMembershipStatus({ membershipId, status, version, inheritAuthorization }) {
  const payload = { status, version }
  if (inheritAuthorization !== undefined) {
    payload.inherit_authorization = inheritAuthorization !== false
  }
  return request(`/memberships/${encodeURIComponent(membershipId)}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  })
}
