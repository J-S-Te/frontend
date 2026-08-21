// 审计操作是跨子系统的稳定协议。展示名称可以持续补充，但未知编码必须原样保留，
// 不能根据字符串猜测业务含义，也不能把管理员可编辑的普通字典当作审计协议来源。
export const AUDIT_ACTION_LABELS = Object.freeze({
  'auth.login': '登录',
  'auth.login.failed': '登录失败',
  'auth.login.concurrent_denied': '并发登录拒绝',
  'auth.login.locked': '账号锁定',
  'auth.logout': '退出登录',
  'authorization.application_access.updated': '更新应用授权',
  'authorization.application_access.deleted': '删除应用授权',
  'authorization.application_subject_access.deleted': '删除用户授权',
  'authorization.application_catalog.synced': '同步应用目录',
  'authorization.application_catalog.sync_failed': '应用目录同步失败',
  'audit.dead_letter.replay': '重放审计死信',
  'platform:iam.bootstrap.first-super-admin': '初始化首位平台管理员',
  'customer.create': '新增客户',
  'customer.update': '修改客户',
  'customer.delete': '删除客户',
  'customer.import': '导入客户',
  'opportunity.create': '新增商机',
  'opportunity.update': '修改商机',
  'opportunity.delete': '删除商机',
  'opportunity.export': '导出商机',
  'contract.create': '创建合同',
  'contract.update': '修改合同',
  'contract.approve': '合同审批',
  'contract.reject': '驳回合同',
  'project.create': '创建项目',
  'project.update': '修改项目',
  'project.archive': '归档项目',
  'portal.invite': '邀请用户',
  'portal.disable': '禁用访问',
})

export const AUDIT_ACTION_CATEGORY_OPTIONS = Object.freeze([
  { label: '登录', value: 'LOGIN' },
  { label: '新增', value: 'CREATE' },
  { label: '修改', value: 'UPDATE' },
  { label: '删除', value: 'DELETE' },
  { label: '授权变更', value: 'AUTHORIZATION_CHANGE' },
  { label: '凭据轮换', value: 'SECRET_ROTATION' },
  { label: '密码重置', value: 'PASSWORD_RESET' },
  { label: '目录同步', value: 'CATALOG_SYNC' },
  { label: '审计访问', value: 'AUDIT_ACCESS' },
  { label: '导入', value: 'IMPORT' },
  { label: '导出', value: 'EXPORT' },
  { label: '状态变更', value: 'STATUS_CHANGE' },
])

export const AUDIT_RESULT_LABELS = Object.freeze({
  SUCCESS: '成功',
  FAILURE: '失败',
  DENIED: '拒绝',
  ERROR: '异常',
  PARTIAL: '部分成功',
})

export const AUDIT_RISK_LABELS = Object.freeze({
  CRITICAL: '严重',
  HIGH: '高',
  MEDIUM: '中',
  LOW: '低',
})
