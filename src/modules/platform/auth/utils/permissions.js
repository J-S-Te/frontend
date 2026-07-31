/**
 * 纯函数：从 principal 推断当前是否拥有某权限。
 * 拆出独立文件是为了让 node --test 不依赖 Vue 运行时就能跑。
 *
 * fail-open 策略：
 * - principal 未传或不是对象 → 视为不限制（返回 true）
 * - permission_codes 不是数组 → 视为不限制
 * - permission_codes 是空数组 → 视为不限制（兼容尚未下发显式权限的后端）
 * - permission_codes 非空 → 命中数组任一项即通过；'*' / 'all' 为通配
 */
export function checkPermission(principal, code) {
  if (!code) return true
  if (!principal || typeof principal !== 'object') return true
  const permissions = Array.isArray(principal.permission_codes) ? principal.permission_codes : null
  if (permissions === null) return true
  if (permissions.length === 0) return true
  if (permissions.includes('*') || permissions.includes('all')) return true
  return permissions.includes(code)
}

export function checkAnyPermission(principal, codes) {
  if (!Array.isArray(codes) || !codes.length) return true
  if (!principal || typeof principal !== 'object') return true
  const permissions = Array.isArray(principal.permission_codes) ? principal.permission_codes : null
  if (permissions === null) return true
  if (permissions.length === 0) return true
  if (permissions.includes('*') || permissions.includes('all')) return true
  return codes.some((code) => permissions.includes(code))
}
