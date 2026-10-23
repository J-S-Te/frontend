/**
 * 签署记录归一化边界（合同签署详情弹窗）。
 *
 * 列表接口返回的 contract 使用内部合同标识 `id`；页面第一次归一化后改用
 * `recordId` 保存内部标识、`id` 保存展示用合同编号。若把已归一化的记录再次
 * 归一化，`recordId` 会变成合同编号，详情请求随即按编号 404，弹窗也会因为
 * 记录标识变化而停在“正在读取签署详情…”。这里集中提供幂等判定，避免各调用点
 * 各自假设入参形状。
 */

/** 判定签署记录是否已经过页面归一化（contract.recordId 只由归一化写入）。 */
export function isNormalizedSigningRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const contract = value.contract
  if (!contract || typeof contract !== 'object' || Array.isArray(contract)) return false
  return typeof contract.recordId === 'string' && contract.recordId.trim() !== ''
}

/** 复制已归一化的签署记录，避免弹窗状态与列表对象共享 contract 引用。 */
export function cloneNormalizedSigningRecord(value) {
  if (!isNormalizedSigningRecord(value)) {
    throw new TypeError('cloneNormalizedSigningRecord requires a normalized signing record')
  }
  return { ...value, contract: { ...value.contract } }
}
