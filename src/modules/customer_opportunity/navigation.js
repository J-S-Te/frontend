/**
 * 将服务端生成的通知目标收敛为本模块的 Vue 路由。通知内容属于不可信输入：
 * 只接受同源、无凭据/片段、且包含一个正整数资源 ID 及明确白名单附加参数的路径；
 * 外部 Origin、多余参数和未知 CRM 路径全部失败关闭，避免开放重定向和路由注入。
 */
export function parseNotificationTarget(targetPath, origin) {
  if (typeof targetPath !== 'string' || !targetPath.trim()) return null
  let target
  try {
    target = new URL(targetPath, origin)
  } catch {
    return null
  }
  if (target.origin !== origin || target.username || target.password || target.hash) return null
  const routes = {
    '/customer-opportunity/opportunities': { section: 'opportunities', parameter: 'opportunity_id' },
    '/customer-opportunity/presale': { section: 'presale', parameter: 'request_id' },
    '/customer-opportunity/credit-approvals': { section: 'credit-approvals', parameter: 'application_id' },
    '/customer-opportunity/customers': { section: 'customers', parameter: 'customer_id', allowedExtra: { tab: 'credit' } },
  }
  const route = routes[target.pathname]
  if (!route) return null
  const allowedKeys = new Set([route.parameter, ...Object.keys(route.allowedExtra || {})])
  if ([...target.searchParams.keys()].some((key) => !allowedKeys.has(key)) || target.searchParams.getAll(route.parameter).length !== 1) return null
  for (const [key, value] of Object.entries(route.allowedExtra || {})) {
    if (target.searchParams.getAll(key).length !== 1 || target.searchParams.get(key) !== value) return null
  }
  const resourceID = target.searchParams.get(route.parameter)
  if (!resourceID || !/^\d+$/.test(resourceID)) return null
  const numericID = Number(resourceID)
  if (!Number.isSafeInteger(numericID) || numericID <= 0) return null
  const query = { [route.parameter]: String(numericID) }
  for (const key of Object.keys(route.allowedExtra || {})) query[key] = target.searchParams.get(key)
  return {
    name: 'customer_opportunity',
    params: { section: route.section },
    query,
  }
}
