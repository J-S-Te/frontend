/**
 * 业务日历时间工具：业务口径一律按北京时间（Asia/Shanghai，UTC+8）。
 *
 * 约定：
 * - 展示/取值统一用 Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }) 得到
 *   `YYYY-MM-DD HH:mm:ss` 形态的“北京墙钟”，再按需拼装；不做手算偏移的日期加减。
 * - 纯日期串 'YYYY-MM-DD' 表示“日历日”而不是瞬间：formatBusinessDate /
 *   formatBusinessMonth 原样（或直接取其前缀）返回，绝不做时区平移。
 * - 所有入参非法（null/undefined/''/NaN/非法串……）时返回 '' 或 null，绝不抛异常。
 * - 零依赖：只使用 Intl.DateTimeFormat 与 Date。
 *
 * 固定 +8 偏移只在“墙钟/日历日 → 瞬间”的反向换算中使用（理由见 BEIJING_FIXED_OFFSET_MS），
 * 正向换算（瞬间 → 北京墙钟/日历日）一律走 Intl.DateTimeFormat。
 */

export const BUSINESS_TIME_ZONE = 'Asia/Shanghai'

const DAY_MS = 24 * 60 * 60 * 1000
const HOUR_MS = 60 * 60 * 1000
const MINUTE_MS = 60 * 1000
const SECOND_MS = 1000

/**
 * 北京在 1991 年之后不再实行夏令时，任何时刻与 UTC 的偏移恒为 +8 小时。
 * 这是本模块唯一使用固定偏移的地方（见 businessWallClockToInstant），
 * 其余正向换算（瞬间 → 北京墙钟）都走 Intl，避免手算偏移出错。
 */
const BEIJING_FIXED_OFFSET_MS = 8 * HOUR_MS

/** Date 能表示的最大毫秒值（±100,000,000 天）。 */
const MAX_TIME_MS = 8.64e15

const PLAIN_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/
/** 无时区信息的北京墙钟：'YYYY-MM-DDTHH:mm'，可选 ':ss' 与毫秒。 */
const WALL_CLOCK_RE = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?$/
/**
 * 严格的时间串（墙钟 + 可选 IEEE/RFC3339 时区标记）。
 * 不用 Date.parse 兜底：它对 '2026-1-1' 之类非契约写法会按宿主机本地时区解释，结果不可复现。
 */
const TIMESTAMP_RE = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?([zZ]|[+-]\d{2}:?\d{2})?$/

let formatter = null

function getFormatter() {
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('sv-SE', {
      timeZone: BUSINESS_TIME_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    })
  }
  return formatter
}

function pad2(value) {
  return String(value).padStart(2, '0')
}

function pad4(value) {
  return String(value).padStart(4, '0')
}

/**
 * 把瞬间格式化为北京墙钟各字段。非法瞬间返回 null（Intl 对非法 Date 会抛 RangeError）。
 */
function businessParts(date) {
  if (!(date instanceof Date)) return null
  const ms = date.getTime()
  if (!Number.isFinite(ms) || Math.abs(ms) > MAX_TIME_MS) return null
  let parts
  try {
    parts = getFormatter().formatToParts(date)
  } catch {
    return null
  }
  const fields = {}
  for (const part of parts) {
    if (part.type && part.type !== 'literal') fields[part.type] = part.value
  }
  if (!fields.year || !fields.month || !fields.day) return null
  // 个别 ICU 版本在 hour12:false 下会用 h24 周期把午夜输出成 '24'，统一归一到 '00'。
  const hour = fields.hour === '24' ? '00' : fields.hour
  return {
    year: fields.year,
    month: fields.month,
    day: fields.day,
    hour: hour ?? '00',
    minute: fields.minute ?? '00',
    second: fields.second ?? '00',
  }
}

/**
 * 校验公历年月日并返回该日历日的 UTC 零点毫秒值；非法（如 2026-02-30）返回 null。
 */
function utcDayStartMs(year, month, day) {
  if (!Number.isInteger(year) || year < 1000 || year > 9999) return null
  if (!Number.isInteger(month) || month < 1 || month > 12) return null
  if (!Number.isInteger(day) || day < 1 || day > 31) return null
  const ms = Date.UTC(year, month - 1, day)
  const probe = new Date(ms)
  if (
    probe.getUTCFullYear() !== year
    || probe.getUTCMonth() !== month - 1
    || probe.getUTCDate() !== day
  ) {
    return null
  }
  return ms
}

