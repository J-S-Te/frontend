import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CONTRACT_NUMBER_AFFIX_HINT,
  CONTRACT_NUMBER_RULE_LIMITS,
  CONTRACT_NUMBER_YEAR_SEGMENTS,
  buildContractNumberPreview,
  buildContractNumberSample,
  contractNumberAffixError,
  contractNumberRuleAffixErrors,
  contractNumberRuleFormError,
  contractNumberRulePayload,
  contractNumberRuleUsageLabel,
  contractNumberYearSegmentText,
  isContractNumberAffixValid,
  nextContractNumberSequence,
  normalizeContractNumberRule,
  normalizeContractNumberSequenceWidth,
  normalizeContractNumberYearSegment,
} from './contractNumberRule.js'
import { formatBusinessDate } from '../../shared/utils/businessTime.js'

// 预览默认年度已改为北京年份：断言必须用同一口径派生，否则在非东八区宿主上跨年窗口会误判。
const currentYear = Number(formatBusinessDate(new Date()).slice(0, 4))
const currentYearTwoDigits = String(currentYear % 100).padStart(2, '0')
const rule = (overrides = {}) => ({ prefix: 'GTSR-', year_segment: 'YY', seq_width: 4, suffix: '', ...overrides })

test('年份段三种取值分别渲染为空、两位年份与四位年份', () => {
  assert.equal(contractNumberYearSegmentText('NONE', 2026), '')
  assert.equal(contractNumberYearSegmentText('YY', 2026), '26')
  assert.equal(contractNumberYearSegmentText('YYYY', 2026), '2026')
  // 两百年前后仍要补齐两位数，不能出现 5 这样的单位数年份。
  assert.equal(contractNumberYearSegmentText('YY', 2005), '05')
  assert.equal(contractNumberYearSegmentText('YYYY', 2005), '2005')
  // 未知取值按两位年份处理，不抛错也不返回 undefined。
  assert.equal(contractNumberYearSegmentText('WEEK', 2026), '26')
  assert.equal(normalizeContractNumberYearSegment('YYYY'), 'YYYY')
  assert.equal(normalizeContractNumberYearSegment(undefined), 'YY')
})

test('编号预览按前缀 + 年份段 + 补零流水 + 后缀拼接', () => {
  assert.equal(buildContractNumberSample(rule({ year_segment: 'YY' }), { year: 2026, sequence: 1 }), 'GTSR-260001')
  assert.equal(buildContractNumberSample(rule({ year_segment: 'YYYY' }), { year: 2026, sequence: 1 }), 'GTSR-20260001')
  assert.equal(buildContractNumberSample(rule({ year_segment: 'NONE' }), { year: 2026, sequence: 1 }), 'GTSR-0001')
  assert.equal(buildContractNumberSample(rule({ suffix: '-A' }), { year: 2026, sequence: 12 }), 'GTSR-260012-A')
  // 默认流水从 1 开始，缺省年度使用本机当前年份。
  assert.equal(buildContractNumberSample(rule()), `GTSR-${currentYearTwoDigits}0001`)
})

test('流水按位宽左补零，位宽 1 与 9 都能正确渲染', () => {
  assert.equal(buildContractNumberSample(rule({ year_segment: 'NONE', seq_width: 1 }), { year: 2026, sequence: 1 }), 'GTSR-1')
  assert.equal(buildContractNumberSample(rule({ year_segment: 'NONE', seq_width: 6 }), { year: 2026, sequence: 42 }), 'GTSR-000042')
  assert.equal(buildContractNumberSample(rule({ year_segment: 'NONE', seq_width: 9 }), { year: 2026, sequence: 42 }), 'GTSR-000000042')
  const preview = buildContractNumberPreview(rule({ year_segment: 'NONE', seq_width: 4 }), { year: 2026, sequence: 42 })
  assert.equal(preview.sequence_text, '0042')
  assert.equal(preview.overflow, false)
})

test('前缀与后缀为空时只输出年份段和流水，且不出现 undefined 或 NaN', () => {
  assert.equal(buildContractNumberSample({ prefix: '', year_segment: 'NONE', seq_width: 4, suffix: '' }), '0001')
  assert.equal(buildContractNumberSample({ prefix: '', year_segment: 'YY', seq_width: 4, suffix: '' }, { year: 2026 }), '260001')
  for (const input of [{}, undefined, null, { prefix: undefined, suffix: null, seq_width: 'x' }, { prefix: '  ', suffix: '  ', seq_width: NaN }]) {
    const sample = buildContractNumberSample(input, { year: 2026 })
    assert.equal(typeof sample, 'string')
    assert.doesNotMatch(sample, /undefined|NaN|null/)
  }
})

