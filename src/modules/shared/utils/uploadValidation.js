/**
 * 上传前本地文件校验（大小 / 类型）。
 *
 * 约定：
 * - 纯函数：不发起网络、不读写 DOM、不修改入参，只把结论与中文文案交回调用方。
 * - 类型归一化：优先使用 `file.type`；为空或 `application/octet-stream` 等无法表态的
 *   通用值时按文件名扩展名推断（上传入口的 accept 同样按扩展名声明）。同一类型
 *   的常见别名（如 `image/jpg`、`text/xml`）先归一到标准 MIME 再比较。
 * - 这里只拦截“明显不合规”的文件，用于避免无谓的上传会话与流量；服务端仍是大
 *   小、类型和文件内容的最终裁定方，本地通过不代表服务端一定通过。
 */

const BYTES_PER_KIB = 1024
const BYTES_PER_MIB = 1024 * 1024

// 扩展名 → 标准 MIME。只收录本工程上传入口声明支持的类型，未知扩展名不猜测。
export const EXTENSION_MIME_TYPES = Object.freeze({
  pdf: 'application/pdf',
  ofd: 'application/ofd',
  xml: 'application/xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
})

// 同一类型的常见别名，统一归一到上面的标准 MIME 后再比较。
const MIME_ALIASES = Object.freeze({
  'application/x-ofd': 'application/ofd',
  'image/jpg': 'image/jpeg',
  'image/pjpeg': 'image/jpeg',
  'text/xml': 'application/xml',
})

// 无法表态具体类型的通用值：视为“未提供”，改按扩展名推断。
const GENERIC_MIME_TYPES = new Set(['', 'application/octet-stream', 'binary/octet-stream', 'application/unknown'])

// MIME → 错误文案中的类型标签。
const MIME_LABELS = Object.freeze({
  'application/pdf': 'PDF',
  'application/ofd': 'OFD',
  'application/xml': 'XML',
  'image/png': 'PNG',
  'image/jpeg': 'JPG',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'DOCX',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'XLSX',
})

// 用途：归一化单个 MIME 值（去参数、小写、别名收敛）。
// 参数：value 为 `file.type` 或服务端声明的 MIME。
// 返回值：标准 MIME 字符串；空值或通用值返回空串，表示“无法表态”。
export function normalizeMimeType(value) {
  const raw = String(value ?? '').split(';', 1)[0].trim().toLowerCase()
  if (GENERIC_MIME_TYPES.has(raw)) return ''
  return MIME_ALIASES[raw] || raw
}

// 用途：从文件名取小写扩展名（不含点）。
// 参数：name 为文件名。
// 返回值：扩展名；无扩展名（含以点开头的隐藏文件）返回空串。
export function fileExtension(name) {
  const base = String(name ?? '').trim().toLowerCase()
  const dot = base.lastIndexOf('.')
  if (dot <= 0 || dot === base.length - 1) return ''
  return base.slice(dot + 1)
}

// 用途：按扩展名推断 MIME。
// 参数：extension 为扩展名，可带前导点。
// 返回值：标准 MIME；未知扩展名返回空串。
export function mimeTypeForExtension(extension) {
  const key = String(extension ?? '').trim().toLowerCase().replace(/^\./, '')
  if (!key) return ''
  return EXTENSION_MIME_TYPES[key] || ''
}

// 用途：把服务端给出的 MIME 白名单反查为可识别的扩展名。
// 参数：mimeTypes 为 MIME 数组（服务端能力字段可能含重复项）。
// 返回值：扩展名数组（去重、保序）；未知 MIME 不产生扩展名。
export function extensionsForMimeTypes(mimeTypes) {
  const allowed = new Set(normalizeMimeList(mimeTypes))
  const extensions = []
  for (const [extension, mime] of Object.entries(EXTENSION_MIME_TYPES)) {
    if (allowed.has(normalizeMimeType(mime))) extensions.push(extension)
  }
  return extensions
}

