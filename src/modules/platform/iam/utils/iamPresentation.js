export function displayStatus(status) {
  return ({ ACTIVE: '启用', DISABLED: '停用', LOCKED: '已锁定', EXPIRED: '已失效' }[status] || status || '—')
}

export function effectiveAccountStatus(account, now = Date.now()) {
  const status = String(account?.status || '').toUpperCase()
  if (status !== 'ACTIVE') return status
  const validUntil = Date.parse(account?.valid_until || '')
  if (Number.isFinite(validUntil) && validUntil <= now) return 'EXPIRED'
  const lockedUntil = Date.parse(account?.locked_until || '')
  if (Number.isFinite(lockedUntil) && lockedUntil > now) return 'LOCKED'
  return status
}

export function displayEmployment(status) {
  return ({ ACTIVE: '在职', ON_LEAVE: '请假中', TERMINATED: '已离职' }[status] || status || '—')
}

export function displayAccountType(type) {
  return ({ HUMAN: '个人账号', SERVICE: '服务账号' }[type] || type || '—')
}

export function displayAuthSource(source) {
  return ({ LOCAL: '本地密码', FEDERATED: '联合登录' }[source] || source || '—')
}

export function displayLoginAccountType(account) {
  // 兼容后端滚动升级期间尚未返回类型字段的旧响应；新增账号固定为个人本地账号。
  return `${displayAccountType(account?.account_type || 'HUMAN')} / ${displayAuthSource(account?.auth_source || 'LOCAL')}`
}

export function displayMembershipValidity(membership) {
  if (!membership?.effective_from && !membership?.effective_to) return '长期生效'
  return `${membership?.effective_from || '—'} ～ ${membership?.effective_to || '—'}`
}

export function displayOrgType(type) {
  return ({ COMPANY: '主体', DEPARTMENT: '部门', TEAM: '团队' }[type] || type || '—')
}

export function displayMembershipType(type) {
  return ({ PRIMARY: '主组织', PART_TIME: '兼岗', SECONDARY: '次组织 / 兼岗' }[type] || type || '—')
}

export function formatDateTime(value) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { hour12: false })
}

export function detailTitle(detail) {
  if (!detail) return ''
  const { kind, item } = detail
  if (!item) return ''
  if (kind === 'user') return item.display_name || item.user_id
  if (kind === 'account') return item.account_name || item.account_id
  if (kind === 'organization') return item.name || item.org_unit_id
  if (kind === 'position') return item.name || item.position_id || item.id
  if (kind === 'membership') return item.user?.name || item.org_unit?.name || item.membership_id || '任职关系'
  if (kind === 'role') return item.name || item.role_id || item.id
  if (kind === 'binding') return item.subject?.name || item.subject?.code || item.role?.name || item.binding_id || '角色绑定'
  if (kind === 'permission') return item.name || item.permission_id || item.id
  return ''
}

export function detailRows(detail) {
  if (!detail) return []
  const { kind, item } = detail
  if (!item) return []
  const rows = []
  if (kind === 'user') {
    rows.push({ label: '用户 ID', value: item.user_id })
    rows.push({ label: '工号', value: item.employee_no || '—' })
    rows.push({ label: '邮箱', value: item.email || '—' })
    rows.push({ label: '手机号（脱敏）', value: item.mobile_masked || '—' })
    rows.push({ label: '状态', value: item.status || '—' })
    rows.push({ label: '更新时间', value: formatDateTime(item.updated_at) })
  } else if (kind === 'account') {
    rows.push({ label: '账号 ID', value: item.account_id })
    rows.push({ label: '账号', value: item.account_name })
    rows.push({ label: '关联用户 ID', value: item.user_id || '—' })
    rows.push({ label: '账号类型', value: displayAccountType(item.account_type || 'HUMAN') })
    rows.push({ label: '认证方式', value: displayAuthSource(item.auth_source || 'LOCAL') })
    rows.push({ label: '状态', value: displayStatus(item.status) })
    rows.push({ label: '最近登录', value: formatDateTime(item.last_login_at) })
    rows.push({ label: '版本', value: item.version ?? 0 })
  } else if (kind === 'organization') {
    rows.push({ label: '组织 ID', value: item.org_unit_id || item.id })
    rows.push({ label: '编码', value: item.code || '—' })
    rows.push({ label: '名称', value: item.name || '—' })
    rows.push({ label: '类型', value: item.type || '—' })
    rows.push({ label: '状态', value: item.status || '—' })
    rows.push({ label: '父级 ID', value: item.parent_id || '—' })
  } else if (kind === 'position') {
    rows.push({ label: '编码', value: item.code || '—' })
    rows.push({ label: '名称', value: item.name || '—' })
    rows.push({ label: '所属组织', value: item.organization_name || item.org_unit?.name || '—' })
    rows.push({ label: '状态', value: item.status || '—' })
  } else if (kind === 'membership') {
    rows.push({ label: '任职关系 ID', value: item.membership_id || item.id })
    rows.push({ label: '用户', value: item.user?.name || item.user_id || '—' })
    rows.push({ label: '组织', value: item.org_unit?.name || item.org_unit_id || '—' })
    rows.push({ label: '岗位', value: item.position?.name || item.position_id || '—' })
    rows.push({ label: '任职类型', value: displayMembershipType(item.membership_type) })
    rows.push({ label: '生效方式', value: !item.effective_from && !item.effective_to ? '长期生效' : '短期生效' })
    rows.push({ label: '状态', value: item.status || '—' })
    rows.push({ label: '生效日期', value: item.effective_from || '—' })
    rows.push({ label: '失效日期', value: item.effective_to || '—' })
  } else if (kind === 'role') {
    rows.push({ label: '角色 ID', value: item.role_id || item.id })
    rows.push({ label: '编码', value: item.code || '—' })
    rows.push({ label: '名称', value: item.name || '—' })
    rows.push({ label: '权限', value: (item.permissions || []).map((permission) => permission.name || permission.code || permission.id).filter(Boolean).join('、') || '—' })
    rows.push({ label: '状态', value: item.status || '—' })
    rows.push({ label: '版本', value: item.version ?? 0 })
  } else if (kind === 'binding') {
    rows.push({ label: '绑定 ID', value: item.binding_id || item.id })
    rows.push({ label: '角色', value: item.role?.name || item.role?.code || item.role_id || '—' })
    rows.push({ label: '角色 ID', value: item.role?.id || item.role_id || '—' })
    rows.push({ label: '主体类型', value: item.subject_type || '—' })
    rows.push({ label: '授权主体', value: item.subject?.name || item.subject?.code || item.subject_id || '—' })
    rows.push({ label: '主体 ID', value: item.subject?.id || item.subject_id || '—' })
    rows.push({ label: '范围类型', value: item.scope_type || '—' })
    rows.push({ label: '范围 ID', value: item.scope_id || '租户级' })
    rows.push({ label: '状态', value: item.status || '—' })
    rows.push({ label: '过期时间', value: formatDateTime(item.expires_at) })
    rows.push({ label: '版本', value: item.version ?? 0 })
  } else if (kind === 'permission') {
    rows.push({ label: '权限 ID', value: item.permission_id || item.id })
    rows.push({ label: '编码', value: item.code || '—' })
    rows.push({ label: '名称', value: item.name || '—' })
    rows.push({ label: '动作', value: item.action || '—' })
    rows.push({ label: '资源 ID', value: item.resource_id || item.resource?.id || '—' })
    rows.push({ label: '状态', value: item.status || '—' })
  }
  return rows
}
