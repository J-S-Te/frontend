# 结算与开票前端模块

2026-10-22 已贯通页面/表单、客户端、HTTP 权限/租户、Service 账务事务、迁移及 API/Worker 装配。角色条件、步骤与成功/失败判断见[结算与开票操作手册](../../../../sharedDocs/10_操作手册/结算与开票操作手册.md)，历史逐文档纠正见[2026-10-13 台账](../../../../.ai/modules/operation-docs-business-20261013.md)。本次未部署或运行新动态验收，保留原型/需求用途，不据此宣称真实 Provider 已接通。 本轮静态记录见[2026-10-22 文档同步报告](../../../../.ai/qa/docs-code-sync-20261022/agents/project-bi-settlement-report.json)。

该模块通过 `/settlement` 进入，API 使用 `/settlement/api/v1`，并保持独立的 Settlement 会话边界。门户是否展示该模块仍以后端应用目录登记为准。

页面按原始 HTML 原型的信息架构提供结算总览、可调整并留痕的应收计划确认、开票申请审批/驳回、发票台账与详情、电子发票归档/下载、红冲申请、回款登记与匹配建议、核销与冲销、账龄催收及催收策略；金额和状态均以后端事务返回为准，前端不保存账务投影或模拟数据。

## 当前实现约束

- 页面通过独立子系统会话访问 /settlement/api/v1，菜单不能替代后端精确权限；当前账务仓储主要以可信租户过滤，不推断个人/组织/项目行范围已实现。回款查询与登记共用 settlement.receipt.record；核销查询/匹配/确认共用 settlement.allocation.confirm，冲销另需 settlement.allocation.reverse。
- 结算总览按当前页面分区加载目标接口，避免每次切换路由都请求全部模块；请求代次用于丢弃离开页面后的过期响应。单个接口失败不得被误认为业务数据为零，正式环境应展示可诊断的局部失败状态。
- “发起开票申请”的下拉查询已确认且扣除已开/占用额度后仍可开的应收；存在部分额度占用并不必然完全排除该应收。结算受理财务事件 → 待确认计划 → 财务确认 → 正式应收，合同侧已有付款计划和财务事件 Outbox/补建/投递链；总额匹配的人工付款计划、出站开关、独立机器凭据和结算入站均满足后才送达，不能把合同 active/签署 completed 视为自动送达。无计划先查受保护事件集成，不通过前端或数据库造应收。单期确认调整不重新保证跨期合计等于合同额，需人工核对。
- 开票申请读取使用独立的 `settlement.invoice.read` 权限，提交、复核和开具分别使用 request/approve/issue 权限。人工登记按钮只对服务端标记为 `MANUAL` 的待开具申请显示；税控模式的申请不能从浏览器切换成人工登记。
- “回款核销”登记人工到账事实并读取匹配建议，不校验真实银行到账，也不自动核销；“核销与冲销”保存分配/冲销证据，不能覆盖历史分配。原核销确认人不能冲销该分配；冲销恢复两侧余额；应收从结清转为未结清时按应收期补偿实际结清事件，而非仅按被冲销的分配查找。不执行退款、发票红冲或合同状态回退。
- 电子发票上传保留浏览器 multipart boundary，经结算 API 校验发票归属和文件内容后进入统一文件网关；下载只使用结算后端返回的附件 ID，并写入审计。详情优先显示实际票面 `items`，申请依据 `request_items` 另列；符号或三项合计不符、红票缺行返回冲突，旧蓝票使用申请明细时明确标注。红冲先提交财务复核，申请人不得复核自己的申请；仅复核通过后进入税控处理，浏览器不会提前改变原发票状态。
- 账龄导出走服务端异步 CSV 任务，当前查询上限 10000 行而非全部应收。READY 后仅申请人下载，有效 7 天；前端约 30 秒停止等待不取消后台任务；Worker 以心跳租约、owner/generation 防止接管后的迟到发布，网关副作用有持久化补偿。业务下载 Handler 读任务 BLOB，电子发票下载走网关，不能混同。
- 返回门户尝试关闭标签页，浏览器不允许关闭时回退门户路由。“退出”按钮实际调用平台 logoutCurrentSession，成功或 401 后转前端登录页；不是该按钮直接调用结算 /auth/logout。结算 /auth/logout 本身只撤销库会话、清 Cookie、跳 /settlement/logged-out，local-logout 返回 204；Discovery 存储 endSession 但未调用，不能宣称结算 RP 统一退出已完成。

## 成功判断与失败处理

开票申请占用可开额度，批准/驳回必须由另一位人员执行，成功后刷新申请状态和余额。manual 默认模式批准后仅建人工登记任务；tax_adapter 仅走税控，人工登记拒绝；红冲也需另一人复核，人工模式不能批准红冲。ACCEPTED 是受理不是开具，ISSUE_UNKNOWN 按原 external_request_id 对账，不重复申请第二张票。明确税控失败且无已开票/Provider冲突时，非申请人的审批者可带当前版本和5～1000字原因执行失败复核，只回待审核，须再审批后才开具；结果未知不得复核重开。

列表使用 limit/offset 分页，客户端默认50、最多100，页面可翻页；本地筛选/“我的待办”仍基于已加载页；催收 KPI 使用服务端 `dunning/overview` 全量汇总，TOP10 与数据库 dashboard 另行查询，不把局部列表当全库总账。催收扫描按策略间隔生成后续动作、升级案件并在结清时关闭/取消待办动作；催收动作需由接收人或管理员确认完成。

客户端页面内幂等缓存用于网络/服务错误后复用请求键，整页刷新不会永久保留；收到错误先查台账和余额，防止业务成功但后续匹配/刷新失败引起重复登记。版本冲突先重载，不强行覆盖。电子文件扩展/MIME 检测不是税务验真，OFD 允许 ZIP、XML 允许 text/plain，须人工核对实际票据。

## 完整链路入口

[页面与操作表单](views/SettlementView.vue) → [API/幂等缓存/独立会话](api/settlement.js) → [路由、权限、文件与下载](../../../../Settlement/internal/httpapi/api.go) → [事件/计划/回款/核销事务](../../../../Settlement/internal/service/service.go)、[开票/红冲/冲销](../../../../Settlement/internal/service/operations.go)、[税控最终结果](../../../../Settlement/internal/service/tax_callback.go) → [账务迁移](../../../../Settlement/migrations/000001_settlement_core.sql)、[税控迁移](../../../../Settlement/migrations/000010_tax_adapter_callbacks.sql) → [API 装配](../../../../Settlement/cmd/api/main.go)、[Worker 装配](../../../../Settlement/cmd/worker/main.go)。

退出按钮另经[平台退出客户端](../platform/auth/api/auth.js)；结算本地退出规则以[Authenticator 完整实现](../../../../Settlement/internal/platform/auth.go)为准。平台退出响应/前端跳转不替代独立子系统或 IdP 的真实注销验收。

## 验证

以下为已有测试入口参考，本次未运行。前两项在 frontend 根目录执行；Go 项在工作区 Settlement 目录执行，不能从 frontend 下 cd Settlement。

```bash
node --test src/modules/settlement/settlement-ui.test.mjs src/modules/settlement/api/settlement.test.mjs
npm run build
```

结算后端独立目录的参考命令为 go test ./...，测试数据库必须使用隔离的测试配置。现有只读测试能佐证契约，不能替代真实税控、文件网关、通知或银行验收。

数据库业务链路测试默认跳过，需要显式设置 `SETTLEMENT_E2E_TEST=1` 并连接测试数据库；测试必须通过业务 API/事件链路生成应收，不得直接插入应收表。
