/**
 * 个人例外授权的纯数据投影、草稿校验、完整集合构建和变更摘要。
 *
 * 这里刻意不依赖 Vue 或浏览器组件状态，所有时间比较都使用显式 now，便于
 * node:test 覆盖“未来生效、编辑期间到期、同角色多条、停用角色”等边界。
 * 服务端仍负责最终的租户、委派、受保护角色和并发校验；本模块只保证前端
 * 不会把无法无损重提的集合静默交给 PUT。
 */
import {
  catalogMaxEffectiveRoles,
  catalogRoles,
  isAssignableActiveCatalogRole,
  isCatalogSynchronized,
} from './applicationAuthorizationCatalog.js'

export class PersonalExceptionValidationError extends Error {
  constructor(message, { fieldErrors = {}, blockers = [], warnings = [] } = {}) {
    super(message)
    this.name = 'PersonalExceptionValidationError'
    this.fieldErrors = fieldErrors
    this.blockers = blockers
    this.warnings = warnings
  }
}

const APPLICATION = 'APPLICATION'
const ENVIRONMENT = 'ENVIRONMENT'
const VALIDITY_RANGE = 'RANGE'
const VALIDITY_PERMANENT = 'PERMANENT'

export function roleCodeOf(role) {
  if (typeof role === 'string') return role.trim()
  return String(role?.code || role?.role_code || role?.roleCode || '').trim()
}

export function roleNameOf(role, catalog = null) {
  const code = roleCodeOf(role)
  const catalogRole = catalogRoleMap(catalog).get(code)
  return role?.name || role?.display_name || catalogRole?.name || catalogRole?.display_name || code || '未命名角色'
}

export function scopeTypeOf(role) {
  return String(role?.scope_type || role?.scopeType || '').trim().toUpperCase() === ENVIRONMENT
    ? ENVIRONMENT
    : APPLICATION
}

export function environmentCodeOf(role) {
  if (scopeTypeOf(role) !== ENVIRONMENT) return null
  return String(role?.environment_code || role?.environment || '').trim() || null
}

export function normalizeTime(value) {
  if (!value) return null
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString()
  return String(value)
}

export function toRFC3339(value) {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

export function toDateTimeLocal(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (number) => String(number).padStart(2, '0')
  return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate())
    + 'T' + pad(date.getHours()) + ':' + pad(date.getMinutes())
}

export function formatPersonalExceptionTime(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return date.toLocaleString('zh-CN', { hour12: false })
}

export function validityStateOf(role, now = new Date()) {
  const validFrom = role?.valid_from ? new Date(role.valid_from).getTime() : NaN
  const validUntil = role?.valid_until ? new Date(role.valid_until).getTime() : NaN
  const current = now instanceof Date ? now.getTime() : new Date(now).getTime()
  if (Number.isFinite(validUntil) && current >= validUntil) return 'EXPIRED'
  if (Number.isFinite(validFrom) && current < validFrom) return 'PENDING'
  if (Number.isFinite(validFrom) || Number.isFinite(validUntil)) return 'ACTIVE'
  return 'ACTIVE'
}

export function validityTextOf(role) {
  const start = role?.valid_from ? formatPersonalExceptionTime(role.valid_from) : '立即生效'
  const end = role?.valid_until ? formatPersonalExceptionTime(role.valid_until) : '长期有效'
  if (!role?.valid_from && !role?.valid_until) return '长期有效'
  if (!role?.valid_from) return '立即生效，至 ' + end
  if (!role?.valid_until) return start + ' 起，长期有效'
  return start + ' 至 ' + end
}

export function scopeTextOf(role) {
  if (scopeTypeOf(role) === APPLICATION) return '整个应用'
  const code = environmentCodeOf(role)
  return code ? '指定环境：' + code : '指定环境：未选择'
}

export function recordKeyOf(role) {
  return [
    roleCodeOf(role),
    scopeTypeOf(role),
    environmentCodeOf(role) || '',
    normalizeTime(role?.valid_from) || '',
    normalizeTime(role?.valid_until) || '',
  ].join('|')
}

