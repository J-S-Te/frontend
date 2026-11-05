export const NATIVE_EVIDENCE_TYPES = [
  { value: 'OFFLINE_DOCUMENT', label: '线下业务单据' },
  { value: 'PURCHASE_ORDER', label: '客户采购单' },
  { value: 'CUSTOMER_CONFIRMATION', label: '客户书面确认' },
  { value: 'OTHER', label: '其他正式依据' },
]

// 用途：提供可编辑的本地依据初始值，客户引用等待服务端登记后选择。
// 参数：today 为中国业务日期。
// 返回值：独立表单对象，不预设任何合同或CRM身份。
export function createNativeFinancialForm(today) {
  return { customer_key: '', document_no: '', currency: 'CNY', amount: '',
    effective_date: today, evidence_type: 'OFFLINE_DOCUMENT', evidence_reference: '',
    evidence_note: '', reason: '',
    payment_terms: [{ installment_no: 1, due_date: today, amount: '' }] }
}

// 用途：校验受数据库精度约束的正金额并转换成整数分，避免浮点差额。
// 参数：value 为表单金额。
// 返回值：BigInt分值；不合法时抛出可读错误。
function cents(value) {
  const raw = String(value || '').trim()
  if (!/^[0-9]{1,16}(\.[0-9]{1,2})?$/.test(raw)) throw new Error('金额须为最多两位小数的正数')
  const [whole, fraction = ''] = raw.split('.')
  const result = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'))
  if (result <= 0n) throw new Error('金额必须大于零')
  return result
}

// 用途：拒绝浏览器能表示但业务日期不合法的输入。
// 参数：raw 为YYYY-MM-DD字段。
// 返回值：规范日期；非法日期抛出错误。
function dateValue(raw) {
  const value = String(raw || '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.slice(0, 4) < '1000') throw new Error('日期不合法')
  const date = new Date(`${value}T00:00:00Z`)
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new Error('日期不合法')
  return value
}

// 用途：只构造明确本地来源的财务命令并检查分期精确合计。
// 参数：form 为表单，today 为中国业务日期。
// 返回值：服务端接收的白名单字段；校验失败抛出可读错误。
export function nativeFinancialPayload(form, today) {
  const fields = ['customer_key', 'document_no', 'currency', 'amount', 'effective_date',
    'evidence_type', 'evidence_reference', 'evidence_note', 'reason']
  const input = Object.fromEntries(fields.map((key) => [key, String(form?.[key] || '').trim()]))
  input.currency = input.currency.toUpperCase()
  if (!/^settlement_local:[A-F0-9]{32}$/.test(input.customer_key)) throw new Error('请选择已登记的本地客户')
  if (!/^[A-Z]{3}$/.test(input.currency)) throw new Error('请输入三位币种代码')
  if (!NATIVE_EVIDENCE_TYPES.some(({ value }) => value === input.evidence_type)) throw new Error('请选择正式依据类型')
  for (const [key, limit] of [['document_no', 128], ['evidence_reference', 200], ['evidence_note', 1000], ['reason', 500]]) {
    if ((key !== 'document_no' && !input[key]) || [...input[key]].length > limit || input[key].includes('\0')) throw new Error('请填写完整且长度合法的依据与原因')
  }
  input.effective_date = dateValue(input.effective_date)
  if (input.effective_date > today) throw new Error('生效日期不能晚于今天')
  const total = cents(input.amount)
  if (!Array.isArray(form.payment_terms) || !form.payment_terms.length || form.payment_terms.length > 100) throw new Error('分期数须为1至100')
  const seen = new Set()
  let sum = 0n
  input.payment_terms = form.payment_terms.map((term) => {
    const number = Number(term.installment_no)
    if (!Number.isSafeInteger(number) || number < 1 || seen.has(number)) throw new Error('分期编号必须为不同的正整数')
    seen.add(number)
    sum += cents(term.amount)
    return { installment_no: number, due_date: dateValue(term.due_date), amount: String(term.amount).trim() }
  })
  if (sum !== total) throw new Error('分期金额合计必须等于依据总额')
  return input
}
