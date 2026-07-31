/**
 * 纯函数：从 principal 推断当前是否拥有某权限。
 * 拆出独立文件是为了让 node --test 不依赖 Vue 运行时就能跑。
 *
 * 严格策略（不再 fail-open）：
 * - principal 未传或不是对象 → 拒绝（无身份视为无权）
 * - permission_codes 不是数组 / 是空数组 → 拒绝（后端没下放任何权限码的用户什么都不能做）
 * - permission_codes 非空 → 命中数组任一项即通过；'*' / 'all' 为通配
 * - 调用方传入空 code / 空 codes 列表 → 拒绝（避免误传空串导致意外放行）
 *
 * 后端仍然以 403 为最终安全边界；前端只用于隐藏入口和按钮。
 */
export function checkPermission(principal, code) {
  if (!code) return false
  if (!principal || typeof principal !== 'object') return false
  const permissions = Array.isArray(principal.permission_codes) ? principal.permission_codes : null
  if (permissions === null || permissions.length === 0) return false
  if (permissions.includes('*') || permissions.includes('all')) return true
  return permissions.includes(code)
}

export function checkAnyPermission(principal, codes) {
  if (!Array.isArray(codes) || !codes.length) return false
  if (!principal || typeof principal !== 'object') return false
  const permissions = Array.isArray(principal.permission_codes) ? principal.permission_codes : null
  if (permissions === null || permissions.length === 0) return false
  if (permissions.includes('*') || permissions.includes('all')) return true
  return codes.some((code) => permissions.includes(code))
}

// 便捷别名：单 code 与多 code 共用一套语义。
// `hasPermission` 在 principal.js 内有同名的 ref-aware 版本，路由模块如果不需要
// 关心缓存 ref，可以直接用这里的纯函数版本搭配外部传入的 principal。
export function hasPermission(principal, code) {
  return checkPermission(principal, code)
}

export function hasAnyPermission(principal, codes) {
  return checkAnyPermission(principal, codes)
}
