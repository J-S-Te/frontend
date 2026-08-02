/**
 * 将逐应用查询到的用户有效授权合并成跨应用只读总览。
 *
 * 该函数不重新计算角色或权限，只补充应用名称并保留后端返回的授权来源。
 * 最终是否授权、是否冲突仍以每个应用访问接口的服务端计算结果为准。
 */
export function buildUserAuthorizationOverview(entries = []) {
  const roles = []
  const conflicts = []

  for (const entry of entries) {
    const application = entry?.application || {}
    const access = entry?.access || null
    if (!access) continue

    const applicationCode = String(access.application_code || application.code || '').trim()
    const applicationName = String(application.name || application.display_name || applicationCode || '未命名应用').trim()

    // CONFLICT is fail-closed: the server intentionally returns no effective
    // permission union. Preserve source roles for diagnosis, but never count
    // them as effective roles in the cross-application summary.
    const authorizationState = String(access.authorization_state || '').trim().toUpperCase()
    const effectiveRoles = authorizationState === 'CONFLICT' ? [] : (Array.isArray(access.roles) ? access.roles : [])
    const sourceRoles = Array.isArray(access.roles) ? access.roles : []
    for (const role of sourceRoles) {
      roles.push({
        ...role,
        application_code: applicationCode,
        application_name: applicationName,
        effective: authorizationState !== 'CONFLICT',
      })
    }

    for (const conflict of Array.isArray(access.conflicts) ? access.conflicts : []) {
      const text = String(conflict || '').trim()
      if (!text) continue
      conflicts.push(`${applicationName}${applicationCode && applicationName !== applicationCode ? `（${applicationCode}）` : ''}：${text}`)
    }
  }

  return {
    roles,
    effective_roles: roles.filter((role) => role.effective !== false),
    conflicts: [...new Set(conflicts)],
  }
}
