import { request, toQuery } from './client.js'

const customerPath = (id, suffix = '') => `/customers/${encodeURIComponent(id)}/credit${suffix}`

export const getCustomerCredit = (id) => request(customerPath(id))
export const getCustomerCreditRuleSettings = () => request('/credit/rule-settings')
export const updateCustomerCreditRuleSettings = (payload) => request('/credit/rule-settings', { method: 'PUT', body: JSON.stringify(payload) })
export const listCustomerCreditHistory = (id, params) => request(`${customerPath(id, '/history')}${toQuery(params)}`)
export const listCustomerCreditPaymentRecords = (id, params = {}) => request(`${customerPath(id, '/payment-records')}${toQuery(params)}`)
export const listCustomerCreditPayments = listCustomerCreditPaymentRecords
export const createCustomerCreditApplication = (id, payload, idempotencyKey) => request(customerPath(id, '/applications'), {
  method: 'POST', body: JSON.stringify(payload), idempotent: true, idempotencyKey,
})
export const withdrawCustomerCreditApplication = (id, applicationId, payload = {}, idempotencyKey) => request(`${customerPath(id, '/applications')}/${encodeURIComponent(applicationId)}/withdraw`, {
  method: 'POST', body: JSON.stringify(payload), idempotent: true, idempotencyKey,
})
export const listCustomerCreditApplications = (params) => request(`/credit/applications${toQuery(params)}`)
export const listPendingCustomerCreditApplications = (params) => request(`/credit/applications/pending${toQuery(params)}`)
export const approveCustomerCreditApplication = (applicationId, payload, idempotencyKey) => request(`/credit/applications/${encodeURIComponent(applicationId)}/approve`, {
  method: 'POST', body: JSON.stringify(payload), idempotent: true, idempotencyKey,
})
export const rejectCustomerCreditApplication = (applicationId, payload, idempotencyKey) => request(`/credit/applications/${encodeURIComponent(applicationId)}/reject`, {
  method: 'POST', body: JSON.stringify(payload), idempotent: true, idempotencyKey,
})
