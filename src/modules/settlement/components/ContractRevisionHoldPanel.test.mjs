import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
import * as Vue from 'vue'
import { renderToString } from '@vue/server-renderer'
import * as revisionHoldUtils from '../utils/revisionHold.js'

// 与 SettlementContractImportPanel.test.mjs 同风格：编译真实组件，只替换外部接口与生命周期，
// 再用编译后的真实模板做 SSR 渲染，断言用户可见文案与可访问性属性。
const FILE = new URL('./ContractRevisionHoldPanel.vue', import.meta.url).pathname
const SOURCE = readFileSync(FILE, 'utf8')
const { descriptor } = parse(SOURCE)
const compiledScript = compileScript(descriptor, { id: FILE })
const compiledTemplate = compileTemplate({
  source: descriptor.template.content,
  filename: FILE,
  id: FILE,
  compilerOptions: { bindingMetadata: compiledScript.bindings },
})
assert.deepEqual(compiledTemplate.errors, [])
const SCRIPT = compiledScript.content
  .replace(/^import\s[\s\S]*?from ['"][^'"]+['"]\n/gm, '')
  .replace('export default', 'return')
const RENDER = new Function(
  'Vue',
  compiledTemplate.code
    .replace(/import \{([^}]+)\} from "vue"/g, (_, names) => `const { ${names.replace(/ as /g, ': ')} } = Vue`)
    .replace('export function render', 'return function render'),
)(Vue)

// 弹窗替身：以 data-* 反映接线，焦点与键盘归属由 shared PromptDialog 自身用例覆盖。
const PromptDialogStub = {
  props: ['title', 'description', 'label', 'placeholder', 'confirmText', 'cancelText', 'minlength', 'maxlength', 'busy', 'error'],
  render() {
    return Vue.h('div', {
      'data-prompt': this.title,
      'data-minlength': String(this.minlength),
      'data-maxlength': String(this.maxlength),
      'data-busy': String(this.busy),
      'data-error': this.error,
      'data-confirm': this.confirmText,
      'data-description': this.description,
    }, [this.label, ' ', this.description])
  },
}

const READ = 'settlement.revision.read'
const RESOLVE = 'settlement.revision.resolve'
const ADJUST = 'settlement.receivable.adjust'
const fullPermissions = (...permissions) => (permission) => permissions.includes(permission)

const PENDING_ROW = {
  id: 'hold-1',
  source_contract_id: 'contract-9',
  source_contract_no: 'HT-2026-001',
  contract_snapshot_id: 'snapshot-2',
  revision_event_id: 'event-8',
  from_contract_version: 1,
  to_contract_version: 2,
  hold_reason: 'PLAN_DIFF_IMPLEMENTED_FACTS',
  status: 'PENDING_REVIEW',
  resolution_reason: '',
  resolved_by: '',
  created_at: '2026-05-01T03:04:05.000000Z',
  diff: {
    from_version: 1,
    to_version: 2,
    old_contract_amount: '1000.00',
    new_contract_amount: '1200.00',
    new_term_total: '1200.00',
    new_terms: [{ installment_no: 1 }, { installment_no: 2 }],
    diffs: [
      {
        installment_no: 1,
        kind: 'AMOUNT_CHANGED',
        old_due_date: '2026-01-01',
        new_due_date: '2026-01-01',
        old_amount: '500.00',
        new_amount: '600.00',
        implemented_facts: { received_allocated: '200.00', write_off: '0', invoiced: '0', reserved: '0' },
        references: 2,
      },
    ],
  },
}

/**
 * buildPanel 以真实 setup 装配组件，只注入接口与生命周期替身。
 * 参数：list/resolve 为业务接口替身，can 为能力判断，initialContractRef 为预填合同筛选。
 * 返回值：setup 状态、调用记录与已捕获的挂载钩子。
 */
