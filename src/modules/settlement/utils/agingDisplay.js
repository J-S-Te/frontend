import { amountOf } from './settlementDisplay.js'
// 用途：解析服务端已验证的数值账龄区间，保留未知区间原文。
// 参数：bucket 为闭区间或末档无上界代码。
// 返回值：标签和排序边界；非法区间返回空值。
function parseBucket(bucket) {
  const match = /^(\d+)(?:-(\d+)|(\+))$/.exec(String(bucket))
  if (!match) return null
  const lower = Number(match[1]), upper = match[3] ? Infinity : Number(match[2])
  if (!Number.isSafeInteger(lower) || (upper !== Infinity && !Number.isSafeInteger(upper)) || upper < lower) return null
  return { lower, upper, label: upper === Infinity ? `${lower} 天以上` : `${lower}–${upper} 天` }
}
// 用途：按可配置账龄生成币种独立占比、色阶和最末档风险标记。
// 参数：items 为服务端账龄汇总行；upperDays 为可选的已验证配置上界。
// 返回值：展示行；未知区间不被推断为最末风险档。
export function agingDisplayRows(items, upperDays) {
  const data = Array.isArray(items) ? items : []
  const configured = Array.isArray(upperDays) && upperDays.length > 0 &&
    upperDays.every((day, index) => Number.isSafeInteger(day) && day > 0 &&
      (index === 0 || day > upperDays[index - 1]))
    ? upperDays.map((day, index) => `${index === 0 ? 0 : upperDays[index - 1] + 1}-${day}`)
      .concat(`${upperDays.at(-1)}+`) : []
  const buckets = [...new Set(configured.length ? configured : data.map(item => item.bucket))]
    .map(bucket => ({ bucket, parsed: parseBucket(bucket) })).filter(item => item.parsed)
    .sort((a, b) => a.parsed.lower - b.parsed.lower || a.parsed.upper - b.parsed.upper)
  const tones = ['green', 'blue', 'orange', 'purple', 'red']
  const totals = new Map()
  data.forEach(item => totals.set(item.currency, (totals.get(item.currency) || 0) + amountOf(item.amount)))
  return data.map(item => {
    const rank = buckets.findIndex(entry => entry.bucket === item.bucket)
    const parsed = parseBucket(item.bucket)
    const finalTone = configured.length || buckets.some(entry => entry.parsed.upper === Infinity) ? 4 : 3
    const toneIndex = buckets.length > 1 ? Math.round(rank * finalTone / (buckets.length - 1)) : 0
    return { ...item, key: `${item.currency}-${item.bucket}`,
      label: `${parsed?.label || item.bucket} · ${item.currency}`,
      tone: rank < 0 ? 'blue' : tones[toneIndex],
      isOldestBucket: parsed?.upper === Infinity,
      percent: totals.get(item.currency) ? Math.round(amountOf(item.amount) / totals.get(item.currency) * 100) : 0 }
  })
}
