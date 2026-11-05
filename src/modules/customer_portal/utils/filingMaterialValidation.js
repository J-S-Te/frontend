/**
 * 客户门户备案材料上传前的本地校验。
 *
 * 与界面文案保持一致：材料文件仅接受 PDF / PNG / JPG，单个文件最大 20 MiB。
 * 校验发生在创建材料上传会话与文件网关直传之前，不合规时直接提示并中止，
 * 不发起任何网络请求；服务端仍会校验文件内容与安全扫描结果。
 */
import { validateUploadFile } from '../../shared/utils/uploadValidation.js'

/** 备案材料单文件大小上限：20 MiB（与界面文案一致）。 */
export const FILING_MATERIAL_MAX_BYTES = 20 * 1024 * 1024

/** 备案材料允许的扩展名。 */
export const FILING_MATERIAL_EXTENSIONS = Object.freeze(['pdf', 'png', 'jpg', 'jpeg'])

// 用途：校验备案材料文件的大小与类型。
// 参数：file 为所选文件。
// 返回值：ok 为 true 时允许继续上传；否则 message 为可直接展示的中文提示。
export function validateFilingMaterialFile(file) {
  return validateUploadFile(file, {
    label: '材料文件',
    maxSizeBytes: FILING_MATERIAL_MAX_BYTES,
    allowedExtensions: [...FILING_MATERIAL_EXTENSIONS],
  })
}
