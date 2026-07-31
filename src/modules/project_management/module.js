/**
 * 项目管理前端模块清单。
 *
 * 模块页面随统一前端镜像构建；门户卡片仍需由基础能力平台应用目录
 * 返回，不能仅凭前端目录绕过子系统登记。
 */
export default Object.freeze({
  code: 'project_management',
  aliases: ['project-management'],
  name: '项目管理系统',
  description: '项目立项、计划、协作、进度、风险与归档管理',
  icon: 'dashboard',
  builtIn: false,
  route: Object.freeze({ name: 'project_management', params: Object.freeze({ section: 'dashboard' }) }),
})
