const API_BASE_URL = (import.meta.env?.VITE_API_BASE_URL || '/api/v1').replace(/\/$/, '')

/**
 * DictionaryError preserves the safe error metadata returned by the platform API.
 */
export class DictionaryError extends Error {
  constructor(message, options = {}) {
    super(message)
    this.name = 'DictionaryError'
    this.status = options.status || 0
    this.code = options.code || ''
    this.traceId = options.traceId || ''
  }
}

async function readBody(response) {
  const contentType = response.headers.get('content-type') || ''
  if (contentType.includes('application/json')) {
    try {
      return await response.json()
    } catch {
      return {}
    }
  }

  const text = await response.text()
  return text ? { message: text } : {}
}

async function request(path, options = {}) {
  let response
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...options,
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers || {}),
      },
    })
  } catch {
    throw new DictionaryError('无法连接字典服务，请确认后端服务已启动。', { code: 'NETWORK_ERROR' })
  }

  const body = await readBody(response)
  if (!response.ok) {
    throw new DictionaryError(body.message || '字典请求失败。', {
      status: response.status,
      code: body.code,
      traceId: body.request_id || body.trace_id || body.traceId,
    })
  }

  return body.data
}

function pageQuery({ page = 1, pageSize = 20, keyword = '', status = '' } = {}) {
  const query = new URLSearchParams({ page: String(page), page_size: String(pageSize) })
  if (keyword.trim()) query.set('keyword', keyword.trim())
  if (status) query.set('status', status)
  return `?${query.toString()}`
}

function dictionaryPath(dictionaryId) {
  return `/dictionaries/${encodeURIComponent(dictionaryId)}`
}

function itemPath(dictionaryId, itemId = '') {
  const collection = `${dictionaryPath(dictionaryId)}/items`
  return itemId ? `${collection}/${encodeURIComponent(itemId)}` : collection
}

/** Lists the current tenant's business dictionaries. */
export function listDictionaries(query = {}) {
  return request(`/dictionaries${pageQuery(query)}`)
}

/** Creates one tenant-scoped dictionary. */
export function createDictionary({ code, name, description = '', status = 'ACTIVE' }) {
  return request('/dictionaries', {
    method: 'POST',
    body: JSON.stringify({ code, name, description, status }),
  })
}

/** Reads one dictionary by ID. */
export function getDictionary(dictionaryId) {
  return request(dictionaryPath(dictionaryId))
}

/** Replaces editable dictionary fields under optimistic locking. */
export function updateDictionary({ dictionaryId, code, name, description = '', status, version }) {
  return request(dictionaryPath(dictionaryId), {
    method: 'PATCH',
    body: JSON.stringify({ code, name, description, status, version }),
  })
}

/** Lists all active and disabled items managed under a dictionary. */
export function listDictionaryItems({ dictionaryId, ...query }) {
  return request(`${itemPath(dictionaryId)}${pageQuery(query)}`)
}

/** Creates one dictionary item. */
export function createDictionaryItem({ dictionaryId, code, label, value, sortOrder = 0, status = 'ACTIVE' }) {
  return request(itemPath(dictionaryId), {
    method: 'POST',
    body: JSON.stringify({ code, label, value, sort_order: Number(sortOrder) || 0, status }),
  })
}

/** Replaces editable dictionary item fields under optimistic locking. */
export function updateDictionaryItem({ dictionaryId, itemId, code, label, value, sortOrder = 0, status, version }) {
  return request(itemPath(dictionaryId, itemId), {
    method: 'PATCH',
    body: JSON.stringify({ code, label, value, sort_order: Number(sortOrder) || 0, status, version }),
  })
}

/** Returns only selectable items for an enabled dictionary code. */
export function listActiveDictionaryItemsByCode({ dictionaryCode, ...query }) {
  return request(`/dictionaries/code/${encodeURIComponent(dictionaryCode)}/items${pageQuery(query)}`)
}
