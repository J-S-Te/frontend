import { ref } from 'vue'
import { deleteUser } from '@/modules/platform/iam/api/iam'
import { formatUserError } from '@/modules/shared/utils/userError.js'

/**
 * 用户删除与离职引导域（治理批次 4 IAM，自 IamSettingsModule.vue 逐字迁移）。
 * 离职不走旁路：只发 personnel-change 意图，由人员异动中心审批链路执行。
 * 注入项与组件内同名标识一一对应：detail/closeDetail/loadUsers/loadAccounts/loadMemberships/
 * openConfirm/emitToast/formatUserError/emit。
 */
export function useIamUserDeletion({ detail, closeDetail, loadUsers, loadAccounts, loadMemberships, openConfirm, emitToast, formatUserError, emit }) {
  const userDeletionDialog = ref(null)
  const deletingUser = ref(false)

function openUserDeletionDialog(user) {
  if (!user?.user_id) {
    emitToast('未找到要删除的用户。')
    return
  }
  userDeletionDialog.value = user
}

function closeUserDeletionDialog() {
  if (deletingUser.value) return
  userDeletionDialog.value = null
}

async function confirmUserDeletion() {
  const user = userDeletionDialog.value
  if (!user?.user_id || deletingUser.value) return

  deletingUser.value = true
  try {
    await deleteUser({ userId: user.user_id, version: user.version || 0 })
    userDeletionDialog.value = null
    if (detail.value?.kind === 'user' && detail.value.item?.user_id === user.user_id) closeDetail()
    await Promise.all([loadUsers(), loadAccounts(), loadMemberships()])
    emitToast(`用户 ${user.display_name || user.user_id} 已删除，关联登录账号和任职关系已同步删除。`)
  } catch (error) {
    emitToast(formatUserError(error, { fallback: '删除用户失败。' }))
  } finally {
    deletingUser.value = false
  }
}

// 离职不能走「直接 PATCH 用户为 DISABLED」的旁路：
// 该路径会立刻停用账号、凭据、任职和会话，绕过异动审批与责任交接，而且请求携带的
// mobile:"" 会把手机号密文与摘要写成 NULL。这里改为把员工带到人员异动中心发起离职申请，
// 由既有的审批与交接链路执行；查询与目录刷新沿用异动中心自己的逻辑。
function terminateEmployee(user) {
  if (!user?.user_id || (user.status || '').toUpperCase() !== 'ACTIVE') return
  openConfirm({
    title: '离职必须通过人员异动中心办理',
    description: `离职会停用 ${user.display_name || user.user_id} 的账号、凭据、任职和登录会话，必须经过异动审批与责任交接。确认后将前往「人员异动中心」为该员工创建离职申请。`,
    confirmText: '前往人员异动中心',
    danger: true,
    onConfirm: async () => {
      emit('personnel-change', { user_id: user.user_id, display_name: user.display_name })
      return true
    },
  })
}

  return { userDeletionDialog, deletingUser, openUserDeletionDialog, closeUserDeletionDialog, confirmUserDeletion, terminateEmployee }
}
