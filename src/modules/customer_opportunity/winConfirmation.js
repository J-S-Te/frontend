import { formatBusinessDate, todayBusinessDate } from '../shared/utils/businessTime.js'

export const WIN_EVIDENCE_TYPES = Object.freeze([
  { value: 'PURCHASE_ORDER', label: '客户采购单' },
  { value: 'AWARD_NOTICE', label: '中标通知' },
  { value: 'CUSTOMER_CONFIRMATION', label: '客户书面确认' },
  { value: 'OTHER', label: '其他正式依据' },
])

// 用途：创建独立赢单证据表单，业务日期使用北京时间。
// 参数：无。
// 返回值：尚未填写依据和金额的本地表单。
export function createWinEvidenceForm() {
  return { evidence_type: 'CUSTOMER_CONFIRMATION', evidence_reference: '',
    confirmed_on: todayBusinessDate(), confirmed_amount: '', evidence_note: '' }
}

// 用途：按已确认模式构造互斥的赢单依据请求。
// 参数：mode 为服务端声明模式，form 为合同引用或嵌套证据表单。
// 返回值：可合入阶段变更及终态补全的 payload；非法字段抛出可读错误。
export function winConfirmationPayload(mode, form = {}) {
  if (mode === 'contract') {
    const reference = String(form.contract_ref || '').trim()
    if (!reference || reference.length > 64) throw new Error('请填写有效的合同编号。')
    return { contract_ref: reference }
  }
  if (mode !== 'local_evidence') throw new Error('当前赢单确认模式不可用，请刷新后重试。')
  const input = form.win_evidence || {}
  const evidence = Object.fromEntries(['evidence_type', 'evidence_reference', 'confirmed_on',
    'confirmed_amount', 'evidence_note'].map((field) => [field, String(input[field] || '').trim()]))
  const validType = WIN_EVIDENCE_TYPES.some(({ value }) => value === evidence.evidence_type)
  const validDay = /^\d{4}-\d{2}-\d{2}$/.test(evidence.confirmed_on)
    && formatBusinessDate(evidence.confirmed_on) === evidence.confirmed_on
    && evidence.confirmed_on <= todayBusinessDate()
  if (!validType || !evidence.evidence_reference || evidence.evidence_reference.length > 200
      || !evidence.evidence_note || evidence.evidence_note.length > 1000 || !validDay
      || !/^[0-9]{1,16}(\.[0-9]{1,2})?$/.test(evidence.confirmed_amount)) {
    throw new Error('请完整填写赢单依据，确认日期不能晚于今天，金额最多保留两位小数。')
  }
  return { win_evidence: evidence }
}
