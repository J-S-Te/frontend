// 多导览（门户 + 各子系统）+ 上手清单的唯一状态层（纯函数，可在 node 测试里直接运行）。
//
// 设计约束（产品最终决策，2026-11-08）：
//   · 纯前端，不新增后端、不改权限；数据只存在当前浏览器 localStorage；
//   · 存储与记录都按 (tenant, user) 作用域隔离，主体不明（未登录 / 未识别）时一律不读不写；
//   · 导览升级为“每 (tenant, user, guide) 独立 tour/step”：guide 由 route.name 映射，
//     portal / platform / contract / project / settlement / customer_opportunity /
//     customer_portal / data_analysis 各自维护终态，互不覆盖；
//   · 上手清单（tasks）只保留在门户语境，仍是一份共享记录；
//   · 存储版本 v2：记录为 { v, guides, tasks, doneAt, resetAt }；旧 v1 记录
//     { v:1, tour, step, tasks, seenAt, doneAt, resetAt } 自动迁移为 portal guide + tasks，
//     其他 guide 从 pending 开始；旧 v1 存储键在首次确保记录时清理；
//   · 每 (tenant, user, guide, 版本) 只自动导览一次：done/skipped 是终态；running 在离开
//     该子系统 / pagehide 时落为 skipped，不自动续播；只有显式重看或版本变更才会重开；
//   · 缺锚点的步骤跳过；导览首步锚点缺失时整次不启动（子系统即 nav 缺失不启动）；
//   · 多标签页写入按“清单任务 OR、每个 guide 的终态单调”合并，本地写入前先重读并合并。
//
// 这里不碰 DOM、不碰 Vue，所有存储与时间源都由调用方注入，便于测试隔离。

import { checkPermission } from '../../auth/utils/permissions.js'

/** 记录结构版本。变更后同一主体会重新看到一次各 guide 的导览（清单进度保留）。 */
export const FIRST_RUN_VERSION = 2

/** 当前 localStorage 作用域格式；v1 键由迁移逻辑只读兼容。 */
export const FIRST_RUN_SCOPE_VERSION = 'v2'

/** 迁移前的作用域格式；只用于旧键定位，不再写入。 */
export const FIRST_RUN_LEGACY_SCOPE_VERSION = 'v1'

/** 存储键前缀；完整键还会拼接 tenant + user 作用域。 */
export const FIRST_RUN_STORAGE_PREFIX = 'basic-platform.first-run'

/** 导览启动延迟：页面就绪后留出首屏渲染与壳层布局时间，避免气泡贴错位置。 */
export const FIRST_RUN_TOUR_STEP_DELAY_MS = 600

/** 导览遮罩 + 气泡 + 高亮环的固定层级：低于确认框 10000、toast 12000。 */
export const FIRST_RUN_Z_INDEX = 9000

/** 上手清单面板层级：高于导览、仍低于确认框 10000。 */
export const FIRST_RUN_CHECKLIST_Z_INDEX = 9100

/** 锚点统一用 data 属性声明，模板与导览逻辑不互相引用组件实例。 */
export const FIRST_RUN_ANCHOR_ATTRIBUTE = 'data-first-run-anchor'

/** 进入审计日志页即视为完成第 ⑤ 项；前端只用于展示，真正权限仍由路由与后端校验。 */
export const FIRST_RUN_AUDIT_PERMISSION = 'platform:audit:view'

/** 第 ④ 项探测账号数量所需的读取权限；无权限时该项不展示。 */
export const FIRST_RUN_USER_READ_PERMISSION = 'platform:user:read'

export const FIRST_RUN_TOUR_STATES = Object.freeze(['pending', 'running', 'done', 'skipped'])

/** 门户 guide 键：旧 v1 记录迁移到它，也是所有“未指定 guide”调用的默认值。 */
export const FIRST_RUN_PORTAL_GUIDE = 'portal'

/**
 * 导览 5 步（门户）。顺序即产品决策：门户 header → 子系统卡片区 → 主题切换 →
 * 用户面板 → 上手清单入口。anchor 值必须与门户模板里的 data-first-run-anchor 完全一致。
 * 子系统 guide 使用统一的 3 步模板（见 createSubsystemGuideSteps）。
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

/** 子系统壳层统一锚点：导航 / 当前模块标题与主操作区 / 返回统一门户入口。 */
export const FIRST_RUN_SUBSYSTEM_ANCHORS = Object.freeze({
  nav: 'subsystem-nav',
  title: 'subsystem-title',
  portal: 'subsystem-portal',
})

