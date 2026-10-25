// 项目管理页面的展示层纯函数与常量：由 ProjectManagementView.vue 批次 3 第一步逐字迁移，
// 行为契约由 projectDisplay.test.mjs 固化；页面通过 import 继续以原绑定名使用。

export function startOfWeek(date) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  d.setHours(0, 0, 0, 0)
  return d
}

export function dateKey(date) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function isoWeekOf(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const dayNum = (d.getUTCDay() + 6) % 7
  d.setUTCDate(d.getUTCDate() - dayNum + 3)
  const firstThursday = d.getTime()
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7) + 3)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  return Math.ceil(((firstThursday - yearStart) / 86400000 + 1) / 7)
}

export function formatDateTime(value) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString()
}

export function selectedIDs(value) { return String(value || '').split(/[\s,，]+/).map((item) => item.trim()).filter(Boolean) }

export function asRFC3339(value) { if (!value) return ''; const date = new Date(value); return Number.isNaN(date.getTime()) ? value : date.toISOString() }
// 后端保存 RFC3339（UTC），而 <input type="datetime-local"> 只接受本地时间的 YYYY-MM-DDTHH:mm。
// 直接把 ISO 串塞进输入框会被浏览器判为非法值并显示为空，导致再次编辑已有计划时时间"丢失"。

// 后端保存 RFC3339（UTC），而 <input type="datetime-local"> 只接受本地时间的 YYYY-MM-DDTHH:mm。
// 直接把 ISO 串塞进输入框会被浏览器判为非法值并显示为空，导致再次编辑已有计划时时间"丢失"。
export function toDateTimeLocal(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (part) => String(part).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}
// identityStatusLabel 把身份复核结果翻译成用户能读懂的状态。

export function newFieldOperationID(prefix) {
  const random = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return `${prefix}-${random}`
}

// 服务项状态色调：取自服务项自身状态，供状态分布表的徽标复用。
// 状态字段统一胶囊语义映射：所有状态渲染统一经 statusTone 取色调，
// 语义与 V1.1 原型 crm-badge 对齐（待处理=amber、推进=violet、进行=blue、完成=green、异常=red、停用=gray）。
export const statusToneMap = {
  待拆解确认: 'amber', 待确认: 'amber', 待复核: 'amber', 待处理: 'amber', 待评审: 'amber', PENDING: 'amber', 实施中: 'amber',
  待分配: 'blue', 已分配: 'blue', 已审核: 'blue', 已签发: 'blue', 计划已发布: 'blue', REVIEWED: 'blue', ISSUED: 'blue',
  待实施: 'violet', 实施准备中: 'violet', 编制中: 'violet', 报告编制: 'violet', 准备中: 'violet', COMPILING: 'violet',
  异常处理中: '风险', 已终止: '风险', 已驳回: '风险', REJECTED: '风险', MISSING: '风险', EXPIRED: '风险', 无效: '风险', CONFLICT: '风险', 能力冲突: '风险', 排期冲突: '风险', 阻断: '风险', TERMINATE: '风险',
  现场实施完成: 'green', 已完成: 'green', 已归档: 'green', ARCHIVED: 'green',
  已通过: 'normal', APPROVED: 'normal', PASSED: 'normal', 校验通过: 'normal', 启用: 'normal', 有效: 'normal', ACTIVE: 'normal', 在公司: 'normal',
  停用: 'neutral', DISABLED: 'neutral', 未生效: 'amber', NOT_YET_EFFECTIVE: 'amber', 未提交: 'neutral', 待校验: 'neutral', 待排期: 'neutral', '不在公司（借出中）': 'amber',
}

export function statusTone(status) { return statusToneMap[String(status ?? '').trim()] || 'neutral' }

export function capabilityEffectiveStatus(item) { return item?.effective_status || item?.status || 'DISABLED' }

export function capabilityStatusLabel(item) {
  return ({ ACTIVE: '有效', DISABLED: '停用', EXPIRED: '无效', NOT_YET_EFFECTIVE: '未生效' })[capabilityEffectiveStatus(item)] || capabilityEffectiveStatus(item)
}