export function serializeRecord(role) {
  return {
    role_code: roleCodeOf(role),
    scope_type: scopeTypeOf(role),
    environment_code: scopeTypeOf(role) === ENVIRONMENT ? environmentCodeOf(role) : null,
    valid_from: normalizeTime(role?.valid_from),
    valid_until: normalizeTime(role?.valid_until),
  }
}

export function catalogRoleMap(catalog) {
  const map = new Map()
  for (const role of catalogRoles(catalog)) {
    const code = roleCodeOf(role)
    if (code) map.set(code, role)
  }
  return map
}

export function environmentMap(environments) {
  const map = new Map()
  for (const environment of Array.isArray(environments) ? environments : []) {
    const code = String(environment?.code || environment?.environment_code || environment?.environment || '').trim()
    if (code) map.set(code, environment)
  }
  return map
}

function sortedRecords(records) {
  return [...records].sort((left, right) => {
    const leftStart = left.valid_from ? new Date(left.valid_from).getTime() : -Infinity
    const rightStart = right.valid_from ? new Date(right.valid_from).getTime() : -Infinity
    if (leftStart !== rightStart) return leftStart - rightStart
    const leftEnd = left.valid_until ? new Date(left.valid_until).getTime() : Infinity
    const rightEnd = right.valid_until ? new Date(right.valid_until).getTime() : Infinity
    if (leftEnd !== rightEnd) return leftEnd - rightEnd
    return recordKeyOf(left).localeCompare(recordKeyOf(right))
  })
}

function groupStatus(records, now) {
  const states = records.map((record) => validityStateOf(record, now))
  const active = states.includes('ACTIVE')
  const pending = states.includes('PENDING')
  const expired = states.includes('EXPIRED')
  if (active) return { code: 'ACTIVE', label: '生效中', hasExpired: expired, hasPending: pending }
  if (pending) return { code: 'PENDING', label: '待生效', hasExpired: expired, hasPending: true }
  if (expired) return { code: 'EXPIRED', label: '已到期，请刷新', hasExpired: true, hasPending: false }
  return { code: 'UNKNOWN', label: '状态未知', hasExpired: false, hasPending: false }
}

/**
 * 列表投影。返回按角色分组的 MANUAL 记录、异常和继承分组。
 * access.manual_roles_complete 为 false 时仍展示已有数据，但 complete=false，
 * 组件不得进入可写空集合状态。
 */
export function buildPersonalExceptionView({ access, catalog = null, now = new Date() } = {}) {
  const rawManual = Array.isArray(access?.manual_roles) ? access.manual_roles : []
  const complete = Boolean(access && access.manual_roles_complete === true && Array.isArray(access.manual_roles))
  const catalogMap = catalogRoleMap(catalog)
  const grouped = new Map()
  for (const role of rawManual) {
    const code = roleCodeOf(role)
    if (!code) continue
    if (!grouped.has(code)) grouped.set(code, [])
    grouped.get(code).push(role)
  }

  const groups = []
  for (const [code, records] of grouped) {
    const ordered = sortedRecords(records)
    const catalogRole = catalogMap.get(code) || null
    const unavailable = !catalogRole || !isAssignableActiveCatalogRole(catalogRole)
    const status = groupStatus(ordered, now)
    const first = ordered[0]
    const group = {
      roleCode: code,
      name: roleNameOf(first, catalog),
      catalogRole,
      records: ordered,
      status,
      duplicate: ordered.length > 1,
      unavailable,
      hasExpired: status.hasExpired,
      hasPending: status.hasPending,
      anomalyTypes: [
        ordered.length > 1 ? 'DUPLICATE' : '',
        unavailable ? 'UNAVAILABLE' : '',
        status.hasExpired ? 'EXPIRED' : '',
      ].filter(Boolean),
    }
    groups.push(group)
  }

  groups.sort((left, right) => {
    const leftAnomaly = left.anomalyTypes.length ? 0 : (left.status.code === 'PENDING' ? 1 : 2)
    const rightAnomaly = right.anomalyTypes.length ? 0 : (right.status.code === 'PENDING' ? 1 : 2)
    if (leftAnomaly !== rightAnomaly) return leftAnomaly - rightAnomaly
    return left.name.localeCompare(right.name, 'zh-CN') || left.roleCode.localeCompare(right.roleCode)
  })

  const anomalies = []
  for (const group of groups) {
    if (group.duplicate) {
      anomalies.push({ type: 'DUPLICATE', roleCode: group.roleCode, name: group.name, count: group.records.length, group })
    }
    if (group.unavailable) {
      anomalies.push({ type: 'UNAVAILABLE', roleCode: group.roleCode, name: group.name, count: group.records.length, group })
    }
    if (group.hasExpired) {
      anomalies.push({ type: 'EXPIRED', roleCode: group.roleCode, name: group.name, count: group.records.length, group })
    }
  }

  const inheritedRaw = Array.isArray(access?.inherited_roles) ? access.inherited_roles : []
  const inheritedMap = new Map()
  for (const role of inheritedRaw) {
    const code = roleCodeOf(role)
    if (!code) continue
    if (!inheritedMap.has(code)) inheritedMap.set(code, [])
    inheritedMap.get(code).push(role)
  }
  const inheritedGroups = [...inheritedMap.entries()].map(([code, sources]) => ({
    roleCode: code,
    name: roleNameOf(sources[0], catalog),
    sources: orderedSources(sources),
    sourceCount: sources.length,
  })).sort((left, right) => left.name.localeCompare(right.name, 'zh-CN') || left.roleCode.localeCompare(right.roleCode))

  return {
    complete,
    hasManualRoles: rawManual.length > 0,
    groups,
    inheritedGroups,
    inheritedRoles: inheritedRaw,
    anomalies,
    counts: {
      manualRecords: rawManual.length,
      manualRoles: groups.length,
      inheritedRoles: inheritedGroups.length,
      inheritedSources: inheritedRaw.length,
    },
  }
}

