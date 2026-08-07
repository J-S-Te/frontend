import { request, toQuery } from './client.js'

export const listPresaleRequests = (params) => request(`/presale/requests${toQuery(params)}`)
export const getPresaleBoard = (params) => request(`/presale/board${toQuery(params)}`)
export const getPresaleFilterOptions = (params) => request(`/presale/filter-options${toQuery(params)}`)
export const getPresaleRequest = (id) => request(`/presale/requests/${encodeURIComponent(id)}`)
export const getPresaleContactPhone = (id) => request(`/presale/requests/${encodeURIComponent(id)}/contact-phone`, {
  cache: 'no-store', headers: { 'Cache-Control': 'no-store' },
})
export const getPresaleTimeline = (id, params = {}) => request(`/presale/requests/${encodeURIComponent(id)}/timeline${toQuery(params)}`)
export const getPresaleAvailableActions = (id) => request(`/presale/requests/${encodeURIComponent(id)}/available-actions`)

export const createPresaleRequest = (payload, idempotencyKey) => request('/presale/requests', {
  method: 'POST', body: JSON.stringify(payload), idempotent: true, idempotencyKey,
})
export const reopenPresaleRequest = (id, version) => request(`/presale/requests/${encodeURIComponent(id)}/reopen?version=${encodeURIComponent(version)}`, {
  method: 'POST', idempotent: true,
})
export const submitApprovalAction = (id, payload, idempotencyKey) => request(`/presale/requests/${encodeURIComponent(id)}/approval-actions`, {
  method: 'POST', body: JSON.stringify(payload), idempotent: true, idempotencyKey,
})
export const getApprovalHistory = (id) => request(`/presale/requests/${encodeURIComponent(id)}/approval-history`)
export const replaceAssignments = (id, payload, idempotencyKey) => request(`/presale/requests/${encodeURIComponent(id)}/assignments`, {
  method: 'PUT', body: JSON.stringify(payload), idempotent: true, idempotencyKey,
})
export const selectPresaleExecutionDepartment = (id, payload) => request(`/presale/requests/${encodeURIComponent(id)}/execution-department`, {
  method: 'PUT', body: JSON.stringify(payload), idempotent: true,
})
export const getAssignments = (id) => request(`/presale/requests/${encodeURIComponent(id)}/assignments`)
export const listPresaleEngineers = (params) => request(`/presale/engineers${toQuery(params)}`)
export const listPresaleExecutionDepartments = () => request('/presale/execution-departments')
export const syncPresaleEngineers = () => request('/presale/engineers/sync', { method: 'POST', idempotent: true })
export const addProgress = (id, payload, idempotencyKey) => request(`/presale/requests/${encodeURIComponent(id)}/progress`, {
  method: 'POST', body: JSON.stringify(payload), idempotent: true, idempotencyKey,
})
export const cancelPresaleRequest = (id, payload, idempotencyKey) => request(`/presale/requests/${encodeURIComponent(id)}/cancel`, {
  method: 'POST', body: JSON.stringify(payload), idempotent: true, idempotencyKey,
})
export const addWorklog = (id, payload, idempotencyKey) => request(`/presale/requests/${encodeURIComponent(id)}/worklogs`, {
  method: 'POST', body: JSON.stringify(payload), idempotent: true, idempotencyKey,
})
export const listWorklogs = (id) => request(`/presale/requests/${encodeURIComponent(id)}/worklogs`)
export const getWorklogDelivery = (id) => request(`/presale/worklogs/${encodeURIComponent(id)}/delivery`)
export const retryWorklogDelivery = (id) => request(`/presale/worklogs/${encodeURIComponent(id)}/retry`, {
  method: 'POST', idempotent: true,
})
export const listPresaleAlerts = (params) => request(`/presale/alerts${toQuery(params)}`)
export const markPresaleAlertRead = (id) => request(`/presale/alerts/${encodeURIComponent(id)}/read`, { method: 'POST' })
export const listPresaleAlertRules = () => request('/presale/alert-rules')
export const updatePresaleAlertRule = (type, payload) => request(`/presale/alert-rules/${encodeURIComponent(type)}`, {
  method: 'PUT', body: JSON.stringify(payload), idempotent: true,
})
export const listPresaleApprovalRules = () => request('/presale/approval-rules')
export const createPresaleApprovalRule = (payload) => request('/presale/approval-rules', {
  method: 'POST', body: JSON.stringify(payload), idempotent: true,
})
export const updatePresaleApprovalRule = (id, payload) => request(`/presale/approval-rules/${encodeURIComponent(id)}`, {
  method: 'PUT', body: JSON.stringify(payload), idempotent: true,
})
export const deletePresaleApprovalRule = (id, version) => request(`/presale/approval-rules/${encodeURIComponent(id)}?version=${encodeURIComponent(version)}`, {
  method: 'DELETE', idempotent: true,
})
export const getPresaleReportSummary = (params) => request(`/presale/reports/summary${toQuery(params)}`)
export const getPresaleReportTrend = (params) => request(`/presale/reports/trend${toQuery(params)}`)
export const getPresaleReportDistribution = (params) => request(`/presale/reports/distribution${toQuery(params)}`)
export const requestPresaleReportExport = (payload) => request('/presale/reports/exports', {
  method: 'POST', body: JSON.stringify(payload), idempotent: true,
})
