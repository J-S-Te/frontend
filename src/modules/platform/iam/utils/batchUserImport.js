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
