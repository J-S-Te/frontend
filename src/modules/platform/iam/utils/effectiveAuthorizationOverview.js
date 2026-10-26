/**
 * 有效授权总览的展示层工具：只解释后端已经计算好的应用/角色/来源，
 * 不重新判断授权、不合并不同来源的环境或有效期。
 */
import { formatDateTime } from './iamPresentation.js'

const KNOWN_STATES = new Set(['GRANTED', 'CONFLICT', 'UNAUTHORIZED'])

export function normalizeAuthorizationState(access) {
  const state = String(access?.authorization_state || '').trim().toUpperCase()
  return KNOWN_STATES.has(state) ? state : 'UNKNOWN'
}

export function applicationCodeOf(entry) {
  return String(entry?.access?.application_code || entry?.application?.code || '').trim()
}

export function applicationNameOf(entry, code = '') {
  return String(entry?.application?.name || entry?.application?.display_name || code || '未命名应用').trim()
}

export function roleCodeOf(role) {
  return String(role?.code || role?.role_code || '').trim()
}

export function roleNameOf(role) {
  return String(role?.name || role?.display_name || roleCodeOf(role) || '未命名角色').trim()
}

export function roleIdentityOf(role, applicationCode = '') {
  const id = String(role?.role_id || role?.id || '').trim()
  if (id) return `id:${id}`
  const code = roleCodeOf(role)
  return code ? `code:${applicationCode}::${code}` : `name:${applicationCode}::${roleNameOf(role)}`
}

export function roleSourceLabel(role) {
  const origin = String(role?.grant_origin || '').trim().toUpperCase()
  const sourceType = String(role?.source_type || '').trim().toUpperCase()
  const sourceKind = String(role?.source_kind || '').trim().toUpperCase()
  if (origin === 'SYSTEM' || sourceKind === 'SYSTEM') return '系统来源'
  if (sourceType === 'ORG_UNIT') return '组织继承'
  if (origin === 'TEMPLATE' || sourceType === 'POSITION') return '岗位模板'
  if (sourceType === 'USER' && (!origin || origin === 'MANUAL')) return '个人例外'
  return '其他来源'
}

export function roleScopeText(source) {
  const scopeType = String(source?.scope_type || '').trim().toUpperCase()
  if (!scopeType) return '接口未提供'
  if (scopeType === 'ENVIRONMENT') {
    const environment = String(source?.environment_code || source?.scope_id || '').trim()
    return environment ? `指定环境：${environment}` : '接口未提供'
  }
  return '整个应用'
}

export function roleValidityText(source) {
  const hasFrom = Boolean(source && Object.prototype.hasOwnProperty.call(source, 'valid_from'))
  const hasUntil = Boolean(source && Object.prototype.hasOwnProperty.call(source, 'valid_until'))
  if (!hasFrom && !hasUntil) return '接口未提供'
  if (!source?.valid_from && !source?.valid_until) {
    return source?.valid_from === null && source?.valid_until === null ? '长期有效' : '接口未提供'
  }
  const from = source?.valid_from ? formatDateTime(source.valid_from) : '接口未提供'
  const until = source?.valid_until ? formatDateTime(source.valid_until) : '接口未提供'
  return `${from} 至 ${until}`
}

export function sourceNameOf(source) {
  return String(source?.source_name || '').trim() || '接口未提供'
}

export function technicalFieldsOf(row, group, source) {
  const fields = [
    ['应用编码', row.application_code],
    ['角色 ID', group.role_id],
    ['角色编码', group.code],
    ['来源类型', source?.source_type],
    ['来源 ID', source?.source_id],
    ['授予来源', source?.grant_origin],
    ['来源记录 ID', source?.origin_id],
    ['来源项 ID', source?.origin_item_id],
    ['范围类型', source?.scope_type],
    ['范围 ID', source?.scope_id],
    ['环境', source?.environment_code],
    ['生效时间', source?.valid_from],
    ['失效时间', source?.valid_until],
  ]
  return fields
    .filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== '')
    .map(([label, value]) => ({ label, value: String(value) }))
}

