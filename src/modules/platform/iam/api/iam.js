import { createRequest, API_BASE_URL } from '../../shared/api/request.js'

/**
 * IamError 表示 IAM 接口返回的结构化错误。
 *
 * @property {number} status HTTP 状态码；网络异常时为 0。
 * @property {string} code 服务端错误码。
 * @property {string} traceId 用于排查的请求跟踪标识。
 * @property {Object|null} details 服务端返回的结构化错误详情。
 * @property {Error|null} cause 网络层或解析异常的原始错误。
 */
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



const request = createRequest({
  ErrorClass: IamError,
  networkMessage: '无法连接 IAM 服务，请确认后端服务已启动。',
  failureMessage: 'IAM 请求失败。',
  subsystem: 'platform',
  feature: 'iam',
})

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

/**
 * listUsers 分页查询用户，并可按关键字和状态筛选。
 * @param {Object} [options] 查询参数。
 * @param {number} [options.page=1] 页码。
 * @param {number} [options.pageSize=50] 每页数量。
 * @param {string} [options.keyword] 姓名、邮箱或手机号关键字。
 * @param {string} [options.status] 用户状态。
 * @returns {Promise<{items: Array<Object>, total: number, page: number, pageSize: number}>} 返回标准化的用户分页数据。
 * @throws {IamError} 会话无效、无查询权限或 IAM 服务不可用时抛出。
 */
export function listUsers({ page = 1, pageSize = 50, keyword = '', status = '' } = {}) {
  return request(`/users${pageQuery({ page, page_size: pageSize, keyword, 'filter[status]': status })}`).then(normalize)
}

/**
 * getUser 查询指定用户的详细资料。
 * @param {string} userId 用户标识。
 * @returns {Promise<Object>} 返回用户详情。
 * @throws {IamError} 用户不存在、无访问权限或 IAM 服务不可用时抛出。
 */
export function getUser(userId) {
  return request(`/users/${encodeURIComponent(userId)}`)
}

/**
 * createUser 创建用户档案。
 * @param {Object} options 用户参数。
 * @param {string} options.displayName 用户显示姓名。
 * @param {string|null} [options.email] 邮箱。
 * @param {string|null} [options.mobile] 手机号。
 * @param {string} [options.status='ACTIVE'] 用户状态。
 * @returns {Promise<Object>} 返回新建的用户档案。
 * @throws {IamError} 用户数据无效、唯一字段冲突或操作无权限时抛出。
 */
export function createUser({ displayName, email = null, mobile = null, status = 'ACTIVE' }) {
  return request('/users', {
    method: 'POST',
    body: JSON.stringify({ display_name: displayName, email, mobile, status }),
  })
}

/**
 * createEmployee 在同一服务端事务中创建用户及可选本地账号、任职关系。
 * @param {Object} options 员工入职参数。
 * @param {Object} options.user 用户档案数据。
 * @param {Object|null} [options.account] 本地账号数据。
 * @param {Object|null} [options.membership] 任职关系数据。
 * @returns {Promise<Object>} 返回原子创建的员工结果。
 * @throws {IamError} 任一入职数据无效、存在唯一性冲突或事务执行失败时抛出。
 */
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

/**
 * onboardEmployee 优先原子创建员工，仅在原子端点未部署时使用兼容流程。
 *
 * 兼容流程按用户、可选账号、任职关系的顺序各执行一次，避免部分成功后自动重试导致重复数据。
 *
 * @param {Object} options 员工入职参数。
 * @param {Object} options.user 用户档案数据。
 * @param {Object|null} [options.account] 本地账号数据。
 * @param {Object|null} [options.membership] 任职关系数据。
 * @returns {Promise<Object>} 返回入职结果及 ATOMIC 或 COMPATIBILITY 模式。
 * @throws {IamError} 原子请求失败、兼容模式缺少任职，或兼容流程出现部分成功时抛出。
 */
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

/**
 * createUsersBatch 原子批量创建用户，单次最多处理 100 条。
 *
 * 工号和默认平台角色由后端管理；可选应用角色仅作为用户例外授权。
 *
 * @param {Array<Object>} items 用户导入项。
 * @returns {Promise<Object>} 返回批量创建结果。
 * @throws {IamError} 数量超限、任一条数据无效、存在冲突或原子事务失败时抛出。
 */
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

