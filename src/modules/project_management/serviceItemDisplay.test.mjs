import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import * as Vue from 'vue'
import { baseParse, compile } from '@vue/compiler-dom'
import { compileScript, parse } from '@vue/compiler-sfc'
import { renderToString } from '@vue/server-renderer'
import * as display from './projectDisplay.js'
import * as workflow from './workflowNode.js'

const source = readFileSync(new URL('./views/ProjectManagementView.vue', import.meta.url), 'utf8')
const { descriptor } = parse(source)
const templateAST = baseParse(descriptor.template.content)
const project = { id: 'P-DISPLAY', name: '合成展示项目', customer: '合成客户',
  contract: 'HT-DISPLAY', contract_version: 4, status: '待拆解确认' }
const items = [
  { id: 'SI-ONE', project_id: project.id, system: '档案系统', site: '甲场所',
    category: '软件测试', batch: '第一批次', status: '待确认', selected: true },
  { id: 'SI-TWO', project_id: project.id, system: '办公系统', site: '乙场所',
    category: '软件测试', batch: '第一批次', status: '待确认', selected: false },
]

// 用途：编译服务项选择器的真实业务逻辑与模板，仅替换装饰图标。
// 参数：inline 表示是否同时编译模板，便于分别检查渲染和选择事件。
// 返回值：保留真实搜索、主显示字段及事件载荷的 Vue 组件。
function pickerComponent(inline = true) {
  const pickerSource = readFileSync(new URL('./components/ServiceItemPicker.vue', import.meta.url), 'utf8')
  const { descriptor: picker } = parse(pickerSource)
  const script = compileScript(picker, { id: 'service-item-display', inlineTemplate: inline })
  const bindings = { ConsoleIcon: () => Vue.h('svg') }
  const body = script.content
    .replace(/import ConsoleIcon from [^\n]+\n/g, '')
    .replace(/import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"];?/g,
      (_, names, module) => {
        for (const entry of names.split(',')) {
          const [name, alias = name] = entry.trim().split(/\s+as\s+/)
          bindings[alias] = module === 'vue' ? Vue[name] : display[name]
        }
        return ''
      })
  return new Function(...Object.keys(bindings), body.replace('export default', 'return'))(
    ...Object.values(bindings))
}

// 用途：从页面模板中寻找真实展示区域，避免复制业务模板。
// 参数：className 为目标样式类，root 为当前模板节点。
// 返回值：匹配的模板节点；不存在时返回 undefined。
function findElement(className, root = templateAST) {
  if (root.type === 1 && root.props.some(prop => prop.name === 'class'
    && prop.value?.content.split(/\s+/).includes(className))) return root
  for (const child of root.children || []) {
    const found = findElement(className, child)
    if (found) return found
  }
}

// 用途：渲染真实页面片段与选择器，核验用户实际看到的业务名称。
// 参数：fragment 为页面原始模板，values 为授权快照组成的渲染上下文。
// 返回值：真实 Vue 渲染生成的 HTML。
async function renderFragment(fragment, values = {}) {
  const render = new Function('Vue', compile(fragment,
    { mode: 'function', prefixIdentifiers: true }).code)(Vue)
  return renderToString(Vue.createSSRApp({ setup: () => ({ ...display, ...values }), render,
    components: { ServiceItemPicker: pickerComponent(), ConsoleIcon: () => Vue.h('svg') } }))
}