/**
 * 子系统 3 步轻量导览。文案只描述“这里是什么、能做什么”，不承诺具体业务操作，
 * 也不重复各系统内部的复杂流程；系统名由调用方传入。
 * @param {string} systemName 面向用户的系统名称。
 * @returns {ReadonlyArray<Object>} 3 个步骤定义。
 */
function createSubsystemGuideSteps(systemName) {
  return Object.freeze([
    Object.freeze({
      key: 'nav',
      anchor: FIRST_RUN_SUBSYSTEM_ANCHORS.nav,
      title: `${systemName}导航`,
      description: `这里是${systemName}的导航菜单，只显示你有权限访问的页面。`,
    }),
    Object.freeze({
      key: 'title',
      anchor: FIRST_RUN_SUBSYSTEM_ANCHORS.title,
      title: `${systemName}主操作区`,
      description: '当前页面的标题和主要操作集中在这里；可执行的操作仍由你的权限决定。',
    }),
    Object.freeze({
      key: 'portal',
      anchor: FIRST_RUN_SUBSYSTEM_ANCHORS.portal,
      title: '返回统一门户',
      description: '需要切换系统时，使用导航里的“返回子系统门户”回到统一门户。',
    }),
  ])
}

/**
 * guide 注册表：route.name 映射到 guide key，每个 guide 有自己的步骤与文案。
 * 只登记已接入统一前端的业务系统；未知路由不启动任何导览。
 */
export const FIRST_RUN_GUIDES = Object.freeze({
  portal: Object.freeze({
    key: 'portal',
    label: '平台导览',
    systemName: '基础能力平台',
    routeNames: Object.freeze(['portal']),
    steps: FIRST_RUN_TOUR_STEPS,
    kind: 'portal',
  }),
  platform: Object.freeze({
    key: 'platform',
    label: '平台控制台导览',
    systemName: '平台控制台',
    routeNames: Object.freeze(['settings', 'audit']),
    steps: createSubsystemGuideSteps('平台控制台'),
    kind: 'subsystem',
  }),
  contract: Object.freeze({
    key: 'contract',
    label: '合同管理导览',
    systemName: '合同管理',
    routeNames: Object.freeze(['contract_management']),
    steps: createSubsystemGuideSteps('合同管理'),
    kind: 'subsystem',
  }),
  project: Object.freeze({
    key: 'project',
    label: '项目管理导览',
    systemName: '项目管理',
    routeNames: Object.freeze(['project_management']),
    steps: createSubsystemGuideSteps('项目管理'),
    kind: 'subsystem',
  }),
  settlement: Object.freeze({
    key: 'settlement',
    label: '结算与开票导览',
    systemName: '结算与开票',
    routeNames: Object.freeze(['settlement']),
    steps: createSubsystemGuideSteps('结算与开票'),
    kind: 'subsystem',
  }),
  customer_opportunity: Object.freeze({
    key: 'customer_opportunity',
    label: '客户与商机导览',
    systemName: '客户与商机',
    routeNames: Object.freeze(['customer_opportunity']),
    steps: createSubsystemGuideSteps('客户与商机'),
    kind: 'subsystem',
  }),
  customer_portal: Object.freeze({
    key: 'customer_portal',
    label: '客户门户导览',
    systemName: '客户自助门户',
    routeNames: Object.freeze(['customer_portal']),
    steps: createSubsystemGuideSteps('客户自助门户'),
    kind: 'subsystem',
  }),
  data_analysis: Object.freeze({
    key: 'data_analysis',
    label: '数据看板导览',
    systemName: '数据看板',
    routeNames: Object.freeze(['data_analysis']),
    steps: createSubsystemGuideSteps('数据看板'),
    kind: 'subsystem',
  }),
})

export const FIRST_RUN_GUIDE_KEYS = Object.freeze(Object.keys(FIRST_RUN_GUIDES))

