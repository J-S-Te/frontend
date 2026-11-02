import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist'
import workerURL from 'pdfjs-dist/build/pdf.worker.min.mjs?worker&url'

// Worker随当前发行同源发布，不把原件发送给CDN或外部PDF服务。
GlobalWorkerOptions.workerSrc = workerURL

// getContractPDFDocument 通过同源Worker读取已校验的PDF字节。
// 参数：options为受控渲染器的字节和资源预算，不接收任意外部URL。
// 返回值：PDF引擎加载任务，由渲染器负责取消和销毁。
export function getContractPDFDocument(options) {
  return getDocument(options)
}
