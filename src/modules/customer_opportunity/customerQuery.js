export const CUSTOMER_QUICK_FILTERS = new Set(['', 'KEY', 'NEW', 'WON', 'FOLLOWUP_DUE'])
export const CUSTOMER_SORT_FIELDS = new Set(['updated_at', 'created_at', 'name', 'last_followup_at', 'opportunity_amount_sum'])

export function customerFiltersFromQuery(query = {}) {
  const scalar = (key) => Array.isArray(query[key]) ? String(query[key][0] || '') : String(query[key] || '')
  const quick = scalar('quick_filter').toUpperCase()
  const sort = scalar('sort_by').toLowerCase()
  const order = scalar('sort_order').toLowerCase()
  return {
    keyword: scalar('keyword'), type: scalar('type'), industry: scalar('industry'), region: scalar('region'),
    owner_id: scalar('owner_id'), status: scalar('status'), quick_filter: CUSTOMER_QUICK_FILTERS.has(quick) ? quick : '',
    created_from: scalar('created_from'), created_to: scalar('created_to'), last_followup_from: scalar('last_followup_from'),
    last_followup_to: scalar('last_followup_to'), sort_by: CUSTOMER_SORT_FIELDS.has(sort) ? sort : 'updated_at',
    sort_order: order === 'asc' ? 'asc' : 'desc', view: scalar('view') === 'cards' ? 'cards' : 'table',
  }
}

export function customerFiltersToQuery(filters, page, pageSize) {
  const result = { page: String(page), page_size: String(pageSize) }
  for (const key of ['keyword', 'type', 'industry', 'region', 'owner_id', 'status', 'quick_filter', 'created_from', 'created_to', 'last_followup_from', 'last_followup_to', 'sort_by', 'sort_order', 'view']) {
    if (filters[key]) result[key] = String(filters[key])
  }
  return result
}

export function customerAPIParams(filters, page, pageSize) {
  const result = { ...customerFiltersToQuery(filters, page, pageSize) }
  delete result.view
  for (const key of ['created_from', 'last_followup_from']) if (result[key]) result[key] = localDateStart(result[key])
  for (const key of ['created_to', 'last_followup_to']) if (result[key]) result[key] = localDateNextStart(result[key])
  return result
}

function localDateStart(value) { return new Date(`${value}T00:00:00`).toISOString() }
function localDateNextStart(value) {
  const date = new Date(`${value}T00:00:00`)
  date.setDate(date.getDate() + 1)
  return date.toISOString()
}