function orderedSources(sources) {
  return [...sources].sort((left, right) => {
    const leftKey = [left?.source_type || '', left?.source_id || '', left?.valid_from || ''].join('|')
    const rightKey = [right?.source_type || '', right?.source_id || '', right?.valid_from || ''].join('|')
    return leftKey.localeCompare(rightKey)
  })
}

function blankDraft(mode) {
  return {
    mode,
    roleCode: '',
    scopeType: APPLICATION,
    environmentCode: '',
    validityMode: VALIDITY_RANGE,
    startMode: 'IMMEDIATE',
    validFrom: null,
    validFromInput: '',
    validFromTouched: false,
    validUntil: null,
    validUntilInput: '',
    validUntilTouched: false,
    initialRecords: [],
    cleanupRoleCodes: [],
  }
}

/** 新增草稿默认“指定时间、立即生效、结束时间必填”。 */
export function createPersonalExceptionDraft({ mode = 'create', group = null } = {}) {
  const draft = blankDraft(mode)
  if (!group || mode === 'create') return draft
  const records = Array.isArray(group.records) ? group.records : []
  const first = records[0] || group
  draft.roleCode = roleCodeOf(first)
  draft.scopeType = scopeTypeOf(first)
  draft.environmentCode = environmentCodeOf(first) || ''
  draft.validityMode = first?.valid_until ? VALIDITY_RANGE : VALIDITY_PERMANENT
  draft.startMode = first?.valid_from ? 'SPECIFIC' : 'IMMEDIATE'
  draft.validFrom = normalizeTime(first?.valid_from)
  draft.validFromInput = toDateTimeLocal(first?.valid_from)
  draft.validUntil = normalizeTime(first?.valid_until)
  draft.validUntilInput = toDateTimeLocal(first?.valid_until)
  draft.initialRecords = records.map((record) => ({ ...record }))
  return draft
}

/** 把 datetime-local 输入解析为提交用 RFC3339；未触碰的字段保留原始时间字符串。 */
export function resolvePersonalExceptionDraft(draft) {
  const start = draft?.startMode === 'IMMEDIATE'
    ? null
    : (draft?.validFromTouched ? toRFC3339(draft.validFromInput) : normalizeTime(draft?.validFrom))
  const end = draft?.validityMode === VALIDITY_PERMANENT
    ? null
    : (draft?.validUntilTouched ? toRFC3339(draft.validUntilInput) : normalizeTime(draft?.validUntil))
  return {
    ...draft,
    validFrom: start,
    validUntil: end,
  }
}

function hasInvalidDate(value) {
  return Boolean(value) && Number.isNaN(new Date(value).getTime())
}

