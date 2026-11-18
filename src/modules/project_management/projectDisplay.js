// 项目管理页面的展示层纯函数与常量：由 ProjectManagementView.vue 批次 3 第一步逐字迁移，
// 行为契约由 projectDisplay.test.mjs 固化；页面通过 import 继续以原绑定名使用。

// 业务时间一律走共享的北京口径工具：后端返回 RFC3339（UTC），浏览器时区五花八门，
// 直接 slice 或 toLocaleString 会取出 UTC 日历日 / 宿主机本地时间，导致跨零点显示错位。
import { normalizeStatusTone } from '../shared/theme/statusCatalog.js'
import { businessWallClockToInstant, formatBusinessDateTime, instantToBusinessWallClock } from '../shared/utils/businessTime.js'
import { escapeCsvCell } from '../platform/iam/utils/csvExport.js'

// 用途：以项目和系统名称标识服务项，统一工作台的主展示口径。
// 参数：item 为服务项快照；project 为对应的已授权项目快照。
// 返回值：项目名称与系统名称；缺失字段明确显示未提供，不用编号代替名称。
export function serviceItemLabel(item, project) {
  const projectName = String(project?.name || '').trim() || '未提供项目名称'
  const systemName = String(item?.system || '').trim() || '未提供系统名称'
  return `${projectName} · ${systemName}`
}

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

// 统一按北京口径展示：同一行里的时间不能一半是 UTC 日历日、一半是浏览器本地时间。
export function formatDateTime(value) {
  if (!value) return '—'
  return formatBusinessDateTime(value) || String(value)
}

export function selectedIDs(value) { return String(value || '').split(/[\s,，]+/).map((item) => item.trim()).filter(Boolean) }

// 后端保存 RFC3339（UTC），而 <input type="datetime-local"> 只接受本地时间的 YYYY-MM-DDTHH:mm。
// 直接把 ISO 串塞进输入框会被浏览器判为非法值并显示为空，导致再次编辑已有计划时时间"丢失"。
// 回填口径固定为北京墙钟（与提交侧 datetimeLocalToInstant 严格互为逆运算），不跟随浏览器时区。
export function toDateTimeLocal(value) {
  if (!value) return ''
  return instantToBusinessWallClock(value)
}

// 提交侧：datetime-local 里的取值按北京墙钟解释，再换算成 RFC3339（UTC）交给后端。
// 与 toDateTimeLocal 对称——同一个瞬间回填后再提交必须完全一致，不受浏览器时区影响。
export function datetimeLocalToInstant(value) {
  if (!value) return ''
  return businessWallClockToInstant(value)
}
// identityStatusLabel 把身份复核结果翻译成用户能读懂的状态。

export function newFieldOperationID(prefix) {
  const random = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return `${prefix}-${random}`
}

// 服务项状态色调：五档封闭语义（neutral / processing / success / warning / danger）。
// 具体色值只在 main.css 的 --status-* token 里；violet 只留给分类标签，不再表示状态。
// 撤销是可返工的中断而不是失败，落 warning；驳回/终止/冲突才落 danger。
export const statusToneMap = {
  // 需要人关注，但业务未失败
  待拆解确认: 'warning', 待确认: 'warning', 待复核: 'warning', 待处理: 'warning', 待评审: 'warning', PENDING: 'warning',
  整改中: 'warning', RECTIFYING: 'warning', 未生效: 'warning', NOT_YET_EFFECTIVE: 'warning',
  '已撤销，待重新制定': 'warning', 待重新制定: 'warning',
  // 已启动 / 推进中
  已分配: 'processing', 已审核: 'processing', 已签发: 'processing', 计划已发布: 'processing', REVIEWED: 'processing', ISSUED: 'processing',
  待实施: 'processing', 实施准备中: 'processing', 编制中: 'processing', 报告编制: 'processing', 准备中: 'processing', COMPILING: 'processing',
  实施中: 'processing',
  // 异常 / 失败
  异常处理中: 'danger', 已终止: 'danger', 已驳回: 'danger', REJECTED: 'danger', MISSING: 'danger', EXPIRED: 'danger',
  无效: 'danger', CONFLICT: 'danger', 能力冲突: 'danger', 排期冲突: 'danger', 阻断: 'danger', TERMINATE: 'danger',
  // 正向完成
  现场实施完成: 'success', 已完成: 'success', 已归档: 'success', ARCHIVED: 'success',
  已通过: 'success', APPROVED: 'success', PASSED: 'success', 校验通过: 'success', 启用: 'success', 有效: 'success', ACTIVE: 'success', 在公司: 'success',
  // 未开始 / 停用：保持中性
  待分配: 'neutral', 待制定计划: 'neutral', 停用: 'neutral', DISABLED: 'neutral', 未提交: 'neutral',
  待校验: 'neutral', 待排期: 'neutral', '不在公司（借出中）': 'neutral',
}

