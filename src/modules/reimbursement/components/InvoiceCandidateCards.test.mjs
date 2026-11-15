import test from 'node:test'
import assert from 'node:assert/strict'
import * as Vue from 'vue'
import { renderToString } from '@vue/server-renderer'
import { loadInvoiceCandidateCards } from './InvoiceCandidateCards.test-support.mjs'

const candidate = {
  invoice_number: '12345678901234567890', invoice_date: '2026-11-10',
  invoice_type: '电子发票（普通发票）', seller_name: '销售方测试企业',
  seller_tax_id: '91330100BBBBBB0002', issuer: '测试开票人',
  amount_minor: '8850', tax_minor: '1150', gross_minor: '10000',
  group_kind: 'SINGLE_CANDIDATE', issues: ['MANUAL_CONFIRMATION_REQUIRED'],
  detail_lines: [{ name: '*汽油*95号车用汽油(VIB)', unit: '升', quantity: '10.97',
    unit_price: '8.0674567', amount_minor: '8850', tax_rate: '13%', tax_minor: '1150' }],
}

// 用途：用真实卡片组件渲染合成票面，观察用户实际可见的字段。
// 参数：candidates 为候选数组，extra 为权限和忙碌状态。
// 返回值：真实模板产生的 HTML，不表示业务后端或浏览器验收。
function renderCards(candidates, extra = {}) {
  return renderToString(Vue.createSSRApp(loadInvoiceCandidateCards(), { candidates, ...extra }))
}

test('候选以项目名称为标题，显示四个胶囊和全部票面明细', async () => {
  const html = await renderCards([candidate], { canReview: true })
  assert.match(html, /<h3[^>]*>\*汽油\*95号车用汽油\(VIB\)<\/h3>/)
  assert.equal((html.match(/class="expense-invoice-tag(?:\s|"|--)/g) || []).length, 4)
  for (const value of ['发票号', '12345678901234567890', '开票日期', '2026-11-10',
    '类型', '电子发票（普通发票）', '总计金额', '100.00 元', '销售方测试企业',
    '91330100BBBBBB0002', '测试开票人', '升', '10.97', '8.0674567', '88.50 元',
    '13%', '11.50 元', '合计（不含税）', '税额合计', '价税合计']) {
    assert.ok(html.includes(value), `遗漏可见字段：${value}`)
  }
  assert.match(html, /辅助填写人工复核/)
  assert.match(html, /需人工确认/)
  assert.doesNotMatch(html, /MANUAL_CONFIRMATION_REQUIRED/)
})

test('多项目保持同一发票卡片并展示所有行，多候选分别显示', async () => {
  const multi = { ...candidate, detail_lines: [...candidate.detail_lines,
    { name: '第二项目', unit: '次', quantity: '2', amount_minor: '5000', tax_minor: '0' }] }
  const html = await renderCards([multi, { ...candidate, invoice_number: '87654321' }])
  assert.equal((html.match(/<article/g) || []).length, 2)
  assert.match(html, /等 2 项/)
  assert.match(html, /第二项目/)
  assert.match(html, /87654321/)
  assert.match(html, /0.00 元/)
})

test('缺金额保持缺失，负数和零值按实际展示，诊断与票面内容安全渲染', async () => {
  const html = await renderCards([{ detail_lines: [{ name: '<img src=x onerror=alert(1)>' }],
    gross_minor: '', tax_minor: '0', amount_minor: '-8850',
    group_kind: 'AMBIGUOUS_MERGE_OR_CONTINUATION',
    issues: ['FIELD_MISSING:gross_minor', 'UNKNOWN_PRIVATE_CODE'] }], {
    groupLabels: { AMBIGUOUS_MERGE_OR_CONTINUATION: '合并或接续关系不确定，需人工判断' },
  })
  assert.match(html, /缺失，需人工填写/)
  assert.match(html, /-88.50 元/)
  assert.match(html, /合并或接续关系不确定/)
  assert.match(html, /缺少字段：价税合计/)
  assert.match(html, /&lt;img/)
  assert.doesNotMatch(html, /<img|UNKNOWN_PRIVATE_CODE|辅助填写人工复核/)
  const negative = await renderCards([{ ...candidate, gross_minor: '-10000' }])
  assert.match(negative, /-100.00 元/)
})

test('空候选有明确人工提示，权限和忙碌状态控制复核按钮', async () => {
  assert.match(await renderCards([]), /暂无可用识别候选/)
  assert.doesNotMatch(await renderCards([candidate]), /辅助填写人工复核/)
  const html = await renderCards([candidate], { canReview: true, disabled: true })
  assert.match(html, /<button[^>]*disabled[^>]*>辅助填写人工复核<\/button>/)
})

test('开票人存在冲突时明确显示字段名称', async () => {
  const html = await renderCards([{ ...candidate, issuer: '', issues: ['FIELD_CONFLICT:issuer'] }])
  assert.match(html, /字段存在冲突：开票人/)
})
