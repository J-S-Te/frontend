export function formatSignedContractCount(value) {
  if (value === null || value === undefined) return '合同服务未接入'
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) return '合同服务未接入'
  return `${value} 份`
}
