import type { Browser } from '@e2e-dev/web'

/**
 * 用途：让无后端的浏览器用例收到明确的未登录响应，仍由真实路由守卫处理。
 * 参数：browser 为当前测试的浏览器夹具。
 * 返回值：会话查询拦截规则注册完成后兑现。
 */
export async function mockGuestSession(browser: Browser) {
  await browser.route('**/api/v1/auth/me', async (route) => {
    await route.fulfill({
      status: 401,
      json: { code: 'AUTH_UNAUTHENTICATED', message: '请先登录' },
    })
  })
}