function parseFixedFraction(fraction) {
  if (!fraction) return 0
  return Number(`0.${fraction}`) * SECOND_MS
}

/**
 * 北京墙钟 → 瞬间毫秒值（固定 +8 偏移，理由见 BEIJING_FIXED_OFFSET_MS 注释）。
 * 会校验日历与时分秒的合法性，非法返回 null。
 */
function wallClockToMs(match) {
  const [, y, mo, d, h, mi, s, fraction] = match
  const year = Number(y)
  const month = Number(mo)
  const day = Number(d)
  const hour = Number(h)
  const minute = Number(mi)
  const second = s === undefined ? 0 : Number(s)
  if (hour > 23 || minute > 59 || second > 59) return null
  const dayMs = utcDayStartMs(year, month, day)
  if (dayMs === null) return null
  return dayMs + hour * HOUR_MS + minute * MINUTE_MS + second * SECOND_MS + parseFixedFraction(fraction) - BEIJING_FIXED_OFFSET_MS
}

/**
 * 带时区标记的时间串 → 瞬间毫秒值。Z 表示 UTC，±hh:mm 表示相对 UTC 的偏移。
 */
function zonedTimestampToMs(match) {
  const [, y, mo, d, h, mi, s, fraction, zone] = match
  const hour = Number(h)
  const minute = Number(mi)
  const second = s === undefined ? 0 : Number(s)
  if (hour > 23 || minute > 59 || second > 59) return null
  const dayMs = utcDayStartMs(Number(y), Number(mo), Number(d))
  if (dayMs === null) return null
  const localMs = dayMs + hour * HOUR_MS + minute * MINUTE_MS + second * SECOND_MS + parseFixedFraction(fraction)
  if (!zone) return localMs
  if (zone === 'Z' || zone === 'z') return localMs
  const sign = zone[0] === '-' ? -1 : 1
  const offsetHour = Number(zone.slice(1, 3))
  const offsetMinute = Number(zone.slice(-2))
  if (offsetHour > 23 || offsetMinute > 59) return null
  return localMs - sign * (offsetHour * HOUR_MS + offsetMinute * MINUTE_MS)
}

/**
 * 把任意受支持的时间值折算成毫秒时间戳。
 * 支持 Date、数字（>= 1e12 视为毫秒，否则视为 Unix 秒）、'YYYY-MM-DD'、墙钟串、RFC3339 串。
 * 非法返回 null，不抛异常。
 */
function toInstantMs(value) {
  if (value instanceof Date) {
    const ms = value.getTime()
    return Number.isFinite(ms) && Math.abs(ms) <= MAX_TIME_MS ? ms : null
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null
    const ms = value >= 1e12 ? value : value * SECOND_MS
    return Number.isFinite(ms) && Math.abs(ms) <= MAX_TIME_MS ? ms : null
  }

  if (typeof value !== 'string') return null
  const text = value.trim()
  if (!text) return null

  const plain = PLAIN_DATE_RE.exec(text)
  if (plain) {
    // 纯日期是“日历日”而不是瞬间：这里把它映射成该日的北京零点（等价于墙钟 'YYYY-MM-DDT00:00'），
    // 因此同样复用上面注释说明的固定 +8 偏移（北京 1991 年后无夏令时）。
    // 注意：展示方向（formatBusinessDate / formatBusinessMonth）对纯日期串直接原样返回，绝不平移。
    const dayMs = utcDayStartMs(Number(plain[1]), Number(plain[2]), Number(plain[3]))
    return dayMs === null ? null : dayMs - BEIJING_FIXED_OFFSET_MS
  }

  const timestamp = TIMESTAMP_RE.exec(text)
  if (!timestamp) return null
  const zone = timestamp[8]
  if (zone) return zonedTimestampToMs(timestamp)
  // 无时区信息的时间串按业务口径视为北京墙钟。
  return wallClockToMs(timestamp)
}

function instantParts(value) {
  const ms = toInstantMs(value)
  if (ms === null) return null
  return businessParts(new Date(ms))
}