// 各套真实配置表的列与编辑字段元数据。
export const fieldPermissionFieldOptions = Object.freeze([
  { value: 'name', label: '项目名称', description: '项目主档' },
  { value: 'customer', label: '客户名称', description: '项目主档、设备预约记录' },
  { value: 'contract', label: '合同编号', description: '项目主档' },
  { value: 'category', label: '检测类别', description: '项目主档、服务项及事件快照' },
  { value: 'team', label: '执行团队', description: '项目主档' },
  { value: 'manager', label: '项目经理（项目展示）', description: '项目主档展示字段' },
  { value: 'due', label: '计划完成时间', description: '项目主档' },
  { value: 'batch', label: '批次', description: '服务项及事件快照' },
  { value: 'site', label: '实施场所', description: '服务项、SLA 超期记录及事件快照' },
  { value: 'requirement', label: '技术要求', description: '服务项及事件快照' },
  { value: 'system', label: '系统名称', description: '服务项及事件快照' },
  { value: 'system_level', label: '系统等级', description: '服务项及事件快照' },
  { value: 'special', label: '特殊方法标记', description: '服务项及事件快照' },
  { value: 'test_mode', label: '测试模式', description: '服务项及事件快照' },
  { value: 'source_service_id', label: '合同服务项来源编号', description: '服务项及事件快照' },
  { value: 'team_lead_id', label: '团队负责人', description: '服务项指派关系及事件快照' },
  { value: 'project_manager_id', label: '项目经理（服务项指派）', description: '服务项指派关系及事件快照' },
  { value: 'engineer_ids', label: '工程师名单', description: '服务项指派关系及事件快照' },
])

export const fieldPermissionFieldLabel = Object.freeze(Object.fromEntries(fieldPermissionFieldOptions.map((option) => [option.value, option.label])))

export const fieldPermissionAccessLevelLabel = Object.freeze({ hidden: '隐藏', edit: '可编辑', view: '只读' })

export function permissionFieldLabel(fieldName) {
  const name = String(fieldName || '').trim()
  return fieldPermissionFieldLabel[name] || name || '—'
}

export const reportTechReviewLabel = (status) => ({ NONE: '未提交', PENDING: '待复核', APPROVED: '已通过', REJECTED: '已驳回' }[status] || '未提交')

// identityStatusLabel 把身份复核结果翻译成用户能读懂的状态。
export function identityStatusLabel(status) {
  if (status === 'ACTIVE') return '在职'
  if (status === 'MISSING') return '已离职/查无此人'
  return '未关联平台账号'
}

export function conflictStatusLabel(status) {
  if (status === 'PASSED') return '校验通过'
  if (status === 'CONFLICT') return '存在冲突'
  return '尚未校验'
}

export function ganttTone(status) {
  if (['异常处理中', '已终止'].includes(status)) return 'red'
  if (['现场实施完成', '报告编制', '已完成'].includes(status)) return 'green'
  if (['实施中', '实施准备中'].includes(status)) return 'amber'
  if (['待拆解确认', '待分配'].includes(status)) return 'gray'
  return ''
}

export function eventLabel(event) {
  // 事件名必须与后端 application/delivery.go 的常量逐字一致：曾把现场完成的事件名
  // 多写一层 IMPLEMENTATION 前缀，导致交付趋势/准时率按该名过滤时恒为空。
  return ({ CONTRACT_ACTIVATED: '合同生效并生成项目', CONTRACT_STAMP_STATUS_SYNCED: '盖章合同状态已同步', DECOMPOSITION_ADJUSTED: '服务项拆解已调整', DECOMPOSITION_RETURNED: '服务项已退回拆解确认', TEAM_ASSIGNED: '团队负责人已分配', EXECUTION_TEAM_ASSIGNED: '项目经理及工程师已指派', IMPLEMENTATION_PLANNED: '现场实施计划已发布', PREPARATION_STARTED: '实施准备已发起', FIELD_STARTED: '现场测评已开始', FIELD_RECORD_SUBMITTED: '现场记录已提交', FIELD_COMPLETED: '现场测评已结束', EQUIPMENT_RETURNED: '设备已归还', DEVIATION_REPORTED: '现场偏离已上报', DEVIATION_REVIEWED: '偏离评审已完成', SPECIAL_METHOD_REVIEWED: '特殊方法复核已完成', REPORT_STATUS_UPDATED: '报告阶段已推进', REPORT_CORRECTION_REQUESTED: '报告更正已申请', REPORT_CORRECTION_APPROVED: '报告更正已批准', REPORT_CORRECTION_REJECTED: '报告更正已驳回', WARNING_TRIGGERED: '预警规则已触发', AUTOMATION_TRIGGERED: '自动化动作已执行' })[event.type] || event.type
}

