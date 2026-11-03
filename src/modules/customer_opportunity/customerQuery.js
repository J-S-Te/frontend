// 客户列表的日期过滤边界按北京墙钟换算：'YYYY-MM-DD' 是北京日历日，不是浏览器本地的瞬间。
import { businessWallClockToInstant } from '../shared/utils/businessTime.js'

export const CUSTOMER_QUICK_FILTERS = new Set(['', 'KEY', 'NEW', 'WON', 'FOLLOWUP_DUE'])
export const CUSTOMER_CREDIT_LEVELS = new Set(['', 'A', 'B', 'C', 'D'])
export const CUSTOMER_SORT_FIELDS = new Set(['updated_at', 'created_at', 'name', 'last_followup_at', 'opportunity_amount_sum'])

export function customerFiltersFromQuery(query = {}) {
  // 路由参数可能来自手工编辑或旧书签；只允许服务端支持的快捷筛选和排序字段，
  // 避免把任意字段名透传成后端排序表达式。
  const scalar = (key) => Array.isArray(query[key]) ? String(query[key][0] || '') : String(query[key] || '')
  const quick = scalar('quick_filter').toUpperCase()
  const sort = scalar('sort_by').toLowerCase()
  const order = scalar('sort_order').toLowerCase()
  return {
    keyword: scalar('keyword'), type: scalar('type'), industry: scalar('industry'), region: scalar('region'),
    owner_id: scalar('owner_id'), status: scalar('status'), credit_level: CUSTOMER_CREDIT_LEVELS.has(scalar('credit_level').toUpperCase()) ? scalar('credit_level').toUpperCase() : '', quick_filter: CUSTOMER_QUICK_FILTERS.has(quick) ? quick : '',
    created_from: scalar('created_from'), created_to: scalar('created_to'), last_followup_from: scalar('last_followup_from'),
    last_followup_to: scalar('last_followup_to'), sort_by: CUSTOMER_SORT_FIELDS.has(sort) ? sort : 'updated_at',
    sort_order: order === 'asc' ? 'asc' : 'desc', view: scalar('view') === 'cards' ? 'cards' : 'table',
  }
}

export function customerFiltersToQuery(filters, page, pageSize) {
  const result = { page: String(page), page_size: String(pageSize) }
  for (const key of ['keyword', 'type', 'industry', 'region', 'owner_id', 'status', 'credit_level', 'quick_filter', 'created_from', 'created_to', 'last_followup_from', 'last_followup_to', 'sort_by', 'sort_order', 'view']) {
    if (filters[key]) result[key] = String(filters[key])
  }
  return result
}

export function customerAPIParams(filters, page, pageSize) {
  const result = { ...customerFiltersToQuery(filters, page, pageSize) }
  delete result.view
  // 日期过滤是纯日期（type="date"），代表北京日历日而不是瞬间：
  // 起点取该日北京零点，结束取次日北京零点并作为不含上界，
  // 这样发给后端的 UTC 半开区间与用户在北京看到的日历日一致（浏览器时区不参与解释）。
  for (const key of ['created_from', 'last_followup_from']) if (result[key]) result[key] = businessDayStart(result[key]) || result[key]
  for (const key of ['created_to', 'last_followup_to']) if (result[key]) result[key] = businessNextDayStart(result[key]) || result[key]
  return result
}

// 北京墙钟 'YYYY-MM-DDTHH:mm' → 瞬间；非法值返回 ''，由调用方保留原值交给服务端校验。
function businessDayStart(value) { return businessWallClockToInstant(`${String(value).trim()}T00:00`) }

// 下一个北京日历日的零点（不含上界）：北京 1991 年后无夏令时、偏移恒为 +8，
// 因此“该日北京零点 + 24h”就是次日北京零点；起点非法时返回 '' 由调用方保留原值。
function businessNextDayStart(value) {
  const start = Date.parse(businessDayStart(value))
  if (!Number.isFinite(start)) return ''
  return new Date(start + 86400000).toISOString()
}
