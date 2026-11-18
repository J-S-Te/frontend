import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { compileScript, parse } from '@vue/compiler-sfc'
import * as Vue from 'vue'
import * as navigation from '../navigation.js'
import { usePromptDialog } from '../../shared/composables/usePromptDialog.js'

const source = readFileSync(new URL('./CreditApprovalInbox.vue', import.meta.url), 'utf8')

// 用途：执行信用待办真实组件 setup，仅替换 HTTP 与人员目录边界。
// 参数：target 为通知坐标，read 为授权待办接口的受控响应。
// 返回值：组件响应式状态、可变入参与销毁方法。
function harness(target, read) {
  const props = Vue.reactive({ permissions: ['customer.credit.approve'], roles: [],
    applicationId: '', customerId: '', ...target })
  const script = compileScript(parse(source).descriptor, { id: 'credit-navigation' }).content
  const bindings = { ref: Vue.ref, computed: Vue.computed, watch: Vue.watch,
    onMounted: Vue.onMounted, onScopeDispose: Vue.onScopeDispose,
    crmResourceID: navigation.crmResourceID, usePromptDialog,
    PromptDialog: {}, formatCRMError: value => value.message,
    formatBusinessDateTime: value => value, listPendingCustomerCreditApplications: read,
    listOwnerDirectory: async () => ({ items: [] }), createIdempotencyKey: () => 'isolated',
    approveCustomerCreditApplication: () => assert.fail('导航不得提交审批'),
    rejectCustomerCreditApplication: () => assert.fail('导航不得驳回申请') }
  const component = new Function(...Object.keys(bindings), script
    .replace(/^import .*$/gm, '').replace('export default', 'return'))(...Object.values(bindings))
  let state
  const setup = component.setup
  component.setup = (values, context) => { state = setup(values, context); return () => null }
  const renderer = Vue.createRenderer({
    createComment: () => ({}), insert() {}, remove() {}, parentNode: () => null,
    nextSibling: () => null, createElement: () => ({}), createText: () => ({}),
    setText() {}, setElementText() {}, patchProp() {},
  })
  const app = renderer.createApp({ setup: () => () => Vue.h(component, props) })
  app.mount({})
  return { props, state, stop: () => app.unmount() }
}

// 用途：等待组件的授权读取及 Vue 更新完成。
// 参数：无。
// 返回值：异步完成，不等待真实网络或定时轮询。
async function flush() { await new Promise(resolve => setImmediate(resolve)); await Vue.nextTick() }

test('旧客户提醒从完整授权待办集合定位第 50 条以后的申请', async () => {
  const items = Array.from({ length: 60 }, (_, index) => ({
    id: index + 1, customer_id: index + 100, version: 1, status: 'PENDING',
  }))
  const h = harness({ customerId: '159' }, async () => ({ items }))
  try {
    await flush()
    assert.deepEqual(h.state.visibleItems?.value.map(item => item.id), [60])
    assert.match(h.state.targetMessage?.value || '', /已定位/)
  } finally { h.stop() }
})

test('同路由改变申请坐标重新核对授权待办，已处理坐标有可理解提示', async () => {
  const h = harness({ applicationId: '8' }, async () => ({ items: [
    { id: 8, customer_id: 42, version: 2, status: 'PENDING' },
    { id: 9, customer_id: 43, version: 1, status: 'PENDING' },
  ] }))
  try {
    await flush()
    assert.deepEqual(h.state.visibleItems?.value.map(item => item.id), [8])
    h.props.applicationId = '9'
    await flush()
    assert.deepEqual(h.state.visibleItems.value.map(item => item.id), [9])
    h.props.applicationId = '10'
    await flush()
    assert.deepEqual(h.state.visibleItems.value, [])
    assert.match(h.state.targetMessage.value, /已处理|不可见|不存在/)
  } finally { h.stop() }
})

test('切换坐标后旧授权列表迟到不能覆盖新结果，失败不伪装成已处理', async () => {
  const reads = []
  const h = harness({ applicationId: '8' }, () => new Promise((resolve, reject) => {
    reads.push({ resolve, reject })
  }))
  try {
    await Vue.nextTick()
    h.props.applicationId = '9'
    await Vue.nextTick()
    assert.equal(reads.length, 2)
    reads[1].resolve({ items: [{ id: 9, customer_id: 43, status: 'PENDING' }] })
    await flush()
    reads[0].resolve({ items: [{ id: 8, customer_id: 42, status: 'PENDING' }] })
    await flush()
    assert.deepEqual(h.state.visibleItems.value.map(item => item.id), [9])
    const retry = h.state.load()
    reads[2].reject(new Error('审批服务暂时不可用'))
    await retry
    assert.match(h.state.error.value, /暂时不可用/)
    assert.equal(h.state.targetMessage.value, '')
  } finally { h.stop() }
})

test('切换通知目标时取消旧申请的审批输入，避免在新卡片下提交旧申请', async () => {
  const h = harness({ applicationId: '8' }, async () => ({ items: [
    { id: 8, customer_id: 42, version: 2, status: 'PENDING' },
    { id: 9, customer_id: 43, version: 1, status: 'PENDING' },
  ] }))
  try {
    await flush()
    const deciding = h.state.decide(h.state.visibleItems.value[0], 'approve')
    assert.ok(h.state.promptDialog.value)
    h.props.applicationId = '9'
    await flush()
    assert.equal(h.state.promptDialog.value, null)
    await deciding
    assert.equal(h.state.actionID.value, '')
  } finally { h.stop() }
})