// 设备在位状态由占用时段派生：借出中显示占用方与时段，否则显示在公司。
export function equipmentPresenceLabel(item) {
  return item.presence === 'OUT_OF_COMPANY' ? '不在公司（借出中）' : '在公司'
}

export function contractOptionLabel(contract) {
  return `${contract.contract_number} · ${contract.title} · ${contract.customer_name || '未填写客户'}`
}

export function slaDueLabel(item) {
  const hours = Number(item.overdue_hours || 0)
  if (item.kind === 'STATUS_DEADLINE_APPROACHING') return `剩余 ${hours} 小时`
  return `已超期 ${hours} 小时`
}

// 维度取值与原型一致：维度 1 取清单/项目侧字段，维度 2/3 另可含服务项属性。
export const splitDimensionPrimaryOptions = [
  { value: 'batch', label: '批次（默认）' },
  { value: 'site', label: '场所' },
  { value: 'customer', label: '客户' },
  { value: 'contract', label: '合同' },
]

export const splitDimensionSecondaryOptions = [
  { value: 'category', label: '检测类别（默认）' },
  { value: 'system_standard', label: '体系要求' },
  { value: 'test_mode', label: '方法类型' },
]

export const splitDimensionAnyOptions = [...splitDimensionPrimaryOptions, ...splitDimensionSecondaryOptions]

export const splitDefaultStatusOptions = [
  { value: '待确认', label: '待确认（默认，业务员确认后→待分配）' },
  { value: '待分配', label: '待分配（跳过确认）' },
]

export const splitMissingRuleOptions = [
  { value: 'HUMAN_CONFIRM', label: '标记「待人工确认」并通知业务管理员（默认）' },
  { value: 'DEFAULT_RULE', label: '按默认规则生成' },
  { value: 'SILENT', label: '按默认规则生成（不通知，不推荐）' },
]

export const specialMethodOptions = [
  { value: 'NO', label: '否' },
  { value: 'MARKABLE', label: '可标记' },
  { value: 'REQUIRED', label: '必为特殊方法' },
]

export const specialMethodTone = { NO: 'neutral', MARKABLE: 'violet', REQUIRED: 'violet' }

export const specialMethodLabel = Object.fromEntries(specialMethodOptions.map((option) => [option.value, option.label]))

export const splitDimensionLabel = Object.fromEntries(splitDimensionAnyOptions.map((option) => [option.value, option.label.replace(/（默认）$/, '')]))

export function splitDimensionText(value) { return splitDimensionLabel[value] || value || '—' }

export function splitMissingRuleText(value) { return splitMissingRuleOptions.find((option) => option.value === value)?.label.replace(/（默认）|（不通知，不推荐）/, '') || value }

