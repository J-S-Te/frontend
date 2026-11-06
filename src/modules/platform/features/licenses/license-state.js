// 许可层面（签名许可证）与运行执行层面（逐应用强制执行）是两件独立的事：
// 本合同只做状态分类、总体摘要、步骤条与主行动推导，不改写服务端事实。
// 服务端没有给出的事实（例如尚未读取到的逐应用概览）一律显示“状态未知”，
// 不能从“许可证有效”推断出“已强制执行”，也不能把“待生效/已过期”当成导入失败。
import { summarizeAggregateEnforcement } from './runtime-api.js'

// 六类状态中的前三类属于许可层面，由 GET /licenses/status 的 systems[].status 决定。
const LICENSE_STATES = Object.freeze({
  VALID: { key: 'IMPORTED', label: '已导入', tone: 'success' },
  NOT_EFFECTIVE: { key: 'PENDING_EFFECTIVE', label: '待生效', tone: 'info' },
  EXPIRED: { key: 'EXPIRED', label: '已过期', tone: 'danger' },
  NO_LICENSE: { key: 'NOT_IMPORTED', label: '未导入', tone: 'neutral' },
  NOT_PURCHASED: { key: 'NOT_IMPORTED', label: '未导入', tone: 'neutral' },
  CLOCK_ABNORMAL: { key: 'CLOCK_ABNORMAL', label: '时钟异常', tone: 'danger' },
  VALIDATION_ERROR: { key: 'VALIDATION_ERROR', label: '校验异常', tone: 'danger' },
})
const UNKNOWN_LICENSE_STATE = Object.freeze({ key: 'UNKNOWN', label: '状态未知', tone: 'neutral' })

// 后三类属于运行执行层面：新后端取自 GET /licenses/status 的 systems[].enforcement 聚合，
// 只有该字段缺失（旧后端）时才回退 GET /licenses/enforcement/:app/overview。
const ENFORCEMENT_STATES = Object.freeze({
  ENFORCED: { key: 'ENFORCED', label: '已强制执行', tone: 'success' },
  APPLYING: { key: 'APPLYING', label: '激活中', tone: 'info' },
  PENDING_ENFORCEMENT: { key: 'PENDING_ENFORCEMENT', label: '待激活', tone: 'warning' },
  UNREGISTERED: { key: 'UNREGISTERED', label: '未纳管', tone: 'neutral' },
})
const UNKNOWN_ENFORCEMENT_STATE = Object.freeze({ key: 'UNKNOWN', label: '状态未知', tone: 'neutral' })

/** 许可证状态码 → 展示标签与色调。未知状态码不得被猜成有效。 */
export function licenseStateOf(status) {
  return LICENSE_STATES[status] || UNKNOWN_LICENSE_STATE
}
export const licenseStateName = status => licenseStateOf(status).label

/**
 * 运行执行聚合的可用性（顶层 runtime_enforcement）。
 * AVAILABLE：聚合已提供，页面不再显示“未接入”告警；
 * UNAVAILABLE：后端未提供聚合，执行状态只来自逐应用概览，必须说明清楚；
 * 旧后端的 NOT_CONNECTED 与缺失/未知值都按“不是 AVAILABLE”处理，绝不宣称聚合可用。
 * 返回值：{ key, label, notice, tone }，notice 为空表示不需要提示。
 */
export function runtimeEnforcementInfo(value) {
  if (value === 'AVAILABLE') {
    return { key: 'AVAILABLE', label: '授权状态聚合', notice: '', tone: 'success' }
  }
  if (value === 'UNAVAILABLE' || value === 'NOT_CONNECTED') {
    return {
      key: 'UNAVAILABLE',
      label: '逐应用概览',
      notice: '后端未提供运行执行聚合，执行状态仅来自逐应用概览；未读取到的系统显示“状态未知”。',
      tone: 'warning',
    }
  }
  return {
    key: 'UNKNOWN',
    label: '逐应用概览',
    notice: '未能确认后端是否提供运行执行聚合，执行状态仅来自逐应用概览；未读取到的系统显示“状态未知”。',
    tone: 'neutral',
  }
}

