/**
 * 浏览器侧 Excel 工作簿读取适配层。
 *
 * 使用 read-excel-file 的 universal 入口：它本身不创建 worker-f 包装层，也不依赖 Node 内置模块；
 * 但 fflate 在单个 XML 条目较大时可能使用 blob Worker 解压，因此前端 CSP 必须允许
 * worker-src 'self' blob:（frontend/nginx/default.conf 已配置）。输入是 File/Blob/ArrayBuffer。
 * 解析失败只返回业务可读的中文错误，不把底层堆栈或文件内容抛到页面。
 *
 * 读取器与 fflate 体积较大且只在合同 Excel 导入时才用到，因此改为函数内动态 import：
 * 由 vite manualChunks 归入独立的 excel 块，首屏 vendor 不再携带该依赖。
 */

export const contractExcelMaximumBytes = 5 * 1024 * 1024
export const contractExcelTemplateURL = '/contract-import-template.xlsx'

// loadContractExcelReader 按需加载 read-excel-file universal 入口。
// 参数：无。返回值：readXlsxFile 函数；块下载失败时抛出与文件格式无关的独立中文错误，
// 避免把“代码块加载失败”误报成“文件损坏”。
async function loadContractExcelReader() {
  try {
    const { default: readXlsxFile } = await import('read-excel-file/universal')
    return readXlsxFile
  } catch {
    throw new Error('Excel 解析组件加载失败，请刷新页面后重试。')
  }
}

/**
 * readContractExcelWorkbook 读取 .xlsx 全部工作表。
 * 参数：file 为 File/Blob/ArrayBuffer；面板应在调用前校验扩展名和大小。
 * 返回值：[{sheet, data}]，data 为单元格矩阵；格式不支持或文件损坏时抛出中文错误。
 */
export async function readContractExcelWorkbook(file) {
  if (!file) throw new Error('请选择 Excel 文件。')
  if (typeof file.size === 'number' && file.size > contractExcelMaximumBytes) {
    throw new Error('Excel 文件不能超过 5MiB，请精简后再导入。')
  }
  const readXlsxFile = await loadContractExcelReader()
  let sheets
  try {
    sheets = await readXlsxFile(file)
  } catch (error) {
    const lower = String(error?.message || '').toLowerCase()
    if (lower.includes('zip') || lower.includes('spreadsheet') || lower.includes('invalid')) {
      throw new Error('Excel 文件无法解析，请确认文件是 .xlsx 格式且未损坏。')
    }
    throw new Error('读取 Excel 失败，请确认文件是 .xlsx 格式且未损坏。')
  }
  if (!Array.isArray(sheets) || !sheets.length) throw new Error('Excel 文件中没有可读取的工作表。')
  return sheets
    .filter((sheet) => sheet && typeof sheet.sheet === 'string' && Array.isArray(sheet.data))
    .map((sheet) => ({ sheet: sheet.sheet, data: sheet.data }))
}
