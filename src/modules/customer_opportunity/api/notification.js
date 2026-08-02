import { request, toQuery } from './client.js'

/**
 * Reads only the authenticated user's CRM inbox. The backend intentionally
 * ignores opportunity SELF/ORG/ALL scope for this endpoint.
 */
export const listNotifications = (params = {}) => request(`/notifications${toQuery(params)}`)

export const getNotificationUnreadCount = () => request('/notifications/unread-count')

export const markNotificationRead = (id) => request(`/notifications/${encodeURIComponent(id)}/read`, {
  method: 'POST',
})
