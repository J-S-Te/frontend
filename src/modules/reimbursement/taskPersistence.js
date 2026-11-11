// taskPersistence.js — 异步任务坐标的本地记忆。
//
// 为什么需要：解析、导出、归档包三类异步任务过去只把任务 ID 放在页面内存里，
// 刷新一次就找不到任务号，用户只能重新上传或重跑，既浪费也可能造出重复任务。
// 这里只保存"找回任务"所需的最小坐标（任务号、原件号、导出范围），
// 不保存业务内容、金额、收款资料或任何凭据；记录按保留期自动失效。
//
// 存储不可用（隐私模式、被禁用、服务端渲染）时全部静默降级为"不记忆"，
// 调用方仍能按原有内存流程工作，不因为记忆失败阻塞业务。

const PREFIX = 'reimbursement.task.'
// 保留期：一周内还能找回；更早的任务号多半已被服务端清理，留着只会误导。
const DEFAULT_MAX_AGE = 7 * 24 * 60 * 60 * 1000
const MAX_TEXT = 200
const MAX_LIST = 100

// 允许记忆的任务种类；未知种类直接拒绝，避免把任意对象写进本地存储。
export const TASK_KINDS = Object.freeze({
  parse: 'parse',
  export: 'export',
  archive: 'archive',
  document: 'document',
})

// 用途：取当前环境的本地存储，浏览器禁用或服务端渲染时返回 null。
// 参数：无。
// 返回值：localStorage 兼容对象或 null。
function defaultStore() {
  try {
    const store = globalThis.localStorage
    if (!store || typeof store.getItem !== 'function' || typeof store.setItem !== 'function') return null
    return store
  } catch { return null }
}

function keyOf(kind) { return PREFIX + kind }

// 用途：把业务对象裁剪为可安全记忆的扁平坐标。
// 参数：value 为待记忆对象。
// 返回值：只含短文本、数字、布尔与短文本数组的对象；无有效字段时为 null。
function cleanValue(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const result = {}
  for (const [key, raw] of Object.entries(value)) {
    if (key === 'saved_at') continue
    if (typeof raw === 'string') {
      if (raw.trim() && raw.length <= MAX_TEXT) result[key] = raw
    } else if (typeof raw === 'number' && Number.isFinite(raw)) {
      result[key] = raw
    } else if (typeof raw === 'boolean') {
      result[key] = raw
    } else if (Array.isArray(raw)) {
      const list = raw.filter((row) => typeof row === 'string' && row && row.length <= MAX_TEXT).slice(0, MAX_LIST)
      if (list.length) result[key] = list
    }
  }
  return Object.keys(result).length ? result : null
}

// 用途：记住最近一次异步任务，供刷新或重进页面后找回。
// 参数：kind 为任务种类，value 为任务坐标，store/now 便于测试替换。
// 返回值：写入成功为 true；无可写字段或存储不可用时为 false。
export function rememberTask(kind, value, { store = defaultStore(), now = Date.now() } = {}) {
  if (!Object.hasOwn(TASK_KINDS, kind) || !store) return false
  const clean = cleanValue(value)
  if (!clean) return false
  try {
    store.setItem(keyOf(kind), JSON.stringify({ ...clean, saved_at: now }))
    return true
  } catch { return false }
}

// 用途：读取记忆的任务坐标；过期、损坏或越权的记录一律丢弃并清理。
// 参数：kind 为任务种类，store/now/maxAge 便于测试替换。
// 返回值：任务坐标对象；没有可用的记忆时为 null。
export function recallTask(kind, { store = defaultStore(), now = Date.now(), maxAge = DEFAULT_MAX_AGE } = {}) {
  if (!Object.hasOwn(TASK_KINDS, kind) || !store) return null
  let raw
  try { raw = store.getItem(keyOf(kind)) } catch { return null }
  if (!raw) return null
  let parsed
  try { parsed = JSON.parse(raw) } catch { forgetTask(kind, { store }); return null }
  const clean = cleanValue(parsed)
  const savedAt = Number(parsed?.saved_at)
  // 时间戳来自本机写入；异常值（缺失、未来时间、超期）说明记录不可信，直接丢弃。
  if (!clean || !Number.isFinite(savedAt) || now - savedAt > maxAge || savedAt > now + 60 * 1000) {
    forgetTask(kind, { store })
    return null
  }
  return { ...clean, saved_at: savedAt }
}

// 用途：清除某类任务的记忆，例如任务已被服务端判定不存在。
// 参数：kind 为任务种类，store 便于测试替换。
// 返回值：无；存储不可用时静默忽略。
export function forgetTask(kind, { store = defaultStore() } = {}) {
  if (!Object.hasOwn(TASK_KINDS, kind) || !store) return
  try { store.removeItem(keyOf(kind)) } catch { /* 存储不可写时无需记忆，也不阻断业务 */ }
}

// 用途：把记忆的保存时间渲染成业务可读的相对说法。
// 参数：savedAt 为毫秒时间戳，now 为当前时间。
// 返回值：中文时间说明；非法时间返回空串。
export function savedAtLabel(savedAt, now = Date.now()) {
  const value = Number(savedAt)
  if (!Number.isFinite(value) || value <= 0) return ''
  const minutes = Math.floor(Math.max(0, now - value) / 60000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  return `${Math.floor(hours / 24)} 天前`
}