// 用途：执行页面已有的节点队列计算，检查隐藏全局搜索不会参与节点筛选。
// 参数：section 为操作栏目，keyword 为旧页关键字，options 提供授权服务项与回退事件。
// 返回值：真实节点计算结果、关键字和可追加决定事件的响应式引用。
function nodeHarness(section, keyword, { rows = items, inboxCandidates = rows, events = [] } = {}) {
  const context = { computed: Vue.computed, activeSection: Vue.ref(section),
    keyword: Vue.ref(keyword), serviceItems: Vue.ref(rows), deliveryEvents: Vue.ref(events) }
  for (const name of ['allocationItems', 'inboxItems', 'planningItems', 'preparationItems',
    'assignmentItems', 'methodItems', 'exceptionItems', 'reportItems', 'implementationItems']) {
    context[name] = Vue.ref(rows)
  }
  context.inboxItems = Vue.ref(inboxCandidates)
  const inboxStart = source.indexOf('const pendingRollbackRequests = computed(')
  const inboxCode = source.slice(inboxStart, source.indexOf('\nconst planningItems', inboxStart))
  const start = source.indexOf('const activeNodeItems = computed(')
  const statement = source.slice(start, source.indexOf('\nconst completedProjectCount', start))
  const result = vm.runInNewContext(`${inboxCode}\n${statement}\nactiveNodeItems`, context)
  return { result, keyword: context.keyword, events: context.deliveryEvents }
}

test('服务项队列以项目和系统名称呈现，编号保留为次要信息', async () => {
  const html = await renderToString(Vue.createSSRApp(pickerComponent(), {
    projects: [project], items, selectedIds: ['SI-TWO'],
  }))
  assert.match(html, /<b[^>]*>合成展示项目 · 档案系统<\/b>/)
  assert.match(html, /<b[^>]*>合成展示项目 · 办公系统<\/b>/)
  assert.match(html, /<small[^>]*class="[^"]*pm-service-code[^"]*"[^>]*>[^<]*SI-ONE<\/small>/)
  assert.doesNotMatch(html, /<b[^>]*>SI-/)
  assert.match(html, /class="pm-picker-card selected"[^>]*aria-selected="true"/)
})

test('完成分配项在项目详情保留授权纠错入口，后续阶段和无权限时隐藏', async () => {
  const item = { ...items[0], status: '待分配', team_lead_id: 'LEAD',
    project_manager_id: 'MANAGER', engineer_ids: ['ENGINEER'], conflict_status: 'PASSED' }
  const values = { detailItems: [item], specialMethodLabel: {},
    isEmbeddedPenetrationItem: () => false, canRevokeTeam: true,
    canRevokeExecution: true, canManageDecomposition: true, saving: false,
    projectAllowsNode: (_item, node) => workflow.projectAllowsWorkflowNode('待分配', node) }
  const fragment = findElement('pm-detail-items').loc.source
  const html = await renderFragment(fragment, values)
  for (const label of ['撤销执行团队', '撤销团队负责人', '退回拆解确认']) {
    assert.match(html, new RegExp(`>${label}</button>`))
  }
  for (const override of [
    { canRevokeTeam: false, canRevokeExecution: false, canManageDecomposition: false },
    { detailItems: [{ ...item, status: '待实施' }] },
    { projectAllowsNode: () => false },
  ]) {
    const hidden = await renderFragment(fragment, { ...values, ...override })
    assert.doesNotMatch(hidden, /撤销执行团队|撤销团队负责人|退回拆解确认/)
  }
})

test('队列搜索支持项目系统名称并保留编号场所检索及稳定选择载荷', () => {
  const events = []
  const props = Vue.reactive({ projects: [project], items, selectedIds: ['SI-TWO'], multiple: false })
  const state = pickerComponent(false).setup(props, {
    expose: () => {}, emit: (...args) => events.push(args),
  })
  for (const [keyword, ids] of [
    ['合成展示项目', ['SI-ONE', 'SI-TWO']], [' 办公系统 ', ['SI-TWO']],
    ['si-one', ['SI-ONE']], ['甲场所', ['SI-ONE']], ['不存在', []],
  ]) {
    state.keyword.value = keyword
    assert.deepEqual(state.filteredItems.value.map(item => item.id), ids, keyword)
  }
  state.choose(props.items[1])
  assert.equal(events[0][0], 'select')
  assert.equal(events[0][1].id, 'SI-TWO')
  assert.equal(state.isSelected(props.items[1]), true)
  props.multiple = true
  state.choose(props.items[0])
  assert.equal(events[1][0], 'toggle')
  assert.equal(events[1][1].id, 'SI-ONE')
})

