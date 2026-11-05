import { computed, ref, unref, watch } from 'vue'

/**
 * 项目指标卡的显示/隐藏偏好（纯前端，不走后端存储）。
 *
 * 存储键按「租户 + 用户」隔离：pm.project.kpi.hidden.<tenantID>.<userID>。
 * session 尚未就绪（缺 tenant_id / user_id）时只维护内存态、不读写 localStorage，
 * 避免把某个账号的隐藏集合写到别的账号下；身份就绪后按该身份重新读取存储。
 * 隐藏集合只允许包含当前角色布局里的 key，角色切换后不会残留上一条布局的隐藏项。
 */
export const PROJECT_KPI_HIDDEN_STORAGE_PREFIX = 'pm.project.kpi.hidden.'

// 用途：按租户 + 用户生成 localStorage 键；身份不完整时返回空串，调用方据此走内存态。
// 参数：tenantID/userID 为 session 中的标识，允许空值。
// 返回值：完整键名或空串。
export function kpiHiddenStorageKey(tenantID, userID) {
  const tenant = String(tenantID ?? '').trim()
  const user = String(userID ?? '').trim()
  if (!tenant || !user) return ''
  return `${PROJECT_KPI_HIDDEN_STORAGE_PREFIX}${tenant}.${user}`
}

// 用途：报告阶段归一化，兼容大小写与首尾空格差异；旧后端缺失字段时得到空串。
// 参数：value 为 report_stage 原值。
// 返回值：trim + 大写后的阶段码。
export function normalizedReportStage(value) {
  return String(value ?? '').trim().toUpperCase()
}

// 用途：统计已加载项目中报告阶段为 RECTIFYING 的数量，供「整改中项目」指标卡取数。
// 参数：projects 为工作区已加载项目列表，允许缺 report_stage（旧后端）。
// 返回值：非负整数；无数据或字段缺失时为 0，不伪造数据。
export function rectifyingProjectCount(projects) {
  const rows = Array.isArray(projects) ? projects : []
  return rows.filter((project) => normalizedReportStage(project?.report_stage) === 'RECTIFYING').length
}

