# 合同管理前端模块

2026-10-22 按真实表单、客户端请求、路由鉴权、Service、数据库事务及装配核实。用户步骤见[合同管理操作手册](../../../../sharedDocs/10_操作手册/合同管理操作手册.md)，纠正与依据见[核验台账](../../../../.ai/modules/operation-docs-business-20261013.md)。本文不证明当前环境已经部署或完成动态验收。

## 当前页面

- 仪表盘；
- 合同列表、创建和详情；
- 模板上传、字段维护、正文替换与预览；草稿返回编辑；
- 受独立权限控制的签单关联核对队列、详情与一次性人工核对；
- 审批待办和审批动作；
- 审批规则管理；
- 签署台账、快递登记、签收、回传 PDF 与人工签署核验；
- 统计报表（部分分布来自最多 200 条已加载明细）；
- 审计入口；
- 通过 `/api/v1/auth/me` 恢复合同角色和权限。

当前页面只调用合同后端实际存在的接口。没有后端接口的业务页面不放入模块导航。

签单关联核对使用 `opportunity_intake.read` 和 `opportunity_intake.process` 两项独立权限。列表使用 `items/page_size/next_cursor/has_more` 响应和 opaque keyset cursor 加载更多；筛选切换会清空旧游标并用请求序列阻止旧响应覆盖新结果。API 客户端在滚动发布期间仍能读取旧后端的数组响应，但不会为旧响应伪造游标。处理请求绑定服务端版本和页面内稳定的 `Idempotency-Key`；网络或服务错误后重试复用同一键，明确的版本/状态冲突会刷新详情后要求重新确认。`LINK_CONFIRMED` 会持久化既有合同与 CRM 客户、商机的权威关联和不可变证据；`LINK_EXCEPTION` 只保存异常证据。两种结论都不创建合同、不修改合同状态，也不启动审批。

## 路径

统一入口：

```text
http://localhost:8081/contract_management/
```

前端路由基准为 `/contract_management/`，合同 API 使用同源：

```text
/contract_management/api/v1/*
```

登录、回调和退出使用：

```text
/contract_management/auth/login
/contract_management/auth/callback
/contract_management/auth/logout
```

## 认证与错误处理

- 页面不读取平台 `bp_session`；合同后端维护独立 Cookie。
- 首屏先调用 `/api/v1/auth/me`，成功后再加载业务数据。
- `401` 表示合同本地会话失效；清空前端身份状态并展示重新登录入口。
- `403` 表示已登录但缺少权限；不能通过重新登录规避。
- 菜单和按钮权限不能替代后端权限、可信租户和平台实际数据范围校验。仅销售角色的 contract.read/contract.edit（含状态变更）统一收紧为本人合同；其他角色仍须实际范围。

合同 OIDC 会话持久化在合同数据库中，API 重启本身不会使有效会话失效；会话仍受 Token 生命周期、授权复核和 OIDC 后通道注销约束。

## 操作结果边界

草稿编辑依据服务端 `can_edit_draft`；须有 `contract.edit`、实际数据范围，且是 admin 或草稿创建销售。保存携带 `expected_version`，先保存再审批，审批失败不撤销保存。外部 DOCX 的金额/币种不能在编辑表单单独改写。

审批客户端等待返回 `command_id` 出现在详情持久化动作中，终态再核对合同状态，202 不是业务完成。签署台账 `completed` 不等于合同履约 `completed`；催办登记只记录次数，没有客户短信发送。文件上传错误可能已有 BLOB/草稿落库，重试前查详情避免重复创建。

盖章PDF按版本和SHA-256保留不可变证据，确认绑定当前版本/摘要，已确认文件更换需原因并重新核验，归档后拒绝更换。签署台账由服务端筛选分页并返回全量统计，详情以内部合同ID请求，不能把展示编号当ID。金额按currency_totals分币种汇总。

当前客户端没有通用生命周期状态变更调用入口，不把后端 API 写成已有按钮。新建/编辑草稿现在有独立付款计划区域，支持真实分期号、到期日及合同币种金额；金额用十进制转换和精确合计校验，随 `payment_terms` 保存并按版本冻结。模板正文付款变量仍不自动生成分期。已有无分期合同保持为空，页面明确提示其不会生成结算应收计划。

模板合同维护付款计划时同样可选择 CRM 客户，商机保持可选；提交前刷新 CRM 的当前访问范围，后端继续独立复核。详情和审批页面显示已保存的只读付款计划。审批生效由后端事务性财务 Outbox 与出站 Dispatcher 衔接结算，实际投递需要平台下发专用机器身份和启用配置；浏览器保存成功不代表应收已生成。

完整链路入口：[页面处理](views/ContractManagementView.vue) → [API](api/contract.js) → [HTTP Router](../../../../contract_management/internal/transport/httpapi/router.go) → [Service](../../../../contract_management/internal/application/service.go) / [草稿](../../../../contract_management/internal/application/draft.go) → [审批事务](../../../../contract_management/internal/infrastructure/mysql/repository.go)、[签署事务](../../../../contract_management/internal/infrastructure/mysql/contracts.go) → [API 装配](../../../../contract_management/cmd/api/main.go)、[Worker 装配](../../../../contract_management/cmd/worker/main.go)。
