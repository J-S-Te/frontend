# 客户自助门户前端模块

本模块是独立 Portal 的 Vue 3 + Vite 阶段性界面。外部客户身份采用基础平台 OIDC Authorization Code + PKCE S256；前端不保存 Token、密码或本地账号凭据，只使用 Portal 服务端 HttpOnly Cookie 会话。

API 基地址默认是 `/customer-portal/api/v1`，可用 `VITE_CUSTOMER_PORTAL_PUBLIC_PATH_PREFIX` 或 `VITE_CUSTOMER_PORTAL_API_BASE_URL` 覆盖。报告列表、申请与详情调用 `/reports`；详情只展示后端 `/reports/{id}` 返回的最小状态事件时间线。已发放报告通过授权 POST 和流式下载 POST 完成受控下载。
报告风险告警使用当前账号范围 `/report-risk-alerts` 展示；浏览器不能执行解冻或重发。人工复核属于受基础平台 application token、单一机器 scope、时间戳和 nonce 保护的内部接口；重发只撤销旧授权并要求客户重新点击，不把明文下载凭据交给后台操作人。

## 已实现

- 启动读取 `/auth/me`，401 跳转 Portal `/auth/login`。
- 登录会话建立后只读取一次 `/capabilities`。该接口仅返回四项运行能力的 `available/mode/reason_code`，不返回 Provider URL、OAuth Client、scope 或 secret，也不执行远端网络探测；读取失败时报告下载、备案材料上传等依赖型动作保持关闭，最终仍以后端动作接口为权威。
- 项目列表、项目详情和活动时间线界面/API 客户端；详情展示项目快照的总体进度、当前阶段、预计结束、延期、源更新时间、Portal 同步时间、里程碑、团队及脱敏联系方式。
- 项目详情、分页动态和服务评价使用独立加载/失败状态；`project.read` 可单独打开详情，评价 403 或服务失败不会遮蔽项目数据，评价提交按钮另受 `evaluation.create` 控制。
- `project.export` 独立控制异步项目 PDF；页面按项目隔离重试键和已受理任务。站内联系项目经理仅在权威 `manager_portal_account_id` 已同步且当前账号具备 `project.message.read/send` 时开放；姓名和脱敏联系方式不构成投递身份。客户打开最新消息窗口后，仅将服务端返回且真实投递给本账号的最新经理消息推进为已读；回执失败不隐藏已经成功加载的消息。
- 报告申请、列表、详情和不可变状态事件时间线；申请项目来自当前客户真实项目接口，读取与提交分别受 `report.read`、`report.request` 控制。
- 报告申请失败后，相同规范化表单内容复用同一 `Idempotency-Key`，字段变化才生成新键；409 显示明确冲突提示。
- 仅 `ISSUED` 报告且同时具备 `report.read`、`report.download` 时开放 PDF 下载；每次人工点击以新幂等键创建短效授权，不自动重试。
- 明文下载 token 只在 API 函数局部短暂存在，立即通过 `X-Report-Download-Token` 请求头发起同源 POST；不会进入 URL、请求体、`Authorization`、Vue 状态、DOM、日志或浏览器持久存储。
- 下载严格校验 `application/pdf` 与安全文件名；切换报告、关闭弹窗、离开报告页会取消请求，过期、撤销、冻结和依赖不可用使用稳定错误码提示且不遮蔽详情。
- 账号安全摘要、当前账号的 Portal 会话撤销、安全事件确认和可信基础平台安全中心跳转。
- 客户反馈创建、本人列表/详情、客户补充、确认关闭、状态与 24 小时 SLA 时间线。
- 已完成项目的服务评价资格、四维 1～5 分可键盘操作表单、提交前平均分汇总和提交后本人只读展示。
- 等保备案列表、创建、详情和固定 `2025.1` 的 7 步向导；按服务端 section version 顺序暂存，409 时停止覆盖并要求刷新。
- 两张等级矩阵使用原生键盘可操作单选控件，支持明确撤销，并同时携带 filing version 与 matrix version。
- 备案提交前执行服务端跨节全量校验；提交使用幂等键，提交后只读并明确标注“Portal 内部锁定”，不声称已经向公安机关提交。
- 备案导航、创建、编辑和提交按 `filing.read/create/update/submit` 门禁；草稿敏感数据不写入浏览器持久存储。
- 页面不提供用户名、密码、改密、MFA 或 Portal JWT 能力，也不注入演示数据。