function buildPanel({ list, resolve, can = fullPermissions(READ, RESOLVE, ADJUST), initialContractRef = '' } = {}) {
  const calls = { list: [], resolve: [] }
  const hooks = { mounted: [], unmounted: [] }
  const deps = {
    ref: Vue.ref,
    computed: Vue.computed,
    onMounted: (callback) => hooks.mounted.push(callback),
    onBeforeUnmount: (callback) => hooks.unmounted.push(callback),
    PromptDialog: PromptDialogStub,
    ConsoleIcon: { render: () => null },
    // 分页条是共享组件：harness 只注入外部依赖，这里给一个渲染为空的桩（契约由 shared/pagination-bar.test.mjs 覆盖）。
    PaginationBar: { props: ['label', 'prevText', 'nextText', 'page', 'count', 'pageSize', 'hasMore', 'loading', 'disabled'], render: () => null },
    listContractRevisionHolds: async (params) => {
      calls.list.push(params)
      return list ? list(params) : { items: [] }
    },
    resolveContractRevisionHold: async (id, reason) => {
      calls.resolve.push({ id, reason })
      return resolve ? resolve(id, reason) : { id, status: 'RESOLVED' }
    },
    ...revisionHoldUtils,
  }
  const panel = new Function(...Object.keys(deps), SCRIPT)(...Object.values(deps))
  const state = panel.setup({ can, initialContractRef }, { expose() {}, emit() {} })
  return { state, calls, hooks }
}

async function renderState(state) {
  return renderToString(Vue.createSSRApp({ setup: () => state, render: RENDER }))
}

test('修订工单面板：默认只查待复核第一页，筛选条件由本地校验后交给接口', async () => {
  const { state, calls, hooks } = buildPanel()
  hooks.mounted.forEach((hook) => hook())
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(calls.list, [
    { status: 'PENDING_REVIEW', contractRef: '', limit: 50, offset: 0 },
  ])
  assert.equal(state.filters.value.contractRef, '')
})

test('修订工单面板：合同筛选超长不发请求，查询与重置都回到第一页', async () => {
  const { state, calls } = buildPanel()
  await state.load()
  state.filters.value.contractRef = 'x'.repeat(129)
  await state.applyFilters()
  assert.equal(calls.list.length, 1, '本地校验失败时不得发出请求')
  assert.match(state.listError.value, /最多 128 字/)

  state.filters.value = { status: 'RESOLVED', contractRef: ' HT-2026-001 ' }
  state.pageIndex.value = 3
  await state.applyFilters()
  assert.deepEqual(calls.list.at(-1), { status: 'RESOLVED', contractRef: 'HT-2026-001', limit: 50, offset: 0 })
  assert.equal(state.pageIndex.value, 0)

  await state.resetFilters()
  assert.deepEqual(state.filters.value, { status: 'PENDING_REVIEW', contractRef: '' })
  assert.deepEqual(calls.list.at(-1), { status: 'PENDING_REVIEW', contractRef: '', limit: 50, offset: 0 })
})

test('修订工单面板：分页按 50 条步进，当前页不足一页或到达偏移上限时不再向后翻', async () => {
  const fifty = Array.from({ length: 50 }, (_, index) => ({ ...PENDING_ROW, id: `hold-${index}` }))
  const { state, calls } = buildPanel({ list: async () => ({ items: fifty }) })
  await state.load()
  assert.equal(state.hasPageAfter.value, true)
  await state.changePage(1)
  assert.equal(calls.list.at(-1).offset, 50)
  assert.equal(state.hasPageBefore.value, true)
  await state.changePage(-1)
  assert.equal(calls.list.at(-1).offset, 0)
  assert.equal(state.hasPageBefore.value, false)

  state.pageIndex.value = 1999
  assert.equal(state.hasPageAfter.value, true)
  await state.changePage(1)
  assert.equal(calls.list.at(-1).offset, 100000, '最后一页允许到 offset 100000')
  assert.equal(state.hasPageAfter.value, false, '后端 offset 上限 100000，页面不得越界翻页')
  await state.changePage(1)
  assert.equal(calls.list.at(-1).offset, 100000)
  assert.equal(state.pageIndex.value, 2000)
})

