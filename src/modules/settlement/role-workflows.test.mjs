import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
const source = readFileSync(new URL('./views/SettlementView.vue',import.meta.url),'utf8')
// 用途：提取真实视图中的读取编排函数用于隔离执行。
// 参数：name 为待测函数名。
// 返回值：函数源码。
function body(name) {
 const start=source.indexOf(`async function ${name}(`)
 return source.slice(start,source.indexOf('\n}',start)+2)
}
test('会话失败前不启动任何业务读取，清空旧能力与旧列表', async () => {
 const state={value:[{id:'old'}]}; let business=0
 const c={settlementScope:{begin:()=>1,isCurrent:()=>true},active:{value:'receivables'},loading:{value:false},error:{value:''},settlementSession:{value:{permissions:['old']}},pagedLists:[[()=>{},state]],invoiceDetail:{value:{}},getSettlementSession:async()=>{throw Error('权限服务不可用')},formatSettlementError:e=>e.message,loadTargets:()=>{business++;return []}}
 const load=vm.runInNewContext(`${body('load')};load`,c)
 assert.equal(await load(),false);assert.equal(business,0)
 assert.equal(Object.keys(c.settlementSession.value).length,0);assert.equal(state.value.length,0)
})
test('新增角色流程包含真实表单、版本与未配置外部服务状态',()=>{
 let panel='';try{panel=readFileSync(new URL('./components/SettlementRolePanel.vue',import.meta.url),'utf8')}catch{}
 assert.match(panel,/special_invoice_threshold/)
 assert.match(panel,/REFUND_PENDING/)
 assert.match(panel,/NOT_CONFIGURED/)
 assert.match(panel,/planned_amount/)
})

const panelSource = readFileSync(new URL('./components/SettlementRolePanel.vue',import.meta.url),'utf8')
// 用途：执行真实角色面板业务函数以验证异步与错误语义。
// 参数：names 为函数名数组；context 为隔离依赖。
// 返回值：可调用的真实函数集合。
function panelFunctions(names, context) {
  const bodies=names.map(name=>{
    const prefix = panelSource.includes(`async function ${name}(`) ? 'async ' : ''
    const start=panelSource.indexOf(`${prefix}function ${name}(`)
    assert.ok(start>=0)
    return panelSource.slice(start,panelSource.indexOf('\n}',start)+2)
  })
  return vm.runInNewContext(`${bodies.join('\n')}\n({${names.join(',')}})`,context)
}
test('会计写入成功但刷新失败保留成功事实，URL中的资源ID不混入严格body',async()=>{
  const calls=[]
  const c={props:{section:'finance'},saving:{value:false},error:{value:''},notice:{value:''},saveRoleResource:async(...args)=>{calls.push(args);return {status:'NOT_CONFIGURED'}},load:async()=>false,formatSettlementError:e=>e.message}
  const {save}=panelFunctions(['save'],c)
  assert.equal(await save('/receipt-differences/D/resolve',{id:'D',version:2,resolution:'REFUND_PENDING',reason:'客户长款退款'}),true)
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0][1])),{version:2,resolution:'REFUND_PENDING',reason:'客户长款退款'})
  assert.match(c.notice.value,/已保存.*ERP 未配置.*刷新失败.*勿重复提交/)
  assert.equal(c.saving.value,false)
})
test('业务拒绝时不刷新不显示成功；进行中重复提交不写入',async()=>{
  let writes=0,loads=0
  const c={props:{section:'finance'},saving:{value:false},error:{value:''},notice:{value:''},saveRoleResource:async()=>{writes++;throw Error('版本冲突')},load:async()=>{loads++},formatSettlementError:e=>e.message}
  const {save}=panelFunctions(['save'],c)
  assert.equal(await save('/settings',{version:1},'PUT'),false)
  assert.equal(loads,0);assert.equal(c.notice.value,'');assert.equal(c.error.value,'版本冲突')
  c.saving.value=true
  await save('/settings',{version:1},'PUT')
  assert.equal(writes,1)
})
test('角色面板迟到的设置响应在离开页面后不回写',async()=>{
  let resolve
  const pending=new Promise(done=>{resolve=done})
  const c={generation:0,props:{section:'settings',can:()=>true},loading:{value:false},error:{value:''},settings:{value:null},getRoleResource:()=>pending,formatSettlementError:e=>e.message}
  const {load}=panelFunctions(['load'],c)
  const loading=load();c.generation++
  resolve({version:9})
  assert.equal(await loading,false);assert.equal(c.settings.value,null)
})
test('权限读取成功前不执行页面接口；无能力直接路由不读取业务',async()=>{
  let resolve;let business=0
  const session=new Promise(done=>{resolve=done})
  const c={settlementScope:{begin:()=>1,isCurrent:()=>true},active:{value:''},loading:{value:false},error:{value:''},settlementSession:{value:{}},pagedLists:[],canLoad:()=>false,can:()=>false,getSettlementSession:()=>session,formatSettlementError:e=>e.message,loadTargets:()=>{business++;return []}}
  const load=vm.runInNewContext(`${body('load')};load`,c)
  const pending=load();assert.equal(business,0)
  resolve({permissions:[]});assert.equal(await pending,false)
  assert.equal(business,0);assert.match(c.error.value,/没有可用的结算能力/)
})
test('项目分配采用权威项目与有效助理候选，禁止手填人员冒充选择',()=>{
  assert.match(panelSource,/project-candidates\?project_id=/)
  assert.match(panelSource,/project-assistants\?keyword=/)
  assert.match(panelSource,/<select v-model="assignment.user_id"/)
  assert.doesNotMatch(panelSource,/<input v-model.trim="assignment.user_id"/)
})

