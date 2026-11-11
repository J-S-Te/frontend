import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import * as Vue from 'vue'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'

let source = ''
try { source = await readFile(new URL('./components/NativeProjectCreateDialog.vue', import.meta.url), 'utf8') } catch {}

// 用途：运行真实原生建项组件并隔离HTTP边界。
// 参数：failure 为可选网络错误。
// 返回值：组件状态、调用参数及发出事件。
function harness(failure = null) {
  assert.ok(source, '原生委托建项组件尚未实现')
  const calls = [], events = []
  const context = { ...Vue, defineProps: () => ({ categories: [{ category: '等保测评', enabled: true }], ownerOrgId: '' }),
    defineEmits: () => (...args) => events.push(args),
    // 组件用共享幂等键生成器（非安全上下文也能工作），测试注入固定值以断言请求标识。
    createIdempotencyKey: () => 'native-operation-1',
    createNativeProject: async (payload) => { calls.push(payload); if (failure) throw failure; return { id: 'PJ-1', ...payload } },
    formatUserError: (error) => error.message,
  }
  const script = source.match(/<script setup>([\s\S]*?)<\/script>/)[1].replace(/^import .*$/gm, '')
  const ui = vm.runInNewContext(`${script}\n;({ form, items, submit, busy, error, confirmed })`, context)
  return { ui, calls, events }
}

test('原生建项组件可编译且提交明确本地来源和待确认范围', async () => {
  const h = harness()
  const { descriptor } = parse(source)
  const script = compileScript(descriptor, { id: 'native-project' })
  assert.deepEqual(compileTemplate({ source: descriptor.template.content, filename: 'NativeProjectCreateDialog.vue', id: 'native-project', compilerOptions: { bindingMetadata: script.bindings } }).errors, [])
  await h.ui.submit(); assert.equal(h.calls.length, 0)
  Object.assign(h.ui.form, { name: '独立项目', customer: '委托单位', customer_id: 'UNIT-1' })
  Object.assign(h.ui.items.value[0], { category: '等保测评', site: '现场' })
  h.ui.confirmed.value = true
  await h.ui.submit()
  assert.equal(h.calls.length, 1)
  assert.equal(h.calls[0].source_kind, 'NATIVE')
  assert.equal(h.calls[0].source_id, 'native-operation-1')
  assert.equal(h.calls[0].contract_id, undefined)
  assert.equal(h.calls[0].service_items[0].category, '等保测评')
  assert.equal(h.events[0][0], 'created')
})

test('网络错误保留同一委托幂等号，未确认和未知类别不得提交', async () => {
  const h = harness(new Error('连接失败'))
  Object.assign(h.ui.form, { name: '项目', customer: '单位', customer_id: 'UNIT-1' })
  Object.assign(h.ui.items.value[0], { category: '未知类别', site: '现场' })
  h.ui.confirmed.value = true
  await h.ui.submit(); assert.equal(h.calls.length, 0)
  h.ui.items.value[0].category = '等保测评'
  await h.ui.submit(); await h.ui.submit()
  assert.equal(h.calls.length, 2)
  assert.equal(h.calls[0].source_id, h.calls[1].source_id)
  assert.equal(h.ui.error.value, '连接失败')
  assert.equal(h.events.length, 0)
})