test('队列状态使用真实色调并带出报告阶段，搜索可定位报告编制项', async () => {
  const reporting = { ...items[0], status: '现场实施完成', report_status: 'COMPILING' }
  const exception = { ...items[1], status: '异常处理中', report_status: 'NONE' }
  const html = await renderToString(Vue.createSSRApp(pickerComponent(), {
    projects: [project], items: [reporting, exception], selectedIds: [],
  }))
  assert.match(html, /class="pm-badge processing"[^>]*>报告编制中<\/span>/)
  assert.match(html, /class="pm-badge danger"[^>]*>异常处理中<\/span>/)
  const props = Vue.reactive({ projects: [project], items: [reporting, exception],
    selectedIds: [], multiple: false })
  const state = pickerComponent(false).setup(props, { expose: () => {}, emit: () => {} })
  state.keyword.value = '报告编制中'
  assert.deepEqual(state.filteredItems.value.map(item => item.id), ['SI-ONE'])
  props.items[0] = { ...reporting, report_status: 'ARCHIVED' }
  assert.equal(state.filteredItems.value.length, 0)
  state.keyword.value = '报告已归档'
  assert.deepEqual(state.filteredItems.value.map(item => item.id), ['SI-ONE'])
})

test('操作台摘要与队列同步报告归档，回退后不展示历史报告完成', async () => {
  for (const [status, reportStatus, expected, absent] of [
    ['现场实施完成', 'ARCHIVED', '报告已归档', '报告编制中'],
    ['现场实施完成', 'COMPILING', '报告编制中', '报告已归档'],
    ['实施中', 'ARCHIVED', '实施中', '报告已归档'],
    ['现场实施完成', 'FUTURE_PHASE', '未知', '未开始'],
    ['现场实施完成', undefined, '未提供', '未开始'],
  ]) {
    const selected = { ...items[0], status, report_status: reportStatus }
    const html = await renderFragment(findElement('pm-operation-summary').loc.source, {
      activeSection: 'reports',
      selectedServiceItem: selected, selectedServiceProject: project,
      selectedServiceOwner: '合成人员', selectedServiceDue: '2026-11-19',
    })
    assert.ok(html.includes(expected), `${status}/${reportStatus}: ${html}`)
    assert.ok(!html.includes(absent), `${status}/${reportStatus}: ${html}`)
  }
})

test('缺少项目系统名称时诚实显示缺失说明，编号仍可追溯', async () => {
  const html = await renderToString(Vue.createSSRApp(pickerComponent(), {
    projects: [{ id: project.id, name: '  ' }],
    items: [{ ...items[0], system: '  ' }], selectedIds: [],
  }))
  assert.match(html, /<b[^>]*>未提供项目名称 · 未提供系统名称<\/b>/)
  assert.match(html, /SI-ONE/)
  assert.doesNotMatch(html, /undefined|null/)
})

test('拆解确认合同卡以项目名为标题并保留合同客户来源', async () => {
  const html = await renderFragment(findElement('pm-decomposition-source-card').loc.source, {
    decompositionProject: project, decompositionProjects: [project],
  })
  assert.match(html, /<h2>合成展示项目<\/h2>/)
  assert.match(html, /HT-DISPLAY/)
  assert.match(html, /合成客户/)
})

