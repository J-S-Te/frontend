import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { parse, compileScript } from '@vue/compiler-sfc'
import * as Vue from 'vue'
import { renderToString } from '@vue/server-renderer'
import { useNativeScopeChange } from './composables/useNativeScopeChange.js'

// 用途：编译真实范围审批组件并仅隔离HTTP依赖。
// 参数：无。
// 返回值：可渲染的生产组件。
async function component() {
  const source = await readFile(new URL('./components/NativeScopeChangePanel.vue', import.meta.url), 'utf8')
  const { descriptor } = parse(source)
  const compiled = compileScript(descriptor, { id: 'native-scope-panel', inlineTemplate: true })
  const bindings = { useNativeScopeChange, getNativeProjectScope: () => {}, requestNativeProjectScope: () => {}, decideNativeProjectScope: () => {}, withdrawNativeProjectScope: () => {} }
  const body = compiled.content.replace(/import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"];?/g, (_, names, specifier) => {
    if (specifier === 'vue') for (const entry of names.split(',')) { const [name, alias = name] = entry.trim().split(/\s+as\s+/); bindings[alias] = Vue[name] }
    return ''
  })
  return new Function(...Object.keys(bindings), body.replace('export default', 'return'))(...Object.values(bindings))
}

test('真实SFC显示冻结范围与来源行、转义文本，申请人不可自批', async () => {
  const panel = await component()
  const state = { project_id: 'PJ-1', project_version: 3, scope_version: 1, can_request: true, can_approve: true, actor_id: 'business', service_items: [], changes: [
    { id: 'c1', operation_id: 'op-1', requested_by: 'business', status: 'PENDING', base_scope_version: 1, version: 1, reason: '<script>bad</script>', service_items: [{ source_service_id: 'line-1', category: '类别', site: '现场', required_codes: ['Q1'] }] },
  ] }
  const html = await renderToString(Vue.createSSRApp(panel, { projectId: 'PJ-1', initialState: state }))
  assert.match(html, /待审批/); assert.match(html, /line-1/); assert.match(html, /Q1/)
  assert.match(html, /&lt;script&gt;/); assert.doesNotMatch(html, /<script>/)
  assert.match(html, /申请人不能审批自己的提案/); assert.doesNotMatch(html, /批准并生效新版本/)
  state.actor_id = 'director'; state.can_request = false
  const approval = await renderToString(Vue.createSSRApp(panel, { projectId: 'PJ-1', initialState: state }))
  assert.match(approval, /批准并生效新版本/); assert.match(approval, /驳回/)
  assert.doesNotMatch(approval, /提交异人审批/)
})
