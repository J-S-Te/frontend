import { request, toQuery } from './client.js'

/**
 * 仅读取已认证用户的 CRM 收件箱。后端对此端点有意
 * 忽略商机的 SELF/ORG/ALL 数据范围。
 */
export const listNotifications = (params = {}) => request(`/notifications${toQuery(params)}`)

export const getNotificationUnreadCount = () => request('/notifications/unread-count')

export const markNotificationRead = (id) => request(`/notifications/${encodeURIComponent(id)}/read`, {
  method: 'POST',
})
