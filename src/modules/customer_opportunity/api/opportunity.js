import { request, requestAuthorizedFile, toQuery } from './client.js'

export const listOpportunities = (params) => request(`/opportunities${toQuery(params)}`)
export const getOpportunityBoard = (params) => request(`/opportunities/board${toQuery(params)}`)
export const getOpportunity = (id) => request(`/opportunities/${encodeURIComponent(id)}`)
export const createOpportunity = (payload, idempotencyKey) => request('/opportunities', {
  method: 'POST', body: JSON.stringify(payload), idempotent: true, idempotencyKey,
})
export const updateOpportunity = (id, payload) => request(`/opportunities/${encodeURIComponent(id)}`, {
  method: 'PUT', body: JSON.stringify(payload), idempotent: true,
})
export const voidOpportunity = (id, payload) => request(`/opportunities/${encodeURIComponent(id)}/void`, {
  method: 'POST', body: JSON.stringify(payload), idempotent: true,
})
export const restoreOpportunity = (id, payload) => request(`/opportunities/${encodeURIComponent(id)}/restore`, {
  method: 'POST', body: JSON.stringify(payload), idempotent: true,
})
export const changeOpportunityStage = (id, payload) => request(`/opportunities/${encodeURIComponent(id)}/stage-changes`, {
  method: 'POST', body: JSON.stringify(payload), idempotent: true,
})
export const getOpportunityStageHistory = (id, params) => request(`/opportunities/${encodeURIComponent(id)}/stage-history${toQuery(params)}`)
export const listOpportunityFollowups = (id, params) => request(`/opportunities/${encodeURIComponent(id)}/followups${toQuery(params)}`)
export const getOpportunityExternalStatus = (id) => request(`/opportunities/${encodeURIComponent(id)}/external-status`)
export const createQuotationLaunch = (id) => request(`/opportunities/${encodeURIComponent(id)}/launch/quotation`, { method: 'POST' })
export const createBidLaunch = (id) => request(`/opportunities/${encodeURIComponent(id)}/launch/bid`, { method: 'POST' })
export const createOpportunityFollowup = (id, payload) => request(`/opportunities/${encodeURIComponent(id)}/followups`, {
  method: 'POST', body: JSON.stringify(payload), idempotent: true,
})
export const completeOpportunityTerminalTodo = (id, payload) => request(`/opportunities/${encodeURIComponent(id)}/terminal-todo`, {
  method: 'PUT', body: JSON.stringify(payload), idempotent: true,
})
export const changeOpportunityOwner = (id, payload) => request(`/opportunities/${encodeURIComponent(id)}/owner`, {
  method: 'PUT', body: JSON.stringify(payload), idempotent: true,
})
export const getOpportunityMembers = (id, params = {}) => request(`/opportunities/${encodeURIComponent(id)}/members${toQuery(params)}`)
export const listOpportunityMemberTerms = (id, params = {}) => request(`/opportunities/${encodeURIComponent(id)}/member-terms${toQuery(params)}`)
export const listOpportunityPresaleRequests = (id, params = {}) => request(`/opportunities/${encodeURIComponent(id)}/presale-requests${toQuery(params)}`)
export const replaceOpportunityMembers = (id, payload) => request(`/opportunities/${encodeURIComponent(id)}/members`, {
  method: 'PUT', body: JSON.stringify(payload), idempotent: true,
})
export const transferOpportunityToContract = (id, payload, idempotencyKey) => request(`/opportunities/${encodeURIComponent(id)}/contract-transfer`, {
  method: 'POST', body: JSON.stringify(payload), idempotent: true, idempotencyKey,
})

export const getOpportunityAttachmentCapabilities = (id) => request(`/opportunities/${encodeURIComponent(id)}/attachment-capabilities`)
export const listOpportunityAttachments = (id) => request(`/opportunities/${encodeURIComponent(id)}/attachments`)
export const createOpportunityAttachmentUpload = (id, payload, idempotencyKey) => request(`/opportunities/${encodeURIComponent(id)}/attachments`, {
  method: 'POST', body: JSON.stringify(payload), idempotent: true, idempotencyKey,
})
export const completeOpportunityAttachmentUpload = (id, attachmentID, payload, idempotencyKey) => request(`/opportunities/${encodeURIComponent(id)}/attachments/${encodeURIComponent(attachmentID)}/complete`, {
  method: 'POST', body: JSON.stringify(payload), idempotent: true, idempotencyKey,
})
const opportunityAttachmentMediaTypes = new Set(['application/pdf', 'image/png', 'image/jpeg', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'])
export const downloadOpportunityAttachment = (id, attachmentID, fallbackFilename) => requestAuthorizedFile(`/opportunities/${encodeURIComponent(id)}/attachments/${encodeURIComponent(attachmentID)}/content`, opportunityAttachmentMediaTypes, fallbackFilename)

export const listOpportunityStageAlerts = (params = {}) => request(`/opportunity-stage-alerts${toQuery(params)}`)
export const markOpportunityStageAlertRead = (id) => request(`/opportunity-stage-alerts/${encodeURIComponent(id)}/read`, {
  method: 'POST',
})
export const listOpportunityStageAlertRules = () => request('/opportunity-stage-alert-rules')
export const updateOpportunityStageAlertRule = (stage, payload) => request(`/opportunity-stage-alert-rules/${encodeURIComponent(stage)}`, {
  method: 'PUT', body: JSON.stringify(payload),
})