test('编辑旧项目协作后查询新候选应恢复创建版本及启用状态', async () => {
  const c = {
    props: { can: () => true }, candidateGeneration: 0,
    candidatesLoading: { value: false }, error: { value: '' }, notice: { value: '' },
    projectCandidates: { value: [] }, assistantCandidates: { value: [] },
    assignment: { value: { project_id: 'old', user_id: 'old-assistant', version: 7, active: false } },
    projectQuery: { value: 'new-project' }, assistantQuery: { value: 'new-assistant' },
    getRoleResource: async path => path.includes('project-candidates')
      ? [{ project_id: 'new-project' }] : { items: [{ user_id: 'new-assistant' }] },
    formatSettlementError: value => value.message,
  }
  const { searchCandidates } = panelFunctions(['searchCandidates'], c)
  await searchCandidates()
  assert.deepEqual(JSON.parse(JSON.stringify(c.assignment.value)), {
    project_id: '', user_id: '', version: 0, active: true,
  })
})

test('计划写入成功后刷新父列表并同步调整表单当前版本', async () => {
  const events = []
  const c = {
    props: { section: 'plans', refreshPlans: async () => { events.push('parent'); return true } },
    saving: { value: false }, error: { value: '' }, notice: { value: '' },
    saveRoleResource: async () => { events.push('write'); return { saved: true } },
    load: async () => { events.push('panel'); return true },
    selectPlan: () => events.push('version'), formatSettlementError: value => value.message,
  }
  const { save } = panelFunctions(['save'], c)
  assert.equal(await save('/receivable-plans/plan-id/adjust', {
    id: 'plan-id', version: 2, planned_amount: '80', reason: '金额调整',
  }), true)
  assert.deepEqual(events, ['write', 'panel', 'parent', 'version'])
})

test('计划写成功而父刷新失败保留成功事实，不使用旧版本继续同步', async () => {
  const c = {
    props: { section: 'plans', refreshPlans: async () => false },
    saving: { value: false }, error: { value: '' }, notice: { value: '' },
    saveRoleResource: async () => ({ saved: true }), load: async () => true,
    selectPlan: () => assert.fail('刷新失败不能将旧列表版本当作当前版本'),
    formatSettlementError: value => value.message,
  }
  const { save } = panelFunctions(['save'], c)
  assert.equal(await save('/receivable-plans/plan-id/adjust', { version: 2 }), true)
  assert.match(c.notice.value, /操作已保存.*刷新失败.*勿重复提交/)
})

