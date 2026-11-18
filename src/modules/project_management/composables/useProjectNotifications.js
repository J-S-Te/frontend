import { onBeforeUnmount, ref } from 'vue'
import { projectApprovalTarget } from '../approvalTasks.js'

// 用途：加载项目通知并把受控审批提醒直达对应申请。
// 参数：接口、错误格式化、导航、提示和身份上下文读取方法由父视图提供。
// 返回值：通知状态与读取、关闭、打开和清理方法。
export function useProjectNotifications({ getUnreadCount, listNotificationInbox, markNotificationRead,
  formatUserError, navigate, navigateTarget, showToast, getContext = () => '' }) {
const notificationOpen = ref(false)
const notificationItems = ref([])
const notificationCount = ref(0)
const notificationLoading = ref(false)
const notificationError = ref('')
const notificationActionID = ref('')
let notificationAutoCloseTimer = 0
let disposed = false

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

// 用途：标记通知已读并打开业务；已读失败仍允许进入受控审批申请。
// 参数：item 为当前账号收件箱中的通知。
// 返回值：无；已读和导航错误分别反馈，不执行任何审批写入。
async function openNotification(item) {
  const deliveryID = String(item?.delivery_id || '')
  if (disposed || !deliveryID || notificationActionID.value) return
  const context = getContext()
  const target = projectApprovalTarget(item, window.location.origin)
  notificationActionID.value = deliveryID
  try {
    await markNotificationRead(deliveryID)
    if (disposed || context !== getContext()) return
    notificationItems.value = notificationItems.value.filter((entry) => entry.delivery_id !== deliveryID)
    notificationCount.value = Math.max(0, notificationCount.value - 1)
  } catch (error) {
    if (disposed || context !== getContext()) return
    const reason = formatUserError(error, { fallback: '请稍后重试。' })
    showToast(`通知已读状态未保存：${reason}`, target ? 'warning' : 'error')
    if (!target) return
  } finally {
    notificationActionID.value = ''
  }
  const section = notificationSection(item)
  closeNotifications()
  try {
    if (target) await navigateTarget(target)
    else if (section) await navigate(section)
  } catch (error) {
    showToast(formatUserError(error, { fallback: '审批页面打开失败，请从审批待办重试' }), 'error')
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

  // 用途：卸载时清理自动收起定时器，并阻止旧通知回执发起导航。
  // 参数：无。
  // 返回值：无；后续迟到回执不发布提示或导航。
  function disposeNotifications() {
    disposed = true
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