/**
 * createEmployeesBatch 在同一事务中批量创建用户、主任职关系及可选应用角色。
 * @param {Array<Object>} items 包含中文组织、岗位名称的员工导入项。
 * @returns {Promise<Object>} 返回批量创建及行号对应结果。
 * @throws {IamError} 组织或岗位无法解析、任一条数据无效或原子事务失败时抛出。
 */
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


/**
 * updateUser 更新用户档案及状态。
 * @param {Object} options 更新参数。
 * @param {string} options.userId 用户标识。
 * @param {string} options.displayName 用户显示姓名。
 * @param {string} [options.employeeNo] 工号。
 * @param {string} [options.email] 邮箱。
 * @param {string} [options.mobile] 手机号。
 * @param {string} options.status 用户状态。
 * @param {number} options.version 当前乐观锁版本号。
 * @returns {Promise<Object>} 返回更新后的用户档案。
 * @throws {IamError} 用户不存在、版本冲突、数据无效或操作无权限时抛出。
 */
export function updateUser({ userId, displayName, employeeNo = '', email = '', mobile = '', status, version }) {
  return request(`/users/${encodeURIComponent(userId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ display_name: displayName, employee_no: employeeNo, email, mobile, status, version }),
  })
}

/**
 * deleteUser 业务删除用户，并由后端原子停用关联账号、任职及活跃会话。
 * @param {Object} options 删除参数。
 * @param {string} options.userId 用户标识。
 * @param {number} options.version 当前乐观锁版本号。
 * @returns {Promise<Object>} 返回用户删除结果。
 * @throws {IamError} 用户不存在、版本冲突或不允许删除时抛出。
 */
export function deleteUser({ userId, version }) {
  return request(`/users/${encodeURIComponent(userId)}`, {
    method: 'DELETE',
    body: JSON.stringify({ version }),
  })
}

// --- Accounts ---

/**
 * listAccounts 分页查询本地登录账号。
 * @param {Object} [options] 查询参数。
 * @param {number} [options.page=1] 页码。
 * @param {number} [options.pageSize=50] 每页数量。
 * @param {string} [options.keyword] 账号或用户关键字。
 * @param {string} [options.status] 账号状态。
 * @returns {Promise<{items: Array<Object>, total: number, page: number, pageSize: number}>} 返回标准化的账号分页数据。
 * @throws {IamError} 会话无效、无查询权限或 IAM 服务不可用时抛出。
 */
export function listAccounts({ page = 1, pageSize = 50, keyword = '', status = '' } = {}) {
  return request(`/accounts${pageQuery({ page, page_size: pageSize, keyword, 'filter[status]': status })}`).then(normalize)
}

/**
 * createLocalAccount 为用户创建本地登录账号。
 * @param {Object} options 账号参数。
 * @param {string} options.userId 关联用户标识。
 * @param {string} options.accountName 登录账号名。
 * @param {string} options.initialPassword 初始密码。
 * @param {string|null} [options.validUntil] 账号有效期截止时间。
 * @returns {Promise<Object>} 返回新建的本地账号。
 * @throws {IamError} 用户不存在、账号名冲突、密码不合规或操作无权限时抛出。
 */
export function createLocalAccount({ userId, accountName, initialPassword, validUntil = null }) {
  return request('/accounts', {
    method: 'POST',
    body: JSON.stringify({ user_id: userId, account_name: accountName, initial_password: initialPassword, valid_until: validUntil }),
  })
}

/**
 * updateAccountStatus 更新本地登录账号状态。
 * @param {Object} options 更新参数。
 * @param {string} options.accountId 账号标识。
 * @param {string} options.status 目标状态。
 * @param {number} options.version 当前乐观锁版本号。
 * @returns {Promise<Object>} 返回更新后的账号。
 * @throws {IamError} 账号不存在、状态转换无效、版本冲突或操作无权限时抛出。
 */
export function updateAccountStatus({ accountId, status, version }) {
  return request(`/accounts/${encodeURIComponent(accountId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ status, version }),
  })
}

/**
 * resetAccountPassword 请求服务端为本地账号生成一次性临时密码。
 *
 * 前端不接收或提交管理员自选的新密码。
 *
 * @param {Object} options 重置参数。
 * @param {string} options.accountId 账号标识。
 * @param {number} options.version 当前乐观锁版本号。
 * @returns {Promise<Object>} 返回密码重置结果及一次性凭据。
 * @throws {IamError} 账号不存在、版本冲突、账号状态不允许重置或操作无权限时抛出。
 */
