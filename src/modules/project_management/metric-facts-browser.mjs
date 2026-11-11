import { chromium } from 'playwright-core'
import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'

const base = 'http://127.0.0.1:5197'
const output = '/Users/yglf/GOPATH/src/Unified_Identity_Authentication_Platform/.ai/qa/dashboard-metrics-completion-20261111/'
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true })
const results = []
try {
  for (const role of ['quality', 'device', 'engineer']) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
    const commands = [], errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    const mainPending = { id: 'main-pending', subject_type: 'SERVICE_ITEM', revision: 0, round_no: 1, prepared_by: 'author', submitted_by: 'manager', submitted_at: '2026-11-01T01:00:00Z', decision: 'PENDING' }
    const history = Array.from({ length: 50 }, (_, index) => ({ ...mainPending, id: `special-${index}`, subject_type: 'PENETRATION_WORK_PACKAGE', decision: 'RETURNED', round_no: 100 - index }))
    await page.route(`${base}/project_management/api/v1/**`, async (route) => {
      const request = route.request(), url = new URL(request.url()), path = url.pathname
      let data
      if (request.method() === 'POST') { commands.push({ path, body: request.postDataJSON() }); data = { id: 'saved' } }
      else if (path.endsWith('/personnel')) data = { items: [{ user_id: 'witness', display_name: '目录测试人员', organizations: [{ organization_id: 'org-1', organization_name: '测试业务组织' }] }], total: 1 }
      else if (path.endsWith('/capacities')) data = []
      else if (path.endsWith('/usages')) data = role === 'quality' ? [{ id: 'U-pending', resource_id: 'person', resource_type: 'PERSON', service_item_id: 'SI-running', business_date: '2026-11-01', start: '2026-11-01T01:00:00Z', end: '2026-11-01T02:00:00Z', minutes: 60, status: 'PENDING', version: 2, created_by: 'manager', submitted_by: 'manager', note: '合成实际记录' }] : []
      else if (path.endsWith('/report-reviews/current')) data = [mainPending]
      else if (path.endsWith('/report-reviews')) data = url.searchParams.get('page') === '2' ? [mainPending] : history
      else throw new Error(`Unexpected fixture request ${path}`)
      await route.fulfill({ json: { code: 'OK', data } })
    })
    await page.goto(`${base}/src/modules/project_management/metric-facts-browser.html?role=${role}`)
    const resources = page.locator('.pm-resource-facts')
    await resources.getByRole('heading', { name: '明确容量与实际用量', exact: true }).waitFor()
    if (role !== 'engineer') {
      await resources.getByLabel('实际资源').selectOption(role === 'device' ? 'device' : 'person')
      await resources.getByLabel('用途 / 事实 / 更正原因').fill('明确业务容量，合成组件回归')
      await resources.getByRole('button', { name: '查询组织依据', exact: true }).click()
      await resources.getByLabel('目录依据人员').selectOption('witness')
      await resources.getByLabel('容量业务归属组织').selectOption('org-1')
      await resources.getByRole('button', { name: '发布明确容量', exact: true }).click()
      await page.waitForFunction(() => document.querySelector('.pm-resource-facts [role="status"]')?.textContent.includes('已保存'))
      const capacity = commands.find((command) => command.path.endsWith('/capacities'))
      assert.equal(capacity.body.resource_type, role === 'device' ? 'EQUIPMENT' : 'PERSON')
      assert.equal(capacity.body.organization_id, 'org-1')
      assert.equal(capacity.body.intervals.length, 2)
      if (role === 'device') assert.equal(await resources.getByLabel('资源类型').locator('option[value="PERSON"]').count(), 0)
      else {
        await resources.getByPlaceholder('确认、退回或取消说明').fill('异人核对原始记录')
        await resources.getByRole('button', { name: '独立确认', exact: true }).click()
        await page.waitForTimeout(50)
        assert.equal(commands.find((command) => command.path.endsWith('/U-pending/decision')).body.decision, 'CONFIRMED')
        const reviews = page.locator('.pm-metric-review')
        await reviews.getByRole('button', { name: '独立审核通过', exact: true }).waitFor()
        await reviews.getByRole('button', { name: '下一页', exact: true }).click()
        await reviews.getByRole('button', { name: '独立审核通过', exact: true }).click()
        await page.waitForTimeout(50)
        assert.equal(commands.find((command) => command.path.endsWith('/report-reviews/decision')).body.round_id, 'main-pending')
      }
    } else {
      await resources.getByLabel('实际用量服务项（授权进行中及历史项）').selectOption('SI-done')
      await resources.getByLabel('实际资源').selectOption('person')
      await resources.getByLabel('北京业务日').fill('2026-11-01')
      await resources.getByLabel('开始时刻').fill('09:00')
      await resources.getByLabel('结束时刻').fill('10:00')
      await resources.getByLabel('用途 / 事实 / 更正原因').fill('本人历史实际投入')
      await resources.getByLabel('实际工作 / 运行证据').fill('当日原始工作记录')
      await resources.getByRole('button', { name: '保存实际用量草稿', exact: true }).click()
      await page.waitForTimeout(50)
      assert.equal(commands.find((command) => command.path.endsWith('/usages')).body.service_item_id, 'SI-done')
    }
    assert.deepEqual(errors, [])
    await page.screenshot({ path: `${output}task-1-fix-1-${role}.png`, fullPage: true })
    results.push({ role, status: 'PASS', scope: '真实Vue组件、合成会话、全部HTTP本地拦截；非SSO/业务验收', commands: commands.length })
    await page.close()
  }
  await writeFile(`${output}task-1-fix-1-browser.json`, JSON.stringify(results, null, 2))
  console.log(JSON.stringify(results))
} finally { await browser.close() }
