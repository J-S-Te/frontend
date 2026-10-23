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
2. **业务子系统接入**：基础平台“应用接入”同时提供目录登记与统一接入向导。`subsystem-directory` 仅登记应用、环境和 home 登录目标；向导经 `subsystem-access/preview` 检查、操作者确认后提交持久化 operations，由服务端决定首次接入/接管/更新/重试，并执行认证、部署、就绪阶段。WAITING/FAILED 需补齐条件后显式恢复，前端不绕过批准、镜像、许可或登录门禁。遗留 `subsystem-onboarding` API/CLI 与当前向导是不同执行入口，不能互相冒充；`scripts/subsystem.sh` 只用于已有授权的自动化/故障排查。

除基础能力平台自身外，子系统门户只显示 `GET /api/v1/portal/applications` 返回的已接入应用。仅创建目录或添加 `module.js` 不会自动生成可访问卡片，也不会绕过租户、应用状态和接入配置校验。

首次接入成功后，普通前端代码提交、镜像构建和发布不需要再次 onboard，也不应先 offboard。子系统开发、安全配置、OIDC 回调、HTTP LAN 联调和验收要求统一以 `platform/docs/subsystem-onboarding.md` 为准。

## 门户卡片生成规则

- 基础能力平台：内置卡片，使用 Vue Router 打开本地设置页面。
- 同仓库业务模块：必须先通过基础能力平台接入；后端目录返回后，门户才使用模块清单补充展示信息。
- 独立部署或第三方子系统：同样通过基础能力平台接入；即使没有本地 `module.js`，门户也会使用后端返回的名称、描述和公开地址生成卡片。
- 浏览器只访问门户公开地址；子系统内部端口只配置为网关 UpstreamURL，不直接暴露给用户。

## 未使用代码清理边界（2026-09-08）

已清理当前入口引用图中只有定义或仅测试调用的旧 API 包装器与工具，包括未接入的岗位角色展开、登录目标应用选项工具；对应独立测试或专属断言随实现删除，现行权限、目录同步和路由校验测试保留。删除前端包装器不等于删除后端 API，也未移除任何 npm 直接依赖。

### 当前接线校准（2026-10-13）

`platform/files/components/FileTaskOperationsModule.vue` 已由 `PlatformConsoleView.vue` 的 `jobs` 设置页装配，可从“文件与任务”进入；其可见性仍受当前平台权限控制。原“尚未接入”的描述已失效。任务提交成功不等于文件已生成，需检查任务完成状态、结果文件及下载授权；独立 File Gateway 与平台文件任务各有职责，不能把所有子系统文件当作平台文件列表可直接管理的数据。

核验链路：`platform/auth/utils/platformConsoleAccess.js`（入口权限）→ `platform/views/PlatformConsoleView.vue`（组件装配）→ `platform/files/components/FileTaskOperationsModule.vue`（操作及 API 调用）→ 平台 Router、文件/任务服务与 Worker。业务用法参见 [`sharedDocs/操作手册`](../../../sharedDocs/10_操作手册/README.md)。

## 关联目录刷新契约（2026-10-17）

基础平台的组织、岗位、人员、任职、应用角色目录与岗位授权模板之间存在“写入方 → 关联读取方”的依赖。写入成功后必须让其他页面重新读取目录，而不是让它们继续使用打开页面时的快照。

- 失效通知由 API 封装层（`platform/iam/api/`、`platform/applications/api/`、`platform/login-targets/api/`）在**服务端确认写入成功后**发布，页面不各自实现第二套事件规则。
- 通知只携带资源类别和当前会话范围，不携带员工信息、角色明细或凭据；缓存与在途响应按租户 + 用户隔离，退出登录或换号后旧结果不会进入新会话。
- 依赖目录的表单**每次打开都重新校验**，不做“数组非空就永久复用”；同一时刻的重复读取合并，读取失败必须显示受控原因与重试入口，不能伪装成空目录。
- 目录确认返回新数据前不得放行下一步或提交；只清除确实失效的选择项，其余已填写内容保留。
- 不引入服务端推送、常驻轮询或跨设备实时同步；其他标签页的改动在重新打开表单或窗口重新获得焦点时被发现。

机制、发布位置与验证入口见[关联数据刷新上下文](../../../.ai/modules/related-data-refresh.md)。

## 请求错误与回归入口

各模块保留实际响应协议，共享 `shared/utils/userError.js` 只转安全提示并保留原 status/code/details/请求标识。平台、合同、CRM、门户和 BI 采用成功信封，项目/结算采用各自 data 信封；合法空内容、会话失效、无权限、接入配置失败和写入结果未知必须分别处理。多步写入通过结构化 partialCompletion 保留已确认事实，不能根据中文报错猜成功或自动重复提交。具体约束见[前端错误上下文](../../../.ai/modules/frontend-errors.md)。

`npm test` 由 `src/test/run-tests.mjs` 递归发现项目自有 `*.test.mjs`，不再依赖少量显式 glob；可用 `node src/test/run-tests.mjs --list` 只读检查发现清单。文档同步仅核对入口，不把历史测试数字当作本轮通过。
