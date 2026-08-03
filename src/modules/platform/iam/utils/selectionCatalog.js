import { buildOrganizationTree, flattenOrganizationTree } from './organizationTree.js'

function text(value) {
  return String(value || '').trim()
}

export function organizationId(item) {
  return text(item?.org_unit_id || item?.id)
}

export function positionId(item) {
  return text(item?.position_id || item?.id)
}

function positionOrganizationId(item) {
  return text(item?.org_unit_id || item?.organization_id || item?.org_unit?.id || item?.org_unit?.org_unit_id)
}

function positionName(item) {
  return text(item?.position_name || item?.name || item?.position_code || item?.code || positionId(item))
}

function positionCode(item) {
  return text(item?.position_code || item?.code)
}

function compareText(left, right) {
  return text(left).localeCompare(text(right), 'zh-CN')
}

export function comparePositionsByChineseName(left, right) {
  return compareText(positionName(left), positionName(right))
    || compareText(positionCode(left), positionCode(right))
    || compareText(positionId(left), positionId(right))
}

// 原生 select 无法渲染交互树，以全角缩进表达层级；排序必须与组织管理树完全一致。
export function organizationSelectOptions(organizations = []) {
  return flattenOrganizationTree(buildOrganizationTree(organizations)).map((organization) => {
    const id = organizationId(organization)
    const name = text(organization.name || organization.org_unit_name || organization.code || id)
    const code = text(organization.code || organization.org_unit_code)
    const depth = Number(organization.depth || 0)
    const prefix = depth > 0 ? `${'　'.repeat(depth)}└ ` : ''
    return {
      ...organization,
      option_id: id,
      option_depth: depth,
      option_label: `${prefix}${name}${code ? ` · ${code}` : ''}`,
    }
  })
}

export function positionsForOrganization(positions = [], orgUnitId = '') {
  const targetId = text(orgUnitId)
  if (!targetId) return []
  return positions
    .filter((position) => positionOrganizationId(position) === targetId)
    .sort(comparePositionsByChineseName)
}

function positionOrganizationName(item) {
  return text(item?.org_unit_name || item?.organization_name || item?.org_unit?.name)
}

function positionOrganizationCode(item) {
  return text(item?.org_unit_code || item?.organization_code || item?.org_unit?.code)
}

function positionOrganizationInternalPath(item) {
  return text(item?.org_unit_path || item?.organization_path)
}

function positionOrganizationDepth(item) {
  const depth = Number(item?.org_unit_depth ?? item?.organization_depth ?? 0)
  return Number.isFinite(depth) && depth > 0 ? depth : 0
}

// 授权专用端点可能返回组织路径，也可能只返回组织 ID；两种形态都要兼容，避免只有
// 角色绑定权限的页面为了展示而调用权限更广的组织管理 API。
export function groupAuthorizationPositions(positions = []) {
  const groups = new Map()
  for (const position of positions) {
    if (!positionId(position)) continue
    const orgId = positionOrganizationId(position)
    const orgName = positionOrganizationName(position)
    const orgCode = positionOrganizationCode(position)
    const internalPath = positionOrganizationInternalPath(position)
    const key = orgId || `__unresolved__:${orgName || orgCode || 'unknown'}`
    if (!groups.has(key)) {
      groups.set(key, {
        organization_id: orgId,
        organization_name: orgName || '组织信息未提供',
        organization_code: orgCode,
        organization_internal_path: internalPath,
        organization_depth: positionOrganizationDepth(position),
        positions: [],
      })
    }
    groups.get(key).positions.push(position)
  }

  return [...groups.values()]
    .map((group) => ({ ...group, positions: group.positions.sort(comparePositionsByChineseName) }))
    .sort((left, right) => compareText(left.organization_internal_path, right.organization_internal_path)
      || compareText(left.organization_name, right.organization_name)
      || compareText(left.organization_id, right.organization_id))
}

// org_unit_path 是由不透明 ID 组成的数据库物化路径，只用于稳定层级排序，不能作为面向用户的面包屑展示。
export function authorizationPositionGroupLabel(group) {
  const depth = Math.max(0, Number(group?.organization_depth || 0) - 1)
  const prefix = depth > 0 ? `${'　'.repeat(depth)}└ ` : ''
  const name = text(group?.organization_name) || '组织信息未提供'
  const code = text(group?.organization_code)
  return `${prefix}${name}${code ? ` · ${code}` : ''}（${group?.positions?.length || 0}）`
}

export function authorizationPositionOptionLabel(position) {
  const name = positionName(position)
  const code = positionCode(position)
  return code ? `${name} · ${code}` : name
}
