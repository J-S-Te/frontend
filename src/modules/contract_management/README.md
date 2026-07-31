# 合同管理前端模块

## 当前页面

- 仪表盘；
- 合同列表、创建和详情；
- 审批待办和审批动作；
- 审批规则管理；
- 审计入口；
- 通过 `/api/v1/auth/me` 恢复合同角色和权限。

当前页面只调用合同后端实际存在的接口。没有后端接口的业务页面不放入模块导航。

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
