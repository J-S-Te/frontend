/**
 * 商机附件上传前的本地校验。
 *
 * 约束来自服务端能力接口 `getOpportunityAttachmentCapabilities`：
 * - `max_size_bytes`：附件大小上限（后端默认 20 MiB）；
 * - `allowed_mime_types`：允许的 MIME 白名单（空数组表示服务端未声明，不做本地类型拦截）。
 * 校验在创建上传会话之前执行，超限/类型不符时直接提示并中止，不发起任何网络请求；
 * 服务端仍会再次校验大小与文件内容。
 */
import { validateUploadFile } from '../../shared/utils/uploadValidation.js'

// 用途：读取服务端能力里的大小上限。
// 参数：capability 为 attachment-capabilities 响应。
// 返回值：正整数字节上限；缺失或非法时为 0（不限大小）。
export function opportunityAttachmentMaxBytes(capability) {
  const value = Number(capability?.max_size_bytes)
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
}

// 用途：读取服务端能力里的 MIME 白名单。
// 参数：capability 为 attachment-capabilities 响应。
// 返回值：MIME 数组；缺失时为空数组（不拦截类型）。
export function opportunityAttachmentMimeTypes(capability) {
  const value = capability?.allowed_mime_types
  return Array.isArray(value) ? value.filter((item) => typeof item === 'string' && item.trim()) : []
}

// 用途：按服务端能力校验即将上传的商机附件。
// 参数：file 为所选文件，capability 为 attachment-capabilities 响应。
// 返回值：ok 为 true 时允许继续创建上传会话；否则 message 为可直接展示的中文提示。
export function validateOpportunityAttachment(file, capability) {
  return validateUploadFile(file, {
    label: '附件',
    maxSizeBytes: opportunityAttachmentMaxBytes(capability),
    allowedMimeTypes: opportunityAttachmentMimeTypes(capability),
  })
}