// 聚合来源的展示名：契约值是长枚举，界面给中文短语，原值放在 title 里供排查。
const RUNTIME_SOURCE_LABELS = Object.freeze({ per_application_coordination: '逐应用协调' })
export const runtimeEnforcementSourceLabel = value =>
  (typeof value === 'string' ? RUNTIME_SOURCE_LABELS[value] || '' : '')

/**
 * 逐应用概览汇总 → 运行执行状态。
 * summary 为 summarizeEnforcement / summarizeAggregateEnforcement 的结果；
 * 缺失、读取失败或服务端明确不可用时统一是“状态未知”，并在 note 中说明原因，
 * 避免把未知渲染成“待激活”或“已停止”。
 */
export function enforcementStateOf(summary) {
  if (!summary || summary.available !== true) {
    const note = summary?.error
      ? '概览读取失败，请刷新执行状态重试'
      : summary?.note || '尚未读取逐应用概览'
    return { ...UNKNOWN_ENFORCEMENT_STATE, note }
  }
  if (summary.registration === 'UNREGISTERED' || summary.status === 'UNREGISTERED') {
    return { ...ENFORCEMENT_STATES.UNREGISTERED, note: '运行组件尚未登记，运行执行事实不存在' }
  }
  const state = ENFORCEMENT_STATES[summary.status]
  if (!state) return { ...UNKNOWN_ENFORCEMENT_STATE, note: '服务端未给出执行状态' }
  return { ...state, note: '' }
}

// reason_code 让“为什么”说得更具体，但它只调整主行动与说明，
// 不参与状态分类与颜色推导：标签与色调仍然只由 systems[].status 决定。
// 每个原因码只在与其许可状态同一族时生效，避免页面同时出现互相矛盾的结论。
const REASON_LICENSE_KEYS = Object.freeze({
  // 时钟保护是全局的：任何许可状态都先恢复时钟。
  CLOCK_ABNORMAL: null,
  STATE_INVALID: Object.freeze(['VALIDATION_ERROR', 'UNKNOWN', 'NOT_IMPORTED']),
  EXPIRED: Object.freeze(['EXPIRED', 'UNKNOWN']),
  NOT_EFFECTIVE: Object.freeze(['PENDING_EFFECTIVE', 'UNKNOWN']),
})
const REASON_HINTS = Object.freeze({
  CLOCK_ABNORMAL: '检测到时间回拨，授权已按失败关闭处理',
  STATE_INVALID: '持久授权状态完整性校验失败，刷新或重新导入都不能修复',
  EXPIRED: '有效期已结束，需要供应商签发更高版本',
  NOT_EFFECTIVE: '已验签通过，尚未到达生效时间',
})
/** 原因码 → 一句具体的说明；没有对应原因码时返回空字符串。 */
export const reasonHintOf = reasonCode => REASON_HINTS[reasonCode] || ''

// reasonApplies 用途：原因码是否与当前许可状态同一族（不同族则不采纳，避免自相矛盾）。
function reasonApplies(reasonCode, licenseKey) {
  if (!Object.hasOwn(REASON_LICENSE_KEYS, reasonCode)) return false
  const allowed = REASON_LICENSE_KEYS[reasonCode]
  return allowed === null || allowed.includes(licenseKey)
}

/**
 * 单应用下一步：同一行只给一个主行动，其余事实只读展示。
 * 参数：row 含 license/enforcement 两个状态，reasonCode 为服务端原因码；
 * options.canManage 决定是否展示激活/恢复入口，options.hasPending 决定“等待生效日”能否跳到待生效卡片。
 */
