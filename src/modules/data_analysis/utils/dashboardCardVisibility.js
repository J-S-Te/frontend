// 看板指标卡的显示/隐藏偏好与报告阶段取数：纯前端展示逻辑，不参与任何口径计算，
// 也不改变既有数据请求。偏好按「租户 + 用户」存在当前浏览器，默认全部可见；
// 身份未就绪时调用方只维护内存态，这里所有读写函数都会返回「未持久化」。
export const DASHBOARD_CARD_HIDDEN_PREFIX = 'da.project.kpi.hidden.'

// 项目分区可切换的卡片 key（稳定标识，不用中文 label 当持久化键）。
export const PROJECT_CARD_KEYS = ['project_total', 'in_flight', 'risk', 'service_items', 'rectifying']

// 用途：按租户 + 用户生成 localStorage 键；身份不完整时返回空串，调用方据此走内存态。
// 参数：tenantID/userID 为会话里的标识，允许空值。
// 返回值：完整键名或空串。
export function cardHiddenStorageKey(tenantID, userID) {
  const tenant = String(tenantID ?? '').trim()
  const user = String(userID ?? '').trim()
  if (!tenant || !user) return ''
  return `${DASHBOARD_CARD_HIDDEN_PREFIX}${tenant}.${user}`
}

// 用途：把任意输入收敛成「当前分区可用的隐藏 key」，顺带过滤未知 key、跨分区 key、空值与重复项。
// 参数：keys 为待收敛的 key 集合；availableKeys 为当前分区卡片 key 列表（不提供时不校验归属）。
// 返回值：顺序跟随 availableKeys 的去重数组。
export function normalizeHiddenCardKeys(keys, availableKeys) {
  const allowed = Array.isArray(availableKeys) ? new Set(availableKeys.map((key) => String(key))) : null
  const picked = new Set()
  for (const key of Array.isArray(keys) ? keys : []) {
    if (typeof key !== 'string') continue
    const trimmed = key.trim()
    if (!trimmed) continue
    if (allowed && !allowed.has(trimmed)) continue
    picked.add(trimmed)
  }
  const order = allowed ? availableKeys.map((key) => String(key)) : [...picked]
  return order.filter((key) => picked.has(key))
}

// 用途：按隐藏集合过滤卡片；隐藏集合为空即全部可见（默认态）。
// 参数：cards 为当前分区指标卡；hiddenKeys 为已隐藏 key。
// 返回值：保持原顺序的可见卡片数组。
export function visibleDashboardCards(cards, hiddenKeys) {
  const rows = Array.isArray(cards) ? cards : []
  const hidden = new Set((Array.isArray(hiddenKeys) ? hiddenKeys : []).map((key) => String(key)))
  return rows.filter((card) => !hidden.has(String(card?.key ?? '')))
}

// 用途：由可见卡片数推算网格列数，保证隐藏后卡片铺满且不出现空列或溢出。
// 参数：count 为可见卡片数量。
// 返回值：>=1 的整数；最多 6 列（与看板既有 6 列栅格一致），超过 6 张时按两行拆分。
export function metricColumnCount(count) {
  const safe = Math.max(0, Math.floor(Number(count) || 0))
  if (safe <= 6) return Math.max(safe, 1)
  return Math.ceil(safe / 2)
}

function usableStorage(storage) {
  return storage && typeof storage.getItem === 'function' ? storage : null
}

// 用途：读取某个「租户 + 用户」的隐藏集合。
// 参数：storage 为 Storage 兼容对象；tenantID/userID 为当前身份；availableKeys 用于丢弃未知与跨分区 key。
// 返回值：收敛后的 key 数组；无身份、无存储、JSON 损坏或结构非法时返回空数组（默认全可见）。
export function readHiddenCardKeys(storage, tenantID, userID, availableKeys) {
  const store = usableStorage(storage)
  const key = cardHiddenStorageKey(tenantID, userID)
  if (!store || !key) return []
  let raw = ''
  try {
    raw = store.getItem(key) || ''
  } catch {
    return []
  }
  if (!raw) return []
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  return normalizeHiddenCardKeys(parsed, availableKeys)
}

// 用途：写回某个「租户 + 用户」的隐藏集合，只保留当前分区可用 key。
// 参数：storage/tenantID/userID 同上；keys 为待写入集合；availableKeys 为当前分区卡片 key。
// 返回值：写入或清除成功为 true；身份缺失、存储不可用或写入异常为 false（此时调用方只保留内存态）。
export function writeHiddenCardKeys(storage, tenantID, userID, keys, availableKeys) {
  const store = usableStorage(storage)
  const key = cardHiddenStorageKey(tenantID, userID)
  if (!store || !key) return false
  const normalized = normalizeHiddenCardKeys(keys, availableKeys)
  try {
    if (!normalized.length) {
      // 恢复默认时清掉存储项，避免留下空数组。
      if (typeof store.removeItem === 'function') store.removeItem(key)
      return true
    }
    store.setItem(key, JSON.stringify(normalized))
    return true
  } catch {
    return false
  }
}

// 用途：把 report_stage_counts 归一化成「大写阶段码 -> 非负整数」。
// 参数：counts 为后端可选字段，旧快照可能是 null 或缺失。
// 返回值：普通对象；字段不可用时返回空对象，由调用方区分「未采集」与「已采集但没有数据」。
export function normalizeStageCounts(counts) {
  if (!counts || typeof counts !== 'object' || Array.isArray(counts)) return {}
  const normalized = {}
  for (const [code, raw] of Object.entries(counts)) {
    const stage = String(code ?? '').trim().toUpperCase()
    if (!stage) continue
    const parsed = Number(raw)
    if (!Number.isFinite(parsed)) continue
    normalized[stage] = Math.max(0, Math.trunc(parsed))
  }
  return normalized
}

// 用途：取某个报告阶段的计数，并显式区分「未采集」与「计数为 0」。
// 参数：counts 为 report_stage_counts 原值；code 为阶段码（大小写与首尾空格不敏感）。
// 返回值：{ available, value }；available=false 时 value=null，调用方显示「—」而不是 0。
export function reportStageCount(counts, code) {
  const collected = Boolean(counts) && typeof counts === 'object' && !Array.isArray(counts)
  if (!collected) return { available: false, value: null }
  const stage = String(code ?? '').trim().toUpperCase()
  if (!stage) return { available: false, value: null }
  const normalized = normalizeStageCounts(counts)
  // 快照已采集但缺少该阶段时按 0 计（该阶段确实没有记录），不当作未知。
  return { available: true, value: Object.prototype.hasOwnProperty.call(normalized, stage) ? normalized[stage] : 0 }
}