function draftChangesCleanup(draft) {
  return Array.isArray(draft?.cleanupRoleCodes) ? [...new Set(draft.cleanupRoleCodes.map((code) => String(code).trim()).filter(Boolean))].sort() : []
}

export function draftFingerprint(draft) {
  const value = resolvePersonalExceptionDraft(draft || {})
  return JSON.stringify({
    mode: value.mode || '',
    roleCode: String(value.roleCode || '').trim(),
    scopeType: scopeTypeOf(value),
    environmentCode: scopeTypeOf(value) === ENVIRONMENT ? String(value.environmentCode || '').trim() : '',
    validityMode: value.validityMode || '',
    startMode: value.startMode || '',
    validFrom: value.validFrom || null,
    validUntil: value.validUntil || null,
    cleanupRoleCodes: draftChangesCleanup(value),
  })
}

export function hasPersonalExceptionDraftChanges(initialDraft, currentDraft) {
  if (!initialDraft) return Boolean(currentDraft)
  return draftFingerprint(initialDraft) !== draftFingerprint(currentDraft)
}

/**
 * 校验草稿。返回 fieldErrors（字段错误）、blockers（必须处理才能提交的集合问题）
 * 和 warnings（不阻断提交的影响提示）。
 */
export function validatePersonalExceptionDraft({ draft, snapshot, catalog = null, now = new Date() } = {}) {
  const fieldErrors = {}
  const blockers = []
  const warnings = []
  const value = resolvePersonalExceptionDraft(draft || {})
  const access = snapshot?.access || null
  const complete = Boolean(access && access.manual_roles_complete === true && Array.isArray(access.manual_roles))
  if (!complete) blockers.push('当前响应没有完整的 manual_roles 管理集合，不能据此保存。请重新读取授权。')
  if (!catalog) blockers.push('角色目录不可用，不能新增或修改依赖目录解析的授权。')
  if (catalog && !isCatalogSynchronized(catalog)) blockers.push('角色目录尚未同步完成，暂不能新增或修改授权。')

  const roleCode = String(value.roleCode || '').trim()
  const mode = String(value.mode || 'create')
  if (!roleCode && mode !== 'cleanup') fieldErrors.roleCode = '请选择角色。'
  const catalogMap = catalogRoleMap(catalog)
  const catalogRole = catalogMap.get(roleCode)
  if (roleCode && catalog && (!catalogRole || !isAssignableActiveCatalogRole(catalogRole))) {
    fieldErrors.roleCode = '该角色不在当前可分配的 ACTIVE 目录中。'
  }
  if (roleCode && mode === 'create') {
    const existing = Array.isArray(access?.manual_roles) ? access.manual_roles : []
    if (existing.some((role) => roleCodeOf(role) === roleCode)) {
      fieldErrors.roleCode = '该角色已有个人例外授权，请修改已有授权或统一调整历史记录。'
    }
  }
  if (roleCode && mode === 'edit' && (value.initialRecords || []).length > 1) {
    blockers.push('同一角色存在多条人工授权，请使用“统一调整”，不能按单条修改覆盖其他记录。')
  }

  const scope = scopeTypeOf(value)
  const environment = String(value.environmentCode || '').trim()
  if (scope === ENVIRONMENT) {
    if (!environment) fieldErrors.environmentCode = '指定环境时必须选择环境。'
    else if (Array.isArray(snapshot?.environments) && snapshot.environments.length
      && !environmentMap(snapshot.environments).has(environment)) {
      fieldErrors.environmentCode = '所选环境不在当前有效环境列表中。'
    }
  }

  if (value.startMode === 'SPECIFIC') {
    if (!value.validFrom) fieldErrors.validFrom = '选择指定开始时间时必须填写开始时间。'
    else if (hasInvalidDate(value.validFrom)) fieldErrors.validFrom = '开始时间格式无效。'
  }
  if (value.validityMode === VALIDITY_RANGE) {
    if (!value.validUntil) fieldErrors.validUntil = '指定有效期时必须填写结束时间。'
    else if (hasInvalidDate(value.validUntil)) fieldErrors.validUntil = '结束时间格式无效。'
    else if (new Date(value.validUntil).getTime() <= now.getTime()) fieldErrors.validUntil = '结束时间必须晚于当前时间。'
  }
  if (value.validFrom && value.validUntil && !hasInvalidDate(value.validFrom) && !hasInvalidDate(value.validUntil)
    && new Date(value.validUntil).getTime() <= new Date(value.validFrom).getTime()) {
    fieldErrors.validUntil = '结束时间必须晚于开始时间。'
  }

  const inheritedCodes = new Set((Array.isArray(access?.inherited_roles) ? access.inherited_roles : []).map(roleCodeOf).filter(Boolean))
  if (roleCode && inheritedCodes.has(roleCode)) {
    warnings.push('该角色同时来自岗位/组织继承；个人例外可能重叠，但不会自动扩大现有权限。')
  }
  if (mode === 'normalize' && (value.initialRecords || []).length > 1) {
    warnings.push('本次会把该角色的 ' + value.initialRecords.length + ' 条历史记录统一为 1 条，原有范围/窗口会被替换。')
  }

  // 其他异常必须显式清理或通过目标角色的统一调整/撤销处理，不能静默过滤。
  const cleanup = new Set(draftChangesCleanup(value))
  const groups = buildPersonalExceptionView({ access, catalog, now }).groups
  for (const group of groups) {
    if (group.roleCode === roleCode || cleanup.has(group.roleCode)) continue
    if (group.duplicate) blockers.push('角色“' + group.name + '”仍有 ' + group.records.length + ' 条人工记录，请先统一调整或撤销该角色全部记录。')
    if (group.unavailable) blockers.push('角色“' + group.name + '”已停用或不在目录中，请先显式清理。')
    if (group.hasExpired) blockers.push('角色“' + group.name + '”含已到期记录，请先清理或统一调整。')
  }
  if (roleCode && mode === 'edit' && (value.initialRecords || []).some((record) => validityStateOf(record, now) === 'EXPIRED')) {
    blockers.push('该角色记录已到期，请先刷新核对；不能携带过期记录继续保存。')
  }

  const max = catalogMaxEffectiveRoles(catalog)
  if (max > 0 && roleCode) {
    const finalCodes = new Set((Array.isArray(access?.manual_roles) ? access.manual_roles : []).map(roleCodeOf).filter(Boolean))
    finalCodes.add(roleCode)
    for (const code of cleanup) finalCodes.delete(code)
    if (finalCodes.size > max) blockers.push('个人例外直接角色数 ' + finalCodes.size + ' 超过应用允许的最大有效角色数 ' + max + '。')
  }

  if (mode === 'cleanup' && cleanup.size === 0) fieldErrors.cleanupRoleCodes = '请选择要清理的异常记录。'
  return { fieldErrors, blockers, warnings }
}

