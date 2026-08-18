/**
 * 数据看板与统计分析前端模块清单。
 *
 * 模块页面随统一前端镜像构建；门户卡片仍必须由基础能力平台应用目录
 * 返回，不能仅凭前端目录绕过子系统登记（同 contract/project 模式）。
 */
export default Object.freeze({
  code: 'data_analysis',
  aliases: ['data-analysis'],
  name: '数据看板与统计分析',
  description: '经营总览、合同/项目/报告/财务看板、预警中心与指标字典',
  icon: 'dashboard',
  builtIn: false,
  route: Object.freeze({ name: 'data_analysis', params: Object.freeze({ section: 'overview' }) }),
})
