// pdf.js主库体积大且只在打开合同原件预览时用到，改为首次预览才动态下载；
// Worker随当前发行同源发布，不把原件发送给CDN或外部PDF服务。
let enginePromise = null

// loadPDFEngine 首次预览时加载pdf.js主库并注册同源Worker。
// 参数：无。
// 返回值：pdf.js模块命名空间的Promise；模块内复用同一次加载，首次失败后允许下次重试。
function loadPDFEngine() {
  enginePromise ??= Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?worker&url'),
  ]).then(([engine, worker]) => {
    engine.GlobalWorkerOptions.workerSrc = worker.default
    return engine
  }).catch((error) => {
    enginePromise = null
    throw error
  })
  return enginePromise
}

// getContractPDFDocument 通过同源Worker读取已校验的PDF字节。
// 参数：options为受控渲染器的字节和资源预算，不接收任意外部URL。
// 返回值：PDF引擎加载任务的Promise，由渲染器负责取消和销毁。
export async function getContractPDFDocument(options) {
  const { getDocument } = await loadPDFEngine()
  return getDocument(options)
}
