import { expect, test } from 'e2e'
import { hasMidsceneModel, openMidscene } from './support/midscene'

/**
 * 用途：对已部署到公网的实例做冒烟——确认登录页可达、表单结构完整。
 * 参数：E2E_ONLINE=1 启用；APP_URL 指向线上地址；视觉断言需 E2E_CDP_ENDPOINT 与模型配置。
 * 返回值：无，断言不成立时抛出错误。
 */
test('线上实例：登录页可达且表单结构完整', { tags: ['online'] }, async ({ app, browser, screen }) => {
  test.skip(process.env.E2E_ONLINE !== '1', '未设置 E2E_ONLINE=1，跳过线上冒烟')

  const endpoint = process.env.E2E_CDP_ENDPOINT
  const useVision = Boolean(endpoint) && hasMidsceneModel()

  // 需要视觉时由 openMidscene 负责开页，否则在这里直接导航
  const session = useVision
    ? await openMidscene({ app, browser, endpoint: endpoint as string, path: '/login?reason=session-ended' })
    : undefined

  if (!session) {
    await app.open('/login?reason=session-ended')
  }

  try {
    await expect(screen.getByRole('heading', '登录基础能力平台')).toBeVisible()
    await expect(browser.locator('#account')).toBeVisible()
    await expect(browser.locator('#password')).toBeVisible()
    await expect(browser.locator('.login-button')).toBeVisible()

    if (session) {
      await session.agent.aiAssert('页面是登录页：左侧为品牌介绍，右侧为登录表单，表单里有账号、密码输入框和登录按钮')
    }
  } finally {
    if (session) await session.close()
  }
})