function recordForWrite(role) {
  return serializeRecord(role)
}

function validateFinalRecords(records, { catalog, environments, now, max }) {
  const blockers = []
  const seen = new Set()
  const catalogMap = catalogRoleMap(catalog)
  const environmentCodes = environmentMap(environments)
  for (const record of records) {
    const code = roleCodeOf(record)
    if (!code) blockers.push('存在缺少角色编码的记录，不能提交。')
    if (seen.has(code)) blockers.push('角色“' + roleNameOf(record, catalog) + '”在提交集合中重复，后端会拒绝。')
    seen.add(code)
    const catalogRole = catalogMap.get(code)
    if (catalog && (!catalogRole || !isAssignableActiveCatalogRole(catalogRole))) {
      blockers.push('角色“' + roleNameOf(record, catalog) + '”已停用或不在当前目录中，请先显式清理。')
    }
    if (scopeTypeOf(record) === ENVIRONMENT) {
      const environment = environmentCodeOf(record)
      if (!environment) blockers.push('角色“' + roleNameOf(record, catalog) + '”指定了无效的空环境。')
      else if (environmentCodes.size && !environmentCodes.has(environment)) {
        blockers.push('角色“' + roleNameOf(record, catalog) + '”使用了不在当前有效环境列表中的环境 ' + environment + '。')
      }
    }
    if (record.valid_from && Number.isNaN(new Date(record.valid_from).getTime())) blockers.push('角色“' + roleNameOf(record, catalog) + '”的开始时间格式无效。')
    if (record.valid_until && Number.isNaN(new Date(record.valid_until).getTime())) blockers.push('角色“' + roleNameOf(record, catalog) + '”的结束时间格式无效。')
    if (record.valid_from && record.valid_until && !Number.isNaN(new Date(record.valid_from).getTime())
      && !Number.isNaN(new Date(record.valid_until).getTime())
      && new Date(record.valid_until).getTime() <= new Date(record.valid_from).getTime()) {
      blockers.push('角色“' + roleNameOf(record, catalog) + '”的结束时间必须晚于开始时间。')
    }
    if (record.valid_until && !Number.isNaN(new Date(record.valid_until).getTime())
      && new Date(record.valid_until).getTime() <= now.getTime()) {
      blockers.push('角色“' + roleNameOf(record, catalog) + '”已到期，请刷新后重新处理。')
    }
  }
  if (max > 0 && records.length > max) blockers.push('当前集合包含 ' + records.length + ' 个直接角色，超过应用允许的最大有效角色数 ' + max + '。')
  return blockers
}

