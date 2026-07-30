const API_BASE_URL = (import.meta.env?.VITE_API_BASE_URL || '/api/v1').replace(/\/$/, '')

export class IamError extends Error {
  constructor(message, options = {}) {
    super(message)
    this.name = 'IamError'
    this.status = options.status || 0
    this.code = options.code || ''
    this.traceId = options.traceId || ''
  }
}

async function readBody(response) {
  const contentType = response.headers.get('content-type') || ''
  if (contentType.includes('application/json')) {
    try {
      return await response.json()
    } catch {
      return {}
    }
  }
  const text = await response.text()
  return text ? { message: text } : {}
}

async function request(path, options = {}) {
  let response
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...options,
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers || {}),
      },
    })
  } catch {
    throw new IamError('无法连接 IAM 服务，请确认后端服务已启动。', { code: 'NETWORK_ERROR' })
  }
  const body = await readBody(response)
  if (!response.ok) {
    throw new IamError(body?.message || 'IAM 请求失败。', {
      status: response.status,
      code: body?.code,
      traceId: body?.request_id || body?.trace_id || body?.traceId,
    })
  }
  return body?.data
}

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

// createEmployee is the atomic employee onboarding contract. The backend creates the user and
// optional local account / membership in one transaction, so callers never need to retry an
// account write after a partially completed request.
export function createEmployee({ user, account = null, membership = null }) {
  return request('/employees', {
    method: 'POST',
    body: JSON.stringify({ user, account, membership }),
  })
}

function employeeEndpointUnavailable(error) {
  // These responses mean the POST /employees capability is not deployed or not enabled. Do not
  // fall back after any other response: the server may already have performed an atomic write.
  return [404, 405, 501].includes(Number(error?.status))
}

function employeeOnboardingPartialError(message, error) {
  return new IamError(message, {
    status: error?.status,
    code: error?.code,
    traceId: error?.traceId,
  })
}

// onboardEmployee is the UI-facing entry point. It always prefers POST /employees. During a
// staged backend rollout only an unavailable endpoint uses the documented compatibility path:
// POST /users -> optional POST /accounts -> optional POST /memberships. Each step runs at most
// once, so the frontend never retries and accidentally creates a second local account.
export async function onboardEmployee({ user, account = null, membership = null }) {
  try {
    const result = await createEmployee({ user, account, membership })
    return { ...result, onboarding_mode: 'ATOMIC' }
  } catch (error) {
    if (!employeeEndpointUnavailable(error)) throw error
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

// createUsersBatch creates up to 100 ordinary users atomically. Employee numbers and the default
// ordinary-user role binding are generated by the backend for every item.
export function createUsersBatch(items) {
  return request('/users/batch', {
    method: 'POST',
    body: JSON.stringify({
      items: items.map((item) => ({
        display_name: item.displayName,
        email: item.email,
        mobile: item.mobile,
        status: item.status || 'ACTIVE',
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

// deleteUser performs a business deletion. The backend disables and hides associated login accounts
// and memberships, and revokes active sessions atomically. The version field prevents stale writes.
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

// resetAccountPassword asks the server to generate a one-time temporary password.
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

// updateMembership updates the complete effective-dated employment relationship. The explicit
// inheritAuthorization switch controls whether position authorization templates participate in
// effective authorization for this membership.
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

// Kept for existing status-only callers. Omitting inheritAuthorization deliberately leaves the
// existing inheritance choice unchanged instead of silently turning it back on.
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
