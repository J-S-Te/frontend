import { expect, test } from 'e2e'
import { mockGuestSession } from './support/guestSession'

/**
 * 用途：验证前端应用外壳可被加载，作为 e2e 骨架的连通性基线。
 * 参数：无，使用 e2e 注入的 app 与 browser fixture。
 * 返回值：无，断言不成立时抛出错误。
 */
test('应用外壳可以加载', { tags: ['smoke'] }, async ({ app, browser }) => {
  await mockGuestSession(browser)
  await app.open('/')
  await expect(browser.locator('#app')).toBeVisible()
})

/**
 * 用途：验证登录页渲染出标题、账号框、密码框与提交按钮，不依赖后端接口。
 * 参数：无，使用 e2e 注入的 app、screen 与 browser fixture。
 * 返回值：无，断言不成立时抛出错误。
 */
test('登录页渲染账号、密码与提交按钮', { tags: ['smoke'] }, async ({ app, browser, screen }) => {
  await mockGuestSession(browser)
  await app.open('/login')

  await expect(screen.getByRole('heading', '登录基础能力平台')).toBeVisible()
  await expect(browser.locator('#account')).toBeVisible()
  await expect(browser.locator('#password')).toBeVisible()
  await expect(browser.locator('.login-button')).toBeVisible()
})

/**
 * 用途：验证 login.html 别名路由可直达同一登录页，防止别名失效。
 * 参数：无，使用 e2e 注入的 app、browser 与 screen fixture。
 * 返回值：无，断言不成立时抛出错误。
 */
test('login.html 别名路由可直达登录页', { tags: ['smoke'] }, async ({ app, browser, screen }) => {
  await mockGuestSession(browser)
  await app.open('/login.html')
  await expect(screen.getByRole('heading', '登录基础能力平台')).toBeVisible()
})
