import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { mkdir, writeFile } from 'node:fs/promises'
import { createServer } from 'vite'
import vue from '@vitejs/plugin-vue'
import { chromium } from 'playwright-core'

const fixture = JSON.parse(process.env.SETTLEMENT_ROLE_BROWSER_FIXTURE || '{}')
assert.equal(new URL(fixture.origin).hostname, '127.0.0.1')
assert.equal(new URL(fixture.origin).port, '18173')
assert.equal(new URL(fixture.apiBase).hostname, '127.0.0.1')
const root = fileURLToPath(new URL('../../../', import.meta.url))
const output = process.env.SETTLEMENT_BROWSER_RESULT_DIR || fileURLToPath(
  new URL('../../../../.ai/qa/settlement-role-integration-20261028/browser/', import.meta.url))
const results = []
const selected = (process.env.SETTLEMENT_ROLE_BROWSER_CASES || '').split(',').filter(Boolean)
await mkdir(output, { recursive: true })
const server = await createServer({
  configFile: false, root, plugins: [vue()],
  resolve: { alias: { '@': fileURLToPath(new URL('../../', import.meta.url)) } },
  server: { host: '127.0.0.1', port: Number(new URL(fixture.origin).port), strictPort: true,
    proxy: { '/settlement/api': { target: fixture.apiBase, changeOrigin: false,
      rewrite: path => path.replace(/^\/settlement/, '') } } },
})
let browser

// 用途：创建仅携带隔离夹具会话的真实浏览器页面并等待当前组件加载。
// 参数：role 为夹具角色；section 为直接进入的结算页面。
// 返回值：页面、浏览器上下文及脱敏请求记录。
async function openRole(role, section) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  await context.addCookies([{ name: 'settlement_session', value: fixture.sessions[role].cookie,
    url: fixture.origin, httpOnly: true, sameSite: 'Lax' }])
  await context.route('**/*', route => {
    const url = new URL(route.request().url())
    return url.origin === fixture.origin ? route.continue() : route.abort('blockedbyclient')
  })
  const page = await context.newPage()
  page.setDefaultTimeout(10000)
  const requests = [], errors = []
  page.on('pageerror', value => errors.push(value.message))
  page.on('response', response => {
    const url = new URL(response.url())
    if (url.pathname.startsWith('/settlement/api/')) requests.push({
      method: response.request().method(), path: url.pathname, status: response.status(),
    })
  })
  await page.goto(`${fixture.origin}/src/test/ui-harness/settlement-role.html?section=${section}`)
  await page.locator('.console-sidebar').waitFor()
  await page.waitForFunction(() => !document.querySelector('.settlement-loading'))
  return { page, context, requests, errors }
}

// 用途：执行独立业务断言并保存不含会话和请求头的结果。
// 参数：id 为用例名；role 为角色；section 为入口；run 为浏览器断言。
// 返回值：无；失败计入最终退出码。
async function check(id, role, section, run) {
  if (selected.length && !selected.includes(id)) return
  let session
  try {
    session = await openRole(role, section)
    await run(session.page, session.requests)
    assert.deepEqual(session.errors, [], '组件不得抛出未捕获异常')
    results.push({ id, role, status: 'PASS', requests: session.requests })
  } catch (error) {
    const failure = { id, role, status: 'FAIL', error: error.message.slice(0, 3000), requests: session?.requests || [] }
    results.push(failure)
    if (session) {
      try { await session.page.screenshot({ path: `${output}/${id}.png`, fullPage: true }) }
      catch (capture) { failure.screenshot_error = capture.message.slice(0, 300) }
    }
  } finally { await session?.context.close() }
}

// 用途：提交真实表单并读取对应写请求的业务结果，避免只凭页面提示断言。
// 参数：page 为页面；name/path/method 为写入信息；scope 为可选按钮所在区域。
// 返回值：真实 HTTP 响应的状态及业务数据。
async function submit(page, name, path, method = 'POST', scope = page) {
  const [response] = await Promise.all([
    page.waitForResponse(response => new URL(response.url()).pathname === `/settlement/api/v1${path}` &&
      response.request().method() === method),
    scope.getByRole('button', { name, exact: true }).click(),
  ])
  const body = await response.json()
  assert.ok(response.ok(), `${name}: HTTP ${response.status()} ${body.code || ''}`)
  await page.getByRole('status').filter({ hasText: '操作已保存' }).waitFor()
  await page.waitForFunction(() => !document.querySelector('.settlement-role-panel[aria-busy="true"]'))
  return body.data
}

