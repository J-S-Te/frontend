import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import * as vue from 'vue'
import { parse, compileScript } from '@vue/compiler-sfc'
import * as pdfRenderer from '../utils/contractPDFRenderer.js'

// flush 等待组件加载、绘制及Vue响应式更新完成。
// 参数：无。
// 返回值：任务队列排空后的Promise。
async function flush() {
  for (let index = 0; index < 20; index++) await vue.nextTick()
  await new Promise(resolve => setImmediate(resolve))
}

// mountPreview 运行实际SFC与渲染控制器，仅替换网络和PDF引擎边界。
// 参数：fetchSource为已授权PDF下载替身，engineError为引擎加载失败。
// 返回值：可查询和交互的Vue宿主树及外部边界调用记录。
async function mountPreview({ fetchSource, engineError } = {}) {
  const source = await readFile(new URL('./ContractPDFPreview.vue', import.meta.url), 'utf8')
  const { descriptor } = parse(source)
  const compiled = compileScript(descriptor, { id: 'pdf-preview-test', inlineTemplate: true })
  const imports = {
    vue,
    '../utils/contractPDFRenderer.js': pdfRenderer,
    '../api/contract.js': {
      fetchContractPDFSource: fetchSource || (async () => new Blob(['%PDF-test'])),
    },
    '../utils/contractPDFRuntime.js': {
      getContractPDFDocument: () => ({
        promise: engineError ? Promise.reject(engineError) : Promise.resolve({
          numPages: 3,
          getPage: async (number) => ({
            getViewport: ({ scale }) => ({ width: 600 * scale, height: 800 * scale }),
            render: ({ canvasContext }) => {
              canvasContext.pages.push(number)
              return { promise: Promise.resolve(), cancel() {} }
            },
            cleanup() {},
          }),
        }),
        destroy: async () => {},
      }),
    },
  }
  const executable = compiled.content.replace(
    /import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/g,
    (_match, bindings, path) => `const {${bindings.replace(/\bas\b/g, ':')}} = imports[${JSON.stringify(path)}]`,
  ).replace('export default', 'return')
  const component = new Function('imports', executable)(imports)
  const pages = []
  const host = vue.createRenderer({
    createElement: type => ({ type, props: {}, children: [], style: {},
      getContext: () => ({ pages }) }),
    createText: text => ({ type: '#text', text }),
    createComment: text => ({ type: '#comment', text }),
    setText: (node, text) => { node.text = text },
    setElementText: (node, text) => { node.text = text; node.children = [] },
    parentNode: node => node.parent,
    nextSibling: node => node.parent?.children[node.parent.children.indexOf(node) + 1],
    patchProp: (node, key, _previous, value) => { node.props[key] = value },
    insert: (node, parent, anchor) => {
      node.parent = parent
      const index = anchor ? parent.children.indexOf(anchor) : -1
      if (index < 0) parent.children.push(node)
      else parent.children.splice(index, 0, node)
    },
    remove: node => {
      const index = node.parent.children.indexOf(node)
      if (index >= 0) node.parent.children.splice(index, 1)
    },
  })
  const root = { children: [] }
  const props = vue.reactive({ descriptor: { source_path: '/contracts/one/source',
    current_sha256: 'a'.repeat(64), filename: '原件.pdf' } })
  const app = host.createApp({ render: () => vue.h(component, props) })
  app.mount(root)
  await flush()
  return { root, pages, props, app }
}

// nodes 遍历实际组件宿主树以定位用户可见控件。
// 参数：node为当前节点。
// 返回值：当前节点和全部后代节点。
function nodes(node) {
  return [node, ...(node.children || []).flatMap(nodes)]
}

test('PDF在当前文档画布显示且保留原件下载，翻页产生真实新页绘制', async () => {
  const h = await mountPreview()
  try {
    assert.equal(nodes(h.root).some(node => node.type === 'iframe'), false)
    const canvas = nodes(h.root).find(node => node.type === 'canvas')
    assert.ok(canvas?.width > 0, '原件必须在父文档的画布上绘制')
    assert.deepEqual(h.pages, [1])
    const link = nodes(h.root).find(node => node.type === 'a')
    assert.equal(link.props.download, '原件.pdf')
    assert.match(link.props.href, /^blob:/)
    const next = nodes(h.root).find(node => node.props?.['aria-label'] === '下一页')
    next.props.onClick()
    await flush()
    assert.deepEqual(h.pages, [1, 2])
  } finally {
    h.app.unmount()
    await flush()
  }
})

test('PDF引擎失败给出可操作提示且不向页面泄漏引擎内部错误', async () => {
  const h = await mountPreview({ engineError: new Error('internal SECRET file path') })
  try {
    const visible = nodes(h.root).map(node => node.text || '').join(' ')
    assert.match(visible, /PDF.*重试|重试.*PDF/)
    assert.doesNotMatch(visible, /SECRET|internal/)
    assert.ok(nodes(h.root).some(node => node.type === 'a' && node.props.download))
  } finally {
    h.app.unmount()
    await flush()
  }
})

test('切换原件中止旧下载且迟到旧结果不能覆盖当前原件', async () => {
  const requests = []
  const h = await mountPreview({ fetchSource: (path, options) => new Promise(resolve => {
    requests.push({ path, options, resolve })
  }) })
  try {
    h.props.descriptor = { source_path: '/contracts/two/source', filename: '第二份.pdf',
      current_sha256: 'b'.repeat(64) }
    await flush()
    assert.equal(requests[0].options.signal.aborted, true)
    assert.equal(requests[1].options.expectedSHA256, 'b'.repeat(64))
    requests[1].resolve(new Blob(['%PDF-current']))
    await flush()
    const currentURL = nodes(h.root).find(node => node.type === 'a').props.href
    requests[0].resolve(new Blob(['%PDF-stale']))
    await flush()
    assert.equal(nodes(h.root).find(node => node.type === 'a').props.href, currentURL)
    assert.deepEqual(h.pages, [1])
  } finally {
    h.app.unmount()
    await flush()
  }
})
