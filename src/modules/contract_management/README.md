# 合同管理子系统后端

> 当前基线：2026-07-27。该目录虽然位于 `frontend/src/modules/`，实际内容是一个独立的 Go 后端服务，不是 Vue 前端模块。当前没有合同管理页面、前端路由或前端 API Client。。

## 当前实现范围

当前代码实现了合同核心状态与审批工作流的一个可运行子集：

- 合同草稿创建、列表、详情、提交审批和状态变更；
- 合同状态机：`draft → pending → approved → active → in_progress → pending_pay → completed → archived`，并支持 `terminated → archived`；
- 基于 Temporal 的合同审批和关键状态变更审批；
- 销售总监、技术总监、财务总监三级默认审批节点；
- 审批规则查询、创建、更新和删除，更新/删除使用 `version` 乐观锁；
- 审批同意、拒绝、加签、转交、退回、撤回、催办和评论；
- 每日自动归档 Cron Workflow；
- MySQL 持久化、生命周期事件、审批任务/动作和通知 Outbox；
- 可选的基础平台审计上报。

以下内容尚未实现，不能按原始需求宣称已交付：

- 合同管理 Vue 页面和浏览器端交互；
- 客户/供应商、合同模板、文档生成、签署、OCR、付款计划和统计报表；
- 通知 Outbox 到基础平台站内信的投递器；
- 基础平台 Compose 中的合同 API、Temporal 和合同数据库服务装配；
- 自动注册合同 Application、Environment、网关规则和合同权限的迁移。

## 当前认证与平台接入

当前合同 API 不自行接收密码，也不信任客户端提交的用户或租户 ID。每个 `/api/v1/**` 请求都会：

1. 从浏览器请求读取 `AUTH_SESSION_COOKIE_NAME` 指定的 Cookie，默认是 `bp_session`；
2. 把该 Cookie 转发到基础平台 `GET /api/v1/auth/me`；
3. 使用平台返回的租户、用户和权限构造合同服务 Principal；
4. 在合同应用服务中再次执行权限和租户边界校验。

因此当前联调要求合同 API 与基础平台处于受控同源网关下，并确保平台会话 Cookie 能随 `/contract/api/v1/**` 请求发送。它尚未切换为标准 OIDC Authorization Code + PKCE 后由合同服务本地验证 Token 的模式。

平台返回的 `platform:*` 权限会去掉 `platform:` 前缀并把 `:` 转成 `.`，例如 `platform:contract:create` 可匹配内部的 `contract.create`。基础平台当前没有自动种子合同权限，接入时必须显式创建并授权所需权限，或提供等价的受控权限映射。

写请求可选上报基础审计。只有同时配置以下四项时才启用：

- `PLATFORM_AUDIT_CLIENT_ID`
- `PLATFORM_AUDIT_CLIENT_SECRET`
- `PLATFORM_APPLICATION_CODE`
- `PLATFORM_ENVIRONMENT_CODE`

审计客户端使用 OAuth Client Credentials 获取包含 `audit.ingest` 的机器 Token，再调用基础平台 `POST /api/v1/audit/events`。审计上报错误当前不会阻断合同业务响应。

## 目录

```text
cmd/api                          HTTP 服务
cmd/worker                       Temporal Worker 和自动归档 Cron
internal/domain/contract         合同模型与状态机
internal/domain/approval         审批模型与规则表达式
internal/workflows               Temporal Workflows / Activities
internal/application             用例、权限和工作流启动/Signal
internal/infrastructure/mysql    GORM 仓储、事务和通知 Outbox
internal/infrastructure/platform 平台会话校验与审计上报
internal/transport/httpapi       Gin REST API
migrations                       合同数据库显式迁移
```

Temporal Workflow 只做确定性编排；数据库、通知和审计事实由 Activity 或 HTTP 适配器处理。生产表结构以显式 SQL 迁移为准，服务启动时不执行 `AutoMigrate`。

## HTTP API

`GET /healthz` 不要求登录。其余接口位于 `/api/v1`，均需要有效的平台会话 Cookie。成功和失败响应遵循 `{code,message,request_id,data}`。