// operationValues 将操作草稿转换为可序列化的授权记录，保留内部角色校验字段。
// 参数：operation为指定目标角色、环境及有效时间的编辑操作。
// 返回值：角色校验编码和规范记录字段；未指定时间返回null。
function operationValues(operation) {
  const values = operation?.values || {}
  return {
    roleCode: String(values.roleCode || operation?.targetRoleCode || '').trim(),
    scope_type: scopeTypeOf(values),
    environment_code: scopeTypeOf(values) === ENVIRONMENT
      ? String(values.environmentCode || '').trim() || null : null,
    valid_from: normalizeTime(values.validFrom),
    valid_until: normalizeTime(values.validUntil),
  }
}

/**
 * 由当前管理快照构建完整集合。其他角色原样保留，只处理 operation 指定角色
 * 和显式 cleanupRoleCodes；遇到无法无损提交的集合抛 PersonalExceptionValidationError。
 */
export function buildPersonalExceptionPayload({ snapshot, operation, catalog = null, now = new Date() } = {}) {
  const access = snapshot?.access || null
  if (!access || access.manual_roles_complete !== true || !Array.isArray(access.manual_roles)) {
    throw new PersonalExceptionValidationError('当前响应没有完整的 manual_roles 管理集合，不能保存。', {
      blockers: ['请重新读取授权后再保存，不能用兼容推导的当前有效角色代替完整人工集合。'],
    })
  }
  if (!catalog) {
    throw new PersonalExceptionValidationError('角色目录不可用，不能保存。', { blockers: ['请等待应用目录同步后再试。'] })
  }
  const type = String(operation?.type || '').trim()
  const target = String(operation?.targetRoleCode || '').trim()
  const cleanup = new Set((Array.isArray(operation?.cleanupRoleCodes) ? operation.cleanupRoleCodes : [])
    .map((code) => String(code).trim()).filter(Boolean))
  const before = access.manual_roles.map((role) => ({ ...role }))
  const targetRecords = before.filter((role) => roleCodeOf(role) === target)
  const remaining = before.filter((role) => roleCodeOf(role) !== target && !cleanup.has(roleCodeOf(role)))
  let next = remaining.map(recordForWrite)
  let operationSummary = ''

  if (type === 'create') {
    if (target) {
      throw new PersonalExceptionValidationError('新增角色不能指定已有目标角色。', { blockers: ['请从“修改已有授权”入口处理该角色。'] })
    }
    const values = operationValues(operation)
    if (!values.roleCode) {
      throw new PersonalExceptionValidationError('请选择角色。', { fieldErrors: { roleCode: '请选择角色。' } })
    }
    if (before.some((role) => roleCodeOf(role) === values.roleCode)) {
      throw new PersonalExceptionValidationError('该角色已有个人例外授权。', { fieldErrors: { roleCode: '该角色已有个人例外授权，请修改已有授权。' } })
    }
    next.push(recordForWrite(values))
    operationSummary = '新增角色“' + roleNameOf(values, catalog) + '”'
  } else if (type === 'update' || type === 'normalizeRole') {
    if (!target || !targetRecords.length) {
      throw new PersonalExceptionValidationError('找不到要修改的角色记录。', { blockers: ['请刷新授权后重试。'] })
    }
    if (type === 'update' && targetRecords.length > 1) {
      throw new PersonalExceptionValidationError('同一角色存在多条记录。', { blockers: ['请使用“统一调整”处理同角色多条记录。'] })
    }
    const values = operationValues(operation)
    if (values.roleCode && values.roleCode !== target) {
      throw new PersonalExceptionValidationError('修改时不能更换角色编码。', { fieldErrors: { roleCode: '更换角色请使用撤销后新增。' } })
    }
    next.push(recordForWrite({ ...values, role_code: target }))
    operationSummary = (type === 'normalizeRole'
      ? '将角色“' + roleNameOf(targetRecords[0], catalog) + '”的 ' + targetRecords.length + ' 条记录统一为 1 条'
      : '修改角色“' + roleNameOf(targetRecords[0], catalog) + '”')
  } else if (type === 'revokeRole') {
    if (!target || !targetRecords.length) {
      throw new PersonalExceptionValidationError('找不到要撤销的角色记录。', { blockers: ['请刷新授权后重试。'] })
    }
    operationSummary = '撤销角色“' + roleNameOf(targetRecords[0], catalog) + '”全部 ' + targetRecords.length + ' 条个人例外'
  } else if (type === 'cleanup') {
    if (!cleanup.size) {
      throw new PersonalExceptionValidationError('请选择要清理的异常记录。', { fieldErrors: { cleanupRoleCodes: '请选择要清理的异常记录。' } })
    }
    operationSummary = '清理 ' + cleanup.size + ' 个异常角色的个人例外'
  } else {
    throw new PersonalExceptionValidationError('不支持的授权操作。', { blockers: ['请刷新页面后重试。'] })
  }

  next = next.map(serializeRecord)
  const blockers = validateFinalRecords(next, { catalog, environments: snapshot?.environments || [], now, max: catalogMaxEffectiveRoles(catalog) })
  if (blockers.length) {
    throw new PersonalExceptionValidationError('当前集合仍有未处理的问题，不能保存。', { blockers })
  }
  const changes = diffPersonalExceptionAssignments(before, next)
  const summary = [
    operationSummary,
    changes.added.length ? '新增 ' + changes.added.length + ' 个角色' : '',
    changes.updated.length ? '调整 ' + changes.updated.length + ' 个角色' : '',
    changes.removed.length ? '移除 ' + changes.removed.length + ' 个角色' : '',
    cleanup.size ? '显式清理 ' + cleanup.size + ' 个角色' : '',
    '其他个人例外、岗位/组织继承和权限目录不会被修改。',
  ].filter(Boolean).join('；')
  return { roles: next, changes, summary, operation: type, cleanupRoleCodes: [...cleanup] }
}

