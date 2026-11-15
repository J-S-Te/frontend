import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import * as Vue from 'vue'
import { compile } from '@vue/compiler-dom'
import { renderToString } from '@vue/server-renderer'
import * as display from './projectDisplay.js'

const source = readFileSync(new URL('./views/ProjectManagementView.vue', import.meta.url), 'utf8')
const boardTemplate = source.match(/<section class="pm-kanban">[\s\S]*?<\/section>/)[0]

// 用途：执行页面的真实看板计算，避免复制生产分组逻辑。
// 参数：projects 为已授权项目快照，items 为仍在现场操作节点的服务项。
// 返回值：响应式分列结果，可验证状态变化后的重新归类。
function boardHarness(projects, items = []) {
  const start = source.indexOf('const implementationKanbanColumns = computed(')
  const statement = source.slice(start, source.indexOf('\n\n', start))
  const context = { ...display, computed: Vue.computed,
    projects: Vue.ref(projects), implementationItems: Vue.ref(items) }
  const columns = vm.runInNewContext(`${statement}\nimplementationKanbanColumns`, context)
  return { columns, projects: context.projects }
}

// 用途：把实际看板计算结果转换成可直接核对的列与项目编号。
// 参数：harness 为页面真实计算上下文。
// 返回值：列名称、数量和项目编号组成的普通数组。
function placements(harness) {
  return JSON.parse(JSON.stringify(harness.columns.value.map(column => ({
    name: column.key, count: column.count, ids: column.cards.map(card => card.id),
  }))))
}

test('实施看板按项目当前状态显示五列，报告后续阶段保留在报告列', () => {
  const h = boardHarness([
    { id: 'ready', status: '实施准备中' },
    { id: 'field', status: '实施中' },
    { id: 'rectifying', status: '报告编制', report_stage: 'RECTIFYING' },
    { id: 'compiling', status: '报告编制', report_stage: 'COMPILING' },
    { id: 'reviewed', status: '报告编制', report_stage: 'REVIEWED' },
    { id: 'issued', status: '报告编制', report_stage: 'ISSUED' },
    { id: 'done', status: '已完成', report_stage: 'ARCHIVED' },
  ], [
    { project_id: 'ready', status: '实施准备中' },
    { project_id: 'field', status: '实施中' },
  ])
  assert.deepEqual(placements(h), [
    { name: '准备完成', count: 1, ids: ['ready'] },
    { name: '现场实施', count: 1, ids: ['field'] },
    { name: '整改中', count: 1, ids: ['rectifying'] },
    { name: '报告编制中', count: 3, ids: ['compiling', 'reviewed', 'issued'] },
    { name: '已完成', count: 1, ids: ['done'] },
  ])
})

test('准备未完成或已回退的项目不能因残留服务项进入看板', () => {
  const h = boardHarness([
    { id: 'rollback', status: '待拆解确认', report_stage: 'RECTIFYING' },
    { id: 'preparing', status: '实施准备中' },
    { id: 'terminated', status: '已终止', report_stage: 'RECTIFYING' },
    { id: 'exception', status: '异常处理中' },
    { id: 'supplement', status: '补充协议处理中', report_stage: 'RECTIFYING' },
    { id: 'unknown', status: '未知', report_stage: 'ARCHIVED' },
  ], [{ project_id: 'rollback', status: '实施中' }])
  assert.deepEqual(placements(h).map(column => column.ids), [[], [], [], [], []])
})

test('同项目多个现场服务项只归入当前项目阶段，整改转编制后移列', () => {
  const h = boardHarness([
    { id: 'mixed', status: '实施准备中' },
    { id: 'report', status: '报告编制', report_stage: 'RECTIFYING' },
  ], [
    { project_id: 'mixed', status: '实施准备中' },
    { project_id: 'mixed', status: '实施中' },
    { project_id: 'mixed', status: '实施中' },
  ])
  assert.deepEqual(placements(h).map(column => column.ids), [['mixed'], [], ['report'], [], []])
  h.projects.value[1].report_stage = 'COMPILING'
  assert.deepEqual(placements(h).map(column => column.ids), [['mixed'], [], [], ['report'], []])
})

test('报告阶段取服务器字段，缺失或未知值不会被冒充为整改中', () => {
  const h = boardHarness([
    { id: 'legacy', status: '现场实施完成', report_stage: ' rectifying ' },
    { id: 'report', status: '报告编制' },
    { id: 'unknown-phase', status: '报告编制', report_stage: 'UNKNOWN' },
    { id: 'not-started', status: '现场实施完成', report_stage: 'NONE' },
  ])
  assert.deepEqual(placements(h).map(column => column.ids), [
    [], [], ['legacy'], ['report', 'unknown-phase'], [],
  ])
})

test('看板总数包含新增阶段，服务项只统计看板内可见项目', () => {
  const h = boardHarness([
    { id: 'field', status: '实施中' },
    { id: 'report', status: '报告编制', report_stage: 'RECTIFYING' },
    { id: 'done', status: '已完成' },
    { id: 'early', status: '待分配' },
  ], [{ project_id: 'field', status: '实施中' }])
  const statements = ['implementationProjectCount', 'implementationBoardServiceCount']
    .map(name => {
      const start = source.indexOf(`const ${name} = computed(`)
      return source.slice(start, source.indexOf('\nconst ', start))
    }).join(';\n')
  const counts = vm.runInNewContext(`${statements};\n({
    projects: implementationProjectCount.value, items: implementationBoardServiceCount.value
  })`, { computed: Vue.computed, implementationKanbanColumns: h.columns,
    serviceItems: Vue.ref([
      { project_id: 'field' }, { project_id: 'report' }, { project_id: 'done' },
      { project_id: 'done' }, { project_id: 'early' }, { project_id: 'unlisted' },
    ]) })
  assert.equal(counts.projects, 3)
  assert.equal(counts.items, 4)
})

test('真实看板模板保留五个空列，卡片显示业务名称和实际报告阶段', async () => {
  const h = boardHarness([
    { id: 'P-REPORT', customer: '合成客户', status: '报告编制',
      report_stage: 'RECTIFYING', progress: 70, due: '' },
  ])
  const render = new Function('Vue', compile(boardTemplate,
    { mode: 'function', prefixIdentifiers: true }).code)(Vue)
  const html = await renderToString(Vue.createSSRApp({
    setup: () => ({ ...display, implementationKanbanColumns: h.columns, openProject: () => {} }),
    render,
  }))
  assert.equal((html.match(/<article>/g) || []).length, 5)
  assert.equal((html.match(/暂无当前节点项目/g) || []).length, 4)
  assert.match(html, /合成客户/)
  assert.match(html, /报告编制 · 整改中/)
  assert.match(html, /待排期/)
})
