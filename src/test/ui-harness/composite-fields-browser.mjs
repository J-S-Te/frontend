import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import vue from '@vitejs/plugin-vue'
import { chromium } from 'playwright-core'
import { createServer } from 'vite'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const server = await createServer({ configFile: false, root, plugins: [vue()],
  resolve: { alias: { '@': `${root}src` } },
  server: { host: '127.0.0.1', port: 0, hmr: false }, logLevel: 'error' })

// checkBoundary 核对真正绘制的边框、底色和焦点归属。
// 参数：field 为浏览器内的原生输入；state 为期望显示的禁用、焦点或错误状态。
// 返回值：Promise 完成；控件被裁切、重复着色或状态不符时失败。
async function checkBoundary(field, state = {}) {
  const styles = await field.evaluate(input => {
    const inner = getComputedStyle(input)
    const outer = getComputedStyle(input.parentElement)
    const dark = document.documentElement.dataset.theme === 'dark'
    return { active: document.activeElement === input, innerBorder: inner.borderTopWidth,
      innerBackground: inner.backgroundColor, innerOutline: inner.outlineStyle,
      innerShadow: inner.boxShadow, outerBorder: outer.borderTopWidth, outerColor: outer.borderTopColor,
      outerBackground: outer.backgroundColor, outerOutline: outer.outlineStyle,
      outerOutlineColor: outer.outlineColor, fits: input.offsetHeight <= input.parentElement.clientHeight,
      errorColor: dark ? 'rgb(255, 120, 117)' : 'rgb(207, 19, 34)',
      disabledColor: dark ? 'rgb(38, 38, 38)' : 'rgb(245, 245, 245)' }
  })
  assert.equal(styles.outerBorder, '1px', '复合字段应使用外壳的边框')
  assert.equal(styles.innerBorder, '0px', '内层控件不应再绘制边框')
  assert.equal(styles.innerBackground, 'rgba(0, 0, 0, 0)', '外壳负责底色')
  assert.equal(styles.innerShadow, 'none')
  assert.equal(styles.fits, true, '控件应位于外壳高度内')
  if (state.disabled) {
    assert.equal(await field.isDisabled(), true)
    assert.equal(styles.outerBackground, styles.disabledColor)
  }
  if (state.focus) {
    assert.equal(styles.active, true, '键盘焦点必须落在原生控件上')
    assert.equal(styles.innerOutline, 'none')
    assert.equal(styles.outerOutline, 'solid', '可见焦点必须由外壳绘制')
  }
  if (state.error) {
    assert.equal(styles.outerColor, styles.errorColor)
    assert.equal(styles.outerOutlineColor, styles.errorColor)
  }
}

// openFixture 通过隔离的前端开发服务器打开合成组件夹具。
// 参数：page 为浏览器页；origin 为回环地址；module 和 theme 为待验证模块和主题。
// 返回值：Promise 完成；页面和主题可供浏览器断言。
async function openFixture(page, origin, module, theme) {
  await page.goto(`${origin}/src/test/ui-harness/component-experience.html`)
  await page.getByLabel('验证模块').selectOption(module)
  await page.getByLabel('验证主题').selectOption(theme)
}

// checkPlatform 验证平台搜索、原生选择器、错误与键盘清除操作。
// 参数：page 为已打开平台组件夹具的浏览器页。
// 返回值：Promise 完成；出现重复边框、失去键盘焦点或影响独立输入时失败。
async function checkPlatform(page) {
  const search = page.getByRole('searchbox', { name: '搜索操作记录' })
  const application = page.getByRole('combobox', { name: '应用', exact: true })
  await checkBoundary(search)
  await checkBoundary(application)
  await checkBoundary(page.getByRole('combobox', { name: '环境', exact: true }), { disabled: true })
  await search.evaluate(input => input.setAttribute('aria-invalid', 'true'))
  await search.focus()
  await search.press('Shift+Tab')
  await page.keyboard.press('Tab')
  await checkBoundary(search, { focus: true, error: true })
  await page.keyboard.press('Tab')
  await checkBoundary(application, { focus: true })
  await application.selectOption({ label: '项目管理' })
  assert.equal(await application.inputValue(), '项目管理')

  const settings = page.getByRole('searchbox', { name: '搜索设置模块' })
  await settings.fill('租户')
  await checkBoundary(settings, { focus: true })
  await page.keyboard.press('Tab')
  const clear = page.getByRole('button', { name: '清空搜索' })
  assert.ok(await clear.evaluate(button => document.activeElement === button
    && getComputedStyle(button).outlineStyle === 'solid'), '清空按钮应保留独立键盘焦点')
  await page.keyboard.press('Enter')
  assert.equal(await settings.inputValue(), '')
  assert.equal(await page.locator('#filter').evaluate(input => getComputedStyle(input).borderTopWidth), '1px')
}

