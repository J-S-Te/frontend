import { buildOrganizationTree } from './organizationTree.js'
import { buildPositionOrganizationTree } from './positionGroups.js'

function organizationId(value) {
  return String(value?.org_unit_id || value?.id || '').trim()
}

function positionId(value) {
  return String(value?.position_id || value?.id || '').trim()
}

function treePrefix(depth, isLast) {
  if (depth <= 0) return ''
  return `${'  '.repeat(Math.max(depth - 1, 0))}${isLast ? '└─' : '├─'}`
}

/**
 * 按页面组织树的排序生成导出上下文。
 * selectedIds 只限制导出行，不改变节点的真实层级和路径，避免筛选后丢失上级关系。
 */
export function buildOrganizationExportRows(organizations = [], selectedIds = null) {
  const selected = selectedIds ? new Set([...selectedIds].map(String)) : null
  const rows = []
  const visit = (nodes, depth = 0, parentPath = []) => {
    nodes.forEach((node, index) => {
      const id = organizationId(node)
      const name = node.name || node.code || id
      const path = [...parentPath, name]
      if (!selected || selected.has(id)) {
        rows.push({
          ...node,
          id,
          depth,
          path: path.join(' / '),
          treeName: `${treePrefix(depth, index === nodes.length - 1)}${name}`,
          parentName: parentPath[parentPath.length - 1] || '',
        })
      }
      visit(node.children || [], depth + 1, path)
    })
  }
  visit(buildOrganizationTree(organizations))
  return rows
}

/**
 * 按岗位页面的组织树顺序生成导出上下文。岗位仍是一行一条，
 * 但增加组织树路径和岗位树状名称，Excel 中可直接看出岗位归属。
 */
export function buildPositionExportRows(positions = [], organizations = [], selectedIds = null) {
  const selected = selectedIds ? new Set([...selectedIds].map(String)) : null
  const rows = []
  const visit = (nodes) => {
    nodes.forEach((node) => {
      const organizationName = node.organization_name || node.organization_code || node.organization_id
      const organizationTreeName = treePrefix(node.organization_depth, false) + organizationName
      ;(node.positions || []).forEach((position, index) => {
        const id = positionId(position)
        if (selected && !selected.has(id)) return
        rows.push({
          ...position,
          id,
          organization_id: node.organization_id,
          organization_name: organizationName,
          organization_code: node.organization_code || '',
          organization_path: node.organization_path || organizationName,
          organization_tree_name: organizationTreeName,
          treeName: `${organizationTreeName} / ${treePrefix(node.organization_depth + 1, index === node.positions.length - 1)}${position.name || position.code || id}`,
        })
      })
      visit(node.children || [])
    })
  }
  visit(buildPositionOrganizationTree(positions, organizations))
  return rows
}