function groupRoles(rawRoles, applicationCode, effective) {
  const groups = []
  const index = new Map()
  for (const role of Array.isArray(rawRoles) ? rawRoles : []) {
    if (!role || typeof role !== 'object') continue
    const key = roleIdentityOf(role, applicationCode)
    let group = index.get(key)
    if (!group) {
      group = {
        key,
        role_id: String(role.role_id || role.id || '').trim(),
        code: roleCodeOf(role),
        name: roleNameOf(role),
        effective,
        sources: [],
      }
      index.set(key, group)
      groups.push(group)
    }
    group.sources.push({ ...role, source_label: roleSourceLabel(role) })
  }
  return groups
}

function applicationRow(entry, order) {
  const application = entry?.application || {}
  const access = entry?.access || null
  const code = applicationCodeOf(entry)
  const name = applicationNameOf(entry, code)
  const readStatus = entry?.loading ? 'LOADING' : entry?.error ? 'ERROR' : access ? 'SUCCESS' : 'NO_RESULT'
  const state = readStatus === 'SUCCESS' ? normalizeAuthorizationState(access) : 'UNKNOWN'
  const rawRoles = Array.isArray(access?.roles) ? access.roles : []
  const groups = groupRoles(rawRoles, code, state === 'GRANTED')
  const effectiveGroups = state === 'GRANTED' ? groups : []
  const conflicts = readStatus === 'SUCCESS'
    ? (Array.isArray(access?.conflicts) ? access.conflicts : []).map((item) => String(item || '').trim()).filter(Boolean)
    : []
  return {
    application_code: code,
    application_name: name,
    application_order: order,
    read_status: readStatus,
    error_message: entry?.error ? String(entry.error) : '',
    authorization_state: state,
    roles: rawRoles,
    role_groups: groups,
    effective_role_groups: effectiveGroups,
    role_count: groups.length,
    effective_role_count: effectiveGroups.length,
    conflicts,
  }
}

export function buildUserAuthorizationOverview(entries = []) {
  const applications = []
  const roles = []
  const effectiveRoles = []
  const conflicts = []

  ;(Array.isArray(entries) ? entries : []).forEach((entry, index) => {
    const row = applicationRow(entry, index)
    applications.push(row)
    const effective = row.authorization_state === 'GRANTED'
    for (const role of row.roles) {
      const annotated = {
        ...role,
        application_code: row.application_code,
        application_name: row.application_name,
        effective,
      }
      roles.push(annotated)
      if (effective) effectiveRoles.push(annotated)
    }
    for (const conflict of row.conflicts) {
      conflicts.push(`${row.application_name}${row.application_code && row.application_name !== row.application_code ? `（${row.application_code}）` : ''}：${conflict}`)
    }
  })

  return {
    applications,
    roles,
    effective_roles: effectiveRoles,
    conflicts: [...new Set(conflicts)],
  }
}

export function sortAuthorizationApplications(applications = []) {
  const rank = (row) => {
    if (row?.read_status === 'ERROR') return 1
    if (row?.authorization_state === 'CONFLICT') return 0
    if (row?.authorization_state === 'UNKNOWN') return 2
    if (row?.authorization_state === 'GRANTED') return 3
    return 4
  }
  return [...(Array.isArray(applications) ? applications : [])].sort((left, right) =>
    rank(left) - rank(right) || (left?.application_order ?? 0) - (right?.application_order ?? 0))
}

