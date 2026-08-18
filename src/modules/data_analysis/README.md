# data_analysis 前端模块（统一前端）

> 本目录位于统一前端仓库 `frontend/src/modules/data_analysis/`，随 `frontend` Docker 镜像构建；
> 后端（Go）在 `data_analysis/` 目录独立构建 Docker。部署拓扑：
> - **前端**：统一前端一个 Docker（包含全部子系统模块 + 本模块）
> - **后端**：`dashboard-api / aggregation-worker / alert-worker / authz-catalog` 各自 Docker（见 `data_analysis/compose.yaml`）
> - **Metabase**：内网第三方服务，浏览器只经 `/data_analysis/api/v1/embed-proxy/{token}` 代理访问

## 页面（与 `Data-analysis/页面清单` 对应）

| 视图 | 路由 section | 对应页面 | 依赖接口 |
|---|---|---|---|
| DashboardShellView | overview/contract/project/report/finance | P-01~P-05 看板（iframe 壳）+ 统一外壳（侧栏/顶栏/分区切换） | GET /api/v1/embed/{code} → /embed-proxy/{token}、GET /auth/me |
| AlertsCenterView | alerts | P-08 预警中心 | GET /api/v1/alerts、POST /alerts/{id}/ack、/close |
| DictionaryView | dictionary | P-07 指标字典 | GET /api/v1/dictionary |
| AdminSourcesView | admin/sources | P-09 数据源状态 | GET /api/v1/admin/sources、POST /admin/sources/{id}/trigger |
| AlertRulesView | admin/rules | P-10 预警规则配置 | GET/PUT /api/v1/alert-rules |

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
- 权限与行级数据范围全部由后端执行；前端仅按 `/auth/me` 的 permissions 控制菜单显隐；
  写操作（POST/PUT）必须携带 `X-CSRF-Token: 1` 同源标记。
- iframe 一律加载 `/data_analysis/api/v1/embed-proxy/{token}`，禁止直连 Metabase。
