/**
 * 结算电子发票上传前的本地校验。
 *
 * 与电子发票文件选择框 accept（pdf/ofd/xml/png/jpg/jpeg）和后端 10 MiB 归档上限
 * 保持一致：不合规时直接提示并中止，不调用上传接口，也不改写 FormData 字段顺序。
 * 服务端仍会校验文件大小、校验和与文件内容。
 */
import { validateUploadFile } from '../../shared/utils/uploadValidation.js'

/** 电子发票单文件大小上限：10 MiB（与后端归档上限一致）。 */
export const INVOICE_DOCUMENT_MAX_BYTES = 10 * 1024 * 1024

/** 电子发票允许的扩展名，与 SettlementInvoiceDetailPanel 的 accept 一致。 */
export const INVOICE_DOCUMENT_EXTENSIONS = Object.freeze(['pdf', 'ofd', 'xml', 'png', 'jpg', 'jpeg'])

// 用途：校验电子发票文件的大小与类型。
// 参数：file 为所选文件。
// 返回值：ok 为 true 时允许继续上传；否则 message 为可直接展示的中文提示。
export function validateInvoiceDocumentFile(file) {
  return validateUploadFile(file, {
    label: '电子发票',
    maxSizeBytes: INVOICE_DOCUMENT_MAX_BYTES,
    allowedExtensions: [...INVOICE_DOCUMENT_EXTENSIONS],
  })
}
