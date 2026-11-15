const inputKeys = ['kind','cost_category','organization_id','organization_witness_id','identity_id',
  'project_id','service_item_id','contract_snapshot_id','currency','tax_basis','occurred_date',
  'recognition_date','evidence_reference','note','source_system','source_environment','source_fact_id',
  'source_claim_id','source_effect_id','source_item_id','source_allocation_key','prepayment_basis','original_id']

// 用途：将最多两位小数金额转为精确安全整数分，拒绝隐式浮点舍入。
// 参数：value为用户输入的原币种金额文本。
// 返回值：安全整数分；超限、负数或格式非法抛出中文错误。
export function recognitionMinor(value) {
  const text=String(value??'').trim()
  if(!/^\d+(\.\d{1,2})?$/.test(text)) throw new Error('金额须为非负数，最多两位小数')
  const [whole,fraction='']=text.split('.')
  const minor=BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0'))
  if(minor>9007199254740991n) throw new Error('金额超过精确计算上限')
  return Number(minor)
}

// 用途：仅提交服务端白名单业务字段，保留日期与税基独立含义。
// 参数：form为完整表单，金额采用原币种小数文本。
// 返回值：不含审批状态、租户或操作者的真实输入。
export function recognitionInput(form) {
  const result=Object.fromEntries(inputKeys.map(key=>[key,form[key]??'']))
  result.amount_minor=recognitionMinor(form.amount)
  result.tax_minor=recognitionMinor(form.tax??'0')
  if(!['EXCLUSIVE','INCLUSIVE'].includes(result.tax_basis)) throw new Error('必须明确含税或未税口径')
  if(result.tax_basis==='INCLUSIVE' && result.tax_minor>result.amount_minor ||
    result.tax_basis==='EXCLUSIVE' && result.amount_minor>Number.MAX_SAFE_INTEGER-result.tax_minor) {
    throw new Error('税额与金额不守恒或超过精确计算上限')
  }
  const net=result.tax_basis==='INCLUSIVE'?result.amount_minor-result.tax_minor:result.amount_minor
  if(net===0 && (!result.original_id || result.tax_minor<=0)) {
    throw new Error('新确认须有正净额；仅关联原确认的冲回可登记零净额正税额')
  }
  return result
}

// 用途：在界面呈现登记、提交与复核人分离，服务端仍独立复核。
// 参数：record为当前记录，actor为可信当前会话用户标识。
// 返回值：当前用户是否可以尝试独立审核。
export function canReviewRecognition(record,actor) {
  return !!actor && record.status==='SUBMITTED' && record.created_by!==actor && record.submitted_by!==actor
}

// 用途：从完整权威历史选择尚未冲正付款对应的冻结费用，不把重付当新费用。
// 参数：result为候选业务响应，blocked标识未处置冲正差异。
// 返回值：可供登记选择的费用项；未知或差异阻断返回空列表。
export function recognitionCandidateRows(result) {
  if(result?.blocked || result?.claim?.status!=='KNOWN') return []
  const claim=result.claim
  const reversed=new Set(claim.effects.filter(effect=>effect.kind==='PAYMENT_FULLY_REVERSED').map(effect=>effect.reverses_effect_id))
  return claim.effects.filter(effect=>effect.kind==='PAYMENT_RECORDED' && !reversed.has(effect.effect_id))
    .flatMap(effect=>claim.frozen_items.filter(item=>item.approved_content_hash===effect.approved_content_hash)
      .map(item=>({...item,effect_id:effect.effect_id})))
}

// 用途：以固定整数格式展示最小币种金额，不进行币种换算。
// 参数：minor为服务端安全整数分。
// 返回值：两位小数金额文本。
export function recognitionAmount(minor) {
  const amount=BigInt(minor??0),negative=amount<0n,value=negative?-amount:amount
  return `${negative?'-':''}${value/100n}.${String(value%100n).padStart(2,'0')}`
}