test('前后空格不会进入编号，规则规范化结果可重复', () => {
  assert.equal(buildContractNumberSample({ prefix: ' GTSR- ', year_segment: 'NONE', seq_width: 4, suffix: ' -A ' }, { year: 2026 }), 'GTSR-0001-A')
  assert.deepEqual(normalizeContractNumberRule({ prefix: ' GTSR- ', year_segment: 'NONE', seq_width: '4', suffix: ' -A ' }), {
    prefix: 'GTSR-', year_segment: 'NONE', seq_width: 4, suffix: '-A',
  })
  assert.deepEqual(normalizeContractNumberRule(normalizeContractNumberRule({ prefix: 'A', year_segment: 'YYYY', seq_width: 9, suffix: 'B' })), {
    prefix: 'A', year_segment: 'YYYY', seq_width: 9, suffix: 'B',
  })
})

test('流水与位宽的非法输入收敛到安全默认值，不产生 NaN', () => {
  for (const width of [0, -3, 12, 100, 'abc', null, undefined, NaN]) {
    const normalized = normalizeContractNumberSequenceWidth(width)
    assert.ok(Number.isInteger(normalized))
    assert.ok(normalized >= CONTRACT_NUMBER_RULE_LIMITS.seq_width_min)
    assert.ok(normalized <= CONTRACT_NUMBER_RULE_LIMITS.seq_width_max)
  }
  assert.equal(normalizeContractNumberSequenceWidth(0), 1)
  assert.equal(normalizeContractNumberSequenceWidth(12), 9)
  assert.equal(normalizeContractNumberSequenceWidth('abc'), 4)
  assert.equal(normalizeContractNumberSequenceWidth(4.7), 4)
  // 流水 0、负数、小数与非法值都回落到第 1 号。
  for (const sequence of [0, -1, 1.5, NaN, 'abc', null]) {
    assert.equal(buildContractNumberPreview(rule({ year_segment: 'NONE' }), { year: 2026, sequence }).sequence, 1)
  }
})

test('流水超出位宽时保持完整流水并标记 overflow，而不是截断出重复编号', () => {
  const preview = buildContractNumberPreview(rule({ year_segment: 'NONE', seq_width: 2 }), { year: 2026, sequence: 123 })
  assert.equal(preview.number, 'GTSR-123')
  assert.equal(preview.sequence_text, '123')
  assert.equal(preview.overflow, true)
  assert.equal(buildContractNumberPreview(rule({ year_segment: 'NONE', seq_width: 2 }), { year: 2026, sequence: 99 }).overflow, false)
})

test('编号总长度超过 64 个字符时给出 too_long 提示', () => {
  const longRule = { prefix: 'P'.repeat(CONTRACT_NUMBER_RULE_LIMITS.prefix), year_segment: 'YYYY', seq_width: 9, suffix: 'S'.repeat(CONTRACT_NUMBER_RULE_LIMITS.suffix) }
  const preview = buildContractNumberPreview(longRule, { year: 2026, sequence: 1 })
  assert.equal(preview.too_long, true)
  assert.equal(preview.number.length, CONTRACT_NUMBER_RULE_LIMITS.prefix + 4 + 9 + CONTRACT_NUMBER_RULE_LIMITS.suffix)
  assert.equal(buildContractNumberPreview(rule(), { year: 2026, sequence: 1 }).too_long, false)
})

test('年度非法时回落到北京当前年份', () => {
  for (const year of [undefined, null, 0, -1, 10000, 'abc']) {
    assert.equal(buildContractNumberSample(rule({ year_segment: 'YYYY' }), { year }), `GTSR-${currentYear}0001`)
  }
})

test('下一条流水按年度重置：同年取已用 + 1，跨年从 1 开始', () => {
  assert.equal(nextContractNumberSequence({ seq_year: 2026, current_value: 12 }, 2026), 13)
  assert.equal(nextContractNumberSequence({ seq_year: 2026, current_value: 0 }, 2026), 1)
  assert.equal(nextContractNumberSequence({ seq_year: 2025, current_value: 12 }, 2026), 1)
  assert.equal(nextContractNumberSequence(null, 2026), 1)
  assert.equal(nextContractNumberSequence({ seq_year: 2026, current_value: 'x' }, 2026), 1)
  assert.equal(nextContractNumberSequence({ seq_year: 2026, current_value: 12 }), currentYear === 2026 ? 13 : 1)
})

test('流水用量说明覆盖正常、未开始与缺字段三种情况', () => {
  assert.equal(contractNumberRuleUsageLabel({ seq_year: 2026, current_value: 12 }), '2026 年度全系统已使用 12 个流水')
  assert.equal(contractNumberRuleUsageLabel({ seq_year: 2026, current_value: 0 }), '2026 年度全系统已使用 0 个流水')
  assert.equal(contractNumberRuleUsageLabel(null), '本年度全系统已使用 0 个流水')
  assert.equal(contractNumberRuleUsageLabel({ seq_year: 'x', current_value: -3 }), '本年度全系统已使用 0 个流水')
})

