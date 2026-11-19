import { onBeforeUnmount, ref, watch } from 'vue'
import { getUnreadCount } from '../../platform/notifications/api/notifications.js'
import { useNotificationStream } from './notificationStream.js'

// 用途：保持铃铛与当前会话的平台收件箱未读数一致。
// 参数：session 提供当前已授权会话，sourceApplication 可限制来源，inboxVisible 表示收件箱自行同步。
// 返回值：由站内通知更新的响应式未读数。
export function useNotificationBadge({ session, sourceApplication, inboxVisible = () => false }) {
  const unread = ref(0)
  let request = 0

  // 用途：标识已授权的通知会话，拒绝切换身份后的旧回执。
  // 参数：无，身份取自当前业务会话。
  // 返回值：租户和用户组成的标识，当前无权限时为空。
  function identity() {
    const principal = session()
    const user = principal?.user_id || principal?.subject_id || principal?.identity_id
    return user && principal.tenant_id ? JSON.stringify([principal.tenant_id, user]) : ''
  }

  // 用途：收件箱关闭时刷新铃铛；收件箱打开时由其已读与未读查询更新。
  // 参数：无。
  // 返回值：读取完成的 Promise，失效回执不更新铃铛。
  async function refresh() {
    const owner = identity()
    if (!owner || inboxVisible()) return
    const ticket = ++request
    try {
      const result = await getUnreadCount({ sourceApplication })
      if (ticket === request && owner === identity() && !inboxVisible()) {
        unread.value = Number(result?.unread_count ?? 0)
      }
    } catch {
      if (ticket === request && owner === identity() && !inboxVisible()) unread.value = 0
    }
  }

  watch(identity, () => {
    request++
    unread.value = 0
    void refresh()
  }, { immediate: true })
  useNotificationStream(refresh)
  onBeforeUnmount(() => { request++ })
  return unread
}
