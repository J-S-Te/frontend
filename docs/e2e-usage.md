# E2E 使用卡片

日常只需要记三条命令。用例分四层标签，按依赖从少到多排列，任何一层单独跑都不会被其他层拖垮。

## 三条命令

| 命令 | 跑什么 | 依赖 | 耗时 |
|---|---|---|---|
| `npm run e2e:smoke` | 前端渲染与访客门禁，4 条 | 只要 Node 24 | ~5s |
| `npm run e2e:full` | 全部（含视觉断言），打 `localhost:8081` | 本地 Docker 栈在线 + 模型配置 | ~13s |
| `npm run e2e:browser` | 单独起共享浏览器（调试用） | — | — |

`e2e:smoke` 在**没有后端、没有模型、没有凭据**的情况下也应该通过。它绿说明前端本身没坏；它红说明代码有问题，不用怀疑环境。

`e2e:full` 打的是 `localhost:8081`（已部署产物 + nginx 反代到 `platform-api:8080`），不是 `localhost:5173`。

> **注意**：基础能力平台后端**没有映射到宿主机 8080**，`compose.local.yaml` 里它只有 `expose`。宿主机上访问不到 `127.0.0.1:8080` 是设计如此，不是服务挂了。前端开发代理若指向 8080，需要自己再做端口转发；E2E 不需要。

## 标签分层

| 标签 | 用例 | 前置条件 |
|---|---|---|
| `#smoke` | 应用外壳、登录页、路由别名与访客门禁 | 无 |
| `#cdp` | 同页混用校验 | `E2E_VISUAL=1` |
| `#visual` | Midscene 视觉断言 | `E2E_VISUAL=1` + 模型配置 |
| `#backend` | 真实账号登录 | 配置测试账号且后端在线 |
| `#signin` | 线上登录 + 进门户 | `E2E_ONLINE=1` + 线上凭据 |
| `#business` | 线上进入业务子系统 | 同上，可用 `E2E_ONLINE_SUBSYSTEM` 换目标 |
| `#online` | 线上实例冒烟 | `E2E_ONLINE=1` + `APP_URL` |

组合用法：`bash scripts/e2e.sh run --tag smoke --exclude-tag backend`

## 写用例的三条路线

按成本从低到高选，能用上一行就别用下一行：

```ts
// ① 精确定位器：零模型、零成本，首选
await expect(browser.locator('#account')).toBeVisible()
await screen.getByRole('heading', '登录基础能力平台')

// ② agent 步骤：调模型，检查通过后动作写入回放缓存，页面不变则不再调模型
await agent.act('在账号框填入管理员账号')
await agent.assert('进入了子系统门户')

// ③ 视觉断言：只用来判"人眼才看得出"的形态问题（重叠、截断、配色）
await session.agent.aiAssert('表单布局没有重叠或截断')
```

新用例打上对应标签，别让视觉断言混进 `#smoke`。

## 失败了看什么

1. `.e2e/results/<用例>/trace.md` —— 失败步骤、当时的屏幕节点列表、网络错误
2. 同目录 `attempt-1/screenshots/001-failure.png` —— 失败瞬间的截图
3. `.e2e/midscene/report/*.html` —— 视觉断言的截图与模型判定理由
4. `bash scripts/e2e.sh report` —— 打开完整报告

判断标准：**先看是代码错还是用例期望错**。不要为了让用例变绿去改 `src/`。

## 四个已知的坑

- `npm run test:e2e -- --headed` 会把 `--headed` 当文件名，请用 `bash scripts/e2e.sh run --headed`
- `app.url` 的 path 会被丢弃，`app.open('/')` 相对 origin 拼接，子路径部署要写全 `/todomvc/`
- 本地已有有效 Cookie 时访问 `/login` 会被路由守卫跳到 `/portal`，写用例时不要假设一定停在登录页
- 视觉断言必须走共享浏览器（`E2E_VISUAL=1`），e2e 自管理浏览器没有对外连接入口，也没有忽略证书的配置项

## 登录用例报「账号或密码错误」