| 方法 | 路径 | 内部权限/身份条件 | 当前行为 |
|---|---|---|---|
| POST | `/api/v1/contracts` | `contract.create` | 创建草稿并计算正文 SHA-256 |
| GET | `/api/v1/contracts` | `contract.read` | 查询合同；无 `contract.manage` 时强制只查本人 |
| GET | `/api/v1/contracts/{id}` | `contract.read` | 查询详情；无 `contract.manage` 时只能读取本人合同 |
| POST | `/api/v1/contracts/{id}/submit-approval` | `contract.create`，且为申请人或有 `contract.manage` | 匹配规则并启动合同审批 |
| POST | `/api/v1/contracts/{id}/status-changes` | `contract.edit` | 直接流转或启动关键状态审批；请求必须带 `version` 和 `reason` |
| GET | `/api/v1/approvals/tasks` | `approval.process` | 查询当前用户待办 |
| GET | `/api/v1/approvals/{id}` | `approval.view`、`approval.process` 或申请人 | 查询 Temporal 当前流程状态 |
| POST | `/api/v1/approvals/{id}/approve` | 当前处理人 | 同意 |
| POST | `/api/v1/approvals/{id}/reject` | 当前处理人 | 拒绝，意见必填 |
| POST | `/api/v1/approvals/{id}/sign` | 当前处理人 | 加签；传 `target_user_ids`、`countersign=all/any` |
| POST | `/api/v1/approvals/{id}/transfer` | 当前处理人 | 转交；目标只能有一人 |
| POST | `/api/v1/approvals/{id}/return` | 当前处理人 | 退回已通过节点；传 `target_node_id` |
| POST | `/api/v1/approvals/{id}/withdraw` | 申请人 | 审批完成前撤回 |
| POST | `/api/v1/approvals/{id}/urge` | 申请人或 `approval.manage` | 催办并写通知 Outbox |
| POST | `/api/v1/approvals/{id}/comments` | 可查看该审批的用户 | 记录评论 |
| GET | `/api/v1/approval-rules` | `approval.view` 或 `approval_rule.manage` | 查询规则 |
| POST | `/api/v1/approval-rules` | `approval_rule.manage` | 创建规则 |
| PUT | `/api/v1/approval-rules/{id}` | `approval_rule.manage` | 按请求体 `version` 乐观锁更新 |
| DELETE | `/api/v1/approval-rules/{id}?version=N` | `approval_rule.manage` | 按查询参数 `version` 乐观锁删除 |

审批动作返回 `202` 只表示 Signal 已由 Temporal 接收；最终状态通过审批详情查询，数据库任务和动作记录由 Activity 最终一致地更新。

## 本地运行

要求 Go 1.25.4+、MySQL 8.4+ 和 Temporal Server。从本目录执行：

```bash
cp .env.example .env
docker compose up -d mysql temporal temporal-ui
set -a; source .env; set +a
go run ./cmd/worker
go run ./cmd/api
```

本地 Compose 只启动 MySQL、Temporal 和 Temporal UI，不启动合同 API/Worker，也不启动基础平台。MySQL 初始化执行 `migrations/000001_contract_workflow.sql`；Temporal UI 默认位于 `http://localhost:8233`；合同 API 默认监听 `:8081`。

主要配置：

| 变量 | 用途 |
|---|---|
| `MYSQL_DSN` | 合同数据库连接，必须包含 `parseTime=true` |
| `PLATFORM_BASE_URL` | 基础平台 HTTP(S) Origin，不得包含路径、查询、片段或用户信息 |
| `AUTH_SESSION_COOKIE_NAME` | 入站平台会话 Cookie 名称，默认 `bp_session` |
| `TEMPORAL_ADDRESS` / `TEMPORAL_NAMESPACE` / `TEMPORAL_TASK_QUEUE` | Temporal 连接与任务队列 |
| `APPROVAL_NODE_TIMEOUT` | 单审批节点超时，默认 72 小时 |
| `APPROVAL_REMINDER_INTERVAL` | 提醒间隔，必须小于节点超时 |
| `ARCHIVE_CRON_SCHEDULE` | Temporal Cron 表达式，默认 `0 16 * * *`，对应北京时间零点 |
| `APPROVER_ROLE_ASSIGNMENTS_JSON` | 角色到平台用户 ULID 列表的静态映射 |

生产密钥、数据库密码、Temporal API Key 和真实审批人 ID 必须由受控配置或密钥系统注入，不得提交到仓库。

## 门户与网关接入

当前基础平台不会自动注册合同子系统。管理员需要调用 `POST /api/v1/subsystem-onboarding`，例如使用：

- `application_code=contract_management`
- `public_base_url=https://portal.example.com`
- `upstream_url=http://contract-api:8081`
- `path_prefix=/contract`

然后执行接口返回的 `portal-gateway.sh add ... && reload` 命令。基础平台默认 Compose 只预留动态网关 include 和前端构建变量，不会自动启动本目录中的合同服务。

当前合同路由自身包含 `/api/v1`，所以统一入口应转发 `/contract/api/v1/**` 到合同服务的 `/api/v1/**`。上线前必须实际验证网关是否正确去除 `/contract` 前缀，以及 Cookie、`X-Request-ID`、客户端 IP 和 HTTPS 相关转发头是否符合部署要求。

## 验证

```bash
make fmt
make test
make vet
make build
```

若开发机限制默认 Go 缓存目录，应把 `GOCACHE` 和需要时的 `GOMODCACHE` 指向可写目录。数据库集成测试应在应用迁移后对 MySQL 执行；Temporal 版本升级和 Workflow 代码变更必须保留 replay/兼容性验证。

## 已知边界

- 通知只写入 `con_notification_outbox`，当前没有投递到基础平台站内信的 Worker。
- 合同写请求的审计上报是可选且失败不阻断业务，不应把它描述为强一致审计。
- 当前浏览器认证依赖平台 Cookie 转发到 `/auth/me`；标准 OIDC 本地验签是后续演进，不是当前实现。
- 当前没有合同 Vue 页面；前端构建参数 `VITE_CONTRACT_API_BASE_URL` 不代表已有可用界面。
- 合同模块使用独立 MySQL Schema 和 Temporal，不属于基础平台 `platform/backend` 的模块化单体数据库。
