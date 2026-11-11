import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
import * as Vue from 'vue'
import { renderToString } from '@vue/server-renderer'
import * as optionPicker from '../optionPicker.js'

// 用途：编译真实业务对象选择器，只替换它自己的HTTP边界。
// 参数：request 为接口替身。
// 返回值：可挂载的组件定义。
function pickerComponent(request) {
  const { descriptor } = parse(readFileSync(new URL('./BusinessOptionPicker.vue', import.meta.url), 'utf8'))
  const script = compileScript(descriptor, { id: 'business-option-picker' })
  const bindings = { ...optionPicker, reimbursementAPI: { request } }
  const source = script.content.replace(/import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"];?/g,
    (_, names, specifier) => {
      for (const entry of names.split(',')) {
        const [key, alias = key] = entry.trim().split(/\s+as\s+/)
        bindings[alias] = specifier === 'vue' ? Vue[key] : bindings[key]
      }
      return ''
    })
  const component = new Function(...Object.keys(bindings), source.replace('export default', 'return'))(
    ...Object.values(bindings))
  component.__descriptor = descriptor
  component.__bindings = script.bindings
  return component
}

// 用途：挂载选择器setup并保留真实模板，供SSR检查提示、空态与已选名称。
// 参数：request 为接口替身，props 为选择器业务参数。
// 返回值：真实响应式状态、事件记录与模板渲染函数。
async function mountPicker(request, props = {}) {
  const component = pickerComponent(request)
  const descriptor = component.__descriptor
  const emitted = []
  let state
  const setup = component.setup
  component.setup = (incoming, context) => {
    state = setup(incoming, context)
    return () => null
  }
  const renderer = Vue.createRenderer({ createComment: () => ({}), insert() {}, remove() {},
    parentNode: () => null, nextSibling: () => null, createElement: () => ({}),
    createText: () => ({}), setText() {}, setElementText() {}, patchProp() {} })
  const app = renderer.createApp(component, {
    path: '/organization-options', objectLabel: '费用组织', ...props,
    'onUpdate:modelValue': (value) => emitted.push(value),
  })
  app.mount({})
  await new Promise((resolve) => setImmediate(resolve))

  async function html() {
    const compiled = compileTemplate({ source: descriptor.template.content,
      filename: 'BusinessOptionPicker.vue', id: 'business-option-picker',
      compilerOptions: { bindingMetadata: component.__bindings } })
    assert.deepEqual(compiled.errors, [])
    const render = new Function('Vue', compiled.code
      .replace(/import \{([^}]+)\} from "vue"/g, (_, names) =>
        `const { ${names.replace(/ as /g, ': ')} } = Vue`)
      .replace('export function render', 'return function render'))(Vue)
    return renderToString(Vue.createSSRApp({ setup: () => state, render }))
  }
  return { state, emitted, html, unmount: () => app.unmount() }
}

test('费用组织按名称加载，选择后只把内部组织ID交给表单', async () => {
  const calls = []
  const fixture = await mountPicker(async (path) => {
    calls.push(path)
    return { items: [{ id: 'org-1', name: '研发中心' }, { id: 'org-2', name: '财务中心' }],
      total: 2, page: 1, page_size: 20 }
  }, { preload: true })
  try {
    assert.deepEqual(calls, ['/organization-options?page=1&page_size=20'])
    assert.equal(fixture.state.items.value.length, 2)
    fixture.state.show()
    await new Promise((resolve) => setImmediate(resolve))
    const html = await fixture.html()
    // 面板里必须是业务名称，不再是可手抄的组织ID。
    assert.match(html, /研发中心/)
    assert.match(html, /财务中心/)
    assert.match(html, /role="listbox"/)
    fixture.state.choose({ id: 'org-1', name: '研发中心' })
    assert.deepEqual(fixture.emitted, ['org-1'])
    assert.equal(fixture.state.open.value, false, '单选完成后收起面板')
  } finally { fixture.unmount() }
})

