# e2e × Midscene 联动使用

## 一、为什么必须走 CDP

e2e 的 `Browser` 是封装层，**不暴露底层 Playwright `Page`**（`BrowserTab` 只有 `url / title / isActive / activate / close`，没有截图 API）。所以不能在用例进程里 `new` 一个 Midscene agent 指向 e2e 的页面。

可行路径只有一条：

```
e2e ──connect(cdpEndpoint)──> 外部 Chromium <──connectOverCDP── Midscene
                                   同一页面、同一 DOM
```

e2e 通过 `e2e.config.ts` 里的 `connect: { cdpEndpoint }` 连外部 Chromium，Midscene 连同一个端点后按 URL 找到同一个页面。**共享浏览器，也共享页面**，两边操作互见。

## 二、三条命令

| 命令 | 干什么 | 要不要模型 |
| --- | --- | --- |
| `npm run e2e:smoke` | 只跑 `#smoke`，外壳级检查 | 不要 |
| `npm run e2e:full` | 自动起共享浏览器，跑全部（除 `#online`） | 视觉用例要 |
| `npm run e2e:browser` | 只起共享浏览器，打印 `E2E_CDP_ENDPOINT=` | 不要 |

`E2E_VISUAL=1` 会触发 `scripts/e2e.sh` 自动起浏览器、注入端点、跑完 `trap` 回收，不用手动开两个终端。

模型配置在 `frontend/.e2e-secrets`（被 gitignore）：

```bash
MIDSCENE_MODEL_NAME=deepseek-flash
MIDSCENE_MODEL_API_KEY=...
MIDSCENE_MODEL_BASE_URL=https://api.deepseek.com
MIDSCENE_MODEL_FAMILY=deepseek
```

必须是 `deepseek-flash`——DeepSeek 只有这个型号支持 Vision。

## 三、写一条联动用例：只有一个入口

```ts
import { expect, test } from 'e2e'
import { hasMidsceneModel, openMidscene } from './support/midscene'

test('登录页：视觉断言与确定性断言同页并存', { tags: ['visual'] }, async ({ app, browser }) => {
  const endpoint = process.env.E2E_CDP_ENDPOINT
  if (!endpoint) test.skip(true, '未配置 E2E_CDP_ENDPOINT')
  if (!hasMidsceneModel()) test.skip(true, '未配置视觉模型')

  const session = await openMidscene({ app, browser, endpoint, path: '/login' })

  try {
    // e2e 侧：确定性断言，零模型成本
    await expect(browser.locator('#account')).toBeVisible()

    // Midscene 侧：同一个页面，视觉判断
    await session.agent.aiAssert('页面是登录表单，包含账号、密码输入框和提交按钮，布局没有重叠或截断')
  } finally {
    await session.close()
  }
})
```

`openMidscene` 做了三件事：

1. `app.open('/login?e2eTicket=<时间戳>')` —— 给这次导航打一个唯一标记
2. 从 `browser.evaluate` 取回真实 `location.href`
3. 连 CDP，按**完整 URL 精确匹配**拿到那个页面

那条 `e2eTicket` 不是装饰。共享浏览器会被多条用例复用，只按 `/login` 匹配会命中上一条用例留下的页面——你会写进 A 页、从 B 页读断言，表现是"偶发失败"。实测：加标记前 5 次跑挂 4 次，加标记后 5/5 全过。

## 四、当前已验证的能力

| 能力 | 状态 | 备注 |
| --- | --- | --- |
| `aiAssert` 视觉断言 | 已验证 | 单次 1.75–2.73s |
| `aiTap` 视觉定位并点击 | 已验证 | 静态表单 10 次点击零误点，3.2–3.9s/次 |
| 与 e2e locator 同页并存 | 已验证 | `--repeat-each 3` 3/3 通过 |
| 公网靶站（TodoMVC） | 已验证 | 5.13s |
| 线上实例冒烟 | 已验证 | 7 passed / 7.81s |
| `aiQuery` 取值 | **未验证** | 接口存在，本仓库未跑过；用它前先跑一版确认返回结构 |
| `aiAction` 多步动作 | **未验证** | 同上 |

不用把没验证的写成能用。

## 五、分工原则：谁干什么

两者不是替代关系，判据是**"断言能不能写成确定的条件"**。

| 场景 | 用谁 |
| --- | --- |
| 字段值、金额、权限、状态机流转 | e2e `locator + expect` |
| 元素是否存在、数量对不对 | e2e |
| 布局重叠、元素被遮挡、文字截断 | Midscene |
| 文案被 i18n 打穿、乱码、占位符泄漏 | Midscene |
| "整体看起来像个正常表单/列表页" | Midscene |
| 像素级视觉回归 | 都不要，用截图比对 |

一条硬规则：**能被 `expect` 写成确定条件的，不要交给模型**。模型判断有概率，业务正确性不能建立在概率上。视觉断言只补"人一眼能看出、但写不出条件"的缺口。

## 六、成本

- 一张图最多折算 **384 tokens**，计费同 V4-Flash
- 一次 `aiAssert` 约 2 秒、几厘钱
- `E2E_VISUAL` 不开时视觉用例直接 skip，CI 默认不花这个钱

如果要在 CI 里跑视觉，需要在 PR job 注入 `MIDSCENE_MODEL_API_KEY` secret，并保留 `tags: ['visual']` 单独筛选——不建议把它塞进每次全量。

## 七、三个坑

1. **必须用 `openMidscene` 开页**。自己 `app.open()` 后再按路径找页，在共享浏览器上会命中历史页面。这条是踩出来的，不是猜的。
2. **页面不接受额外 query 参数时**，用 `openMidsceneOnPage(endpoint, urlPart)`：由你负责导航，它按 URL 片段取最后一个匹配页。这条路径有固有歧义，只适合单次跑。
3. **`session.close()` 必须在 `finally`**。CDP 连接不释放会悬空；另外 agent 构造时异步注入的 select 样式会在浏览器已关时报 `Target page, context or browser has been closed` 警告，正常"构造→用→关"不会出现。

## 八、产物在哪

| 内容 | 路径 |
| --- | --- |
| e2e 报告 | `.e2e/report.json` |
| 失败截图、录屏、trace | `.e2e/results/<case>/` |
| Midscene 报告（含每步截图） | `.e2e/midscene/report/*.html` |

三处都在 `.gitignore` 里，不会进版本库。Midscene 默认写仓库根 `midscene_run/`，已被 `scripts/e2e.sh` 和 `tests/support/midscene.ts` 双重改写到 `.e2e/midscene`。