export function resetAccountPassword({ accountId, version }) {
  return request(`/accounts/${encodeURIComponent(accountId)}/password/reset`, {
    method: 'POST',
    body: JSON.stringify({ version }),
  })
}

// --- Org Units ---

/**
 * listOrgUnits 分页查询组织单元。
 * @param {Object} [options] 查询参数。
 * @param {number} [options.page=1] 页码。
 * @param {number} [options.pageSize=100] 每页数量。
 * @param {string} [options.keyword] 组织名称关键字。
 * @param {string} [options.status='ACTIVE'] 组织状态。
 * @returns {Promise<{items: Array<Object>, total: number, page: number, pageSize: number}>} 返回标准化的组织分页数据。
 * @throws {IamError} 会话无效、无查询权限或 IAM 服务不可用时抛出。
 */
export function listOrgUnits({ page = 1, pageSize = 100, keyword = '', status = 'ACTIVE' } = {}) {
  return request(`/org-units${pageQuery({ page, page_size: pageSize, keyword, 'filter[status]': status })}`).then(normalize)
}

/**
 * createOrgUnit 创建组织单元。
 * @param {Object} options 组织参数。
 * @param {string|null} [options.parentId] 父组织标识；顶级组织为 null。
 * @param {string} options.name 组织名称。
 * @param {number} [options.sortOrder=0] 同级排序值。
 * @returns {Promise<Object>} 返回新建的组织单元。
 * @throws {IamError} 父组织不存在、名称冲突、数据无效或操作无权限时抛出。
 */
export function createOrgUnit({ parentId = null, name, sortOrder = 0 }) {
  return request('/org-units', {
    method: 'POST',
    body: JSON.stringify({ parent_id: parentId, name, sort_order: sortOrder }),
  })
}

/**
 * updateOrgUnit 更新组织单元的层级、名称和排序。
 * @param {Object} options 更新参数。
 * @param {string} options.orgUnitId 组织标识。
 * @param {string|null} [options.parentId] 父组织标识。
 * @param {string} options.name 组织名称。
 * @param {number} [options.sortOrder=0] 同级排序值。
 * @param {number} options.version 当前乐观锁版本号。
 * @returns {Promise<Object>} 返回更新后的组织单元。
 * @throws {IamError} 组织不存在、层级形成循环、版本冲突或操作无权限时抛出。
 */