test('关键词搜索与加载更多沿用接口分页，迟到的旧结果不覆盖新结果', async () => {
  const calls = []
  let release = null
  const fixture = await mountPicker(async (path) => {
    calls.push(path)
    if (path.includes('keyword=')) {
      await new Promise((resolve) => { release = resolve })
    }
    if (path.includes('page=2')) {
      return { items: [{ file_id: 'file-3', name: '回单.pdf' }], total: 3, page: 2, page_size: 2 }
    }
    if (path.includes('keyword=')) {
      return { items: [{ file_id: 'file-9', name: '差旅发票.pdf' }], total: 1, page: 1, page_size: 2 }
    }
    return { items: [{ file_id: 'file-1', name: '发票.pdf' }, { file_id: 'file-2', name: '行程单.png' }],
      total: 3, page: 1, page_size: 2 }
  }, { path: '/invoice-document-options', purpose: 'reimbursement.claim.evidence',
    objectLabel: '证据文件', valueKey: 'file_id', pageSize: 2, preload: true })
  try {
    assert.deepEqual(calls, ['/invoice-document-options?page=1&page_size=2&purpose=reimbursement.claim.evidence'])
    assert.equal(fixture.state.hasMore.value, true)
    fixture.state.loadMore()
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(calls.length, 2)
    assert.match(calls[1], /page=2/)
    assert.deepEqual(fixture.state.items.value.map((row) => row.file_id), ['file-1', 'file-2', 'file-3'])
    fixture.state.keyword.value = '差旅'
    fixture.state.search()
    await new Promise((resolve) => setTimeout(resolve, 320))
    assert.equal(fixture.state.loading.value, true)
    release()
    await new Promise((resolve) => setImmediate(resolve))
    assert.match(calls.at(-1), /keyword=%E5%B7%AE%E6%97%85/)
    assert.deepEqual(fixture.state.items.value.map((row) => row.file_id), ['file-9'])
  } finally { fixture.unmount() }
})

test('空结果显示明确文案，不渲染假选项也不退回手填文件ID', async () => {
  const fixture = await mountPicker(async () => ({ items: [], total: 0, page: 1, page_size: 20 }),
    { path: '/invoice-document-options', purpose: 'reimbursement.claim.evidence',
      objectLabel: '证据文件', valueKey: 'file_id', preload: true })
  try {
    fixture.state.show()
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(fixture.state.empty.value, true)
    const html = await fixture.html()
    assert.match(html, /当前没有可选的证据文件/)
    assert.doesNotMatch(html, /role="option"/)
    assert.doesNotMatch(html, /<input(?![^>]*type="search")/, '选择器不应再现可手抄文件ID的输入框')
  } finally { fixture.unmount() }
})

test('关键词无匹配时文案带上搜索词，读取失败给出原因与重试入口', async () => {
  const fixture = await mountPicker(async () => ({ items: [], total: 0 }), { preload: true })
  try {
    fixture.state.keyword.value = '不存在'
    fixture.state.search()
    await new Promise((resolve) => setTimeout(resolve, 320))
    fixture.state.show()
    assert.match(await fixture.html(), /没有找到与“不存在”匹配的费用组织/)
  } finally { fixture.unmount() }
  const failing = await mountPicker(async () => { throw new Error('组织服务暂不可用') }, { preload: true })
  try {
    failing.state.show()
    await new Promise((resolve) => setImmediate(resolve))
    const html = await failing.html()
    assert.match(html, /组织服务暂不可用/)
    assert.match(html, /重新读取/)
    assert.equal(failing.state.empty.value, false, '失败不能冒充空结果')
  } finally { failing.unmount() }
})

test('已保存的证据引用可移除，多选不会静默丢掉原有文件', async () => {
  const fixture = await mountPicker(async () => ({ items: [{ file_id: 'file-2', name: '行程单.png' }],
    total: 1 }), { path: '/invoice-document-options', multiple: true, valueKey: 'file_id',
    objectLabel: '证据文件', modelValue: ['file-1'], preload: true })
  try {
    fixture.state.show()
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(fixture.state.chips.value.length, 1)
    assert.equal(fixture.state.chips.value[0].label, '证据文件已保存引用 1')
    fixture.state.choose({ file_id: 'file-2', name: '行程单.png' })
    assert.deepEqual(fixture.emitted.at(-1), ['file-1', 'file-2'])
    fixture.state.remove('file-1')
    assert.deepEqual(fixture.emitted.at(-1), [])
    const html = await fixture.html()
    assert.match(html, /行程单\.png/)
  } finally { fixture.unmount() }
})
