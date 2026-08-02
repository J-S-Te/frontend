export const CONTRACT_APPLICATION_CODE = 'contract_management'

export const CONTRACT_ROLE_DEFINITIONS = Object.freeze([
  { code: 'admin', name: '超级管理员', permissions: ['contract.read', 'contract.create', 'contract.edit', 'approval.view', 'approval.process', 'approval.manage', 'approval_rule.manage', 'opportunity_intake.read', 'opportunity_intake.process'] },
  { code: 'sales_director', name: '销售总监', permissions: ['dashboard', 'contract.read', 'customer.read', 'approval.view', 'approval.process'] },
  { code: 'tech_director', name: '技术总监', permissions: ['dashboard', 'contract.read', 'customer.read', 'approval.view', 'approval.process'] },
  { code: 'finance_director', name: '财务总监', permissions: ['dashboard', 'contract.read', 'customer.read', 'approval.view', 'approval.process'] },
  { code: 'sales', name: '销售人员', permissions: ['dashboard', 'contract.read', 'contract.create', 'contract.edit', 'customer.read', 'customer.create', 'customer.edit', 'contract_template.read'] },
  { code: 'audit_admin', name: '审计管理员', permissions: ['dashboard', 'contract.read', 'customer.read', 'approval.view', 'audit.view', 'audit.read', 'opportunity_intake.read'] },
])

export const CONTRACT_PERMISSION_DEFINITIONS = Object.freeze([
  ['all', '全部权限'],
  ['dashboard', '仪表盘访问'],
  ['contract.read', '查看合同'],
  ['contract.create', '创建合同'],
  ['contract.edit', '编辑合同'],
  ['contract.delete', '删除合同'],
  ['customer.read', '查看客户'],
  ['customer.create', '创建客户'],
  ['customer.edit', '编辑客户'],
  ['customer.delete', '删除客户'],
  ['contract_type.manage', '管理合同类型'],
  ['contract_template.read', '查看合同模板'],
  ['contract_template.manage', '管理合同模板'],
  ['approval.view', '查看审批'],
  ['approval.process', '处理审批'],
  ['approval.manage', '管理审批'],
  ['approval_rule.manage', '管理审批规则'],
  ['opportunity_intake.read', '查看签单关联核对队列'],
  ['opportunity_intake.process', '处理签单关联核对队列'],
  ['user.manage', '管理用户'],
  ['audit.view', '查看审计日志'],
  ['audit.read', '审计只读'],
].map(([code, name]) => Object.freeze({ code, name })))

export const CONTRACT_CUSTOM_PERMISSION_DEFINITIONS = Object.freeze(
  CONTRACT_PERMISSION_DEFINITIONS.filter(({ code }) => !['all', 'user.manage'].includes(code)),
)

const roleMap = new Map(CONTRACT_ROLE_DEFINITIONS.map((role) => [role.code, role]))
const permissionMap = new Map(CONTRACT_PERMISSION_DEFINITIONS.map((permission) => [permission.code, permission]))

export function contractRole(code) {
  return roleMap.get(code) || null
}

export function contractPermissionName(code) {
  return permissionMap.get(code)?.name || code
}

export function hasContractPermission(session, permission) {
  const permissions = Array.isArray(session?.permissions) ? session.permissions : []
  return permissions.includes('all') || permissions.includes(permission)
}

export function effectiveContractPermissions(roleCode, customPermissions = []) {
  const role = contractRole(roleCode)
  return [...new Set([...(role?.permissions || []), ...customPermissions])].sort()
}

export const CONTRACT_SECTION_PERMISSIONS = Object.freeze({
  dashboard: ['dashboard'],
  customers: ['customer.read'],
  contracts: ['contract.read'],
  intakes: ['opportunity_intake.read'],
  templates: ['contract_template.read', 'contract_template.manage'],
  approvals: ['approval.view', 'approval.process', 'contract.create'],
  rules: ['approval.view', 'approval_rule.manage'],
  signing: ['contract.read'],
  reports: ['dashboard'],
})

export function canAccessContractSection(session, section) {
  const roleCode = session?.role?.code
  // 签单接收队列是独立的跨系统高敏边界，不能仅凭前端角色名称放行。
  if (section === 'intakes') return hasContractPermission(session, 'opportunity_intake.read')
  if (roleCode === 'admin') {
    return Object.hasOwn(CONTRACT_SECTION_PERMISSIONS, section)
  }
  if (['sales_director', 'tech_director', 'finance_director'].includes(roleCode)) {
    return ['dashboard', 'customers', 'contracts', 'approvals', 'rules', 'reports'].includes(section)
  }
  if (roleCode === 'sales' && section === 'rules') return false

  const required = CONTRACT_SECTION_PERMISSIONS[section]
  if (!required) return false
  return required.some((permission) => hasContractPermission(session, permission))
}
