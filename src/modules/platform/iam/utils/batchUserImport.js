export const APPLICATION_CODE_PATTERN = /^[a-z][a-z0-9._-]{0,63}$/
export const ROLE_CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/

const MAX_APPLICATION_NAME_LENGTH = 128
const MAX_ROLE_NAME_LENGTH = 128

function textLength(value) {
  return Array.from(value).length
}

export function parseApplicationRoles(value) {
  const roles = []
  const errors = []
  const seen = new Set()
  const tokens = String(value || '').split(/[|；;]/).map((item) => item.trim()).filter(Boolean)
  for (const token of tokens) {
    const fullWidthSeparator = token.indexOf('：')
    const separator = fullWidthSeparator >= 0 ? fullWidthSeparator : token.indexOf(':')
    const application = separator > 0 ? token.slice(0, separator).trim() : ''
    const role = separator > 0 ? token.slice(separator + 1).trim() : ''
    if (!application || !role || textLength(application) > MAX_APPLICATION_NAME_LENGTH || textLength(role) > MAX_ROLE_NAME_LENGTH) {
      errors.push(`应用角色格式错误：${token}`)
      continue
    }

    // 旧模板使用“应用编码:角色编码”，继续兼容；中文等人工可读内容按名称提交，
    // 最终仍由后端在当前租户的同步授权目录中精确解析，前端不猜测稳定 ID。
    const usesLegacyCodes = APPLICATION_CODE_PATTERN.test(application) && ROLE_CODE_PATTERN.test(role)
    const parsed = usesLegacyCodes
      ? { applicationCode: application, roleCode: role }
      : { applicationName: application, roleName: role }
    const key = usesLegacyCodes
      ? `code\u0000${application}\u0000${role}`
      : `name\u0000${application}\u0000${role}`
    if (seen.has(key)) {
      errors.push(`应用角色重复：${application}：${role}`)
      continue
    }
    seen.add(key)
    roles.push(parsed)
  }
  return { roles, errors }
}

/**
 * 按行号精确恢复导入预览的勾选状态。
 *
 * 目录变化后重新解析会按"合法默认勾选"重建所有行；如果在恢复时只做补勾，
 * 用户手动取消勾选的行会被重新勾上并提交。这里对所有行显式赋值：既补勾，
 * 也取消用户已经取消的行（非法行始终不勾选）。
 *
 * @param {Array<{lineNo: number, valid: boolean, selected: boolean}>} rows 重新解析后的行。
 * @param {Iterable<number>} selectedLineNos 重新解析前处于勾选状态的行号。
 * @returns {typeof rows} 同一个数组，便于串接。
 */
export function restoreRowSelection(rows, selectedLineNos) {
  const selected = selectedLineNos instanceof Set ? selectedLineNos : new Set(selectedLineNos || [])
  for (const row of rows) {
    row.selected = Boolean(row.valid) && selected.has(row.lineNo)
  }
  return rows
}