test('拆解树和表格突出项目系统名称，原批次与纳入状态保持', async () => {
  const grid = findElement('pm-decompose-grid')
  const fragment = grid.children.map(node => node.loc.source).join('')
  const html = await renderFragment(fragment, {
    decompositionProject: project, currentDecompositionItems: items,
    decompositionBatches: [['第一批次', items]], activeDecompositionBatch: '第一批次',
    visibleDecompositionItems: items, selectedDecompositionBatch: '',
  })
  assert.match(html, /<h2>合成展示项目<\/h2>/)
  assert.match(html, /<b>档案系统、办公系统<\/b>/)
  assert.match(html, /<b>合成展示项目 · 档案系统<\/b>/)
  assert.match(html, /<small[^>]*class="[^"]*pm-service-code[^"]*"[^>]*>[^<]*SI-ONE<\/small>/)
  assert.match(html, /第一批次/)
  assert.match(html, /aria-pressed="true"/)
  assert.match(html, /type="checkbox"[^>]*checked/)
})

test('拆解批次合并展示相同系统名称，仍保留真实服务项数量', async () => {
  const sameSystemItems = [items[0], { ...items[1], system: items[0].system }]
  const html = await renderFragment(findElement('pm-tree-panel').loc.source, {
    decompositionProject: project, currentDecompositionItems: sameSystemItems,
    decompositionBatches: [['第一批次', sameSystemItems]],
    activeDecompositionBatch: '第一批次', selectedDecompositionBatch: '',
  })
  assert.match(html, /<b>档案系统<\/b>/)
  assert.doesNotMatch(html, /档案系统、档案系统/)
  assert.match(html, /2 个服务项/)
})

test('操作台仅保留队列搜索，其他页遗留关键字不会缩小节点列表', async () => {
  const fragment = [findElement('pm-filters'),
    findElement('pm-operation-queue')].filter(Boolean).map(node => node.loc.source).join('')
  const h = nodeHarness('planning', '旧页不匹配搜索词')
  const html = await renderFragment(fragment, {
    activeSection: 'planning', projects: [project], activeNodeItems: h.result,
    allocationItems: [], selectedServiceItem: null, keyword: h.keyword, operationRows: [],
    selectServiceItem: () => {},
  })
  assert.equal((html.match(/<input\b/g) || []).length, 1)
  assert.doesNotMatch(html, /搜索编号、项目或负责人|条结果/)
  assert.equal((html.match(/role="option"/g) || []).length, 2)
  h.keyword.value = '另一旧页搜索词'
  assert.deepEqual(h.result.value.map(item => item.id), ['SI-ONE', 'SI-TWO'])
})

test('展示宿主使用真实回退待审队列，只合入可见服务项并随审批决定移除', () => {
  const h = nodeHarness('inbox', '旧页面关键字', {
    inboxCandidates: [items[0]], events: [
      { id: 'rollback-visible', type: 'ROLLBACK_REQUESTED', service_item_id: 'SI-TWO' },
      { id: 'rollback-hidden', type: 'ROLLBACK_REQUESTED', service_item_id: 'SI-HIDDEN' },
    ],
  })
  assert.deepEqual(h.result.value.map(item => item.id), ['SI-ONE', 'SI-TWO'])
  h.events.value.push({ id: 'rollback-approved', type: 'ROLLBACK_APPROVED',
    service_item_id: 'SI-TWO', payload: { request_id: 'rollback-visible' } })
  assert.deepEqual(h.result.value.map(item => item.id), ['SI-ONE'])
})

test('操作台选中摘要以项目系统名称为主信息', async () => {
  const html = await renderFragment(findElement('pm-operation-summary').loc.source, {
    activeSection: 'planning', selectedServiceItem: items[0], selectedServiceProject: project,
    selectedServiceOwner: '合成负责人', selectedServiceDue: '待排期',
  })
  assert.match(html, /<b[^>]*>合成展示项目 · 档案系统<\/b>/)
  assert.match(html, /<small[^>]*class="[^"]*pm-service-code[^"]*"[^>]*>[^<]*SI-ONE<\/small>/)
  assert.match(html, /甲场所/)
})

