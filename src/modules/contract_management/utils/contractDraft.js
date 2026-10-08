// Capability is calculated by the backend from tenant, role, ownership and state.
// Do not infer edit rights from a display name or a broad list-read permission.
export function canEditContractDraft(contract) {
  return contract?.status === 'draft' && contract?.can_edit_draft === true
}

export function hydrateContractDraft(contract) {
  if (!canEditContractDraft(contract)) throw new Error('当前合同不可编辑，请刷新后确认权限及草稿状态。')
  const value = (key) => String(contract[key] ?? '')
  const items = Array.isArray(contract.service_items) ? contract.service_items : []
  return {
    title: value('title'), contract_type: value('contract_type'),
    opportunity_id: value('opportunity_id'), opportunity_name: value('opportunity_name'),
    customer_id: contract.crm_customer_id ? String(contract.crm_customer_id) : '',
    customer_name: value('customer_name'), customer_address: value('customer_address'),
    customer_contact: value('customer_contact'), customer_phone: value('customer_phone'),
    amount: Number(contract.amount_minor || 0) / 100, currency: value('currency') || 'CNY',
    start_date: value('start_date').slice(0, 10), end_date: value('end_date').slice(0, 10),
    template_id: value('template_id'), template_values: { ...(contract.template_values || {}) },
    service_items: items.map((item) => ({
      source_id: String(item.source_id || ''), service_type: String(item.service_type || ''),
      name: String(item.name || ''), site: String(item.site || ''), batch: String(item.batch || ''),
      category: String(item.category || ''), requirement: String(item.requirement || ''),
      test_mode: String(item.test_mode || 'STANDARD'),
      systems: (item.systems || []).map((system) => ({ name: String(system.name || ''), level: String(system.level || '') })),
    })),
  }
}

export async function saveContractDraft({ contractId, version, payload, updateDraft, submitApproval, submit, onSaved }) {
  if (!contractId || !Number.isSafeInteger(version) || version < 1) throw new Error('草稿版本无效，请重新载入合同。')
  const saved = await updateDraft(contractId, { ...payload, expected_version: version })
  if (saved?.id !== contractId || !Number.isSafeInteger(saved.version) || saved.version <= version || saved.status !== 'draft') {
    throw Object.assign(new Error('保存结果不完整，请重新载入草稿确认最新状态，勿重复提交。'), { requiresReload: true })
  }
  // Update the UI's version before submission: a failed submission must never
  // cause a retry to overwrite the successfully saved revision with stale data.
  onSaved(saved)
  const approval = submit ? await submitApproval(contractId, { expected_version: saved.version }) : null
  return { saved, approval }
}