export function applicationStatusOf(row) {
  if (row?.read_status === 'LOADING') return { key: 'LOADING', label: '读取中', className: 'is-loading' }
  if (row?.read_status === 'ERROR') return { key: 'ERROR', label: '读取失败', className: 'is-error' }
  if (row?.authorization_state === 'CONFLICT') return { key: 'CONFLICT', label: '授权冲突', className: 'is-conflict' }
  if (row?.authorization_state === 'UNKNOWN') return { key: 'UNKNOWN', label: '状态待确认', className: 'is-unknown' }
  if (row?.authorization_state === 'GRANTED') return { key: 'GRANTED', label: '已授权', className: 'is-granted' }
  return { key: 'UNAUTHORIZED', label: '未授权', className: 'is-unauthorized' }
}

export function applicationRoleSummary(row, maximum = 2) {
  const status = applicationStatusOf(row)
  if (status.key === 'LOADING') return '读取中'
  if (status.key === 'ERROR') return '读取失败'
  if (status.key === 'CONFLICT') return '存在角色冲突'
  if (status.key === 'UNKNOWN') return '状态待确认'
  if (status.key === 'UNAUTHORIZED') return '尚无有效授权'
  const names = []
  for (const group of Array.isArray(row?.effective_role_groups) ? row.effective_role_groups : []) {
    const name = String(group?.name || group?.code || '').trim()
    if (name && !names.includes(name)) names.push(name)
  }
  if (!names.length) return '后端确认已授权，未返回角色明细'
  const limit = Math.max(1, Number(maximum) || 2)
  if (names.length <= limit) return names.join('、')
  return `${names.slice(0, limit).join('、')} 另 ${names.length - limit} 个`
}

export function authorizationSummary(rows = [], { maximum = 2 } = {}) {
  const list = Array.isArray(rows) ? rows : []
  const granted = list.filter((row) => row?.authorization_state === 'GRANTED' && row?.read_status === 'SUCCESS')
  const errors = list.filter((row) => row?.read_status === 'ERROR')
  const loading = list.filter((row) => row?.read_status === 'LOADING')
  const conflicts = list.filter((row) => row?.authorization_state === 'CONFLICT')
  const effectiveRoles = granted.reduce((total, row) => total + (Number(row?.effective_role_count) || 0), 0)
  const read = list.length - errors.length - loading.length
  const parts = [`${granted.length} 个应用有授权 · ${effectiveRoles} 个有效角色`]
  if (conflicts.length) parts.push(`${conflicts.length} 个应用存在授权冲突`)
  if (errors.length) parts.push(`${errors.length} 个应用读取失败`)
  return {
    grantedApplications: granted.length,
    effectiveRoles,
    errorCount: errors.length,
    conflictCount: conflicts.length,
    loadingCount: loading.length,
    readApplications: read,
    incomplete: errors.length > 0 || loading.length > 0,
    text: list.length && errors.length === list.length && !loading.length
      ? '暂无法确认授权结果'
      : parts.join(' · '),
    contextText: errors.length || loading.length ? `基于已读取 ${Math.max(read, 0)} 个应用` : '',
    maximum,
  }
}

export function defaultExpandedAuthorizationApplications(rows = []) {
  return (Array.isArray(rows) ? rows : [])
    .filter((row) => row?.authorization_state === 'CONFLICT')
    .map((row) => row.application_code)
    .filter(Boolean)
}

export function authorizationDraftFingerprint(draft) {
  return JSON.stringify({
    role_codes: [...new Set((Array.isArray(draft?.role_codes) ? draft.role_codes : []).map((code) => String(code || '').trim()).filter(Boolean))].sort(),
    scope_type: String(draft?.scope_type || ''),
    environment_code: String(draft?.environment_code || ''),
    validity_mode: String(draft?.validity_mode || ''),
    valid_from: String(draft?.valid_from || ''),
    valid_until: String(draft?.valid_until || ''),
    apply_to_existing: Boolean(draft?.apply_to_existing),
  })
}

export function isAuthorizationDraftDirty(baseline, draft) {
  if (!baseline) return false
  return authorizationDraftFingerprint(draft) !== baseline
}
