/**
 * 应用授权目录由应用方维护，在平台控制台中只读；统一在此归一化，确保所有 IAM 入口
 * 都执行相同的 ACTIVE 且可分配规则。
 */
export function catalogRoles(catalog) {
  return Array.isArray(catalog?.roles) ? catalog.roles : []
}

export function catalogRoleCode(role) {
  return String(role?.code || role?.role_code || '').trim()
}

export function catalogRoleStatus(role) {
  return String(role?.status || role?.role_status || '').trim().toUpperCase()
}

export function isAssignableActiveCatalogRole(role) {
  if (catalogRoleStatus(role) !== 'ACTIVE') return false
  // 兼容尚无 assignable 字段的旧目录：缺失表示应用未限制分配；显式 false 始终禁止控制台提供该角色。
  return role?.assignable !== false && role?.is_assignable !== false
}

export function assignableActiveCatalogRoles(catalog) {
  return catalogRoles(catalog).filter(isAssignableActiveCatalogRole)
}

export function catalogVersion(catalog) {
  return catalog?.catalog_version || catalog?.version || catalog?.metadata?.catalog_version || '—'
}

export function catalogSyncState(catalog) {
  const value = catalog?.sync_status
    || catalog?.catalog_sync_status
    || catalog?.metadata?.sync_status
    || catalog?.metadata?.catalog_sync_status
    || catalog?.status
  const state = String(value || '').trim().toUpperCase()
  return state || (catalog ? 'SYNCED' : 'UNKNOWN')
}

export function isCatalogSynchronized(catalog) {
  return ['ACTIVE', 'SYNCED', 'SUCCESS', 'HEALTHY'].includes(catalogSyncState(catalog))
}

export function catalogSyncText(catalog) {
  const state = catalogSyncState(catalog)
  if (['ACTIVE', 'SYNCED', 'SUCCESS', 'HEALTHY'].includes(state)) return '已同步'
  if (['PENDING', 'SYNCING', 'PROCESSING'].includes(state)) return '同步中'
  if (['STALE', 'EXPIRED'].includes(state)) return '已过期'
  if (['FAILED', 'ERROR', 'REJECTED'].includes(state)) return '同步失败'
  if (['NOT_SYNCED', 'UNKNOWN'].includes(state)) return '未同步'
  return '状态未知'
}

export function catalogLastSyncedAt(catalog) {
  return catalog?.last_synced_at
    || catalog?.synced_at
    || catalog?.received_at
    || catalog?.updated_at
    || catalog?.metadata?.last_synced_at
    || catalog?.metadata?.synced_at
    || ''
}

export function catalogRolePermissions(role) {
  const permissions = role?.permissions || role?.permission_codes || role?.permissionCodes || []
  return Array.isArray(permissions) ? permissions : []
}