test('修订工单面板：关单说明 4 字不提交，5 字提交后关闭弹窗并刷新列表', async () => {
  const { state, calls } = buildPanel({ list: async () => ({ items: [PENDING_ROW] }) })
  await state.load()
  state.openResolve(PENDING_ROW)
  assert.equal(state.resolveDialog.value.id, 'hold-1')

  await state.submitResolve('已处理差')
  assert.equal(calls.resolve.length, 0)
  assert.match(state.resolveError.value, /至少 5 字/)
  assert.notEqual(state.resolveDialog.value, null)

  await state.submitResolve('  已按修订款  ')
  assert.deepEqual(calls.resolve, [{ id: 'hold-1', reason: '已按修订款' }])
  assert.equal(state.resolveDialog.value, null)
  assert.match(state.notice.value, /已关单.*HT-2026-001/)
  assert.equal(calls.list.length, 2, '关单成功后必须重新读取列表')
})

test('修订工单面板：提交中重复点击只发一次关单请求', async () => {
  let release = null
  const { state, calls } = buildPanel({
    resolve: () => new Promise((resolve) => {
      release = () => resolve({ status: 'RESOLVED' })
    }),
  })
  await state.load()
  state.openResolve(PENDING_ROW)
  const first = state.submitResolve('已按修订款处理')
  const second = state.submitResolve('已按修订款处理')
  assert.equal(state.resolveBusy.value, true)
  assert.equal(calls.resolve.length, 1)
  release()
  await Promise.all([first, second])
  assert.equal(calls.resolve.length, 1)
  assert.equal(state.resolveBusy.value, false)
})

test('修订工单面板：409 / 403 / 404 分别给出明确提示且不关闭弹窗', async () => {
  const cases = [
    [{ status: 409, code: 'SETTLEMENT_CONFLICT', message: '记录已变化、重复或余额不足' }, /已被处理.*不会自动重试/],
    [{ status: 403, code: 'COMMERCIAL_LICENSE_DENIED', message: '商业授权不可用或已到期' }, /只读期/],
    [{ status: 403, code: 'SETTLEMENT_FORBIDDEN', message: '当前用户无权执行此操作' }, /settlement\.revision\.resolve/],
    [{ status: 404, code: 'SETTLEMENT_NOT_FOUND', message: '未找到记录' }, /不存在.*范围/],
  ]
  for (const [failure, expected] of cases) {
    const { state } = buildPanel({ resolve: async () => { throw failure } })
    await state.load()
    state.openResolve(PENDING_ROW)
    await state.submitResolve('已按修订款处理')
    assert.match(state.resolveError.value, expected, JSON.stringify(failure))
    assert.notEqual(state.resolveDialog.value, null)
    assert.equal(state.notice.value, '', '失败时不得提示已关单')
  }
})

test('修订工单面板：列表读取失败按作用域提示，空态区分待复核与已关单', async () => {
  const failing = buildPanel({ list: async () => { throw { status: 403, code: 'SETTLEMENT_FORBIDDEN' } } })
  await failing.state.load()
  assert.match(failing.state.listError.value, /settlement\.revision\.read/)

  const empty = buildPanel({ list: async () => ({ items: [] }) })
  await empty.state.load()
  const html = await renderState(empty.state)
  assert.match(html, /data-testid="revision-holds-empty"/)
  assert.match(html, /没有待复核的修订工单/)

  empty.state.applied.value = { status: 'RESOLVED', contractRef: '' }
  assert.match(await renderState(empty.state), /没有已关单的修订工单/)
})

test('修订工单面板：无读取权限不渲染入口也不发起请求', async () => {
  const { state, calls, hooks } = buildPanel({ can: fullPermissions(RESOLVE, ADJUST) })
  hooks.mounted.forEach((hook) => hook())
  await state.load()
  assert.equal(calls.list.length, 0)
  const html = await renderState(state)
  assert.doesNotMatch(html, /settlement-revision-holds/)
  assert.doesNotMatch(html, /修订工单/)
})

