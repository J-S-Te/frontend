import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
import { mkdir, writeFile } from 'node:fs/promises'

const output = new URL('../../../../.ai/qa/action-button-labels-20261104/', import.meta.url)
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
})
const results = []
try {
  for (const width of [375, 1280]) {
    const page = await browser.newPage({ viewport: { width, height: 800 } })
    page.setDefaultTimeout(4000)
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.route('**/api/**', () => { throw new Error('夹具禁止访问业务 API') })
    await page.goto('http://127.0.0.1:5187/src/test/ui-harness/action-buttons.html')
    await page.getByRole('button', { name: '打开登记表单' }).click()
    const submit = page.getByRole('button', { name: '登记发票', exact: true })
    assert.equal(await submit.isDisabled(), true)
    await page.getByRole('textbox', { name: '发票号码', exact: true }).fill('123')
    await page.getByLabel('开票日期', { exact: true }).fill('2026-11-04')
    assert.equal(await submit.isDisabled(), true, '字段长度不足不能登记')
    await page.getByRole('textbox', { name: '发票号码', exact: true }).fill('12345678')
    await page.getByRole('textbox', { name: '备注', exact: true }).fill('合成登记')
    assert.equal(await submit.isEnabled(), true)
    await submit.click()
    assert.deepEqual(JSON.parse(await page.locator('#result').textContent()), {
      invoice_no: '12345678', issue_date: '2026-11-04', reason: '合成登记',
    })
    await page.getByRole('button', { name: '打开登记表单' }).click()
    await page.getByRole('button', { name: '取消登记' }).click()
    assert.equal(await page.locator('#result').textContent(), '已取消，未登记')
    await page.getByRole('button', { name: '打开登记表单' }).click()
    await page.keyboard.press('Escape')
    await page.getByRole('dialog').waitFor({ state: 'detached' })
    assert.equal(await page.locator('#result').textContent(), '已取消，未登记')
    assert.equal(await page.evaluate(() => document.body.style.overflow), '')
    await page.getByRole('button', { name: '打开登记表单' }).click()
    await page.getByRole('textbox', { name: '发票号码', exact: true }).fill('未提交旧值')
    await page.evaluate(() => [...document.querySelectorAll('main > button')][0].click())
    assert.equal(await page.getByRole('textbox', { name: '发票号码', exact: true }).inputValue(), '', '替换输入请求必须使用新表单初始值')
    for (const key of ['Shift+Tab', 'Tab', 'Tab', 'Tab', 'Tab']) {
      await page.keyboard.press(key)
      assert.equal(await page.getByRole('dialog').evaluate(e => e.contains(document.activeElement)), true)
    }
    const bounds = await page.getByRole('dialog').boundingBox()
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width)
    await page.getByRole('button', { name: '取消登记' }).click()
    await page.getByRole('button', { name: '打开撤回原因' }).click()
    const withdraw = page.getByRole('button', { name: '撤回申请', exact: true })
    assert.equal(await withdraw.isDisabled(), true)
    await page.getByRole('textbox', { name: /^撤回原因/ }).fill('保留原输入')
    await page.evaluate(() => document.getElementById('toggle-busy').click())
    await page.keyboard.press('Escape')
    assert.equal(await page.getByRole('dialog').count(), 1, '忙碌时不能取消')
    assert.equal(await page.getByRole('button', { name: '撤回申请中…', exact: true }).isDisabled(), true)
    await page.keyboard.press('Tab')
    assert.equal(await page.getByRole('dialog').evaluate(e => e.contains(document.activeElement)), true)
    await page.evaluate(() => document.getElementById('toggle-busy').click())
    await withdraw.click()
    assert.equal(await page.locator('#result').textContent(), '撤回原因：保留原输入')
    await page.getByRole('button', { name: '打开登记表单' }).click()
    assert.deepEqual(errors, [])
    await mkdir(output, { recursive: true })
    await page.screenshot({ path: new URL(`input-dialog-${width}.png`, output).pathname })
    results.push({ width, result: 'PASS', checks: ['字段校验', '返回字段值', '取消不登记', 'Escape', '焦点约束', '窄屏边界', '替换请求清空旧值', '单字段兼容', '忙碌保护'] })
    await page.close()
  }
  await writeFile(new URL('browser-results.json', output), JSON.stringify(results, null, 2))
  console.log(JSON.stringify(results))
} finally {
  await browser.close()
}
