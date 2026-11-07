// 平台导览 + 上手清单的唯一状态层（纯函数，可在 node 测试里直接运行）。
//
// 设计约束（产品最终决策，2026-11-07）：
//   · 只服务 /portal，不新增后端、不改权限；数据只存在当前浏览器 localStorage；
//   · 存储键必须同时包含 tenant 与 user，主体不明（未登录 / 未识别）时一律不读不写；
//   · 记录结构固定为 { v, tour, step, tasks, seenAt, doneAt, resetAt }，不存任何 PII；
//   · 每 (tenant, user, 版本) 只自动导览一次：tour=done/skipped 是终态，只有显式重置
//     或版本变更才会重新展示；running 在离开门户/页面隐藏时落为 skipped，不自动续播；
//   · 缺锚点的步骤跳过；header 锚点缺失时整次导览不启动；
//   · 多标签页写入按“清单任务 OR、导览终态单调”合并，本地写入前先重读并合并最新记录。
//
// 这里不碰 DOM、不碰 Vue，所有存储与时间源都由调用方注入，便于测试隔离。

import { checkPermission } from '../../auth/utils/permissions.js'

/** 导览内容版本。变更后同一主体会重新看到一次导览（清单进度保留）。 */
export const FIRST_RUN_VERSION = 1

/** 存储键前缀；完整键还会拼接 tenant + user 作用域。 */
export const FIRST_RUN_STORAGE_PREFIX = 'basic-platform.first-run'

/** 导览启动延迟：门户就绪后留出首屏渲染与目录卡片布局时间，避免气泡贴错位置。 */
export const FIRST_RUN_TOUR_STEP_DELAY_MS = 600

/** 导览遮罩 + 气泡 + 高亮环的固定层级：低于确认框 10000、toast 12000。 */
export const FIRST_RUN_Z_INDEX = 9000

/** 上手清单面板层级：高于导览、仍低于确认框 10000。 */
export const FIRST_RUN_CHECKLIST_Z_INDEX = 9100

/** 锚点统一用 data 属性声明，门户模板与导览逻辑不互相引用组件实例。 */
export const FIRST_RUN_ANCHOR_ATTRIBUTE = 'data-first-run-anchor'

/** 进入审计日志页即视为完成第 ⑤ 项；前端只用于展示，真正权限仍由路由与后端校验。 */
export const FIRST_RUN_AUDIT_PERMISSION = 'platform:audit:view'

/** 第 ④ 项探测账号数量所需的读取权限；无权限时该项不展示。 */
export const FIRST_RUN_USER_READ_PERMISSION = 'platform:user:read'

export const FIRST_RUN_TOUR_STATES = Object.freeze(['pending', 'running', 'done', 'skipped'])

/**
 * 导览 5 步。顺序即产品决策：门户 header → 子系统卡片区 → 主题切换 → 用户面板 →
 * 上手清单入口。anchor 值必须与门户模板里的 data-first-run-anchor 完全一致。
 */
export const FIRST_RUN_TOUR_STEPS = Object.freeze([
  Object.freeze({
    key: 'header',
    anchor: 'portal-header',
    title: '平台门户',
    description: '这里是基础能力平台门户。页头右侧可以切换主题、查看上手清单，并打开当前用户面板。',
  }),
  Object.freeze({
    key: 'cards',
    anchor: 'subsystem-cards',
    title: '业务子系统',
    description: '已接入并分配给你的业务子系统都在这里。点击卡片会在新标签页打开对应系统。',
  }),
  Object.freeze({
    key: 'theme',
    anchor: 'theme-switcher',
    title: '主题切换',
    description: '可以在浅色、深色和跟随系统之间切换；选择只保存在当前浏览器，不会影响其他用户。',
  }),
  Object.freeze({
    key: 'user-panel',
    anchor: 'user-panel',
    title: '用户面板',
    description: '点开右上角用户区域，可以查看当前账号与角色，随时重新查看平台导览或重置上手清单。',
  }),
  Object.freeze({
    key: 'checklist-entry',
    anchor: 'checklist-entry',
    title: '上手清单',
    description: '上手清单记录 5 项真实完成的上手动作。入口就在这里，门户页脚也有同样入口。',
  }),
])

export const FIRST_RUN_HEADER_ANCHOR = FIRST_RUN_TOUR_STEPS[0].anchor

