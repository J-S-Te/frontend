/**
 * 将岗位授权专用接口归一化为选择器使用的目录结构。该接口已建立安全边界：平台角色
 * 读取平台自身的权威记录；子系统角色只有在应用目录成功同步后才会返回。旧目录缺少
 * assignable 字段时沿用兼容语义。
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
