import { request, requestBlob, toQuery } from './client.js'

export const listCustomers = (params) => request(`/customers${toQuery(params)}`)
export const getCustomer = (id) => request(`/customers/${encodeURIComponent(id)}`)
export const checkCustomerDuplicate = (payload) => request('/customers/duplicate-check', {
  method: 'POST', body: JSON.stringify(payload),
})
export const createCustomer = (payload, idempotencyKey) => request('/customers', {
  method: 'POST', body: JSON.stringify(payload), idempotent: true, idempotencyKey,
})
export const updateCustomer = (id, payload) => request(`/customers/${encodeURIComponent(id)}`, {
  method: 'PUT', body: JSON.stringify(payload), idempotent: true,
})
export const voidCustomer = (id, payload) => request(`/customers/${encodeURIComponent(id)}/void`, {
  method: 'POST', body: JSON.stringify(payload), idempotent: true,
})
export const restoreCustomer = (id, payload) => request(`/customers/${encodeURIComponent(id)}/restore`, {
  method: 'POST', body: JSON.stringify(payload), idempotent: true,
})
export const mergeCustomers = (payload) => request('/customers/merge', {
  method: 'POST', body: JSON.stringify(payload), idempotent: true,
})
export const previewCustomerImport = ({ file, reason }) => {
  const form = new FormData()
  form.set('file', file)
  form.set('reason', reason)
  return request('/customers/imports/preview', { method: 'POST', body: form })
}
export const commitCustomerImport = (jobNo, payload, idempotencyKey) => request(`/customers/imports/${encodeURIComponent(jobNo)}/commit`, {
  method: 'POST', body: JSON.stringify(payload), idempotent: true, idempotencyKey,
})
export const downloadCustomerImportErrors = (jobNo) => requestBlob(`/customers/imports/${encodeURIComponent(jobNo)}/errors`)
export const listCustomerFollowups = (id, params) => request(`/customers/${encodeURIComponent(id)}/followups${toQuery(params)}`)
export const listCustomerContacts = (id) => request(`/customers/${encodeURIComponent(id)}/contacts`)
export const listCustomerStakeholders = (id) => request(`/customers/${encodeURIComponent(id)}/stakeholders`)
export const replaceCustomerStakeholders = (id, payload) => request(`/customers/${encodeURIComponent(id)}/stakeholders`, {
  method: 'PUT', body: JSON.stringify(payload), idempotent: true,
})
export const listCustomerSystems = (id) => request(`/customers/${encodeURIComponent(id)}/systems`)
export const replaceCustomerSystems = (id, payload) => request(`/customers/${encodeURIComponent(id)}/systems`, {
  method: 'PUT', body: JSON.stringify(payload), idempotent: true,
})
export const listCustomerOpportunities = (id, params) => request(`/customers/${encodeURIComponent(id)}/opportunities${toQuery(params)}`)
export const listCustomerProjects = (id, params) => request(`/customers/${encodeURIComponent(id)}/projects${toQuery(params)}`)
export const listCustomerAuditLogs = (id, params) => request(`/customers/${encodeURIComponent(id)}/audit-logs${toQuery(params)}`)
export const requestCustomerExport = (payload) => request('/customer-exports', {
  method: 'POST', body: JSON.stringify(payload), idempotent: true,
})
export const createCustomerFollowup = (id, payload) => request(`/customers/${encodeURIComponent(id)}/followups`, {
  method: 'POST', body: JSON.stringify(payload), idempotent: true,
})
export const getCurrentPortalInvite = (id) => request(`/customers/${encodeURIComponent(id)}/portal-invites/current`)
export const getPortalAccessStatus = (id) => request(`/customers/${encodeURIComponent(id)}/portal-access`)
export const createPortalInvite = (id, idempotencyKey) => request(`/customers/${encodeURIComponent(id)}/portal-invites`, {
  method: 'POST', idempotent: true, idempotencyKey,
})
export const revokePortalInvite = (inviteNo, payload) => request(`/portal-invites/${encodeURIComponent(inviteNo)}/revoke`, {
  method: 'POST', body: JSON.stringify(payload),
})
export const disablePortalAccess = (id, payload, idempotencyKey) => request(`/customers/${encodeURIComponent(id)}/portal-access/disable`, {
  method: 'POST', body: JSON.stringify(payload), idempotent: true, idempotencyKey,
})