test('保存载荷只包含约定的四个字段且已规范化', () => {
  const payload = contractNumberRulePayload({
    prefix: ' GTSR- ', year_segment: 'YYYY', seq_width: '5', suffix: ' -A ',
    sample: 'GTSR-202600001', seq_year: 2026, current_value: 7, updated_by: 'someone',
  })
  assert.deepEqual(payload, { prefix: 'GTSR-', year_segment: 'YYYY', seq_width: 5, suffix: '-A' })
  assert.deepEqual(Object.keys(payload).sort(), ['prefix', 'seq_width', 'suffix', 'year_segment'])
  assert.deepEqual(contractNumberRulePayload({}), { prefix: '', year_segment: 'YY', seq_width: 4, suffix: '' })
})

test('年份段选项覆盖契约枚举，顺序与提示保持稳定', () => {
  assert.deepEqual(CONTRACT_NUMBER_YEAR_SEGMENTS.map((item) => item.value), ['NONE', 'YY', 'YYYY'])
  for (const item of CONTRACT_NUMBER_YEAR_SEGMENTS) {
    assert.ok(item.label.length > 0)
    assert.ok(item.hint.length > 0)
  }
})

test('保存前的本地检查拦住空位宽、越界位宽与超长编号', () => {
  assert.equal(contractNumberRuleFormError(rule()), '')
  assert.equal(contractNumberRuleFormError({ prefix: 'GTSR-', year_segment: 'NONE', seq_width: 1, suffix: '' }), '')
  for (const seq_width of ['', null, undefined, 0, 10, 1.5, 'abc']) {
    assert.match(contractNumberRuleFormError({ ...rule(), seq_width }), /流水位数需要填写 1–9 之间的整数。/)
  }
  const longRule = { prefix: 'P'.repeat(32), year_segment: 'YYYY', seq_width: 9, suffix: 'S'.repeat(32) }
  assert.match(contractNumberRuleFormError(longRule), /编号总长度超过 64 个字符/)
})

test('前后缀只接受字母、数字和 - _ . /，与后端白名单一致', () => {
  // 合法：CRM 征信投递的白名单正则 ^[A-Za-z0-9._/-]+$ 覆盖的字符，空值按合法处理。
  for (const value of ['GTSR-', 'A1_b.c/d', '', '  ', '2026-A.01/B_2', null, undefined]) {
    assert.equal(isContractNumberAffixValid(value), true, String(value))
  }
  // 非法：中文、空格、括号、#、{} 以及白名单外的其他符号。
  for (const value of ['合同-', 'A B', 'A#B', 'A{B}', 'A(B)', 'A+B', 'A&B', 'A,B', 'A；B']) {
    assert.equal(isContractNumberAffixValid(value), false, String(value))
  }
})

test('非法前后缀给出字段不同、文案固定的中文提示，并在发请求前被本地拦下', () => {
  assert.equal(CONTRACT_NUMBER_AFFIX_HINT, '只能包含字母、数字和 - _ . /')
  // 合法字段不产生提示，提示文案里带上可读的允许字符集。
  assert.equal(contractNumberAffixError('prefix', 'GTSR-'), '')
  assert.equal(contractNumberAffixError('suffix', ''), '')
  assert.equal(contractNumberAffixError('prefix', '合同-'),
    '编号前缀只能包含字母、数字和 - _ . /，不能包含中文、空格、括号、#、{} 等字符。')
  assert.equal(contractNumberAffixError('suffix', 'A B'),
    '编号后缀只能包含字母、数字和 - _ . /，不能包含中文、空格、括号、#、{} 等字符。')
  // 两个字段同时非法时按前缀、后缀顺序列出，便于面板逐个高亮。
  assert.deepEqual(contractNumberRuleAffixErrors(rule({ prefix: 'A#B', suffix: 'A{B}' })), [
    { field: 'prefix', message: '编号前缀只能包含字母、数字和 - _ . /，不能包含中文、空格、括号、#、{} 等字符。' },
    { field: 'suffix', message: '编号后缀只能包含字母、数字和 - _ . /，不能包含中文、空格、括号、#、{} 等字符。' },
  ])
  assert.deepEqual(contractNumberRuleAffixErrors(rule()), [])
  // 表单级检查复用同一份文案：字符集非法时先报字符集，不再被位宽或长度提示盖住。
  assert.equal(contractNumberRuleFormError(rule({ prefix: '合同-' })),
    '编号前缀只能包含字母、数字和 - _ . /，不能包含中文、空格、括号、#、{} 等字符。')
  assert.equal(contractNumberRuleFormError({ prefix: '合同-', year_segment: 'YY', seq_width: '', suffix: 'A#B' }),
    '编号前缀只能包含字母、数字和 - _ . /，不能包含中文、空格、括号、#、{} 等字符。编号后缀只能包含字母、数字和 - _ . /，不能包含中文、空格、括号、#、{} 等字符。')
})
