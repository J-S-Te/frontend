# 合同管理前端模块

## 当前页面

- 仪表盘；
- 合同列表、创建和详情；
- 受独立权限控制的签单关联核对队列、详情与一次性人工核对；
- 审批待办和审批动作；
- 审批规则管理；
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
- 菜单和按钮权限不能替代后端权限及负责人数据范围校验。

合同 API 重启会使当前进程内存会话失效，用户需要重新完成 OIDC 登录。
