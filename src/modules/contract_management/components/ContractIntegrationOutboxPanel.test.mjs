import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
import * as Vue from 'vue'
import { renderToString } from '@vue/server-renderer'
import { formatUserError } from '../../shared/utils/userError.js'
import { formatBusinessDateTime } from '../../shared/utils/businessTime.js'

const DEAD_ITEM = {
  id: 'fin-1',
  kind: 'financial',
  aggregate_id: 'contract-9',
  event: 'contract.financial_effective.v1',
  attempts: 6,
  last_error: '财务系统超时',
  created_at: '2026-01-02T03:04:05Z',
  updated_at: '2026-01-02T04:05:06Z',
}

function tick() {
  return new Promise((resolve) => setImmediate(resolve))
}

// confirmHarness 复现 useConfirmDialog 的 Promise 语义，便于断言“确认前不写入”。
function confirmHarness() {
  const dialog = Vue.ref(null)
  let resolver = null
  return {
    dialog,
    askConfirm(options = {}) {
      dialog.value = { cancelText: '取消', confirmText: '确认', danger: false, description: '', ...options }
      return new Promise((resolve) => { resolver = resolve })
    },
    accept() {
      const resolve = resolver
      resolver = null
      dialog.value = null
      resolve?.(true)
    },
    cancel() {
      const resolve = resolver
      resolver = null
      dialog.value = null
      resolve?.(false)
    },
  }
}

/**
 * panelHarness 编译实际面板并替换接口、图标和确认框，只验证组件行为；
 * 不代表真实服务、权限或投递链路验收。
 */
function panelHarness({ canManage = true, list = async () => [], retry = async () => ({}) } = {}) {
  const listCalls = []
  const retryCalls = []
  const notices = []
  const mounted = []
  const confirm = confirmHarness()
  const deps = {
    computed: Vue.computed,
    ref: Vue.ref,
    onMounted(callback) { mounted.push(callback) },
    ConsoleIcon: { render() { return null } },
    ConfirmDialog: { render() { return null } },
    SegmentedTabs: { render() { return null } },
    useConfirmDialog: () => confirm,
    listFailedIntegrationOutboxEvents: async (kind, options) => {
      listCalls.push([kind, options])
      return list(kind, listCalls.length)
    },
    retryFailedIntegrationOutboxEvent: async (kind, id) => {
      retryCalls.push([kind, id])
      return retry(kind, id)
    },
    formatUserError,
    formatBusinessDateTime,
  }
  const { descriptor } = parse(readFileSync(new URL('./ContractIntegrationOutboxPanel.vue', import.meta.url), 'utf8'))
  const script = compileScript(descriptor, { id: 'outbox-panel-test' })
  const component = new Function(...Object.keys(deps), script.content
    .replace(/^import\s[\s\S]*?from ['"][^'"]+['"]\n/gm, '')
    .replace('export default', 'return'))(...Object.values(deps))
  const template = compileTemplate({
    source: descriptor.template.content,
    filename: 'ContractIntegrationOutboxPanel.vue',
    id: 'outbox-panel-test',
    compilerOptions: { bindingMetadata: script.bindings },
  })
  assert.deepEqual(template.errors, [])
  const render = new Function('Vue', template.code
    .replace(/import \{([^}]+)\} from "vue"/g, (_, names) => `const { ${names.replace(/ as /g, ': ')} } = Vue`)
    .replace('export function render', 'return function render'))(Vue)
  const props = { canManage }
  const state = component.setup(props, {
    expose() {},
    emit(event, ...args) {
      if (event === 'notify') notices.push(args[0])
    },
  })
  const html = () => renderToString(Vue.createSSRApp({
    render: () => render({}, [], props, Vue.proxyRefs(state), {}, {}),
  }))
  return { state, html, listCalls, retryCalls, notices, confirm, mounted }
}

test('挂载后读取财务队列，切换筛选按四类 kind 重新请求', async () => {
  const panel = panelHarness({ list: () => [] })
  await panel.mounted[0]()
  assert.deepEqual(panel.listCalls, [['financial', { limit: 100 }]])
  await panel.state.changeKind('project')
  await panel.state.changeKind('link')
  await panel.state.changeKind('responsibility')
  assert.deepEqual(panel.listCalls.map(([kind]) => kind), ['financial', 'project', 'link', 'responsibility'])
  assert.deepEqual(panel.state.kind.value, 'responsibility')
})

test('当前无死信时显示空态并说明队列', async () => {
  const panel = panelHarness({ list: () => [] })
  await panel.mounted[0]()
  const html = await panel.html()
  assert.match(html, /当前没有死信事件/)
  assert.match(html, /财务生效队列中没有处于 dead 状态的事件/)
  assert.match(html, /刷新列表/)
})

