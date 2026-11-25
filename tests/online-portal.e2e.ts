import { test } from 'e2e'
import { signOutQuietly, waitForContent } from './support/midscene'
import { dismissPortalTour, signInOnline, waitForSubsystemPage } from './support/online'

/**
 * 用途：逐个打开门户里的每个子系统，验证线上所有业务入口都能真正进入并渲染出页面。
 * 参数：E2E_ONLINE=1、E2E_ONLINE_SIGNIN=1、E2E_ONLINE_* 凭据。
 * 返回值：无，任一子系统打不开或页面为空时抛出错误。
 * 说明：门户卡片以新标签页打开，必须用 waitForPopup 捕获；子系统是懒加载，
 *       首屏可能只有"跳到主要内容"，因此用 waitForSubsystemPage 等到正文真正渲染。
 */
test('线上实例：门户所有子系统入口都能进入', { tags: ['online', 'portal'] }, async ({ app, browser }) => {
  test.skip(process.env.E2E_ONLINE !== '1', '未设置 E2E_ONLINE=1')
  test.skip(process.env.E2E_ONLINE_SIGNIN !== '1', '未设置 E2E_ONLINE_SIGNIN=1，跳过线上业务检测')
  test.skip(!process.env.E2E_ONLINE_USERNAME || !process.env.E2E_ONLINE_PASSWORD, '未配置线上凭据')

  const results: Array<{ name: string; ok: boolean; detail: string }> = []

  try {
    await signInOnline({ app, browser, allowTakeover: process.env.E2E_ONLINE_TAKEOVER === '1' })
    await dismissPortalTour(browser)

    // 门户子系统目录异步加载，先等卡片出现
    const cardsDeadline = Date.now() + 12_000
    while (Date.now() < cardsDeadline) {
      const count = (await browser.evaluate(`document.querySelectorAll('.subsystem-card').length`)) as number
      if (count > 0) break
      await new Promise((resolve) => setTimeout(resolve, 300))
    }

    const cards = (await browser.evaluate(`(function () {
      return Array.from(document.querySelectorAll('.subsystem-card')).map((card) => ({
        name: (card.querySelector('.subsystem-card__name') || card).innerText.trim(),
        disabled: card.getAttribute('aria-disabled') === 'true',
      }));
    })()`)) as Array<{ name: string; disabled: boolean }>

    if (cards.length === 0) {
      throw new Error('门户没有加载出任何子系统入口')
    }

    for (const card of cards) {
      if (card.disabled) {
        results.push({ name: card.name, ok: false, detail: '入口显示权限同步中，不可点击' })
        continue
      }

      let tab
      try {
        tab = await browser.waitForPopup(async () => {
          await browser.evaluate(`(function () {
            const name = ${JSON.stringify(card.name)};
            const cards = Array.from(document.querySelectorAll('.subsystem-card'));
            const hit = cards.find((item) => ((item.querySelector('.subsystem-card__name') || item).innerText || '').trim() === name);
            if (!hit) throw new Error('门户里没找到「' + name + '」入口');
            hit.click();
          })()`)
        }, { timeout: 12_000 })

        await waitForContent(browser, 6_000)
        const landed = await waitForSubsystemPage(browser)

        if (landed.size < 50) {
          results.push({ name: card.name, ok: false, detail: `进入后页面几乎为空（${landed.size} 字符）：${landed.url}` })
          continue
        }

        if (/无权限|拒绝访问|无权访问|权限不足/.test(landed.text)) {
          results.push({ name: card.name, ok: false, detail: `出现权限拒绝提示：${landed.text.slice(0, 80)}` })
          continue
        }

        results.push({ name: card.name, ok: true, detail: `${landed.title} · ${landed.url}` })
      } catch (error) {
        results.push({ name: card.name, ok: false, detail: String(error).slice(0, 120) })
      } finally {
        if (tab && !tab.isClosed()) await tab.close().catch(() => undefined)
        await new Promise((resolve) => setTimeout(resolve, 300))
      }
    }

    const failed = results.filter((item) => !item.ok)

    console.log(`[e2e] 门户子系统 ${results.length} 个，失败 ${failed.length} 个`)
    for (const item of results) {
      console.log(`[e2e] ${item.ok ? 'OK ' : 'NG '} ${item.name} · ${item.detail}`)
    }

    if (failed.length) {
      throw new Error(`有 ${failed.length} 个子系统打不开：${failed.map((item) => `${item.name}（${item.detail}）`).join('；')}`)
    }
  } finally {
    const signOutStatus = await signOutQuietly(browser)
    if (signOutStatus === 0) {
      console.warn('[e2e] 登出未拿到状态码，账号会话可能残留；可用 E2E_ONLINE_TAKEOVER=1 再跑一次清理')
    }
  }
})