export function nextActionFor(row, options = {}) {
  const { canManage = false, hasPending = false } = options
  const license = row?.license?.key
  const enforcement = row?.enforcement?.key
  const reason = reasonApplies(row?.reasonCode, license) ? row.reasonCode : ''
  const clockBlocked = license === 'CLOCK_ABNORMAL' || reason === 'CLOCK_ABNORMAL'
  const stateInvalid = license === 'VALIDATION_ERROR' || reason === 'STATE_INVALID'
  const expired = license === 'EXPIRED' || reason === 'EXPIRED'
  const waiting = license === 'PENDING_EFFECTIVE' || reason === 'NOT_EFFECTIVE'
  if (clockBlocked) {
    return canManage
      ? { key: 'RECOVER', label: '恢复时钟', target: 'clock', hint: `${reasonHintOf('CLOCK_ABNORMAL')}；需要供应商签发的一次性恢复凭据` }
      : { key: 'RECOVER', label: '联系授权管理员', target: 'none', hint: `${reasonHintOf('CLOCK_ABNORMAL')}；只有商业授权管理员可以提交恢复凭据` }
  }
  if (stateInvalid) {
    return { key: 'CONTACT', label: '联系授权管理员', target: 'none', hint: `${reasonHintOf('STATE_INVALID')}，需要管理员核查部署实例` }
  }
  if (expired) {
    return canManage
      ? { key: 'REIMPORT', label: '重新导入', target: 'import', hint: '已过期，需要供应商签发更高版本后再导入' }
      : { key: 'REIMPORT', label: '需要管理员续期', target: 'none', hint: '许可证已过期，请联系授权管理员导入更高版本' }
  }
  if (license === 'NOT_IMPORTED') {
    return canManage
      ? { key: 'IMPORT', label: '导入许可证', target: 'import', hint: '当前系统还没有可用许可证' }
      : { key: 'IMPORT', label: '需要管理员导入', target: 'none', hint: '需要商业授权管理权限才能导入许可证' }
  }
  if (waiting) return { key: 'WAIT_EFFECTIVE', label: '等待生效日', target: hasPending ? 'pending' : 'none', hint: '许可证已验签通过，但还没有到生效时间' }
  if (enforcement === 'PENDING_ENFORCEMENT') {
    return canManage
      ? { key: 'ACTIVATE', label: '去激活', target: 'runtime', hint: '在下方运行详情中核对执行修订并勾选确认后启用' }
      : { key: 'DETAIL', label: '查看运行详情', target: 'runtime', hint: '需要商业授权管理权限才能发起激活' }
  }
  if (enforcement === 'APPLYING') return { key: 'PROGRESS', label: '查看激活进度', target: 'runtime', hint: '激活已提交，等待组件准备并确认当前修订' }
  if (enforcement === 'UNREGISTERED') return { key: 'ENROLL', label: '查看运行详情', target: 'runtime', hint: '运行组件尚未登记，未接入运行时授权执行' }
  if (enforcement === 'ENFORCED') return { key: 'DETAIL', label: '查看运行详情', target: 'runtime', hint: '已强制执行，不提供重复激活' }
  return { key: 'DETAIL', label: '查看运行详情', target: 'runtime', hint: row?.enforcement?.note || '需在逐应用概览中核对运行执行状态' }
}

function countBy(list, pick) {
  return list.reduce((counts, item) => {
    const key = pick(item)
    counts[key] = (counts[key] || 0) + 1
    return counts
  }, {})
}

// enforcementSummaryFor 用途：决定这一行用哪份执行事实。
// 规则：systems[].enforcement 存在（含 null）就以它为准；只有字段整个缺失（旧后端
// undefined）才回退到逐应用概览。null / available:false 一律是“状态未知”，不能回退凑数。
export function enforcementSummaryFor(row, enforcementByApp = {}) {
  if (row?.enforcement !== undefined) return summarizeAggregateEnforcement(row.enforcement)
  return enforcementByApp?.[row?.code] || null
}

/** 合并许可行与执行事实：每个应用一行，两层事实分列展示。 */
export function buildApplicationRows(rows = [], enforcementByApp = {}, options = {}) {
  const { canManage = false, hasPending = Boolean(options.hasPending) } = options
  return rows.map(row => {
    const summary = enforcementSummaryFor(row, enforcementByApp)
    const entry = { ...row, license: licenseStateOf(row.status), enforcement: enforcementStateOf(summary), summary, reasonCode: row.reasonCode || '' }
    // 行色调：许可证出问题时先报警，其次跟随运行执行层面；未知/未纳管保持中性，不冒充“正常”。
    entry.tone = entry.license.tone === 'danger'
      ? 'danger'
      : entry.enforcement.tone !== 'neutral'
        ? entry.enforcement.tone
        : entry.license.tone === 'info' ? 'info' : 'neutral'
    // 只有真正存在运行执行事实时才展示修订/准备/确认计数，未登记或未知不刷 0/0 噪音。
    entry.showEnforcementCounters = Boolean(summary?.available) && ['ENFORCED', 'APPLYING', 'PENDING_ENFORCEMENT'].includes(entry.enforcement.key)
    entry.action = nextActionFor(entry, { canManage, hasPending })
    return entry
  })
}