/**
 * 上手清单 5 项。permission 存在时，只有当前主体具备该权限才展示并允许记为完成；
 * 完成只来自真实事件（打开面板、打开子系统、切换主题、账号数量探测、访问审计页），
 * 不使用“点击清单即完成”这类伪造路径。
 */
export const FIRST_RUN_TASKS = Object.freeze([
  Object.freeze({
    key: 'userPanel',
    title: '打开用户面板',
    hint: '点击门户右上角的用户区域，查看当前账号、角色与退出入口。',
  }),
  Object.freeze({
    key: 'subsystem',
    title: '进入任一业务子系统',
    hint: '点击任意一张已接入的子系统卡片；没有可用卡片时请联系管理员分配应用角色。',
  }),
  Object.freeze({
    key: 'theme',
    title: '切换主题',
    hint: '在页头把主题切换到浅色、深色或跟随系统。',
  }),
  Object.freeze({
    key: 'firstAccount',
    title: '创建首个业务账号',
    hint: '在“系统设置 → 人员 → 用户”里新建员工（创建首个业务账号）。门户只读检测租户内是否已有业务账号（系统自动检测），不改动任何数据。',
    permission: FIRST_RUN_USER_READ_PERMISSION,
  }),
  Object.freeze({
    key: 'audit',
    title: '查看审计日志',
    hint: '打开一次审计日志页面即可完成；门户只观察路由，不代替你跳转。',
    permission: FIRST_RUN_AUDIT_PERMISSION,
  }),
])

export const FIRST_RUN_TASK_KEYS = Object.freeze(FIRST_RUN_TASKS.map((task) => task.key))

const RECORD_KEYS = Object.freeze(['v', 'tour', 'step', 'tasks', 'seenAt', 'doneAt', 'resetAt'])

function firstString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim()
    if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  }
  return ''
}

function safeStorage() {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage || null
  } catch {
    return null
  }
}

/**
 * 由当前会话主体派生存储作用域。字段优先级与 shared/sessionScopedStorage 保持一致，
 * 但这里只存 localStorage，且只允许出现 ID，不写姓名、账号名、邮箱等 PII。
 * @param {Object|null} principal 当前主体。
 * @returns {string} 'v1|t:<tenant>|u:<identity>'；关键字段缺失时返回空串。
 */
export function firstRunScopeOf(principal) {
  const source = principal && typeof principal === 'object' ? principal : {}
  const tenant = firstString(source.tenant_id, source.tenantId, source.tenant?.id, source.tenant?.tenant_id)
  const identity = firstString(source.identity_id, source.sub, source.user_id, source.user?.identity_id, source.user?.id)
  if (!tenant || !identity) return ''
  return `v1|t:${tenant}|u:${identity}`
}

/**
 * 存储键：前缀 + 作用域，键里同时出现 tenant 与 user，切换账号不会读到上一账号的记录。
 * @param {string} scope firstRunScopeOf 的返回值。
 * @returns {string} 完整键；作用域为空时返回空串（调用方不得读写）。
 */
export function firstRunStorageKey(scope) {
  return scope ? `${FIRST_RUN_STORAGE_PREFIX}|${scope}` : ''
}

function emptyTasks() {
  const tasks = {}
  FIRST_RUN_TASK_KEYS.forEach((key) => { tasks[key] = false })
  return tasks
}

function normalizedTasks(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  const tasks = {}
  FIRST_RUN_TASK_KEYS.forEach((key) => { tasks[key] = source[key] === true })
  return tasks
}

function asTimestamp(value) {
  if (typeof value !== 'string' || !value.trim()) return null
  return Number.isFinite(Date.parse(value)) ? value : null
}

function clampStep(value) {
  const step = Number(value)
  if (!Number.isInteger(step) || step < 0) return 0
  return Math.min(step, FIRST_RUN_TOUR_STEPS.length - 1)
}

/**
 * 新主体的初始记录。所有时间戳先留空，由真实事件（终态、完成、重置）写入。
 * @returns {{v:number,tour:string,step:number,tasks:Object,seenAt:null,doneAt:null,resetAt:null}}
 */
export function createFirstRunRecord() {
  return {
    v: FIRST_RUN_VERSION,
    tour: 'pending',
    step: 0,
    tasks: emptyTasks(),
    seenAt: null,
    doneAt: null,
    resetAt: null,
  }
}

