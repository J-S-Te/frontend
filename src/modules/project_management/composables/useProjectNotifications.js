import { onBeforeUnmount, ref } from 'vue'

// 用途：管理项目通知弹层，并在安全导航成功后推进已读。
// 参数：收件箱与详情接口读取本人通知，openTarget 执行守卫跳转，其余依赖提供提示。
// 返回值：弹层状态、未读计数、加载与打开通知等操作。
export function useProjectNotifications({ getUnreadCount, listNotificationInbox,
  getNotification, markNotificationRead, formatUserError, openTarget, showToast }) {
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

// 用途：重读本人通知详情后打开真实目标，失败时保留可重试条目。
// 参数：item 为列表摘要，只取投递编号；导航和已读判断以详情为准。
// 返回值：异步完成；详情读取、跳转或已读失败通过提示反馈。
async function openNotification(item) {
  const deliveryID = String(item?.delivery_id || '')
  if (!deliveryID || notificationActionID.value) return
  notificationActionID.value = deliveryID
  let opened = false
  try {
    const detail = await getNotification(deliveryID)
    if (!detail || String(detail.delivery_id || '') !== deliveryID) {
      throw new Error('通知详情无法确认，请刷新后重试。')
    }
    notificationItems.value = notificationItems.value.map((entry) =>
      entry.delivery_id === deliveryID ? detail : entry)
    opened = await openTarget(detail)
    if (!opened) {
      showToast('该通知暂无关联页面，请在个人通知中心查看详情。', 'info')
      return
    }
    if (!detail.read_at) {
      await markNotificationRead(deliveryID)
      notificationCount.value = Math.max(0, notificationCount.value - 1)
    }
    notificationItems.value = notificationItems.value.filter((entry) => entry.delivery_id !== deliveryID)
    closeNotifications()
  } catch (error) {
    const fallback = opened ? '已进入关联页面，但已读状态保存失败，请重试。'
      : '通知详情读取或页面打开失败，请重试。'
    showToast(formatUserError(error, { fallback }), 'error')
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
