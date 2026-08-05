import { createRequest, API_BASE_URL } from '../../shared/api/request.js'
export class NotificationError extends Error { constructor(message, options = {}) { super(message); this.name = 'NotificationError'; this.status = options.status || 0; this.code = options.code || '' } }
// 站内信依赖 HttpOnly 会话 Cookie；目标用户和租户由服务端会话确定，前端不提交主体 ID。
const request = createRequest({ ErrorClass: NotificationError, networkMessage: '无法连接站内信服务。', failureMessage: '站内信请求失败。' })
export const listInbox = ({ page = 1, pageSize = 20 } = {}) => request(`/notifications/inbox?page=${page}&page_size=${pageSize}`)
export const getNotification = (deliveryID) => request(`/notifications/inbox/${encodeURIComponent(deliveryID)}`)
export const getUnreadCount = () => request('/notifications/inbox/unread-count')
export const markNotificationRead = (deliveryID) => request(`/notifications/inbox/${encodeURIComponent(deliveryID)}/read`, { method: 'POST', body: '{}' })
export const markAllNotificationsRead = () => request('/notifications/inbox/read-all', { method: 'POST', body: '{}' })
