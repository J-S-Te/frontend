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

/** 软删除当前用户全部已读通知；未读和其他用户不受影响。 */
export const deleteReadNotifications = () => request('/notifications/read/delete', { method: 'POST' })
