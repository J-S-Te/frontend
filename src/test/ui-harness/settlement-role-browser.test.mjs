import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// 本用例只做静态夹具校验：真实浏览器联测是 opt-in 的（Settlement 侧
// TestMySQLRoleBrowserWorkflows 要求 SETTLEMENT_ROLE_BROWSER=1 且提供隔离 MySQL 与 Chrome），
// 不能在本机默认跑；这里锁定"夹具不放宽断言语义"与 SET-04 的金额边界。
const SOURCE = readFileSync(new URL('./settlement-role-browser.mjs', import.meta.url), 'utf8')

// SET-04 计划覆盖守卫的夹具事实：隔离种子合同合同金额 100.00（Settlement/internal/httpapi/role_sql_mysql_test.go），
// 差额阈值默认 5%、单期降幅阈值默认 50%（SETTLEMENT_PLAN_COVERAGE_*_PERCENT 未设置时）。
const SEEDED_CONTRACT_AMOUNT = 100
const GAP_THRESHOLD_PERCENT = 5

// 用途：提取计划相关用例（受控调整 / 新建计划）中填写的计划金额。
// 参数：无；读取夹具源码。登记差异等用例的"金额"字段与计划无关，必须排除。
// 返回值：数字数组；用于确认销售账号（无 settlement.finance.override）只做阈值内改动。
function planAmounts() {
  const blocks = ['sales-adjust-repeat', 'history-contract-candidate'].map((id) => {
    const start = SOURCE.indexOf(`check('${id}'`)
    assert.ok(start >= 0, `缺少用例 ${id}`)
    const next = SOURCE.indexOf('await check(', start + 1)
    return SOURCE.slice(start, next > start ? next : SOURCE.length)
  })
  return blocks.flatMap((block) => [...block.matchAll(/getByLabel\('金额', \{ exact: true \}\)\.fill\('([^']+)'\)/g)]
    .map((match) => Number(match[1])))
}

test('浏览器 E2E 夹具仍是 opt-in：需要隔离夹具会话与回环地址', () => {
  assert.match(SOURCE, /SETTLEMENT_ROLE_BROWSER_FIXTURE/)
  assert.match(SOURCE, /assert\.equal\(new URL\(fixture\.origin\)\.hostname, '127\.0\.0\.1'\)/)
  assert.match(SOURCE, /assert\.equal\(new URL\(fixture\.origin\)\.port, '18173'\)/)
  assert.match(SOURCE, /SETTLEMENT_ROLE_BROWSER_CASES/)
  assert.match(SOURCE, /executablePath: '\/Applications\/Google Chrome\.app\/Contents\/MacOS\/Google Chrome'/)
})

test('SET-04 后销售侧计划改动落在差额阈值内，且断言语义未被放宽', () => {
  const amounts = planAmounts()
  assert.equal(amounts.length, 2, `应覆盖受控调整与新建计划两处金额，实际 ${amounts.length} 处`)
  for (const amount of amounts) {
    assert.ok(Number.isFinite(amount) && amount > 0, `非法的计划金额夹具：${amount}`)
    const gapPercent = (Math.abs(SEEDED_CONTRACT_AMOUNT - amount) / SEEDED_CONTRACT_AMOUNT) * 100
    assert.ok(
      gapPercent <= GAP_THRESHOLD_PERCENT,
      `计划金额 ${amount} 的合同差额 ${gapPercent}% 超过阈值 ${GAP_THRESHOLD_PERCENT}%；销售账号没有 override 权限，会被 409 拒绝`,
    )
    // 计划合计仍不得超过合同金额（服务端上限不因权限放松）。
    assert.ok(amount <= SEEDED_CONTRACT_AMOUNT, `计划金额 ${amount} 超过合同金额 ${SEEDED_CONTRACT_AMOUNT}`)
  }
  // 断言语义不变：仍以真实写响应 + 服务端回读金额相等为准，而不是只信页面提示。
  assert.match(SOURCE, /assert\.equal\(Number\(first\.planned_amount\), \d+\)/)
  assert.match(SOURCE, /assert\.equal\(Number\(stored\.planned_amount\), \d+\)/)
  assert.match(SOURCE, /assert\.ok\(second\.version > first\.version, '第二次调整必须使用刷新后的当前版本'\)/)
  assert.match(SOURCE, /await page\.waitForFunction\(\(\) => \{\s*const amount = document\.querySelector\('\.settlement-receivables \.settlement-money'\)/)
  // 已修正的历史金额（80 / 10）不得回流：它们会让销售侧调整或新建直接被 SET-04 守卫拒绝。
  assert.doesNotMatch(SOURCE, /fill\('80'\)/)
  assert.doesNotMatch(SOURCE, /=== 80/)
  assert.doesNotMatch(SOURCE, /fill\('10'\)/)
})

test('浏览器 E2E 夹具保留受 SET-04 影响的两条用例与真实 HTTP 断言助手', () => {
  for (const id of ['sales-adjust-repeat', 'history-contract-candidate', 'refund-complete-multi-role']) {
    assert.ok(SOURCE.includes(`check('${id}'`), `缺少用例 ${id}`)
  }
  // submit 必须等待真实写响应并断言 response.ok()，不能退化成"点了就算成功"。
  assert.match(SOURCE, /page\.waitForResponse\(/)
  assert.match(SOURCE, /assert\.ok\(response\.ok\(\), `\$\{name\}: HTTP \$\{response\.status\(\)\}/)
  // readResource 直接用当前会话回读服务端持久化事实。
  assert.match(SOURCE, /page\.request\.get\(`\$\{fixture\.origin\}\/settlement\/api\/v1\$\{path\}`\)/)
  assert.match(SOURCE, /禁止零用例通过/)
})
