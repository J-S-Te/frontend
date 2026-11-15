import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parse, compileScript } from '@vue/compiler-sfc'
import * as Vue from 'vue'
import { renderToString } from '@vue/server-renderer'
import * as client from '../api/client.js'
import * as classification from '../invoiceClassification.js'
import * as fields from '../claimFields.js'
import * as recovery from '../recovery.js'
import * as cities from '../cities.js'

await cities.ensureCityCatalog()
import * as optionPicker from '../optionPicker.js'
import { formatBusinessDateTime } from '../../shared/utils/businessTime.js'
import { PaginationBarStub } from '../../../test/helpers/paginationStub.mjs'
import { createErrorStateStub } from '../../../test/helpers/errorStateStub.mjs'
import { claimStatusLabel, failureMessage } from '../statusLabels.js'

// 用途：编译真实面板和子组件，仅替换网络读取边界。
// 参数：name为组件名，request为网络替身，inline为是否包含真实模板。
// 返回值：保留真实业务函数和选择器接线的Vue组件。
function component(name, request, inline = false) {
  const { descriptor } = parse(readFileSync(new URL(name, import.meta.url), 'utf8'))
  const compiled = compileScript(descriptor, { id: String(name), inlineTemplate: inline })
  const bindings = { ...client, ...classification, ...fields, ...recovery, ...cities, ...optionPicker,
    formatBusinessDateTime, claimStatusLabel, failureMessage, reimbursementAPI: { request } }
  const body = compiled.content.replace(
    /import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"];?/g,
    (_, names, source) => {
      for (const entry of names.split(',')) {
        const [key, alias = key] = entry.trim().split(/\s+as\s+/)
        bindings[alias] = source === 'vue' ? Vue[key] : bindings[key]
      }
      return ''
    },
  ).replace(/^import\s+(\w+)\s+from\s+['"]([^'"]+)['"];?\s*$/gm, (_, key, source) => {
    bindings[key] = key === 'ErrorState' ? createErrorStateStub().Stub
      : key === 'PaginationBar' ? PaginationBarStub
        : component(new URL(source, new URL(name, import.meta.url)), request, true)
    return ''
  })
  return new Function(...Object.keys(bindings), body.replace('export default', 'return'))(
    ...Object.values(bindings),
  )
}

// 用途：挂载真实面板setup，读取选择事件处理函数和发送的业务命令。
// 参数：name为组件名，props为当前业务对象，request为网络替身。
// 返回值：真实响应式状态、父层事件及卸载方法，不冒充浏览器验收。
async function mount(name, props, request) {
  const panel = component(name, request)
  let state
  const setup = panel.setup
  panel.setup = (properties, context) => { state = setup(properties, context); return () => null }
  const renderer = Vue.createRenderer({ createComment: () => ({}), insert() {}, remove() {},
    parentNode: () => null, nextSibling: () => null, createElement: () => ({}),
    createText: () => ({}), setText() {}, setElementText() {}, patchProp() {} })
  const events = []
  const app = renderer.createApp(panel, { ...props, onChanged: () => events.push('changed') })
  app.mount({})
  await new Promise((resolve) => setImmediate(resolve))
  return { state, events, unmount: () => app.unmount() }
}

test('原件选择实际回读权威文档，候选自动绑定运行及索引，不解析则明确人工关联', async () => {
  const calls = []
  const doc = { id: 'doc', file_id: 'file', status: 'PARSED', parse_run_id: 'run',
    detail: { purpose: 'reimbursement.invoice.original', parse_result: {
      documents: [{ invoice_number: '业务票号', invoice_type: '电子发票' }],
    } } }
  const fixture = await mount('InvoiceControlsPanel.vue', {
    invoice: { id: 'invoice', version: 4, owner_subject_id: 'actor', total_minor: '100' },
    session: { subject_id: 'actor', permissions: [] },
  }, async (path, options) => {
    if (options) { calls.push([path, JSON.parse(options.body)]); return { id: 'command' } }
    return path === '/invoice-documents/doc' ? doc : { corrections: [], impacts: [] }
  })
  try {
    fixture.state.reason.value = '原件核对补充'
    await fixture.state.selectOriginal({ id: 'doc', file_id: 'file', name: '发票.pdf' })
    fixture.state.candidateIndex.value = '0'
    await fixture.state.appendSources()
    assert.deepEqual(calls[0][1].file_ids, ['file'])
    assert.deepEqual(calls[0][1].source_selections, [{
      file_id: 'file', document_id: 'doc', run_id: 'run', candidate_index: 0,
    }])
    fixture.state.candidateIndex.value = ''
    await fixture.state.appendSources()
    assert.deepEqual(calls[1][1].source_selections, [])
    fixture.state.addRiskEvidence({ id: 'evidence-doc', file_id: 'risk-file', name: '红字原件.pdf' })
    await fixture.state.reportRisk()
    assert.deepEqual(calls[2][1].evidence_file_ids, ['risk-file'])
  } finally { fixture.unmount() }
})