test('父计划刷新沿用各列表当前页并丢弃页面切换后的迟到响应', async () => {
  let current = true, resolve
  const pending = new Promise(done => { resolve = done })
  const calls = []
  const c = {
    active: { value: 'receivables' }, can: () => true,
    settlementScope: { begin: () => 1, isCurrent: () => current },
    listPages: { value: { 0: 2, 1: 1 } },
    listReceivablePlans: async page => { calls.push(page); return pending },
    listReceivables: async page => { calls.push(page); return [{ id: 'new-receivable' }] },
    plans: { value: [{ id: 'old-plan' }] }, receivables: { value: [{ id: 'old-receivable' }] },
    error: { value: '' }, formatSettlementError: value => value.message,
  }
  const refresh = vm.runInNewContext(`${body('refreshRolePlans')};refreshRolePlans`, c)
  const running = refresh()
  current = false
  resolve([{ id: 'new-plan' }])
  assert.equal(await running, false)
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [{ limit: 50, offset: 100 }, { limit: 50, offset: 50 }])
  assert.equal(c.plans.value[0].id, 'old-plan')
  assert.equal(c.receivables.value[0].id, 'old-receivable')
})

test('协作保存后只同步所选映射和同项目同人员分配的当前版本', async () => {
  const c = {
    props: { section: 'collaboration' },
    saving: { value: false }, error: { value: '' }, notice: { value: '' },
    mapping: { value: { project_id: 'mapped-project', version: 1, note: '原说明' } },
    assignment: { value: { project_id: 'assigned-project', user_id: 'selected-user', version: 1, active: true } },
    assignments: { value: [] }, projectCandidates: { value: [] }, assistantCandidates: { value: [] },
    saveRoleResource: async () => ({ saved: true }),
    load: async () => {
      c.assignments.value = [
        { project_id: 'mapped-project', user_id: 'current-user', version: 4, active: true, note: '已保存说明' },
        { project_id: 'assigned-project', user_id: 'other-user', version: 99, active: false },
        { project_id: 'other-project', user_id: 'selected-user', version: 88, active: false },
        { project_id: 'assigned-project', user_id: 'selected-user', version: 2, active: true },
      ]
      return true
    },
    formatSettlementError: value => value.message,
  }
  const { save } = panelFunctions(['save', 'selectMapping', 'selectAssignment'], c)
  assert.equal(await save('/project-assignments', c.assignment.value), true)
  assert.equal(c.mapping.value.version, 4)
  assert.equal(c.assignment.value.version, 2)
  assert.equal(c.assignment.value.user_id, 'selected-user')
  assert.equal(c.assignment.value.project_id, 'assigned-project')
})

test('角色财务读取传递独立页码和状态筛选，不能固定取首批', async () => {
  const paths = []
  const c = {
    props: { section: 'finance', can: () => true }, generation: 0,
    loading: { value: false }, error: { value: '' },
    differences: { value: [] }, vouchers: { value: [] }, writeoffs: { value: [] },
    resourcePages: { value: { differences: 4, vouchers: 2, writeoffs: 3 } },
    recordFilters: { value: { differences: { status: 'REVIEW_PENDING', keyword: '' }, vouchers: { status: '', keyword: '' } } },
    URLSearchParams,
    getRoleResource: async path => { paths.push(path); return { items: [] } },
    formatSettlementError: error => error.message,
  }
  const { load } = panelFunctions(['resourcePath', 'load'], c)
  assert.equal(await load(), true)
  assert.ok(paths.includes('/receipt-differences?limit=50&offset=200&status=REVIEW_PENDING'))
  assert.ok(paths.includes('/accounting-vouchers?limit=50&offset=100'))
  assert.ok(paths.includes('/receipt-allocations?limit=50&offset=150'))
})

