import { createRequest } from '../../shared/api/request.js'

export class PersonnelChangeError extends Error {
  constructor(message, options = {}) {
    super(message)
    this.name = 'PersonnelChangeError'
    this.status = options.status || 0
    this.code = options.code || ''
    this.traceId = options.traceId || ''
    this.details = options.details || null
  }
}

const request = createRequest({
  ErrorClass: PersonnelChangeError,
  networkMessage: '无法连接人员异动服务，请确认平台 API 已启动。',
  failureMessage: '人员异动请求失败。',
})

function query(parameters = {}) {
  const search = new URLSearchParams()
  Object.entries(parameters).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') search.set(key, String(value))
  })
  const encoded = search.toString()
  return encoded ? `?${encoded}` : ''
}

export function listPersonnelChanges({ page = 1, pageSize = 20, status = '', type = '', keyword = '' } = {}) {
  return request(`/personnel-changes${query({ page, page_size: pageSize, status, change_type: type, keyword })}`).then((value) => ({
    items: Array.isArray(value?.items) ? value.items : [],
    total: Number(value?.total || 0),
    page: Number(value?.page || page),
    pageSize: Number(value?.page_size || pageSize),
  }))
}

export function previewPersonnelChange(payload) {
  return request('/personnel-changes/preview', { method: 'POST', body: JSON.stringify(payload) })
}

export function createPersonnelChange(payload) {
  return request('/personnel-changes', { method: 'POST', body: JSON.stringify(payload) })
}

export function submitPersonnelChange(id) {
  return request(`/personnel-changes/${encodeURIComponent(id)}/transition`, {
    method: 'POST',
    body: JSON.stringify({ to_status: 'PENDING_APPROVAL' }),
  })
}

export function cancelPersonnelChange(id) {
  return request(`/personnel-changes/${encodeURIComponent(id)}/transition`, {
    method: 'POST',
    body: JSON.stringify({ to_status: 'CANCELLED' }),
  })
}
