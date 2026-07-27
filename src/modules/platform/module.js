/**
 * 基础能力平台前端模块清单。
 *
 * 模块清单只描述前端展示与本地路由，不代替后端的应用、环境、
 * OAuth 客户端和登录目标登记。基础能力平台是门户自身能力，因此
 * 可以作为唯一的内置卡片直接显示。
 */
export default Object.freeze({
  code: 'basic-platform',
  aliases: ['platform'],
  name: '基础能力平台',
  description: '统一身份、应用接入与平台管理',
  icon: 'settings',
  builtIn: true,
  route: Object.freeze({ name: 'settings', params: Object.freeze({ section: 'iam' }) }),
})
