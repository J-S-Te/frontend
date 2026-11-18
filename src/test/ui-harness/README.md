# UI harness 说明（布局 / 交互证据脚本）

本目录的 `*-browser.mjs` 都是**真实浏览器渲染**的隔离夹具脚本，默认使用 Chrome，不是单元测试。
它们只读取真实组件/样式，用合成数据在浏览器内渲染，禁止访问业务 API、业务库或写业务数据。

`npm test` 只收集 `*.test.mjs`（`src/test/run-tests.mjs`），所以本目录进入 `npm test`
的只有 `settlement-role-browser.test.mjs` 的**静态**断言（校验夹具源码语义，不启动浏览器）。

## 哪些进 CI，哪些必须手工

| 脚本 | 渲染方式 | 进 CI | 额外依赖 |
| --- | --- | --- | --- |
| `responsive-boundaries-browser.mjs` | `page.setContent` 内联渲染 | **是**（`npm run test:layout`，CI `layout` job） | 仅 Chrome |
| `sidebar-user-browser.mjs` | `page.setContent` 内联渲染 | 否 | 仅 Chrome |
| `sidebar-username-browser.mjs` | `page.setContent` 内联渲染 | 否 | 仅 Chrome |
| `sidebar-scrollbars-browser.mjs` | 内联真实 AppShell、原生侧栏模板、ServiceItemPicker 与模块 CSS | 否（opt-in） | 默认 Chrome；可选择已安装的 Playwright WebKit / Firefox |
| `action-buttons-browser.mjs` | 访问 dev server 的 `action-buttons.html` | 否 | **手工 dev server** |
| `priority-browser.mjs` | 访问 dev server 的 `priority.html` | 否 | **手工 dev server** |
| `pagination-layout-browser.mjs` | `page.setContent` 内联渲染真实 PaginationBar + 模块 CSS | 否 | 仅 Chrome |
| `first-run-browser.mjs` | 路由合成 `page.goto` + 内联真实组件/CSS | 否 | 仅 Chrome |
| `reimbursement-page-browser.mjs` | 内联真实报销页面/组件/CSS；可单选票据复核或维护 | 否（opt-in） | 仅 Chrome，无后端/数据库 |
| `contract-approval-browser.mjs` | 内联真实审批刷新函数、命令组合函数和弹窗按钮模板 | 否（opt-in） | 仅 Chrome，无后端/数据库 |
| `contract-crm-prefill-browser.mjs` | 内联真实合同字段组件、编辑器、CRM API及视图选择动作 | 否（opt-in） | 仅 Chrome，无后端/数据库 |
| `settlement-role-browser.mjs` | 自起 Vite + 隔离夹具后端/MySQL | 否（opt-in） | 隔离夹具会话 + 隔离 MySQL + 后端 |

进 CI 的只有 `responsive-boundaries-browser.mjs`：它不依赖 dev server、不依赖后端，
断点断言（6 档视口 × 模块/壳层顺序/真实向导弹层/确认弹层）在浏览器内完成，失败时会打印
具体 `module / width / height / order` 与命中的边界断言。

其余脚本保留为**手工证据脚本**：`action-buttons-browser.mjs` 与 `priority-browser.mjs`
依赖手工另起的 Vite dev server（默认端口分别 5187 / 5179，`vite` 本身默认 5173 + strictPort），
端口不可在 CI 复现，因此未接入 CI。

### 平台导览 / 上手清单交互回归

```bash
CHROMIUM_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  node src/test/ui-harness/first-run-browser.mjs
```

