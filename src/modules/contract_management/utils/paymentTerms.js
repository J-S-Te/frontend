const maximumMinor = BigInt(Number.MAX_SAFE_INTEGER)

export function paymentAmountMinor(value) {
  const text = String(value ?? '').trim()
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) throw new Error('金额必须是非负数，最多两位小数。')
  const [whole, fraction = ''] = text.split('.')
  const minor = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'))
  if (minor > maximumMinor) throw new Error('金额超出可安全提交的范围。')
  return Number(minor)
}

export function normalizePaymentTerms(terms, amount, currency) {
  if (!Array.isArray(terms)) throw new Error('付款计划格式不合法。')
  if (!terms.length) return []
  const totalMinor = paymentAmountMinor(amount)
  if (totalMinor <= 0 || terms.length > 100) throw new Error('合同金额必须大于零，付款计划最多100期。')
  if (!/^[A-Z]{3}$/.test(String(currency ?? '').trim().toUpperCase())) throw new Error('币种必须是三位字母代码。')
  const seen = new Set()
  let sum = 0n
  const result = terms.map((term) => {
    const installmentNo = Number(term.installment_no)
    if (!Number.isInteger(installmentNo) || installmentNo < 1 || installmentNo > 100 || seen.has(installmentNo)) throw new Error('分期号必须为1至100且不能重复。')
    seen.add(installmentNo)
    const dueDate = String(term.due_date ?? '').trim()
    const date = /^\d{4}-\d{2}-\d{2}$/.test(dueDate) ? new Date(`${dueDate}T00:00:00Z`) : null
    if (!date || Number.isNaN(date.getTime()) || Number(dueDate.slice(0, 4)) < 1000 || date.toISOString().slice(0, 10) !== dueDate) throw new Error(`第${installmentNo}期到期日不合法。`)
    const minor = BigInt(paymentAmountMinor(term.amount))
    if (minor <= 0n) throw new Error(`第${installmentNo}期金额必须大于零。`)
    sum += minor
    return { installment_no: installmentNo, due_date: dueDate, amount: `${minor / 100n}.${String(minor % 100n).padStart(2, '0')}` }
  })
  if (sum !== BigInt(totalMinor)) throw new Error('付款计划合计必须等于合同金额；修改金额后请同时调整分期。')
  return result.sort((left, right) => left.installment_no - right.installment_no)
}
