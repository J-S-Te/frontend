import { computed, ref } from 'vue'
import { IamError, resetAccountPassword } from '@/modules/platform/iam/api/iam'
import { formatUserError } from '@/modules/shared/utils/userError.js'
import { scheduleSensitiveClipboardClear } from '@/modules/shared/utils/clipboard'

/**
 * 登录账号密码重置域（治理批次 4 IAM，自 IamSettingsModule.vue 逐字迁移）。
 * 收编：重置弹窗、一次性临时密码展示/复制/自动清除、失败补偿与刷新。
 *
 * 注入项与组件内同名标识一一对应：detail/detailAuthorizationRequestSeq/isUserAuthorizationSubject/
 * loadAccounts/loadAuthorizationOverview/copyText/emitToast；不直接依赖组件状态。
 */
export function useIamPasswordReset({ detail, detailAuthorizationRequestSeq, isUserAuthorizationSubject, loadAccounts, loadAuthorizationOverview, copyText, emitToast }) {
  const resettingPassword = ref(false)
  const temporaryPassword = ref(null)
  const passwordResetDialog = ref(null)

const selectedPasswordResetAccount = computed(() => {
  const dialog = passwordResetDialog.value
  if (!dialog) return null
  return dialog.accounts.find((account) => account.account_id === dialog.accountId) || null
})

// 密码重置始终以用户详情中选定的 account_id 为键；多账号用户必须逐个明确操作，
// 不能仅凭姓名或 user_id 猜测目标登录账号。
function openPasswordResetForAccount(account, userName = '') {
  if (!account?.account_id) {
    emitToast('未找到可重置密码的登录账号。')
    return
  }
  passwordResetDialog.value = { accountId: account.account_id, accounts: [account], userName, initialize: account.password_initialized === false }
}

function openPasswordResetFromUserDetail(account) {
  if (!isUserAuthorizationSubject.value) return
  openPasswordResetForAccount(account, detail.value?.item?.display_name || detail.value?.item?.name || '')
}

function closePasswordResetDialog() {
  if (resettingPassword.value) return
  passwordResetDialog.value = null
}

async function confirmPasswordReset() {
  const account = selectedPasswordResetAccount.value
  if (!account?.account_id || resettingPassword.value) return
  const initializing = account.password_initialized === false
  let passwordResetConfirmed = false

  resettingPassword.value = true
  try {
    const result = await resetAccountPassword({ accountId: account.account_id, version: account.version || 0 })
    if (!result?.temporary_password) {
      throw new IamError('后端未返回一次性临时密码，无法安全完成密码重置。')
    }
    passwordResetDialog.value = null
    temporaryPassword.value = {
      accountId: result.account_id || account.account_id,
      accountName: account.account_name || account.account_id,
      value: result.temporary_password,
      initialized: initializing,
    }
    passwordResetConfirmed = true
    const userId = detail.value?.kind === 'user' ? detail.value.item?.user_id : ''
    await Promise.all([
      loadAccounts(),
      userId ? loadAuthorizationOverview(userId, detailAuthorizationRequestSeq.value) : Promise.resolve(),
    ])
    emitToast(initializing ? '登录密码已初始化，请立即复制并通过安全渠道交付。' : '密码已重置，请立即复制临时密码并通过安全渠道交付。')
  } catch (error) {
    const reason = formatUserError(error, { fallback: '请刷新账号列表核对状态。' }).slice(0, 180)
    emitToast(passwordResetConfirmed
      ? `密码已${initializing ? '初始化' : '重置'}，但账号列表未刷新。${reason}请先安全交付当前一次性临时密码，勿重复重置。`
      : formatUserError(error, { fallback: '密码重置失败。' }))
  } finally {
    resettingPassword.value = false
  }
}

async function copyTemporaryPassword() {
  const value = temporaryPassword.value?.value
  if (!value) return
  const copied = await copyText(value, { success: '临时密码已复制，请立即通过安全渠道交付。' })
  if (!copied) return
  // SEC-X10：临时密码是敏感明文，复制成功后安排延时自动清除剪贴板；
  // 非安全上下文（HTTP 回退复制）无法在复制之后回写剪贴板，降级为手动覆盖提示。
  const { supported } = scheduleSensitiveClipboardClear(value)
  if (!supported) {
    emitToast('当前浏览器环境无法自动清除剪贴板，交付后请手动覆盖剪贴板内容。')
  }
}

// 临时密码揭示状态：默认遮罩，避免屏幕共享/截屏/拼写补全等渠道意外泄露。
const temporaryPasswordVisible = ref(false)
function revealTemporaryPassword() {
  if (!temporaryPassword.value?.value) return
  temporaryPasswordVisible.value = true
}
function hideTemporaryPassword() {
  temporaryPasswordVisible.value = false
}

// 关闭弹窗会清除浏览器内存中的明文；此页面无法再次查看，未复制时只能由管理员重新发起重置。
function closeTemporaryPassword() {
  temporaryPassword.value = null
  temporaryPasswordVisible.value = false
}

  return {
    passwordResetDialog, temporaryPassword, resettingPassword, temporaryPasswordVisible,
    selectedPasswordResetAccount,
    openPasswordResetForAccount, openPasswordResetFromUserDetail, closePasswordResetDialog,
    confirmPasswordReset, copyTemporaryPassword, revealTemporaryPassword, hideTemporaryPassword,
    closeTemporaryPassword,
  }
}
