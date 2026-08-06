export function formatSignedContractCount(value) {
  if (value === null || value === undefined) return '暂不可用'
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) return '暂不可用'
  return `${value} 份`
}