// 用途：生成错误文案中的“允许类型”标签列表。
// 参数：allowedExtensions 为扩展名白名单，allowedMimeTypes 为 MIME 白名单。
// 返回值：中文/大写标签数组；扩展名优先（更贴近用户看到的文件名）。
export function uploadTypeLabels({ allowedExtensions = [], allowedMimeTypes = [] } = {}) {
  const extensions = normalizeExtensionList(allowedExtensions)
  const labels = []
  const push = (label) => { if (label && !labels.includes(label)) labels.push(label) }
  if (extensions.length) {
    for (const extension of extensions) push(MIME_LABELS[mimeTypeForExtension(extension)] || extension.toUpperCase())
    return labels
  }
  for (const mime of normalizeMimeList(allowedMimeTypes)) push(MIME_LABELS[mime] || mime)
  return labels
}

// 用途：把字节数格式化为便于阅读的上限文案（MiB / KiB / 字节）。
// 参数：bytes 为字节数。
// 返回值：如 `20 MiB`、`512 KiB`、`900 字节`；非法值返回 `未知大小`。
export function formatUploadBytes(bytes) {
  const value = Number(bytes)
  if (!Number.isFinite(value) || value < 0) return '未知大小'
  if (value >= BYTES_PER_MIB) return `${trimDecimal(value / BYTES_PER_MIB)} MiB`
  if (value >= BYTES_PER_KIB) return `${trimDecimal(value / BYTES_PER_KIB)} KiB`
  return `${Math.floor(value)} 字节`
}

/**
 * validateUploadFile 校验待上传文件的大小与类型。
 * @param {{name?: string, type?: string, size?: number}} file 待上传文件（File 或等价对象）。
 * @param {{label?: string, maxSizeBytes?: number, allowedExtensions?: string[], allowedMimeTypes?: string[]}} [options]
 *   label 为错误文案里的文件称呼；maxSizeBytes <= 0 或缺失表示不限大小；两个白名单都为空表示不限类型。
 * @returns {{ok: true, extension: string, mimeType: string}|{ok: false, code: 'FILE_TOO_LARGE'|'FILE_TYPE_NOT_ALLOWED', message: string}}
 *   不合规时返回可直接展示的中文文案，调用方负责中止上传并提示。
 */
export function validateUploadFile(file, { label = '文件', maxSizeBytes = 0, allowedExtensions = [], allowedMimeTypes = [] } = {}) {
  const size = Number(file?.size)
  const limit = Number(maxSizeBytes)
  if (Number.isFinite(limit) && limit > 0 && Number.isFinite(size) && size > limit) {
    return {
      ok: false,
      code: 'FILE_TOO_LARGE',
      message: `${label}不能超过 ${formatUploadBytes(limit)}，当前文件 ${Math.floor(size)} 字节，请压缩或拆分后重新上传。`,
    }
  }
  const extensions = normalizeExtensionList(allowedExtensions)
  const mimeTypes = new Set(normalizeMimeList(allowedMimeTypes))
  for (const extension of extensions) {
    const derived = mimeTypeForExtension(extension)
    if (derived) mimeTypes.add(derived)
  }
  const extension = fileExtension(file?.name)
  const declared = normalizeMimeType(file?.type)
  const effectiveMimeType = declared || mimeTypeForExtension(extension)
  if (!extensions.length && !mimeTypes.size) return { ok: true, extension, mimeType: effectiveMimeType }
  const extensionAllowed = !extensions.length || (Boolean(extension) && extensions.includes(extension))
  const mimeAllowed = !mimeTypes.size || (Boolean(effectiveMimeType) && mimeTypes.has(effectiveMimeType))
  if (extensionAllowed && mimeAllowed) return { ok: true, extension, mimeType: effectiveMimeType }
  const labels = uploadTypeLabels({ allowedExtensions: extensions, allowedMimeTypes: [...mimeTypes] })
  return {
    ok: false,
    code: 'FILE_TYPE_NOT_ALLOWED',
    message: `${label}类型不受支持，仅允许 ${labels.length ? labels.join('、') : '已声明的文件类型'}。`,
  }
}

function normalizeMimeList(values) {
  const list = Array.isArray(values) ? values : []
  const seen = []
  for (const value of list) {
    const mime = normalizeMimeType(value)
    if (mime && !seen.includes(mime)) seen.push(mime)
  }
  return seen
}

function normalizeExtensionList(values) {
  const list = Array.isArray(values) ? values : []
  const seen = []
  for (const value of list) {
    const extension = String(value ?? '').trim().toLowerCase().replace(/^\./, '')
    if (extension && !seen.includes(extension)) seen.push(extension)
  }
  return seen
}

function trimDecimal(value) {
  return String(Number(value.toFixed(2)))
}
