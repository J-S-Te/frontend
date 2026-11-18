import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import vue from '@vitejs/plugin-vue'
import { chromium } from 'playwright-core'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const output = (process.env.LIFECYCLE_OUTPUT_DIR || fileURLToPath(new URL('../../../../.ai/qa/vue-lifecycle-optimization-20261108/', import.meta.url))).replace(/\/?$/, '/')
const scenario = process.env.LIFECYCLE_SCENARIO || 'owner-failure-retry'
const allowed = ['owner-failure-retry', 'configuration-initialization-switch',
  'async-load-retry-reopen-props-events', 'dialog-focus-cycle-close-unmount',
  'draft-unmount-restore', 'project-section-load-failure-retry-refresh-permission']
assert.ok(allowed.includes(scenario), '请选择一个已知的最小验收场景')
const server = await createServer({ configFile: false, root, plugins: [vue()],
  resolve: { alias: { '@': root + 'src' } },
  server: { host: '127.0.0.1', port: 0, hmr: false }, logLevel: 'error' })
let browser
const results = [], unexpected = [], calls = [], freshAuthorizationReads = []
try {
  await server.listen()
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH
    || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true })
  const context = await browser.newContext()
  if (scenario === 'project-section-load-failure-retry-refresh-permission') {
    await context.addCookies([{ name: 'project_management_session',
      value: 'isolated-same-session', url: origin, httpOnly: true }])
  }
  let failOwners = false
  let failCatalog = false
  let revokeConfig = false
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url())
    if (url.origin !== origin) { unexpected.push('external request'); return route.abort() }
    if (!/^\/(api\/v1|project_management\/api|customer-opportunity\/api)/.test(url.pathname)) return route.continue()
    calls.push(url.pathname + url.search)
    assert.equal(request.method(), 'GET', '隔离验收禁止业务写请求')
    let data = { items: [], total: 0 }
    if (url.pathname.endsWith('/auth/me')) data = { tenant_id: 'qa', identity_id: 'qa-user',
      tenant: { id: 'qa' }, user: { id: 'qa-user' }, account: { id: 'qa-account' }, roles: ['admin'], permissions: ['project.read', 'project_rule.manage'],
      permission_codes: ['platform:config-item:update'], authorization_revision: 1 }
    else if (url.pathname.endsWith('/owner-directory')) {
      if (failOwners) return route.fulfill({ status: 503, json: { code: 'CRM_OWNER_DIRECTORY_UNAVAILABLE', message: 'unavailable' } })
      data = { items: [{ user_id: 'qa-user', username: url.searchParams.get('keyword') || '合成负责人',
        organizations: [{ organization_id: 'qa-org', organization_name: '合成组织', is_primary: true }] }] }
    } else if (url.pathname.endsWith('/config/namespaces')) data = { items: [
      { namespace_id: 'a', code: 'a', name: 'A', application: { code: 'qa', name: '合成应用' } },
      { namespace_id: 'b', code: 'b', name: 'B', application: { code: 'qa', name: '合成应用' } },
    ] }
    else if (url.pathname.endsWith('/config/items')) data = { items: [{ item_id: 'item', key: 'synthetic',
      value_type: 'JSON', value: { namespace: url.searchParams.get('filter[namespace_id]') }, version: 1 }] }
    else if (url.pathname.endsWith('/navigation')) data = { sections: revokeConfig ? ['projects', 'preparation'] : ['projects', 'automations', 'preparation'], default_section: 'projects', authorization_revision: revokeConfig ? 2 : 1 }
    else if (url.pathname.endsWith('/dashboard')) data = { project_count: 0, service_items: 0 }
    else if (url.pathname.endsWith('/rule-configuration-catalog')) {
      if (failCatalog) return route.fulfill({ status: 503, json: { code: 'UNAVAILABLE', message: 'synthetic unavailable' } })
      data = { automation_triggers: [{ value: 'FIELD_COMPLETED', label: '合成交付事件' }], sla_statuses: [] }
    }
    else if (/\/(rules|capabilities|delivery-events|detection-categories|equipment|personnel|roles)$/.test(url.pathname)) data = { items: [] }
    if (scenario === 'project-section-load-failure-retry-refresh-permission'
      && url.pathname === '/project_management/api/v1/auth/me') {
      const headers = request.headers()
      if (headers['x-authorization-refresh'] === '1') {
        assert.ok(headers.cookie?.includes('project_management_session=isolated-same-session'))
        freshAuthorizationReads.push(calls.length)
      }
      if (revokeConfig) data = { ...data, roles: ['viewer'], permissions: ['project.read'],
        authorization_revision: 2 }
    }
    await route.fulfill({ json: { code: 'OK', data } })
  })
  const page = await context.newPage()
  page.setDefaultTimeout(10000)
  page.setDefaultNavigationTimeout(15000)
  page.on('pageerror', error => unexpected.push(error.message))
  await page.goto(`${origin}/src/test/ui-harness/vue-lifecycle.html`)
  await page.waitForFunction(() => window.fixtureReady)

  if (scenario === 'owner-failure-retry') {
  await page.evaluate(() => window.mountOwner())
  await page.getByRole('option', { name: '合成负责人' }).waitFor({ state: 'attached' })
  failOwners = true
  await page.getByPlaceholder('输入姓名关键字').fill('失败条件')
  await page.getByPlaceholder('输入姓名关键字').press('Enter')
  await page.getByRole('alert').waitFor()
  failOwners = false
  await page.getByRole('button', { name: '重试', exact: true }).click()
  await page.getByRole('option', { name: '合成负责人' }).waitFor({ state: 'attached' })
  assert.equal(await page.getByRole('alert').count(), 0)
  console.log('CHECKPOINT', results.length + 1)
  results.push({ case: 'owner-failure-retry', status: 'PASS' })

  }

  if (scenario === 'configuration-initialization-switch') {
  await page.evaluate(() => window.mountConfiguration())
  const editor = page.locator('tbody textarea')
  await editor.waitFor()
  assert.match(await editor.inputValue(), /"a"/)
  await editor.fill('保留当前输入')
  await page.locator('.configuration-card > header select').selectOption('b')
  await page.waitForFunction(() => document.querySelector('tbody textarea')?.value.includes('"b"'))
  console.log('CHECKPOINT', results.length + 1)
  results.push({ case: 'configuration-initialization-switch', status: 'PASS' })

  }

  if (scenario === 'async-load-retry-reopen-props-events') {
  await page.evaluate(() => window.mountAsync())
  assert.equal(await page.evaluate(() => window.asyncLoads || 0), 0)
  await page.evaluate(() => { window.asyncOpen.value = true })
  await page.getByRole('button', { name: '重试加载', exact: true }).click()
  await page.locator('#async-action').waitFor()
  assert.equal(await page.locator('#async-action').isDisabled(), true)
  await page.evaluate(() => { window.asyncCanManage.value = true })
  await page.locator('#async-action').click()
  assert.equal(await page.evaluate(() => window.asyncNotice), '已触发原业务事件')
  await page.evaluate(() => { window.asyncOpen.value = false })
  await page.locator('#async-action').waitFor({ state: 'detached' })
  await page.evaluate(() => { window.asyncOpen.value = true })
  await page.locator('#async-action').waitFor()
  console.log('CHECKPOINT', results.length + 1)
  results.push({ case: 'async-load-retry-reopen-props-events', status: 'PASS' })

  }

  if (scenario === 'dialog-focus-cycle-close-unmount') {
  await page.evaluate(() => window.mountFocus())
  await page.locator('#opener').focus()
  await page.evaluate(() => { window.focusActive.value = true })
  await page.waitForFunction(() => document.activeElement?.id === 'focus-first')
  await page.keyboard.press('Shift+Tab')
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'focus-last')
  await page.keyboard.press('Tab')
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'focus-first')
  await page.locator('#focus-last').click()
  await page.waitForFunction(() => document.activeElement?.id === 'opener')
  await page.evaluate(() => { window.focusActive.value = true; window.unmountFixture() })
  assert.equal(await page.locator('[role="dialog"]').count(), 0)
  console.log('CHECKPOINT', results.length + 1)
  results.push({ case: 'dialog-focus-cycle-close-unmount', status: 'PASS' })

  }

  if (scenario === 'draft-unmount-restore') {
  await page.evaluate(() => window.mountDraft())
  await page.locator('#draft-input').fill('独立合成草稿')
  await page.evaluate(() => window.unmountFixture())
  await page.evaluate(() => window.mountDraft())
  await page.locator('#restore-draft').click()
  await page.waitForFunction(() => document.querySelector('#draft-input')?.value === '独立合成草稿')
  console.log('CHECKPOINT', results.length + 1)
  results.push({ case: 'draft-unmount-restore', status: 'PASS' })

  }

  if (scenario === 'project-section-load-failure-retry-refresh-permission') {
  const beforeProject = calls.length
  await page.evaluate(() => window.mountProject())
  await page.waitForFunction(() => !document.body.textContent.includes('正在读取当前栏目数据'))
  await page.waitForFunction(() => document.querySelector('.pm-main') && !document.querySelector('.ui-state__spinner'))
  assert.equal(calls.slice(beforeProject).some(path => path.includes('/rule-configuration-catalog')), false)
  const beforeConfig = calls.length
  failCatalog = true
  await Promise.all([page.waitForResponse(response => response.url().includes('/rule-configuration-catalog')),
    page.evaluate(() => window.projectRouter.push('/project/automations'))])
  assert.equal(calls.slice(beforeConfig).some(path => path.includes('/dashboard')), false)
  await page.getByRole('button', { name: '重试当前栏目', exact: true }).waitFor()
  failCatalog = false
  await Promise.all([page.waitForResponse(response => response.url().includes('/rule-configuration-catalog')),
    page.getByRole('button', { name: '重试当前栏目', exact: true }).click()])
  await page.getByRole('button', { name: '重试当前栏目', exact: true }).waitFor({ state: 'detached' })
  await page.getByRole('button', { name: '＋ 新建规则', exact: true }).click()
  await page.getByRole('combobox', { name: '选择触发事件' }).click()
  await page.getByRole('option', { name: /合成交付事件/ }).waitFor()
  await page.locator('.pm-dialog').getByRole('button', { name: '关闭', exact: true }).click()
  revokeConfig = true
  const beforeRefresh = calls.length
  const beforeFreshReads = freshAuthorizationReads.length
  await page.getByRole('button', { name: '刷新', exact: true }).first().click()
  await page.waitForFunction(() => window.projectRouter.currentRoute.value.params.section === 'projects')
  await page.waitForFunction(() => !document.querySelector('.ui-state__spinner'))
  assert.equal(calls.slice(beforeRefresh).some(path => path.includes('/rule-configuration-catalog')), false)
  assert.ok(freshAuthorizationReads.length > beforeFreshReads,
    '页内刷新未用原 Cookie 显式读取最新授权')
  const beforeReload = freshAuthorizationReads.length
  await page.reload()
  await page.waitForFunction(() => window.fixtureReady)
  await page.evaluate(() => window.mountProject())
  await page.waitForFunction(() => document.querySelector('.pm-main') && !document.querySelector('.ui-state__spinner'))
  assert.ok(freshAuthorizationReads.length > beforeReload, 'F5 未显式重读授权')
  assert.equal(await page.getByRole('button', { name: '＋ 新建规则', exact: true }).count(), 0)
  const cookie = (await context.cookies()).find(item => item.name === 'project_management_session')
  assert.equal(cookie?.value, 'isolated-same-session', '权限刷新不应替换或清理登录Cookie')
  console.log('CHECKPOINT', results.length + 1)
  results.push({ case: 'project-section-load-failure-retry-refresh-permission', status: 'PASS' })

  }

  assert.equal(results.length, 1)
  assert.deepEqual(unexpected, [])
  const errors = await page.evaluate(() => window.fixtureErrors)
  // 首次模块加载失败是本用例主动注入的唯一预期错误。
  assert.deepEqual(errors.filter(message => message !== 'synthetic module failure'), [])
  await mkdir(output, { recursive: true })
  await writeFile(output + scenario + '-browser-results.json', JSON.stringify({ mode: 'isolated-local-components', versions: { node: process.version, chromium: browser.version() }, results, unexpected, fresh_authorization_reads: freshAuthorizationReads.length }, null, 2) + '\n')
  console.log(JSON.stringify(results))
  await context.close()
} finally { await browser?.close(); await server.close() }