const ROUTE_GUIDE_KEYS = (() => {
  const map = {}
  FIRST_RUN_GUIDE_KEYS.forEach((guideKey) => {
    FIRST_RUN_GUIDES[guideKey].routeNames.forEach((routeName) => { map[routeName] = guideKey })
  })
  return Object.freeze(map)
})()

/**
 * 由路由名选择当前 guide。只认已接入的业务路由；登录、错误页、CRM 辅助标签页等
 * 不触发任何导览。
 * @param {string} routeName vue-router 路由名。
 * @returns {string} guide key；未登记时返回空串。
 */
export function firstRunGuideKeyForRouteName(routeName) {
  return ROUTE_GUIDE_KEYS[String(routeName || '')] || ''
}

/** 某个 guide 的步骤清单；未知 guide 回退到门户步骤，避免调用方拿到空数组。 */
export function firstRunGuideSteps(guideKey) {
  return FIRST_RUN_GUIDES[guideKey]?.steps || FIRST_RUN_TOUR_STEPS
}

/** 某个 guide 面向用户的标题；未知 guide 回退到门户标题。 */
export function firstRunGuideLabel(guideKey) {
  return FIRST_RUN_GUIDES[guideKey]?.label || FIRST_RUN_GUIDES[FIRST_RUN_PORTAL_GUIDE].label
}

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

const RECORD_KEYS = Object.freeze(['v', 'guides', 'tasks', 'doneAt', 'resetAt'])
const GUIDE_KEYS = Object.freeze(['tour', 'step', 'seenAt'])

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
 * @returns {string} 'v2|t:<tenant>|u:<identity>'；关键字段缺失时返回空串。
 */
export function firstRunScopeOf(principal) {
  const source = principal && typeof principal === 'object' ? principal : {}
  const tenant = firstString(source.tenant_id, source.tenantId, source.tenant?.id, source.tenant?.tenant_id)
  const identity = firstString(source.identity_id, source.sub, source.user_id, source.user?.identity_id, source.user?.id)
  if (!tenant || !identity) return ''
  return `${FIRST_RUN_SCOPE_VERSION}|t:${tenant}|u:${identity}`
}

/**
 * 旧 v1 作用域字符串；只用于读取待迁移记录。
 * @param {string} scope 当前 v2 作用域。
 * @returns {string} 对应 v1 作用域；作用域不合法时返回空串。
 */
export function firstRunLegacyScopeOf(scope) {
  if (typeof scope !== 'string' || !scope.startsWith(`${FIRST_RUN_SCOPE_VERSION}|`)) return ''
  return `${FIRST_RUN_LEGACY_SCOPE_VERSION}|${scope.slice(FIRST_RUN_SCOPE_VERSION.length + 1)}`
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

/** 单个 guide 的初始状态。 */
export function createGuideState() {
  return { tour: 'pending', step: 0, seenAt: null }
}

/** 所有已知 guide 的初始状态（每个 guide 独立）。 */
function emptyGuides() {
  const guides = {}
  FIRST_RUN_GUIDE_KEYS.forEach((key) => { guides[key] = createGuideState() })
  return guides
}

function clampStep(value, count) {
  const step = Number(value)
  const limit = Math.max(0, Number(count) - 1)
  if (!Number.isInteger(step) || step < 0) return 0
  return Math.min(step, limit)
}

function normalizedGuide(value, guideKey) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  const steps = firstRunGuideSteps(guideKey)
  return {
    tour: FIRST_RUN_TOUR_STATES.includes(source.tour) ? source.tour : 'pending',
    step: clampStep(source.step, steps.length),
    seenAt: asTimestamp(source.seenAt),
  }
}

/**
 * 新主体的初始记录。所有时间戳先留空，由真实事件（终态、完成、重置）写入。
 * @returns {{v:number,guides:Object,tasks:Object,doneAt:null,resetAt:null}}
 */
export function createFirstRunRecord() {
  return {
    v: FIRST_RUN_VERSION,
    guides: emptyGuides(),
    tasks: emptyTasks(),
    doneAt: null,
    resetAt: null,
  }
}