export function statusTone(status) {
  return normalizeStatusTone(statusToneMap[String(status ?? '').trim()] || 'neutral')
}

// 报告阶段（项目级 report_stage）与服务项报告状态共用同一套码值，
// 中文词表只维护这一份，页面不再各自复制。
export const reportStageLabel = Object.freeze({
  NONE: '待整改',
  RECTIFYING: '整改中',
  COMPILING: '编制中',
  REVIEWED: '已审核',
  ISSUED: '已签发',
  ARCHIVED: '已归档',
})

// 仅用于展示服务项自身进度，口径对应服务端 domain/project_status.go；
// 不由服务项推导项目状态，也不用于放行任何写操作。
const serviceItemDeliveryRank = Object.freeze({
  待确认: 0, 待复核: 0, 待分配: 1, 待实施: 2,
  实施准备中: 3, 实施中: 4, 异常处理中: 5, 现场实施完成: 6,
})
const serviceItemReportRank = Object.freeze({
  NONE: 0, RECTIFYING: 1, COMPILING: 2, REVIEWED: 3, ISSUED: 4, ARCHIVED: 5,
})

// 用途：读取服务项的独立报告阶段，避免回退后的历史值冒充当前进度。
// 参数：item 为服务端返回的当前服务项快照。
// 返回值：阶段名称、色调及展示顺序；缺失、未知或尚未进入报告阶段时顺序为 -1。
export function serviceItemReportStage(item) {
  const phase = String(item?.report_status ?? '').trim().toUpperCase()
  if (String(item?.status ?? '').trim() !== '现场实施完成') {
    return { label: '未进入报告阶段', tone: 'neutral', rank: -1 }
  }
  if (!Object.hasOwn(serviceItemReportRank, phase)) {
    return { label: phase ? `未知阶段（${phase}）` : '阶段未提供', tone: 'neutral', rank: -1 }
  }
  return { label: reportStageLabel[phase], tone: statusTone(phase), rank: serviceItemReportRank[phase] }
}

// 用途：统一队列与摘要的服务项主状态和报告阶段徽章。
// 参数：item 为当前服务项快照，不接受项目聚合状态代替服务项状态。
// 返回值：可直接渲染的徽章；报告阶段仅在现场完成后显示，未知值明确回显。
export function serviceItemStatusBadges(item) {
  const status = String(item?.status ?? '').trim()
  const badges = [{ key: 'status', label: status || '状态未提供', tone: statusTone(status) }]
  if (status === '现场实施完成') {
    const stage = serviceItemReportStage(item)
    badges.push({ key: 'report', label: `报告${stage.label}`, tone: stage.tone })
  }
  return badges
}

// 用途：按真实主状态展示交付进度，进入某阶段不代表该阶段已经完成。
// 参数：item 为当前服务项；待分配阶段额外核对团队与执行人员是否齐备。
// 返回值：七步只读进度；未知或终止状态不推断完成，无服务项时返回空数组。
export function serviceItemOperationSteps(item) {
  if (!item) return []
  const status = String(item.status ?? '').trim()
  const rank = Object.hasOwn(serviceItemDeliveryRank, status) ? serviceItemDeliveryRank[status] : -1
  let current = -1
  if (rank === 0) current = 0
  else if (rank === 1) {
    const assigned = item.project_manager_id && item.engineer_ids?.length
    current = !item.team_lead_id ? 1 : assigned ? 3 : 2
  } else if (rank === 2 || rank === 3) current = 4
  else if (rank === 4 || rank === 5) current = 5
  else if (rank === 6) current = 7

  return ['拆解确认', '分配至团队', '指派人员', '制定实施计划',
    '实施准备', '现场实施', '完成确认'].map((label, index) => ({
    label, state: index < current ? 'done' : index === current ? 'doing' : 'idle',
  }))
}

// 用途：随服务项报告阶段更新阶段链，归档后不再保留进行中标记。
// 参数：item 为含主状态及独立 report_status 的服务项快照。
// 返回值：整改至归档的五步进度；尚未进入报告或未知阶段时均为未完成。
export function serviceItemReportSteps(item) {
  const current = serviceItemReportStage(item).rank
  // 审核、签发和归档是已完成里程碑；整改和编制是进行态。
  const completedThrough = current >= serviceItemReportRank.REVIEWED ? current : current - 1
  return [
    { phase: 'RECTIFYING', label: '报告整改（可选）' },
    { phase: 'COMPILING', label: '报告编制' },
    { phase: 'REVIEWED', label: '报告审核' },
    { phase: 'ISSUED', label: '报告签发' },
    { phase: 'ARCHIVED', label: '报告归档' },
  ].map((step, index) => ({
    ...step,
    state: index + 1 <= completedThrough ? 'done'
      : index + 1 === current ? 'doing' : 'idle',
  }))
}

