import assert from 'node:assert/strict'
import test from 'node:test'
import {
  PROJECT_ROLE_CODES,
  capabilityCodeKey,
  compactOverrideMatch,
  compactOverrideSettings,
  csvCell,
  datetimeLocalToInstant,
  defaultConfigFieldValue,
  emptyAdjustForm,
  eventLabel,
  formatDateTime,
  monitoringFilterQuery,
  monitoringSlaLabel,
  monitoringStatusBuckets,
  multiSummary,
  planEquipmentFor,
  planPersonnelFor,
  planPersonnelRows,
  projectReportStageLabel,
  reportStageLabel,
  reportStatusLabel,
  selectedIDs,
  slaDueLabel,
  startOfWeek,
  dateKey,
  isoWeekOf,
  statusTone,
  toDateTimeLocal,
  toggleCodeSelection,
  capabilityEffectiveStatus,
} from './projectDisplay.js'

test('时间换算在 RFC3339 与 datetime-local 之间正确往返', () => {
  const local = toDateTimeLocal('2026-10-22T01:00:00Z')
  assert.match(local, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
  // 业务墙钟固定为北京时间（UTC+8），与宿主机时区无关：镜像构建在 UTC 容器内执行，
  // 不能再用 new Date(localString) 依赖运行时本地时区来解释这个字符串。
  assert.equal(local, '2026-10-22T09:00')
  assert.equal(datetimeLocalToInstant(local), '2026-10-22T01:00:00.000Z')
  assert.equal(toDateTimeLocal(''), '')
  assert.equal(toDateTimeLocal('不是时间'), '')
})

test('datetime-local 回填与提交按北京墙钟严格对称（UTC+8，不受宿主机时区影响）', () => {
  // 北京凌晨窗口：UTC 还是前一天，但业务日历日与墙钟都必须是北京这一侧。
  assert.equal(toDateTimeLocal('2026-10-21T16:30:00Z'), '2026-10-22T00:30')
  assert.equal(datetimeLocalToInstant('2026-10-22T00:30'), '2026-10-21T16:30:00.000Z')
  assert.equal(datetimeLocalToInstant(toDateTimeLocal('2026-10-21T16:30:00Z')), '2026-10-21T16:30:00.000Z')
  for (const instant of ['2026-01-01T00:00:00.000Z', '2026-10-21T15:59:00.000Z', '2026-10-21T16:00:00.000Z', '2026-12-31T23:59:00.000Z']) {
    assert.equal(datetimeLocalToInstant(toDateTimeLocal(instant)), instant, `${instant} 往返必须一致`)
  }
  assert.equal(datetimeLocalToInstant(''), '')
  assert.equal(datetimeLocalToInstant('不是时间'), '')
})

test('formatDateTime 统一按北京口径展示，非法入参回退原文', () => {
  assert.equal(formatDateTime('2026-10-21T16:30:00Z'), '2026-10-22 00:30')
  assert.equal(formatDateTime(''), '—')
  assert.equal(formatDateTime(null), '—')
  assert.equal(formatDateTime('不是时间'), '不是时间')
})

test('周边日期工具输出周一锚点、日期键与 ISO 周数', () => {
  const monday = startOfWeek(new Date(2026, 9, 21)) // 周三
  assert.equal(monday.getDay(), 1)
  assert.equal(dateKey(new Date(2026, 9, 5)), '2026-10-05')
  assert.equal(isoWeekOf(new Date(Date.UTC(2026, 0, 1))), 1)
})

test('selectedIDs 兼容中英文分隔符并丢弃空白项', () => {
  assert.deepEqual(selectedIDs('a, b，c  d'), ['a', 'b', 'c', 'd'])
  assert.deepEqual(selectedIDs(''), [])
  assert.deepEqual(selectedIDs(null), [])
})

test('statusTone 提供统一的语义胶囊色调，未知状态回落 neutral', () => {
  assert.equal(statusTone('实施中'), 'amber')
  assert.equal(statusTone('整改中'), 'amber')
  assert.equal(statusTone('RECTIFYING'), 'amber')
  assert.equal(statusTone('已签发'), 'blue')
  assert.equal(statusTone('已完成'), 'green')
  assert.equal(statusTone('REJECTED'), '风险')
  assert.equal(statusTone('未知状态'), 'neutral')
  assert.equal(statusTone(' 待处理 '), 'amber')
})

test('报告阶段中文词表唯一，旧后端缺字段时返回空串', () => {
  assert.deepEqual({ ...reportStageLabel }, {
    NONE: '待整改',
    RECTIFYING: '整改中',
    COMPILING: '编制中',
    REVIEWED: '已审核',
    ISSUED: '已签发',
    ARCHIVED: '已归档',
  })
  // 服务项报告状态与项目报告阶段共用同一份中文词表，避免两处文案漂移。
  assert.equal(reportStatusLabel, reportStageLabel)
  assert.equal(projectReportStageLabel({ report_stage: 'RECTIFYING' }), '整改中')
  assert.equal(projectReportStageLabel({ report_stage: 'NONE' }), '待整改')
  assert.equal(projectReportStageLabel({ report_stage: 'ARCHIVED' }), '已归档')
  // 旧后端没有 report_stage、空串或未知码都不显示，也不能从项目状态自行推断。
  assert.equal(projectReportStageLabel({}), '')
  assert.equal(projectReportStageLabel({ report_stage: '' }), '')
  assert.equal(projectReportStageLabel({ report_stage: '   ' }), '')
  assert.equal(projectReportStageLabel({ report_stage: 'UNKNOWN' }), '')
  assert.equal(projectReportStageLabel(null), '')
})

test('监控页签把 report_stage 前缀解析为互斥查询参数', () => {
  assert.deepEqual(monitoringFilterQuery('report_stage:RECTIFYING'), { status: '', report_stage: 'RECTIFYING' })
  assert.deepEqual(monitoringFilterQuery('report_stage:COMPILING'), { status: '', report_stage: 'COMPILING' })
  // 普通页签继续按派生状态过滤；风险与全部不带状态。
  assert.deepEqual(monitoringFilterQuery('实施中'), { status: '实施中' })
  assert.deepEqual(monitoringFilterQuery('报告编制'), { status: '报告编制' })
  assert.deepEqual(monitoringFilterQuery('risk'), { status: '' })
  assert.deepEqual(monitoringFilterQuery(''), { status: '' })
})

test('监控状态分桶：整改中单独计数并从收尾归档扣除，旧快照缺字段不报错', () => {
  // 报告编制 10 个里有 3 个待整改 + 4 个整改中，收尾归档必须只保留剩下的 3 个，
  // 否则同一项目会在“整改中”和“收尾归档”里各算一次。
  const mix = monitoringStatusBuckets({
    total: 15,
    status_counts: { 现场实施完成: 5, 报告编制: 10 },
    report_stage_counts: { NONE: 3, RECTIFYING: 4, COMPILING: 3 },
  })
  const byKey = Object.fromEntries(mix.map((bucket) => [bucket.key, bucket]))
  assert.equal(byKey['整改中'].count, 7)
  assert.equal(byKey['收尾归档'].count, 8)
  assert.equal(byKey['整改中'].tone, 'var(--pm-amber)')
  // 15 个项目的分桶互不重叠，合计必须回到快照总数。
  assert.equal(mix.reduce((sum, bucket) => sum + bucket.count, 0), 15)

  // 旧后端快照没有 report_stage_counts：不出现整改中分桶，收尾归档保持原口径。
  const legacy = monitoringStatusBuckets({
    total: 15,
    status_counts: { 现场实施完成: 5, 报告编制: 10 },
  })
  const legacyKeys = legacy.map((bucket) => bucket.key)
  assert.equal(legacyKeys.includes('整改中'), false)
  assert.equal(legacy.find((bucket) => bucket.key === '收尾归档').count, 15)

  // 扣除后不能出现负数；完全被整改中覆盖时收尾归档分桶直接隐藏。
  const covered = monitoringStatusBuckets({
    total: 5,
    status_counts: { 报告编制: 2 },
    report_stage_counts: { NONE: 2, RECTIFYING: 3 },
  })
  assert.equal(covered.find((bucket) => bucket.key === '收尾归档'), undefined)
  assert.equal(covered.find((bucket) => bucket.key === '整改中').count, 5)

  // 缺字段、空对象或非法计数都按 0 处理，不抛错。
  assert.deepEqual(monitoringStatusBuckets(), [])
  assert.deepEqual(monitoringStatusBuckets({}), [])
  assert.deepEqual(monitoringStatusBuckets(null), [])
  const malformed = monitoringStatusBuckets({ status_counts: { 实施中: '2' }, report_stage_counts: { RECTIFYING: null } })
  assert.equal(malformed.find((bucket) => bucket.key === '实施中').count, 2)
})

test('能力生效状态与编码键统一大写并容忍空白', () => {
  assert.equal(capabilityEffectiveStatus({ effective_status: 'NOT_YET_EFFECTIVE' }), 'NOT_YET_EFFECTIVE')
  assert.equal(capabilityEffectiveStatus({ status: 'ACTIVE' }), 'ACTIVE')
  assert.equal(capabilityEffectiveStatus({}), 'DISABLED')
  assert.equal(capabilityCodeKey(' pen-test '), 'PEN-TEST')
  assert.equal(capabilityCodeKey(''), '')
})

test('toggleCodeSelection 按规范化键切换且保留原编码写法', () => {
  const seen = []
  toggleCodeSelection(['PEN-TEST'], (values) => seen.push(values), 'pen-test')
  assert.deepEqual(seen[0], [])
  toggleCodeSelection(['PEN-TEST'], (values) => seen.push(values), 'EV-1')
  assert.deepEqual(seen[1], ['PEN-TEST', 'EV-1'])
})

test('CSV 单元格对逗号、引号与换行加引号转义', () => {
  assert.equal(csvCell('plain'), 'plain')
  assert.equal(csvCell('a,b'), '"a,b"')
  assert.equal(csvCell('say "hi"'), '"say ""hi"""')
  assert.equal(csvCell('line\nbreak'), '"line\nbreak"')
  assert.equal(csvCell(null), '')
})

// F-03：项目 CSV 导出复用平台 csvExport 的公式前缀中和，避免姓名/备注等自由文本在
// Excel/LibreOffice 中被当作公式执行；纯数字（含负数）保持数值语义不加前缀。
test('CSV 单元格中和公式前缀并豁免纯数字 [F-03 回归]', () => {
  assert.equal(csvCell('=1+2'), "'=1+2")
  assert.equal(csvCell('+SUM(A1)'), "'+SUM(A1)")
  assert.equal(csvCell('-2+3'), "'-2+3")
  assert.equal(csvCell('@cmd'), "'@cmd")
  assert.equal(csvCell('\tpayload'), "'\tpayload")
  // 回车同时命中断行结构转义：加引号后再净化为文本。
  assert.equal(csvCell('\rpayload'), `"'\rpayload"`)
  assert.equal(csvCell('-100'), '-100')
  assert.equal(csvCell('42'), '42')
  assert.equal(csvCell('0.5'), '0.5')
  assert.equal(csvCell('张三'), '张三')
  assert.equal(csvCell('检测类别'), '检测类别')
  assert.equal(csvCell('=a,b'), '"\'=a,b"')
})

test('多选摘要：空回落占位、两项内逐个列出、更多则收敛计数', () => {
  const options = [{ id: '1', name: '甲' }, { id: '2', name: '乙' }, { id: '3', name: '丙' }]
  assert.equal(multiSummary([], options, '待选择'), '待选择')
  assert.equal(multiSummary(['1'], options, '待选择'), '甲')
  assert.equal(multiSummary(['1', '2'], options, '待选择'), '甲、乙')
  assert.equal(multiSummary(['1', '2', '3', '9'], options, '待选择'), '甲、乙 等 4 项')
})

test('实施计划人员行按已保存清单回填，缺省时按指派团队全员展开', () => {
  const saved = [{ resource_id: 'u1', window_start: '2026-10-22', window_end: '2026-10-23', note: '主测' }]
  assert.deepEqual(planPersonnelFor({}, { personnel: saved }), [
    { resourceType: 'PERSON', resourceID: 'u1', windowStart: '2026-10-22', windowEnd: '2026-10-23', note: '主测' },
  ])
  const item = { team_lead_id: 'lead', project_manager_id: 'pm', engineer_ids: ['e1', 'lead'] }
  assert.deepEqual(planPersonnelRows(item), [
    { resourceType: 'PERSON', resourceID: 'lead', windowStart: '', windowEnd: '', note: '' },
    { resourceType: 'PERSON', resourceID: 'pm', windowStart: '', windowEnd: '', note: '' },
    { resourceType: 'PERSON', resourceID: 'e1', windowStart: '', windowEnd: '', note: '' },
  ])
  assert.deepEqual(planEquipmentFor({ equipment: [{ resource_id: 'EQ-1' }] }), [
    { resourceType: 'EQUIPMENT', resourceID: 'EQ-1', windowStart: '', windowEnd: '', note: '' },
  ])
  assert.deepEqual(planPersonnelFor({}, {}), planPersonnelRows({}))
})

test('覆盖设置的空串/空数组剔除逻辑保持服务端口径', () => {
  assert.deepEqual(compactOverrideSettings({ a: 'x', b: '', c: null, d: undefined }), { a: 'x' })
  assert.deepEqual(compactOverrideMatch({ codes: ['A'], empty: [], skip: '', keep: 1 }), { codes: ['A'], keep: 1 })
})

test('配置字段默认值按字段类型给值，权限字段默认隐藏', () => {
  assert.deepEqual(defaultConfigFieldValue({ field: 'roles' }), [])
  assert.equal(defaultConfigFieldValue({ key: 'access_level' }), 'hidden')
  assert.equal(defaultConfigFieldValue({ field: 'number', key: 'deadline_hours' }), 24)
  assert.equal(defaultConfigFieldValue({ field: 'number', min: 5 }), 5)
  assert.equal(defaultConfigFieldValue({ field: 'text' }), '')
})

test('SLA 超期与临近超期使用不同文案口径', () => {
  assert.equal(slaDueLabel({ kind: 'STATUS_DEADLINE_APPROACHING', overdue_hours: 2 }), '剩余 2 小时')
  assert.equal(slaDueLabel({ kind: 'PLAN_END_OVERDUE', overdue_hours: 26 }), '已超期 26 小时')
})

test('监控汇总行把状态计数、资源与人天汇总为可读文案', () => {
  assert.equal(monitoringSlaLabel({ sla_items: [] }), '正常')
  assert.equal(monitoringSlaLabel({ sla_items: [{ kind: 'PLAN_END_OVERDUE', overdue_hours: 4 }, { kind: 'STATUS_DEADLINE_APPROACHING', overdue_hours: 1 }] }), '超期 4h')
})

test('交付事件名与后端 delivery.go 常量逐字对齐（抽取样例防回归）', () => {
  assert.equal(eventLabel({ type: 'CONTRACT_ACTIVATED' }), '合同生效并生成项目')
  assert.equal(eventLabel({ type: 'FIELD_COMPLETED' }), '现场测评已结束')
  assert.equal(eventLabel({ type: 'NOT_A_REAL_EVENT' }), 'NOT_A_REAL_EVENT')
})

test('项目角色码与拆解调整表单工厂保持稳定契约', () => {
  assert.deepEqual(PROJECT_ROLE_CODES, { teamLead: 'team_lead', projectManager: 'project_manager', engineer: 'engineer' })
  const form = emptyAdjustForm()
  assert.equal(form.reason, '')
  assert.equal(form.items.length, 1)
  assert.equal(form.items[0].testMode, 'STANDARD')
})