用真实 `FirstRunGuideHost` / `FirstRunChecklistPanel` 组件和真实 `first-run.css`，在隔离页面里验证
600ms 延迟启动、层级 9000、焦点锁 / 滚动锁 / 关闭还原焦点、Esc / 跳过终态、遮罩点击不关闭、
缺锚步骤跳过、header 缺锚不启动、清单 5 项与权限可见性、第 ④ 项只读探测
（`GET /api/v1/users?page=1&page_size=1`，后端 total 排除初始化超管后 `total>=1` 完成，合成响应）、
窄屏 ≤640px 底部面板、锚点在视口外时先 `scrollIntoView` 定位，以及门户默认深色通过
`createDocumentThemeOverride()` 覆盖 `<html data-theme>` 后实际渲染色与恢复。请求全部在浏览器内
以合成响应处理；证据写入 `.ai/qa/first-run-guide-20261107/browser/<FIRST_RUN_RUN_LABEL>/`。

### 分页条布局回归（错位 / 换行）

```bash
CHROMIUM_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  node src/test/ui-harness/pagination-layout-browser.mjs
```

用真实组件 + 真实模块 CSS 在 `crm / contract / settlement / console / project / portal /
login-target` 七种列表页容器里渲染分页条，在 1440 / 1024 / 900 / 820 / 768 / 700 /
640 / 600 / 561 / 390 十档视口检查「单行右对齐、控件同高、跳页输入 60px、窄屏不重叠
不孤字、主次与禁用态一致」，并验证模块通用按钮 / 输入框规则没有改写分页条尺寸、
`overflow: hidden` 的卡片没有把「下一页 / 跳至 / 每页」裁掉。证据（`results.json` +
截图）写到 `.ai/qa/pagination-bar-layout-20261107/<label>/`。

## 环境变量

| 变量 | 作用 | 默认 |
| --- | --- | --- |
| `CHROMIUM_PATH` | Chrome/Chromium 可执行文件路径（所有脚本都走 env 兜底） | macOS `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome` |
| `SIDEBAR_BROWSER` | 侧栏滚动条专项浏览器：`chromium` / `webkit` / `firefox` | `chromium` |
| `SIDEBAR_CASE` | 侧栏滚动条专项单场景，见下方说明 | 全部 12 种导航 |
| `SIDEBAR_OUTPUT_DIR` | 侧栏滚动条专项 JSON 与截图目录 | `/tmp/frontend-sidebar-scrollbars` |
| `HARNESS_BASE_URL` | 手工 dev server 的基地址（`action-buttons-browser.mjs`、`priority-browser.mjs`） | `http://127.0.0.1:5187` / `http://127.0.0.1:5179` |
| `PAGINATION_RUN_LABEL` | 分页条布局证据子目录名（`[A-Za-z0-9_-]{1,48}`） | `latest` |
| `PAGINATION_OUTPUT_DIR` | 分页条布局证据输出目录 | `.ai/qa/pagination-bar-layout-20261107/<label>/` |
| `LAYOUT_RUN_LABEL` | 断点回归证据子目录名（`[A-Za-z0-9_-]{1,48}`） | `latest` |
| `SETTLEMENT_ROLE_BROWSER_FIXTURE` | 结算角色夹具的 JSON（`origin` 必须是 `127.0.0.1:18173`，`apiBase` 同回环） | 无，缺失即断言失败 |
| `SETTLEMENT_ROLE_BROWSER_CASES` | 选择结算角色用例（逗号分隔） | 全集 |
| `SETTLEMENT_BROWSER_RESULT_DIR` | 结算浏览器证据输出目录 | `.ai/qa/settlement-role-integration-20261028/browser/` |

`playwright-core` **不下载浏览器**，默认场景需要可用 Chrome/Chromium；CI 里由
`layout` job 先解析再导出 `CHROMIUM_PATH`。侧栏专项选择 WebKit / Firefox 时，
需要预先安装与当前 Playwright 版本对应的引擎；脚本不会自动安装或跳过启动失败。

## 本地怎么跑

### 1. 断点回归（与 CI 同一条命令）

```bash
CHROMIUM_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" npm run test:layout
```

Linux/CI 形态：

```bash
CHROMIUM_PATH=/usr/bin/google-chrome npm run test:layout
```

证据（`results.json` + 部分宽度截图）写入仓库外的工作区目录
`.ai/qa/responsive-boundaries-20261103/<LAYOUT_RUN_LABEL>/`；重复跑想保留旧证据时给标签：

