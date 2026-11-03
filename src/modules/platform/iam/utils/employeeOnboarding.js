// 与 userInputValidation 共用同一份实现，避免两处口径分叉。
// 注意：`export { x } from` 只重导出、不建本地绑定，本文件内部调用必须显式 import。
import { defaultAccountValidUntil } from './userInputValidation.js'
export { defaultAccountValidUntil }

export function defaultEmployeeOnboardingForm(now = new Date()) {
  return {
    display_name: '',
    email: '',
    mobile: '',
    status: 'ACTIVE',
    user_validity_mode: 'PERMANENT',
    user_valid_until: defaultAccountValidUntil(now),
    create_account: true,
    account_name: '',
    initial_password: '',
    validity_mode: 'TEMPORARY',
    valid_until: defaultAccountValidUntil(now),
    create_membership: true,
    org_unit_id: '',
    position_id: '',
    membership_type: 'PRIMARY',
    membership_validity_mode: 'LONG_TERM',
    effective_from: '',
    effective_to: '',
    inherit_authorization: true,
  }
}

export function resolveOnboardingExpiresAt(value) {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

export function buildEmployeeOnboardingPayload(form, { account, user } = {}) {
  const createAccount = form?.create_account !== false
  const createMembership = form?.create_membership !== false
  const temporaryAccount = form?.validity_mode !== 'PERMANENT'
  const shortTermMembership = form?.membership_validity_mode === 'SHORT_TERM'

  // 未勾选的账号/任职必须明确发送 null，让原子入职接口区分“本次不创建”与“字段缺失”。
  // 长期账号和任职同样清空期限，避免隐藏表单中的旧日期被意外提交。
  return {
    user: user || {
      display_name: String(form?.display_name || '').trim(),
      email: optionalText(form?.email),
      mobile: optionalText(form?.mobile),
      status: form?.status || 'ACTIVE',
      valid_until: form?.user_validity_mode === 'TEMPORARY' ? resolveOnboardingExpiresAt(form?.user_valid_until) : null,
    },
    account: createAccount
      ? (account || {
        account_name: String(form?.account_name || '').trim(),
        initial_password: String(form?.initial_password || ''),
        valid_until: temporaryAccount ? resolveOnboardingExpiresAt(form?.valid_until) : null,
      })
      : null,
    membership: createMembership
      ? {
        org_unit_id: form?.org_unit_id || '',
        position_id: form?.position_id || '',
        membership_type: form?.membership_type || 'PRIMARY',
        effective_from: shortTermMembership ? (form?.effective_from || null) : null,
        effective_to: shortTermMembership ? (form?.effective_to || null) : null,
        inherit_authorization: form?.inherit_authorization !== false,
      }
      : null,
  }
}

function optionalText(value) {
  const normalized = String(value ?? '').trim()
  return normalized || null
}