/**
 * 把存储里读到的任意内容收口成当前记录结构。
 * · 版本不一致：导览回到 pending（“版本变更重看一次”），清单进度与时间戳保留；
 * · 未知字段、非法类型、注入字段全部丢弃，记录里只可能出现固定 7 个键与 5 个任务键。
 * @param {unknown} raw 存储里的原始记录。
 * @returns {Object} 合法记录。
 */
export function normalizeFirstRunRecord(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return createFirstRunRecord()
  const versionMismatch = Number(raw.v) !== FIRST_RUN_VERSION
  const tour = versionMismatch
    ? 'pending'
    : (FIRST_RUN_TOUR_STATES.includes(raw.tour) ? raw.tour : 'pending')
  return {
    v: FIRST_RUN_VERSION,
    tour,
    step: versionMismatch ? 0 : clampStep(raw.step),
    tasks: normalizedTasks(raw.tasks),
    seenAt: asTimestamp(raw.seenAt),
    doneAt: asTimestamp(raw.doneAt),
    resetAt: asTimestamp(raw.resetAt),
  }
}

/**
 * 读取当前作用域的记录。作用域为空或存储不可用时返回 null 且不触碰存储。
 * @param {string} scope 作用域。
 * @param {Storage|null} [storage] 可注入的存储；缺省用 window.localStorage。
 * @returns {Object|null} 已归一化的记录。
 */
export function readFirstRunRecord(scope, storage = undefined) {
  const key = firstRunStorageKey(scope)
  if (!key) return null
  const store = storage === undefined ? safeStorage() : storage
  if (!store) return null
  try {
    const raw = JSON.parse(store.getItem(key) || 'null')
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
    return normalizeFirstRunRecord(raw)
  } catch {
    return null
  }
}

/**
 * 写入记录；作用域为空或存储不可用时返回 false 且不产生写入。
 * @param {string} scope 作用域。
 * @param {Object} record 记录。
 * @param {Storage|null} [storage] 可注入的存储。
 * @returns {boolean} 是否写入成功。
 */
export function writeFirstRunRecord(scope, record, storage = undefined) {
  const key = firstRunStorageKey(scope)
  if (!key || !record) return false
  const store = storage === undefined ? safeStorage() : storage
  if (!store) return false
  try {
    store.setItem(key, JSON.stringify(normalizeFirstRunRecord(record)))
    return true
  } catch {
    return false
  }
}

/**
 * 读取并确保记录存在；不存在时创建并持久化。作用域为空时绝不创建（主体不明不读写）。
 * @param {string} scope 作用域。
 * @param {Storage|null} [storage] 可注入的存储。
 * @returns {Object|null} 记录；作用域为空时返回 null。
 */
export function ensureFirstRunRecord(scope, storage = undefined) {
  if (!scope) return null
  const store = storage === undefined ? safeStorage() : storage
  if (!store) return null
  const existing = readFirstRunRecord(scope, store)
  const record = existing || createFirstRunRecord()
  // 版本迁移（或首次创建）后把归一化结果写回，避免每次读取都重新迁移。
  writeFirstRunRecord(scope, record, store)
  return record
}

/** 某个任务是否对当前主体可见（无权限要求的任务恒可见）。 */
export function isFirstRunTaskVisible(key, principal) {
  const task = FIRST_RUN_TASKS.find((item) => item.key === key)
  if (!task) return false
  if (!task.permission) return true
  return checkPermission(principal, task.permission)
}

/** 当前主体可见的任务定义（顺序即产品顺序）。 */
export function visibleFirstRunTasks(principal) {
  return FIRST_RUN_TASKS.filter((task) => isFirstRunTaskVisible(task.key, principal))
}

/**
 * 清单进度。分母只算可见任务：没有 user:read / audit:view 的主体看到的是 n/3，
 * 具备两项权限时即产品口径的 n/5。
 * @param {Object|null} record 记录。
 * @param {Object|null} principal 主体。
 * @returns {{done:number,total:number,complete:boolean,visibleKeys:string[]}}
 */
