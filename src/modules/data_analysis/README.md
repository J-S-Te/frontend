# data_analysis 前端模块（统一前端）

2026-10-22 按页面/表单、API、后端鉴权、聚合/预警/字典用例、仓储迁移及 Worker/嵌入配置核实。用户角色、步骤、成功判断和失败处理见[数据看板操作手册](../../../../sharedDocs/10_操作手册/数据看板与统计分析操作手册.md)，历史纠正与源码链见[2026-10-13 台账](../../../../.ai/modules/operation-docs-business-20261013.md)。本次未部署或执行新动态验收，PRD 页面编号不作为当前指标已实现的依据。 本轮静态记录见[2026-10-22 文档同步报告](../../../../.ai/qa/docs-code-sync-20261022/agents/project-bi-settlement-report.json)。

> 本目录位于统一前端仓库 `frontend/src/modules/data_analysis/`，随 `frontend` Docker 镜像构建；
> 后端（Go）在 `data_analysis/` 目录独立构建 Docker。部署拓扑：
> - **前端**：统一前端一个 Docker（包含全部子系统模块 + 本模块）
> - **后端**：`dashboard-api / aggregation-worker / alert-worker / authz-catalog` 各自 Docker（见 `data_analysis/compose.yaml`）
> - **Metabase**：内网服务，浏览器经独立来源上的 `/data_analysis/api/v1/embed-proxy/{token}` 及其受限资源路径访问，不是平台同源 iframe 或浏览器直连管理端

## 当前页面与实际请求

| 视图 | 路由 section | 对应页面 | 依赖接口 |
|---|---|---|---|
| DashboardShellView + NativeDashboardView | overview/contract/project/report/finance | 合同/项目/报告/财务原生摘要；经营总览、报告/财务另加嵌入 | GET /api/v1/auth/me、/dashboard/contract、/dashboard/project、/dashboard/report、/dashboard/finance、/dashboard/contracts、/dashboard/trend；嵌入 GET /api/v1/embed/{code} |
| AlertsCenterView | alerts | P-08 预警分页、范围内汇总、受理/关闭 | GET /api/v1/alerts、/alerts/summary；POST /alerts/{id}/ack、/close |
| DictionaryView | dictionary | 字典查阅、新建/修订、启停、删除和历史 | GET /api/v1/dictionary；POST /dictionary/metrics；PUT/DELETE /dictionary/metrics/{code}；PATCH /enabled；GET /versions |
| AdminSourcesView | admin/sources | 来源状态、单来源/全部手工入队，不编辑连接 | GET /api/v1/admin/sources；POST /admin/sources/{id}/trigger、/admin/sources/trigger-all |
| AlertRulesView | admin/rules | 到期规则治理 | GET/PUT /api/v1/alert-rules；DELETE /alert-rules/{id} |

> 路由 section 支持管理子路径（`admin/sources`、`admin/rules`），由
> `/data_analysis/:section(.*)?` 匹配；未知 section 统一回落到经营总览。

## 登记链路（必须两步都完成）

1. 本模块已在 `src/modules/registry/moduleRegistry.js` 登记（图标/文案）；
2. 子系统接入基础平台（onboard）后，门户才显示卡片（`GET /api/v1/portal/applications`）。

## 约定

- **视觉统一**：页面全部使用 `styles/data-analysis.css`（da- 前缀），令牌与组件形态对齐
  UniLab v1.0 设计系统（`UI设计规范/ui-kit.css`）与项目模块（project-management.css）：
  深色侧栏 + 顶栏 + 页面头 + 卡片/表格/徽章/开关/空态/toast 一套语言；模块内不再出现裸 HTML 骨架。
- 401 由 api 客户端发起 OIDC 跳转（`startDataAnalysisLogin`）；403 展示无权限页。
- 前端按 auth/me 精确 permissions 控制入口；后端原生合同/项目摘要、下钻、趋势和预警按 TENANT/ORG/TEAM/NONE 收窄，报告/财务快照只接受显式 TENANT。嵌入参数由后端签名 tenant_id、scope_mode、org_unit_ids/team_ids，现场仍须核对 Metabase 锁定参数与 SQL；角色标签不是授权依据。
- POST/PUT/PATCH/DELETE 请求由客户端附带 X-CSRF-Token: 1，后端还核对 Origin/来源；固定值不是凭据。
- iframe URL 使用 API 返回的独立来源，先经 isolatedEmbedUrl 校验主机、协议、路径与 token；后端进一步要求生产 HTTPS、不同可注册域及资源白名单。短期入口单次消费，过期重新获取，禁止分享完整 URL/JWT。

