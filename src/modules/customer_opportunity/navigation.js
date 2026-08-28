/**
 * 将服务端生成的通知目标收敛为本模块的 Vue 路由。通知内容属于不可信输入：
 * 只接受同源、无凭据/片段、且恰好包含一个正整数资源 ID 的白名单路径；外部
 * Origin、多余参数和未知 CRM 路径全部失败关闭，避免开放重定向和路由注入。
 */
export function parseNotificationTarget(targetPath, origin) {
  if (typeof targetPath !== 'string' || !targetPath.trim()) return null
  let target
  try {
    target = new URL(targetPath, origin)
  } catch {
    return null
  }
  if (target.origin !== origin || target.username || target.password || target.hash || target.searchParams.size !== 1) return null
  const routes = {
    '/customer-opportunity/opportunities': { section: 'opportunities', parameter: 'opportunity_id' },
    '/customer-opportunity/presale': { section: 'presale', parameter: 'request_id' },
    '/customer-opportunity/credit-approvals': { section: 'credit-approvals', parameter: 'application_id' },
  }
  const route = routes[target.pathname]
  if (!route) return null
  const resourceID = target.searchParams.get(route.parameter)
  if (!resourceID || !/^\d+$/.test(resourceID)) return null
  const numericID = Number(resourceID)
  if (!Number.isSafeInteger(numericID) || numericID <= 0) return null
  return {
    name: 'customer_opportunity',
    params: { section: route.section },
    query: { [route.parameter]: String(numericID) },
  }
}