// 项目列表、看板与监控都通过这个函数取报告阶段文案：字段缺失或空值一律返回空串，
// 旧后端不返回 report_stage 时界面保持原样，前端不根据其它状态自行推断阶段。
export function projectReportStageLabel(project) {
  const stage = String(project?.report_stage ?? '').trim()
  return stage ? reportStageLabel[stage] || '' : ''
}

// 用途：按服务端项目状态确定进度列，现场阶段继续核对实际节点归属。
// 参数：project 为已授权项目；fieldProjects 为各现场节点的项目编号集合。
// 返回值：唯一列名称；未进入看板阶段或已回退的项目返回空串。
function implementationProgressKey(project, fieldProjects) {
  const status = String(project.status || '').trim()
  if (status === '已完成') return '已完成'
  if (['现场实施完成', '报告编制'].includes(status)) {
    const stage = String(project.report_stage || '').trim().toUpperCase()
    if (stage === 'RECTIFYING') return '整改中'
    if (status === '报告编制' || ['COMPILING', 'REVIEWED', 'ISSUED'].includes(stage)) {
      return '报告编制中'
    }
  }
  if (status === '实施准备中' && fieldProjects.prepared.has(project.id)) return '准备完成'
  if (status === '实施中' && fieldProjects.active.has(project.id)) return '现场实施'
  return ''
}

// 用途：生成实施进度五列，同一项目仅归入一个当前阶段。
// 参数：projects 为已授权项目快照；implementationItems 为既有现场节点筛选结果。
// 返回值：含真实项目卡片和项目数量的五列；空列仍保留。
export function implementationProgressColumns(projects, implementationItems) {
  const columns = [
    { key: '准备完成', color: 'violet', cards: [] },
    { key: '现场实施', color: 'amber', cards: [] },
    { key: '整改中', color: 'amber', cards: [] },
    { key: '报告编制中', color: 'blue', cards: [] },
    { key: '已完成', color: 'green', cards: [] },
  ]
  const fieldProjects = {
    prepared: new Set(implementationItems.filter(item => item.status === '实施准备中')
      .map(item => item.project_id)),
    active: new Set(implementationItems.filter(item => item.status === '实施中')
      .map(item => item.project_id)),
  }
  for (const project of projects) {
    const key = implementationProgressKey(project, fieldProjects)
    columns.find(column => column.key === key)?.cards.push(project)
  }
  return columns.map(column => ({ ...column, count: column.cards.length }))
}

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

// 服务项报告状态与项目报告阶段码值同源，沿用同一中文词表，避免两处文案漂移。
export const reportStatusLabel = reportStageLabel

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

