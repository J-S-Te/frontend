# 数据分析组件

本目录用于数据分析模块的可复用展示组件。数据分析模块已经包含看板、预警、指标字典和管理界面；新增组件必须保持租户隔离、服务端权限判定和统一前端 API 契约，不能仅依赖前端隐藏入口实现鉴权。

计划组件（按 Data-analysis/页面清单 与 高保真原型）：
- `KpiCard.vue`：P-01 经营总览 KPI 卡（点击跳转对应看板）
- `AlertBadge.vue`：看板内预警红标
- `DictTable.vue`：指标字典表格（口径五要素展示）
- `GlobalFilters.vue`：全局筛选器（时间/区域/角色联动，对齐 OQ4 默认范围）

实现时统一引用 `@/modules/platform/shared/components/` 与 UI 设计规范（ui-kit.css）。
