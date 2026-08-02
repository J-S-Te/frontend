const PRESALE_STATUSES = new Set([
  'APPROVAL_STARTING', 'PENDING_APPROVAL', 'APPROVED_PENDING_ASSIGNMENT', 'EXECUTING',
  'COMPLETED', 'REJECTED', 'CANCELLED',
])
const PRESALE_VENUES = new Set(['', 'REMOTE', 'ONSITE'])
const PRESALE_URGENCIES = new Set(['', 'NORMAL', 'URGENT'])
const PRESALE_PUSH_STATUSES = new Set(['', 'PENDING', 'SENDING', 'SUCCESS', 'RETRY_WAIT', 'DEAD_LETTER'])
const PRESALE_SORT_FIELDS = new Set(['created_at', 'updated_at', 'expected_end', 'request_no'])

function scalar(query, key) {
  const value = query?.[key]
  return Array.isArray(value) ? String(value[0] || '') : String(value || '')
}

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback
}

function enumValue(value, allowed) {
  return allowed.has(value) ? value : ''
}

/** Rehydrates the complete TS-007 workspace state from a route query. */
export function presaleStateFromQuery(query = {}) {
  const status = scalar(query, 'status').toUpperCase()
  const sortBy = scalar(query, 'sort_by').toLowerCase()
  const sortOrder = scalar(query, 'sort_order').toLowerCase()
  return {
    filters: {
      request_no: scalar(query, 'request_no').slice(0, 32),
      opportunity_id: scalar(query, 'opportunity_id'),
      applicant_id: scalar(query, 'applicant_id').slice(0, 64),
      assignee_id: scalar(query, 'assignee_id').slice(0, 64),
      status: PRESALE_STATUSES.has(status) ? status : '',
      venue: enumValue(scalar(query, 'venue').toUpperCase(), PRESALE_VENUES),
      urgency: enumValue(scalar(query, 'urgency').toUpperCase(), PRESALE_URGENCIES),
      created_from: scalar(query, 'created_from'),
      created_to: scalar(query, 'created_to'),
      expected_from: scalar(query, 'expected_from'),
      expected_to: scalar(query, 'expected_to'),
      overdue: ['true', 'false'].includes(scalar(query, 'overdue')) ? scalar(query, 'overdue') : '',
      push_status: enumValue(scalar(query, 'push_status').toUpperCase(), PRESALE_PUSH_STATUSES),
      sort_by: PRESALE_SORT_FIELDS.has(sortBy) ? sortBy : 'created_at',
      sort_order: sortOrder === 'asc' ? 'asc' : 'desc',
    },
    view: scalar(query, 'presale_view') === 'board' ? 'board' : 'list',
    page: positiveInteger(scalar(query, 'page'), 1),
    pageSize: Math.min(100, positiveInteger(scalar(query, 'page_size'), 20)),
    columnLimit: Math.min(50, positiveInteger(scalar(query, 'column_limit'), 20)),
  }
}

/** Produces a stable URL query without leaking an authorization scope parameter. */
export function presaleStateToQuery(filters, view, page, pageSize, columnLimit) {
  const result = {
    presale_view: view === 'board' ? 'board' : 'list',
    page: String(page),
    page_size: String(pageSize),
    column_limit: String(columnLimit),
  }
  for (const key of [
    'request_no', 'opportunity_id', 'applicant_id', 'assignee_id', 'status', 'venue', 'urgency',
    'created_from', 'created_to', 'expected_from', 'expected_to', 'overdue', 'push_status',
    'sort_by', 'sort_order',
  ]) {
    if (filters[key] !== '' && filters[key] !== null && filters[key] !== undefined) result[key] = String(filters[key])
  }
  return result
}

/** Converts local date-time controls to the RFC3339 contract used by Gin. */
export function presaleAPIParams(filters) {
  const result = {}
  for (const key of ['request_no', 'opportunity_id', 'applicant_id', 'assignee_id', 'status', 'venue', 'urgency', 'overdue', 'push_status', 'sort_by', 'sort_order']) {
    if (filters[key] !== '') result[key] = filters[key]
  }
  for (const key of ['created_from', 'created_to', 'expected_from', 'expected_to']) {
    if (!filters[key]) continue
    const value = new Date(filters[key])
    if (!Number.isNaN(value.getTime())) result[key] = value.toISOString()
  }
  return result
}