/**
 * 把存储里读到的任意内容收口成当前记录结构。
 * · 旧 v1（无 guides、含 tour/step/seenAt）：迁移为 portal guide + tasks，portal 的终端
 *   状态与 seenAt 保留（升级不强制重看），其他 guide 从 pending 开始；
 * · v2 且版本一致：保留每个 guide 的独立状态；
 * · 其他版本号（未来 v3+）：所有 guide 回到 pending（版本变更重看一次），清单进度保留；
 * · 未知字段、非法类型、注入字段全部丢弃，记录里只可能出现固定键与 5 个任务键。
 * @param {unknown} raw 存储里的原始记录。
 * @returns {Object} 合法记录。
 */
export function normalizeFirstRunRecord(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return createFirstRunRecord()
  const rawVersion = Number(raw.v)
  const hasGuideMap = raw.guides && typeof raw.guides === 'object' && !Array.isArray(raw.guides)
  // 旧 v1 记录没有 guides，只有顶层 tour/step/seenAt；按 portal guide 迁移。
  const legacy = !hasGuideMap
  const versionMismatch = !legacy && rawVersion !== FIRST_RUN_VERSION
  const guides = {}
  FIRST_RUN_GUIDE_KEYS.forEach((guideKey) => {
    if (legacy) {
      guides[guideKey] = guideKey === FIRST_RUN_PORTAL_GUIDE
        ? normalizedGuide(raw, guideKey)
        : createGuideState()
    } else if (versionMismatch) {
      guides[guideKey] = createGuideState()
    } else {
      guides[guideKey] = normalizedGuide(raw.guides[guideKey], guideKey)
    }
  })
  return {
    v: FIRST_RUN_VERSION,
    guides,
    tasks: normalizedTasks(raw.tasks),
    doneAt: asTimestamp(raw.doneAt),
    resetAt: asTimestamp(raw.resetAt),
  }
}

function parseStoredRecord(store, key) {
  if (!store || !key) return null
  try {
    const raw = JSON.parse(store.getItem(key) || 'null')
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
    return raw
  } catch {
    return null
  }
}

/**
 * 读取当前作用域的记录。当前 v2 键优先；没有时回退读取旧 v1 键并返回迁移结果
 * （只读，不写盘）。作用域为空或存储不可用时返回 null 且不触碰存储。
 * @param {string} scope 作用域。
 * @param {Storage|null} [storage] 可注入的存储；缺省用 window.localStorage。
 * @returns {Object|null} 已归一化的记录。
 */
export function readFirstRunRecord(scope, storage = undefined) {
  const key = firstRunStorageKey(scope)
  if (!key) return null
  const store = storage === undefined ? safeStorage() : storage
  if (!store) return null
  const current = parseStoredRecord(store, key)
  if (current) return normalizeFirstRunRecord(current)
  const legacyScope = firstRunLegacyScopeOf(scope)
  const legacyKey = firstRunStorageKey(legacyScope)
  if (!legacyKey) return null
  const legacy = parseStoredRecord(store, legacyKey)
  return legacy ? normalizeFirstRunRecord(legacy) : null
}

