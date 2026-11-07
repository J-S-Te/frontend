// 平台导览 + 上手清单的响应式状态容器（全局单例 + 可注入工厂）。
//
// 职责边界：
//   · 只服务 /portal；App.vue 挂载的 GuideHost 与门户页面共用同一个单例；
//   · 所有持久化都经过 utils/firstRunState.js，主体不明时不读不写；
//   · 事件写入只发生在真实动作之后（门户把事件转发到这里），本模块不代替用户操作；
//   · 第 ④ 项用一次只读 GET /api/v1/users?page=1&page_size=1 探测。后端 /users 的
//     total 已排除初始化超管，因此 total >= 1 即表示租户内已有业务账号；探测失败
//     保持未完成并允许重试；
//   · 探测请求按 scope + generation 隔离：切主体/重置后迟到的响应直接丢弃；
//   · 多标签页通过 storage 事件合并“任务 OR、导览终态单调”的记录，写前先重读最新值。

import { computed, reactive } from 'vue'
import { checkPermission } from '../../auth/utils/permissions.js'
import { formatUserError } from '../../../shared/utils/userError.js'
import {
  FIRST_RUN_AUDIT_PERMISSION,
  FIRST_RUN_TOUR_STEPS,
  createFirstRunRecord,
  ensureFirstRunRecord,
  firstRunChecklistSummary,
  firstRunScopeOf,
  firstRunStorageKey,
  isFirstRunTaskVisible,
  isFirstRunTourOpen,
  mergeFirstRunRecords,
  readFirstRunRecord,
  resolveNextTourStepIndex,
  resolvePreviousTourStepIndex,
  visibleFirstRunTasks,
  withChecklistReset,
  withFirstRunTaskCompleted,
  withTourFinished,
  withTourRestarted,
  withTourStarted,
  writeFirstRunRecord,
} from '../utils/firstRunState.js'

/**
 * 第 ④ 项的默认只读探测。动态 import 让 IAM 客户端进入独立 chunk，
 * 不因为首登引导把整套 IAM 代码带进门户首屏。
 * @param {Object} query 查询参数。
 * @returns {Promise<Object>} 标准用户分页结果。
 */
async function defaultLoadUsers(query) {
  const { listUsers } = await import('../../iam/api/iam.js')
  return listUsers(query)
}

/**
 * 创建隔离的 first-run 状态容器。
 * @param {Object} [options] 依赖注入。
 * @param {Storage|null} [options.storage] 显式存储；undefined 用 window.localStorage，null 表示不可用。
 * @param {Function} [options.loadUsers] 账号列表读取器（测试注入桩）。
 * @param {Function} [options.now] 时间源，返回 Date / 毫秒 / ISO 字符串。
 * @param {boolean} [options.listenStorage] 是否监听 storage 事件；默认仅真实浏览器的全局单例监听。
 * @returns {Object} 状态与动作集合。
 */
