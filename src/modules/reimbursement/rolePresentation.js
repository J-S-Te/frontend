// 用途：展示稳定角色编码的中文名称，不根据名称授予任何能力。
// 参数：code 为服务端会话返回的角色编码。
// 返回值：中文名称；未知角色保留编码。
export function reimbursementRoleLabel(code) {
  return ({ reimbursement_admin: '超级管理员', expense_applicant: '报销申请人',
    expense_approver: '项目业务审批人', expense_accountant: '会计', expense_cashier: '出纳',
    expense_auditor: '审计员', expense_archive_operator: '档案管理员',
    expense_finance_director: '财务负责人', expense_approval_coordinator: '受控审批转交协调人',
  })[code] || code
}

// 用途：识别当前会话明确拥有的本租户全量范围能力，不推断角色或平台授权范围。
// 参数：session 为已由服务端校验的报销会话。
// 返回值：有可信租户且含精确scope marker时为true。
export function hasTenantAllCapability(session) {
  return Boolean(session?.tenant_id) && session?.permissions?.includes('expense.scope.tenant_all') === true
}

// 用途：明确说明本地财务数据范围与职责分离，不让页面文案扩大授权。
// 参数：session 为当前报销会话。
// 返回值：范围说明；普通用户仍须发布组织列表或显式全租户范围。
export function expenseScopeDescription(session) {
  return hasTenantAllCapability(session)
    ? '服务端已授予本租户全量范围能力；仍受对象状态、任务受理及禁止自审自付等职责分离限制。'
    : '普通财务、审计和档案范围按已发布组织列表或显式全租户配置校验；未配置财务范围时拒绝相关读取和操作。'
}

// 用途：展示业务节点与项目权威岗位的关系，兼容旧快照但不改写历史来源。
// 参数：code 为节点角色或旧节点编码。
// 返回值：岗位文案；未知值保留原文。
export function approvalNodeLabel(code) {
  return ({ PROJECT_EXPENSE_OWNER: '项目经理（费用负责人）', PROJECT_MANAGER: '项目经理（费用负责人）',
    TECHNICAL_DIRECTOR: '项目技术总监（技术负责人）', SALES_DIRECTOR: '项目销售总监（销售负责人）',
    FINANCE_DIRECTOR: '财务负责人', ACCOUNTANT: '会计审核', BUSINESS_REVIEW: '业务审核（查看当时岗位来源）',
  })[code] || code || '岗位来源未返回'
}

// 用途：展示同一轮多个并行待办节点，逐个翻译后再用分隔符连接。
// 参数：value 为服务端返回的单节点或「A / B」组合编码。
// 返回值：中文节点名；空值给出来源说明。
export function approvalNodesLabel(value) {
  const text = String(value ?? '').trim()
  if (!text) return approvalNodeLabel('')
  return text.split(/\s*\/\s*/).map((code) => approvalNodeLabel(code)).join(' / ')
}

// 用途：说明本地映射的首次财务与受控替代用途，不覆盖项目业务首岗位。
// 参数：role 为本地映射角色编码。
// 返回值：财务岗位或仅受控替代说明。
export function assignmentPurpose(role) {
  return ['ACCOUNTANT', 'FINANCE_DIRECTOR'].includes(role)
    ? '财务岗位：可用于首次财务审核与受控转交，仍校验当前能力和范围。'
    : '受控替代人：不决定首次业务审批，不覆盖项目经理或项目总监权威来源。'
}
