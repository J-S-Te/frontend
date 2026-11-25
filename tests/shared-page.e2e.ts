import { test } from 'e2e'

/**
 * 用途：验证第二个 CDP 连接看到的页面与 e2e 驱动的页面是同一个 DOM，作为接入 Midscene 同页混用的前提。
 * 参数：E2E_CDP_ENDPOINT。
 * 返回值：无，共享不成立时抛出错误；未配置端点时该用例被跳过。
 * 说明：页面之间共享同一个浏览器，按 URL 找页会命中历史遗留页面；这里用一次性 query 参数给当前页打标记。
 */
test('外部 CDP 连接与 e2e 共享同一页面', { tags: ['cdp'] }, async ({ app, browser }) => {
  const endpoint = process.env.E2E_CDP_ENDPOINT
  test.skip(!endpoint, '未配置 E2E_CDP_ENDPOINT，跳过同页混用校验')

  const marker = `e2eProbe=${Date.now()}`
  await app.open(`/login?${marker}`)

  const currentUrl = await browser.evaluate(() => window.location.href)

  if (!currentUrl.includes(marker)) {
    throw new Error(`页面地址未保留探针参数，无法唯一定位页面：${currentUrl}`)
  }

  const { chromium } = await import('playwright-core')
  const external = await chromium.connectOverCDP(endpoint)

  try {
    const pages = external.contexts().flatMap((context) => context.pages())
    const target = pages.filter((page) => page.url().includes(marker)).at(-1)

    if (!target) {
      throw new Error(`外部连接未看到带探针参数的页面，现有页面：${pages.map((page) => page.url()).join(', ')}`)
    }

    const value = `probe-${Date.now()}`
    await target.evaluate((payload) => {
      document.body.dataset.e2eProbe = payload
    }, value)

    const seenByE2e = await browser.evaluate(() => document.body.dataset.e2eProbe ?? null)

    if (seenByE2e !== value) {
      throw new Error(`e2e 未读到外部写入的标记，期望 ${value}，实际为：${seenByE2e}`)
    }
  } finally {
    await external.close()
  }
})
