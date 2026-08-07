function value(item, ...keys) {
  return keys.map((key) => item?.[key]).find(Boolean) || ''
}

function normalizedRole(applicationId, roleId, scopeType = 'TENANT', scopeId = '') {
  return {
    application_id: applicationId,
    role_id: roleId,
    scope_type: scopeType || 'TENANT',
    scope_id: scopeType === 'ENVIRONMENT' ? String(scopeId || '').trim() : '',
  }
}

/**
 * 将创建器中的“基础平台角色 + 多个子系统角色”编排展开为现有模板 API 的 roles。
 * 平台角色本身也会作为一个普通模板条目提交，因此不会改变旧模板的授权物化逻辑。
 */
export function expandPositionAuthorizationRoleGroups(groups) {
  const roles = []
  for (const group of Array.isArray(groups) ? groups : []) {
    const platformApplicationId = value(group, 'platform_application_id')
    const platformRoleId = value(group, 'platform_role_id')
    if (platformApplicationId && platformRoleId) {
      roles.push(normalizedRole(platformApplicationId, platformRoleId, group.platform_scope_type, group.platform_scope_id))
    }
    for (const mapping of Array.isArray(group?.subsystem_roles) ? group.subsystem_roles : []) {
      const applicationId = value(mapping, 'application_id')
      const roleId = value(mapping, 'role_id')
      if (applicationId && roleId) roles.push(normalizedRole(applicationId, roleId, mapping.scope_type, mapping.scope_id))
    }
  }
  return roles
}

export function expandPositionAuthorizationRoleMappings(mapping) {
  return expandPositionAuthorizationRoleGroups([mapping])
}