export function firstRunChecklistSummary(record, principal) {
  const visibleKeys = visibleFirstRunTasks(principal).map((task) => task.key)
  const tasks = record?.tasks && typeof record.tasks === 'object' ? record.tasks : {}
  const done = visibleKeys.filter((key) => tasks[key] === true).length
  return {
    done,
    total: visibleKeys.length,
    complete: visibleKeys.length > 0 && done === visibleKeys.length,
    visibleKeys,
  }
}

/**
 * 标记单个任务完成（幂等、不可见任务不写、不满足权限不写）。
 * 完成时间写入 doneAt：所有可见任务都完成时才更新；重复完成返回原对象。
 * @param {Object} record 记录。
 * @param {string} key 任务键。
 * @param {Object|null} principal 主体。
 * @param {string} at 完成时间（ISO 字符串）。
 * @returns {Object} 新记录；无变化时返回原对象。
 */
export function withFirstRunTaskCompleted(record, key, principal, at) {
  if (!record || !FIRST_RUN_TASK_KEYS.includes(key)) return record
  if (record.tasks?.[key] === true) return record
  if (!isFirstRunTaskVisible(key, principal)) return record
  const next = {
    ...record,
    tasks: { ...record.tasks, [key]: true },
  }
  const summary = firstRunChecklistSummary(next, principal)
  if (summary.complete) next.doneAt = asTimestamp(at) || record.doneAt
  return next
}

/**
 * 导览是否可以自动启动。只有 pending 会自动展示：
 * running 表示上次展示被页面隐藏/离开中断，已由 interruptTour 落为 skipped，
 * 即使因为崩溃残留 running，也绝不自动续播，必须由“重新查看平台导览”显式重开。
 */
export function isFirstRunTourOpen(record) {
  return record?.tour === 'pending'
}

/** 导览是否已到终态（done / skipped 都不会被 running 覆盖）。 */
export function isFirstRunTourTerminal(record) {
  return record?.tour === 'done' || record?.tour === 'skipped'
}

/**
 * 自动启动导览的全部前置条件：只在门户、会话与目录就绪、页面可见、没有确认框、
 * 记录尚未到终态、header 锚点存在时启动。
 * @param {Object} options 条件集合。
 * @returns {boolean} 是否允许启动。
 */
export function shouldStartFirstRunTour({
  routeName,
  sessionReady,
  catalogReady,
  pageVisible,
  confirmDialogOpen,
  record,
  headerAnchorAvailable,
} = {}) {
  return routeName === 'portal'
    && sessionReady === true
    && catalogReady === true
    && pageVisible !== false
    && confirmDialogOpen !== true
    && isFirstRunTourOpen(record)
    && headerAnchorAvailable === true
}

/**
 * 从 fromIndex 开始向后找第一个存在锚点的步骤；全部缺失返回 -1。
 * @param {number} fromIndex 起始下标（含）。
 * @param {(anchor:string)=>boolean} hasAnchor 锚点探测。
 * @returns {number} 步骤下标或 -1。
 */
export function resolveNextTourStepIndex(fromIndex, hasAnchor) {
  const start = Math.max(0, Number(fromIndex) || 0)
  for (let index = start; index < FIRST_RUN_TOUR_STEPS.length; index += 1) {
    if (hasAnchor(FIRST_RUN_TOUR_STEPS[index].anchor)) return index
  }
  return -1
}

/**
 * 从 fromIndex 开始向前找第一个存在锚点的步骤；全部缺失返回 -1。
 * @param {number} fromIndex 起始下标（含）。
 * @param {(anchor:string)=>boolean} hasAnchor 锚点探测。
 * @returns {number} 步骤下标或 -1。
 */
export function resolvePreviousTourStepIndex(fromIndex, hasAnchor) {
  const start = Math.min(Number(fromIndex) || 0, FIRST_RUN_TOUR_STEPS.length - 1)
  for (let index = start; index >= 0; index -= 1) {
    if (hasAnchor(FIRST_RUN_TOUR_STEPS[index].anchor)) return index
  }
  return -1
}

/**
 * 记录导览已启动并停在某一步。
 * @param {Object} record 记录。
 * @param {number} index 步骤下标。
 * @returns {Object} 新记录。
 */
export function withTourStarted(record, index) {
  if (!record) return record
  // 终态单调：已 done / skipped 的记录不能被迟到的 running 写入覆盖。
  if (isFirstRunTourTerminal(record)) return record
  return { ...record, tour: 'running', step: clampStep(index) }
}

