function organizationId(organization) {
  return String(organization?.org_unit_id || organization?.id || '').trim()
}

function compareOrganizations(left, right) {
  const sortDifference = Number(left?.sort_order || 0) - Number(right?.sort_order || 0)
  if (sortDifference !== 0) return sortDifference
  const codeDifference = String(left?.code || '').localeCompare(String(right?.code || ''), 'zh-CN')
  if (codeDifference !== 0) return codeDifference
  const nameDifference = String(left?.name || '').localeCompare(String(right?.name || ''), 'zh-CN')
  if (nameDifference !== 0) return nameDifference
  return organizationId(left).localeCompare(organizationId(right))
}

// 将扁平组织响应转换成稳定树。父节点缺失或出现环的数据提升为根节点展示，不能静默丢弃异常记录。
export function buildOrganizationTree(organizations = []) {
  const nodes = organizations
    .filter((organization) => organizationId(organization))
    .map((organization) => ({ ...organization, children: [] }))
  const byId = new Map(nodes.map((node) => [organizationId(node), node]))
  const roots = []

  for (const node of nodes) {
    const id = organizationId(node)
    const parentId = String(node.parent_id || '').trim()
    let parent = parentId ? byId.get(parentId) : null
    if (parent) {
      // 沿候选父链向上探测环；一旦回到当前节点，就放弃挂载并保留为根节点供管理员修复。
      const visited = new Set([id])
      let ancestor = parent
      while (ancestor) {
        const ancestorId = organizationId(ancestor)
        if (visited.has(ancestorId)) {
          parent = null
          break
        }
        visited.add(ancestorId)
        ancestor = byId.get(String(ancestor.parent_id || '').trim())
      }
    }
    if (parent) parent.children.push(node)
    else roots.push(node)
  }

  const sortNodes = (items) => {
    items.sort(compareOrganizations)
    items.forEach((item) => sortNodes(item.children))
  }
  sortNodes(roots)
  return roots
}

export function flattenOrganizationTree(tree = [], collapsedIds = new Set()) {
  const result = []
  const visit = (nodes, depth) => {
    for (const node of nodes) {
      const id = organizationId(node)
      result.push({ ...node, depth, hasChildren: node.children.length > 0 })
      if (!collapsedIds.has(id)) visit(node.children, depth + 1)
    }
  }
  visit(tree, 0)
  return result
}

// 搜索命中节点时保留其祖先上下文；返回复制节点，完整树不会因筛选被修改。
export function filterOrganizationTree(tree = [], keyword = '') {
  const normalizedKeyword = String(keyword || '').trim().toLocaleLowerCase('zh-CN')
  if (!normalizedKeyword) return tree

  const filterNodes = (nodes) => nodes.flatMap((node) => {
    const children = filterNodes(node.children || [])
    const searchableText = [node.name, node.code]
      .map((value) => String(value || '').toLocaleLowerCase('zh-CN'))
      .join(' ')
    if (!searchableText.includes(normalizedKeyword) && children.length === 0) return []
    return [{ ...node, children }]
  })

  return filterNodes(tree)
}

// 父级选择器用后代集合排除把节点移动到自身下级的操作；API 仍执行权威防环校验。
export function organizationDescendantIds(tree = [], organizationIdValue = '') {
  const targetId = String(organizationIdValue || '').trim()
  const descendants = new Set()

  const findTarget = (nodes) => {
    for (const node of nodes) {
      if (organizationId(node) === targetId) return node
      const found = findTarget(node.children || [])
      if (found) return found
    }
    return null
  }

  const collect = (nodes) => {
    for (const node of nodes) {
      descendants.add(organizationId(node))
      collect(node.children || [])
    }
  }

  const target = findTarget(tree)
  if (target) collect(target.children || [])
  return descendants
}