/** 迁移完成后清理旧 v1 键；失败只影响是否有残留旧键，不影响当前记录。 */
function removeLegacyRecord(scope, store) {
  const legacyKey = firstRunStorageKey(firstRunLegacyScopeOf(scope))
  if (!legacyKey) return
  try {
    store.removeItem(legacyKey)
  } catch {
    // 存储只读或被禁用时忽略：当前 v2 键已经写入，旧键残留不会覆盖新记录。
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
 * 旧 v1 记录在这里完成迁移写回并删除旧键。
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
  removeLegacyRecord(scope, store)
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
 * 某个 guide 的导览是否处于 pending（只有 pending 会自动启动）。
 * running 表示上次展示被页面隐藏/离开中断，已由 interruptTour 落为 skipped，
 * 即使因为崩溃残留 running，也绝不自动续播，必须由显式重看重新打开。
 * @param {Object|null} record 记录。
 * @param {string} [guideKey] guide 键，缺省为门户。
 * @returns {Object} guide 状态（未知 guide 返回 pending 初始态）。
 */
export function firstRunGuideState(record, guideKey = FIRST_RUN_PORTAL_GUIDE) {
  const key = FIRST_RUN_GUIDES[guideKey] ? guideKey : FIRST_RUN_PORTAL_GUIDE
  const guide = record?.guides?.[key]
  return guide && typeof guide === 'object' ? guide : createGuideState()
}

/** 指定 guide 是否会自动启动（pending）。 */
export function isFirstRunTourOpen(record, guideKey = FIRST_RUN_PORTAL_GUIDE) {
  return firstRunGuideState(record, guideKey).tour === 'pending'
}

/** 指定 guide 是否已到终态（done / skipped 都不会被 running 覆盖）。 */
export function isFirstRunTourTerminal(record, guideKey = FIRST_RUN_PORTAL_GUIDE) {
  const tour = firstRunGuideState(record, guideKey).tour
  return tour === 'done' || tour === 'skipped'
}

/**
 * 自动启动导览的全部前置条件：当前路由映射到 guide、会话/页面就绪、页面可见、
 * 没有确认框、该 guide 尚未到终态、首步锚点存在。
 * 门户额外要求目录 settled（catalogReady）；子系统在路由守卫已确认会话后即可启动。
 * @param {Object} options 条件集合。
 * @returns {boolean} 是否允许启动。
 */
export function shouldStartFirstRunTour({
  routeName,
  guideKey,
  sessionReady,
  catalogReady,
  pageVisible,
  confirmDialogOpen,
  record,
  firstAnchorAvailable,
  headerAnchorAvailable,
} = {}) {
  const key = guideKey || firstRunGuideKeyForRouteName(routeName)
  if (!key) return false
  if (sessionReady !== true) return false
  if (key === FIRST_RUN_PORTAL_GUIDE && catalogReady !== true) return false
  if (pageVisible === false) return false
  if (confirmDialogOpen === true) return false
  if (!isFirstRunTourOpen(record, key)) return false
  const anchorReady = firstAnchorAvailable ?? headerAnchorAvailable
  return anchorReady === true
}

/**
 * 从 fromIndex 开始向后找第一个存在锚点的步骤；全部缺失返回 -1。
 * @param {number} fromIndex 起始下标（含）。
 * @param {(anchor:string)=>boolean} hasAnchor 锚点探测。
 * @param {ReadonlyArray<Object>} [steps] guide 步骤；缺省为门户 5 步。
 * @returns {number} 步骤下标或 -1。
 */
export function resolveNextTourStepIndex(fromIndex, hasAnchor, steps = FIRST_RUN_TOUR_STEPS) {
  const start = Math.max(0, Number(fromIndex) || 0)
  for (let index = start; index < steps.length; index += 1) {
    if (hasAnchor(steps[index].anchor)) return index
  }
  return -1
}

/**
 * 从 fromIndex 开始向前找第一个存在锚点的步骤；全部缺失返回 -1。
 * @param {number} fromIndex 起始下标（含）。
 * @param {(anchor:string)=>boolean} hasAnchor 锚点探测。
 * @param {ReadonlyArray<Object>} [steps] guide 步骤；缺省为门户 5 步。
 * @returns {number} 步骤下标或 -1。
 */
export function resolvePreviousTourStepIndex(fromIndex, hasAnchor, steps = FIRST_RUN_TOUR_STEPS) {
  const start = Math.min(Number(fromIndex) || 0, steps.length - 1)
  for (let index = start; index >= 0; index -= 1) {
    if (hasAnchor(steps[index].anchor)) return index
  }
  return -1
}

/**
 * 记录导览已启动并停在某一步（按 guide 独立写入）。
 * @param {Object} record 记录。
 * @param {number} index 步骤下标。
 * @param {string} [guideKey] guide 键，缺省为门户。
 * @returns {Object} 新记录。
 */
export function withTourStarted(record, index, guideKey = FIRST_RUN_PORTAL_GUIDE) {
  if (!record) return record
  const key = FIRST_RUN_GUIDES[guideKey] ? guideKey : FIRST_RUN_PORTAL_GUIDE
  const current = firstRunGuideState(record, key)
  // 终态单调：已 done / skipped 的记录不能被迟到的 running 写入覆盖。
  if (current.tour === 'done' || current.tour === 'skipped') return record
  const steps = firstRunGuideSteps(key)
  return {
    ...record,
    guides: {
      ...record.guides,
      [key]: { ...current, tour: 'running', step: clampStep(index, steps.length) },
    },
  }
}

/**
 * 指定 guide 的导览到达终态。done / skipped 都是终态：不会再次自动出现，直到显式
 * “重新查看”或版本变更；seenAt 只在该 guide 首次进入终态时写入。
 * done 是吸收态：另一个标签页已经完成时，迟到的 skipped 不会把 done 降级。
 * @param {Object} record 记录。
 * @param {'done'|'skipped'} outcome 终态类型。
 * @param {string} at 时间（ISO 字符串）。
 * @param {string} [guideKey] guide 键，缺省为门户。
 * @returns {Object} 新记录；无变化时返回原对象。
 */
export function withTourFinished(record, outcome, at, guideKey = FIRST_RUN_PORTAL_GUIDE) {
  if (!record) return record
  const key = FIRST_RUN_GUIDES[guideKey] ? guideKey : FIRST_RUN_PORTAL_GUIDE
  const current = firstRunGuideState(record, key)
  if (current.tour === 'done') return record
  if (outcome !== 'done' && current.tour === 'skipped') return record
  return {
    ...record,
    guides: {
      ...record.guides,
      [key]: {
        ...current,
        tour: outcome === 'done' ? 'done' : 'skipped',
        seenAt: current.seenAt || asTimestamp(at),
      },
    },
  }
}

/**
 * 合并两个标签页各自读到的记录（多标签页 storage 事件与写前重读共用）。
 *
 * 规则：
 *   · 清单任务按 OR 合并；若两侧 resetAt 不同，说明其中一侧执行过“重置清单”，
 *     以更晚重置的一侧为准，避免把已清空的任务从旧标签页复活；
 *   · doneAt 跟随任务合并结果；
 *   · 每个 guide 独立合并：终态单调（done / skipped 不会被 pending / running 覆盖），
 *     done 吸收 skipped；两侧都 running 时步骤取更靠后的一个；seenAt 取最早非空值。
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

  const guides = {}
  FIRST_RUN_GUIDE_KEYS.forEach((guideKey) => {
    const ga = firstRunGuideState(a, guideKey)
    const gb = firstRunGuideState(b, guideKey)
    const aTerminal = ga.tour === 'done' || ga.tour === 'skipped'
    const bTerminal = gb.tour === 'done' || gb.tour === 'skipped'
    let tour = 'pending'
    let step = 0
    if (aTerminal && bTerminal) {
      const doneSide = ga.tour === 'done' ? ga : (gb.tour === 'done' ? gb : null)
      tour = doneSide ? 'done' : 'skipped'
      step = doneSide ? doneSide.step : ga.step
    } else if (aTerminal) {
      tour = ga.tour
      step = ga.step
    } else if (bTerminal) {
      tour = gb.tour
      step = gb.step
    } else if (ga.tour === 'running' || gb.tour === 'running') {
      tour = 'running'
      step = ga.tour === 'running' && gb.tour === 'running'
        ? Math.max(ga.step, gb.step)
        : (ga.tour === 'running' ? ga.step : gb.step)
    }
    const seenAt = [ga.seenAt, gb.seenAt]
      .filter(Boolean)
      .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))[0] || null
    guides[guideKey] = { tour, step, seenAt }
  })

  const resetAt = aResetAt > bResetAt ? a.resetAt : (bResetAt ? b.resetAt : null)
  return {
    v: FIRST_RUN_VERSION,
    guides,
    tasks,
    doneAt,
    resetAt,
  }
}

/** 显式重看指定 guide：回到 pending，保留 seenAt 与清单进度。 */
export function withTourRestarted(record, guideKey = FIRST_RUN_PORTAL_GUIDE) {
  if (!record) return record
  const key = FIRST_RUN_GUIDES[guideKey] ? guideKey : FIRST_RUN_PORTAL_GUIDE
  const current = firstRunGuideState(record, key)
  return {
    ...record,
    guides: {
      ...record.guides,
      [key]: { ...current, tour: 'pending', step: 0 },
    },
  }
}

/** 显式“重置上手清单”：清空任务与完成时间，记录重置时间；不动任何导览状态。 */
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

/** 单个 guide 的结构键（测试用于确认没有额外字段）。 */
export function firstRunGuideStateKeys() {
  return [...GUIDE_KEYS]
}
