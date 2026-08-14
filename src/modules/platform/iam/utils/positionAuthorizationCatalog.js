import {
  assignableActiveCatalogRoles,
  catalogRoleCode,
} from './applicationAuthorizationCatalog.js'

/**
 * 将岗位授权专用接口归一化为选择器使用的目录结构。该接口已建立安全边界：平台角色
 * 读取平台自身的权威记录；子系统角色只有在应用目录成功同步后才会返回。旧目录缺少
 * assignable 字段时沿用兼容语义，但后续选择器仍须与平台侧稳定角色 ID 取交集。
 */
export function positionAuthorizationTargetCatalog(target) {
  const roles = (Array.isArray(target?.roles) ? target.roles : []).map((role) => ({
    ...role,
    status: role?.status || role?.role_status || 'ACTIVE',
    assignable: role?.assignable !== false && role?.is_assignable !== false,
  }))
  const applicationCode = String(target?.application_code || target?.code || '').trim()
  const syncStatus = String(target?.catalog_sync_status || target?.sync_status || '').trim()

  return {
    application_id: target?.application_id || target?.id || '',
    application_code: applicationCode,
    catalog_version: target?.catalog_version || (applicationCode === 'platform' ? 'built-in' : '—'),
    sync_status: syncStatus || (roles.length ? 'SYNCED' : 'NOT_SYNCED'),
    policy: { max_effective_roles: Number(target?.max_effective_roles) || 0 },
    roles,
  }
}

/**
 * 岗位模板接口提供平台侧稳定 role_id，应用目录提供应用方声明的实时角色状态。只有
 * 两者按角色编码的交集同时存在，才能既提交平台可识别的 ID，又保证角色当前仍为 ACTIVE
 * 且可分配；任一侧的孤立记录都不能出现在模板选择器中。
 */
export function positionTemplateRoleChoices(targetRoles, catalog) {
  const rolesByCode = new Map(
    (Array.isArray(targetRoles) ? targetRoles : [])
      .map((role) => [catalogRoleCode(role), role])
      .filter(([code]) => Boolean(code)),
  )

  return assignableActiveCatalogRoles(catalog)
    .map((catalogRole) => {
      const targetRole = rolesByCode.get(catalogRoleCode(catalogRole))
      const roleId = targetRole?.role_id || targetRole?.id || ''
      if (!roleId) return null
      return {
        ...catalogRole,
        id: roleId,
        role_id: roleId,
        role_code: catalogRoleCode(catalogRole),
      }
    })
    .filter(Boolean)
}