/**
 * 页面总体状态：先看部署与时钟事实，再看许可层面，最后看运行执行层面。
 * 描述里的计数全部来自真实行，未知类单独计数，便于用户知道“还没核对什么”。
 */
export function overallState({ status, appRows = [], canManage = false } = {}) {
  if (!status) {
    return { key: 'LOADING', label: '读取中', tone: 'neutral', step: 0, description: '正在读取授权状态…', action: { label: '刷新状态', target: 'refresh', hint: '' }, counts: {} }
  }
  const counts = countBy(appRows, row => row.license.key)
  const enforcement = countBy(appRows, row => row.enforcement.key)
  const total = appRows.length
  const enforced = enforcement.ENFORCED || 0
  const applying = enforcement.APPLYING || 0
  const pendingEnforcement = enforcement.PENDING_ENFORCEMENT || 0
  const unregistered = enforcement.UNREGISTERED || 0
  const unknownEnforcement = enforcement.UNKNOWN || 0
  const imported = counts.IMPORTED || 0
  const waiting = counts.PENDING_EFFECTIVE || 0
  const expired = counts.EXPIRED || 0
  const abnormal = (counts.CLOCK_ABNORMAL || 0) + (counts.VALIDATION_ERROR || 0)
  const base = { counts: { total, imported, waiting, expired, abnormal, enforced, applying, pendingEnforcement, unregistered, unknownEnforcement } }

  if (!status.initialized) {
    return { ...base, key: 'NOT_INITIALIZED', label: '尚未初始化', tone: 'warning', step: 0,
      description: '部署实例还没有绑定客户、环境和实例标识；初始化后才能导入许可证。',
      action: { label: '初始化部署实例', target: 'init', hint: '客户标识与环境绑定后不可更改，请与签发申请保持一致' } }
  }
  if (status.clock_blocked) {
    return { ...base, key: 'CLOCK_BLOCKED', label: '时钟保护中', tone: 'danger', step: 1,
      description: '检测到系统时钟回退，授权已进入保护状态；恢复前所有授权判断保持失败关闭。',
      action: canManage
        ? { label: '恢复时钟', target: 'clock', hint: '提交供应商签发的一次性恢复凭据；凭据使用一次即被消费' }
        : { label: '联系授权管理员', target: 'none', hint: '只有商业授权管理员可以提交供应商签发的恢复凭据，刷新或重新导入都不能恢复' } }
  }
  if (!status.current) {
    if (status.pending) {
      return { ...base, key: 'PENDING_ONLY', label: '等待生效日', tone: 'info', step: 2,
        description: `待生效许可证（版本 ${status.pending.version}）已导入并通过验签，但还没有到生效时间。`,
        action: { label: '查看待生效许可证', target: 'pending', hint: '到达生效时间后，刷新状态时由服务端自动切换为当前授权，不需要再次导入' } }
    }
    return { ...base, key: 'NO_LICENSE', label: '未导入许可证', tone: 'warning', step: 1,
      description: '当前没有生效许可证，业务系统按未授权处理。',
      action: canManage
        ? { label: '导入许可证', target: 'import', hint: '选择或粘贴供应商签发的 compact JWS（≤256 KiB）' }
        : { label: '需要商业授权管理权限才能导入', target: 'none', hint: '请联系授权管理员导入许可证' } }
  }
  if (total === 0) {
    return { ...base, key: 'NO_SYSTEMS', label: '许可证未覆盖业务系统', tone: 'warning', step: 2,
      description: '当前许可证没有覆盖任何业务系统，因此没有可显示的授权与执行状态。',
      action: canManage
        ? { label: '导入许可证', target: 'import', hint: '请核对签发范围，或导入包含业务系统的许可证' }
        : { label: '请核对许可证覆盖范围', target: 'none', hint: '请联系授权管理员核对签发范围' } }
  }
  if (expired === total) {
    return { ...base, key: 'EXPIRED', label: '许可证已过期', tone: 'danger', step: 2,
      description: `${total} 个已授权系统的有效期都已结束，业务系统按未授权处理。`,
      action: canManage
        ? { label: '导入续期许可证', target: 'import', hint: '续签版本必须高于当前已生效版本' }
        : { label: '需要授权管理员续期', target: 'none', hint: '续签版本必须高于当前已生效版本' } }
  }
  if (applying > 0) {
    return { ...base, key: 'APPLYING', label: '激活中', tone: 'info', step: 3,
      description: `${applying} 个系统正在应用运行时授权限制，等待组件准备并确认当前修订。`,
      action: { label: '查看激活进度', target: 'runtime', hint: '等待组件 READY 与 ACK 后自动变为已强制执行' } }
  }
  if (pendingEnforcement > 0) {
    return { ...base, key: 'PENDING_ACTIVATION', label: '待激活', tone: 'warning', step: 3,
      description: `${pendingEnforcement} 个系统已获得有效许可证，但尚未启用运行时强制执行。`,
      action: { label: canManage ? '去激活' : '查看运行详情', target: 'runtime', hint: canManage ? '激活需要逐应用核对执行修订并显式确认' : '需要商业授权管理权限才能发起激活' } }
  }
  if (total > 0 && enforced === total) {
    return { ...base, key: 'ENFORCED', label: '已强制执行', tone: 'success', step: 4,
      description: `${total} 个已授权系统都已启用运行时授权限制。`,
      action: { label: '查看运行详情', target: 'runtime', hint: '执行结果以组件确认记录为准' } }
  }
  if (total > 0 && waiting === total) {
    return { ...base, key: 'PENDING_EFFECTIVE', label: '等待生效日', tone: 'info', step: 2,
      description: `许可证已导入并通过验签，但还没有到生效时间（${total} 个系统尚未生效）。`,
      action: { label: '查看待生效许可证', target: status.pending ? 'pending' : 'apps', hint: '到达生效时间后刷新状态即可，不需要重新导入' } }
  }
  return { ...base, key: 'IN_PROGRESS', label: '进行中', tone: 'info', step: 3,
    description: `已强制执行 ${enforced} 个 · 待激活 ${pendingEnforcement} 个 · 待生效 ${waiting} 个 · 已过期 ${expired} 个 · 状态未知 ${unknownEnforcement} 个${unregistered ? ` · 未纳管 ${unregistered} 个` : ''}。`,
    action: { label: '查看应用状态', target: 'apps', hint: unknownEnforcement ? '运行执行状态还未读取到，请查看逐应用概览后再判断' : '按每个系统的下一步逐一核对' } }
}