```bash
LAYOUT_RUN_LABEL=local-20261106 CHROMIUM_PATH=/usr/bin/google-chrome npm run test:layout
```

失败时退出码非 0，且 stdout 会带 `examples`，每条含 `module`、`width`、`height`、`order`、`errors`。

当前覆盖 8 个模块骨架（platform / contract / project / crm / portal / settlement / analysis /
reimbursement）：CSS 只读真实模块样式，合成超长文本与 240 字符 token 驱动边界；窄容器栅格循环
包含报销 `.expense-grid`（180px 内容宽度必须单列、不溢出）。报销模块额外
挂载真实 `ArchivePackagePanel`、`PaymentExceptionPanel`、`ClaimSyncPanel` 与共享 `ErrorState`，
所有请求用浏览器内 `fetch` 合成响应（档案包任务直接返回 `DONE`、同步状态返回快照缺失、
失败态返回 503），不访问真实后端；表体使用 `.expense-table-body` 稳定挂点，375px 断言真实 5 列
异常表由 `.expense-table` 横向滚动并保留 880px 可读宽度；同一断言语义也覆盖付款历史（7 列）与
冲正历史（4 列）两张分页历史表（`actual-reimbursement-history-tables`，合成行沿用真实模板单元格
形状）；证据截图包括 `reimbursement-page-*`、`reimbursement-form-grid-*`、
`reimbursement-table-375-viewport.png`、`reimbursement-exception-table-375-*`、
`reimbursement-payment-history-375-*`、`reimbursement-reversal-history-375-*`、
`reimbursement-history-*`、`reimbursement-panels-*`、`reimbursement-error-*`、
`reimbursement-sync-error-375-*`。历史表这类结构由
`src/modules/reimbursement/views/ReimbursementView.test.mjs` 的真实模板 SSR 断言兜住挂点，
浏览器夹具只负责几何。

### 2. 需要手工 dev server 的脚本

`vite.config.js` 默认 `5173` + `strictPort`，用 CLI `--port` 覆盖：

```bash
# 终端 A
npm run dev -- --port 5187
# 终端 B
node src/test/ui-harness/action-buttons-browser.mjs
# 换端口/主机时用 HARNESS_BASE_URL（脚本会同步 goto 与 route 的基地址）
HARNESS_BASE_URL=http://127.0.0.1:6001 node src/test/ui-harness/action-buttons-browser.mjs
```

```bash
# 终端 A
npm run dev -- --port 5179
# 终端 B
node src/test/ui-harness/priority-browser.mjs
```

### 3. 内联渲染、只缺 Chrome 的脚本

```bash
node src/test/ui-harness/sidebar-user-browser.mjs
node src/test/ui-harness/sidebar-username-browser.mjs
```

侧栏滚动条专项可单独执行一个导航，避免启动全业务验收：

```bash
SIDEBAR_CASE=platform node src/test/ui-harness/sidebar-scrollbars-browser.mjs
SIDEBAR_CASE=platform SIDEBAR_BROWSER=webkit node src/test/ui-harness/sidebar-scrollbars-browser.mjs
```

可选场景为 `platform / crm / portal / settlement / reimbursement / contract / project /
analysis / iam / applications / dictionaries / project-queue`。省略 `SIDEBAR_CASE` 时只运行
上述导航专项，覆盖 1280×560 和 760×560、明暗主题、菜单展开/折叠、点击、键盘聚焦与滚轮。
共享壳层与项目队列使用真实组件，其余导航采用真实模板或同结构合成列表及模块 CSS；
所有外部请求拦截，不需要 dev server、后端或数据库。JSON 记录侧栏各滚动容器的
滚动条样式与滚动范围；另保存基础平台侧栏截图。这是隔离 UI 验证，不替代真实登录业务验收。

### 4. 结算角色 opt-in 夹具

