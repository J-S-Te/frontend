/**
 * 合同管理系统前端模块清单。
 *
 * 模块页面随统一前端镜像构建，但门户卡片仍必须由基础平台的应用注册
 * 接口返回；仅存在前端代码不会绕过子系统登记和 OIDC 客户端配置。
 */
export default Object.freeze({
  code: 'contract_management',
  aliases: ['contract-management'],
  name: '合同管理系统',
  description: '合同台账、审批、签署、归档与统计分析',
  icon: 'account',
  builtIn: false,
  route: Object.freeze({ name: 'contract-management', params: Object.freeze({ section: 'dashboard' }) }),
})
