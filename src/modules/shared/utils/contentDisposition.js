/**
 * Content-Disposition 文件名解析工具。
 *
 * 约定：
 * - 纯函数，不依赖 DOM、网络或浏览器下载行为，调用方自行决定如何保存 Blob。
 * - `filename*`（RFC 5987：charset'lang'percent-encoded）优先于 `filename`，
 *   与两者在响应头中的出现顺序无关；当前仅接受 UTF-8 扩展值。
 * - `filename*` 非法百分号编码时视为该候选无效，继续回退 `filename`，最后回退调用方给定名称。
 * - 返回前统一移除路径分隔符、控制字符、零宽字符和双向控制符，并限制长度。
 */

const DEFAULT_MAX_FILENAME_LENGTH = 180
const MAX_HEADER_LENGTH = 4096

// C0/C1 控制字符、零宽字符、BOM、双向控制符及常见不可见格式字符。
const UNSAFE_FILENAME_CHARACTERS = /[\u0000-\u001f\u007f-\u009f\u061c\u180e\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g

// 参数名必须位于头部起始或分号之后，避免把其它参数值里的 filename= 误认为文件名。
const FILENAME_STAR_PATTERN = /(?:^|;)\s*filename\*\s*=\s*(?:"((?:\\.|[^"\\])*)"|([^;]*))/i
const FILENAME_PATTERN = /(?:^|;)\s*filename\s*=\s*(?:"((?:\\.|[^"\\])*)"|([^;]*))/i

/**
 * 解析响应头中的文件名，优先使用 RFC 5987 的 filename*。
 * @param {string|null|undefined} header Content-Disposition 响应头。
 * @param {string} [fallback=''] 响应头没有可用文件名时使用的回退名称。
 * @returns {string} 清理并截断后的文件名；没有可用名称时返回清理后的 fallback。
 */
export function parseContentDispositionFilename(header, fallback = '') {
  const candidate = extractDispositionFilename(header) || sanitizeFilename(fallback)
  return truncateFilename(candidate, DEFAULT_MAX_FILENAME_LENGTH)
}

/**
 * 解析响应头文件名，并按调用方扩展名白名单选择安全名称。
 * 未通过白名单、扩展名缺失或文件名以点开头时回退 fallback。
 * @param {string|null|undefined} header Content-Disposition 响应头。
 * @param {string} [fallback=''] 回退名称，由调用方提供且应自带允许的扩展名。
 * @param {{extensions?: string[]|string, maxLength?: number}} [options={}] 允许的扩展名（如 ['.csv']）与最大长度。
 * @returns {string} 可直接用于下载的安全文件名。
 */
export function safeDownloadFilename(header, fallback = '', { extensions = [], maxLength = DEFAULT_MAX_FILENAME_LENGTH } = {}) {
  const limit = normalizeMaxLength(maxLength)
  const allowedExtensions = normalizeExtensions(extensions)
  const fallbackName = truncateFilename(sanitizeFilename(fallback), limit)
  const extracted = extractDispositionFilename(header)
  const useExtracted = isUsableFilename(extracted) && matchesExtensions(extracted, allowedExtensions)
  const filename = useExtracted ? extracted : fallbackName
  const preservedExtension = useExtracted ? matchingExtension(filename, allowedExtensions) : ''
  return truncateFilename(filename, limit, preservedExtension)
}

function extractDispositionFilename(header) {
  const source = String(header ?? '').slice(0, MAX_HEADER_LENGTH)
  const extended = source.match(FILENAME_STAR_PATTERN)
  if (extended) {
    const decoded = decodeExtendedFilename(extended[1] ?? extended[2])
    if (decoded !== null) {
      const safeName = sanitizeFilename(decoded)
      if (safeName) return safeName
    }
  }
  const plain = source.match(FILENAME_PATTERN)
  if (plain) {
    const safeName = sanitizeFilename(unescapeQuoted(plain[1] ?? plain[2]))
    if (safeName) return safeName
  }
  return ''
}

function decodeExtendedFilename(rawValue) {
  let value = String(rawValue ?? '').trim()
  if (!value) return null
  const prefix = /^([^']*)'([^']*)'([\s\S]*)$/.exec(value)
  if (prefix) {
    const charset = prefix[1].trim().toLowerCase()
    if (charset && charset !== 'utf-8' && charset !== 'utf8') return null
    value = prefix[3]
  }
  try {
    return decodeURIComponent(value)
  } catch {
    // 非法百分号编码说明该 filename* 候选不可信，交由 filename= 或 fallback 处理。
    return null
  }
}

function unescapeQuoted(value) {
  return String(value ?? '').replace(/\\(.)/g, '$1')
}

function sanitizeFilename(value) {
  return String(value ?? '')
    .replace(UNSAFE_FILENAME_CHARACTERS, '')
    .replace(/[\\/]/g, '')
    .trim()
}

function isUsableFilename(value) {
  return Boolean(value) && value !== '.' && value !== '..' && !value.startsWith('.')
}

function normalizeExtensions(extensions) {
  const values = Array.isArray(extensions) ? extensions : [extensions]
  return values
    .map((extension) => String(extension ?? '').trim().toLowerCase())
    .filter(Boolean)
    .map((extension) => (extension.startsWith('.') ? extension : `.${extension}`))
}

function matchesExtensions(filename, allowedExtensions) {
  return allowedExtensions.length === 0 || Boolean(matchingExtension(filename, allowedExtensions))
}

function matchingExtension(filename, allowedExtensions) {
  const normalized = String(filename ?? '').toLowerCase()
  return allowedExtensions.find((extension) => normalized.endsWith(extension)) || ''
}

function normalizeMaxLength(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : DEFAULT_MAX_FILENAME_LENGTH
}

function truncateFilename(value, maxLength, extension = '') {
  const text = String(value ?? '')
  const characters = Array.from(text)
  if (characters.length <= maxLength) return text
  const suffix = String(extension || '')
  const suffixLength = Array.from(suffix).length
  // 长名称截断时尽量保住扩展名，否则扩展名白名单会在截断后误判为非法。
  if (suffix && suffixLength < maxLength && text.toLowerCase().endsWith(suffix.toLowerCase())) {
    const head = characters.slice(0, maxLength - suffixLength).join('').trimEnd()
    return `${head}${text.slice(text.length - suffix.length)}`
  }
  return characters.slice(0, maxLength).join('').trimEnd()
}