test('原件读取失败不得追加来源，页面无可手填原件文档运行候选或风险文件ID输入', async () => {
  let mutations = 0
  const props = { invoice: { id: 'invoice', version: 1, owner_subject_id: 'actor', total_minor: '100' },
    session: { subject_id: 'actor', permissions: [] } }
  const request = async (path, options) => {
    if (options) { mutations++; return { id: 'command' } }
    if (path.startsWith('/invoice-documents/')) throw new Error('unavailable')
    return { corrections: [], impacts: [], items: [] }
  }
  const fixture = await mount('InvoiceControlsPanel.vue', props, request)
  try {
    fixture.state.reason.value = '核对'
    await fixture.state.selectOriginal({ id: 'missing', file_id: 'file', name: '原件.pdf' })
    await fixture.state.appendSources()
    assert.equal(mutations, 0)
    assert.match(fixture.state.error.value, /原件/)
    const html = await renderToString(Vue.createSSRApp(component('InvoiceControlsPanel.vue', request, true), props))
    assert.doesNotMatch(html, /真实解析运行ID|文档ID（|候选序号（从0|原票ID|风险证据文件ID/)
    assert.match(html, /选择已就绪原件|风险证据原件/)
  } finally { fixture.unmount() }
})

test('恢复任务选择以业务单号展示，目标人员限定当前恢复任务', async () => {
  const request = async () => ({ items: [], total: 0 })
  const fixture = await mount('RecoveryPanel.vue', { permissions: ['expense.approval.recover'] }, request)
  try {
    fixture.state.choose({ id: 'private-task', claim_no: 'BX-2026-11', version: 1 })
    assert.match(fixture.state.recoveryLabel(fixture.state.selected.value), /BX-2026-11/)
    assert.doesNotMatch(fixture.state.recoveryLabel(fixture.state.selected.value), /private-task/)
    assert.deepEqual(fixture.state.targetParams.value, { purpose: 'recovery', resource_id: 'private-task' })
  } finally { fixture.unmount() }
})

test('付款异常只选择来源账户和档案引用，不套用批准事实，冲正自动绑定真实付款', async () => {
  const form = { amount: '12.34', method: 'BANK', voucher_file_ids: '' }
  const reviewForm = { decision: 'RESOLVE_WITH_REVERSAL', linked_payment_id: '',
    linked_reversal_id: '', evidence_file_ids: '' }
  const calls = []
  const fixture = await mount('PaymentExceptionPanel.vue', {
    claim: { id: 'claim' }, selected: { id: 'exception', allowed_actions: ['REVIEW_EXCEPTION'] },
    form, reviewForm, canRecord: true, canReview: true,
  }, async (path) => {
    calls.push(path)
    return path.endsWith('/payment-options')
      ? { source_accounts: [{ id: 'source', account_ref: 'account', name: '结算户' }],
        payee_profiles: [{ id: 'payee', account_ref: 'destination', name: '张三收款档案', version: 2 }] }
      : { payments: [{ id: 'payment', name: '银行付款', can_resolve_payment: true }],
        reversals: [{ id: 'actual-reversal', payment_id: 'payment', name: '批准全额冲正' }] }
  })
  try {
    assert.ok(calls.includes('/claims/claim/payment-options'))
    assert.ok(calls.includes('/payment-exceptions/exception/resolution-options'))
    fixture.state.chooseReversal(fixture.state.resolutionOptions.value.reversals[0])
    assert.equal(reviewForm.linked_payment_id, 'payment')
    assert.equal(reviewForm.linked_reversal_id, 'actual-reversal')
    fixture.state.addEvidence({ file_id: 'file', name: '付款回单.pdf' }, 'voucher_file_ids')
    assert.equal(form.voucher_file_ids, 'file')
    assert.equal(form.amount, '12.34')
    assert.equal(form.method, 'BANK')
  } finally { fixture.unmount() }
})