export function csvCell(value) {
  const text = String(value ?? '')
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function overrideMatchText(item) {
  const parts = []
  if (item.match_conditions?.customer_contains) parts.push(`客户名称包含 ${item.match_conditions.customer_contains}`)
  if (item.match_conditions?.contract_contains) parts.push(`合同号包含 ${item.match_conditions.contract_contains}`)
  if (item.match_conditions?.max_service_items) parts.push(`合同服务项数 ≤ ${item.match_conditions.max_service_items}`)
  if (item.match_conditions?.min_service_items) parts.push(`合同服务项数 ≥ ${item.match_conditions.min_service_items}`)
  if ((item.match_conditions?.categories || []).length) parts.push(`检测类别包含 ${item.match_conditions.categories.join(' / ')}`)
  return parts.join(' 且 ') || '—'
}

export function overrideSettingsText(item) {
  const settings = item.override_settings || {}
  const parts = []
  const dims = [settings.dimension_primary, settings.dimension_secondary, settings.dimension_tertiary].filter(Boolean)
  if (dims.length) parts.push(`分组维度 = ${dims.map(splitDimensionText).join(' + ')}`)
  if (settings.default_status) parts.push(`默认进入状态 = ${settings.default_status}`)
  if (settings.generate_requirement_summary === false) parts.push('技术要求摘要留空人工填写')
  if (settings.generate_requirement_summary === true) parts.push('生成技术要求摘要')
  if (settings.requirement_summary_locked === true) parts.push('技术要求摘要锁定')
  if (settings.missing_rule_action) parts.push(`缺规则处理 = ${splitMissingRuleText(settings.missing_rule_action)}`)
  if (settings.scope_change_detection === false) parts.push('范围变更检测关闭')
  return parts.join('；') || '—'
}

// 空字符串代表"不覆盖"，必须从载荷里剔除：服务端把非 null 的空串当成非法维度取值。

// 空字符串代表"不覆盖"，必须从载荷里剔除：服务端把非 null 的空串当成非法维度取值。
export function compactOverrideSettings(settings) {
  const compact = {}
  for (const [key, value] of Object.entries(settings || {})) {
    if (value === undefined || value === null || value === '') continue
    compact[key] = value
  }
  return compact
}

export function compactOverrideMatch(match) {
  const compact = {}
  for (const [key, value] of Object.entries(match || {})) {
    if (value === undefined || value === null || value === '') continue
    if (Array.isArray(value) && !value.length) continue
    compact[key] = value
  }
  return compact
}

// 人员的选中值是 ID、角色的选中值是角色码，因此选项命中键可指定（默认 id）。
export function multiSummary(values, options, placeholder, key = 'id') {
  const names = (values || []).map((value) => options.find((option) => option[key] === value)?.name || value)
  if (!names.length) return placeholder
  if (names.length <= 2) return names.join('、')
  return `${names.slice(0, 2).join('、')} 等 ${names.length} 项`
}

export function capabilityCodeKey(code) { return String(code || '').trim().toUpperCase() }

export function toggleCodeSelection(selection, update, code) {
  const selected = new Map(selection.map((value) => [capabilityCodeKey(value), value]))
  const key = capabilityCodeKey(code)
  if (selected.has(key)) selected.delete(key)
  else selected.set(key, code)
  update([...selected.values()])
}

// 分配候选必须同时满足：项目人员资质有效、平台身份有效、具备对应项目角色。
// 人员日期不限制派工；基础平台目录仍只用于新建资质时选择身份主体。
export const PROJECT_ROLE_CODES = Object.freeze({ teamLead: 'team_lead', projectManager: 'project_manager', engineer: 'engineer' })

export function monitoringServiceSummary(row) {
  return Object.entries(row.service_status_counts || {}).map(([status, count]) => `${status} ${count}`).join(' · ') || '无服务项'
}

export function monitoringResourceSummary(row) {
  const resource = row.resources || {}
  const equipmentRisk = resource.expired_equipment ? ` · 过期 ${resource.expired_equipment}` : ''
  const released = resource.released_equipment ? ` · 已释放 ${resource.released_equipment}` : ''
  return `负责人 ${resource.project_managers || 0} · 工程师 ${resource.engineers || 0} · 设备 ${resource.equipment || 0}${equipmentRisk}${released}`
}

export function monitoringSlaLabel(row) {
  const items = row.sla_items || []
  if (!items.length) return '正常'
  const overdue = items.filter((item) => item.kind !== 'STATUS_DEADLINE_APPROACHING')
  return overdue.length ? `超期 ${Math.max(...overdue.map((item) => Number(item.overdue_hours || 0)))}h` : `临近 ${items.length} 项`
}

// 实施计划的人员与设备清单：已发布的计划用保存下来的快照回填；首次制定时按服务项已指派的
// 团队与设备自动生成，业务用户只需调整使用时段或移除，不必手工重新挑一遍人和设备。
// 实施计划的人员清单：已发布的计划用保存下来的快照回填；首次制定时按服务项已指派的
// 团队自动生成，业务用户只需调整使用时段或移除。设备清单在「实施准备」阶段维护。
export function planPersonnelFor(item, plan) {
  const saved = Array.isArray(plan.personnel) ? plan.personnel : []
  if (saved.length) {
    return saved.map((row) => ({ resourceType: 'PERSON', resourceID: row.resource_id, windowStart: row.window_start || '', windowEnd: row.window_end || '', note: row.note || '' }))
  }
  return planPersonnelRows(item)
}
// 已指派的执行团队默认全员参与；团队负责人同样计入，避免计划里出现"没有负责人"的空档。

// 已指派的执行团队默认全员参与；团队负责人同样计入，避免计划里出现"没有负责人"的空档。
export function planPersonnelRows(item) {
  const personIDs = [item.team_lead_id, item.project_manager_id, ...(item.engineer_ids || [])].filter(Boolean)
  return [...new Set(personIDs)].map((id) => ({ resourceType: 'PERSON', resourceID: id, windowStart: '', windowEnd: '', note: '' }))
}
// 实施准备的设备清单：已登记的回填快照，未登记时留空由用户在准备阶段挑选。

// 实施准备的设备清单：已登记的回填快照，未登记时留空由用户在准备阶段挑选。
export function planEquipmentFor(plan) {
  const saved = Array.isArray(plan.equipment) ? plan.equipment : []
  return saved.map((row) => ({ resourceType: 'EQUIPMENT', resourceID: row.resource_id, windowStart: row.window_start || '', windowEnd: row.window_end || '', note: row.note || '' }))
}
// 清单行展示的名称/资质/有效期：优先取当前能力档案，档案缺失时回落到人员姓名缓存，
// 避免已停用资源在表单里显示成空白。

export function isEmbeddedPenetrationItem(item) {
  const category = String(item?.category || '').replace(/\s+/g, '')
  return String(item?.test_mode || '').toUpperCase() !== 'PENETRATION' && (category.includes('等保') || category.includes('等级保护'))
}

export function penetrationPackageLabel(item) {
  const pkg = item?.penetration_work_package
  if (!pkg) return '待进入实施计划确认'
  if (pkg.decision_status === 'PENDING') return '待与客户确认'
  if (pkg.decision_status === 'NOT_REQUIRED') return '不开展'
  if (pkg.execution_status === 'COMPLETED') return `测试已完成 · 报告${({ NONE: '未开始', DRAFTING: '编制中', SUBMITTED: '待审核', APPROVED: '已审核', ISSUED: '已签发', ARCHIVED: '已归档' })[pkg.report_status] || pkg.report_status}`
  return ({ NOT_STARTED: '确认开展 · 未开始', IN_PROGRESS: '测试中', CANCELLED: '已取消' })[pkg.execution_status] || '确认开展'
}

export function emptyAdjustItem() {
  return { sourceID: '', batch: '', site: '', category: '', system: '', systemLevel: '', requirement: '', testMode: 'STANDARD' }
}

export function emptyAdjustForm() {
  return { reason: '', supplementContractID: '', items: [emptyAdjustItem()] }
}

export function defaultConfigFieldValue(field) {
  if (field.field === 'roles' || field.field === 'automation-roles') return []
  if (field.key === 'access_level') return 'hidden'
  if (field.field === 'positive-integer') return '1'
  if (field.field === 'number') {
    if (field.key === 'deadline_hours') return 24
    if (field.key === 'remind_hours') return 4
    return field.min || 0
  }
  return ''
}
export const operationSectionLabel = (section) => ({
  allocation: '任务分配', inbox: '实施收件箱', planning: '现场实施计划制定', preparation: '实施准备',
  assignments: '匹配校验与冲突预警', methods: '特殊方法复核待办', qualifications: '资质与能力管理',
  exceptions: '偏离评审', reports: '报告与收尾', monitoring: '执行总览',
}[section] || '事项详情')