// 用途：用当前真实浏览器会话读取已持久化业务资源作为独立联测断言。
// 参数：page 为浏览器页面；path 为结算资源路径。
// 返回值：服务端业务数据；非成功响应导致用例失败。
async function readResource(page, path) {
  const response = await page.request.get(`${fixture.origin}/settlement/api/v1${path}`)
  assert.ok(response.ok(), `读取 ${path}: HTTP ${response.status()}`)
  return (await response.json()).data
}

try {
  await server.listen()
  browser = await chromium.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true,
  })
  await check('management-readonly', 'management', 'finance', async (page, requests) => {
    await page.getByRole('button', { name: '结算总览', exact: true }).waitFor()
    assert.equal(await page.getByRole('button', { name: '差异与会计凭证', exact: true }).count(), 0)
    assert.equal(await page.getByRole('button', { name: '回款核销', exact: true }).count(), 0)
    assert.equal(await page.getByRole('button', { name: '保存设置', exact: true }).count(), 0)
    assert.ok(requests.some(item => item.path.endsWith('/dashboard')))
    assert.equal(requests.some(item => /\/receipts|\/receipt-allocations|\/accounting-vouchers/.test(item.path)), false)
  })
  await check('configadmin-settings', 'configadmin', 'finance', async (page, requests) => {
    await page.getByRole('heading', { name: '结算规则设置' }).waitFor()
    assert.equal(await page.getByRole('button', { name: '回款核销', exact: true }).count(), 0)
    assert.equal(requests.some(item => /\/receivable-plans|\/receipts|\/dashboard/.test(item.path)), false)
  })
  await check('no-role', 'none', 'finance', async (page, requests) => {
    await page.getByText('当前账号没有可用的结算能力，请联系管理员配置角色。').waitFor()
    assert.equal(requests.filter(item => !item.path.endsWith('/auth/me')).length, 0)
    assert.equal(await page.getByRole('button', { name: '登记差异', exact: true }).count(), 0)
  })
  await check('director-special-only', 'director', 'invoices', async (page, requests) => {
    await page.getByRole('navigation', { name: '结算模块导航' })
      .getByRole('button', { name: '我的待办', exact: true }).waitFor()
    assert.equal(await page.getByRole('button', { name: '差异与会计凭证', exact: true }).count(), 0)
    assert.equal(await page.getByRole('button', { name: '结算设置', exact: true }).count(), 0)
    assert.equal(await page.getByRole('button', { name: '发起开票申请', exact: true }).count(), 0)
    assert.equal(requests.some(item => /\/invoice-eligible-receivables|\/receipts|\/accounting-vouchers/.test(item.path)), false)
  })
  await check('sales-adjust-repeat', 'sales', 'receivables', async page => {
    assert.equal(await page.getByRole('button', { name: '差异与会计凭证', exact: true }).count(), 0)
    const form = page.locator('form').filter({ has: page.getByRole('button', { name: '提交调整', exact: true }) })
    await form.locator('select').selectOption(fixture.data.plan_id)
    await form.getByLabel('金额', { exact: true }).fill('80')
    await form.getByLabel('调整原因', { exact: true }).fill('隔离浏览器调整80')
    await submit(page, '提交调整', `/receivable-plans/${fixture.data.plan_id}/adjust`)
    await page.waitForFunction(() => {
      const amount = document.querySelector('.settlement-receivables .settlement-money')
      return amount && Number(amount.textContent.replace(/[^0-9.-]/g, '')) === 80
    }, null, { timeout: 3000 })
    const first = (await readResource(page, '/receivable-plans')).find(item => item.id === fixture.data.plan_id)
    assert.equal(Number(first.planned_amount), 80)
    const nextForm = page.locator('form').filter({ has: page.getByRole('button', { name: '提交调整', exact: true }) })
    await nextForm.locator('select').selectOption(fixture.data.plan_id)
    await nextForm.getByLabel('调整原因', { exact: true }).fill('隔离浏览器再次保存80')
    await submit(page, '提交调整', `/receivable-plans/${fixture.data.plan_id}/adjust`)
    const second = (await readResource(page, '/receivable-plans')).find(item => item.id === fixture.data.plan_id)
    assert.ok(second.version > first.version, '第二次调整必须使用刷新后的当前版本')
  })
  await check('settings-repeat', 'manager', 'settings', async page => {
    await page.getByLabel('提前提醒天数', { exact: true }).fill('8')
    const first = await submit(page, '保存设置', '/settings', 'PUT')
    await page.getByLabel('提前提醒天数', { exact: true }).fill('9')
    const second = await submit(page, '保存设置', '/settings', 'PUT')
    assert.ok(second.version > first.version)
    assert.equal(second.reminder_lead_days, 9)
  })
  await check('assistant-mapping', 'assistant', 'collaboration', async page => {
    await page.getByRole('heading', { name: '项目协作范围' }).waitFor()
    assert.equal(await page.getByRole('button', { name: '保存分配', exact: true }).count(), 0)
    assert.equal(await page.getByRole('button', { name: '编辑分配', exact: true }).count(), 0)
    await page.getByLabel(/^已分配项目/).selectOption(fixture.data.project_id)
    await page.getByLabel('项目映射说明', { exact: true }).fill('隔离浏览器映射说明')
    const saved = await submit(page, '保存映射说明', '/project-mappings', 'PUT')
    assert.equal(saved.saved, true)
    const assignments = await readResource(page, '/project-assignments')
    const first = assignments.find(item => item.project_id === fixture.data.project_id)
    assert.equal(first.note, '隔离浏览器映射说明')
    await submit(page, '保存映射说明', '/project-mappings', 'PUT')
    const second = (await readResource(page, '/project-assignments'))
      .find(item => item.project_id === fixture.data.project_id)
    assert.equal(second.version, first.version + 1, '连续保存映射使用当前版本')
  })
  await check('collaboration-new-selection', 'manager', 'collaboration', async page => {
    await page.getByRole('button', { name: '编辑分配', exact: true }).first().click()
    await page.getByLabel('权威项目ID', { exact: true }).fill(fixture.data.project2_id)
    await page.getByLabel('助理姓名或账号', { exact: true }).fill(fixture.data.assistant2_id)
    await page.getByRole('button', { name: '查询项目与有效助理', exact: true }).click()
    const form = page.locator('form').filter({ has: page.getByRole('button', { name: '保存分配', exact: true }) })
    await form.locator('select').first().selectOption(fixture.data.project2_id)
    await page.getByLabel(/^有效项目助理用户ID/).selectOption(fixture.data.assistant2_id)
    const saved = await submit(page, '保存分配', '/project-assignments')
    assert.equal(saved.saved, true)
    const assignments = await readResource(page, '/project-assignments')
    const created = assignments.find(item => item.project_id === fixture.data.project2_id && item.user_id === fixture.data.assistant2_id)
    assert.equal(created.version, 1, '新协作组合应使用创建版本而非旧记录版本')
    await submit(page, '保存分配', '/project-assignments')
    const updated = (await readResource(page, '/project-assignments'))
      .find(item => item.project_id === fixture.data.project2_id && item.user_id === fixture.data.assistant2_id)
    assert.equal(updated.version, 2, '连续保存同项目同人员分配使用当前版本')
  })
  await check('voucher-unconfigured-idempotent', 'accountant', 'finance', async page => {
    const form = page.locator('form').filter({ has: page.getByRole('button', { name: '生成本地凭证', exact: true }) })
    await form.locator('select').selectOption(fixture.data.allocation_id)
    const first = await submit(page, '生成本地凭证', '/accounting-vouchers')
    assert.equal(first.status, 'NOT_CONFIGURED')
    assert.ok(!first.external_no)
    const second = await submit(page, '生成本地凭证', '/accounting-vouchers')
    assert.equal(second.id, first.id)
    assert.equal(second.status, 'NOT_CONFIGURED')
    const row = page.getByRole('row').filter({ hasText: fixture.data.allocation_id })
    await row.getByRole('cell', { name: 'ERP 未配置 / 未回传', exact: true }).waitFor()
    assert.equal(await row.count(), 1)
  })
  await check('difference-register-resolve', 'accountant', 'finance', async page => {
    const form = page.locator('form').filter({ has: page.getByRole('button', { name: '登记差异', exact: true }) })
    await form.locator('select').first().selectOption(fixture.data.receipt_id)
    await form.getByLabel('金额', { exact: true }).fill('2')
    await form.getByLabel('原因', { exact: true }).fill('隔离浏览器不明款')
    const difference = await submit(page, '登记差异', '/receipt-differences')
    const created = (await readResource(page, '/receipt-differences')).items.find(item => item.id === difference.id)
    assert.equal(created.status, 'HELD')
    const resolveForm = page.locator('form').filter({ has: page.getByRole('button', { name: '提交处置审批', exact: true }) })
    await resolveForm.locator('select').first().selectOption(difference.id)
    await resolveForm.getByLabel('处置原因', { exact: true }).fill('隔离浏览器结转审批')
    const resolved = await submit(page, '提交处置审批', `/receipt-differences/${difference.id}/resolve`)
    assert.equal(resolved.status, 'OK')
    const stored = (await readResource(page, '/receipt-differences')).items.find(item => item.id === difference.id)
    assert.equal(stored.status, 'REVIEW_PENDING')
    assert.equal(stored.resolution, 'CARRY_FORWARD')
  })
  if (fixture.data.landing === '1') {
    await check('history-contract-candidate', 'sales', 'receivables', async page => {
      const controls = page.getByRole('group', { name: '合同候选分页' })
      for (let index = 0; index < 4; index++) {
        await controls.getByRole('button', { name: '下一页', exact: true }).click()
        await page.waitForFunction(() => !document.querySelector('.role-panel-loading'))
      }
      const form = page.locator('form').filter({ has: page.getByRole('button', { name: '创建计划', exact: true }) })
      await form.locator('select').selectOption(fixture.data.old_snapshot_id)
      assert.match(await form.locator('select').inputValue(), new RegExp(fixture.data.old_snapshot_id))
      await form.getByLabel('期次', { exact: true }).fill('1')
      await form.getByLabel('收款日', { exact: true }).fill('2099-12-10')
      await form.getByLabel('金额', { exact: true }).fill('10')
      await form.getByLabel('原因', { exact: true }).fill('历史合同翻页创建计划')
      const created = await submit(page, '创建计划', '/receivable-plans')
      const stored = (await readResource(page, '/receivable-plans')).find(item => item.id === created.id)
      assert.equal(Number(stored.planned_amount), 10)
      await controls.getByRole('button', { name: '上一页', exact: true }).click()
      await page.waitForFunction(() => !document.querySelector('.role-panel-loading'))
      assert.equal(await form.locator('select').inputValue(), '')
    })
    await check('history-assistant-mapping', 'assistant', 'collaboration', async page => {
      const controls = page.getByRole('group', { name: '项目分配分页' })
      for (let index = 0; index < 4; index++) {
        await controls.getByRole('button', { name: '下一页', exact: true }).click()
        await page.waitForFunction(() => !document.querySelector('.role-panel-loading'))
      }
      await page.getByLabel(/^已分配项目/).selectOption(fixture.data.old_project_id)
      await page.getByLabel('项目映射说明', { exact: true }).fill('历史项目翻页后可维护')
      await submit(page, '保存映射说明', '/project-mappings', 'PUT')
      const stored = await readResource(page, '/project-assignments?limit=50&offset=0')
      assert.equal(stored.find(item => item.project_id === fixture.data.old_project_id).note, '历史项目翻页后可维护')
    })
    await check('history-finance-receipts', 'accountant', 'finance', async page => {
      for (let index = 0; index < 4; index++) {
        await Promise.all([
          page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/receipts') && response.request().method() === 'GET'),
          page.getByRole('button', { name: '回款下一页', exact: true }).click(),
        ])
        await page.getByRole('heading', { name: '回款差异处置', exact: true }).waitFor()
      }
      const form = page.locator('form').filter({ has: page.getByRole('button', { name: '登记差异', exact: true }) })
      await form.locator('select').first().selectOption(fixture.data.old_receipt_id)
      await form.getByLabel('金额', { exact: true }).fill('1')
      await form.getByLabel('原因', { exact: true }).fill('历史回款翻页登记')
      const created = await submit(page, '登记差异', '/receipt-differences')
      const stored = (await readResource(page, '/receipt-differences')).items.find(item => item.id === created.id)
      assert.equal(stored.receipt_id, fixture.data.old_receipt_id)
    })
    await check('history-pending-and-failed', 'manager', 'finance', async page => {
      const differences = page.getByRole('group', { name: '差异记录分页' })
      for (let index = 0; index < 4; index++) {
        await differences.getByRole('button', { name: '下一页', exact: true }).click()
        await page.waitForFunction(() => !document.querySelector('.role-panel-loading'))
      }
      const row = page.getByRole('row').filter({ hasText: fixture.data.old_receipt_id })
        .filter({ has: page.getByRole('button', { name: '审批处置', exact: true }) })
      await submit(page, '审批处置', `/receipt-differences/${fixture.data.old_difference_id}/approve`, 'POST', row)
      const vouchers = page.getByRole('group', { name: '会计凭证分页' })
      for (let index = 0; index < 4; index++) {
        await vouchers.getByRole('button', { name: '下一页', exact: true }).click()
        await page.waitForFunction(() => !document.querySelector('.role-panel-loading'))
      }
      const voucher = page.getByRole('row').filter({ hasText: fixture.data.old_allocation_id })
      await voucher.getByRole('cell', { name: 'FAILED', exact: true }).waitFor()
      await submit(page, '重试回传', `/accounting-vouchers/${fixture.data.old_voucher_id}/retry`, 'POST', voucher)
      await voucher.getByRole('cell', { name: 'ERP 未配置 / 未回传', exact: true }).waitFor()
      await page.getByLabel('差异状态筛选', { exact: true }).selectOption('REVIEW_PENDING')
      await page.getByRole('button', { name: '筛选差异', exact: true }).click()
      await page.waitForFunction(() => !document.querySelector('.role-panel-loading'))
      assert.match(await differences.textContent(), /第 1 页/)
      const pending = (await readResource(page, '/receipt-differences?status=REVIEW_PENDING&limit=50')).items
      assert.ok(pending.every(item => item.status === 'REVIEW_PENDING'))
    })
    await check('history-allocation-voucher', 'accountant', 'finance', async page => {
      const controls = page.getByRole('group', { name: '核销候选分页' })
      for (let index = 0; index < 4; index++) {
        await controls.getByRole('button', { name: '下一页', exact: true }).click()
        await page.waitForFunction(() => !document.querySelector('.role-panel-loading'))
      }
      const form = page.locator('form').filter({ has: page.getByRole('button', { name: '生成本地凭证', exact: true }) })
      await form.locator('select').selectOption(fixture.data.old_allocation_id)
      const saved = await submit(page, '生成本地凭证', '/accounting-vouchers')
      assert.equal(saved.id, fixture.data.old_voucher_id)
      assert.equal(saved.status, 'NOT_CONFIGURED')
    })
    await check('refund-complete-multi-role', 'accountant', 'finance', async page => {
      const form = page.locator('form').filter({ has: page.getByRole('button', { name: '登记差异', exact: true }) })
      await form.locator('select').first().selectOption(fixture.data.receipt_id)
      await form.getByLabel('金额', { exact: true }).fill('2')
      await form.getByLabel('原因', { exact: true }).fill('隔离浏览器退款完成')
      const created = await submit(page, '登记差异', '/receipt-differences')
      const resolve = page.locator('form').filter({ has: page.getByRole('button', { name: '提交处置审批', exact: true }) })
      await resolve.locator('select').first().selectOption(created.id)
      await resolve.locator('select').nth(1).selectOption('REFUND_PENDING')
      await resolve.getByLabel('处置原因', { exact: true }).fill('线下退款审批')
      await submit(page, '提交处置审批', `/receipt-differences/${created.id}/resolve`)
      const manager = await openRole('manager', 'finance')
      try {
        const row = manager.page.getByRole('row').filter({ hasText: '隔离浏览器退款完成' })
        await submit(manager.page, '审批处置', `/receipt-differences/${created.id}/approve`, 'POST', row)
        assert.deepEqual(manager.errors, [])
      } finally { await manager.context.close() }
      await page.reload()
      await page.getByLabel('待确认退款', { exact: true }).selectOption(created.id)
      const before = (await readResource(page, '/receipts')).find(item => item.id === fixture.data.receipt_id).unallocated_amount
      await page.getByLabel('退款凭证号', { exact: true }).fill('QA-BROWSER-REFUND-001')
      const completed = await page.evaluate(() => {
        const value = new Date(Date.now() - 60000)
        return new Date(value.getTime() - value.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
      })
      await page.getByLabel('退款完成时间', { exact: true }).fill(completed)
      await page.getByLabel('退款确认原因', { exact: true }).fill('核对线下银行凭证后回录')
      await submit(page, '确认已完成退款', `/receipt-differences/${created.id}/confirm-refund`)
      const saved = (await readResource(page, '/receipt-differences?status=REFUND_CONFIRMED')).items.find(item => item.id === created.id)
      assert.equal(saved.status, 'REFUND_CONFIRMED')
      assert.equal(saved.refund_reference, 'QA-BROWSER-REFUND-001')
      assert.equal(saved.refund_confirmed_by, fixture.sessions.accountant.user_id)
      assert.equal((await readResource(page, '/receipts')).find(item => item.id === fixture.data.receipt_id).unallocated_amount, before)
      await page.getByRole('cell', { name: 'QA-BROWSER-REFUND-001', exact: true }).waitFor()
    })
  }
} finally {
  try { await browser?.close() }
  finally { await server.close() }
  await writeFile(`${output}/results.json`, JSON.stringify(results, null, 2))
  console.log(JSON.stringify({ browser: 'Chrome', component: 'SettlementView', results }))
}
assert.ok(results.length > 0, '禁止零用例通过')
if (results.some(item => item.status !== 'PASS')) process.exitCode = 1