/**
 * 步骤条：导入 → 生效 → 激活 → 强制执行。
 * 只把第一个未完成步骤标记为 current，避免同时出现多个“当前步骤”。
 */
export function licenseSteps({ status, appRows = [] } = {}) {
  const hasCurrent = Boolean(status?.current)
  const total = appRows.length
  const effectiveRows = appRows.filter(row => ['IMPORTED', 'EXPIRED'].includes(row.license.key)).length
  const progressRows = appRows.filter(row => ['ENFORCED', 'APPLYING'].includes(row.enforcement.key)).length
  const enforcedRows = appRows.filter(row => row.enforcement.key === 'ENFORCED').length
  const done = [
    hasCurrent,
    effectiveRows > 0,
    progressRows > 0,
    total > 0 && enforcedRows === total,
  ]
  const labels = [
    { key: 'import', label: '导入许可证', hint: hasCurrent ? `当前版本 ${status?.current?.version ?? '—'}` : '还没有生效许可证' },
    { key: 'effective', label: '到达生效日', hint: effectiveRows ? `${effectiveRows} 个系统已生效` : '生效时间以许可证为准' },
    { key: 'activate', label: '触发激活', hint: progressRows ? `${progressRows} 个系统已提交激活` : '逐应用提交，需要显式确认' },
    { key: 'enforced', label: '强制执行', hint: total ? `${enforcedRows}/${total} 个系统已强制执行` : '等待许可证覆盖系统' },
  ]
  let currentAssigned = false
  return labels.map((item, index) => {
    let state = done[index] ? 'done' : 'todo'
    if (!done[index] && !currentAssigned) { state = 'current'; currentAssigned = true }
    return { ...item, state }
  })
}
