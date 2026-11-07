# UI harness 说明（布局 / 交互证据脚本）

本目录的 `*-browser.mjs` 都是**真实 Chrome 渲染**的隔离夹具脚本，不是单元测试。
它们只读取真实组件/样式，用合成数据在浏览器内渲染，禁止访问业务 API、业务库或写业务数据。

`npm test` 只收集 `*.test.mjs`（`src/test/run-tests.mjs`），所以本目录进入 `npm test`
的只有 `settlement-role-browser.test.mjs` 的**静态**断言（校验夹具源码语义，不启动浏览器）。

## 哪些进 CI，哪些必须手工

| 脚本 | 渲染方式 | 进 CI | 额外依赖 |
| --- | --- | --- | --- |
| `responsive-boundaries-browser.mjs` | `page.setContent` 内联渲染 | **是**（`npm run test:layout`，CI `layout` job） | 仅 Chrome |
| `sidebar-user-browser.mjs` | `page.setContent` 内联渲染 | 否 | 仅 Chrome |
| `sidebar-username-browser.mjs` | `page.setContent` 内联渲染 | 否 | 仅 Chrome |
| `action-buttons-browser.mjs` | 访问 dev server 的 `action-buttons.html` | 否 | **手工 dev server** |
| `priority-browser.mjs` | 访问 dev server 的 `priority.html` | 否 | **手工 dev server** |
| `pagination-layout-browser.mjs` | `page.setContent` 内联渲染真实 PaginationBar + 模块 CSS | 否 | 仅 Chrome |
| `first-run-browser.mjs` | 路由合成 `page.goto` + 内联真实组件/CSS | 否 | 仅 Chrome |
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
| `HARNESS_BASE_URL` | 手工 dev server 的基地址（`action-buttons-browser.mjs`、`priority-browser.mjs`） | `http://127.0.0.1:5187` / `http://127.0.0.1:5179` |
| `PAGINATION_RUN_LABEL` | 分页条布局证据子目录名（`[A-Za-z0-9_-]{1,48}`） | `latest` |
| `PAGINATION_OUTPUT_DIR` | 分页条布局证据输出目录 | `.ai/qa/pagination-bar-layout-20261107/<label>/` |
| `LAYOUT_RUN_LABEL` | 断点回归证据子目录名（`[A-Za-z0-9_-]{1,48}`） | `latest` |
| `SETTLEMENT_ROLE_BROWSER_FIXTURE` | 结算角色夹具的 JSON（`origin` 必须是 `127.0.0.1:18173`，`apiBase` 同回环） | 无，缺失即断言失败 |
| `SETTLEMENT_ROLE_BROWSER_CASES` | 选择结算角色用例（逗号分隔） | 全集 |
| `SETTLEMENT_BROWSER_RESULT_DIR` | 结算浏览器证据输出目录 | `.ai/qa/settlement-role-integration-20261028/browser/` |

`playwright-core` **不下载浏览器**，所以任何环境都必须有可用 Chrome/Chromium；CI 里由
`layout` job 先解析再导出 `CHROMIUM_PATH`。

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

### 4. 结算角色 opt-in 夹具

需要隔离夹具会话、隔离 MySQL 与对应后端；缺任一条件直接失败，不允许零用例通过。
不提供夹具时改跑静态断言：`npm test`（含 `settlement-role-browser.test.mjs`）。

## CI 接线

`.github/workflows/ci-cd.yml` 的 `layout` job（与 `test` 并列，push/PR 默认执行，
不进入 `image`/`deploy` 依赖链）：`ubuntu-latest` + `timeout-minutes: 15` +
checkout + setup-node(22) + `npm ci` → 解析 Chrome（先试 `/usr/bin/google-chrome`，
再 `command -v google-chrome || command -v chromium`；都缺失则 `::error::` 直接失败，不静默跳过）
→ `npm run test:layout`。
