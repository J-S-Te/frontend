# 合同管理前端模块

## 模块定位

本目录用于存放合同管理系统的前端代码，包括合同台账、合同审批、履约跟踪、变更管理及合同归档等业务功能。

## 当前状态

已实现合同管理前端模块，唯一入口路由为 `/contract_management/dashboard`。当前页面使用前端示例数据展示工作台、客户查询、合同台账、合同模板、审批中心、审批规则、签署台账及统计报表；审计日志和系统设置复用基础能力平台已有页面。

## 推荐结构

```text
contract_management/
├── api/          # 合同管理后端接口封装
├── components/   # 模块内部复用组件
├── views/        # 路由级业务页面（当前入口 ContractManagementView.vue）
├── styles/       # 模块专属样式（contract-management.css）
├── utils/        # 模块工具函数
└── README.md
```

## 接入要求

- 复用基础平台提供的身份认证、权限控制、审计、配置、日志和站内信能力。
- 不在前端保存用户密码、访问令牌或其他敏感凭据。
- 后端接口统一通过模块内 `api/` 目录封装，并携带合同后端签发的 HttpOnly 会话 Cookie；不得把平台控制台会话当作合同系统会话。
- 新增路由时统一注册到 `src/router/index.js`，避免在组件中直接判断浏览器路径。
- 通用组件优先复用 `src/modules/platform/shared/`，避免重复实现基础能力。
- 业务操作应由后端执行权限校验并记录审计事件，前端权限控制仅用于界面展示。
- `frontend/prototypes/contract-management.html` 仅作为静态视觉参考，不承载业务实现。
