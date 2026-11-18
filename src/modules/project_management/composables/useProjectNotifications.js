import { onBeforeUnmount, ref } from 'vue'
import { projectApprovalTarget } from '../approvalTasks.js'

// 用途：管理项目铃铛，统一承载待审批与未读通知，并进入真实业务或审批页面。
// 参数：接口读取本人通知/审批，openTarget 执行通知守卫跳转，openApprovalTask 打开审批详情。
// 返回值：弹层状态、合并计数、加载与打开待办/通知等操作。
export function useProjectNotifications({ getUnreadCount, listNotificationInbox,
  getNotification, markNotificationRead, listApprovalTasks, formatUserError, openTarget,
  openApprovalTask, showToast, getContext = () => '' }) {
const notificationOpen = ref(false)
const notificationItems = ref([])
const approvalItems = ref([])
const unreadCount = ref(0)
const approvalCount = ref(0)
// 徽标为“未读通知 + 待审批”的合并口径：待办办结前，即使提醒已读也继续留在铃铛里。
const notificationCount = ref(0)
const notificationLoading = ref(false)
const notificationError = ref('')
const notificationActionID = ref('')
const approvalLoading = ref(false)
const approvalError = ref('')
const approvalActionID = ref('')
let disposed = false

// 用途：合并两个来源的计数，避免任一列表刷新时把另一来源的角标清零。
// 参数：无。
// 返回值：无；直接更新响应式徽标。
function syncBadge() {
  notificationCount.value = unreadCount.value + approvalCount.value
}

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
      unreadCount.value = Math.max(0, unreadCount.value - 1)
      syncBadge()
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

// 用途：同时刷新未读通知数与待审批总数，任一来源失败不影响另一来源。
// 参数：无。
// 返回值：无；成功来源更新角标，失败来源按零处理但不阻断页面。
async function refreshNotificationCount() {
  const [unreadResult, approvalResult] = await Promise.allSettled([
    getUnreadCount(),
    listApprovalTasks({ page: 1, page_size: 1, view: 'assigned' }),
  ])
  if (disposed) return
  unreadCount.value = unreadResult.status === 'fulfilled'
    ? Number(unreadResult.value?.unread_count || 0) : 0
  approvalCount.value = approvalResult.status === 'fulfilled'
    ? Number(approvalResult.value?.total || 0) : 0
  syncBadge()
}

// 用途：打开铃铛时并行加载未读通知列表与待审批摘要。
// 参数：无。
// 返回值：无；两类数据独立呈现，单侧失败不隐藏另一侧。
async function loadUnreadNotifications() {
  notificationLoading.value = true
  approvalLoading.value = true
  notificationError.value = ''
  approvalError.value = ''
  const context = getContext()
  const [inboxResult, unreadResult, approvalResult] = await Promise.allSettled([
    listNotificationInbox({ page: 1, pageSize: 20, unreadOnly: true }),
    getUnreadCount(),
    listApprovalTasks({ page: 1, page_size: 5, view: 'assigned' }),
  ])
  if (!isCurrent(context)) return
  if (inboxResult.status === 'fulfilled') {
    notificationItems.value = (inboxResult.value?.items || []).filter((item) => !item.read_at)
  } else {
    notificationItems.value = []
    notificationError.value = formatUserError(inboxResult.reason, { fallback: '未读通知加载失败' })
  }
  unreadCount.value = unreadResult.status === 'fulfilled'
    ? Number(unreadResult.value?.unread_count || notificationItems.value.length)
    : notificationItems.value.length
  if (approvalResult.status === 'fulfilled') {
    approvalItems.value = (approvalResult.value?.items || []).slice(0, 5)
    approvalCount.value = Number(approvalResult.value?.total || 0)
  } else {
    approvalItems.value = []
    approvalCount.value = 0
    approvalError.value = formatUserError(approvalResult.reason, { fallback: '待审批加载失败' })
  }
  syncBadge()
  notificationLoading.value = false
  approvalLoading.value = false
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
      unreadCount.value = Math.max(0, unreadCount.value - 1)
      syncBadge()
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

// 用途：从铃铛直接进入某条待审批的精确详情，并同步移除对应的未读提醒。
// 参数：task 为服务端受权返回的待审批摘要。
// 返回值：无；打开成功后收起弹层，失败保留条目并提示。
async function openApprovalItem(task) {
  const requestID = String(task?.id || '')
  if (disposed || !requestID || approvalActionID.value) return
  const context = getContext()
  approvalActionID.value = requestID
  try {
    const matching = notificationItems.value.find((entry) =>
      String(entry.reference_id || '') === requestID)
    if (matching && !matching.read_at) {
      try {
        await markNotificationRead(matching.delivery_id)
        if (!isCurrent(context)) return
        unreadCount.value = Math.max(0, unreadCount.value - 1)
        notificationItems.value = notificationItems.value.filter(
          (entry) => entry.delivery_id !== matching.delivery_id)
        syncBadge()
      } catch (error) {
        if (!isCurrent(context)) return
        showToast(`提醒已读状态未保存：${formatUserError(error, { fallback: '请稍后重试。' })}，仍可进入审批。`, 'warning')
      }
    }
    const opened = await openApprovalTask(task)
    if (isCurrent(context) && opened) closeNotifications()
  } catch (error) {
    if (!isCurrent(context)) return
    showToast(formatUserError(error, { fallback: '审批页面打开失败，请从审批待办重试。' }), 'error')
  } finally {
    approvalActionID.value = ''
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

  onBeforeUnmount(() => {
    disposeNotifications()
  })

  return {
    notificationOpen, notificationItems, notificationCount, notificationLoading, notificationError, notificationActionID,
    approvalItems, approvalCount, approvalLoading, approvalError, approvalActionID,
    closeNotifications, refreshNotificationCount, loadUnreadNotifications, openNotification,
    openApprovalItem, toggleNotifications, disposeNotifications,
  }
}
