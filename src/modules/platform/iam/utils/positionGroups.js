import { buildOrganizationTree } from './organizationTree.js'

function positionId(position) {
  return String(position?.position_id || position?.id || '').trim()
}

function organizationId(organization) {
  return String(organization?.org_unit_id || organization?.id || '').trim()
}

function positionOrganizationId(position) {
  return String(position?.org_unit_id || position?.org_unit?.id || position?.org_unit?.org_unit_id || '').trim()
}

function normalize(value) {
  return String(value || '').toLocaleLowerCase('zh-CN')
}

function comparePositions(left, right) {
  const nameDifference = String(left?.name || '').localeCompare(String(right?.name || ''), 'zh-CN')
  if (nameDifference !== 0) return nameDifference
  const codeDifference = String(left?.code || '').localeCompare(String(right?.code || ''), 'zh-CN')
  if (codeDifference !== 0) return codeDifference
  return positionId(left).localeCompare(positionId(right))
}

function organizationMatches(organization, keyword) {
  if (!keyword) return false
  return [organization?.name, organization?.code, organizationId(organization)]
    .map(normalize)
    .join(' ')
    .includes(keyword)
}

function positionMatches(position, keyword) {
  if (!keyword) return true
  return [position?.name, position?.code, positionId(position)]
    .map(normalize)
    .join(' ')
    .includes(keyword)
}

function descendantPositionCount(node) {
  return node.positions.length + node.children.reduce((total, child) => total + descendantPositionCount(child), 0)
}

function decorateOrganizationNode(organization, positionsByOrganization, depth, path) {
  const id = organizationId(organization)
  const currentPath = [...path, organization.name || organization.code || id]
  const node = {
    ...organization,
    organization_id: id,
    organization_name: organization.name || '未命名组织',
    organization_code: organization.code || '',
    organization_depth: depth,
    organization_path: currentPath.join(' / '),
    positions: [...(positionsByOrganization.get(id) || [])].sort(comparePositions),
    children: (organization.children || []).map((child) => decorateOrganizationNode(child, positionsByOrganization, depth + 1, currentPath)),
  }
  node.direct_position_count = node.positions.length
  node.descendant_position_count = descendantPositionCount(node)
  return node
}

function filterPositionTree(nodes, keyword) {
  if (!keyword) return nodes
  return nodes.flatMap((node) => {
    const organizationMatched = organizationMatches(node, keyword)
    const positions = organizationMatched
      ? node.positions
      : node.positions.filter((position) => positionMatches(position, keyword))
    const children = filterPositionTree(node.children, keyword)
    if (!organizationMatched && positions.length === 0 && children.length === 0) return []
    const filteredNode = { ...node, positions, children }
    filteredNode.direct_position_count = positions.length
    filteredNode.descendant_position_count = descendantPositionCount(filteredNode)
    return [filteredNode]
  })
}

// buildPositionOrganizationTree mirrors the organization-unit hierarchy exactly. Each position
// is attached only to its direct organization; ancestors stay visible for hierarchy and search
// context. Positions outside the visible organization scope are isolated in an anomaly root.
export function buildPositionOrganizationTree(positions = [], organizations = [], keyword = '') {
  const organizationTree = buildOrganizationTree(organizations)
  const visibleOrganizationIds = new Set()
  const collectOrganizationIds = (nodes) => nodes.forEach((node) => {
    visibleOrganizationIds.add(organizationId(node))
    collectOrganizationIds(node.children || [])
  })
  collectOrganizationIds(organizationTree)

  const positionsByOrganization = new Map()
  const orphanPositions = []
  for (const position of positions) {
    if (!positionId(position)) continue
    const orgId = positionOrganizationId(position)
    if (!orgId || !visibleOrganizationIds.has(orgId)) {
      orphanPositions.push({ ...position, organization_name: '组织信息不可见' })
      continue
    }
    if (!positionsByOrganization.has(orgId)) positionsByOrganization.set(orgId, [])
    positionsByOrganization.get(orgId).push(position)
  }

  const roots = organizationTree.map((organization) => decorateOrganizationNode(organization, positionsByOrganization, 0, []))
  if (orphanPositions.length) {
    roots.push({
      organization_id: '__UNRESOLVED_ORGANIZATION__',
      organization_name: '组织数据异常',
      organization_code: '',
      organization_depth: 0,
      organization_path: '组织数据异常',
      direct_position_count: orphanPositions.length,
      descendant_position_count: orphanPositions.length,
      unresolved: true,
      positions: orphanPositions.sort(comparePositions),
      children: [],
    })
  }

  return filterPositionTree(roots, normalize(String(keyword || '').trim()))
}

export function flattenPositionOrganizationTree(tree = [], collapsedIds = new Set()) {
  const result = []
  const visit = (nodes) => {
    for (const node of nodes) {
      // 岗位行也是组织节点的可折叠内容。只有下级组织才算树节点 children，
      // 但“仅有直属岗位、没有下级组织”的叶子组织同样必须显示折叠按钮。
      result.push({
        ...node,
        hasChildren: node.children.length > 0,
        hasExpandableContent: node.children.length > 0 || node.positions.length > 0,
      })
      if (!collapsedIds.has(node.organization_id)) visit(node.children)
    }
  }
  visit(tree)
  return result
}

export function isPositionOrganizationNodeExpanded(node, collapsedIds = new Set()) {
  return Boolean(node?.hasExpandableContent) && !collapsedIds.has(node.organization_id)
}

// Positions are rendered by the component below the organization header rather than as tree
// children. Keep their visibility in the shared utility so leaf-organization collapse behavior
// is testable without coupling tests to Vue template internals.
export function visiblePositionsForOrganizationNode(node, collapsedIds = new Set()) {
  return isPositionOrganizationNodeExpanded(node, collapsedIds) ? (node?.positions || []) : []
}

// Compatibility adapter for counts/CSV consumers that only need organization-position groups.
export function groupPositionsByOrganization(positions = [], organizations = [], keyword = '') {
  return flattenPositionOrganizationTree(buildPositionOrganizationTree(positions, organizations, keyword))
    .filter((node) => node.positions.length > 0)
}

export function groupedPositionCount(groups = []) {
  return groups.reduce((total, group) => total + (group.positions?.length || 0), 0)
}
