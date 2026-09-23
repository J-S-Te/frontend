// C-ii（task-62）：寄送表单收件人手机号校验，与后端契约逐字对齐：
//   - contract_management/internal/transport/httpapi/router.go saveSigningShipment
//     要求 recipient_phone TrimSpace 后非空（否则 422 CON_VALIDATION_ERROR）；
//   - application/service.go SaveSigningShipment 要求 rune 数 ≤ MaxSigningPhonePlaintextLen(20)。
// 前端必须在提交前自己拦住这两类错误；同时格式校验只接受数字（允许 +、空格、- 分隔），
// 读接口返回的掩码（如 138****5678，task-43）含 * 必然被拒——不会把掩码当新号码写回后端。
export const RECIPIENT_PHONE_MAX_LENGTH = 20

/**
 * 校验收件人手机号。
 * @param {unknown} value 表单中的手机号。
 * @returns {string} 空串表示通过，否则返回面向操作员的中文错误文案。
 */
export function validateRecipientPhoneNumber(value) {
  const phone = String(value ?? '').trim()
  if (!phone) return '请填写收件人手机号。'
  if ([...phone].length > RECIPIENT_PHONE_MAX_LENGTH) {
    return `收件人手机号不能超过 ${RECIPIENT_PHONE_MAX_LENGTH} 个字符。`
  }
  const compact = phone.replace(/[\s-]/g, '')
  if (!/^\+?\d{6,20}$/.test(compact)) {
    return '请输入有效的手机号：仅数字，可含 +、空格或 - 分隔；掩码号码不能直接提交。'
  }
  return ''
}