// CSV 单元格转义：委托给平台统一实现，结构转义与公式前缀中和（= + - @ 及 TAB/CR 开头）
// 只维护一份，避免各导出入口行为漂移；纯数字（含负数）不加前缀，保持数值语义。
export function csvCell(value) {
  return escapeCsvCell(value)
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
// 角色码与后端 project_management/internal/application 的 assignmentRole* 常量逐字对齐；
// 渗透测试工程师与实施工程师在指派接口里共用 engineer_ids。
export const PROJECT_ROLE_CODES = Object.freeze({ teamLead: 'team_lead', projectManager: 'project_manager', engineer: 'engineer', penetrationEngineer: 'penetration_engineer' })

// 渗透专项只派给具备 PENETRATION_TEST 能力的人员：这与后端派工前置
// （application/penetration.go 的 penetrationCapabilityCode）同一口径。
// 能力码大小写不敏感；设备能力不能充当人员能力。
export function penetrationCapableUserIDs(capabilities = []) {
  const ids = new Set()
  for (const item of capabilities || []) {
    if (item?.resource_type !== 'PERSON') continue
    const capable = (item.codes || []).some((code) => String(code).toUpperCase() === 'PENETRATION_TEST')
    if (!capable) continue
    for (const id of [item.user_id, item.resource_id]) {
      if (id) ids.add(String(id))
    }
  }
  return ids
}

// 多角色候选合并：按角色顺序拼接并按人员 ID 去重；已保存但当前目录里查不到的 ID 补位，
// 避免编辑既有指派时被静默清空。
export function mergeRoleCandidates(personnelByRole = {}, roleCodes = [], selectedIDs = [], resolveName = () => '姓名解析中…') {
  const options = []
  const known = new Set()
  for (const roleCode of roleCodes || []) {
    for (const option of personnelByRole?.[roleCode] || []) {
      if (!option?.id || known.has(option.id)) continue
      known.add(option.id)
      options.push(option)
    }
  }
  for (const id of selectedIDs || []) {
    if (!id || known.has(id)) continue
    known.add(id)
    options.push({ id, name: resolveName(id) })
  }
  return options
}

// 渗透工作包的指派下拉候选取「实施工程师 ∪ 渗透测试工程师」：
// 后端 AssignExecutionTeam 按两角色合并校验 engineer_ids，前端只认单一角色会出现
// 「后端放行、UI 选不到」。仍按 PENETRATION_TEST 能力过滤，已保存的指派始终保留。
export function penetrationEngineerCandidates({ personnelByRole = {}, capabilities = [], selectedIDs = [], resolveName } = {}) {
  const qualified = penetrationCapableUserIDs(capabilities)
  const selected = new Set(selectedIDs || [])
  return mergeRoleCandidates(personnelByRole, [PROJECT_ROLE_CODES.engineer, PROJECT_ROLE_CODES.penetrationEngineer], selectedIDs, resolveName)
    .filter((option) => qualified.has(option.id) || selected.has(option.id))
}

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

// 监控页签把 report_stage:RECTIFYING 这样的复合键解析成列表/快照共用的查询参数；
// 普通页签仍按服务端派生状态过滤。report_stage 与状态筛选互斥，不能同时下发。
export function monitoringFilterQuery(filter) {
  const value = String(filter || '').trim()
  if (value.startsWith('report_stage:')) {
    return { status: '', report_stage: value.slice('report_stage:'.length) }
  }
  return { status: ['risk', ''].includes(value) ? '' : value }
}

// 监控状态分桶：整改中按报告阶段单独成桶，并从收尾归档里等量扣除，
// 避免同一项目既算“报告编制”又算“整改中”造成重复计数。
// 旧快照没有 report_stage_counts 时按 0 处理，分桶结果与改造前保持一致。
export function monitoringStatusBuckets(snapshot = {}) {
  const counts = snapshot?.status_counts || {}
  const stageCounts = snapshot?.report_stage_counts || {}
  const asCount = (value) => Number(value || 0) || 0
  const rectifying = asCount(stageCounts.NONE) + asCount(stageCounts.RECTIFYING)
  const closing = asCount(counts['现场实施完成']) + asCount(counts['报告编制'])
  const buckets = [
    { key: '推进中', tone: 'var(--pm-green)', statuses: ['待拆解确认', '待分配', '待实施', '实施准备中'] },
    { key: '实施中', tone: 'var(--pm-primary)', statuses: ['实施中'] },
    { key: '异常处理', tone: 'var(--pm-red)', statuses: ['异常处理中'] },
    { key: '整改中', tone: 'var(--pm-amber)', statuses: [], count: rectifying },
    { key: '收尾归档', tone: 'var(--pm-violet)', statuses: ['现场实施完成', '报告编制'], count: Math.max(0, closing - rectifying) },
    { key: '已终止', tone: 'var(--pm-gray)', statuses: ['已终止'] },
  ]
  const total = asCount(snapshot?.total) || 1
  return buckets
    .map((bucket) => ({
      ...bucket,
      count: bucket.count ?? bucket.statuses.reduce((sum, status) => sum + asCount(counts[status]), 0),
    }))
    .map((bucket) => ({ ...bucket, pct: Math.round((bucket.count / total) * 100) }))
    .filter((bucket) => bucket.count)
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
// 实施计划人员行保存的是能力档案编号（resource_id），而行程、姓名展示只认平台 user_id。
// 这里把实施人员的档案编号映射回平台 user_id（按档案编号或 user_id 命中均可），保持计划行序并去重；
// 映射结果限制在已指派团队内（后端行程校验只接受已指派人员），映射不到的行跳过。
export function planImplementerUserIDs(item, plan, capabilities = []) {
  const allowed = new Set(planPersonnelRows(item).map((row) => row.resourceID))
  if (!allowed.size) return []
  const userByResourceID = new Map()
  for (const capability of capabilities) {
    if (capability?.resource_type !== 'PERSON') continue
    const userID = String(capability.user_id || '').trim()
    if (!userID || !allowed.has(userID)) continue
    userByResourceID.set(String(capability.resource_id || '').trim(), userID)
  }
  const implementers = []
  for (const row of Array.isArray(plan?.personnel) ? plan.personnel : []) {
    const resourceID = String(row?.resource_id || '').trim()
    const userID = userByResourceID.get(resourceID) || (allowed.has(resourceID) ? resourceID : '')
    if (userID && !implementers.includes(userID)) implementers.push(userID)
  }
  return implementers
}
// 出行人员默认全选实施人员（可能多人）；实施计划尚未发布、或档案行都映射不到平台用户时，
// 回落到已指派团队全员，与未发布计划时的默认口径一致。
export function travelTravelerDefaults(item, plan, capabilities = []) {
  const assigned = planPersonnelRows(item).map((row) => row.resourceID)
  const implementers = planImplementerUserIDs(item, plan, capabilities)
  return implementers.length ? implementers : assigned
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
