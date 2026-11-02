// 合同模块的“业务日历日”判定：业务口径一律按北京时间（见 shared/utils/businessTime.js），
// 不从宿主浏览器时区推断。抽成纯函数是为了能被 node 直接测试，页面只负责调用。
import {
  currentBusinessMonthRange,
  formatBusinessDate,
  formatBusinessDateTime,
  todayBusinessDate,
} from '../../shared/utils/businessTime.js'

// 只有这几个状态才可能“过期”；其它状态（草稿、审批中、已终止等）不参与过期判定。
export const ACTIVE_CONTRACT_STATUSES = new Set(['ACTIVE', 'IN_PROGRESS', 'PENDING_PAY'])

/**
 * 该日期是否早于北京今天（即“已经过去的日子”）。
 * 纯日期原样比较、不做时区平移；date 与 today 都是 `YYYY-MM-DD`，字符串比较即日历序。
 * 合同台账与签署台账共用这一份判定，避免两处口径再次分叉。
 * @param {unknown} value 纯日期或时间戳。
 * @param {{today?: string}} [options] today 为北京今天，测试可注入固定值。
 * @returns {boolean} 是否早于今天。
 */
/**
 * 合同是否已过期：用北京日历日比较 end_date 与北京今天。
 * end_date 是纯日期串，直接按日历日比较（不做时区平移）；到期日当天不算过期。
 * 后端返回的 expired 标记与不可解析的 end_date 保持既有语义（前者优先，后者不过期）。
 * @param {{expired?: boolean, status?: string, end_date?: string}|null|undefined} item 合同数据。
 * @param {{today?: string}} [options] today 为北京今天，测试可注入固定值。
 * @returns {boolean} 是否已过期。
 */
export function isPastBusinessDay(value, { today = todayBusinessDate() } = {}) {
  const date = formatBusinessDate(value)
  if (!date || !today) return false
  return date < today
}

export function isContractExpired(item, { today = todayBusinessDate() } = {}) {
  if (item?.expired === true) return true
  const rawStatus = String(item?.status || '').toUpperCase()
  if (!ACTIVE_CONTRACT_STATUSES.has(rawStatus) || !item?.end_date) return false
  return isPastBusinessDay(item.end_date, { today })
}

/**
 * 确认时间是否落在北京当前自然月（含首尾）内。
 * 入参可能是时间戳或纯日期；浏览器不在东八区时，用本地月份会在月初/月末漏算。
 * @param {unknown} value 待判定时间（时间戳、纯日期或 RFC3339）。
 * @param {{from: string, to: string}} [range] 北京自然月闭区间，缺省取当前月。
 * @returns {boolean} 是否属于该月。
 */
export function isInBusinessMonth(value, range = currentBusinessMonthRange()) {
  if (!range || !range.from || !range.to) return false
  const date = formatBusinessDate(value)
  return Boolean(date) && date >= range.from && date <= range.to
}

/**
 * 合同台账的日期展示：纯日期（start_date/end_date 等日历日）原样返回不平移，
 * 时间戳折算成北京日历日；空值给占位符，无法解析的非空值原样回显便于排查。
 * @param {unknown} value 后端字段（纯日期或时间戳）。
 * @returns {string} 展示用日期串。
 */
export function formatContractDate(value) {
  if (!value) return '—'
  return formatBusinessDate(value) || String(value)
}

/**
 * 合同台账的日期时间展示：一律折算北京业务时间（含秒），口径与后端业务时刻一致。
 * @param {unknown} value 后端字段（时间戳或 RFC3339）。
 * @returns {string} 展示用日期时间串。
 */
export function formatContractDateTime(value) {
  if (!value) return '—'
  return formatBusinessDateTime(value, { seconds: true }) || String(value)
}