export function createFirstRunStore({
  storage,
  loadUsers: loadUsersFn = defaultLoadUsers,
  now = () => new Date(),
  listenStorage = undefined,
} = {}) {
  const state = reactive({
    principal: null,
    scope: '',
    record: null,
    // 主体/记录已就绪，清单可打开；不代表目录已加载。
    portalReady: false,
    // 目录 settled 后为 true，仅用于控制导览调度。
    catalogReady: false,
    checklistOpen: false,
    tourVisible: false,
    tourIndex: -1,
    routePath: '',
    // idle | checking | incomplete | complete | error
    probeStatus: 'idle',
    probeMessage: '',
  })

  // 探测按 scope 单飞；generation 在切主体/重置时递增，迟到的响应直接丢弃。
  const probePromises = new Map()
  let probeGeneration = 0

  function currentStorage() {
    if (storage !== undefined) return storage
    if (typeof window === 'undefined') return null
    try {
      return window.localStorage || null
    } catch {
      return null
    }
  }

  function nowIso() {
    const value = now()
    const date = value instanceof Date ? value : new Date(value)
    return Number.isFinite(date.getTime()) ? date.toISOString() : new Date().toISOString()
  }

  function persist() {
    if (!state.scope || !state.record) return false
    return writeFirstRunRecord(state.scope, state.record, currentStorage())
  }

  /**
   * 写前重读：返回“内存 + 存储最新值”的合并结果。任务 OR、终态单调，
   * 避免旧标签页用内存快照覆盖另一标签页刚写入的完成状态。
   * @returns {Object|null} 合并后的记录。
   */
  function baseRecord() {
    if (!state.scope) return state.record
    const stored = readFirstRunRecord(state.scope, currentStorage())
    if (!stored) return state.record
    return state.record ? mergeFirstRunRecords(state.record, stored) : stored
  }

  function commit(next) {
    if (!next) return state.record
    state.record = next
    persist()
    return next
  }

  function clearTourUi() {
    state.tourVisible = false
    state.tourIndex = -1
  }

  function clearScopeState() {
    state.scope = ''
    state.record = null
    state.portalReady = false
    state.catalogReady = false
    state.checklistOpen = false
    clearTourUi()
    state.probeStatus = 'idle'
    state.probeMessage = ''
    probeGeneration += 1
    probePromises.clear()
  }

  function markAuditIfOnAuditRoute() {
    if (!state.principal || !state.scope) return false
    const path = state.routePath || ''
    const onAuditRoute = path === '/audit' || path.startsWith('/audit/')
    if (!onAuditRoute) return false
    if (!checkPermission(state.principal, FIRST_RUN_AUDIT_PERMISSION)) return false
    if (!state.record) {
      // §4：只有已经存在记录时才写审计完成，绝不能因为访问 /audit 就新建记录。
      const stored = readFirstRunRecord(state.scope, currentStorage())
      if (!stored) return false
      state.record = stored
    }
    return markTaskCompleted('audit')
  }

  /**
   * 绑定当前主体。主体不明时清空内存态且不读写存储；主体切换时按新作用域重新读取。
   * @param {Object|null} principal 当前主体。
   * @returns {boolean} 是否识别出有效作用域。
   */
  function bindPrincipal(principal) {
    const next = principal && typeof principal === 'object' ? principal : null
    state.principal = next
    const scope = firstRunScopeOf(next)
    if (!scope) {
      // 登出/主体失效等同于离开门户：正在展示的导览先落 skipped，再清内存。
      interruptTour()
      clearScopeState()
      return false
    }
    if (scope !== state.scope) {
      // 切换账号时上一主体的导览也按中断处理，不能把 running 留给下一次登录。
      interruptTour()
      state.scope = scope
      state.record = readFirstRunRecord(scope, currentStorage())
      state.portalReady = false
      state.catalogReady = false
      state.checklistOpen = false
      clearTourUi()
      state.probeStatus = 'idle'
      state.probeMessage = ''
      // 上一主体的在途探测不能再落到新主体上。
      probeGeneration += 1
      probePromises.clear()
    }
    // 刷新授权/重新挂载时补记“当前已经停在审计页”的事实（仅当记录已存在）。
    markAuditIfOnAuditRoute()
    return true
  }

  /**
   * 门户“主体已确定”时调用：确保记录存在（首次创建），允许打开上手清单。
   * 目录是否就绪不再阻塞建记录，只通过 setCatalogReady 控制导览调度。
   * @param {Object} [principal] 当前主体；缺省沿用已绑定主体。
   * @returns {boolean} 记录是否可用。
   */
  function markPortalReady(principal = undefined) {
    if (principal !== undefined) bindPrincipal(principal)
    if (!state.scope) return false
    if (state.portalReady && state.record) return true
    const stored = ensureFirstRunRecord(state.scope, currentStorage())
    state.record = stored
      ? mergeFirstRunRecords(state.record || stored, stored)
      : (state.record || createFirstRunRecord())
    state.portalReady = true
    return true
  }

  /**
   * 目录 settled 状态：只控制导览调度，不影响清单入口。
   * @param {boolean} ready 目录是否就绪。
   * @returns {boolean} 生效后的状态。
   */
  function setCatalogReady(ready) {
    state.catalogReady = Boolean(ready) && Boolean(state.scope)
    return state.catalogReady
  }

  /**
   * 离开门户：若导览仍在运行则落为 skipped（不自动续播），并收起浮层/停止调度。
   * 记录中的清单进度保持不变。
   */
  function markPortalUnready() {
    interruptTour()
    state.portalReady = false
    state.catalogReady = false
    state.checklistOpen = false
    clearTourUi()
  }

  /** 打开上手清单。具备第 ④ 项权限时顺带做一次只读账号数量探测。 */
  function openChecklist() {
    if (!state.record || !state.principal) return false
    state.checklistOpen = true
    if (isFirstRunTaskVisible('firstAccount', state.principal)) void probeFirstAccount()
    return true
  }

  function closeChecklist() {
    state.checklistOpen = false
  }

  /**
   * 记录一个真实事件对应的任务完成。未识别主体、无记录、任务不可见时静默忽略。
   * @param {'userPanel'|'subsystem'|'theme'|'firstAccount'|'audit'} key 任务键。
   * @returns {boolean} 是否产生了新完成状态。
   */
  function markTaskCompleted(key) {
    if (!state.scope || !state.record || !state.principal) return false
    const base = baseRecord()
    if (!base) return false
    const next = withFirstRunTaskCompleted(base, key, state.principal, nowIso())
    if (next === base) {
      // 即使没有新完成，也把重读到的其他标签页进度同步进内存。
      state.record = base
      return false
    }
    commit(next)
    return true
  }

  /**
   * 第 ④ 项探测：GET /api/v1/users?page=1&page_size=1。后端 total 已排除初始化超管，
   * total >= 1 视为租户内已有业务账号。请求开始时捕获 scope + generation，返回时
   * 不匹配则直接丢弃；同一 scope 同一时刻只允许一个请求。
   * @returns {Promise<boolean>} 本次探测是否确认完成。
   */
  function probeFirstAccount() {
    if (!state.record || !state.principal) return Promise.resolve(false)
    if (!isFirstRunTaskVisible('firstAccount', state.principal)) return Promise.resolve(false)
    if (state.record.tasks?.firstAccount === true) {
      state.probeStatus = 'complete'
      return Promise.resolve(true)
    }
    const scope = state.scope
    const generation = probeGeneration
    if (!scope) return Promise.resolve(false)
    const inFlight = probePromises.get(scope)
    if (inFlight) return inFlight
    state.probeStatus = 'checking'
    state.probeMessage = ''
    let promise = null
    promise = (async () => {
      try {
        // Promise.resolve().then 保证首个 await 一定挂起：即使在途请求同步抛错，
        // finally 也能在 promise 写入 probePromises 之后执行。
        const result = await Promise.resolve().then(() => loadUsersFn({ page: 1, pageSize: 1 }))
        if (scope !== state.scope || generation !== probeGeneration) return false
        const total = Number(result?.total)
        if (Number.isFinite(total) && total >= 1) {
          markTaskCompleted('firstAccount')
          state.probeStatus = 'complete'
          return state.record?.tasks?.firstAccount === true
        }
        state.probeStatus = 'incomplete'
        return false
      } catch (error) {
        if (scope !== state.scope || generation !== probeGeneration) return false
        state.probeStatus = 'error'
        state.probeMessage = formatUserError(error, { fallback: '暂时无法检测业务账号，请稍后重试。' })
        return false
      } finally {
        if (probePromises.get(scope) === promise) probePromises.delete(scope)
      }
    })()
    probePromises.set(scope, promise)
    return promise
  }

  /**
   * 启动导览。只有 pending 会自动启动；header 锚点缺失时整次不启动。
   * @param {Object} options 选项。
   * @param {(anchor:string)=>boolean} options.hasAnchor 锚点探测。
   * @returns {boolean} 是否真正展示。
   */
  function beginTour({ hasAnchor } = {}) {
    if (!state.record || !state.portalReady || state.tourVisible) return false
    const base = baseRecord()
    if (!base) return false
    state.record = base
    if (!isFirstRunTourOpen(base)) return false
    if (typeof hasAnchor !== 'function' || !hasAnchor(FIRST_RUN_TOUR_STEPS[0].anchor)) return false
    const index = resolveNextTourStepIndex(0, hasAnchor)
    if (index < 0) return false
    commit(withTourStarted(base, index))
    state.tourIndex = index
    state.tourVisible = true
    return true
  }

  function setTourIndex(index) {
    const base = baseRecord()
    if (!base) return
    const next = withTourStarted(base, index)
    commit(next)
    state.tourIndex = index
  }

  /**
   * 下一步：后续步骤全部缺锚点时以 done 收尾。
   * @param {Object} options 选项。
   * @param {(anchor:string)=>boolean} options.hasAnchor 锚点探测。
   */
  function advanceTour({ hasAnchor } = {}) {
    if (!state.tourVisible || !state.record) return
    const index = resolveNextTourStepIndex(state.tourIndex + 1, hasAnchor || (() => false))
    if (index < 0) {
      finishTour('done')
      return
    }
    setTourIndex(index)
  }

  /** 上一步：向前跳过缺锚点步骤；没有可回退步骤时保持当前步。 */
  function retreatTour({ hasAnchor } = {}) {
    if (!state.tourVisible || !state.record) return
    const index = resolvePreviousTourStepIndex(state.tourIndex - 1, hasAnchor || (() => false))
    if (index < 0) return
    setTourIndex(index)
  }

  /**
   * 导览到达终态（Esc / 跳过 / 完成）。终态不会被二次确认，也不会自动再次出现。
   * @param {'done'|'skipped'} outcome 终态类型。
   */
  function finishTour(outcome) {
    if (!state.record) return
    const base = baseRecord()
    if (!base) return
    const next = withTourFinished(base, outcome, nowIso())
    if (next === base) {
      state.record = base
      clearTourUi()
      return
    }
    commit(next)
    clearTourUi()
  }

  /**
   * 导览被中断（pagehide / 离开 /portal）：running 落为 skipped，不自动续播；
   * 用户仍可通过“重新查看平台导览”显式重开。
   * @returns {boolean} 是否写入终态。
   */
  function interruptTour() {
    if (!state.record || state.record.tour !== 'running') return false
    const base = baseRecord()
    if (!base) return false
    if (base.tour !== 'running') {
      state.record = base
      clearTourUi()
      return false
    }
    commit(withTourFinished(base, 'skipped', nowIso()))
    clearTourUi()
    return true
  }

  /** 用户面板“重新查看平台导览”：显式回到 pending，由 GuideHost 重新调度展示。 */
  function restartTour() {
    if (!state.scope) return false
    const base = baseRecord()
    if (!base) return false
    commit(withTourRestarted(base))
    state.checklistOpen = false
    clearTourUi()
    return true
  }

  /** 用户面板“重置上手清单”：清空任务进度与完成时间，保留导览记录。 */
  function resetChecklist() {
    if (!state.scope) return false
    const base = baseRecord()
    if (!base) return false
    // 重置后，之前发出的探测响应不能再把第 ④ 项写回来。
    probeGeneration += 1
    probePromises.delete(state.scope)
    commit(withChecklistReset(base, nowIso()))
    state.probeStatus = 'idle'
    state.probeMessage = ''
    return true
  }

  /**
   * 当前作用域键对应的 storage 事件：重读并按“任务 OR、终态单调”合并。
   * @param {StorageEvent|{key:string|null}} event storage 事件。
   * @returns {boolean} 是否更新了内存记录。
   */
  function handleStorageEvent(event) {
    if (!state.scope || !state.record) return false
    const key = firstRunStorageKey(state.scope)
    if (!key) return false
    if (event && event.key !== null && event.key !== key) return false
    const stored = readFirstRunRecord(state.scope, currentStorage())
    if (!stored) return false
    const merged = mergeFirstRunRecords(state.record, stored)
    if (JSON.stringify(merged) === JSON.stringify(state.record)) return false
    state.record = merged
    return true
  }

  /**
   * 路由观察：命中 /audit 且已有记录、有审计权限时写第 ⑤ 项完成。
   * @param {Object|null} route vue-router 的当前路由。
   * @returns {boolean} 是否写入。
   */
  function observeRoute(route) {
    const path = String(route?.path || '')
    state.routePath = path
    return markAuditIfOnAuditRoute()
  }

  const checklistSummary = computed(() => firstRunChecklistSummary(state.record, state.principal))
  const checklistItems = computed(() => visibleFirstRunTasks(state.principal).map((task) => ({
    ...task,
    done: state.record?.tasks?.[task.key] === true,
  })))
  const tourStep = computed(() => (
    state.tourIndex >= 0 ? FIRST_RUN_TOUR_STEPS[state.tourIndex] || null : null
  ))
  const tourAnnouncement = computed(() => {
    const step = tourStep.value
    if (!step || !state.tourVisible) return ''
    return `平台导览第 ${state.tourIndex + 1} 步，共 ${FIRST_RUN_TOUR_STEPS.length} 步：${step.title}`
  })

  // 真实浏览器里的全局单例监听跨标签页 storage；测试注入 storage / node 环境默认不监听。
  const shouldListenStorage = listenStorage === undefined
    ? (storage === undefined && typeof window !== 'undefined')
    : Boolean(listenStorage)
  let disposeStorageSync = () => {}
  if (shouldListenStorage) {
    const onStorage = (event) => { handleStorageEvent(event) }
    window.addEventListener('storage', onStorage)
    disposeStorageSync = () => window.removeEventListener('storage', onStorage)
  }

  return {
    state,
    checklistSummary,
    checklistItems,
    tourStep,
    tourAnnouncement,
    bindPrincipal,
    markPortalReady,
    setCatalogReady,
    markPortalUnready,
    openChecklist,
    closeChecklist,
    markTaskCompleted,
    probeFirstAccount,
    beginTour,
    advanceTour,
    retreatTour,
    finishTour,
    interruptTour,
    restartTour,
    resetChecklist,
    observeRoute,
    handleStorageEvent,
    disposeStorageSync,
  }
}

/** App.vue 与门户共用的单例；测试用 createFirstRunStore 创建隔离实例。 */
export const firstRun = createFirstRunStore()

/**
 * App.vue 路由观察器入口：既有记录时补记审计完成，未访问过门户则不创建记录。
 * @param {Object|null} route 当前路由。
 * @returns {boolean} 是否写入。
 */
export function observeFirstRunRoute(route) {
  return firstRun.observeRoute(route)
}

/** 主体变更入口：GuideHost 监听 platform-auth:authorization-refreshed 后调用。 */
export function bindFirstRunPrincipal(principal) {
  return firstRun.bindPrincipal(principal)
}
