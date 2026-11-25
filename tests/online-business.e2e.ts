import { test } from 'e2e'
import { hasMidsceneModel, openMidscene, signOutQuietly, waitForContent } from './support/midscene'
import { dismissPortalTour, signInOnline, waitForSubsystemPage } from './support/online'

/** 线上业务动作检测默认进入的子系统，可用 E2E_ONLINE_SUBSYSTEM 覆盖。 */
const DEFAULT_SUBSYSTEM = '合同管理'

/**
 * 用途：验证线上实例登录后能真正进入业务子系统并加载工作台——只读，不提交任何业务数据。
 * 参数：E2E_ONLINE=1、E2E_ONLINE_SIGNIN=1、E2E_ONLINE_* 凭据；E2E_ONLINE_SUBSYSTEM 可改目标子系统。
 * 返回值：无，断言不成立时抛出错误。
 * 说明：门户卡片以新标签页打开子系统，必须用 waitForPopup 捕获，否则断言仍停留在门户页。
 */
test('线上实例：可以进入业务子系统并加载工作台', { tags: ['online', 'business'] }, async ({ app, browser }) => {
  test.skip(process.env.E2E_ONLINE !== '1', '未设置 E2E_ONLINE=1')
  test.skip(process.env.E2E_ONLINE_SIGNIN !== '1', '未设置 E2E_ONLINE_SIGNIN=1，跳过线上业务检测')
  test.skip(!process.env.E2E_ONLINE_USERNAME || !process.env.E2E_ONLINE_PASSWORD, '未配置线上凭据')

  const subsystem = process.env.E2E_ONLINE_SUBSYSTEM ?? DEFAULT_SUBSYSTEM
  let session
  let tab

  try {
    await signInOnline({ app, browser, allowTakeover: process.env.E2E_ONLINE_TAKEOVER === '1' })
    await dismissPortalTour(browser)

    // 门户卡片是 <button>，点击后以新标签页打开子系统
    const nameLiteral = JSON.stringify(subsystem)

    // 门户子系统目录是异步加载的：先等卡片出现，否则会误报「没找到入口」
    const cardVisible = () =>
      browser.evaluate(`(function () {
        const name = ${nameLiteral};
        return Array.from(document.querySelectorAll('.subsystem-card'))
          .some((card) => (card.getAttribute('aria-label') || '').includes(name));
      })()`)

    const cardDeadline = Date.now() + 10_000
    while (Date.now() < cardDeadline) {
      if (await cardVisible()) break
      await new Promise((resolve) => setTimeout(resolve, 300))
    }

    tab = await browser.waitForPopup(async () => {
      await browser.evaluate(`(function () {
        const name = ${nameLiteral};
        const cards = Array.from(document.querySelectorAll('.subsystem-card'));
        const target = cards.find((card) => (card.getAttribute('aria-label') || '').includes(name));
        if (!target) throw new Error('门户里没找到「' + name + '」入口');
        target.click();
      })()`)
    }, { timeout: 15_000 })

    await waitForContent(browser)

    // 子系统是懒加载：首屏可能只有"跳到主要内容"，要等正文真正渲染
    const landed = await waitForSubsystemPage(browser)
    const hasLoginForm = await browser.evaluate(() => Boolean(document.querySelector('#password')))

    // 没有停在登录页：子系统有统一认证中转，落点必须是业务页面
    if (hasLoginForm) {
      throw new Error(`进入子系统后落到登录页：${landed.url}`)
    }

    // 没有权限拒绝提示，避免把"打不开"当成"打开成功"
    if (/无权限|拒绝访问|无权访问|权限不足/.test(landed.text)) {
      throw new Error(`进入「${subsystem}」后出现权限拒绝提示：${landed.text.slice(0, 120)}`)
    }

    // 业务页面必须有自己的标题与内容，空壳不算通过
    if (!landed.title.includes(subsystem) && !landed.text.includes(subsystem)) {
      throw new Error(`进入后页面标题与内容都不含「${subsystem}」：title=${landed.title}，url=${landed.url}`)
    }

    if (landed.text.length < 20) {
      throw new Error(`进入「${subsystem}」后页面内容为空：url=${landed.url}`)
    }

    console.log(`[e2e] 已进入 ${subsystem}：${landed.url} · ${landed.title}`)

    const endpoint = process.env.E2E_CDP_ENDPOINT
    if (!endpoint || !hasMidsceneModel()) return

    session = await openMidscene({ app, browser, endpoint, navigate: false })
    await session.agent.aiAssert(
      `当前是「${subsystem}」的业务页面：能看到左侧导航菜单或工作台内容，页面没有登录表单，也没有空白区域`,
    )
  } finally {
    if (session) await session.close().catch(() => undefined)
    if (tab && !tab.isClosed()) await tab.close().catch(() => undefined)

    const signOutStatus = await signOutQuietly(browser)
    if (signOutStatus === 0) {
      console.warn('[e2e] 登出未拿到状态码，账号会话可能残留；可用 E2E_ONLINE_TAKEOVER=1 再跑一次清理')
    }
  }
})
