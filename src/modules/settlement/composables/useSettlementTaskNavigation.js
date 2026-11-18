import { onScopeDispose, ref, watch } from 'vue'
import { formatSettlementError } from '../utils/errors.js'

const PAGE_SIZE = 50
const MAX_SEARCH_PAGES = 20

// 用途：按真实业务坐标定位结算待办，仅打开已有办理入口。
// 参数：route/router 为当前导航，active/loading/saving 为页面状态，sources 为授权读取与表单入口。
// 返回值：目标记录、定位提示、单条待办导航和清除定位的方法。
export function useSettlementTaskNavigation({ route, router, active, loading, saving, sources }) {
  const target = ref(null), targetMessage = ref('')
  let sequence = 0, lastTargetKey = '', lastOpenedKey = '', lastMessage = ''

  // 用途：解析当前分区的唯一业务坐标，避免发票与开票申请混用。
  // 参数：无；读取路由查询及对应业务源。
  // 返回值：明确坐标或 null；非法或冲突参数标记 invalid。
  function routeTarget() {
    for (const [kind, source] of Object.entries(sources)) {
      if (active.value !== source.section) continue
      const keys = source.keys.filter(key => route.query[key] !== undefined)
      if (!keys.length) return null
      const raw = route.query[keys[0]]
      const id = Array.isArray(raw) ? (raw.length === 1 ? raw[0] : '') : raw
      const invalid = keys.length !== 1 || typeof id !== 'string'
        || !/^[A-Za-z0-9_-]{1,128}$/.test(id)
        || (kind === 'invoices' && route.query.invoice_id !== undefined)
      return { kind, key: keys[0], id, invalid }
    }
    return null
  }

  // 用途：在授权当前页和有界分页中查找目标，不把第一页未命中当不存在。
  // 参数：source 为业务读取源，selection 为目标坐标，isCurrent 用于隔离导航迟到响应。
  // 返回值：目标记录及是否达到定位上限；读取失败抛出错误。
  async function findTarget(source, selection, isCurrent) {
    const matches = item => source.matches
      ? source.matches(item, selection) : String(item.id) === selection.id
    const cached = source.rows.value.find(matches)
    if (cached) return { item: cached }
    for (let page = 0; page < MAX_SEARCH_PAGES; page++) {
      const rows = await source.read({ limit: PAGE_SIZE, offset: page * PAGE_SIZE })
      if (!isCurrent()) return {}
      if (!Array.isArray(rows)) throw new Error('业务列表响应不完整，请重试。')
      const item = rows.find(matches)
      if (item) {
        source.rows.value = rows
        source.selectPage?.(page)
        return { item }
      }
      if (rows.length < PAGE_SIZE) return { item: null }
    }
    return { item: null, bounded: true }
  }

  // 用途：读取当前通知或待办目标，打开其服务端状态允许的现有表单。
  // 参数：无；导航、权限和加载状态均取自当前页面。
  // 返回值：异步完成；失败、已处理或达到上限时显示独立定位提示。
  async function resolveTarget() {
    const ticket = ++sequence, selection = routeTarget()
    target.value = null; targetMessage.value = ''
    if (saving.value) return
    const key = selection ? `${selection.kind}:${selection.key}:${selection.id}` : ''
    if (key !== lastTargetKey) {
      Object.values(sources).forEach(source => source.close?.())
      lastTargetKey = key
      lastOpenedKey = ''; lastMessage = ''
    }
    if (!selection || loading.value) return
    if (selection.invalid) { targetMessage.value = '待办入口无效，请从通知或待办列表重新打开。'; return }
    const source = sources[selection.kind]
    if (!source.canRead()) { targetMessage.value = '当前账号没有该待办的读取权限。'; return }
    const isCurrent = () => ticket === sequence
    try {
      const result = await findTarget(source, selection, isCurrent)
      if (!isCurrent()) return
      if (!result.item) {
        source.close?.()
        targetMessage.value = result.bounded
          ? '已核对前 1000 条授权记录，尚未定位到该待办，请在业务列表继续查找。'
          : '当前授权范围未找到该待办，可能已处理或当前账号不可见。'
        return
      }
      target.value = { kind: selection.kind, item: result.item }
      const openedKey = `${key}:${result.item.id}:${result.item.version}:${result.item.status}`
      if (openedKey !== lastOpenedKey) {
        source.close?.()
        lastOpenedKey = openedKey
        lastMessage = source.open(result.item)
      }
      targetMessage.value = lastMessage
    } catch (error) {
      if (isCurrent()) targetMessage.value = formatSettlementError(error,
        { fallback: '待办定位读取失败，请刷新重试。' })
    }
  }

  // 用途：把当前点击的单条待办身份写入对应办理路由。
  // 参数：task 为包含真实 id 与 kind 的授权待办行。
  // 返回值：导航完成的 Promise；非法或无读取权限时只提示。
  async function openTask(task) {
    const source = sources[task?.kind]
    const id = String(task?.id || '')
    if (!source || !/^[A-Za-z0-9_-]{1,128}$/.test(id)) {
      targetMessage.value = '待办编号无效，请刷新待办列表。'; return
    }
    if (!source.canRead()) { targetMessage.value = '当前账号没有该待办的读取权限。'; return }
    await router.push({ name: 'settlement', params: { section: source.section },
      query: { [source.keys[0]]: id } })
  }

  // 用途：退出通知定位并恢复当前业务分区的完整列表。
  // 参数：无。
  // 返回值：路由替换完成的 Promise。
  function clearTarget() {
    const query = { ...route.query }
    Object.values(sources).forEach(source => source.keys.forEach(key => { delete query[key] }))
    return router.replace({ name: 'settlement', params: { section: active.value }, query })
  }

  watch(() => [active.value, loading.value, saving.value,
    ...Object.values(sources).flatMap(source => source.keys.map(key => route.query[key])),
    route.query.invoice_id], resolveTarget, { immediate: true })
  onScopeDispose(() => { sequence++ })
  return { target, targetMessage, openTask, clearTarget }
}
