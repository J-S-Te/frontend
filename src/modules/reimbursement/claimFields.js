import { toMinor } from './api/client.js'
import { allocationInput } from './allocation.js'

// 用途：仅保留已实际填报的行程白名单，不发送空对象或客户端评估结果。
// 参数：value为用户表单，invoice表示票面行程而非本人声明。
// 返回值：可写行程字段或undefined；具体业务日期及城市由服务器校验。
export function travelInput(value,invoice=false) {
  const keys=invoice?['kind','origin_city_code','destination_city_code','start_date','end_date']
    :['origin_city_code','destination_city_code','departure_date','return_date']
  const result=Object.fromEntries(keys.map(key=>[key,String(value?.[key] || '').trim()]))
  return Object.values(result).some(Boolean)?result:undefined
}

// 用途：判断引用能否被选入申请，不将历史尾款申请解释为资格已通过。
// 参数：reference 为项目系统返回的权威资格及状态。
// 返回值：正常有资格或当前参与者被终止状态阻断时可选择，其他情况拒绝。
export function canSelectProjectReference(reference) {
  if (reference?.eligible === true) return true
  const reasons = reference?.reason_codes
  return reference?.participant_eligible === true && Array.isArray(reasons) && reasons.length > 0
    && reasons.every((code) => ['PROJECT_TERMINATED', 'SERVICE_ITEM_TERMINATED'].includes(code))
}

// 用途：把证据表单转换为有界文件引用，保留缺省空集合。
// 参数：value 为逗号分隔文件ID或已有文件ID数组。
// 返回值：最多20个去重ID，超限时抛出输入错误。
export function evidenceIDs(value) {
  const values = Array.isArray(value) ? value : String(value || '').split(',')
  const result = [...new Set(values.map((item) => String(item).trim()).filter(Boolean))]
  if (result.length > 20) throw new Error('每组费用证据最多20份')
  return result
}

// 用途：只构造明确人工确认字段，不能回传评估状态或把UNKNOWN改成MATCH。
// 参数：value 为用户选择的差旅人工决定。
// 返回值：明确决定及证据；未选择时为空，非法决定或依据不足时抛错。
function travelConfirmation(value) {
  if (!value?.decision) return null
  if (!['CONFIRMED_UNKNOWN', 'ACKNOWLEDGED_MISMATCH'].includes(value.decision)) {
    throw new Error('请选择明确的差旅人工确认类型')
  }
  const files = evidenceIDs(value.evidence_text ?? value.evidence_file_ids)
  if (!value.reason?.trim() || !files.length) throw new Error('差旅人工确认需要理由和证据')
  return { decision: value.decision, reason: value.reason.trim(), evidence_file_ids: files }
}

// 用途：按白名单编码费用可写字段，保留精确金额并剔除权威评估及引用资格。
// 参数：item 为费用编辑表单，含可选尾款原因、证据及人工差旅确认。
// 返回值：提交草稿的费用DTO；金额或证据非法时抛错。
export function editableClaimItem(item) {
  const result = {
    travel_declaration:travelInput(item.travel_declaration),
    ...(item.expense_nature ? {expense_nature:item.expense_nature}:{}),
    id: item.id, fee_type: item.fee_type, occurred_date: item.occurred_date,
    reason: item.reason, exception_reason: item.exception_reason, travel_exception: item.travel_exception,
    transport_category: item.transport_category || '', accommodation_category: item.accommodation_category || '',
    city_code: item.city_code || '', no_invoice_proof_type: item.no_invoice_proof_type || '',
    no_invoice_evidence_file_ids: evidenceIDs(item.no_invoice_evidence_text ?? item.no_invoice_evidence_file_ids),
    city_level: item.city_level, units: item.units, no_invoice_reason: item.no_invoice_reason,
    requested_minor: toMinor(item.amount), historical_tail_reason: item.historical_tail_reason || '',
    historical_tail_evidence_file_ids: evidenceIDs(
      item.historical_tail_evidence_text ?? item.historical_tail_evidence_file_ids),
    ...allocationInput(item),
    invoice_usages: (item.invoice_usages || []).map((row) => ({
      invoice_id: row.invoice_id, used_minor: toMinor(row.amount) })),
  }
  const confirmation = travelConfirmation(item.travel_confirmation)
  if (confirmation) result.travel_confirmation = confirmation
  return result
}
