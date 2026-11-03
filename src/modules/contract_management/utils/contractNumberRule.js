// 系统级合同编号规则：前端只负责表单规范化与「下一号」预览，正式编号始终由后端生成。
// 拼接顺序与后端契约一致：前缀 + 年份段文本 + 按年度重置的流水（左补零）+ 后缀。
// 这里不推断租户、年度边界或并发流水，避免把预览当成真实编号使用。
import { todayBusinessDate } from '../../shared/utils/businessTime.js'

export const CONTRACT_NUMBER_YEAR_SEGMENTS = Object.freeze([
  { value: 'NONE', label: '不含年份', hint: '编号中不插入年份段' },
  { value: 'YY', label: '两位年份', hint: '例如 2026 年记为 26' },
  { value: 'YYYY', label: '四位年份', hint: '例如 2026 年记为 2026' },
])

// 与后端校验保持一致，前端只用于输入上限与预览提示，不作为授权或唯一校验。
export const CONTRACT_NUMBER_RULE_LIMITS = Object.freeze({
  prefix: 32,
  suffix: 32,
  seq_width_min: 1,
  seq_width_max: 9,
  total: 64,
})

// 前后缀字符集与后端白名单一致：CRM 征信投递要求合同编号匹配 ^[A-Za-z0-9._/-]+$，
// 因此中文、空格、括号、#、{} 等字符在前缀/后缀里就会让下游回款征信失败。
export const CONTRACT_NUMBER_AFFIX_ALLOWED_PATTERN = '^[A-Za-z0-9._/-]*$'
export const CONTRACT_NUMBER_AFFIX_HINT = '只能包含字母、数字和 - _ . /'
const CONTRACT_NUMBER_AFFIX_REGEXP = new RegExp(CONTRACT_NUMBER_AFFIX_ALLOWED_PATTERN)

const DEFAULT_SEQ_WIDTH = 4
const YEAR_SEGMENT_VALUES = new Set(CONTRACT_NUMBER_YEAR_SEGMENTS.map((item) => item.value))

function currentYear() {
  // 年份段预览取北京年份：浏览器不在东八区时，跨年窗口的本地年份会与业务年度差一年。
  // 只影响预览与年度流水推算文案，正式编号仍以服务端年度为准。
  const year = Number(todayBusinessDate().slice(0, 4))
  return Number.isInteger(year) && year >= 1 ? year : new Date().getFullYear()
}

function normalizeYear(year) {
  const value = Number(year)
  return Number.isInteger(value) && value >= 1 && value <= 9999 ? value : currentYear()
}

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * normalizeContractNumberYearSegment 把任意输入收敛到契约枚举，未知值按两位年份处理。
 * @param {unknown} value 后端或表单给出的年份段取值。
 * @returns {'NONE'|'YY'|'YYYY'} 契约允许的年份段。
 */
export function normalizeContractNumberYearSegment(value) {
  return YEAR_SEGMENT_VALUES.has(value) ? value : 'YY'
}

/**
 * normalizeContractNumberSequenceWidth 把流水位数收敛到 1–9 的整数，空值和非法值回落 4 位。
 * @param {unknown} value 表单或后端给出的流水位数。
 * @returns {number} 1–9 之间的整数。
 */
export function normalizeContractNumberSequenceWidth(value) {
  const width = Number(value)
  if (!Number.isFinite(width)) return DEFAULT_SEQ_WIDTH
  return Math.min(CONTRACT_NUMBER_RULE_LIMITS.seq_width_max,
    Math.max(CONTRACT_NUMBER_RULE_LIMITS.seq_width_min, Math.trunc(width)))
}

/**
 * normalizeContractNumberRule 规范化一条编号规则：去首尾空格、收敛枚举与位宽，缺字段补默认值。
 * @param {Record<string, unknown>} [rule] 服务端响应或表单内容。
 * @returns {{prefix: string, year_segment: 'NONE'|'YY'|'YYYY', seq_width: number, suffix: string}} 规范化后的规则。
 */
