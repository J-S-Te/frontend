// 用途：按完整冻结行的最小币种整数计算折扣率与让利率展示。
// 参数：pricing为服务端冻结快照；缺少正标准额或安全整数时保持未知。
// 返回值：折扣率和让利率的两位小数字符串；基准不完整返回null。
export function pricingDiscountSummary(pricing) {
  if (!pricing?.lines?.length) return null
  let actual = 0n, standard = 0n
  for (const line of pricing.lines) {
    if (!Number.isSafeInteger(line.amount_minor) || line.amount_minor < 0 ||
      !Number.isSafeInteger(line.standard_minor) || line.standard_minor <= 0) return null
    actual += BigInt(line.amount_minor); standard += BigInt(line.standard_minor)
  }
  if (actual > BigInt(Number.MAX_SAFE_INTEGER) || standard > BigInt(Number.MAX_SAFE_INTEGER)) return null
  const percent = (actual * 10000n + standard / 2n) / standard
  return { discount: formatPricingPercent(percent), concession: formatPricingPercent(10000n - percent), isEighty: actual * 5n === standard * 4n }
}

// 用途：把百分比定点百分之一转换为精确展示字符串。
// 参数：hundredths为有符号百分之一百分比整数。
// 返回值：固定两位小数，不使用浮点金额。
function formatPricingPercent(hundredths) {
  const negative = hundredths < 0n, value = negative ? -hundredths : hundredths
  return `${negative ? '-' : ''}${value / 100n}.${String(value % 100n).padStart(2, '0')}`
}
