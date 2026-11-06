// 兜底通道的用户文案。
//
// 原则：技术异常（TypeError / chunk 文件名 / 请求地址 / 字段名）永远不进界面。
// 只有业务代码自己抛出的、已经中文可读的消息才允许透传，并且照样过一遍
// userError.safeUserMessage 的清洗规则（长度、内部细节、技术指引词）。
import { safeUserMessage } from '../utils/userError.js'

// 通用兜底：用户至少要知道"发生了什么、下一步做什么"。
export const UNCAUGHT_FALLBACK = '页面遇到错误，本次操作未完成。请重试，或刷新页面后再试。'
// chunk 失败重试没用，必须刷新才会重新拉取新版本资源。
export const CHUNK_LOAD_MESSAGE = '页面资源加载失败，可能是系统刚更新过。请刷新页面后重试。'
// 路由跳转失败但页面本身还在，先让用户重试导航。
export const NAVIGATION_FAILED_MESSAGE = '页面跳转未完成，请重试；仍然失败时刷新页面再进入。'

// 打包器与浏览器对"动态 chunk 拉取失败"的措辞并不统一：
//   Vite/浏览器：Failed to fetch dynamically imported module
//   webpack：Loading chunk <id> failed / ChunkLoadError
//   ES module 加载：Importing a module script failed
const CHUNK_LOAD_PATTERNS = [
  /Failed to fetch dynamically imported module/i,
  /error loading dynamically imported module/i,
  /Importing a module script failed/i,
  /Loading (?:CSS )?chunk [\w-]+ failed/i,
  /Loading chunk \d+ failed/i,
]

/** 是否是按需加载的资源（chunk）拉取失败：这类错误重试没用，要刷新。 */
export function isChunkLoadError(error) {
  if (!error) return false
  if (typeof error === 'object' && error.name === 'ChunkLoadError') return true
  const message = typeof error === 'string' ? error : String(error?.message ?? '')
  return CHUNK_LOAD_PATTERNS.some((pattern) => pattern.test(message))
}

// 来源只作为一行补充说明，帮助用户/客服判断该找谁；不暴露钩子名或堆栈。
const SOURCE_DETAIL = {
  vue: '未捕获的界面错误',
  'window-error': '未捕获的脚本错误',
  unhandledrejection: '未处理的异步操作错误',
  router: '页面跳转失败',
  boundary: '页面组件渲染失败',
}

/** 取出可展示的错误摘要：中文可读消息透传，其余一律换成通用兜底文案。 */
export function userFacingErrorSummary(error, fallback = UNCAUGHT_FALLBACK) {
  if (!error) return fallback
  const text = typeof error === 'string' ? error : error?.message ?? ''
  const safe = typeof text === 'string' ? safeUserMessage(text) : ''
  return safe || fallback
}

/**
 * 把一个未捕获错误翻译成一条提示。
 * @param {unknown} error 原始错误或字符串
 * @param {'vue'|'window-error'|'unhandledrejection'|'router'|'boundary'} source 来源
 * @returns {{message: string, detail: string, tone: string, key: string, source: string}}
 */
export function describeUnhandledError(error, source = 'vue') {
  if (source === 'router') {
    if (isChunkLoadError(error)) {
      return {
        message: CHUNK_LOAD_MESSAGE,
        detail: '页面代码没有下载完整，通常在系统更新后出现',
        tone: 'error',
        // 键取文案：不同入口的 chunk 同时失败也只提示一次。
        key: CHUNK_LOAD_MESSAGE,
        source,
      }
    }
    return {
      message: NAVIGATION_FAILED_MESSAGE,
      detail: SOURCE_DETAIL.router,
      tone: 'error',
      key: NAVIGATION_FAILED_MESSAGE,
      source,
    }
  }
  const message = userFacingErrorSummary(error)
  return {
    message,
    detail: SOURCE_DETAIL[source] || '未知错误',
    tone: 'error',
    key: message,
    source,
  }
}