说明凭据与当前后端不一致，或账号被锁定。用例会直接读出页面提示，不会空等：

```
ERROR: 登录未跳转到门户，也没有接管入口。页面提示：账号或密码错误。
```

本地和线上是两套独立数据，口令不同，变量也分开：

| 打哪套环境 | 用哪组变量 |
|---|---|
| 本地 `localhost:8081` | `E2E_LOCAL_USERNAME` / `E2E_LOCAL_PASSWORD`（未设置时回退 `E2E_ADMIN_*`） |
| 线上 `47.111.20.119:18081` | `E2E_ONLINE_USERNAME` / `E2E_ONLINE_PASSWORD` |

两套都写在 `.e2e-secrets` 里，互不影响。改本地口令后不需要动线上配置。

同一账号已在别处登录时会返回 409 并出现接管入口：本地用例会自动点「退出原会话并登录」；线上用例默认**不接管**，避免踢掉他人的在线会话，需要显式设置 `E2E_ONLINE_TAKEOVER=1` 才接管。

## 线上登录检测

```bash
npm run e2e:online           # 默认打 47.111.20.119:18081
APP_URL=https://其他地址 npm run e2e:online
```

只读：登录 → 确认进入门户 → 读到身份状态，不提交任何业务数据。首次登录会弹「平台导览」模态，断言已兼容该弹窗。

**用例结束时会在 `finally` 里调 `POST /api/v1/auth/logout` 主动登出。** 这一步不能省：关掉浏览器不等于登出，会话状态在服务端，headless 浏览器退出只丢 cookie，服务端仍认为该会话有效，下次登录就会撞 409「已有活动会话」。

### 会话残留了怎么办

用例被强杀（Ctrl+C、进程被 kill）时 `finally` 不执行，会话会残留。清理方式：

```bash
E2E_ONLINE_TAKEOVER=1 npm run e2e:online
```

接管会把该账号在别处的登录全部结束，再走一遍正常的登出流程。**只在你确认没有人在用这个账号时用。**

## 线上业务动作检测

```bash
npm run e2e:online                                  # 三条一起跑
E2E_ONLINE_SUBSYSTEM=结算与开票管理系统 npm run e2e:online   # 换目标子系统
```

登录 → 打开门户 → 点子系统卡片 → 断言落点页面 → 关标签 → 登出。

两个必须知道的点：

**① 子系统是「新标签页」打开的。** 门户的 `openSubsystem` 用 `window.open('', '_blank')`，所以点击后当前页 URL 不变。必须用 `browser.waitForPopup(trigger)` 捕获新标签，否则断言仍在门户页，会误判为"没跳转"。

**② 门户子系统目录是异步加载的。** 登录后卡片不是立刻出现，点击前要轮询 `.subsystem-card`，否则误报"没找到入口"。

用例判定"打开成功"的三条：落点不是登录页、正文没有权限拒绝字样、标题或正文含子系统名且正文非空。三条同时满足才算业务页面真的加载了。

**③ 子系统是懒加载，首屏可能只有「跳到主要内容」。** 实测 8 个子系统里有 5 个首屏正文只有 6 个字符，再等约 4 秒才渲染出完整工作台。只判"正文非空"会把这种空壳当成加载成功，所以统一走 `waitForSubsystemPage` 等到正文真正出现。

这是**只读检测**：不提交单据、不改数据。写动作（提交、审批）必须用隔离租户和测试数据，不能打线上。

## 线上门户全量入口检测

```bash
bash scripts/e2e.sh run --tag portal   # 需同时设置 E2E_ONLINE=1 等
```

一条用例遍历门户里的每个子系统：打开 → 等渲染 → 断言有正文且无权限拒绝 → 关标签。8 个入口约 10 秒，失败时会逐个列出打不开的名称与原因。

## 线上冒烟

```bash
E2E_ONLINE=1 APP_URL=https://47.111.20.119:18081 E2E_SERVER=external \
  bash scripts/e2e.sh run --tag online --exclude-tag signin
```

结构冒烟不需要凭据，也不需要模型。
