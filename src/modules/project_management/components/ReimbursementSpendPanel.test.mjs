import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parse, compileScript } from '@vue/compiler-sfc'
import * as Vue from 'vue'
import { renderToString } from '@vue/server-renderer'

// 用途：编译项目报销入口的真实业务状态与模板，只替换路由及网络边界。
// 参数：push记录真实跳转意图，inline表示包含模板。
// 返回值：保留阶段门槛及按钮条件的Vue组件。
function component(push, inline = false) {
  const { descriptor } = parse(readFileSync(new URL('./ReimbursementSpendPanel.vue', import.meta.url), 'utf8'))
  const script = compileScript(descriptor, { id: 'project-expense-entry', inlineTemplate: inline })
  const bindings = { frontendModules: [{ code: 'reimbursement' }], useRouter: () => ({ push }),
    todayBusinessDate: () => '2026-11-11', formatBusinessDateTime: (value) => value,
    getProjectReimbursementSpend: async () => ({ items: [], metric: 'paid_net_minor' }),
    getProjectExpenseParticipants: async () => ({ items: [] }), putProjectExpenseParticipant: async () => ({}) }
  const body = script.content.replace(/import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"];?/g,
    (_, names, source) => {
      for (const entry of names.split(',')) {
        const [name, alias = name] = entry.trim().split(/\s+as\s+/)
        bindings[alias] = source === 'vue' ? Vue[name] : bindings[name]
      }
      return ''
    })
  return new Function(...Object.keys(bindings), body.replace('export default', 'return'))(...Object.values(bindings))
}

test('项目报销新建只在报告编制及已完成阶段可点击，早期终止未知仍可查询历史报销', async () => {
  for (const status of ['', '未知', '待实施', '现场实施完成', '已终止', '报告编制', '已完成']) {
    const calls = []
    const panel = component((value) => calls.push(value))
    let state
    const setup = panel.setup
    panel.setup = (props, context) => { state = setup(props, context); return () => null }
    const renderer = Vue.createRenderer({ createComment: () => ({}), insert() {}, remove() {},
      parentNode: () => null, nextSibling: () => null, createText: () => ({}), createElement: () => ({}),
      setText() {}, setElementText() {}, patchProp() {} })
    const props = { projectId: 'project', projectStatus: status, session: { permissions: [] } }
    const app = renderer.createApp(panel, props)
    app.mount({})
    try {
      state.openReimbursement(true)
      const allowed = ['报告编制', '已完成'].includes(status)
      assert.equal(calls.length, allowed ? 1 : 0, status)
      state.openReimbursement(false, 'claim')
      assert.equal(calls.at(-1).query.claim_id, 'claim')
      const html = await renderToString(Vue.createSSRApp(component(() => {}, true), props))
      const createButton = html.match(/<button[^>]*>\s*新建报销\s*<\/button>/)?.[0]
      assert.ok(createButton)
      assert.equal(/disabled/.test(createButton), !allowed, status)
    } finally { app.unmount() }
  }
})
