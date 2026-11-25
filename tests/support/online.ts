import { waitForContent } from './midscene'

/** 线上登录检测用独立凭据，避免与本地 8081 的 E2E_ADMIN_* 混用。 */
export function onlineCredentials(): { username: string; password: string } | undefined {
  const username = process.env.E2E_ONLINE_USERNAME
  const password = process.env.E2E_ONLINE_PASSWORD
  return username && password ? { username, password } : undefined
}

/**
 * 用途：从页面正文里取出疑似错误提示的行，用于把登录失败的真实原因报出来。
 * 参数：browser 为当前页面句柄。
 * 返回值：最多三行错误文案，没有则返回空数组。
 */
export async function readErrorHints(browser): Promise<string[]> {
  try {
    return await browser.evaluate(() => {
      const text = document.body.innerText ?? ''
      return text
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => /错误|失败|无效|不正确|锁定|不存在/.test(line))
        .slice(0, 3)
    })
  } catch {
    // 导航中的执行上下文销毁不算错误信号，下一轮轮询会重新读取
    return []
  }
}

/**
 * 用途：在线上实例完成一次登录，把凭据校验、409 接管和重定向等待集中在一处。
 * 参数：app / browser 为 e2e 注入的句柄；allowTakeover 为 true 时才接管旧会话。
 * 返回值：无；凭据被拒、需要接管但未获授权、或未离开登录页时抛出错误。
 */
export async function signInOnline({ app, browser, allowTakeover = false }): Promise<void> {
  const account = onlineCredentials()
  if (!account) throw new Error('未配置 E2E_ONLINE_USERNAME / E2E_ONLINE_PASSWORD')

  await app.open('/login?reason=session-ended')
  await browser.locator('#account').fill(account.username)
  await browser.locator('#password').fill(account.password)
  await browser.locator('.login-button').tap()

  const deadline = Date.now() + 10_000
  let stillOnLoginForm = true
  let takeoverSeen = false
  let hints: string[] = []

  while (Date.now() < deadline) {
    takeoverSeen = await browser.locator('.session-takeover button').isVisible().catch(() => false)
    stillOnLoginForm = await browser.evaluate(() => Boolean(document.querySelector('#password')))
    hints = await readErrorHints(browser)

    if (takeoverSeen || hints.length || !stillOnLoginForm) break
    await new Promise((resolve) => setTimeout(resolve, 300))
  }

  if (takeoverSeen) {
    if (!allowTakeover) {
      throw new Error('该账号在线上仍有活动会话。为避免踢掉在线会话，本次不接管；先登出或设置 E2E_ONLINE_TAKEOVER=1 后重试。')
    }

    await browser.locator('.session-takeover button').tap()
    await waitForContent(browser)
    stillOnLoginForm = await browser.evaluate(() => Boolean(document.querySelector('#password')))

    if (stillOnLoginForm) {
      throw new Error('接管原会话后仍未离开登录页')
    }
  }

  if (stillOnLoginForm) {
    throw new Error(`登录未离开登录页。页面提示：${hints.length ? hints.join(' / ') : '（无）'}`)
  }

  // 登录后还有一次重定向：先到 / 再落到 /portal，必须等这轮跳转和首屏渲染结束
  await waitForContent(browser)
}

/**
 * 用途：首次登录会弹出「平台导览」模态，遮住背景内容；在只读检测里点「稍后」跳过它。
 * 参数：browser 为当前页面句柄。
 * 返回值：无，没有弹窗时静默返回。
 */
export async function dismissPortalTour(browser): Promise<void> {
  const skip = browser.locator('button:has-text("跳过导览"), button:has-text("稍后")')
  if (await skip.first().isVisible().catch(() => false)) {
    await skip.first().click().catch(() => undefined)
    await new Promise((resolve) => setTimeout(resolve, 400))
  }
}

/**
 * 用途：等待子系统页面真正渲染出正文，识别 SPA 懒加载分片带来的"空壳"中间态。
 * 参数：browser 为页面句柄，timeout 为最长等待毫秒数。
 * 返回值：最后一次采到的页面状态，包含 title / url / size / text。
 * 说明：实测线上 8 个子系统里有 5 个首屏只有 6 个字符（仅"跳到主要内容"），
 *       再等 4 秒左右才出现完整工作台；只判"非空"会把这种中间态当成加载完成。
 */
export async function waitForSubsystemPage(browser, timeout = 12_000) {
  const deadline = Date.now() + timeout
  let last = { title: '', url: '', size: 0, text: '' }

  while (Date.now() < deadline) {
    try {
      last = await browser.evaluate(() => ({
        title: document.title,
        url: window.location.href,
        size: (document.body.innerText ?? '').trim().length,
        text: (document.body.innerText ?? '').replace(/\s+/g, ' ').trim(),
      }))

      if (last.size >= 50) return last
    } catch {
      // 导航中执行上下文销毁，继续等下一轮
    }

    await new Promise((resolve) => setTimeout(resolve, 300))
  }

  return last
}