/**
 * 导览到达终态。done / skipped 都是终态：不会再次自动出现，直到显式“重新查看”
 * 或版本变更；seenAt 只在首次进入终态时写入。
 * done 是吸收态：另一个标签页已经完成时，迟到的 skipped 不会把 done 降级。
 * @param {Object} record 记录。
 * @param {'done'|'skipped'} outcome 终态类型。
 * @param {string} at 时间（ISO 字符串）。
 * @returns {Object} 新记录；无变化时返回原对象。
 */
export function withTourFinished(record, outcome, at) {
  if (!record) return record
  if (record.tour === 'done') return record
  if (outcome !== 'done' && record.tour === 'skipped') return record
  return {
    ...record,
    tour: outcome === 'done' ? 'done' : 'skipped',
    seenAt: record.seenAt || asTimestamp(at),
  }
}

/**
 * 合并两个标签页各自读到的记录（多标签页 storage 事件与写前重读共用）。
 *
 * 规则：
 *   · 清单任务按 OR 合并；若两侧 resetAt 不同，说明其中一侧执行过“重置清单”，
 *     以更晚重置的一侧为准，避免把已清空的任务从旧标签页复活；
 *   · doneAt 跟随任务合并结果；seenAt 取最早的非空值（首次进入终态时间）；
 *   · 导览终态单调：done / skipped 不会被 pending / running 覆盖；两侧都终态时 done 优先。
 * @param {Object} current 内存中的记录。
 * @param {Object} incoming 存储中重读到的记录。
 * @returns {Object} 合并后的合法记录。
 */
export function mergeFirstRunRecords(current, incoming) {
  const a = normalizeFirstRunRecord(current)
  const b = normalizeFirstRunRecord(incoming)
  const aResetAt = a.resetAt || ''
  const bResetAt = b.resetAt || ''
  const resetEqual = aResetAt === bResetAt
  let tasks
  let doneAt
  if (resetEqual) {
    tasks = {}
    FIRST_RUN_TASK_KEYS.forEach((key) => {
      tasks[key] = a.tasks[key] === true || b.tasks[key] === true
    })
    doneAt = a.doneAt || b.doneAt
  } else {
    const newer = aResetAt > bResetAt ? a : b
    tasks = { ...newer.tasks }
    doneAt = newer.doneAt
  }

  const aTerminal = isFirstRunTourTerminal(a)
  const bTerminal = isFirstRunTourTerminal(b)
  let tour = 'pending'
  let step = 0
  if (aTerminal && bTerminal) {
    const doneSide = a.tour === 'done' ? a : (b.tour === 'done' ? b : null)
    tour = doneSide ? 'done' : 'skipped'
    step = doneSide ? doneSide.step : a.step
  } else if (aTerminal) {
    tour = a.tour
    step = a.step
  } else if (bTerminal) {
    tour = b.tour
    step = b.step
  } else if (a.tour === 'running' || b.tour === 'running') {
    tour = 'running'
    step = a.tour === 'running' && b.tour === 'running'
      ? Math.max(a.step, b.step)
      : (a.tour === 'running' ? a.step : b.step)
  }

  const seenAt = [a.seenAt, b.seenAt]
    .filter(Boolean)
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))[0] || null
  const resetAt = aResetAt > bResetAt ? a.resetAt : (bResetAt ? b.resetAt : null)
  return {
    v: FIRST_RUN_VERSION,
    tour,
    step: clampStep(step),
    tasks,
    seenAt,
    doneAt,
    resetAt,
  }
}

/** 显式“重新查看平台导览”：回到 pending，保留 seenAt 与清单进度。 */
export function withTourRestarted(record) {
  if (!record) return record
  return { ...record, tour: 'pending', step: 0 }
}

/** 显式“重置上手清单”：清空任务与完成时间，记录重置时间；不动导览状态。 */
export function withChecklistReset(record, at) {
  if (!record) return record
  return {
    ...record,
    tasks: emptyTasks(),
    doneAt: null,
    resetAt: asTimestamp(at) || record.resetAt,
  }
}

/** 记录结构键（测试用于确认没有额外字段/PII）。 */
export function firstRunRecordKeys() {
  return [...RECORD_KEYS]
}
