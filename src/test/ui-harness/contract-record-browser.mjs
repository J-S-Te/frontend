import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import vue from '@vitejs/plugin-vue'
import { chromium } from 'playwright-core'

const scenario = process.argv[2] || 'delete'
assert.ok(['delete', 'restore'].includes(scenario), '每次只运行 delete 或 restore 一个最小浏览器场景')
const root = fileURLToPath(new URL('../../../', import.meta.url))
const output = resolve(process.env.CONTRACT_RECORD_OUTPUT_DIR || `${tmpdir()}/contract-record-ui`)
const server = await createServer({ configFile: false, root, plugins: [vue()],
  resolve: { alias: { '@': root + 'src' } },
  server: { host: '127.0.0.1', port: 0, hmr: false }, logLevel: 'error' })
let browser
const calls = [], errors = [], unexpected = [], consoleMessages = []
let source = { id: 'RECORD-TEST', contract_number: 'TEST-2026-001', title: '合成验收合同',
  contract_type: '直签', customer_name: '合成客户', owner_display_name: '合成负责人',
  amount_minor: 10000, currency: 'CNY', status: 'draft', version: scenario === 'delete' ? 1 : 2,
  record_state: scenario === 'delete' ? 'active' : 'deleted', updated_at: new Date().toISOString() }
if (scenario === 'restore') source = { ...source, deleted_at: new Date().toISOString(), deleted_by: 'TEST-ADMIN', delete_reason: '合成误建记录' }
try {
  await server.listen()
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH
    || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  // 浏览器使用明确合成的接口响应；数据库与API持久化在独立最小场景验证。
  await context.route('**/*', async (route) => {
    const request = route.request(), url = new URL(request.url())
    if (url.origin !== origin) { unexpected.push('external request'); return route.abort() }
    if (!url.pathname.startsWith('/contract_management/api/v1/')) return route.continue()
    const method = request.method(), path = url.pathname
    const body = request.postData() ? JSON.parse(request.postData()) : null
    calls.push({ method, path, body })
    let data, status = 200
    if (method === 'GET' && path.endsWith('/deletion-preview')) {
      data = { ...source, blockers: [], can_delete: source.record_state === 'active', can_restore: source.record_state === 'deleted' }
    } else if (method === 'GET' && path.endsWith('/contracts') && url.searchParams.get('record_state') === 'deleted') {
      const items = source.record_state === 'deleted' ? [{ ...source }] : []
      data = { items, total: items.length, page: 1, page_size: 20 }
    } else if (method === 'DELETE' || (method === 'POST' && path.endsWith('/restore'))) {
      assert.equal(body.expected_version, source.version)
      source = { ...source, version: source.version + 1, record_state: method === 'DELETE' ? 'deleted' : 'active' }
      if (method === 'DELETE') source = { ...source, deleted_at: new Date().toISOString(), deleted_by: 'TEST-ADMIN', delete_reason: body.reason }
      data = { id: source.id, version: source.version, record_state: source.record_state, changed: true }
    } else { unexpected.push(`${method} ${path}`); status = 503; data = null }
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ code: status === 200 ? 'OK' : 'UNEXPECTED_TEST_ROUTE', data }) })
  })
  const page = await context.newPage()
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => { if (['warning','error'].includes(message.type())) consoleMessages.push(message.text()) })
  await page.goto(`${origin}/src/test/ui-harness/contract-record.html`)
  await page.waitForFunction(() => document.querySelector('#app')?.hasAttribute('data-v-app'))
  assert.equal(await page.getByRole('button', { name: '删除合成合同', exact: true }).count(), 1,
    JSON.stringify({ errors, consoleMessages, html: await page.locator('#app').innerHTML() }))
  await mkdir(output, { recursive: true })
  if (scenario === 'delete') {
    await page.getByRole('button', { name: '删除合成合同', exact: true }).click()
    const confirm = page.getByRole('button', { name: '确认删除', exact: true })
    await confirm.waitFor()
    assert.equal(await confirm.isDisabled(), true)
    await page.getByRole('textbox', { name: '删除原因' }).fill('合成误建记录')
    await page.screenshot({ path: `${output}/frontend-delete-dialog.png`, fullPage: true, animations: 'disabled' })
    await confirm.click()
    await page.getByRole('dialog').waitFor({ state: 'hidden' })
    await page.getByRole('button', { name: '回收站', exact: true }).click()
    await page.getByText('合成验收合同', { exact: true }).waitFor()
    assert.equal(calls.filter((call) => call.method === 'DELETE').length, 1)
    assert.equal(await page.getByRole('button', { name: '核对并恢复', exact: true }).count(), 1)
  } else {
    await page.getByRole('button', { name: '回收站', exact: true }).click()
    await page.getByRole('button', { name: '核对并恢复', exact: true }).click()
    const confirm = page.getByRole('button', { name: '确认恢复', exact: true })
    await confirm.waitFor()
    await page.waitForFunction(() => [...document.querySelectorAll('[role="dialog"] button')]
      .some((button) => button.textContent.trim() === '确认恢复' && !button.disabled))
    assert.equal(await confirm.isEnabled(), true)
    await confirm.click()
    await page.getByRole('dialog').waitFor({ state: 'hidden' })
    await page.getByText('没有符合条件的已删除合同。', { exact: true }).waitFor()
    assert.equal(calls.filter((call) => call.method === 'POST').length, 1)
  }
  assert.equal(await page.locator('iframe').count(), 0)
  assert.deepEqual(unexpected, [])
  assert.deepEqual(errors, [])
  await mkdir(output, { recursive: true })
  await page.screenshot({ path: `${output}/frontend-${scenario}.png`, fullPage: true, animations: 'disabled' })
  const result = { scenario, status: 'PASS', scope: 'real Vue and browser, synthetic HTTP responses', calls, errors, unexpected }
  await writeFile(`${output}/frontend-${scenario}.json`, JSON.stringify(result, null, 2))
  console.log(JSON.stringify({ scenario, status: 'PASS', requests: calls.length }))
} finally {
  if (browser) await browser.close()
  await server.close()
}
