// positionOrgUnitId normalizes the organization reference returned by current and legacy
// position response shapes. Internal IDs are used for matching only and are not presented alone.
export function positionOrgUnitId(position) {
  return position?.org_unit_id || position?.org_unit?.id || ''
}

// membershipOrganizationOptions adds the number of selectable positions to every organization.
// The original order is retained so the organization hierarchy/order from the backend is stable.
export function membershipOrganizationOptions(organizations = [], positions = []) {
  const positionCounts = new Map()
  positions.forEach((position) => {
    const organizationId = positionOrgUnitId(position)
    if (!organizationId) return
    positionCounts.set(organizationId, (positionCounts.get(organizationId) || 0) + 1)
  })

  return organizations.map((organization) => {
    const organizationId = organization?.org_unit_id || organization?.id || ''
    return {
      ...organization,
      position_count: positionCounts.get(organizationId) || 0,
    }
  })
}

// defaultMembershipOrganizationId selects the first organization that actually owns a position.
// It prevents a newly opened membership form from showing an unexplained empty position selector.
export function defaultMembershipOrganizationId(organizations = [], positions = []) {
  const option = membershipOrganizationOptions(organizations, positions)
    .find((organization) => organization.position_count > 0)
  return option?.org_unit_id || option?.id || ''
}