test('修订工单面板：无关单权限时列表可见、关单禁用并说明原因', async () => {
  const { state } = buildPanel({ can: fullPermissions(READ), list: async () => ({ items: [PENDING_ROW] }) })
  await state.load()
  const html = await renderState(state)
  assert.match(html, /HT-2026-001/, '列表仍需可见')
  assert.match(html, /关单按钮已禁用：.*settlement\.revision\.resolve/)
  assert.doesNotMatch(html, /settlement\.receivable\./, '禁用原因只点名缺失的专用关单权限')
  assert.match(html, /aria-describedby="settlement-revision-holds-resolve-hint"/)
  assert.match(html, /id="settlement-revision-holds-resolve-hint"/)
  assert.match(html, /<button[^>]*disabled[^>]*aria-label="关单：HT-2026-001"/)
  // 缺口单权限时即使被程序化调用也不得进入弹窗。
  state.openResolve(PENDING_ROW)
  assert.equal(state.resolveDialog.value, null)
  assert.match(state.listError.value, /settlement\.revision\.resolve/)
})

test('修订工单面板：仅持有专用关单权限即可关单，不再要求应收调整权限', async () => {
  const { state } = buildPanel({ can: fullPermissions(READ, RESOLVE), list: async () => ({ items: [PENDING_ROW] }) })
  await state.load()
  const html = await renderState(state)
  assert.equal(state.canResolve.value, true)
  assert.doesNotMatch(html, /settlement\.receivable\.adjust/)
  assert.doesNotMatch(html, /关单按钮已禁用/)
  assert.match(html, /aria-label="关单：HT-2026-001"/)
  assert.doesNotMatch(html, /<button[^>]*disabled[^>]*aria-label="关单：HT-2026-001"/)
  state.openResolve(PENDING_ROW)
  assert.equal(state.resolveDialog.value.id, 'hold-1')
})

