/**
 * IAM 前端入口与面板使用的权限码单一数据源。
 *
 * 路由和页面导航按 OR 语义判断：具备某面板任一实际读取或管理权限即可进入 IAM，
 * 具体数据读取和按钮操作仍由面板按 read/create/update/delete 权限分别控制。
 */
export const IAM_PERMISSIONS = Object.freeze({
  userRead: 'platform:user:read',
  userCreate: 'platform:user:create',
  userUpdate: 'platform:user:update',
  userDelete: 'platform:user:delete',

  accountRead: 'platform:account:read',
  accountCreate: 'platform:account:create',
  accountUpdate: 'platform:account:update',
  accountPasswordInitialize: 'platform:account:password-initialize',
  accountPasswordReset: 'platform:account:password-reset',

  organizationRead: 'platform:organization:read',
  organizationCreate: 'platform:organization:create',
  organizationUpdate: 'platform:organization:update',
  organizationDelete: 'platform:organization:delete',

  positionRead: 'platform:position:read',
  positionCreate: 'platform:position:create',
  positionDelete: 'platform:position:delete',

  membershipRead: 'platform:membership:read',
  membershipCreate: 'platform:membership:create',
  membershipUpdate: 'platform:membership:update',

  roleBindingRead: 'platform:role-binding:read',
  roleBindingCreate: 'platform:role-binding:create',
  roleBindingUpdate: 'platform:role-binding:update',
})

export const IAM_PANEL_PERMISSIONS = Object.freeze({
  organizations: Object.freeze([
    IAM_PERMISSIONS.organizationRead,
    IAM_PERMISSIONS.organizationCreate,
    IAM_PERMISSIONS.organizationUpdate,
    IAM_PERMISSIONS.organizationDelete,
  ]),
  positions: Object.freeze([
    IAM_PERMISSIONS.positionRead,
    IAM_PERMISSIONS.positionCreate,
    IAM_PERMISSIONS.positionDelete,
  ]),
  users: Object.freeze([
    IAM_PERMISSIONS.userRead,
    IAM_PERMISSIONS.userCreate,
    IAM_PERMISSIONS.userUpdate,
    IAM_PERMISSIONS.userDelete,
  ]),
  accounts: Object.freeze([
    IAM_PERMISSIONS.accountRead,
    IAM_PERMISSIONS.accountCreate,
    IAM_PERMISSIONS.accountUpdate,
    IAM_PERMISSIONS.accountPasswordInitialize,
    IAM_PERMISSIONS.accountPasswordReset,
  ]),
  memberships: Object.freeze([
    IAM_PERMISSIONS.membershipRead,
    IAM_PERMISSIONS.membershipCreate,
    IAM_PERMISSIONS.membershipUpdate,
  ]),
  positionAuthorizationTemplates: Object.freeze([
    IAM_PERMISSIONS.roleBindingRead,
    IAM_PERMISSIONS.roleBindingCreate,
    IAM_PERMISSIONS.roleBindingUpdate,
  ]),
})

export const IAM_PANEL_READ_PERMISSIONS = Object.freeze({
  organizations: IAM_PERMISSIONS.organizationRead,
  positions: IAM_PERMISSIONS.positionRead,
  users: IAM_PERMISSIONS.userRead,
  accounts: IAM_PERMISSIONS.accountRead,
  memberships: IAM_PERMISSIONS.membershipRead,
  positionAuthorizationTemplates: IAM_PERMISSIONS.roleBindingRead,
})

export const IAM_ENTRY_PERMISSIONS = Object.freeze([
  ...new Set(Object.values(IAM_PANEL_PERMISSIONS).flat()),
])

export function iamPanelPermissions(panelKey) {
  return IAM_PANEL_PERMISSIONS[panelKey] || []
}

export function iamPanelReadPermission(panelKey) {
  return IAM_PANEL_READ_PERMISSIONS[panelKey] || ''
}
