import { ref } from 'vue'
import { updateUser, updateAccountStatus } from '@/modules/platform/iam/api/iam'
import { defaultAccountValidUntil, resolveExpiresAt } from '@/modules/platform/iam/utils/userInputValidation'
import { formatUserError } from '@/modules/shared/utils/userError.js'

/**
 * 用户/登录账号有效期编辑器（治理批次 4 IAM，自 IamSettingsModule.vue 逐字迁移）。
 * 注入项与组件内同名标识一一对应：detail/toDateTimeLocal/emitToast/formatUserError。
 */
export function useIamValidityEditor({ detail, toDateTimeLocal, emitToast, formatUserError }) {
  const validityEditor = ref(null)
  const validitySaving = ref(false)

function openValidityEditor(kind, item) {
  const validUntil = item?.valid_until ? toDateTimeLocal(item.valid_until) : defaultAccountValidUntil()
  validityEditor.value = {
    kind,
    item,
    mode: item?.valid_until ? 'TEMPORARY' : 'PERMANENT',
    valid_until: validUntil,
  }
}

function closeValidityEditor() {
  if (!validitySaving.value) validityEditor.value = null
}

async function saveValidity() {
  const draft = validityEditor.value
  if (!draft || validitySaving.value) return
  const validUntil = draft.mode === 'PERMANENT' ? null : resolveExpiresAt(draft.valid_until)
  if (draft.mode !== 'PERMANENT' && (!validUntil || new Date(validUntil).getTime() <= Date.now())) {
    emitToast('有效截止时间必须晚于当前时间。')
    return
  }
  const item = draft.item
  const version = Number(item?.version)
  if (!Number.isInteger(version) || version < 1) {
    emitToast('版本信息无效，请刷新后重试。')
    return
  }
  validitySaving.value = true
  try {
    let updated
    if (draft.kind === 'user') {
      updated = await updateUser({
        userId: item.user_id,
        displayName: item.display_name,
        employeeNo: item.employee_no || '',
        email: item.email || '',
        mobile: undefined,
        status: item.status,
        version,
        validUntil,
        updateValidity: true,
      })
    } else {
      updated = await updateAccountStatus({
        accountId: item.account_id,
        status: item.status,
        version,
        validUntil,
        updateValidity: true,
      })
    }
    Object.assign(item, updated)
    if (detail.value?.item === item) detail.value.item = item
    emitToast(`${draft.kind === 'user' ? '用户' : '账号'}有效期已更新。`)
    validityEditor.value = null
  } catch (error) {
    emitToast(formatUserError(error, { fallback: '有效期更新失败。' }))
  } finally {
    validitySaving.value = false
  }
}

  return { validityEditor, validitySaving, openValidityEditor, closeValidityEditor, saveValidity }
}
