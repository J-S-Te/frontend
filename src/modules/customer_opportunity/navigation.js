// 用途：规范化 CRM 详情坐标，拒绝重复、非整数与超出精度的编号。
// 参数：value 为通知字段或路由中的资源编号。
// 返回值：有效正整数；非法或缺失时返回 null。
export function crmResourceID(value) {
  if (Array.isArray(value)) {
    if (value.length !== 1) return null
    value = value[0]
  }
  if (!/^\d+$/.test(String(value ?? ''))) return null
  const id = Number(value)
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

// 用途：把同源通知路径收敛为已登记的 CRM 详情路由。
// 参数：targetPath 为服务端通知目标，origin 为当前站点来源。
// 返回值：白名单路由；外站、重复参数或非法编号返回 null。
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
    '/customer-opportunity/credit-approvals': { section: 'credit-approvals', parameters: ['application_id', 'customer_id'] },
    '/customer-opportunity/customers': { section: 'customers', parameter: 'customer_id', allowedExtra: { tab: 'credit' } },
  }
  const route = routes[target.pathname]
  if (!route) return null
  const parameters = route.parameters || [route.parameter]
  const allowedKeys = new Set([...parameters, ...Object.keys(route.allowedExtra || {})])
  if ([...target.searchParams.keys()].some((key) => !allowedKeys.has(key)
    || target.searchParams.getAll(key).length !== 1)) return null
  const resources = parameters.filter(key => target.searchParams.has(key))
  if (!resources.length) return null
  for (const [key, value] of Object.entries(route.allowedExtra || {})) {
    if (target.searchParams.getAll(key).length !== 1 || target.searchParams.get(key) !== value) return null
  }
  const query = {}
  for (const key of resources) {
    const id = crmResourceID(target.searchParams.get(key))
    if (!id) return null
    query[key] = String(id)
  }
  for (const key of Object.keys(route.allowedExtra || {})) query[key] = target.searchParams.get(key)
  return {
    name: 'customer_opportunity',
    params: { section: route.section },
    query,
  }
}

// 用途：把信用待审旧客户提醒定位到真实审批入口，其余通知沿用业务目标。
// 参数：notification 为当前账号通知，origin 为当前站点来源。
// 返回值：可用 CRM 路由；非法显式目标或缺失业务坐标返回 null。
export function crmNotificationTarget(notification, origin) {
  const target = parseNotificationTarget(notification?.target_path, origin)
  if (!target && notification?.target_path) return null
  if (notification?.type !== 'CREDIT_APPLICATION_PENDING') return target
  const application = crmResourceID(target?.query.application_id || notification.application_id)
  const customer = crmResourceID(target?.query.customer_id || notification.customer_id)
  if (!application && !customer) return null
  return { name: 'customer_opportunity', params: { section: 'credit-approvals' },
    query: application ? { application_id: String(application) } : { customer_id: String(customer) } }
}
