const MAX_CANVAS_PIXELS = 4_000_000
const MAX_CANVAS_SIDE = 8192
// 图像解码上限必须与画布面积预算解耦：pdf.js worker 在解码前按 W×H 丢弃超过该值的
// 图片，未开stopAtErrors时只warning后跳过绘制指令，扫描件会整页空白。
// 该值与后端 contract_management/internal/contractdocument 的图片预算对齐（后端放宽后
// 单图上限约50MP，覆盖 A4@600dpi≈34.8MP）；不能再用画布面积预算当解码上限。
export const MAX_IMAGE_PIXELS = 48 << 20
// 扫描件解码器随public目录同源发布；保持useWasm:false以避免CSP引入wasm-unsafe-eval。
export const WASM_ASSET_BASE = `${import.meta.env?.BASE_URL || '/'}pdfjs-wasm/`

// createContractPDFLoadOptions 生成pdf.js加载参数，集中画布预算与图像解码预算。
// 参数：data为已校验PDF原件的Uint8Array。
// 返回值：仅同源、无脚本求值、无外部资源自动获取的加载参数。
export function createContractPDFLoadOptions(data) {
  return {
    data,
    isEvalSupported: false,
    enableXfa: false,
    useWorkerFetch: false,
    useWasm: false,
    wasmUrl: WASM_ASSET_BASE,
    maxImageSize: MAX_IMAGE_PIXELS,
    canvasMaxAreaInBytes: MAX_CANVAS_PIXELS * 4,
  }
}

// renderGeometry 将页面、缩放与高分屏倍率约束到单页内存预算。
// 参数：page为引擎页面，zoom为界面缩放，pixelRatio为设备像素倍率。
// 返回值：受限的绘制视口和显示尺寸；非法页面尺寸抛错。
function renderGeometry(page, zoom, pixelRatio) {
  const base = page.getViewport({ scale: 1 })
  if (![base.width, base.height].every(value => Number.isFinite(value) && value > 0)) {
    throw new Error('PDF 页面尺寸无效。')
  }
  const scale = Number.isFinite(zoom) ? Math.min(2, Math.max(0.5, zoom)) : 1
  const density = Number.isFinite(pixelRatio) ? Math.min(2, Math.max(1, pixelRatio)) : 1
  const budgetScale = Math.min(
    MAX_CANVAS_SIDE / base.width,
    MAX_CANVAS_SIDE / base.height,
    Math.sqrt(MAX_CANVAS_PIXELS / base.width / base.height),
  )
  const displayScale = Math.min(scale, budgetScale)
  const outputScale = Math.min(displayScale * density, budgetScale)
  return {
    viewport: page.getViewport({ scale: outputScale }),
    displayWidth: Math.max(1, Math.floor(base.width * displayScale)),
    displayHeight: Math.max(1, Math.floor(base.height * displayScale)),
  }
}

