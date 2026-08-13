/**
 * 客户与商机管理前端模块。售前技术支持属于 CRM 内嵌能力，不单独登记子系统。
 * 门户卡片仍须由基础平台应用目录返回后才会显示。
 */
export default Object.freeze({
  code: 'customer_and_opportunity',
  aliases: ['customer-opportunity', 'crm'],
  name: '客户与商机管理',
  description: '客户主数据、商机阶段与售前技术支持协同',
  icon: 'organization',
  builtIn: false,
  route: Object.freeze({ name: 'customer_opportunity', params: Object.freeze({ section: 'customers' }) }),
  // 门户卡片必须先进入服务端 OIDC 登录入口，不能直接打开 SPA 路由。
  // 这样即使浏览器已有 CRM 本地会话，每次点击也会先经过 Keycloak，
  // 再由基础平台 Broker 会话无感返回客户系统。
  authenticationURL: '/customer-opportunity/auth/login?return_to=%2Fcustomer-opportunity%2Fcustomers',
})
