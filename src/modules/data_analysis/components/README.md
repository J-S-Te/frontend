# 数据分析组件

2026-10-22 核实目录与页面实际引用：本目录目前仅有这份说明，没有可实例化的业务 Vue 组件。数据分析模块的看板、预警、字典和管理页面已经实现于 views，不能把本目录的计划当作现成组件或用户操作入口。本次仅改文档，未进行新的组件/浏览器动态验收。

## 当前组件归属与调用关系

- [DashboardShellView](../views/DashboardShellView.vue)负责会话、权限显隐、请求、局部错误与 iframe；[NativeDashboardView](../views/NativeDashboardView.vue)接收摘要、明细、趋势 props，展示 KPI、分布、明细、来源/同步/计算时间、报告/财务原生快照和浏览器本地目标设置，不直接查业务数据库。
- [预警](../views/AlertsCenterView.vue)、[规则](../views/AlertRulesView.vue)、[字典](../views/DictionaryView.vue)、[数据源](../views/AdminSourcesView.vue)页面各自读取 API、提交允许的表单；LoadingState、ErrorState、EmptyState、ConsoleIcon 引用平台共享组件。
- 页面 → [API 客户端](../api/dataAnalysis.js) → [后端路由/权限](../../../../../data_analysis/internal/bootstrap/app.go) → [摘要仓储](../../../../../data_analysis/internal/modules/dashboard/infrastructure/gorm_repository.go)、[预警用例](../../../../../data_analysis/internal/modules/alerts/application/service.go)、[字典规则](../../../../../data_analysis/internal/modules/dictionary/application/governance.go) → Worker/迁移。细节见[前端模块说明](../README.md)、[用户操作手册](../../../../../sharedDocs/10_操作手册/数据看板与统计分析操作手册.md)、[证据台账](../../../../../.ai/modules/operation-docs-business-20261013.md)。

## 设计计划与实际操作区分

原计划中的 KpiCard.vue、AlertBadge.vue、DictTable.vue、GlobalFilters.vue 均不是当前文件。尤其不能给用户写“使用全局时间/区域/角色筛选器”的步骤：当前只存在具体页面的本地搜索/状态展示筛选，没有该全局组件或对应全库联动链路。需求/原型仍可保留计划，不改写成已交付功能。

新组件应沿用现有 da- 样式及平台共享展示组件。按钮隐藏不代替服务端授权；原生合同/项目及预警已按服务端组织/团队范围收窄，报告/财务原生快照只对显式 TENANT 开放，Metabase 仍需实际 SQL/锁定参数验收；快照缺失或请求失败不显示为真实零业务；字典公式/已确认文本不当作可执行计算器。任何新的统计/筛选行为必须有完整 API → 业务规则 → 仓储实现和口径依据，不能用静态数值补齐设计稿。