/** 取瞬间对应的北京日期串；纯日期串原样返回（不平移）。 */
function businessIsoDate(value) {
  if (typeof value === 'string') {
    const text = value.trim()
    const plain = PLAIN_DATE_RE.exec(text)
    if (plain) {
      const dayMs = utcDayStartMs(Number(plain[1]), Number(plain[2]), Number(plain[3]))
      return dayMs === null ? null : text
    }
  }
  const parts = instantParts(value)
  return parts ? `${parts.year}-${parts.month}-${parts.day}` : null
}

function todayBusinessParts() {
  const parts = businessParts(new Date())
  if (!parts) return null
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
  }
}

/**
 * Date | number | 'YYYY-MM-DD' | RFC3339 → Date（瞬间）；非法返回 null。
 * 纯日期串映射为该日历日在北京的零点。
 */
export function toBusinessDate(value) {
  const ms = toInstantMs(value)
  return ms === null ? null : new Date(ms)
}

/**
 * 任意受支持的时间值 → 北京日历日 'YYYY-MM-DD'；非法返回 ''。
 * 纯日期串 'YYYY-MM-DD' 原样返回，不做时区平移。
 */
export function formatBusinessDate(value) {
  return businessIsoDate(value) ?? ''
}

/**
 * → 北京日期时间 'YYYY-MM-DD HH:mm'；options.seconds 为 true 时带 ':ss'。非法返回 ''。
 */
export function formatBusinessDateTime(value, options = {}) {
  const parts = instantParts(value)
  if (!parts) return ''
  const base = `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`
  return options && options.seconds === true ? `${base}:${parts.second}` : base
}

/** → 北京月份 'YYYY-MM'；纯日期串直接截取，不平移；非法返回 ''。 */
export function formatBusinessMonth(value) {
  const isoDate = businessIsoDate(value)
  return isoDate ? isoDate.slice(0, 7) : ''
}

/** 北京“今天”的 'YYYY-MM-DD'。 */
export function todayBusinessDate() {
  return businessIsoDate(new Date()) ?? ''
}

/**
 * 相对北京今天偏移若干天，返回 'YYYY-MM-DD'；days 非数字时返回 ''。
 * 偏移是对“日历日”做 UTC 日历运算（Date.UTC 会自动进位跨月跨年），不涉及时区换算。
 */
export function businessDateOffset(days) {
  if (days === null || days === undefined || days === '') return ''
  const amount = typeof days === 'number' ? days : Number(days)
  if (!Number.isFinite(amount)) return ''
  const today = todayBusinessParts()
  if (!today) return ''
  const shifted = new Date(Date.UTC(today.year, today.month - 1, today.day) + Math.trunc(amount) * DAY_MS)
  return `${pad4(shifted.getUTCFullYear())}-${pad2(shifted.getUTCMonth() + 1)}-${pad2(shifted.getUTCDate())}`
}

/** 北京当前自然月的闭区间 { from: 'YYYY-MM-01', to: 'YYYY-MM-<末日>' }。 */
export function currentBusinessMonthRange() {
  const today = todayBusinessParts()
  if (!today) return { from: '', to: '' }
  const { year, month } = today
  // Date.UTC(year, month, 0) 即“下个月的第 0 天”，也就是本月最后一天。
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return {
    from: `${pad4(year)}-${pad2(month)}-01`,
    to: `${pad4(year)}-${pad2(month)}-${pad2(lastDay)}`,
  }
}

/**
 * 北京墙钟 'YYYY-MM-DDTHH:mm'（可带 ':ss'）→ 带 Z 的 ISO 串；非法返回 ''。
 * 这里用固定 +8 小时把墙钟反算成瞬间：北京 1991 年后无夏令时，偏移恒为 +8，
 * 用 Intl 无法直接反算（它只做瞬间 → 墙钟的正向格式化）。
 */
export function businessWallClockToInstant(local) {
  if (typeof local !== 'string') return ''
  const match = WALL_CLOCK_RE.exec(local.trim())
  if (!match) return ''
  const ms = wallClockToMs(match)
  return ms === null ? '' : new Date(ms).toISOString()
}

/** 任意受支持的时间值 → 北京墙钟 'YYYY-MM-DDTHH:mm'；非法返回 ''。 */
export function instantToBusinessWallClock(value) {
  const parts = instantParts(value)
  if (!parts) return ''
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`
}
