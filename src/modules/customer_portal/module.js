/** 客户自助门户是独立 OIDC 子系统；本定义只声明统一前端中的承载页面。 */
export default Object.freeze({
  code: 'customer_portal',
  aliases: ['customer-portal', 'portal-web'],
  name: '客户自助门户',
  description: '项目进度、电子报告、等保备案、客户反馈与账号安全服务',
  icon: 'user',
  builtIn: false,
  route: Object.freeze({ name: 'customer_portal', params: Object.freeze({ section: 'projects' }) }),
})