export function updateOrgUnit({ orgUnitId, parentId = null, name, sortOrder = 0, version }) {
  return request(`/org-units/${encodeURIComponent(orgUnitId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ parent_id: parentId, name, sort_order: sortOrder, version }),
  })
}

/**
 * deleteOrgUnit 删除指定组织单元。
 * @param {Object} options 删除参数。
 * @param {string} options.orgUnitId 组织标识。
 * @param {number} options.version 当前乐观锁版本号。
 * @returns {Promise<Object>} 返回组织删除结果。
 * @throws {IamError} 组织不存在、仍有子组织或关联数据、版本冲突时抛出。
 */
export function deleteOrgUnit({ orgUnitId, version }) {
  return request(`/org-units/${encodeURIComponent(orgUnitId)}`, {
    method: 'DELETE',
    body: JSON.stringify({ version }),
  })
}

// --- Positions ---

/**
 * listPositions 分页查询岗位。
 * @param {Object} [options] 查询参数。
 * @param {number} [options.page=1] 页码。
 * @param {number} [options.pageSize=100] 每页数量。
 * @param {string} [options.keyword] 岗位名称关键字。
 * @param {string} [options.status='ACTIVE'] 岗位状态。
 * @returns {Promise<{items: Array<Object>, total: number, page: number, pageSize: number}>} 返回标准化的岗位分页数据。
 * @throws {IamError} 会话无效、无查询权限或 IAM 服务不可用时抛出。
 */
export function listPositions({ page = 1, pageSize = 100, keyword = '', status = 'ACTIVE' } = {}) {
  return request(`/positions${pageQuery({ page, page_size: pageSize, keyword, 'filter[status]': status })}`).then(normalize)
}

/**
 * createPosition 在指定组织单元下创建岗位。
 * @param {Object} options 岗位参数。
 * @param {string} options.orgUnitId 所属组织标识。
 * @param {string} options.name 岗位名称。
 * @returns {Promise<Object>} 返回新建的岗位。
 * @throws {IamError} 组织不存在、岗位名称冲突、数据无效或操作无权限时抛出。
 */
export function createPosition({ orgUnitId, name }) {
  return request('/positions', {
    method: 'POST',
    body: JSON.stringify({ org_unit_id: orgUnitId, name }),
  })
}

/**
 * deletePosition 删除指定岗位。
 * @param {Object} options 删除参数。
 * @param {string} options.positionId 岗位标识。
 * @param {number} options.version 当前乐观锁版本号。
 * @returns {Promise<Object>} 返回岗位删除结果。
 * @throws {IamError} 岗位不存在、仍有任职或授权模板关联、版本冲突时抛出。
 */
export function deletePosition({ positionId, version }) {
  return request(`/positions/${encodeURIComponent(positionId)}`, {
    method: 'DELETE',
    body: JSON.stringify({ version }),
  })
}

// --- Memberships ---

/**
 * listMemberships 分页查询用户任职关系。
 * @param {Object} [options] 查询参数。
 * @param {number} [options.page=1] 页码。
 * @param {number} [options.pageSize=50] 每页数量。
 * @param {string} [options.keyword] 用户、组织或岗位关键字。
 * @param {string} [options.status] 任职状态。
 * @returns {Promise<{items: Array<Object>, total: number, page: number, pageSize: number}>} 返回标准化的任职分页数据。
 * @throws {IamError} 会话无效、无查询权限或 IAM 服务不可用时抛出。
 */
export function listMemberships({ page = 1, pageSize = 50, keyword = '', status = '' } = {}) {
  return request(`/memberships${pageQuery({ page, page_size: pageSize, keyword, 'filter[status]': status })}`).then(normalize)
}

/**
 * createMembership 创建用户在组织与岗位中的任职关系。
 * @param {Object} options 任职参数。
 * @param {string} options.userId 用户标识。
 * @param {string} options.orgUnitId 组织标识。
 * @param {string} options.positionId 岗位标识。
 * @param {string} [options.membershipType='PRIMARY'] 任职类型。
 * @param {string|null} [options.effectiveFrom] 生效开始时间。
 * @param {string|null} [options.effectiveTo] 生效结束时间。
 * @param {boolean} [options.inheritAuthorization=true] 是否继承岗位授权模板。
 * @returns {Promise<Object>} 返回新建的任职关系。
 * @throws {IamError} 用户、组织或岗位不存在，任职时间无效或关系冲突时抛出。
 */
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

/**
 * updateMembership 更新完整的任职关系及生效期。
 * @param {Object} options 任职更新参数。
 * @param {string} options.membershipId 任职关系标识。
 * @param {string} options.orgUnitId 组织标识。
 * @param {string} options.positionId 岗位标识。
 * @param {string} [options.membershipType='PRIMARY'] 任职类型。
 * @param {string|null} [options.effectiveFrom] 生效开始时间。
 * @param {string|null} [options.effectiveTo] 生效结束时间。
 * @param {boolean} [options.inheritAuthorization=true] 是否继承岗位授权模板。
 * @param {string} [options.status='ACTIVE'] 任职状态。
 * @param {number} options.version 当前乐观锁版本号。
 * @returns {Promise<Object>} 返回更新后的任职关系。
 * @throws {IamError} 任职不存在、时间范围或主任职约束无效、版本冲突时抛出。
 */
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

/**
 * updateMembershipStatus 更新任职状态，并可选调整岗位授权继承。
 *
 * 省略 inheritAuthorization 时保留已有继承设置，不会静默重新开启。
 *
 * @param {Object} options 状态更新参数。
 * @param {string} options.membershipId 任职关系标识。
 * @param {string} options.status 目标状态。
 * @param {number} options.version 当前乐观锁版本号。
 * @param {boolean} [options.inheritAuthorization] 是否继承岗位授权。
 * @returns {Promise<Object>} 返回更新后的任职关系。
 * @throws {IamError} 任职不存在、状态转换无效、版本冲突或操作无权限时抛出。
 */
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