export function normalizeContractNumberRule(rule = {}) {
  const source = rule && typeof rule === 'object' ? rule : {}
  return {
    prefix: normalizeText(source.prefix),
    year_segment: normalizeContractNumberYearSegment(source.year_segment),
    seq_width: normalizeContractNumberSequenceWidth(source.seq_width),
    suffix: normalizeText(source.suffix),
  }
}

/**
 * contractNumberYearSegmentText 按年份段枚举渲染文本；NONE 返回空串，绝不返回字符串 "undefined"。
 * @param {'NONE'|'YY'|'YYYY'} yearSegment 年份段枚举。
 * @param {number} [year] 业务年度，缺省使用本机当前年份。
 * @returns {string} 年份段文本。
 */
export function contractNumberYearSegmentText(yearSegment, year) {
  const safeYear = normalizeYear(year)
  const segment = normalizeContractNumberYearSegment(yearSegment)
  if (segment === 'NONE') return ''
  if (segment === 'YYYY') return String(safeYear).padStart(4, '0')
  return String(safeYear % 100).padStart(2, '0')
}

/**
 * buildContractNumberPreview 用给定规则与流水号拼出编号示例，并标出溢出等需要提示的情况。
 * @param {Record<string, unknown>} rule 编号规则（允许未规范化）。
 * @param {{year?: number, sequence?: number}} [options] year 缺省为北京当前年份，sequence 缺省为 1。
 * @returns {{number: string, prefix: string, year_segment: 'NONE'|'YY'|'YYYY', year_text: string,
 *   sequence: number, sequence_text: string, suffix: string, width: number,
 *   overflow: boolean, too_long: boolean}} 预览结果；number 永不为 undefined/NaN。
 */
export function buildContractNumberPreview(rule, options = {}) {
  const normalized = normalizeContractNumberRule(rule)
  const rawSequence = Number(options.sequence)
  const sequence = Number.isSafeInteger(rawSequence) && rawSequence >= 1 ? rawSequence : 1
  const yearText = contractNumberYearSegmentText(normalized.year_segment, options.year)
  const sequenceText = String(sequence).padStart(normalized.seq_width, '0')
  const number = `${normalized.prefix}${yearText}${sequenceText}${normalized.suffix}`
  return {
    number,
    prefix: normalized.prefix,
    year_segment: normalized.year_segment,
    year_text: yearText,
    sequence,
    sequence_text: sequenceText,
    suffix: normalized.suffix,
    width: normalized.seq_width,
    // 流水超过位宽时不截断（截断会产生重复编号），只提示编号会变长。
    overflow: sequenceText.length > normalized.seq_width,
    too_long: [...number].length > CONTRACT_NUMBER_RULE_LIMITS.total,
  }
}

/**
 * buildContractNumberSample 只返回编号示例文本，便于展示与测试。
 * @param {Record<string, unknown>} rule 编号规则。
 * @param {{year?: number, sequence?: number}} [options] 年度与流水号。
 * @returns {string} 编号示例。
 */
export function buildContractNumberSample(rule, options) {
  return buildContractNumberPreview(rule, options).number
}

/**
 * nextContractNumberSequence 推算下一条流水：同一自然年取已用流水 + 1，跨年从 1 开始。
 * @param {Record<string, unknown>} [rule] 含 seq_year 与 current_value 的服务端规则。
 * @param {number} [year] 目标年度，缺省为本机当前年份。
 * @returns {number} 下一条流水号（不小于 1）。
 */
export function nextContractNumberSequence(rule, year) {
  const used = Number(rule?.current_value)
  if (Number(rule?.seq_year) === normalizeYear(year) && Number.isSafeInteger(used) && used >= 0) return used + 1
  return 1
}

/**
 * contractNumberRuleUsageLabel 把 seq_year / current_value 转成可读的流水用量说明。
 * 流水是全系统一个年度计数器（不按租户拆分），文案必须点明「全系统」，
 * 否则管理员会误以为是本租户用量。
 * @param {Record<string, unknown>} [rule] 服务端规则。
 * @returns {string} 例如「2026 年度全系统已使用 12 个流水」。
 */