/** 角色级差异：按 role_code 比较，区分新增、调整、移除和未变化。 */
export function diffPersonalExceptionAssignments(beforeRoles = [], afterRoles = []) {
  const before = groupByRole(beforeRoles)
  const after = groupByRole(afterRoles)
  const added = []
  const updated = []
  const removed = []
  const unchanged = []
  for (const [code, records] of after) {
    if (!before.has(code)) added.push(...records)
    else {
      const beforeKeys = before.get(code).map(recordKeyOf).sort()
      const afterKeys = records.map(recordKeyOf).sort()
      if (beforeKeys.join('\n') === afterKeys.join('\n')) unchanged.push(...records)
      else updated.push(...records)
    }
  }
  for (const [code, records] of before) {
    if (!after.has(code)) removed.push(...records)
  }
  return { added, updated, removed, unchanged }
}

function groupByRole(roles) {
  const map = new Map()
  for (const role of Array.isArray(roles) ? roles : []) {
    const code = roleCodeOf(role)
    if (!code) continue
    if (!map.has(code)) map.set(code, [])
    map.get(code).push(role)
  }
  return map
}

export function personalExceptionOperationForRole(group, mode) {
  if (!group) return null
  return {
    type: mode === 'normalize' ? 'normalizeRole' : 'revokeRole',
    targetRoleCode: group.roleCode,
  }
}

export function isPersonalExceptionFullAccessRole(role, catalog) {
  const catalogRole = catalogRoleMap(catalog).get(roleCodeOf(role))
  return Boolean(catalogRole && isAssignableActiveCatalogRole(catalogRole))
}
