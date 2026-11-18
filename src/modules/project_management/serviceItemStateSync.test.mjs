import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { parse as parseJS } from '@babel/parser'
import { parse } from '@vue/compiler-sfc'
import { computed, ref } from 'vue'
import * as display from './projectDisplay.js'
import { formatBusinessDate } from '../shared/utils/businessTime.js'

const source = readFileSync(new URL('./views/ProjectManagementView.vue', import.meta.url), 'utf8')
const script = parse(source).descriptor.scriptSetup.content
const declarations = parseJS(script, { sourceType: 'module' }).program.body
const assigned = {
  id: 'SI-STATE', project_id: 'P-STATE', status: '待分配', report_status: 'NONE',
  team_lead_id: 'lead', project_manager_id: 'manager', engineer_ids: ['engineer'],
}

// 用途：执行真实页面的状态计算，验证刷新快照后的进度与日期显示。
// 参数：item 为服务端返回结构的合成服务项。
// 返回值：可替换服务项快照的响应式引用及页面真实计算结果。
function stateHarness(item) {
  const context = { ...display, computed, ref, formatBusinessDate, selectedServiceItem: ref(item) }
  const names = ['reportStatusRank', 'selectedServiceDue', 'operationSteps', 'reportSteps']
  const statements = names.map((name) => {
    const node = declarations.find(entry => entry.type === 'VariableDeclaration'
      && entry.declarations.some(declaration => declaration.id.name === name))
    assert.ok(node, `页面缺少 ${name}`)
    return script.slice(node.start, node.end)
  })
  const state = vm.runInNewContext(`${statements.join(';\n')};\n({
    selectedServiceDue, operationSteps, reportSteps,
  })`, context)
  return { ...state, selectedServiceItem: context.selectedServiceItem }
}

for (const [status, want] of [
  ['待确认', ['doing', 'idle', 'idle', 'idle', 'idle', 'idle', 'idle']],
  ['待复核', ['doing', 'idle', 'idle', 'idle', 'idle', 'idle', 'idle']],
  ['待分配', ['done', 'done', 'done', 'doing', 'idle', 'idle', 'idle']],
  ['待实施', ['done', 'done', 'done', 'done', 'doing', 'idle', 'idle']],
  ['实施准备中', ['done', 'done', 'done', 'done', 'doing', 'idle', 'idle']],
  ['实施中', ['done', 'done', 'done', 'done', 'done', 'doing', 'idle']],
  ['异常处理中', ['done', 'done', 'done', 'done', 'done', 'doing', 'idle']],
  ['现场实施完成', ['done', 'done', 'done', 'done', 'done', 'done', 'done']],
]) {
  test(`${status}按服务项主状态显示当前阶段，不用残留人员和计划提前完成`, () => {
    const h = stateHarness({ ...assigned, status, planned_start: '2026-11-18T00:00:00Z' })
    assert.deepEqual(Array.from(h.operationSteps.value, step => step.state), want)
  })
}

test('待分配阶段按团队和执行人员依次等待，残留计划不视为已发布', () => {
  const h = stateHarness({ ...assigned, team_lead_id: '',
    planned_start: '2026-11-18T00:00:00Z' })
  assert.deepEqual(Array.from(h.operationSteps.value, step => step.state),
    ['done', 'doing', 'idle', 'idle', 'idle', 'idle', 'idle'])
  h.selectedServiceItem.value.team_lead_id = 'lead'
  h.selectedServiceItem.value.engineer_ids = []
  assert.deepEqual(Array.from(h.operationSteps.value, step => step.state),
    ['done', 'done', 'doing', 'idle', 'idle', 'idle', 'idle'])
})

test('嵌套与顶层计划日期均可展示，已发布与否由服务项状态决定', () => {
  const h = stateHarness({ ...assigned, status: '待实施',
    implementation_plan: { planned_start: '2026-11-18T00:00:00Z',
      planned_end: '2026-11-18T16:30:00Z' } })
  assert.equal(h.selectedServiceDue.value, '2026-11-19')
  assert.equal(h.operationSteps.value[3].state, 'done')
  assert.equal(h.operationSteps.value[4].state, 'doing')
  h.selectedServiceItem.value = { ...assigned, status: '待实施',
    planned_end: '2026-11-19T01:00:00Z' }
  assert.equal(h.selectedServiceDue.value, '2026-11-19')
})

test('报告推进与归档刷新真实阶段链，归档后全部完成', () => {
  const h = stateHarness({ ...assigned, status: '现场实施完成', report_status: 'NONE' })
  for (const [phase, want] of [
    ['NONE', ['idle', 'idle', 'idle', 'idle', 'idle']],
    ['RECTIFYING', ['doing', 'idle', 'idle', 'idle', 'idle']],
    ['COMPILING', ['done', 'doing', 'idle', 'idle', 'idle']],
    ['REVIEWED', ['done', 'done', 'done', 'idle', 'idle']],
    ['ISSUED', ['done', 'done', 'done', 'done', 'idle']],
    ['ARCHIVED', ['done', 'done', 'done', 'done', 'done']],
  ]) {
    h.selectedServiceItem.value = { ...h.selectedServiceItem.value, report_status: phase }
    assert.deepEqual(Array.from(h.reportSteps.value, step => step.state), want, phase)
  }
})

test('回退、终止或未知主状态不使用历史报告和计划标记完成', () => {
  const h = stateHarness(null)
  assert.equal(h.operationSteps.value.length, 0)
  for (const status of ['待确认', '待分配', '实施中', '已终止', '未来状态', '']) {
    h.selectedServiceItem.value = { ...assigned, status, report_status: 'ARCHIVED',
      planned_start: '2026-11-18T00:00:00Z' }
    assert.ok(h.reportSteps.value.every(step => step.state === 'idle'), status)
    if (['已终止', '未来状态', ''].includes(status)) {
      assert.ok(h.operationSteps.value.every(step => step.state === 'idle'), status)
    }
  }
})

test('未知或缺失报告阶段不伪造阶段进度', () => {
  for (const reportStatus of [undefined, '', 'FUTURE_PHASE']) {
    const h = stateHarness({ ...assigned, status: '现场实施完成', report_status: reportStatus })
    assert.ok(h.reportSteps.value.every(step => step.state === 'idle'))
  }
})

test('展示统一采用后端去空白和报告码大写口径，队列与阶段链不分歧', () => {
  const h = stateHarness({ ...assigned, status: ' 现场实施完成 ', report_status: ' archived ' })
  assert.ok(h.operationSteps.value.every(step => step.state === 'done'))
  assert.ok(h.reportSteps.value.every(step => step.state === 'done'))
  assert.deepEqual(display.serviceItemStatusBadges(h.selectedServiceItem.value).map(badge => badge.label),
    ['现场实施完成', '报告已归档'])
})
