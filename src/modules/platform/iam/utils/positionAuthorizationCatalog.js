import {
  assignableActiveCatalogRoles,
  catalogRoleCode,
} from './applicationAuthorizationCatalog.js'

/**
 * Convert the task-specific position-authorization target response into the
 * catalog shape used by the selector. The endpoint already applies the
 * security boundary: platform-native roles are read from the platform itself,
 * while subsystem roles are returned only for a successfully synchronized
 * application catalog.
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
    roles,
  }
}

/**
 * The position-template API exposes stable platform role IDs; the application
 * catalog exposes the application-owned role state. Only the intersection is
 * safe to offer in a template role selector.
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
