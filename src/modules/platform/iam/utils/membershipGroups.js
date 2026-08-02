import { buildOrganizationTree, flattenOrganizationTree } from './organizationTree.js'

const UNRESOLVED_ORGANIZATION_ID = '__UNRESOLVED_ORGANIZATION__'

export function membershipId(membership) {
  return String(membership?.membership_id || membership?.id || '').trim()
}

function organizationId(organization) {
  return String(organization?.org_unit_id || organization?.id || '').trim()
}

function membershipOrganizationId(membership) {
  return String(membership?.org_unit?.id || membership?.org_unit?.org_unit_id || membership?.org_unit_id || '').trim()
}

function normalize(value) {
  return String(value || '').trim().toLocaleLowerCase('zh-CN')
}

function compareMemberships(left, right) {
  const userDifference = String(left?.user?.name || left?.user?.display_name || '').localeCompare(
    String(right?.user?.name || right?.user?.display_name || ''),
    'zh-CN',
  )
  if (userDifference !== 0) return userDifference

  const typeDifference = (left?.membership_type === 'PRIMARY' ? 0 : 1) - (right?.membership_type === 'PRIMARY' ? 0 : 1)
  if (typeDifference !== 0) return typeDifference

  const positionDifference = String(left?.position?.name || '').localeCompare(String(right?.position?.name || ''), 'zh-CN')
  if (positionDifference !== 0) return positionDifference
  return membershipId(left).localeCompare(membershipId(right))
}

function organizationCatalog(organizations) {
  const result = new Map()
  flattenOrganizationTree(buildOrganizationTree(organizations)).forEach((organization, index) => {
    const id = organizationId(organization)
    if (!id) return
    result.set(id, {
      id,
      code: organization.code || '',
      name: organization.name || '未命名组织',
      order: index,
      path: '',
    })
  })

  const byId = new Map(organizations.map((organization) => [organizationId(organization), organization]))
  const resolvePath = (id) => {
    const names = []
    const visited = new Set()
    let current = byId.get(id)
    while (current && !visited.has(organizationId(current))) {
      const currentId = organizationId(current)
      visited.add(currentId)
      names.unshift(current.name || current.code || currentId)
      current = byId.get(String(current.parent_id || '').trim())
    }
    return names.join(' / ')
  }
  result.forEach((organization) => { organization.path = resolvePath(organization.id) || organization.name })
  return result
}

function membershipMatches(membership, keyword) {
  if (!keyword) return true
  const typeText = membership?.membership_type === 'PRIMARY' ? '主职 主组织' : '兼岗 次组织'
  return [
    membershipId(membership),
    membership?.user?.id,
    membership?.user?.name,
    membership?.user?.display_name,
    membership?.position?.id,
    membership?.position?.name,
    membership?.position?.code,
    typeText,
  ].map(normalize).join(' ').includes(keyword)
}

function groupMatches(group, keyword) {
  if (!keyword) return false
  return [group.organization_id, group.organization_name, group.organization_code, group.organization_path]
    .map(normalize)
    .join(' ')
    .includes(keyword)
}

// 任职关系始终按稳定的组织 ID 分组；组织同名不会合并。组织目录不可见时使用任职
// 响应中的组织引用展示，只有完全缺少组织 ID 的异常记录才进入独立异常组。
export function groupMembershipsByOrganization(memberships = [], organizations = [], keyword = '') {
  const catalog = organizationCatalog(organizations)
  const groups = new Map()

  for (const membership of memberships) {
    if (!membershipId(membership)) continue
    const referencedId = membershipOrganizationId(membership)
    const id = referencedId || UNRESOLVED_ORGANIZATION_ID
    const catalogOrganization = catalog.get(id)
    if (!groups.has(id)) {
      groups.set(id, {
        organization_id: id,
        organization_name: catalogOrganization?.name || membership?.org_unit?.name || (referencedId ? '未命名组织' : '组织数据异常'),
        organization_code: catalogOrganization?.code || membership?.org_unit?.code || '',
        organization_path: catalogOrganization?.path || membership?.org_unit?.name || (referencedId ? '组织目录当前不可见' : '任职关系缺少组织信息'),
        organization_order: catalogOrganization?.order ?? Number.MAX_SAFE_INTEGER,
        unresolved: !referencedId,
        memberships: [],
      })
    }
    groups.get(id).memberships.push(membership)
  }

  const normalizedKeyword = normalize(keyword)
  return [...groups.values()]
    .map((group) => {
      const filteredMemberships = groupMatches(group, normalizedKeyword)
        ? group.memberships
        : group.memberships.filter((membership) => membershipMatches(membership, normalizedKeyword))
      return { ...group, memberships: [...filteredMemberships].sort(compareMemberships) }
    })
    .filter((group) => group.memberships.length > 0)
    .sort((left, right) => {
      const orderDifference = left.organization_order - right.organization_order
      if (orderDifference !== 0) return orderDifference
      const nameDifference = left.organization_name.localeCompare(right.organization_name, 'zh-CN')
      if (nameDifference !== 0) return nameDifference
      return left.organization_id.localeCompare(right.organization_id)
    })
}

export function filteredMembershipsFromGroups(groups = []) {
  return groups.flatMap((group) => group.memberships || [])
}