// checkProject 验证真实项目选择器的搜索焦点、浮层尺寸和筛选。
// 参数：page 为已打开项目组件夹具的浏览器页。
// 返回值：Promise 完成；输入边框、浮层主题或筛选失败时中止。
async function checkProject(page) {
  const picker = page.getByRole('searchbox', { name: '搜索服务项队列' })
  await picker.focus()
  await checkBoundary(picker, { focus: true })
  const trigger = page.getByRole('combobox', { name: '选择合成项目' })
  await trigger.focus()
  await page.keyboard.press('Enter')
  const menu = page.locator('body > .pm-search-select-menu[data-positioned="true"]')
  await menu.waitFor()
  const search = menu.getByRole('searchbox', { name: '输入关键字搜索' })
  await checkBoundary(search, { focus: true })
  const geometry = await menu.evaluate(element => {
    const { left, top, right, bottom } = element.getBoundingClientRect()
    const background = getComputedStyle(element).backgroundColor
    return { inViewport: left >= 0 && top >= 0 && right <= innerWidth && bottom <= innerHeight,
      background, dark: document.documentElement.dataset.theme === 'dark' }
  })
  assert.equal(geometry.inViewport, true, '浮层应位于可视区域内')
  assert.equal(geometry.background, geometry.dark ? 'rgb(17, 26, 44)' : 'rgb(255, 255, 255)')
  await search.fill('乙')
  assert.equal(await menu.getByRole('option').count(), 1)
  await checkProjectKeyboard(page, menu, trigger)
}

// checkProjectKeyboard 验证输入框快捷选择与原生按钮操作分别使用正确目标。
// 参数：page 为项目夹具页；menu 为下拉菜单；trigger 为选择器触发按钮。
// 返回值：Promise 完成；键盘选择、关闭顺序或焦点还原异常时失败。
async function checkProjectKeyboard(page, menu, trigger) {
  await page.keyboard.press('Enter')
  await menu.waitFor({ state: 'detached' })
  assert.equal((await trigger.textContent()).trim(), '乙项目')
  assert.ok(await trigger.evaluate(button => document.activeElement === button), '键盘选择后焦点应还原')
  await page.keyboard.press('Enter')
  await menu.waitFor()
  await page.evaluate(() => {
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') document.body.dataset.menuConsumedEscape = String(event.defaultPrevented)
    }, { once: true })
  })
  await page.keyboard.press('Escape')
  await menu.waitFor({ state: 'detached' })
  assert.ok(await trigger.evaluate(button => document.activeElement === button), 'Esc 关闭后焦点应还原')
  assert.equal(await page.locator('body').getAttribute('data-menu-consumed-escape'), 'true',
    'Esc 应先关闭下拉菜单，避免继续关闭上层弹窗')

  await page.keyboard.press('Enter')
  await menu.waitFor()
  await page.keyboard.press('Tab')
  await page.keyboard.press('Tab')
  const secondOption = menu.getByRole('option', { name: '乙项目' })
  assert.ok(await secondOption.evaluate(button => document.activeElement === button))
  await page.keyboard.press('Enter')
  await menu.waitFor({ state: 'detached' })
  assert.equal((await trigger.textContent()).trim(), '乙项目', 'Enter 应使用 Tab 聚焦的选项')
}

try {
  await server.listen()
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH
    || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true })
  try {
    await test('复合输入边界', async suite => {
      for (const theme of ['light', 'dark']) {
        for (const module of ['platform', 'contract', 'project']) {
          await suite.test(`${module} / ${theme}`, async () => {
            const page = await browser.newPage({ viewport: { width: module === 'project' ? 390 : 1440,
              height: 850 }, reducedMotion: 'reduce', serviceWorkers: 'block' })
            const errors = []
            page.on('pageerror', error => errors.push(error.message))
            await page.route('**/*', route => {
              const request = route.request()
              if (new URL(request.url()).origin === origin
                && ['document', 'script', 'stylesheet', 'image', 'font'].includes(request.resourceType())) {
                return route.continue()
              }
              errors.push(request.url())
              return route.abort()
            })
            try {
              await openFixture(page, origin, module, theme)
              if (module === 'platform') await checkPlatform(page)
              if (module === 'project') await checkProject(page)
              if (module === 'contract') {
                await checkBoundary(page.getByRole('searchbox', { name: '搜索合同台账' }))
                await checkBoundary(page.getByRole('searchbox', { name: '搜索仅限合同台账' }), { disabled: true })
              }
              assert.deepEqual(errors, [])
            } finally {
              await page.close()
            }
          })
        }
      }
    })
  } finally {
    await browser.close()
  }
} finally {
  await server.close()
}
