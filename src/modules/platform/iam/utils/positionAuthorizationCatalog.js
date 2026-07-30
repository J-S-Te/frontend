import {
  assignableActiveCatalogRoles,
  catalogRoleCode,
} from './applicationAuthorizationCatalog.js'

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