需要隔离夹具会话、隔离 MySQL 与对应后端；缺任一条件直接失败，不允许零用例通过。
不提供夹具时改跑静态断言：`npm test`（含 `settlement-role-browser.test.mjs`）。

### 5. 票据复核与维护专项

```bash
PAGE_CASES=invoice-review PAGE_WIDTHS=1440,375 \
  PAGE_OUTPUT_DIR=/tmp/invoice-review-ui \
  node src/test/ui-harness/reimbursement-page-browser.mjs
```

`invoice-review` 验证原件与关键字段优先、进入复核收起台账、返回恢复、行程按类别显隐、
复核金额/明细请求接线和已确认票据只读。`invoice-controls` 验证三种维护操作按需展开、
切换保留输入，以及待独立批准记录和原因输入仍可见；可分别执行，或逗号选择这两种场景。
默认检查明暗主题，`PAGE_WIDTHS` 指定视口。证据包含页面与工作区截图、JSON结果。

此夹具使用真实Vue视图和组件、合成会话/API响应及绘制的样例原件；所有外部请求被拦截。
命令只记录在浏览器内，不连接业务服务、不写业务数据，也不代表真实财务流程验收。
省略 `PAGE_CASES` 会运行原有整套视觉场景；日常票据改动应明确指定单场景。

### 6. 合同审批按钮最小回归

```bash
CONTRACT_APPROVAL_OUTPUT_DIR=/tmp/contract-approval-ui \
  node src/test/ui-harness/contract-approval-browser.mjs active
```

每次只运行一个场景：`active` 悬停“同意”、刷新两次并点击，核对发出 `approve`
和当前节点版本；`pending` 检查待办移出后的动作拦截；`finished` 检查流程终态拦截。
默认只运行 `active`，保存该场景的截图和 JSON 结果；可用 `CHROMIUM_PATH` 指定已安装浏览器。

使用真实视图函数、节点摘要、按钮模板、权限函数与审批命令组合函数；会话和 HTTP
返回为合成数据，外部请求全部拦截。它只验证审批区域交互，不代表完整页面或真实审批验收。

## CI 接线

合同自动带入只运行一个最小隔离场景：

```bash
CONTRACT_CRM_OUTPUT_DIR=/tmp/contract-crm-prefill-ui \
  node src/test/ui-harness/contract-crm-prefill-browser.mjs
```

覆盖选客户、选商机、模板空白值同步、手工修改后换来源，以及编辑模板时旧编号隐藏。
保存截图与 `result.json`；实际会话、目录和联系人 HTTP 均为合成响应，禁止业务写请求，
不代表完整页面或真实后端验收。可通过 `CHROMIUM_PATH` 指定已安装的 Chrome。

`.github/workflows/ci-cd.yml` 的 `layout` job（与 `test` 并列，push/PR 默认执行，
不进入 `image`/`deploy` 依赖链）：`ubuntu-latest` + `timeout-minutes: 15` +
checkout + setup-node(22) + `npm ci` → 解析 Chrome（先试 `/usr/bin/google-chrome`，
再 `command -v google-chrome || command -v chromium`；都缺失则 `::error::` 直接失败，不静默跳过）
→ `npm run test:layout`。


### 历史UI回归入口

`npm run test:vue-lifecycle` 默认仅验证负责人失败重试；使用 `LIFECYCLE_SCENARIO`
选择脚本 allowed 中的一个场景。测试只使用本地组件和合成HTTP，不连接业务数据库。
`LIFECYCLE_OUTPUT_DIR` 指定验收证据目录。

`npm run test:local-ui -- --case=shared-shell-keyboard-theme-collapse` 验证共享壳层；
其他可选单场景为 `dictionary-390`、`dictionary-1440`、
`portal-notification-details`、`topbar-theme-contrast`。字典按当前分组卡片验证，
不恢复历史分页表格。使用 `LOCAL_UI_OUTPUT_DIR` 保存证据，所有外部请求被拦截。
两入口均每次只执行一个场景，可通过 `CHROMIUM_PATH` 指定已安装浏览器。
