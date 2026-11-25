import { expect, test } from 'e2e'
import { hasMidsceneModel, openMidscene, signOutQuietly } from './support/midscene'
import { onlineCredentials, signInOnline } from './support/online'

/**
 * 用途：对线上实例做一次只读登录检测——登录、确认进入门户，结束时主动登出。
 * 参数：E2E_ONLINE=1、E2E_ONLINE_SIGNIN=1、E2E_ONLINE_USERNAME、E2E_ONLINE_PASSWORD。
 * 返回值：无，断言不成立时抛出错误。
 * 说明：登出放在 finally，无论断言成败都会结束本次会话，避免占用该账号的唯一活动会话。
 */
test('线上实例：账号可以登录并进入门户', { tags: ['online', 'signin'] }, async ({ app, browser }) => {
  test.skip(process.env.E2E_ONLINE !== '1', '未设置 E2E_ONLINE=1')
  test.skip(process.env.E2E_ONLINE_SIGNIN !== '1', '未设置 E2E_ONLINE_SIGNIN=1，跳过线上登录检测')
  test.skip(!onlineCredentials(), '未配置 E2E_ONLINE_USERNAME / E2E_ONLINE_PASSWORD')

  let session

  try {
    await signInOnline({ app, browser, allowTakeover: process.env.E2E_ONLINE_TAKEOVER === '1' })

    const state = await browser.evaluate(() => ({
      path: window.location.pathname,
      title: document.title,
      hasLoginForm: Boolean(document.querySelector('#password')),
    }))

    if (state.hasLoginForm || state.path.includes('/login')) {
      throw new Error(`跳转后页面仍处于登录状态：path=${state.path}`)
    }

    // 只读断言：门户容器或首次登录的导览弹窗，二者出现其一即认定进入门户
    const inPortal = await expect(browser.locator('.subsystem-portal'))
      .toBeVisible({ timeout: 3_000 })
      .then(() => true)
      .catch(() => false)

    const inTour = await expect(browser.locator('[role="dialog"]'))
      .toBeVisible({ timeout: 2_000 })
      .then(() => true)
      .catch(() => false)

    if (!inPortal && !inTour) {
      throw new Error(`已离开登录页但没看到门户内容：path=${state.path}，title=${state.title}`)
    }

    const endpoint = process.env.E2E_CDP_ENDPOINT
    if (!endpoint || !hasMidsceneModel()) return

    // 关键：navigate: false —— 已经停在目标页，再次导航会重置现场并截到白屏
    session = await openMidscene({ app, browser, endpoint, navigate: false })
    await session.agent.aiAssert(
      '当前是已登录后的门户页：能看到门户内容或"平台导览"引导弹窗，页面上没有任何账号、密码输入框',
    )
  } finally {
    if (session) await session.close().catch(() => undefined)

    const signOutStatus = await signOutQuietly(browser)
    if (signOutStatus === 0) {
      console.warn('[e2e] 登出未拿到状态码，账号会话可能残留；可用 E2E_ONLINE_TAKEOVER=1 再跑一次清理')
    }
  }
})