test('原件切换后旧文档迟到不能覆盖当前文件或解析来源', async () => {
  let resolveOld
  const fixture = await mount('InvoiceControlsPanel.vue', {
    invoice: { id: 'invoice', version: 1, owner_subject_id: 'actor', total_minor: '100' },
    session: { subject_id: 'actor', permissions: [] },
  }, async (path) => {
    if (path === '/invoice-documents/old') return new Promise((resolve) => { resolveOld = resolve })
    if (path === '/invoice-documents/new') return { id: 'new', file_id: 'new-file', status: 'READY',
      detail: { purpose: 'reimbursement.invoice.original' } }
    return { corrections: [], impacts: [] }
  })
  try {
    const old = fixture.state.selectOriginal({ id: 'old', file_id: 'old-file', name: '旧原件.pdf' })
    await fixture.state.selectOriginal({ id: 'new', file_id: 'new-file', name: '新原件.pdf' })
    resolveOld({ id: 'old', file_id: 'old-file', status: 'READY',
      detail: { purpose: 'reimbursement.invoice.original' } })
    await old
    assert.equal(fixture.state.documentID.value, 'new')
    assert.equal(fixture.state.sourceDocument.value.file_id, 'new-file')
    assert.equal(fixture.state.sourceDocumentName.value, '新原件.pdf')
  } finally { fixture.unmount() }
})

test('付款选项失败保留独立事实高级入口，异常解除仍只用真实账本选项', async () => {
  const props = { claim: { id: 'claim' }, form: { amount: '12.34', voucher_file_ids: '' },
    reviewForm: { decision: 'RESOLVE_WITH_REVERSAL', evidence_file_ids: '' },
    canRecord: true, canReview: true,
    selected: { id: 'exception', amount_minor: '1234', currency: 'CNY', allowed_actions: ['REVIEW_EXCEPTION'] } }
  const request = async () => { throw new Error('private error') }
  const fixture = await mount('PaymentExceptionPanel.vue', props, request)
  try {
    assert.match(fixture.state.paymentError.value, /读取失败/)
    assert.match(fixture.state.resolutionError.value, /读取失败/)
    assert.deepEqual(fixture.state.paymentOptions.value.source_accounts, [])
    assert.deepEqual(fixture.state.resolutionOptions.value.reversals, [])
    assert.equal(props.form.amount, '12.34')
    const html = await renderToString(Vue.createSSRApp(component('PaymentExceptionPanel.vue', request, true), props))
    assert.doesNotMatch(html, /凭证ID（|已有合法付款ID|全额冲正ID|实际付款账户引用/)
    assert.match(html, /高级：外部实际账户不在受控目录时手工填写/)
    assert.match(html, /只有确知外部真实账户引用时才手工填写/)
    const reviewSection = html.slice(html.indexOf('追加独立核实记录') > 0
      ? html.lastIndexOf('<fieldset') : html.length)
    assert.doesNotMatch(reviewSection, /外部收款档案引用|外部付款账户引用/)
    const template = readFileSync(new URL('./PaymentExceptionPanel.vue', import.meta.url), 'utf8')
    assert.doesNotMatch(template, /<input[^>]*v-model="reviewForm\.linked_(?:payment|reversal)_id"/)
    assert.match(template, /:options="availablePayments"/)
    assert.match(template, /:options="resolutionOptions\.reversals"/)
    assert.match(html, /实际付款账户|已有批准全额冲正|上传核实证据/)
  } finally { fixture.unmount() }
})