## 本地基础平台接入

统一 Docker 已提供独立 `portal-mysql`、`portal-migrate`、`portal-api` 和 Nginx 路由。首次不存在 `customer_portal/dev` 时，在 `platform` 目录执行：

```bash
bash scripts/subsystem.sh onboard \
  --preset customer-portal-local \
  --api-base-url http://localhost:8081/api/v1 \
  --platform-origin http://localhost:8081 \
  --account admins
```

接入 Agent 会创建浏览器 OIDC Client、目录发布 Client，以及外部用户预置、角色分配/回收、Portal mapping 建立/禁用、邀请校验六个互不复用的单 scope 服务 Client。它会把凭据写入权限为 `0600` 的 `platform/docker/.env.portal.local` 和 `.env.customer.local`，执行 Portal migration、发布目录，并启动 `portal-api`。已有环境不要重复 onboard，更新使用 `bash scripts/docker-local.sh refresh-portal-api`。

外部客户账号由 CRM“门户访问”页签预置；基础平台保留无初始密码的登录账号，数据库通过外部身份到登录账号的复合外键和唯一键约束映射。平台管理员在“系统设置 → 登录账号”中执行“初始化密码”，只显示一次临时密码并通过安全渠道交付。CRM 显示登录账号，但不会接触或保存密码。

## 外部依赖与未实现项

Portal 已由独立 `cmd/portal-server` 启动，`internal/portalbootstrap` 构造账号、项目、报告 Service 并注册 `/customer-portal` 路由；统一前端的 Router 和模块清单已登记，本地 MySQL、OIDC Client、权限目录和 CRM 邀请链路由部署 Agent 自动配置。项目、报告、对象存储、扫描和公安等业务 Provider 仍按各自能力独立联调，缺失时相关按钮失败关闭，不影响 OIDC 登录和基础门户查询。

备案前端只实现后端固定 schema 中已确认的 2025 字段子集，不宣称是官方完整模板。材料步骤已接受控上传会话、对象直传、完成核验和扫描状态，只有 `CLEAN` 的不可变对象版本才能锁定备案；正式对象存储/扫描 Provider 未配置时后端返回 503。锁定后状态为 `WAITING_CONTRACT`，明确不代表已向公安提交；备案 PDF/export 和公安提交仍失败关闭。管理员解锁只在机器接口，不出现在外部客户 UI。

反馈附件可信上传/病毒扫描、独立客服运营工作台、外部管理层通知和站内联系项目经理尚未完成。项目 PDF 异步导出及受控下载已实现，但仍需部署 CJK 字体/pdfcpu 配置并完成真实 MySQL、浏览器 E2E 和性能验收。报告安全授权与前端下载链路已接入，但真实文件下载仍依赖可信对象读取、信封解密和风险策略的生产适配；依赖未配置时后端返回 503，前端失败关闭。评价只认项目快照权威 `COMPLETED` 状态；低分内部待办和最小样本 5 的匿名机器统计已实现，但 `evaluation.create/read`、`portal.evaluation.read` 仍需基础平台登记，管理层目录与外部消息不在本前端伪造。反馈处理已提供独立 `portal.feedback.manage` 机器接口和内部超时待办投影，仍需基础平台登记该 scope 并由最终归属的内部处理系统联调。IP 属地需要可信 GeoIP/网关来源，当前留空；平台级账号状态、密码、MFA、账号恢复与全局登录失败明细归属基础平台，Portal 不复制这些能力。
