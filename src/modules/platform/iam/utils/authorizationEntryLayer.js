const LAYERS = {
  USER: {
    title: '个人例外授权',
    badge: '例外授权',
    standard: '标准角色应通过“任职关系 → 岗位授权模板”自动获得。',
    risk: '仅用于临时兼岗或确有业务例外的个人补充；不要把日常岗位角色逐个复制到用户。',
    empty: '当前没有个人例外角色。若该用户已通过任职关系继承岗位角色，无需在此重复授予。',
  },
  POSITION: {
    title: '岗位例外授权',
    badge: '例外授权',
    standard: '标准岗位角色应在“岗位授权模板”中统一配置，再由有效任职关系动态继承。',
    risk: '直接绑定会成为该岗位的附加例外，容易与模板产生重叠；仅在无法复用模板时使用。',
    empty: '当前没有岗位例外角色。日常岗位授权请通过岗位授权模板配置。',
  },
  ORG_UNIT: {
    title: '组织范围附加授权',
    badge: '高影响例外',
    standard: '标准角色应通过岗位授权模板随任职关系获得。',
    risk: '组织范围授权可能影响该组织内多名有效成员，应先确认影响范围；不要把它作为普通人员入职授权。',
    empty: '当前没有组织范围附加角色。日常人员授权请通过岗位授权模板配置。',
  },
}

const DEFAULT_LAYER = {
  title: '应用例外授权',
  badge: '例外授权',
  standard: '标准角色应通过岗位授权模板和有效任职关系获得。',
  risk: '直接绑定仅用于业务例外，请避免与标准岗位授权重复。',
  empty: '当前没有直接角色。',
}

function roleCode(role) {
  if (typeof role === 'string') return role.trim()
  return String(role?.code || role?.role_code || role?.roleCode || '').trim()
}

export function authorizationEntryLayer(subjectType) {
  return LAYERS[String(subjectType || '').trim().toUpperCase()] || DEFAULT_LAYER
}

export function duplicatedInheritedRoleCodes(selectedRoles, inheritedRoles) {
  // 只按稳定角色编码比较。直接授权与继承授权即使来源记录 ID 不同，角色编码重复仍会
  // 造成难以追踪的授权来源，需在提交前提示管理员。
  const inherited = new Set((Array.isArray(inheritedRoles) ? inheritedRoles : [])
    .map(roleCode)
    .filter(Boolean))
  return [...new Set((Array.isArray(selectedRoles) ? selectedRoles : [])
    .map(roleCode)
    .filter((code) => code && inherited.has(code)))]
}