export function contractNumberRuleUsageLabel(rule) {
  const year = Number(rule?.seq_year)
  const used = Number(rule?.current_value)
  const safeUsed = Number.isSafeInteger(used) && used > 0 ? used : 0
  if (!Number.isSafeInteger(year) || year < 1 || year > 9999) return `本年度全系统已使用 ${safeUsed} 个流水`
  return `${year} 年度全系统已使用 ${safeUsed} 个流水`
}

/**
 * isContractNumberAffixValid 判断前缀/后缀是否只含后端白名单字符（字母、数字与 - _ . /）。
 * 与后端一样先去掉首尾空格再判断，空串视为合法。
 * @param {unknown} value 前缀或后缀输入。
 * @returns {boolean} 合法返回 true。
 */
export function isContractNumberAffixValid(value) {
  return CONTRACT_NUMBER_AFFIX_REGEXP.test(normalizeText(value))
}

/**
 * contractNumberAffixError 生成单个字段的字符集中文提示，供客户端拦截与字段高亮共用。
 * @param {'prefix'|'suffix'} field 字段名。
 * @param {unknown} value 字段值。
 * @returns {string} 中文提示；合法时返回空串。
 */
export function contractNumberAffixError(field, value) {
  if (isContractNumberAffixValid(value)) return ''
  const label = field === 'suffix' ? '编号后缀' : '编号前缀'
  return `${label}${CONTRACT_NUMBER_AFFIX_HINT}，不能包含中文、空格、括号、#、{} 等字符。`
}

/**
 * contractNumberRuleAffixErrors 依次检查前缀与后缀，返回需要高亮的字段及其提示。
 * @param {Record<string, unknown>} rule 表单内容。
 * @returns {Array<{field: 'prefix'|'suffix', message: string}>} 非法字段列表，按前缀、后缀顺序。
 */
export function contractNumberRuleAffixErrors(rule) {
  return ['prefix', 'suffix']
    .map((field) => ({ field, message: contractNumberAffixError(field, rule?.[field]) }))
    .filter((item) => item.message)
}

/**
 * contractNumberRuleFormError 保存前的本地检查：只拦明显不合法或后端一定会拒绝的输入。
 * @param {Record<string, unknown>} rule 表单内容。
 * @returns {string} 中文提示；通过时返回空串。
 */
export function contractNumberRuleFormError(rule) {
  const affixErrors = contractNumberRuleAffixErrors(rule)
  if (affixErrors.length) return affixErrors.map((item) => item.message).join('')
  const width = rule?.seq_width
  const widthNumber = Number(width)
  if (width === '' || width === null || width === undefined || !Number.isInteger(widthNumber)
    || widthNumber < CONTRACT_NUMBER_RULE_LIMITS.seq_width_min || widthNumber > CONTRACT_NUMBER_RULE_LIMITS.seq_width_max) {
    return `流水位数需要填写 ${CONTRACT_NUMBER_RULE_LIMITS.seq_width_min}–${CONTRACT_NUMBER_RULE_LIMITS.seq_width_max} 之间的整数。`
  }
  if (buildContractNumberPreview(rule, {}).too_long) return `编号总长度超过 ${CONTRACT_NUMBER_RULE_LIMITS.total} 个字符，请缩短前缀、后缀或去掉年份段。`
  return ''
}

/**
 * contractNumberRulePayload 生成 PUT 所需的四字段全量载荷；不夹带示例、用量等只读字段。
 * @param {Record<string, unknown>} rule 表单内容。
 * @returns {{prefix: string, year_segment: 'NONE'|'YY'|'YYYY', seq_width: number, suffix: string}} 请求体。
 */
export function contractNumberRulePayload(rule) {
  const normalized = normalizeContractNumberRule(rule)
  return {
    prefix: normalized.prefix,
    year_segment: normalized.year_segment,
    seq_width: normalized.seq_width,
    suffix: normalized.suffix,
  }
}
