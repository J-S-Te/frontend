import assert from 'node:assert/strict'
import test from 'node:test'

import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs'

import { createContractPDFLoadOptions, MAX_IMAGE_PIXELS } from './contractPDFRenderer.js'

// 夹具尺寸刻意超过4MP：A4@300dpi（2480×3508≈8.7MP）必中的线上缺陷，
// 这里用接近A4@300dpi的扫描幅面，确保maxImageSize一旦回退到画布预算就会命中。
const SCAN_WIDTH = 2100
const SCAN_HEIGHT = 2000

// encodeJpeg 生成最小合法基线灰度JPEG：每个8×8块只有DC=0与EOB。
// 参数：width/height为像素尺寸，返回可直接嵌入PDF的Uint8Array。
// 返回值：仅含必要段的JPEG字节，块数由尺寸决定，内容恒为中灰。
function encodeJpeg(width, height) {
  const blockCount = Math.ceil(width / 8) * Math.ceil(height / 8)
  // 每个块发出1位DC类别0 + 1位EOB，全部为0位，末字节按JPEG规范补1。
  const entropyBytes = Math.ceil((blockCount * 2) / 8)
  const entropy = new Uint8Array(entropyBytes)
  if ((blockCount * 2) % 8) entropy[entropyBytes - 1] = 0xff >> ((blockCount * 2) % 8)
  const parts = []
  const u16 = value => [value >> 8 & 0xff, value & 0xff]
  // SOI：JPEG 起始标记。
  parts.push(0xff, 0xd8)
  // DQT：表0量化系数全为1（无损量化）。
  parts.push(0xff, 0xdb, ...u16(67), 0x00, ...new Array(64).fill(1))
  // SOF0：8位精度、单分量灰度、1×1采样、使用量化表0。
  parts.push(0xff, 0xc0, ...u16(11), 8, ...u16(height), ...u16(width), 1, 1, 0x11, 0)
  // DHT DC表0：仅含类别0（1位码字），对应全零DC差分。
  parts.push(0xff, 0xc4, ...u16(2 + 1 + 16 + 1), 0x00, 1, ...new Array(15).fill(0), 0x00)
  // DHT AC表0：仅含EOB（1位码字），对应全零AC系数。
  parts.push(0xff, 0xc4, ...u16(2 + 1 + 16 + 1), 0x10, 1, ...new Array(15).fill(0), 0x00)
  // SOS：单分量、使用DC/AC表0、顺序模式、谱选择0..63。
  parts.push(0xff, 0xda, ...u16(8), 1, 1, 0x00, 0, 63, 0)
  parts.push(...entropy)
  parts.push(0xff, 0xd9)
  return Uint8Array.from(parts)
}

// buildScanPDF 组装单页PDF，页面铺满一张DCTDecode扫描位图。
// 参数：jpeg为内嵌位图字节，width/height为位图声明的像素尺寸。
// 返回值：带正确xref偏移的PDF字节，供pdf.js直接解析。
function buildScanPDF({ jpeg, width, height }) {
  const encoder = new TextEncoder()
  const chunks = []
  const offsets = []
  let length = 0
  const push = (data) => {
    const bytes = typeof data === 'string' ? encoder.encode(data) : data
    chunks.push(bytes)
    length += bytes.length
  }
  const object = (number, body) => {
    offsets[number] = length
    push(`${number} 0 obj\n${body}\nendobj\n`)
  }
  const content = `q ${width / SCAN_WIDTH * 595} 0 0 ${height / SCAN_HEIGHT * 842} 0 0 cm /Im1 Do Q`
  push('%PDF-1.7\n%\xe2\xe3\xcf\xd3\n')
  object(1, '<< /Type /Catalog /Pages 2 0 R >>')
  object(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>')
  object(3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] '
    + '/Resources << /XObject << /Im1 5 0 R >> >> /Contents 4 0 R >>')
  offsets[4] = length
  push(`4 0 obj\n<< /Length ${encoder.encode(content).length} >>\nstream\n${content}\nendstream\nendobj\n`)
  offsets[5] = length
  push(`5 0 obj\n<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} `
    + `/ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`)
  push(jpeg)
  push('\nendstream\nendobj\n')
  const xrefOffset = length
  push('xref\n0 6\n0000000000 65535 f \n')
  for (let number = 1; number <= 5; number += 1) {
    push(`${String(offsets[number]).padStart(10, '0')} 00000 n \n`)
  }
  push(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`)
  const pdf = new Uint8Array(length)
  let position = 0
  for (const chunk of chunks) {
    pdf.set(chunk, position)
    position += chunk.length
  }
  return pdf
}

// 真实位图回归：用渲染器同一组加载参数打开内嵌扫描位图，断言绘制指令仍在。
// 历史缺陷：maxImageSize复用4MP画布预算 ⇒ pdf.js只warn就丢弃图像 ⇒ 整页空白无报错。
test('超过4MP的DCTDecode扫描位图必须保留绘制指令，不允许静默丢弃', async () => {
  const pixels = SCAN_WIDTH * SCAN_HEIGHT
  assert.ok(pixels > 4_000_000,
    `夹具必须大于旧画布预算4MP，当前像素数=${pixels}，否则无法复现扫描件空白缺陷`)
  assert.ok(pixels <= MAX_IMAGE_PIXELS,
    `夹具像素数=${pixels} 必须在新解码上限 ${MAX_IMAGE_PIXELS} 之内`)
  const pdf = buildScanPDF({
    jpeg: encodeJpeg(SCAN_WIDTH, SCAN_HEIGHT),
    width: SCAN_WIDTH,
    height: SCAN_HEIGHT,
  })
  const options = createContractPDFLoadOptions(pdf)
  const loadingTask = getDocument(options)
  try {
    const document = await loadingTask.promise
    const page = await document.getPage(1)
    const { fnArray, argsArray } = await page.getOperatorList()
    const index = fnArray.indexOf(OPS.paintImageXObject)
    assert.ok(index !== -1,
      `扫描位图（${SCAN_WIDTH}×${SCAN_HEIGHT}=${pixels}px）未进入绘制指令，`
      + `说明解码上限 maxImageSize=${options.maxImageSize} 把它丢弃 ⇒ 整页空白。`
      + `实际指令=${JSON.stringify(fnArray)}`)
    // 指令还在不代表位图可用：等解码结果落进页面缓存，确认像素真的解出来了。
    const objId = argsArray[index][0]
    for (let attempt = 0; attempt < 50 && !page.objs.has(objId); attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 20))
    }
    assert.ok(page.objs.has(objId), '扫描位图未完成解码，页面缓存中没有图像数据 ⇒ 绘制为空白')
    const image = page.objs.get(objId)
    assert.equal(image.width, SCAN_WIDTH)
    assert.equal(image.height, SCAN_HEIGHT)
    assert.ok(image.data && image.data.length > 0, '扫描位图解码结果为空 ⇒ 整页空白')
  } finally {
    await loadingTask.destroy()
  }
})
