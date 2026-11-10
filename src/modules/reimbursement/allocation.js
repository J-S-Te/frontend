import { toMinor } from './api/client.js'

// 用途：把固定两位百分比转换为基点，避免浮点舍入。
// 参数：value 为用户录入的百分比文本。
// 返回值：1至10000的基点整数；非法精度或范围抛出错误。
function ratioPoints(value) {
  const text = String(value ?? '').trim()
  if (!/^(0|[1-9]\d{0,2})(\.\d{1,2})?$/.test(text)) throw new Error('分摊比例最多两位小数')
  const [whole, fraction = ''] = text.split('.')
  const points = Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
  if (points < 1 || points > 10000) throw new Error('每项比例必须大于0且不超过100%')
  return points
}

// 用途：按单一输入模式构造最终整数分分摊，保持与服务端确定性规则一致。
// 参数：item 为费用金额、输入模式和分摊表单；比例使用百分比文本。
// 返回值：含最终金额的可写分摊DTO；不平、重复或零分目标抛错。
export function allocationInput(item) {
  if (item.allocation_mode !== 'RATIO') return { allocation_mode: 'AMOUNT',
    allocations: (item.allocations || []).map(row => ({ project_id: row.project_id,
      service_item_id: row.service_item_id || '', amount_minor: toMinor(row.amount) })) }
  const total = BigInt(toMinor(item.amount))
  const seen = new Set()
  const rows = (item.allocations || []).map(row => {
    const key = `${row.project_id}\0${row.service_item_id || ''}`
    if (!row.project_id || seen.has(key)) throw new Error('请选择不重复的项目和服务项')
    seen.add(key)
    const points = ratioPoints(row.ratio)
    return { project_id: row.project_id, service_item_id: row.service_item_id || '',
      ratio_basis_points: points, amount: total * BigInt(points) / 10000n,
      remainder: total * BigInt(points) % 10000n, key }
  })
  if (!rows.length || rows.reduce((sum,row)=>sum+row.ratio_basis_points,0) !== 10000) {
    throw new Error('项目分摊比例合计必须为100%')
  }
  const order = [...rows].sort((a,b) => a.remainder !== b.remainder
    ? (a.remainder > b.remainder ? -1 : 1) : a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
  const remaining = Number(total - rows.reduce((sum,row)=>sum+row.amount,0n))
  for (let i=0;i<remaining;i+=1) order[i].amount += 1n
  if (rows.some(row=>row.amount<=0n)) throw new Error('金额过小导致零分分摊，请调整目标或比例')
  return { allocation_mode:'RATIO', allocations:rows.map(row=>({project_id:row.project_id,
    service_item_id:row.service_item_id,ratio_basis_points:row.ratio_basis_points,
    amount_minor:String(row.amount)})) }
}
