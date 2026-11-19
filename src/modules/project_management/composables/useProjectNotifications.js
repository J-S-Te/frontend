import { useNotificationStream } from '../../shared/composables/notificationStream.js'
import { onBeforeUnmount, ref } from 'vue'
import { projectApprovalTarget } from '../approvalTasks.js'

// 用途：管理项目铃铛的未读通知，以及关联业务目标跳转。
// 参数：由注入的接口读取及标记本人通知，openTarget 执行受控跳转，getContext 提供当前身份。
// 返回值：弹层状态、未读计数和打开通知等操作。
export function useProjectNotifications({ getUnreadCount, listNotificationInbox,
  getNotification, markNotificationRead, formatUserError, openTarget, showToast, getContext = () => '' }) {
const notificationOpen = ref(false)
const notificationItems = ref([])
const notificationCount = ref(0)
const notificationLoading = ref(false)
const notificationError = ref('')
const notificationActionID = ref('')
let disposed = false

// 用途：阻止旧身份或已卸载页面的通知回执继续导航及修改状态。
// 参数：context 为请求开始时的身份与页面上下文。
// 返回值：仍属于当前组件及上下文时返回 true。
function isCurrent(context) {
  return !disposed && context === getContext()
}

// 用途：保留统一项目审批入口的已读失败可处理行为，并隔离迟到回执。
// 参数：detail 为已授权通知详情，context 为读取时的身份与页面上下文。
// 返回值：导航结果；过期回执返回 false，页面打开失败向调用方抛错。
async function openApprovalNotification(detail, context) {
  try {
    if (!detail.read_at) {
      await markNotificationRead(detail.delivery_id)
      if (!isCurrent(context)) return false
      notificationCount.value = Math.max(0, notificationCount.value - 1)
    }
    notificationItems.value = notificationItems.value.filter(
      entry => entry.delivery_id !== detail.delivery_id)
  } catch (error) {
    if (!isCurrent(context)) return false
    const reason = formatUserError(error, { fallback: '请稍后重试。' })
    showToast(`通知已读状态未保存：${reason}，仍可进入审批申请。`, 'warning')
  }
  if (!isCurrent(context)) return false
  const opened = await openTarget(detail)
  if (isCurrent(context) && opened) closeNotifications()
  return opened
}

function closeNotifications() {
  notificationOpen.value = false
}

// 用途：用收件箱的未读总数校准铃铛。
// 参数：无。
// 返回值：异步完成；接口失败时清除当前上下文的徽标。
async function refreshNotificationCount() {
  const context = getContext()
  try {
    const unread = await getUnreadCount()
    if (isCurrent(context)) notificationCount.value = Number(unread?.unread_count ?? 0)
  } catch {
    if (isCurrent(context)) notificationCount.value = 0
  }
}

// 用途：打开铃铛时读取未读通知和未读总数。
// 参数：无。
// 返回值：异步完成；列表出错时在弹层显示错误。
async function loadUnreadNotifications() {
  notificationLoading.value = true
  notificationError.value = ''
  const context = getContext()
  const [inboxResult, unreadResult] = await Promise.allSettled([
    listNotificationInbox({ page: 1, pageSize: 20, unreadOnly: true }),
    getUnreadCount(),
  ])
  if (!isCurrent(context)) return
  if (inboxResult.status === 'fulfilled') {
    notificationItems.value = (inboxResult.value?.items || []).filter((item) => !item.read_at)
  } else {
    notificationItems.value = []
    notificationError.value = formatUserError(inboxResult.reason, { fallback: '未读通知加载失败' })
  }
  notificationCount.value = unreadResult.status === 'fulfilled'
    ? Number(unreadResult.value?.unread_count ?? notificationItems.value.length)
    : notificationItems.value.length
  notificationLoading.value = false
}

// 用途：重读本人通知详情后打开真实目标，失败时保留可重试条目。
// 参数：item 为列表摘要，只取投递编号；导航和已读判断以详情为准。
// 返回值：异步完成；详情读取、跳转或已读失败通过提示反馈。
async function openNotification(item) {
  const deliveryID = String(item?.delivery_id || '')
  if (disposed || !deliveryID || notificationActionID.value) return
  const context = getContext()
  notificationActionID.value = deliveryID
  let opened = false
  try {
    const detail = await getNotification(deliveryID)
    if (!isCurrent(context)) return
    if (!detail || String(detail.delivery_id || '') !== deliveryID) {
      throw new Error('通知详情无法确认，请刷新后重试。')
    }
    notificationItems.value = notificationItems.value.map((entry) =>
      entry.delivery_id === deliveryID ? detail : entry)
    if (projectApprovalTarget(detail, window.location.origin)) {
      await openApprovalNotification(detail, context)
      return
    }
    opened = await openTarget(detail)
    // 跨系统导航会正常卸载项目页；同一主体仍需保存已读，但不再回写旧页面。
    if (context !== getContext()) return
    if (!opened) {
      if (isCurrent(context)) {
        showToast('该通知暂无关联页面，请在个人通知中心查看详情。', 'info')
      }
      return
    }
    if (!detail.read_at) {
      await markNotificationRead(deliveryID)
      if (!isCurrent(context)) return
      notificationCount.value = Math.max(0, notificationCount.value - 1)
    }
    if (!isCurrent(context)) return
    notificationItems.value = notificationItems.value.filter((entry) => entry.delivery_id !== deliveryID)
    closeNotifications()
  } catch (error) {
    if (!isCurrent(context)) return
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
  return loadUnreadNotifications()
}

  // 用途：卸载时阻止旧通知回执发起导航。
  // 参数：无。
  // 返回值：无；后续迟到回执不发布提示或导航。
  function disposeNotifications() {
    disposed = true
  }

  useNotificationStream(() => notificationOpen.value ? loadUnreadNotifications() : refreshNotificationCount())

  onBeforeUnmount(() => {
    disposeNotifications()
  })

  return {
    notificationOpen, notificationItems, notificationCount, notificationLoading, notificationError, notificationActionID,
    closeNotifications, refreshNotificationCount, loadUnreadNotifications, openNotification,
    toggleNotifications, disposeNotifications,
  }
}