## 操作结果与限制

合同明细当前首载第 1 页 10 条；界面状态筛选为本地展示，不等于任意全库筛选。摘要 available=false 表示没有快照，不是实际零业务。刷新分别加载摘要/明细/趋势/嵌入，局部失败只解读成功部分；成功响应、来源 SUCCESS 和 iframe load 均不代替口径验收。

合同目标值仅存当前浏览器 localStorage，是展示设置，不是服务端经营预算。合同/项目摘要通过 freshness 分列源更新、成功同步、查询计算时间，并提示旧数据；全租户持久快照保留 snapshot_at 与 SNAPSHOT 语义，后端按快照写入时间超过48小时、缺失/非法/未来时间标陈旧，前端保留旧数据并展示原因；无快照行仍显示暂无聚合快照，不把查询时刻冒充源更新。48小时是展示兜底，不是实时保证。dim_project 没有同步写入方，组织/团队项目摘要会标未知/陈旧。

全租户签约事实按 start_date 月和币种归集，只计默认有效状态 active/in_progress/pending_pay/completed；商机漏斗读取独立转化事实，分子为已签约且关联有效合同的去重商机，组织/团队漏斗暂不可用。折扣无权威基准，金额不换汇。报告原生快照来自 PROJECT_READ_DSN，展示有效/作废版本和周期 P50；财务快照来自 SETTLEMENT_READ_DSN，展示分币种应收/核销/账龄/本月登记回款。首过率、投诉、收入确认、成本仍显式缺失，菜单存在不证明现场来源已配置。

数据源手工操作成功为 QUEUED，等待 Worker 后核对快照；任务使用数据库 UTC 租约与 owner/generation 防迟到写入，旧无租约任务只能按受控恢复流程处理。当前定时 DSN 循环不按 UI enabled 停止全部同步。预警列表每页 50 条、服务端最多 100；状态/严重度服务端筛选，文字搜索仅过滤已加载页，卡片来自独立范围内汇总。预警受理/关闭只写状态/时间，没有业务处理人/结果说明，不因 API 注释写“记录处理人”就宣称落库。规则只有 CONTRACT_EXPIRY；有历史预警应停用而非删除。

字典新建默认停用，编辑携带 version，冲突先刷新；公式不执行 SQL，只有符合内置 2.1 的定义可绑定当前项目状态计算器。组件实际归属见[components 说明](components/README.md)，计划中的全局筛选器尚不存在。

## 完整调用链入口

[外壳](views/DashboardShellView.vue) / [原生展示](views/NativeDashboardView.vue) / [管理表单](views/AdminSourcesView.vue) / [字典表单](views/DictionaryView.vue) → [API](api/dataAnalysis.js) → [后端 Router 装配](../../../../data_analysis/internal/bootstrap/app.go)、[鉴权](../../../../data_analysis/internal/middleware/auth.go) → [摘要服务](../../../../data_analysis/internal/modules/dashboard/application/service.go)、[仓储](../../../../data_analysis/internal/modules/dashboard/infrastructure/gorm_repository.go)、[管理服务](../../../../data_analysis/internal/modules/admin/application/service.go)、[字典治理](../../../../data_analysis/internal/modules/dictionary/application/governance.go) → [同步装配](../../../../data_analysis/cmd/aggregation-worker/main.go)、[预计算](../../../../data_analysis/internal/aggregation/aggregation.go)、[治理迁移](../../../../data_analysis/migrations/000013_metric_dictionary_governance.sql)。

嵌入另经[URL 校验](utils/embedOrigin.mjs) → [嵌入桥](../../../../data_analysis/internal/embedbridge/embed.go) → [独立来源配置](../../../../sharedDocs/BI独立嵌入来源配置.md)。上述均为源码支持，不证明真实配置、租户 SQL 或图表已验收。
