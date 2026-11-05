import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import * as Vue from 'vue'
import { compile } from '@vue/compiler-dom'
import { renderToString } from '@vue/server-renderer'
import { reportStatusLabel, statusTone } from '../projectDisplay.js'

const source = readFileSync(new URL('./ProjectManagementView.vue', import.meta.url), 'utf8')

// 用途：提取真实组件的报告状态、阶段链、列表行与推进函数供隔离执行。
// 参数：status 为当前报告状态，permissions 为当前用户的报告权限。
// 返回值：可响应状态变化的组件上下文及真实报告计算结果。
function reportHarness(status, permissions = ['project.report.prepare']) {
  const item = { id: 'SI-REPORT', project_id: 'P-1', site: '合成现场', version: 7,
    status: '现场实施完成', report_status: status }
  const writes = []
  const context = {
    computed: Vue.computed, selectedServiceItem: Vue.ref(item),
    saving: Vue.ref(false), operationForm: Vue.ref({}),
    permissionSet: Vue.ref(new Set(permissions)), activeSection: Vue.ref('reports'),
    reportItems: Vue.ref([item]), projectByID: Vue.ref(new Map()),
    // 报告中文词表已迁到 projectDisplay.js，这里以真实导入值注入，不再从视图切片求值。
    reportStatusLabel,
    personLabel: () => '合成负责人', formatBusinessDate: () => '',
    showToast: () => {}, refreshAfterWrite: async () => {},
    formatUserError: (error) => { throw error },
    updateReportStatus: async (...args) => { writes.push(args) },
  }
  for (const name of ['projects', 'allocationItems', 'inboxItems', 'planningItems',
    'preparationItems', 'capabilities', 'assignmentItems', 'methodItems', 'pendingDeviations']) {
    context[name] = Vue.ref([])
  }
  const statements = ['reportStatusRank', 'reportPhaseNext',
    'reportPhasePermission', 'canAdvanceReportPhase'].map((name) =>
    source.match(new RegExp(`^const ${name} = .+$`, 'm'))[0])
  const actionLabels = source.match(/^const reportPhaseAction = .+$/m)
  if (actionLabels) statements.push(actionLabels[0])
  for (const [name, end] of [['reportSteps', '\n})'], ['operationRows', '\n}[activeSection.value] || []))']]) {
    const start = source.indexOf(`const ${name} = computed(`)
    statements.push(source.slice(start, source.indexOf(end, start) + end.length))
  }
  const start = source.indexOf('async function runOperation(')
  statements.push(source.slice(start, source.indexOf('\n}', start) + 2))
  const results = vm.runInNewContext(`${statements.join('\n')}\n({
    reportStatusLabel, reportSteps, operationRows, reportPhaseNext, canAdvanceReportPhase, runOperation,
    ...(typeof reportPhaseAction === 'undefined' ? {} : { reportPhaseAction })
  })`, context)
  return { item: context.selectedServiceItem.value, context, writes, ...results }
}

// 用途：渲染真实页面中的报告模板片段，核验可见动作和阶段状态。
// 参数：fragment 为页面原始模板，harness 为隔离组件上下文。
// 返回值：Vue 服务端渲染生成的 HTML。
async function renderFragment(fragment, harness) {
  const values = { ...harness.context, ...harness, statusTone,
    selectedServiceItem: harness.context.selectedServiceItem }
  const render = new Function('Vue', compile(fragment,
    { mode: 'function', prefixIdentifiers: true }).code)(Vue)
  return renderToString(Vue.createSSRApp({ setup: () => values, render }))
}

const nextButton = source.match(/<button[^>]+@click="runOperation\('report-next'\)"[^]*?<\/button>/)[0]
const rollbackButton = source.match(/<button[^>]+@click="submitRollbackRequest\('REPORT_TO_FIELD'\)"[^]*?<\/button>/)[0]
const chain = source.match(/<section class="pm-panel pm-stepper-panel"><header><div><p class="pm-panel-kicker">报告阶段<[^]*?<\/section>/)[0]

test('报告实际推进函数按五阶段发送目标状态，列表进度每阶段递增 20%', async () => {
  const h = reportHarness('NONE')
  assert.equal(h.operationRows.value[0].progress, 0)
  for (const [phase, progress] of [['RECTIFYING', 20], ['COMPILING', 40],
    ['REVIEWED', 60], ['ISSUED', 80], ['ARCHIVED', 100]]) {
    await h.runOperation('report-next')
    assert.deepEqual(h.writes.at(-1), ['SI-REPORT', phase, 7])
    h.item.report_status = phase
    assert.equal(h.operationRows.value[0].progress, progress)
  }
  assert.equal(h.reportPhaseNext.ARCHIVED, undefined)
})

test('报告入口复用编制权限，待整改与整改中显示对应开始动作', async () => {
  const h = reportHarness('NONE')
  assert.match(await renderFragment(nextButton, h), />开始整改<\/button>/)
  h.item.report_status = 'RECTIFYING'
  assert.match(await renderFragment(nextButton, h), />开始编制<\/button>/)
  h.context.permissionSet.value = new Set(['project.report.review'])
  assert.doesNotMatch(await renderFragment(nextButton, h), /<button/)
  h.context.permissionSet.value = new Set(['project.report.prepare'])
  h.item.report_status = 'ARCHIVED'
  assert.doesNotMatch(await renderFragment(nextButton, h), /<button/)
})

test('真实报告阶段链呈现整改在编制前，整改徽章为 amber', async () => {
  const h = reportHarness('RECTIFYING')
  const html = await renderFragment(chain, h)
  assert.deepEqual(Array.from(h.reportSteps.value, (step) => step.phase),
    ['RECTIFYING', 'COMPILING', 'REVIEWED', 'ISSUED', 'ARCHIVED'])
  assert.deepEqual(Array.from(h.reportSteps.value, (step) => step.state),
    ['doing', 'idle', 'idle', 'idle', 'idle'])
  assert.match(html, /class="pm-badge amber">整改中<\/span>/)
  assert.ok(html.indexOf('报告整改') < html.indexOf('报告编制'))
  h.item.report_status = 'COMPILING'
  assert.deepEqual(Array.from(h.reportSteps.value, (step) => step.state),
    ['done', 'doing', 'idle', 'idle', 'idle'])
})

test('报告返工按钮允许整改、编制和审核，签发归档仍不可返工', async () => {
  const h = reportHarness('RECTIFYING')
  h.context.canRequestRollback = Vue.ref(true)
  h.context.submitRollbackRequest = () => {}
  for (const status of ['RECTIFYING', 'COMPILING', 'REVIEWED']) {
    h.item.report_status = status
    assert.match(await renderFragment(rollbackButton, h), /<button/)
  }
  for (const status of ['NONE', 'ISSUED', 'ARCHIVED']) {
    h.item.report_status = status
    assert.doesNotMatch(await renderFragment(rollbackButton, h), /<button/)
  }
  h.item.report_status = 'RECTIFYING'
  h.context.canRequestRollback.value = false
  assert.doesNotMatch(await renderFragment(rollbackButton, h), /<button/)
})
