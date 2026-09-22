import { createRequest } from '../../shared/api/request.js'
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
/** listInbox 读取站内信收件箱分页列表，可由通知铃铛只请求未读事件。 */
export const listInbox = ({ page = 1, pageSize = 20, unreadOnly = false } = {}) => {
  const query = new URLSearchParams({ page: String(page), page_size: String(pageSize) })
  if (unreadOnly) query.set('unread_only', 'true')
  return request(`/notifications/inbox?${query}`)
}
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

export const listNotificationTemplates = ({ page = 1, pageSize = 50 } = {}) => request(`/notifications/templates?page=${page}&page_size=${pageSize}`).then((result) => ({
  ...result,
  items: (result?.items || []).map((item) => ({
    id: item.id || item.ID,
    code: item.code || item.Code,
    name: item.name || item.Name,
    status: item.status || item.Status,
    current_version: Number(item.current_version || item.CurrentVersion || 0),
    version: Number(item.version || item.Version || 0),
  })),
}))

export const createNotificationTemplate = (payload) => request('/notifications/templates', {
  method: 'POST', body: JSON.stringify(payload),
})

export const createNotificationTemplateVersion = (templateID, payload) => request(`/notifications/templates/${encodeURIComponent(templateID)}/versions`, {
  method: 'POST', body: JSON.stringify(payload),
})

export const changeNotificationTemplateStatus = (templateID, status, version) => request(`/notifications/templates/${encodeURIComponent(templateID)}/status`, {
  method: 'PATCH', body: JSON.stringify({ status, version }),
})

export const listNotificationDeliveries = ({ page = 1, pageSize = 50, status = '' } = {}) => {
  const query = new URLSearchParams({ page: String(page), page_size: String(pageSize) })
  if (status) query.set('status', status)
  return request(`/notifications/deliveries?${query}`).then((result) => ({
    ...result,
    items: (result?.items || []).map((item) => ({
      id: item.id || item.ID,
      recipient_user_id: item.recipient_user_id || item.RecipientUserID,
      status: item.status || item.Status,
      attempt_count: Number(item.attempt_count ?? item.AttemptCount ?? 0),
      next_attempt_at: item.next_attempt_at || item.NextRetryAt || null,
    })),
  }))
}

export const retryFailedNotificationDeliveries = (limit = 20) => request(`/notifications/deliveries/retry-failed?limit=${encodeURIComponent(limit)}`, {
  method: 'POST', body: '{}',
})

export const getNotificationSettings = () => request('/settings/notifications')

export const updateNotificationSettings = ({ inboxEnabled, reminderFrequency, version }) => request('/settings/notifications', {
  method: 'PUT',
  body: JSON.stringify({
    inbox_enabled: Boolean(inboxEnabled),
    // No email provider/worker is deployed. Keep the compatibility field fail-closed.
    email_enabled: false,
    reminder_frequency: reminderFrequency,
    version,
  }),
})
