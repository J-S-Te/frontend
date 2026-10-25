import { onBeforeUnmount, ref } from 'vue'

/**
 * 项目页「业务待办」通知弹层的状态与行为（治理批次 3 第二步）。
 * 收编：未读列表与计数、弹层开关与 5 秒自动收起、已读推进与分区跳转。
 * 仍属父组件的职责（不在此处）：工作区装载节奏、全局 ESC 的其他弹层分支。
 *
 * 注入项与组件内同名标识一一对应：getUnreadCount/listNotificationInbox/markNotificationRead/
 * formatUserError/navigate/showToast；不直接导入 API 模块，保持可独立测试。
 */
export function useProjectNotifications({ getUnreadCount, listNotificationInbox, markNotificationRead, formatUserError, navigate, showToast }) {
const notificationOpen = ref(false)
const notificationItems = ref([])
const notificationCount = ref(0)
const notificationLoading = ref(false)
const notificationError = ref('')
const notificationActionID = ref('')
let notificationAutoCloseTimer = 0

function closeNotifications() {
  window.clearTimeout(notificationAutoCloseTimer)
  notificationAutoCloseTimer = 0
  notificationOpen.value = false
}

async function refreshNotificationCount() {
  try {
    const result = await getUnreadCount()
    notificationCount.value = Number(result?.unread_count || 0)
  } catch {
    // 通知是辅助能力，平台暂不可用时不阻断项目工作区。
    notificationCount.value = 0
  }
}

async function loadUnreadNotifications() {
  notificationLoading.value = true
  notificationError.value = ''
  try {
    const [inbox, unread] = await Promise.all([
      listNotificationInbox({ page: 1, pageSize: 20, unreadOnly: true }),
      getUnreadCount(),
    ])
    // unread_only 由服务端按当前用户和 read_at 过滤；前端再过滤一次用于兼容滚动升级。
    notificationItems.value = (inbox?.items || []).filter((item) => !item.read_at)
    notificationCount.value = Number(unread?.unread_count || notificationItems.value.length)
  } catch (error) {
    notificationItems.value = []
    notificationError.value = formatUserError(error, { fallback: '未读通知加载失败' })
  } finally {
    notificationLoading.value = false
  }
}

function notificationSection(item) {
  const category = String(item?.category || '').toUpperCase()
  if (category === 'DEVIATION_REPORTED') return 'exceptions'
  if (category === 'SPLIT_RULE_MISSING') return 'decomposition'
  if (['TEAM_ASSIGNED', 'EXECUTION_TEAM_ASSIGNED'].includes(category)) return 'inbox'
  return ''
}

async function openNotification(item) {
  const deliveryID = String(item?.delivery_id || '')
  if (!deliveryID || notificationActionID.value) return
  notificationActionID.value = deliveryID
  try {
    await markNotificationRead(deliveryID)
    notificationItems.value = notificationItems.value.filter((entry) => entry.delivery_id !== deliveryID)
    notificationCount.value = Math.max(0, notificationCount.value - 1)
    const section = notificationSection(item)
    closeNotifications()
    if (section) navigate(section)
  } catch (error) {
    showToast(formatUserError(error, { fallback: '通知已读状态保存失败，请重试' }), 'error')
  } finally {
    notificationActionID.value = ''
  }
}

function toggleNotifications() {
  if (notificationOpen.value) {
    closeNotifications()
    return
  }
  notificationOpen.value = true
  loadUnreadNotifications()
  window.clearTimeout(notificationAutoCloseTimer)
  notificationAutoCloseTimer = window.setTimeout(closeNotifications, 5000)
}

  // disposeNotifications 供视图卸载清理自动收起定时器（原 onBeforeUnmount 中的一行职责随状态迁入）。
  function disposeNotifications() {
    window.clearTimeout(notificationAutoCloseTimer)
    notificationAutoCloseTimer = 0
  }

  onBeforeUnmount(() => {
    disposeNotifications()
  })

  return {
    notificationOpen, notificationItems, notificationCount, notificationLoading, notificationError, notificationActionID,
    closeNotifications, refreshNotificationCount, loadUnreadNotifications, openNotification, toggleNotifications, disposeNotifications,
  }
}
