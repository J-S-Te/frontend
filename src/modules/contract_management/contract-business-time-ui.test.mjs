import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const viewSource = await readFile(new URL('./views/ContractManagementView.vue', import.meta.url), 'utf8')
const outboxSource = await readFile(new URL('./components/ContractIntegrationOutboxPanel.vue', import.meta.url), 'utf8')
const rulePanelSource = await readFile(new URL('./components/ContractNumberRulePanel.vue', import.meta.url), 'utf8')
const ruleUtilSource = await readFile(new URL('./utils/contractNumberRule.js', import.meta.url), 'utf8')
const resultBannerSource = await readFile(new URL('../shared/components/OperationResultBanner.vue', import.meta.url), 'utf8')
const inboxPanelSource = await readFile(new URL('../shared/components/OperationInboxPanel.vue', import.meta.url), 'utf8')

test('合同台账的日期与日期时间统一按北京业务时间展示', () => {
  assert.match(viewSource, /const formatDate = formatContractDate/)
  assert.match(viewSource, /const formatDateTime = formatContractDateTime/)
  // 不再用运行环境时区自行格式化，否则凌晨记录会显示成前一天。
  assert.doesNotMatch(viewSource, /new Intl\.DateTimeFormat\('zh-CN'/)
  assert.doesNotMatch(viewSource, /setHours\(0, 0, 0, 0\)/)
  // 纯日期字段回填不得再按字符串截断，交给 formatBusinessDate 处理日历日/时间戳两种输入。
  assert.match(viewSource, /mailed_at: formatBusinessDate\(selected\.mailed_at\)/)
  assert.match(viewSource, /signed_at: formatBusinessDate\(selected\.signed_at\)/)
  assert.doesNotMatch(viewSource, /String\(selected\.(mailed_at|signed_at)\)\.slice\(0, 10\)/)
})

test('本月盖章数按北京自然月区间统计', () => {
  assert.match(viewSource, /import \{\s*ACTIVE_CONTRACT_STATUSES,/)
  assert.match(viewSource, /isInBusinessMonth,/)
  assert.match(viewSource, /\} from '@\/modules\/contract_management\/utils\/contractBusinessTime\.js'/)
  assert.match(viewSource, /monthly: signingRecords\.value\.filter\(\(item\) => isInBusinessMonth\(item\.confirmed_at\)\)\.length/)
  // 旧实现用浏览器本地年月比较，已移除。
  assert.doesNotMatch(viewSource, /confirmed\.getMonth\(\) === now\.getMonth\(\)/)
})

test('合同与签署台账的过期判定统一按北京日历日（到期当天仍有效）', () => {
  assert.match(viewSource, /expired: isContractExpired\(item\)/)
  assert.match(viewSource, /displayStatus: isContractExpired\(item\) \? '已过期'/)
  // 签署台账与合同台账、后端筛选同口径：北京日历日比较，不再用绝对时刻。
  assert.match(viewSource, /return isPastBusinessDay\(record\.contract\.endAt\)/)
  assert.doesNotMatch(viewSource, /end\.getTime\(\) < Date\.now\(\)/)
})

test('集成死信面板与编号规则面板的时间改用北京业务时间', () => {
  for (const source of [outboxSource, rulePanelSource]) {
    assert.match(source, /formatBusinessDateTime/)
    assert.doesNotMatch(source, /new Intl\.DateTimeFormat\('zh-CN'/)
  }
  assert.match(outboxSource, /from '@\/modules\/shared\/utils\/businessTime\.js'/)
  assert.match(outboxSource, /return formatBusinessDateTime\(value, \{ seconds: true \}\) \|\| String\(value\)/)
  assert.match(rulePanelSource, /return formatBusinessDateTime\(value\)/)
})

test('编号年份段预览按北京年份取值，正式编号仍由后端决定', () => {
  assert.match(rulePanelSource, /const currentYear = Number\(todayBusinessDate\(\)\.slice\(0, 4\)\) \|\| new Date\(\)\.getFullYear\(\)/)
  assert.match(rulePanelSource, /buildContractNumberPreview\(form\.value, \{ year: currentYear, sequence: nextSequence\.value \}\)/)
  assert.match(ruleUtilSource, /from '\.\.\/\.\.\/shared\/utils\/businessTime\.js'/)
  assert.match(ruleUtilSource, /const year = Number\(todayBusinessDate\(\)\.slice\(0, 4\)\)/)
  // 预览不得改写正式编号来源：仍明确标注后端权威。
  assert.match(rulePanelSource, /正式编号只由后端在审批通过时生成/)
})

test('本机操作记录时间保留浏览器本地展示，并注明不是业务时刻', () => {
  for (const source of [resultBannerSource, inboxPanelSource]) {
    assert.match(source, /toLocaleString\('zh-CN', \{ hour12: false \}\)/)
    assert.match(source, /不是业务时刻|不是后端下发的业务时刻/)
    assert.doesNotMatch(source, /formatBusinessDateTime/)
  }
})

test('北京凌晨窗口下合同日期展示不偏移到前一天', async () => {
  const util = await import('./utils/contractBusinessTime.js')
  // UTC 2025-12-31 16:30 = 北京 2026-01-01 00:30：展示必须是北京次日。
  assert.equal(util.formatContractDate('2025-12-31T16:30:00Z'), '2026-01-01')
  assert.equal(util.formatContractDateTime('2025-12-31T16:30:00Z'), '2026-01-01 00:30:00')
  // 纯日期字段（start_date/end_date/mailed_at/signed_at）不平移。
  assert.equal(util.formatContractDate('2026-01-01'), '2026-01-01')
  assert.equal(util.formatContractDateTime('2026-01-01'), '2026-01-01 00:00:00')
  // 空值与非法值不抛异常。
  assert.equal(util.formatContractDate(''), '—')
  assert.equal(util.formatContractDate(null), '—')
  assert.equal(util.formatContractDateTime(undefined), '—')
})
