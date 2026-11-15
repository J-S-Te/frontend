import { onScopeDispose, ref, watch } from 'vue'
import { formatUserError } from '../../shared/utils/userError.js'

// 用途：把「已加载业务记录里出现、但尚未解析的人员 ID」合并读取成姓名映射。
// 设计约束（阶段 2）：
//   1) 只读取当前记录引用且未解析的 ID 集合，已解析的不重复请求；
//   2) 同一隔离代次并发合并；读取期间新增的 ID 在同一代次内补读，不留永久占位；
//   3) 换用户/租户/授权代次、显式刷新或组件销毁后，旧请求不得回写 names/error/loading；
//   4) 失败不缓存：错误保留可重试入口，下一次读取仍会重新发起。
// 参数：context 为隔离键，readIDs 返回当前引用的 ID 列表，resolve 为批量解析函数，
//      describe 把异常转成用户文案，fallback 为兜底提示。
// 返回值：names/loading/error 与 load/reload/remember/invalidate。
export function useProjectPersonnelNames({ context, readIDs, resolve, describe, fallback = '人员姓名暂时无法解析，将显示占位符。' }) {
  const names = ref(new Map())
  const loading = ref(false)
  const error = ref('')
  let generation = 0
  let pending = null
  let disposed = false

  const toMessage = (cause) => describe
    ? describe(cause, fallback)
    : formatUserError(cause, { fallback })

  // 用途：收集当前记录引用、且尚未解析的 ID（按首次出现顺序去重）。
  // 参数：refresh 为 true 时返回全部引用 ID，用于刷新后重新确认姓名。
  // 返回值：ID 字符串数组，顺序稳定。
  function referenced(refresh = false) {
    const known = names.value
    const seen = new Set()
    const ids = []
    for (const raw of readIDs() || []) {
      const id = String(raw || '').trim()
      if (!id || seen.has(id) || (!refresh && known.has(id))) continue
      seen.add(id)
      ids.push(id)
    }
    return ids
  }

  // 用途：把服务端或人员目录给出的 user_id → 姓名合并进缓存。
  // 参数：mapping 为 { user_id: 姓名 }。
  // 返回值：无；姓名有变化时才替换 Map，避免无意义重渲染。
  function remember(mapping = {}) {
    const merged = new Map(names.value)
    let changed = false
    for (const [rawID, rawName] of Object.entries(mapping || {})) {
      const id = String(rawID || '').trim()
      const name = String(rawName || '').trim()
      if (id && name && merged.get(id) !== name) { merged.set(id, name); changed = true }
    }
    if (changed) names.value = merged
  }

  // 用途：发起一次批量解析，并把结果发布到当前代次。
  // 参数：ids 为本次要解析的 ID 集合，ticket 为发起时的代次。
  // 返回值：成功为 true；失败或旧代次为 false（失败只写错误，不写姓名）。
  function request(ids, ticket) {
    return Promise.resolve().then(() => resolve(ids)).then((mapping) => {
      if (disposed || ticket !== generation) return false
      remember(mapping)
      error.value = ''
      return true
    }).catch((cause) => {
      if (disposed || ticket !== generation) return false
      error.value = toMessage(cause)
      return false
    })
  }

  // 用途：读取尚未解析的姓名；并发合并，本轮每个ID最多请求一次。
  // 参数：refresh 为 true 时重新确认全部引用 ID（刷新后的失效语义）。
  // 返回值：成功或无需读取为 true；失败、旧代次或已销毁为 false。
  async function load({ refresh = false } = {}) {
    if (disposed) return false
    if (pending) return pending
    const ids = referenced(refresh)
    // 没有任何待解析 ID 时，上一次失败已不再影响界面（姓名由其他目录补齐），清掉过期错误。
    if (!ids.length) { error.value = ''; return true }
    const ticket = generation
    loading.value = true
    error.value = ''
    pending = (async () => {
      try {
        const attempted = new Set(ids)
        let settled = await request(ids, ticket)
        // 读取期间新到达的记录（事件流、监控快照）可能带来更多 ID：同一代次内继续合并读取。
        // 成功响应遗漏的ID不是新增项，留给下一次显式读取，避免无限请求目录。
        // 失败时不再自动补读，避免在服务不可用时连环重试；重试入口会重新发起。
        while (settled && !disposed && ticket === generation) {
          const next = referenced().filter((id) => !attempted.has(id))
          if (!next.length) break
          for (const id of next) attempted.add(id)
          settled = await request(next, ticket)
        }
        return settled
      } finally {
        if (!disposed && ticket === generation) { loading.value = false; pending = null }
      }
    })()
    return pending
  }

  // 用途：使缓存与在途读取失效（隔离键变化、显式刷新）。
  // 参数：无。
  // 返回值：无；旧请求完成后不能再写 names/error/loading。
  function invalidate() {
    generation += 1
    pending = null
    loading.value = false
    error.value = ''
    names.value = new Map()
  }

  // 用途：刷新后的重新确认入口：不先清空姓名（避免整页短暂回退成占位符），
  // 但强制对全部引用 ID 重新读取一次，失败按错误提示且不缓存。
  // 同一代次已有在途读取时复用该请求（它已在本轮记录加载之后发起），避免刷新触发两次查询。
  // 参数：无。
  // 返回值：同 load。
  async function reload() {
    if (pending) return pending
    return load({ refresh: true })
  }

  // 用途：重试入口（失败后用户点击）。
  // 参数：无。
  // 返回值：同 load。
  function retry() { return load() }

  // 用途：组件销毁后让在途请求失效，不再写任何响应式状态。
  // 参数：无。
  // 返回值：无。
  function dispose() {
    disposed = true
    generation += 1
    pending = null
    loading.value = false
  }

  // 身份变化：旧姓名字符串不能冒充新上下文的事实，清空后按需重新读取。
  watch(context, () => { invalidate() }, { flush: 'sync' })
  onScopeDispose(dispose)
  return { names, loading, error, load, reload, retry, remember, invalidate, dispose }
}
