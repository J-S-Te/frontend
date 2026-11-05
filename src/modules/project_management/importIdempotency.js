// 三类 CSV 导入确认环节的幂等键。
//
// 服务端按 (tenant, Idempotency-Key) 登记一次确认结果：同键同内容重试返回首次响应，
// 同键不同内容返回 409。因此前端必须保证：
//   1. 同一份文件 + 同一组选中行 → 永远同一个键（失败重试、网络重发都不会重复写入）；
//   2. 重新选择文件或改变选中行 → 换新键（否则新请求会被当成旧请求重放）。
// 键只由文件身份（名称/大小/最后修改时间）与选中行集合推导，不含用户、时间或随机数，
// 避免刷新页面或重试时生成不同键。键的取值落在服务端允许的字符集与长度（1..128）内。

const KEY_PREFIX = 'pm-import'

function scopeSegment(scope) {
  const segment = String(scope || 'import').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return segment || 'import'
}

function selectedRowSignature(selectedRows) {
  const rows = [...new Set((Array.isArray(selectedRows) ? selectedRows : [])
    .map((row) => Number(row))
    .filter((row) => Number.isSafeInteger(row) && row > 0))]
  return rows.sort((left, right) => left - right).join(',')
}

// FNV-1a 64 位：只用于把文件身份压缩成稳定的短标识，不用于安全用途。
function stableHash(value) {
  let hash = 0xcbf29ce484222325n
  const prime = 0x100000001b3n
  const mask = 0xffffffffffffffffn
  for (let index = 0; index < value.length; index += 1) {
    hash ^= BigInt(value.charCodeAt(index))
    hash = (hash * prime) & mask
  }
  return hash.toString(16).padStart(16, '0')
}

/**
 * importIdempotencyKey 生成确认导入的稳定幂等键。
 * @param {{ scope?: string, file?: File|null, selectedRows?: number[] }} input
 *   scope 区分三类导入；file 为原始 CSV；selectedRows 为本次确认的物理行号。
 * @returns {string} 形如 pm-import-capability-3f2a... 的键（字母、数字与连字符）。
 */
export function importIdempotencyKey({ scope = 'import', file = null, selectedRows = [] } = {}) {
  const identity = [
    scopeSegment(scope),
    file?.name || '',
    Number(file?.size) || 0,
    Number(file?.lastModified) || 0,
    selectedRowSignature(selectedRows),
  ].join('|')
  return `${KEY_PREFIX}-${scopeSegment(scope)}-${stableHash(identity)}`
}
