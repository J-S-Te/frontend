// 用途：读取真实任职与有效费用档案交集中的可选组织，不用裸组织ID作为显示名。
// 参数：options为服务器当前本人草稿选项。
// 返回值：具有真实名称且拥有当前有效费用档案的任职组织。
export function draftOrganizations(options) {
  const profiles = options?.employee_profiles || []
  return (options?.organizations || []).filter((org) => org.id && org.name &&
    profiles.some((profile) => profile.org_id === org.id && profile.active !== false))
}

// 用途：按服务端草稿上下文或用户明确选择的真实任职派生唯一费用档案和线路。
// 参数：options为权威草稿选项，organizationID为用户明确选择的当前任职组织。
// 返回值：可用上下文或解释性阻断；不存在、无档案或歧义时不猜首条。
export function resolveDraftContext(options, organizationID = '') {
  const context = options?.draft_context || {}
  const blocked = (message) => ({ ready: false, org_id: '', route_type: '', message })
  if (!organizationID && context.status !== 'READY') {
    return blocked(context.message || '当前任职或费用档案尚未明确，请联系管理员核对。')
  }
  const orgID = organizationID || context.org_id
  const org = draftOrganizations(options).find((row) => row.id === orgID)
  if (!org) return blocked('当前组织不在本人有效任职范围内，请重新核对。')
  const profiles = (options.employee_profiles || []).filter((profile) =>
    profile.org_id === orgID && profile.active !== false)
  if (profiles.length !== 1 || !profiles[0].id ||
    !['TECHNICAL', 'SALES'].includes(profiles[0].route_type)) {
    return blocked('当前组织费用档案缺失或存在歧义，请联系管理员确认。')
  }
  return { ready: true, org_id: orgID, organization_name: org.name,
    route_type: profiles[0].route_type, employee_profile_id: profiles[0].id, message: '' }
}

// 用途：限定付款主体到当前费用组织，不把其他组织的主体设为默认。
// 参数：options为权威本人选项，orgID为已确认的当前费用组织。
// 返回值：当前组织可用且有业务名称的付款主体。
export function financeEntityChoices(options, orgID) {
  return (options?.finance_entities || []).filter((row) => row.active !== false &&
    row.name && Array.isArray(row.org_ids) && row.org_ids.includes(orgID))
}

// 用途：展示本人已审核收款档案的业务名称，缺名称时使用本人姓名和版本序号。
// 参数：options为当前本人草稿选项，包含申请人和已审核收款资料。
// 返回值：保留内部引用且不展示账户受控引用的业务选项。
export function payeeChoices(options) {
  const applicant = options?.applicant
  return (options?.payee_profiles || []).filter((row) => row.active !== false &&
    row.reviewed !== false && (!row.subject_id || row.subject_id === applicant?.id))
    .map((row, index) => ({ ...row,
      name: row.name || `${applicant?.name || '本人'}已审核收款资料 · ${row.version ? `v${row.version}` : `第${index + 1}份`}`,
    }))
}

// 用途：只允许报告编制及后续正常状态的本人有效项目进入普通报销草稿。
// 参数：reference为服务端当前权威项目引用。
// 返回值：当前参与资格、对象资格和阶段同时满足时为true。
export function normalProjectReference(reference) {
  return reference?.eligible === true && reference?.participant_eligible === true &&
    ['报告编制', '已完成'].includes(reference.project_status)
}

// 用途：用业务名称、现场、日期和状态标识项目服务项，不展示内部项目或服务项ID。
// 参数：reference为本次权威项目选项。
// 返回值：可读选项名称；缺少业务名称时明确待核对。
export function projectReferenceLabel(reference) {
  const dates = [reference?.planned_start, reference?.planned_end].filter(Boolean).join(' 至 ')
  return [reference?.project_name || '项目名称待核对', reference?.site ||
    (reference?.service_item_id ? '服务现场待核对' : '项目级'), dates,
  reference?.project_status || '项目状态待核对', reference?.service_item_status].filter(Boolean).join(' · ')
}
