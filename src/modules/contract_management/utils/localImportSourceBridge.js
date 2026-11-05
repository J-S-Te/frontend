// 用途：将普通导入行的本地引用投影给共享来源选择器，不改变原件和服务项身份。
// 参数：row为当前普通导入行，允许尚未选择任何来源。
// 返回值：选择器使用的来源表单；不在此推断CRM或本地权威。
export function importRowSourceForm(row) {
  if (!row) return null
  return {
    counterparty_source: row.counterpartySource || '',
    local_counterparty_id: row.localCounterpartyId || '',
    counterparty_version: row.counterpartyVersion || 0,
    category_source: row.categorySource || '',
    customer_id: row.crmCustomerId || '', customer_name: row.customerName || '',
    opportunity_id: row.opportunityId || '', opportunity_name: row.opportunityName || '',
    service_items: (row.serviceItems || []).map((item) => ({ ...item,
      source_id: item.sourceId || '', category_id: item.categoryId || '',
      category_version: item.categoryVersion || 0,
    })),
  }
}

// 用途：把来源选择结果合回原导入行，仅更新允许的客户及类别引用。
// 参数：row为原行，form为同一服务项清单的选择结果。
// 返回值：保留原件、业务键、金额和SourceID的新行；错位结果抛错。
export function applyImportRowSourceForm(row, form) {
  if (!row || !form || !Array.isArray(form.service_items)
    || form.service_items.length !== row.serviceItems.length) {
    throw new Error('服务项已变化，请重新选择本地来源。')
  }
  const result = { ...row }
  if (form.counterparty_source === 'LOCAL') {
    Object.assign(result, { counterpartySource: 'LOCAL', localCounterpartyId: form.local_counterparty_id,
      counterpartyVersion: form.counterparty_version, customerName: form.customer_name,
      crmCustomerId: '', opportunityId: '', opportunityName: '' })
  }
  if (form.category_source === 'LOCAL') {
    result.categorySource = 'LOCAL'
    result.serviceItems = row.serviceItems.map((item, index) => ({ ...item,
      category: form.service_items[index].category,
      categoryId: form.service_items[index].category_id,
      categoryVersion: form.service_items[index].category_version,
    }))
  }
  return result
}
