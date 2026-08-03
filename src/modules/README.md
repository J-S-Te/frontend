# 前端模块与子系统接入边界

前端业务代码统一放在 `src/modules/<module_code>/`。目录建议包含：

```text
<module_code>/
├── api/          # 后端接口封装
├── components/   # 模块内部复用组件
├── views/        # Vue Router 路由页面
├── styles/       # 模块样式
├── utils/        # 纯函数和工具
├── module.js     # 门户展示元数据（可选）
└── README.md
```

## 两类登记不能混淆

1. **前端模块登记**：在 `src/modules/registry/moduleRegistry.js` 引入模块的 `module.js`，只负责图标、默认名称、默认说明和本地路由等构建期信息。
2. **业务子系统接入**：平台管理员在基础平台“应用接入”页面创建应用环境，由后端原子创建应用、环境、门户登录目标和 OAuth 客户端，再交给隔离部署 Agent。生产管理员不需要执行命令或复制 Secret；`scripts/subsystem.sh` 仅保留给本地自动化和故障排查。

除基础能力平台自身外，子系统门户只显示 `GET /api/v1/portal/applications` 返回的已接入应用。仅创建目录或添加 `module.js` 不会自动生成可访问卡片，也不会绕过租户、应用状态和接入配置校验。

首次接入成功后，普通前端代码提交、镜像构建和发布不需要再次 onboard，也不应先 offboard。子系统开发、安全配置、OIDC 回调、HTTP LAN 联调和验收要求统一以 `platform/docs/subsystem-onboarding.md` 为准。

## 门户卡片生成规则

- 基础能力平台：内置卡片，使用 Vue Router 打开本地设置页面。
- 同仓库业务模块：必须先通过基础能力平台接入；后端目录返回后，门户才使用模块清单补充展示信息。
- 独立部署或第三方子系统：同样通过基础能力平台接入；即使没有本地 `module.js`，门户也会使用后端返回的名称、描述和公开地址生成卡片。
- 浏览器只访问门户公开地址；子系统内部端口只配置为网关 UpstreamURL，不直接暴露给用户。
