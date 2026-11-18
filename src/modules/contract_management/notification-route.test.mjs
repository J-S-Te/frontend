import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parse, compileScript } from '@vue/compiler-sfc'
import { ref } from 'vue'
import { notificationApprovalFilters, resolveNotificationApproval } from './utils/notificationApproval.js'

const { descriptor } = parse(readFileSync(new URL('./views/ContractManagementView.vue', import.meta.url), 'utf8'))
const script = compileScript(descriptor, { id: 'contract-notification-route' })
const names = ['openContractNotificationRoute', 'clearApprovalNotificationRoute', 'closeApproval']
const functions = names.map(name => {
  const node = script.scriptSetupAst.find(item => item.type === 'FunctionDeclaration' && item.id.name === name)
  assert.ok(node, `缺少真实页面函数：${name}`)
  return descriptor.scriptSetup.content.slice(node.start, node.end)
}).join('\n')

// 用途：运行真实合同通知落点与关闭动作，仅读取及路由边界使用合成响应。
// 参数：list 为按坐标返回本人待办的接口替身。
// 返回值：真实页面动作、状态与导航记录。
function harness(list = async params => [{ approval_id: params.approval_id, status: 'active' }]) {
  const opened = [], replacements = [], warnings = [], loads = []
  const route = { name: 'contract_management', params: { section: 'approvals' },
    query: { approval_id: 'a', q: '保留筛选' }, hash: '#approval' }
  const state = { contractNotificationSequence: 0, contractDetailSequence: 0,
    contractNotificationReady: ref(true), activeSection: ref('approvals'),
    approvalRealtimeScope: { invalidate: () => {} }, approvalCommandBusy: ref(false),
    selectedApproval: ref(null), selectedContract: ref(null), approvals: ref([]),
    approvalTab: ref('tasks'), route, notificationApprovalFilters, resolveNotificationApproval,
    listApprovalTasks: list, listApprovals: async () => [], can: () => true,
    normalizeApproval: value => value, normalizeContract: value => value,
    loadBusinessData: async () => { loads.push(true) }, setInitiatedApprovals: () => {},
    getContract: async id => ({ id }), openContract: async value => { opened.push(value) },
    closeApprovalDetail: () => { state.selectedApproval.value = null },
    openApproval: async value => { state.selectedApproval.value = value; opened.push(value) },
    showToast: value => warnings.push(value), formatUserError: error => error.message,
    router: { replace: async target => { replacements.push(target); route.query = target.query } },
  }
  const actions = new Function(...Object.keys(state), `${functions}\nreturn {${names.join(',')}};`)(
    ...Object.values(state))
  return { ...actions, state, opened, replacements, warnings, loads, route }
}

test('同页切换合同通知后，旧待办迟到响应不能重新打开前一个审批', async () => {
  let finishOld
  const h = harness(params => params.approval_id === 'a'
    ? new Promise(resolve => { finishOld = resolve })
    : Promise.resolve([{ approval_id: 'b', status: 'active' }]))
  const old = h.openContractNotificationRoute()
  h.route.query.approval_id = 'b'
  await h.openContractNotificationRoute()
  finishOld([{ approval_id: 'a', status: 'active' }])
  await old
  assert.deepEqual(h.opened.map(value => value.approval_id), ['b'])
})

test('关闭合同审批消费定位，保留筛选和锚点，再点同一提醒可以重开', async () => {
  const h = harness()
  await h.openContractNotificationRoute()
  h.closeApproval()
  await Promise.resolve()
  assert.deepEqual(h.replacements[0].query, { q: '保留筛选' })
  assert.equal(h.replacements[0].hash, '#approval')
  assert.equal(h.state.selectedApproval.value, null)
  h.route.query.approval_id = 'a'
  await h.openContractNotificationRoute()
  assert.equal(h.opened.length, 2)
})

test('当前审批处理中保持原表单，移除通知坐标后重新读取普通待办列表', async () => {
  const h = harness()
  h.state.selectedApproval.value = { approval_id: 'current' }
  h.state.approvalCommandBusy.value = true
  await h.openContractNotificationRoute()
  assert.equal(h.state.selectedApproval.value.approval_id, 'current')
  assert.equal(h.opened.length, 0)
  assert.match(h.warnings[0], /仍在处理/)
  h.state.approvalCommandBusy.value = false
  h.route.query = {}
  await h.openContractNotificationRoute({ reload: true })
  assert.equal(h.loads.length, 1)
})
