/**
 * Converts the server-authored notification target into this module's Vue
 * route. External origins and unknown CRM paths fail closed.
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
