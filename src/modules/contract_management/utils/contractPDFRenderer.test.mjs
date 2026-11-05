import assert from 'node:assert/strict'
import { stat } from 'node:fs/promises'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const rendererModule = await import('./contractPDFRenderer.js').catch(() => ({}))

// deferred 控制外部PDF引擎异步操作完成顺序。
// 参数：无。
// 返回值：可手工完成或拒绝的Promise及控制函数。
function deferred() {
  let resolve, reject
  const promise = new Promise((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}

// harness 在Canvas与PDF引擎边界注入替身，运行真实资源协调逻辑。
// 参数：pageWait可控制取页完成，renderWait可控制外部绘制完成。
// 返回值：实际控制器、画布及可观测绘制和资源回收记录。
function harness({ pageWait, renderWait } = {}) {
  assert.equal(typeof rendererModule.createContractPDFRenderer, 'function',
    '必须提供可取消、串行且有像素预算的PDF渲染控制器')
  const events = []
  const canvas = { width: 0, height: 0, style: {}, getContext: () => ({}) }
  let loadingTask
  let renderCount = 0
  const page = {
    getViewport: ({ scale }) => ({ width: 600 * scale, height: 800 * scale, scale }),
    cleanup: () => events.push('page-cleanup'),
    render: (options) => {
      renderCount += 1
      events.push({ type: 'render', options })
      return {
        promise: renderCount === 1 && renderWait ? renderWait.promise : Promise.resolve(),
        cancel: () => {
          events.push('cancel')
          renderWait?.reject(Object.assign(new Error('cancelled'), {
            name: 'RenderingCancelledException',
          }))
        },
      }
    },
  }
  const document = {
    numPages: 3,
    getPage: async (number) => {
      events.push({ type: 'page', number })
      if (pageWait) await pageWait.promise
      return page
    },
  }
  const renderer = rendererModule.createContractPDFRenderer({
    canvas,
    loadDocument: (options) => {
      events.push({ type: 'load', options })
      loadingTask = {
        promise: Promise.resolve(document),
        destroy: async () => { events.push('document-destroy') },
      }
      return loadingTask
    },
  })
  return { renderer, canvas, events, page }
}

test('PDF仅从已校验字节加载且关闭脚本求值与外部资源自动获取', async () => {
  const h = harness()
  const bytes = new Uint8Array([37, 80, 68, 70])
  assert.equal(await h.renderer.load(bytes), 3)
  const options = h.events.find(event => event.type === 'load').options
  assert.equal(options.data, bytes)
  assert.equal(options.isEvalSupported, false)
  assert.equal(options.enableXfa, false)
  assert.equal(options.useWorkerFetch, false)
  assert.equal(options.useWasm, false)
  assert.equal(options.url, undefined)
  await h.renderer.destroy()
})

test('图像解码上限与画布像素预算解耦且扫描件解码器走同源资源', async () => {
  const h = harness()
  await h.renderer.load(new Uint8Array([1]))
  const options = h.events.find(event => event.type === 'load').options
  assert.equal(typeof rendererModule.MAX_IMAGE_PIXELS, 'number')
  assert.ok(rendererModule.MAX_IMAGE_PIXELS >= 48 << 20,
    '单图解码上限必须覆盖A4@600dpi（约34.8MP），不能沿用4MP画布预算')
  assert.notEqual(options.maxImageSize, 4_000_000)
  assert.equal(options.maxImageSize, rendererModule.MAX_IMAGE_PIXELS)
  assert.equal(typeof options.wasmUrl, 'string')
  assert.equal(options.wasmUrl, rendererModule.WASM_ASSET_BASE)
  assert.ok(options.wasmUrl.endsWith('pdfjs-wasm/'))
  assert.equal(options.useWasm, false)
  await h.renderer.destroy()
})

test('扫描件解码器资源随public目录发布且非空', async () => {
  const names = ['jbig2_nowasm_fallback.js', 'openjpeg_nowasm_fallback.js']
  for (const name of names) {
    const file = fileURLToPath(new URL(`../../../../public/pdfjs-wasm/${name}`, import.meta.url))
    const stats = await stat(file)
    assert.ok(stats.isFile() && stats.size > 0,
      `public/pdfjs-wasm/${name} 缺失或为空，打包后扫描件解码会失败`)
  }
})

test('高分屏和异常大页面绘制始终限制像素预算且禁用交互注释', async () => {
  const h = harness()
  await h.renderer.load(new Uint8Array([1]))
  h.page.getViewport = ({ scale }) => ({ width: 12000 * scale, height: 16000 * scale })
  await h.renderer.render(1, 200, 8)
  assert.ok(h.canvas.width * h.canvas.height <= 4_000_000)
  assert.ok(h.canvas.width <= 8192 && h.canvas.height <= 8192)
  assert.ok(Number.parseFloat(h.canvas.style.width) <= 8192)
  const rendered = h.events.find(event => event.type === 'render')
  assert.equal(rendered.options.annotationMode, 0)
  await h.renderer.destroy()
})

test('翻页先取消并等待旧画布绘制结束，禁止并行写同一画布', async () => {
  const wait = deferred()
  const h = harness({ renderWait: wait })
  await h.renderer.load(new Uint8Array([1]))
  const first = h.renderer.render(1, 1, 1)
  await new Promise(resolve => setImmediate(resolve))
  const second = h.renderer.render(2, 1, 1)
  assert.equal(await first, false)
  assert.equal(await second, true)
  assert.ok(h.events.indexOf('cancel') < h.events.findIndex(event =>
    event.type === 'page' && event.number === 2))
  assert.equal(h.events.filter(event => event.type === 'render').length, 2)
  await h.renderer.destroy()
})

test('切换或卸载期间迟到的取页不得再绘制并清理旧文档', async () => {
  const wait = deferred()
  const h = harness({ pageWait: wait })
  await h.renderer.load(new Uint8Array([1]))
  const render = h.renderer.render(1, 1, 1)
  await new Promise(resolve => setImmediate(resolve))
  const cleanup = h.renderer.destroy()
  wait.resolve()
  assert.equal(await render, false)
  await cleanup
  assert.equal(h.events.filter(event => event.type === 'render').length, 0)
  assert.ok(h.events.includes('page-cleanup'))
  assert.ok(h.events.includes('document-destroy'))
  assert.equal(h.canvas.width, 0)
  assert.equal(h.canvas.height, 0)
})

test('非法页码或视口不得调用绘制，渲染错误必须向调用方传播', async () => {
  const h = harness()
  await h.renderer.load(new Uint8Array([1]))
  await assert.rejects(h.renderer.render(0, 1, 1), /页码/)
  await assert.rejects(h.renderer.render(4, 1, 1), /页码/)
  h.page.getViewport = () => ({ width: Infinity, height: 100 })
  await assert.rejects(h.renderer.render(1, 1, 1), /尺寸/)
  assert.equal(h.events.filter(event => event.type === 'render').length, 0)
  h.page.getViewport = () => ({ width: 100, height: 100 })
  h.page.render = () => ({ promise: Promise.reject(new Error('PDF绘制失败')), cancel() {} })
  await assert.rejects(h.renderer.render(1, 1, 1), /PDF绘制失败/)
  await h.renderer.destroy()
})

// 引擎改为首次预览才动态下载后，注入入口变成 Promise<task>；
// 控制器必须等它落地再登记任务，且在等待期间被取代时回收该任务。
test('懒加载引擎返回Promise<task>时按代次加载，销毁时回收任务', async () => {
  const canvas = { width: 0, height: 0, style: {}, getContext: () => ({}) }
  const document = { numPages: 2, getPage: async () => ({}) }
  const events = []
  let resolveTask
  const renderer = rendererModule.createContractPDFRenderer({
    canvas,
    loadDocument: () => new Promise((resolve) => { resolveTask = resolve }),
  })
  const loading = renderer.load(new Uint8Array([1]))
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(typeof resolveTask, 'function', '打开预览前不得调用引擎加载入口')
  resolveTask({
    promise: Promise.resolve(document),
    destroy: async () => { events.push('document-destroy') },
  })
  assert.equal(await loading, 2)
  await renderer.destroy()
  assert.deepEqual(events, ['document-destroy'])
})

test('引擎下载期间预览被关闭时立即销毁该任务且不返回页数', async () => {
  const canvas = { width: 0, height: 0, style: {}, getContext: () => ({}) }
  const events = []
  let resolveTask
  const renderer = rendererModule.createContractPDFRenderer({
    canvas,
    loadDocument: () => new Promise((resolve) => { resolveTask = resolve }),
  })
  const loading = renderer.load(new Uint8Array([1]))
  await new Promise(resolve => setImmediate(resolve))
  const destroying = renderer.destroy()
  resolveTask({
    promise: Promise.resolve({ numPages: 1 }),
    destroy: async () => { events.push('document-destroy') },
  })
  assert.equal(await loading, null)
  await destroying
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(events, ['document-destroy'])
})