test('操作事项行使用同一服务项名称并保持其他类型事项原样展示', async () => {
  const start = source.indexOf('<tr v-for="row in operationRows"')
  const fragment = `${source.slice(start, source.indexOf('</td>', start) + 5)}</tr>`
  const context = { ...display, activeSection: Vue.ref('planning'),
    projectByID: Vue.ref(new Map([[project.id, project]])),
    itemByID: Vue.ref(new Map(items.map(item => [item.id, item]))), pendingDeviations: Vue.ref([]) }
  const functionStart = source.indexOf('function operationRowIdentity(')
  if (functionStart >= 0) {
    const statement = source.slice(functionStart, source.indexOf('\n}', functionStart) + 2)
    context.operationRowIdentity = vm.runInNewContext(`${statement}\noperationRowIdentity`, context)
  }
  const html = await renderFragment(fragment, { ...context, operationRows: [
    { id: 'SI-ONE', name: 'SI-ONE · 旧摘要' }, { id: 'other', name: '其他事项' },
  ] })
  assert.match(html, /<b>合成展示项目 · 档案系统<\/b>/)
  assert.match(html, /<small[^>]*class="[^"]*pm-service-code[^"]*"[^>]*>[^<]*SI-ONE<\/small>/)
  assert.match(html, /<b>其他事项<\/b>/)
})

test('项目列表系统名称按项目汇总去重，忽略空名称并保留原顺序', () => {
  const result = display.projectSystemNamesByProject?.([
    ...items, { ...items[0], system: ' 档案系统 ' },
    { ...items[0], system: ' ' },
    { ...items[0], project_id: 'P-OTHER', system: '其他项目系统' },
  ])
  assert.deepEqual(Array.from(result || []), [
    ['P-DISPLAY', '档案系统、办公系统'], ['P-OTHER', '其他项目系统'],
  ])
})

test('项目列表原合同列主显示项目系统名称，合同号保留为次要小字', async () => {
  const start = source.indexOf('<tr v-for="project in pagedProjects"')
  const row = baseParse(source.slice(start, source.indexOf('</tr>', start) + 5)).children[0]
  const cell = row.children.filter(node => node.tag === 'td')[2]
  const html = await renderFragment(cell.loc.source, {
    project, projectSystemsByProject: display.projectSystemNamesByProject?.(items) || new Map(),
  })
  assert.match(html, /<b>合成展示项目 · 档案系统、办公系统<\/b>/)
  assert.match(html, /<small[^>]*class="[^"]*pm-service-code[^"]*"[^>]*>合同编号：HT-DISPLAY<\/small>/)
  assert.doesNotMatch(html, /<b[^>]*>HT-DISPLAY/)
})

test('项目列表名称不可见或空白时明确提示，合同号为空时显示空值', async () => {
  const start = source.indexOf('<tr v-for="project in pagedProjects"')
  const row = baseParse(source.slice(start, source.indexOf('</tr>', start) + 5)).children[0]
  const cell = row.children.filter(node => node.tag === 'td')[2]
  const html = await renderFragment(cell.loc.source, {
    project: { ...project, name: ' ', contract: '' }, projectSystemsByProject: new Map(),
  })
  assert.match(html, /<b>未提供项目名称 · 暂无可见系统名称<\/b>/)
  assert.match(html, /合同编号：—/)
  assert.doesNotMatch(html, /undefined|null/)
})

test('分配队列显示真实分配子阶段及冲突色调，原业务状态保持不变', async () => {
  const item = { ...items[0], status: '待分配', team_lead_id: 'lead',
    project_manager_id: 'manager', engineer_ids: ['engineer'], conflict_status: 'CONFLICT' }
  const html = await renderToString(Vue.createSSRApp(pickerComponent(), {
    projects: [project], items: [item], selectedIds: [],
    statusLabel: entry => workflow.allocationState?.(entry)?.label || '',
  }))
  assert.match(html, /class="pm-badge danger">能力冲突<\/span>/)
  assert.equal(item.status, '待分配')
})
