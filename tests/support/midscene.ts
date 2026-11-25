import { chromium, type Page } from 'playwright'
// 走子路径而不是包入口：入口会连 @playwright/test 的 fixture 一起导出，我们没有装那个包。
import { PlaywrightAgent } from '@midscene/web/playwright/agent'

// Midscene 默认把报告和截图写进仓库根的 midscene_run/，统一收进 e2e 的产物目录，
// 跟 .e2e 一起被 gitignore、一起清理，避免截图泄漏到版本库。
process.env.MIDSCENE_RUN_DIR ??= '.e2e/midscene'

/** e2e 注入的 app fixture，这里只用到 open。 */
type AppHandle = { open: (path: string) => Promise<unknown> }

/** e2e 注入的 browser fixture，这里只用到 evaluate。 */
type BrowserHandle = { evaluate: <T>(fn: () => T) => Promise<T> }

export type MidsceneSession = {
  /** 与 e2e 共享的同一个页面 */
  page: Page
  /** Midscene 的页面级 agent，提供 aiAssert / aiAction / aiQuery */
  agent: PlaywrightAgent
  /** 释放 CDP 连接；必须放在 finally 里 */
  close: () => Promise<void>
}

export type OpenMidsceneOptions = {
  app: AppHandle
  browser: BrowserHandle
  endpoint: string
  /** 页面路径，navigate 为 true 时必填 */
  path?: string
  /**
   * 是否重新导航到 path。
   * 默认 true，用于"从零打开某页"；已经停在目标页（例如刚登录完）时必须传 false，
   * 否则会把当前现场重置，页面回到未渲染的初始状态。
   */
  navigate?: boolean
}

/**
 * 用途：等当前页面加载完成且正文有内容，避免截到重定向中间态。
 * 参数：browser 为页面句柄，timeout 为最长等待毫秒数。
 * 返回值：无，超时后静默返回，由后续断言暴露问题。
 */
export async function waitForContent(browser: BrowserHandle, timeout = 5_000): Promise<void> {
  const deadline = Date.now() + timeout

  while (Date.now() < deadline) {
    try {
      const ready = await browser.evaluate(() => {
        const text = document.body?.innerText ?? ''
        return document.readyState === 'complete' && text.trim().length > 0
      })

      if (ready) return
    } catch {
      // 页面正在导航时执行上下文会被销毁，属于预期情况，继续轮询即可
    }

    await new Promise((resolve) => setTimeout(resolve, 150))
  }
}

/**
 * 用途：打开页面并把同一个页面交给 Midscene，是同页混用的入口。
 * 参数：见 OpenMidsceneOptions。
 * 返回值：会话对象，用完必须 close。
 * 说明：会给 URL 打一次性标记 e2eTicket，用来在共享浏览器里唯一定位当前页面；
 *       浏览器被多个用例复用，只按路径匹配会命中历史遗留页面。
 */
export async function openMidscene({
  app,
  browser,
  endpoint,
  path,
  navigate = true,
}: OpenMidsceneOptions): Promise<MidsceneSession> {
  if (navigate) {
    if (!path) throw new Error('navigate 为 true 时必须提供 path')

    await app.open(`${path}${path.includes('?') ? '&' : '?'}e2eTicket=${Date.now()}`)
    await waitForContent(browser)
  }

  // 导航模式取真实 URL；不导航时用 replaceState 打标记，避免重新加载页面
  const currentUrl = navigate
    ? await browser.evaluate(() => window.location.href)
    : await browser.evaluate(() => {
        const url = new URL(window.location.href)
        url.searchParams.set('e2eTicket', String(Date.now()))
        window.history.replaceState(null, '', url)
        return url.toString()
      })

  const connection = await chromium.connectOverCDP(endpoint)

  try {
    const pages = connection.contexts().flatMap((context) => context.pages())
    const page = pages.filter((item) => item.url() === currentUrl).at(-1)

    if (!page) {
      throw new Error(`外部连接未看到当前页面，现有页面：${pages.map((item) => item.url()).join(', ')}`)
    }

    return {
      page,
      agent: new PlaywrightAgent(page),
      close: async () => {
        await connection.close()
      },
    }
  } catch (error) {
    await connection.close()
    throw error
  }
}

/**
 * 用途：页面不接受额外 query 参数时，由调用方自己打开页面，再按 URL 片段定位。
 * 参数：endpoint 为 CDP 端点，urlPart 为路径片段。
 * 返回值：会话对象，用完必须 close。
 */
export async function openMidsceneOnPage(endpoint: string, urlPart: string): Promise<MidsceneSession> {
  const connection = await chromium.connectOverCDP(endpoint)

  try {
    const pages = connection.contexts().flatMap((context) => context.pages())
    const page = pages.filter((item) => item.url().includes(urlPart)).at(-1)

    if (!page) {
      throw new Error(`未在外部浏览器里找到包含 ${urlPart} 的页面，现有：${pages.map((item) => item.url()).join(', ')}`)
    }

    return {
      page,
      agent: new PlaywrightAgent(page),
      close: async () => {
        await connection.close()
      },
    }
  } catch (error) {
    await connection.close()
    throw error
  }
}

/**
 * 用途：判断当前环境是否配置了 Midscene 所需的视觉模型，供用例决定跳过与否。
 * 参数：无。
 * 返回值：全部配置齐备返回 true。
 */
export function hasMidsceneModel(): boolean {
  const apiKey = process.env.MIDSCENE_MODEL_API_KEY ?? process.env.OPENAI_API_KEY
  const modelName = process.env.MIDSCENE_MODEL_NAME ?? process.env.OPENAI_MODEL
  return Boolean(apiKey && modelName)
}

/**
 * 用途：在当前页面直接调用登出接口，结束本次运行建立的会话。
 * 参数：browser 为页面句柄。
 * 返回值：HTTP 状态码；未登录时为 401，调用失败返回 0。
 * 说明：用同步 XHR 而不是 fetch，是为了在 evaluate 内当场拿到状态码；
 *       失败不抛出，避免登出问题掩盖真正的断言结果。
 */
export async function signOutQuietly(browser: BrowserHandle): Promise<number> {
  try {
    return await browser.evaluate(() => {
      try {
        const xhr = new XMLHttpRequest()
        xhr.open('POST', '/api/v1/auth/logout', false)
        xhr.setRequestHeader('Accept', 'application/json')
        xhr.send()
        return xhr.status
      } catch {
        return 0
      }
    })
  } catch {
    return 0
  }
}
