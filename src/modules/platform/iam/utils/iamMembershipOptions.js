// 归一化新旧岗位响应中的组织引用；内部 ID 只用于匹配，不能单独作为用户可见名称。
export function positionOrgUnitId(position) {
  return position?.org_unit_id || position?.org_unit?.id || ''
}

// 为每个组织补充可选岗位数量，并保留原顺序以维持后端给出的组织层级/排序。
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

// 默认选择第一个确实拥有岗位的组织，避免新打开任职表单时出现原因不明的空岗位选择器。
export function defaultMembershipOrganizationId(organizations = [], positions = []) {
  const option = membershipOrganizationOptions(organizations, positions)
    .find((organization) => organization.position_count > 0)
  return option?.org_unit_id || option?.id || ''
}