// 用途：把任意输入收敛成「当前布局可用的隐藏 key」列表，顺带过滤未知 key、空值与重复项。
// 参数：keys 为待收敛的 key 集合；availableKeys 为当前角色布局的 key 列表（未提供时不校验归属）。
// 返回值：顺序跟随 availableKeys 的去重数组。
export function normalizeHiddenKpiKeys(keys, availableKeys) {
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
// 参数：cards 为当前角色可用卡片；hiddenKeys 为已隐藏 key。
// 返回值：保持原顺序的可见卡片数组。
export function visibleProjectKpiCards(cards, hiddenKeys) {
  const rows = Array.isArray(cards) ? cards : []
  const hidden = new Set((Array.isArray(hiddenKeys) ? hiddenKeys : []).map((key) => String(key)))
  return rows.filter((card) => !hidden.has(String(card?.key ?? '')))
}

// 用途：由可见卡片数推算网格列数。5 张以内单排；超过 5 张拆两行，由 flex 让末行铺满。
// 参数：count 为可见卡片数量。
// 返回值：>=1 的整数；全部隐藏时仍返回 1，保证列数类名始终有效。
export function kpiColumnCount(count) {
  const safe = Math.max(0, Math.floor(Number(count) || 0))
  if (safe <= 5) return Math.max(safe, 1)
  return Math.ceil(safe / 2)
}

// 用途：宽容地取得浏览器 localStorage；隐私模式或非浏览器环境返回 null。
// 参数：无。
// 返回值：Storage 或 null。
function browserStorage() {
  try {
    return globalThis.localStorage || null
  } catch {
    return null
  }
}

function usableStorage(storage) {
  return storage && typeof storage.getItem === 'function' ? storage : null
}

// 用途：读取某个「租户 + 用户」的隐藏集合。
// 参数：storage 为 Storage 兼容对象；tenantID/userID 为当前身份；availableKeys 用于丢弃未知 key。
// 返回值：收敛后的 key 数组；无身份、无存储、JSON 损坏或非法结构时返回空数组（默认全可见）。
export function readHiddenKpiKeys(storage, tenantID, userID, availableKeys) {
  const store = usableStorage(storage)
  const key = kpiHiddenStorageKey(tenantID, userID)
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
  return normalizeHiddenKpiKeys(parsed, availableKeys)
}

// 用途：写回某个「租户 + 用户」的隐藏集合，只保留当前布局可用 key。
// 参数：storage/tenantID/userID 同上；keys 为待写入集合；availableKeys 为当前角色布局 key。
// 返回值：写入或清除成功为 true；身份缺失、存储不可用或写入异常为 false（此时只保留内存态）。
export function writeHiddenKpiKeys(storage, tenantID, userID, keys, availableKeys) {
  const store = usableStorage(storage)
  const key = kpiHiddenStorageKey(tenantID, userID)
  if (!store || !key) return false
  const normalized = normalizeHiddenKpiKeys(keys, availableKeys)
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

/**
 * 视图接线用的最小状态：隐藏集合、可见卡片、列数与设置面板开关。
 * 卡片清单由调用方以 computed 传入，角色变化时自动按当前布局重建隐藏集合。
 */
export function useProjectKpiVisibility({ cards, tenantID, userID, storage = browserStorage() } = {}) {
  const hiddenKeys = ref([])
  const settingsOpen = ref(false)
  const availableKeys = computed(() => (unref(cards) || [])
    .map((card) => String(card?.key ?? ''))
    .filter(Boolean))
  const identity = computed(() => kpiHiddenStorageKey(unref(tenantID), unref(userID)))

  // 身份或角色布局变化时重建隐藏集合：旧身份/旧布局的 key 不会被带过来。
  watch([identity, availableKeys], () => {
    if (!identity.value) {
      // 身份未知：只有内存态，这里只裁剪不属于当前布局的 key，
      // 避免工作区刷新导致卡片重算时把用户本次的选择清空。
      hiddenKeys.value = normalizeHiddenKpiKeys(hiddenKeys.value, availableKeys.value)
      return
    }
    hiddenKeys.value = readHiddenKpiKeys(storage, unref(tenantID), unref(userID), availableKeys.value)
  }, { immediate: true })

  const visibleCards = computed(() => visibleProjectKpiCards(unref(cards), hiddenKeys.value))
  const columnCount = computed(() => kpiColumnCount(visibleCards.value.length))
  const allHidden = computed(() => (unref(cards) || []).length > 0 && visibleCards.value.length === 0)

  function applyHiddenKeys(keys) {
    const normalized = normalizeHiddenKpiKeys(keys, availableKeys.value)
    hiddenKeys.value = normalized
    // 身份未就绪时 writeHiddenKpiKeys 直接返回 false：只保留内存态，不触碰 localStorage。
    writeHiddenKpiKeys(storage, unref(tenantID), unref(userID), normalized, availableKeys.value)
  }

  // 开关使用原生 button，Enter/Space 由浏览器派发 click，无需额外 keydown 处理（避免二次切换）。
  function toggleCard(key) {
    const value = String(key ?? '').trim()
    if (!value || !availableKeys.value.includes(value)) return
    applyHiddenKeys(hiddenKeys.value.includes(value)
      ? hiddenKeys.value.filter((item) => item !== value)
      : [...hiddenKeys.value, value])
  }

  function resetCards() { applyHiddenKeys([]) }
  function isCardVisible(key) { return !hiddenKeys.value.includes(String(key ?? '').trim()) }
  function toggleSettings() { settingsOpen.value = !settingsOpen.value }
  function closeSettings() { settingsOpen.value = false }

  return {
    hiddenKeys,
    availableKeys,
    visibleCards,
    columnCount,
    allHidden,
    settingsOpen,
    isCardVisible,
    toggleCard,
    resetCards,
    toggleSettings,
    closeSettings,
  }
}
