export const CONTRACT_ROLE_DEFINITIONS = Object.freeze([
  { code: 'admin', name: '超级管理员', permissions: ['contract.read', 'contract.create', 'contract.edit', 'contract.approved.read', 'contract.document.download', 'contract.stamped_pdf.upload', 'contract.signing.manage', 'approval.view', 'approval.process', 'approval.manage', 'approval_rule.manage', 'opportunity_intake.read', 'opportunity_intake.process'] },
  { code: 'sales_director', name: '销售总监', permissions: ['dashboard', 'contract.read', 'customer.read', 'approval.view', 'approval.process'] },
  { code: 'tech_director', name: '技术总监', permissions: ['dashboard', 'contract.read', 'customer.read', 'approval.view', 'approval.process'] },
  { code: 'finance_director', name: '财务总监', permissions: ['dashboard', 'contract.read', 'customer.read', 'approval.view', 'approval.process'] },
  { code: 'sales', name: '销售人员', permissions: ['dashboard', 'contract.read', 'contract.create', 'contract.edit', 'customer.read', 'customer.create', 'customer.edit', 'contract_template.read'] },
  { code: 'audit_admin', name: '审计管理员', permissions: ['dashboard', 'contract.read', 'customer.read', 'approval.view', 'audit.view', 'audit.read', 'opportunity_intake.read'] },
  { code: 'contract_specialist', name: '合同专员', permissions: ['contract.approved.read', 'contract.document.download', 'contract.stamped_pdf.upload', 'contract.signing.manage'] },
])

const roleMap = new Map(CONTRACT_ROLE_DEFINITIONS.map((role) => [role.code, role]))

export function contractRole(code) {
  return roleMap.get(code) || null
}

export function hasContractPermission(session, permission) {
  // 这是菜单展示辅助判断，不是授权执行点；后端必须基于服务端会话再次鉴权。
  const permissions = Array.isArray(session?.permissions) ? session.permissions : []
  return permissions.includes('all') || permissions.includes(permission)
}

export const CONTRACT_SECTION_PERMISSIONS = Object.freeze({
  dashboard: ['dashboard'],
  customers: ['customer.read'],
  contracts: ['contract.read'],
  intakes: ['opportunity_intake.read'],
  templates: ['contract_template.read', 'contract_template.manage'],
  approvals: ['approval.view', 'approval.process', 'contract.create'],
  rules: ['approval.view', 'approval_rule.manage'],
  // 签署台账涉及盖章件与签署状态，属于签署管理职责：只有 contract.signing.manage 才展示。
  // 仅持有 contract.approved.read 的跨系统角色（例如项目侧「合同导入只读」）不应看到该菜单。
  signing: ['contract.signing.manage'],
  reports: ['dashboard'],
})

export function canAccessContractSection(session, section) {
  const roleCodes = new Set([
    ...(Array.isArray(session?.roles) ? session.roles : []),
    session?.role?.code,
  ].filter(Boolean))
  // 签单接收队列是独立的跨系统高敏边界，不能仅凭前端角色名称放行。
  if (section === 'intakes') return hasContractPermission(session, 'opportunity_intake.read')
  if (roleCodes.has('admin')) {
    return Object.hasOwn(CONTRACT_SECTION_PERMISSIONS, section)
  }
  if (['sales_director', 'tech_director', 'finance_director'].some((roleCode) => roleCodes.has(roleCode))) {
    return ['dashboard', 'customers', 'contracts', 'approvals', 'rules', 'reports'].includes(section)
  }
  if (roleCodes.has('sales') && section === 'rules') return false

  const required = CONTRACT_SECTION_PERMISSIONS[section]
  if (!required) return false
  return required.some((permission) => hasContractPermission(session, permission))
}
