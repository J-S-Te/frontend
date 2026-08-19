import { createRequest, API_BASE_URL } from '../../shared/api/request.js'
/**
 * NotificationError 与业务错误分类相关的错误类型定义。
 * @class
 * @property {string} name 标准错误类型名。
 */
export class NotificationError extends Error {
  constructor(message, options = {}) {
    super(message)
    this.name = 'NotificationError'
    this.status = options.status || 0
    this.code = options.code || ''
    this.traceId = options.traceId || ''
  }
}
// 站内信依赖 HttpOnly 会话 Cookie；目标用户和租户由服务端会话确定，前端不提交主体 ID。
const request = createRequest({
  ErrorClass: NotificationError,
  networkMessage: '无法连接站内信服务。',
  failureMessage: '站内信请求失败。',
  subsystem: 'platform',
  feature: 'notifications',
})
/** listInbox 读取站内信收件箱分页列表。 */
export const listInbox = ({ page = 1, pageSize = 20 } = {}) => request(`/notifications/inbox?page=${page}&page_size=${pageSize}`)
/**
 * getNotification 拉取单条站内信正文与附件元数据。
 * @param {string|number} deliveryID 消息投递 ID。
 * @returns {Promise<object>} 站内信详情。
 * @throws {Error} 鉴权过期、消息不存在或服务异常时抛出。
 */
export const getNotification = (deliveryID) => request(`/notifications/inbox/${encodeURIComponent(deliveryID)}`)

/** getUnreadCount 统计未读站内信数量，用于页头徽标与提醒角标。 */
export const getUnreadCount = () => request('/notifications/inbox/unread-count')

/** markNotificationRead 标记单条消息为已读。 */
export const markNotificationRead = (deliveryID) => request(`/notifications/inbox/${encodeURIComponent(deliveryID)}/read`, { method: 'POST', body: '{}' })

/** markAllNotificationsRead 一次性标记当前用户全部站内信为已读。 */
export const markAllNotificationsRead = () => request('/notifications/inbox/read-all', { method: 'POST', body: '{}' })
