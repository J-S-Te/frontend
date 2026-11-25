import { expect, test } from 'e2e'
import { hasMidsceneModel, openMidscene, waitForContent } from './support/midscene'

/**
 * 用途：在同一条用例里混用两种断言——e2e 的确定性定位器 + Midscene 的视觉判断，且两者作用在同一个页面。
 * 参数：E2E_CDP_ENDPOINT（共享浏览器端点）、MIDSCENE_MODEL_NAME / MIDSCENE_MODEL_API_KEY（视觉模型）。
 * 返回值：无，断言不成立时抛出错误；缺任一前提时跳过。
 */
test('登录页：视觉断言与确定性断言同页并存', { tags: ['visual'] }, async ({ app, browser }) => {
  const endpoint = process.env.E2E_CDP_ENDPOINT

  if (!endpoint) {
    test.skip(true, '未配置 E2E_CDP_ENDPOINT，跳过（用 E2E_VISUAL=1 跑）')
  }
  if (!hasMidsceneModel()) {
    test.skip(true, '未配置 MIDSCENE_MODEL_NAME / MIDSCENE_MODEL_API_KEY，跳过视觉断言')
  }

  // openMidscene 负责打开页面并接管同一个页面，之后两种断言都作用在这一页
  const session = await openMidscene({ app, browser, endpoint: endpoint as string, path: '/login' })

  try {
    // e2e 侧：零成本、结果确定的断言
    await expect(browser.locator('#account')).toBeVisible()
    await expect(browser.locator('.login-button')).toBeVisible()

    // Midscene 侧：交给视觉模型判断整体形态
    await session.agent.aiAssert('页面是一个登录表单，包含账号输入框、密码输入框和一个提交按钮，布局没有重叠或截断')
  } finally {
    await session.close()
  }
})

/**
 * 用途：验证"已经停在目标页"时接管页面不会重新导航——用 replaceState 打标记而非重新加载。
 * 参数：E2E_CDP_ENDPOINT、MIDSCENE_MODEL_*；缺任一前提时跳过。
 * 返回值：无，断言不成立时抛出错误。
 */
test('已停在目标页时直接接管，不重新导航', { tags: ['visual'] }, async ({ app, browser, screen }) => {
  const endpoint = process.env.E2E_CDP_ENDPOINT

  if (!endpoint) test.skip(true, '未配置 E2E_CDP_ENDPOINT')
  if (!hasMidsceneModel()) test.skip(true, '未配置视觉模型')

  await app.open('/login')
  await waitForContent(browser)

  const session = await openMidscene({ app, browser, endpoint: endpoint as string, navigate: false })

  try {
    // 页面没有被重新加载：输入的临时值与后续读取一致
    await browser.locator('#account').fill('probe-current-page')
    const echoed = await browser.evaluate(() => (document.querySelector('#account') as HTMLInputElement).value)

    await expect(screen.getByRole('heading', '登录基础能力平台')).toBeVisible()
    await session.agent.aiAssert('页面是登录页，包含账号、密码输入框和登录按钮，没有弹出额外的引导弹窗')

    if (echoed !== 'probe-current-page') {
      throw new Error(`接管后读到的值不一致，页面可能被重新加载：${echoed}`)
    }
  } finally {
    await session.close()
  }
})
