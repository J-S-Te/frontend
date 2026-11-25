import { credentials, expect, test } from 'e2e'
import { mockGuestSession } from './support/guestSession'

/**
 * 用途：判断当前运行环境是否已提供可用的测试账号，未提供时跳过需要登录的用例。
 * 参数：无，优先读 E2E_LOCAL_PASSWORD，未设置时退回 E2E_ADMIN_PASSWORD。
 * 返回值：布尔值，密码存在且不短于 6 个字符时为 true。
 */
function canSignIn() {
  const password = process.env.E2E_LOCAL_PASSWORD ?? process.env.E2E_ADMIN_PASSWORD
  return Boolean(password && password.length >= 6)
}

/**
 * 用途：在登录页填入凭据并提交，必要时确认接管已存在的终端会话。
 * 参数：app 为应用导航句柄，browser 为当前浏览器页面句柄。
 * 返回值：无，提交后停留在登录页且既未跳转也未出现接管入口时抛出错误。
 */
async function signIn(app, browser) {
  const admin = credentials.user('admin')

  await app.open('/login')
  await browser.locator('#account').fill(admin.username)
  await browser.locator('#password').fill(admin.password)
  await browser.locator('.login-button').tap()

  // 服务端对同一账号只保留一个活动会话，残留会话会让登录返回 409 并要求显式接管。
  const reachedPortal = await expect(browser)
    .toHaveURL(/\/portal/, { timeout: 4_000 })
    .then(() => true)
    .catch(() => false)

  if (reachedPortal) return

  // 没跳到门户有两种可能：需要接管旧会话（409），或凭据被拒（401）。
  // 后者如果盲等接管按钮会白等 10s 并给出误导性错误，这里先区分再决定。
  const takeover = browser.locator('.session-takeover button')
  const hasTakeover = await expect(takeover)
    .toBeVisible({ timeout: 2_000 })
    .then(() => true)
    .catch(() => false)

  if (hasTakeover) {
    await takeover.tap()
    return
  }

  const hints = await browser.evaluate(() => {
    const text = document.body.innerText ?? ''
    return text
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => /错误|失败|无效|不正确|锁定|不存在/.test(line))
      .slice(0, 3)
  })

  throw new Error(
    `登录未跳转到门户，也没有接管入口。页面提示：${hints.length ? hints.join(' / ') : '（无）'}。` +
      '若提示凭据无效，请检查 .e2e-secrets 中的 E2E_LOCAL_PASSWORD（未设置时回退 E2E_ADMIN_PASSWORD）是否与当前后端一致。',
  )
}

/**
 * 用途：验证未登录直接访问受保护的门户页会被路由守卫挡回登录页。
 * 参数：无，使用 e2e 注入的 app、browser 与 screen fixture。
 * 返回值：无，断言不成立时抛出错误。
 */
test('未登录访问子系统门户会被挡回登录页', { tags: ['smoke'] }, async ({ app, browser, screen }) => {
  await mockGuestSession(browser)
  await app.open('/portal')

  await expect(browser).toHaveURL(/\/login/)
  await expect(screen.getByRole('heading', '登录基础能力平台')).toBeVisible()
})

/**
 * 用途：验证管理员能用真实凭据登录，并在需要时接管旧会话后落到子系统门户页。
 * 参数：无，账号来自 e2e 的 credentials 配置，密码不会进入日志与报告。
 * 返回值：无，断言不成立时抛出错误；未配置账号时该用例被跳过。
 */
test('管理员登录后进入子系统门户', { tags: ['backend'] }, async ({ app, browser }) => {
  test.skip(!canSignIn(), '未配置 E2E_ADMIN_USERNAME / E2E_ADMIN_PASSWORD')

  await signIn(app, browser)

  await expect(browser).toHaveURL(/\/portal/)
  await expect(browser.locator('.subsystem-portal')).toBeVisible()
})
