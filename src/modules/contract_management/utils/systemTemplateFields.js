// The server generates these identifiers at approval. Never submit user overrides.
export function isSystemContractNumberField(field) {
  return ['系统合同编号', '合同编号'].includes(String(field?.name || '').trim())
}

export function isContractAmountField(field) {
  return ['合同金额', 'contract_amount'].includes(String(field?.name || '').trim())
}

export function synchronizeContractTemplateValues(fields, values, amount) {
  const result = { ...values }
  for (const field of fields || []) {
    if (isSystemContractNumberField(field)) delete result[field.name]
    else if (isContractAmountField(field)) result[field.name] = String(amount ?? '').trim()
  }
  return result
}