test('退款完成时间转为UTC并仅提交事实，拒绝后保留草稿而成功后清空', async () => {
  const calls = []
  let accepted = false
  const c = {
    refund: { value: { id: 'D/1', version: 3, reference: 'BANK-001', completed_at: '2026-10-28T09:15:00+08:00', reason: '核对线下凭证' } },
    error: { value: '' },
    save: async (...args) => { calls.push(args); return accepted },
  }
  const { confirmRefund } = panelFunctions(['confirmRefund'], c)
  assert.equal(await confirmRefund(), false)
  assert.equal(c.refund.value.reference, 'BANK-001')
  assert.equal(calls[0][0], '/receipt-differences/D%2F1/confirm-refund')
  assert.equal(calls[0][1].completed_at, '2026-10-28T01:15:00.000Z')
  assert.equal(calls[0][1].version, 3)
  accepted = true
  assert.equal(await confirmRefund(), true)
  assert.equal(c.refund.value.id, '')
  assert.equal(c.refund.value.version, 0)
  c.refund.value.completed_at = 'invalid'
  assert.equal(await confirmRefund(), false)
  assert.equal(calls.length, 2)
})

test('角色分页失败还原页码并清空旧项目选择，保存中不能翻页', async () => {
  let reads = 0
  const c = {
    loading: { value: false }, saving: { value: false }, resourcePages: { value: { assignments: 4 } },
    assignment: { value: { project_id: 'old', user_id: 'old', version: 9, active: false } },
    mapping: { value: { project_id: 'old', version: 9, note: 'old' } },
    projectCandidates: { value: [{ project_id: 'old' }] }, assistantCandidates: { value: [{ user_id: 'old' }] },
    load: async () => { reads++; return false },
  }
  const { changeResourcePage } = panelFunctions(['clearResourceSelection', 'changeResourcePage'], c)
  assert.equal(await changeResourcePage('assignments', 1), false)
  assert.equal(c.resourcePages.value.assignments, 4)
  assert.equal(c.assignment.value.project_id, '')
  assert.equal(c.assignment.value.version, 0)
  assert.equal(c.assignment.value.active, true)
  assert.equal(c.mapping.value.project_id, '')
  c.saving.value = true
  assert.equal(await changeResourcePage('assignments', -1), false)
  assert.equal(reads, 1)
})

test('角色财务筛选从第一页读取并清空上一页差异和退款版本', async () => {
  const c = {
    loading: { value: false }, saving: { value: false }, resourcePages: { value: { differences: 4 } },
    resolution: { value: { id: 'old', version: 7 } }, refund: { value: { id: 'old', version: 8 } },
    load: async () => true,
  }
  const { applyResourceFilter } = panelFunctions(['clearResourceSelection', 'applyResourceFilter'], c)
  assert.equal(await applyResourceFilter('differences'), true)
  assert.equal(c.resourcePages.value.differences, 0)
  assert.equal(c.resolution.value.id, '')
  assert.equal(c.refund.value.version, 0)
})

test('目标分页成功而其他资源失败时清空整批结果，不能将新页行配上旧页码', async () => {
  const c = {
    props: { section: 'finance', can: () => true }, generation: 0,
    loading: { value: false }, saving: { value: false }, error: { value: '' }, settings: { value: null },
    differences: { value: [{ id: 'first-page' }] }, vouchers: { value: [{ id: 'old-voucher' }] },
    writeoffs: { value: [{ id: 'old-allocation' }] },
    resourcePages: { value: { differences: 0, vouchers: 0, writeoffs: 0 } },
    recordFilters: { value: { differences: { status: '', keyword: '' }, vouchers: { status: '', keyword: '' } } },
    resolution: { value: { id: 'old', version: 1 } }, refund: { value: { id: 'old', version: 2 } },
    URLSearchParams,
    getRoleResource: async path => {
      if (path.startsWith('/accounting-vouchers')) throw Error('凭证查询不可用')
      return [{ id: 'second-page' }]
    },
    formatSettlementError: error => error.message,
  }
  const { changeResourcePage } = panelFunctions(['resourcePath', 'clearResourceSelection', 'changeResourcePage', 'load'], c)
  assert.equal(await changeResourcePage('differences', 1), false)
  assert.equal(c.resourcePages.value.differences, 0)
  assert.equal(c.differences.value.length, 0)
  assert.equal(c.writeoffs.value.length, 0)
  assert.match(c.error.value, /凭证查询不可用/)
})
