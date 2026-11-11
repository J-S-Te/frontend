import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
import * as Vue from 'vue'
import { renderToString } from '@vue/server-renderer'
import { formatMinor } from '../api/client.js'
import { recoveryCommand } from '../recovery.js'
import { formatBusinessDateTime } from '../../shared/utils/businessTime.js'
import { PaginationBarStub } from '../../../test/helpers/paginationStub.mjs'
import { createErrorStateStub } from '../../../test/helpers/errorStateStub.mjs'
import { claimStatusLabel as statusLabel, failureMessage } from '../statusLabels.js'

const row = {
  id: 'task-1', claim_id: 'claim-1', version: 3, claim_version: 8, round: 2,
  status: 'PENDING', assignee: 'frozen-original',
}

const detail = {
  id: 'task-1', claim_id: 'claim-1', claim_title: '差旅报销单', claim_version: 9, org_id: 'org',
  frozen_assignee: 'frozen-original', assignee: 'current-owner', version: 4, status: 'PENDING', round: 2,
  allowed_actions: ['RECOVER'], recovery_qualification_status: 'REQUIRES_CURRENT_VERIFICATION',
  snapshot: { payable_minor: '1545', items: [{ requested_minor: '1200' }, { requested_minor: '345' }] },
}

// 用途：挂载恢复面板真实逻辑，替换网络与目录选择边界。
// 参数：request 为HTTP替身，permissions 为当前主体能力。
// 返回值：面板状态、模板渲染和卸载方法。
function mount(request, permissions = ['expense.approval.recover']) {
  const { descriptor } = parse(readFileSync(new URL('./RecoveryPanel.vue', import.meta.url), 'utf8'))
  const script = compileScript(descriptor, { id: 'recovery-panel-test' })
  const reimbursementAPI = { request }
  const dependencies = {
    computed: Vue.computed, ref: Vue.ref, watch: Vue.watch, onBeforeUnmount: Vue.onBeforeUnmount,
    reimbursementAPI, api: reimbursementAPI, formatMinor, formatBusinessDateTime, recoveryCommand, statusLabel, failureMessage,
    PaginationBar: PaginationBarStub,
    BusinessObjectSelect: { render: () => null },
    ErrorState: createErrorStateStub().Stub,
    createCommandRunner: () => ({
      execute: async () => ({}), retry: async () => ({}), pending: () => null,
    }),
  }
  const content = script.content
    .replace(/^import\s+.*?from\s+['"][^'"]+['"]\s*$/gm, '')
    .replace(/^import\s+['"][^'"]+['"]\s*$/gm, '')
    .replace('export default', 'return')
  const component = new Function(...Object.keys(dependencies), content)(...Object.values(dependencies))
  let state
  const setup = component.setup
  component.setup = (props, context) => { state = setup(props, context); return () => null }
  const renderer = Vue.createRenderer({
    createComment: () => ({}), insert() {}, remove() {}, parentNode: () => null, nextSibling: () => null,
    createElement: () => ({}), createText: () => ({}), setText() {}, setElementText() {}, patchProp() {},
  })
  const app = renderer.createApp(component, { permissions })
  app.mount({})
  // 用途：渲染当前真实恢复详情模板。
  // 参数：无。
  // 返回值：可断言的SSR文本。
  async function html() {
    const compiled = compileTemplate({
      source: descriptor.template.content,
      filename: 'RecoveryPanel.vue',
      id: 'recovery-panel-test',
      compilerOptions: { bindingMetadata: script.bindings },
    })
    assert.deepEqual(compiled.errors, [])
    const render = new Function('Vue', compiled.code
      .replace(/import \{([^}]+)\} from "vue"/g, (_, names) =>
        `const { ${names.replace(/ as /g, ': ')} } = Vue`)
      .replace('export function render', 'return function render'))(Vue)
    return renderToString(Vue.createSSRApp({ setup: () => state, render }))
  }
  return { state, html, unmount: () => app.unmount() }
}

test('选择审批行后读取详情并用权威字段覆盖列表对象', async () => {
  const calls = []
  const fixture = mount(async (path) => {
    calls.push(path)
    if (path.startsWith('/approval-recovery-tasks?')) return { items: [row], total: 1 }
    if (path === '/approval-recovery-tasks/task-1') return detail
    throw new Error(`unexpected ${path}`)
  })
  try {
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(fixture.state.rows.value.length, 1)
    await fixture.state.choose(row)
    assert.ok(calls.includes('/approval-recovery-tasks/task-1'))
    assert.equal(fixture.state.selected.value.claim_title, '差旅报销单')
    assert.equal(fixture.state.selected.value.version, 4)
    const html = await fixture.html()
    assert.match(html, /差旅报销单/)
    assert.match(html, /frozen-original/)
    assert.match(html, /current-owner/)
    assert.match(html, /4 \/ 9/)
    assert.match(html, /允许接管这条待办/)
    assert.doesNotMatch(html, /RECOVER/)
    assert.match(html, /金额合计 15\.45 元/)
  } finally { fixture.unmount() }
})

test('详情失败保留列表行并显示可见错误', async () => {
  const fixture = mount(async (path) => {
    if (path.startsWith('/approval-recovery-tasks?')) return { items: [row], total: 1 }
    throw new Error('详情服务暂不可用')
  })
  try {
    await new Promise((resolve) => setImmediate(resolve))
    await fixture.state.choose(row)
    assert.equal(fixture.state.selected.value.id, 'task-1')
    assert.equal(fixture.state.selected.value.version, 3)
    assert.match(fixture.state.error.value, /详情服务暂不可用/)
    const rendered = await fixture.html()
    assert.match(rendered, /class="ui-state" role="alert"/)
    assert.match(rendered, /异常恢复未完成/)
    assert.match(rendered, /审批恢复详情读取失败/)
  } finally { fixture.unmount() }
})

test('详情冲突提示任务已改变并重新加载列表', async () => {
  let listCalls = 0
  let detailCalls = 0
  const fixture = mount(async (path) => {
    if (path.startsWith('/approval-recovery-tasks?')) {
      listCalls++
      return { items: [row], total: 1 }
    }
    detailCalls++
    throw Object.assign(new Error('审批任务已改变'), { status: 409 })
  })
  try {
    await new Promise((resolve) => setImmediate(resolve))
    await fixture.state.choose(row)
    assert.equal(detailCalls, 1)
    assert.equal(listCalls, 2)
    assert.match(fixture.state.error.value, /任务已改变/)
    assert.equal(fixture.state.selected.value, null)
  } finally { fixture.unmount() }
})