test('读取失败显示可重试错误与请求编号，重新加载成功后渲染表格', async () => {
  let calls = 0
  const panel = panelHarness({
    list: () => {
      calls += 1
      if (calls === 1) {
        const failure = new Error('服务暂时不可用')
        failure.status = 503
        failure.requestID = 'req-503'
        throw failure
      }
      return [DEAD_ITEM]
    },
  })
  await panel.mounted[0]()
  let html = await panel.html()
  assert.match(html, /死信列表加载失败/)
  assert.match(html, /服务暂时无法完成请求/)
  assert.match(html, /请求编号：req-503/)
  await panel.state.load()
  html = await panel.html()
  assert.match(html, /合同财务生效事件/)
  assert.match(html, /contract\.financial_effective\.v1/)
  assert.match(html, /contract-9/)
  assert.match(html, /6 次/)
  assert.match(html, /财务系统超时/)
  assert.match(html, />重试</)
})

test('重试必须先确认；确认前不写入，确认后提交并刷新列表', async () => {
  let round = 0
  const panel = panelHarness({
    list: () => {
      round += 1
      return round === 1 ? [DEAD_ITEM] : []
    },
    retry: async (kind, id) => ({ id, kind, status: 'retry' }),
  })
  await panel.mounted[0]()
  const pending = panel.state.retry(panel.state.items.value[0])
  await tick()
  assert.equal(panel.retryCalls.length, 0, '确认前不得提交重试')
  assert.ok(panel.confirm.dialog.value, '必须弹出确认框')
  assert.match(panel.confirm.dialog.value.description, /重置为待投递/)
  assert.match(panel.confirm.dialog.value.description, /财务生效/)
  panel.confirm.accept()
  await pending
  assert.deepEqual(panel.retryCalls, [['financial', 'fin-1']])
  assert.equal(panel.listCalls.length, 2, '重试成功后必须刷新当前队列')
  assert.deepEqual(panel.notices, ['已重置财务生效死信事件，后台将重新投递；请稍后刷新核对结果。'])
  const html = await panel.html()
  assert.match(html, /当前没有死信事件/)
})

test('取消确认框不会发起重试', async () => {
  const panel = panelHarness({ list: () => [DEAD_ITEM] })
  await panel.mounted[0]()
  const pending = panel.state.retry(panel.state.items.value[0])
  await tick()
  panel.confirm.cancel()
  await pending
  assert.deepEqual(panel.retryCalls, [])
  assert.equal(panel.listCalls.length, 1)
})

test('重试失败展示服务端可读原因与请求编号，不伪造成功', async () => {
  const panel = panelHarness({
    list: () => [DEAD_ITEM],
    retry: async () => {
      const failure = new Error('未找到可重试的集成投递事件')
      failure.status = 404
      failure.requestID = 'req-404'
      throw failure
    },
  })
  await panel.mounted[0]()
  const pending = panel.state.retry(panel.state.items.value[0])
  await tick()
  panel.confirm.accept()
  await pending
  assert.equal(panel.listCalls.length, 1, '失败后不应声称已刷新成功')
  assert.deepEqual(panel.notices, [], '失败不得提示成功')
  const html = await panel.html()
  assert.match(html, /重试未完成：未找到可重试的集成投递事件/)
  assert.match(html, /请求编号：req-404/)
  assert.match(html, />重试</)
})

test('403 展示无权限提示且不回显服务端原始错误', async () => {
  const panel = panelHarness({
    list: async () => {
      const failure = new Error('当前用户没有执行此操作的权限')
      failure.status = 403
      throw failure
    },
  })
  await panel.mounted[0]()
  const html = await panel.html()
  assert.match(html, /没有查看集成死信的权限/)
  assert.match(html, /approval\.manage/)
  assert.doesNotMatch(html, /当前用户没有执行此操作的权限/)
  assert.doesNotMatch(html, />重试</)
})

test('401 展示登录提示而不是裸错误', async () => {
  const panel = panelHarness({
    list: async () => {
      const failure = new Error('登录状态无效或已过期')
      failure.status = 401
      throw failure
    },
  })
  await panel.mounted[0]()
  const html = await panel.html()
  assert.match(html, /登录状态已失效/)
  assert.doesNotMatch(html, /登录状态无效或已过期/)
})

test('没有 approval.manage 时不发请求，只显示权限说明', async () => {
  const panel = panelHarness({ canManage: false })
  await panel.mounted[0]()
  assert.deepEqual(panel.listCalls, [])
  const html = await panel.html()
  assert.match(html, /当前账号没有集成死信运维权限/)
  assert.match(html, /approval\.manage/)
})

test('死信时间按北京业务时间展示，不跟随浏览器本地时区', async () => {
  const panel = panelHarness({ list: () => [DEAD_ITEM] })
  await panel.mounted[0]()
  const html = await panel.html()
  // created_at 2026-01-02T03:04:05Z → 北京 11:04:05；updated_at 04:05:06Z → 北京 12:05:06。
  assert.match(html, /2026-01-02 11:04:05/)
  assert.match(html, /2026-01-02 12:05:06/)
})