test('修订工单面板：逐期差异以结构化文案呈现，不整段输出 JSON', async () => {
  const { state } = buildPanel({ list: async () => ({ items: [PENDING_ROW] }) })
  await state.load()
  const html = await renderState(state)
  for (const header of ['合同', '合同版本', '差异摘要', '工单原因', '创建时间', '状态', '操作']) {
    assert.match(html, new RegExp(`<th scope="col">${header}</th>`), header)
  }
  assert.match(html, /HT-2026-001/)
  assert.match(html, /合同 ID contract-9/)
  assert.match(html, /合同快照 snapshot-2/)
  assert.match(html, /revision-holds-version[^>]*>[^<]*v1[\s\S]{0,140}v2/)
  assert.match(html, /合同金额 1,000\.00 → 1,200\.00/)
  assert.match(html, /待人工处理 1 期/)
  assert.match(html, /第 1 期 · 金额变化/)
  assert.match(html, /500\.00 → 600\.00/)
  assert.match(html, /查看逐期差异与已发生事实/)
  assert.match(html, /已回款核销 200\.00/)
  assert.match(html, /条款差异待人工处理/)
  assert.match(html, /2026-05-01 11:04:05/, '创建时间按北京时间展示')
  assert.match(html, /settlement-badge tone-warning">待复核/)
  assert.match(html, /aria-label="关单：HT-2026-001"/)
  assert.doesNotMatch(html, /"from_version"|"implemented_facts"|JSON\./, '不得整段输出原始 JSON')
  assert.doesNotMatch(html, /v-html/)
})

test('修订工单面板：条款合计不一致且无逐期差异时说明修订未落地', async () => {
  const row = {
    ...PENDING_ROW,
    id: 'hold-2',
    contract_snapshot_id: '',
    hold_reason: 'TERM_TOTAL_MISMATCH',
    diff: {
      from_version: 1,
      to_version: 2,
      old_contract_amount: '1000.00',
      new_contract_amount: '1200.00',
      new_term_total: '1100.00',
      new_terms: [{ installment_no: 1 }],
      diffs: [],
    },
  }
  const { state } = buildPanel({ list: async () => ({ items: [row] }) })
  await state.load()
  const html = await renderState(state)
  assert.match(html, /无新合同快照（本次修订未落地）/)
  assert.match(html, /合同金额 1,000\.00 → 1,200\.00/)
  assert.match(html, /新条款合计 1,100\.00/)
  assert.match(html, /没有逐期差异明细/)
  assert.match(html, /条款合计与合同金额不一致/)
})

test('修订工单面板：已关单行只读展示处理说明，不再提供关单入口', async () => {
  const row = { ...PENDING_ROW, id: 'hold-3', status: 'RESOLVED', resolution_reason: '已按修订金额调整并红冲', resolved_by: 'user-7' }
  const { state } = buildPanel({ list: async () => ({ items: [row] }) })
  await state.load()
  const html = await renderState(state)
  assert.match(html, /settlement-badge tone-success">已关单/)
  assert.match(html, /已按修订金额调整并红冲/)
  assert.match(html, /user-7/)
  assert.doesNotMatch(html, /aria-label="关单：HT-2026-001"/)
})

test('修订工单面板：读取中与读取失败分别用 role=status / role=alert 呈现', async () => {
  const loading = buildPanel({ list: () => new Promise(() => {}) })
  const pending = loading.state.load()
  assert.match(await renderState(loading.state), /role="status"[^>]*>正在读取修订工单/)
  assert.equal(loading.state.loading.value, true)
  void pending

  const failing = buildPanel({ list: async () => { throw { status: 500 } } })
  await failing.state.load()
  const html = await renderState(failing.state)
  assert.match(html, /role="alert"/)
  assert.match(html, /服务暂时无法完成请求|稍后重新加载/)
  assert.equal(failing.state.loading.value, false)
})

test('修订工单面板：关单弹窗按 5–500 字接线，并把错误与提交中状态交给弹窗', async () => {
  const { state } = buildPanel({ list: async () => ({ items: [PENDING_ROW] }) })
  await state.load()
  state.openResolve(PENDING_ROW)
  state.resolveError.value = '关单说明至少 5 字，请写明已完成的调整或红冲处理。'
  state.resolveBusy.value = true
  const html = await renderState(state)
  assert.match(html, /data-prompt="关单确认"/)
  assert.match(html, /data-minlength="5"/)
  assert.match(html, /data-maxlength="500"/)
  assert.match(html, /data-busy="true"/)
  assert.match(html, /data-error="关单说明至少 5 字/)
  assert.match(html, /关单说明（5 至 500 字）/)
  assert.match(html, /不会自动改写任何收款计划或票据/)
  // 提交中关闭弹窗必须无效，避免写入结果未确认就丢失上下文。
  state.closeResolve()
  assert.notEqual(state.resolveDialog.value, null)
})

test('修订工单面板：只复用 api 层与既有展示工具，不直接抓取或回写业务数据', () => {
  assert.match(SOURCE, /listContractRevisionHolds, resolveContractRevisionHold/)
  assert.match(SOURCE, /from '\.\.\/utils\/revisionHold\.js'/)
  assert.doesNotMatch(SOURCE, /\bfetch\(/, '组件不得绕过 api 层直接请求')
  assert.doesNotMatch(SOURCE, /saveRoleResource|createReceipt|adjustPlan/, '关单只关闭工单，不改写计划或票据')
  assert.match(SOURCE, /role="alert"/)
  assert.match(SOURCE, /<caption/, '表格需要屏幕阅读器可读的标题')
  assert.match(SOURCE, /aria-labelledby="settlement-revision-holds-title"/)
  assert.match(SOURCE, /settlement\.revision\.read/)
})