// createContractPDFRenderer 协调单画布PDF加载、串行绘制和资源释放。
// 参数：canvas为当前页画布，loadDocument为本地PDF引擎加载入口，可返回加载任务的Promise。
// 返回值：加载、绘制、清空与销毁操作；真实加载或绘制错误向调用方传播。
export function createContractPDFRenderer({ canvas, loadDocument }) {
  let sourceGeneration = 0
  let renderGeneration = 0
  let disposed = false
  let documentTask = null
  let document = null
  let renderTask = null
  let renderQueue = Promise.resolve()
  let cleanupQueue = Promise.resolve()

  // clear 使旧任务失效，先终止引擎请求再等待绘制释放画布。
  // 参数：无。
  // 返回值：资源释放Promise；真实引擎销毁失败继续抛出。
  const clear = () => {
    const generation = ++sourceGeneration
    renderGeneration += 1
    renderTask?.cancel()
    const oldTask = documentTask
    documentTask = null
    document = null
    const destruction = Promise.resolve().then(() => oldTask?.destroy())
    cleanupQueue = Promise.all([cleanupQueue, renderQueue, destruction]).then(() => {
      if (generation !== sourceGeneration) return
      canvas.width = 0
      canvas.height = 0
    })
    return cleanupQueue
  }

  // load 从已经通过授权和完整性检查的字节建立新文档。
  // 参数：data为PDF原件的Uint8Array，不接受外部URL。
  // 返回值：总页数；任务已被替换时为null，当前文档加载失败抛错。
  const load = async (data) => {
    if (disposed) throw new Error('PDF 预览已经关闭。')
    if (!(data instanceof Uint8Array) || data.length === 0) {
      throw new Error('PDF 原件内容为空或无效。')
    }
    const cleanup = clear()
    const generation = sourceGeneration
    await cleanup
    if (disposed || generation !== sourceGeneration) return null
    const task = await loadDocument(createContractPDFLoadOptions(data))
    // 引擎首次预览才动态下载，等待期间可能已被新请求或销毁取代，落回后重新校验代次。
    if (disposed || generation !== sourceGeneration) {
      // 该任务已无调用方接收错误，销毁失败不再向外抛。
      void Promise.resolve().then(() => task?.destroy?.()).catch(() => {})
      return null
    }
    documentTask = task
    try {
      const result = await task.promise
      if (disposed || generation !== sourceGeneration) return null
      document = result
      return result.numPages
    } catch (error) {
      if (disposed || generation !== sourceGeneration) return null
      throw error
    }
  }

  // render 取消过时绘制并串行展示最新页，避免同一画布并发使用。
  // 参数：pageNumber为从1开始的页码，zoom为缩放，pixelRatio为设备倍率。
  // 返回值：实际完成当前绘制为true；被替换为false；当前任务失败抛错。
  const render = async (pageNumber, zoom = 1, pixelRatio = 1) => {
    const currentDocument = document
    if (!currentDocument || !Number.isInteger(pageNumber)
      || pageNumber < 1 || pageNumber > currentDocument.numPages) {
      throw new Error('PDF 页码无效。')
    }
    const source = sourceGeneration
    const request = ++renderGeneration
    renderTask?.cancel()
    // isCurrent 验证绘制仍属于当前文档和最近一次翻页。
    // 参数：无。
    // 返回值：当前任务是否仍可写画布。
    const isCurrent = () => !disposed && source === sourceGeneration
      && request === renderGeneration
    const pending = renderQueue.then(async () => {
      if (!isCurrent()) return false
      let page = null
      let task = null
      try {
        page = await currentDocument.getPage(pageNumber)
        if (!isCurrent()) return false
        const geometry = renderGeometry(page, zoom, pixelRatio)
        canvas.width = Math.max(1, Math.floor(geometry.viewport.width))
        canvas.height = Math.max(1, Math.floor(geometry.viewport.height))
        canvas.style.width = `${geometry.displayWidth}px`
        canvas.style.height = `${geometry.displayHeight}px`
        const context = canvas.getContext('2d')
        if (!context) throw new Error('当前浏览器无法绘制 PDF 页面。')
        // 仅绘制页面内容，不创建注释、表单、链接或脚本执行层。
        task = page.render({ canvasContext: context, viewport: geometry.viewport,
          annotationMode: 0 })
        renderTask = task
        await task.promise
        return isCurrent()
      } catch (error) {
        if (!isCurrent()) return false
        throw error
      } finally {
        if (renderTask === task) renderTask = null
        page?.cleanup()
      }
    })
    // 单次错误由pending交给调用方；后续重试仍须能够进入串行队列。
    renderQueue = pending.catch(() => {})
    return pending
  }

  // destroy 永久停止控制器并释放Worker及画布资源。
  // 参数：无。
  // 返回值：资源释放Promise，失败交给组件呈现。
  const destroy = () => {
    disposed = true
    return clear()
  }

  return { load, render, clear, destroy }
}
