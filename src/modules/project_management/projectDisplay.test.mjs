import assert from 'node:assert/strict'
import test from 'node:test'
import {
  PROJECT_ROLE_CODES,
  asRFC3339,
  capabilityCodeKey,
  compactOverrideMatch,
  compactOverrideSettings,
  csvCell,
  defaultConfigFieldValue,
  emptyAdjustForm,
  eventLabel,
  monitoringSlaLabel,
  multiSummary,
  planEquipmentFor,
  planPersonnelFor,
  planPersonnelRows,
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
  assert.equal(asRFC3339(''), '')
  assert.equal(asRFC3339('2026-10-22T09:00'), new Date('2026-10-22T09:00').toISOString())
  assert.equal(asRFC3339('不是时间'), '不是时间')
  const local = toDateTimeLocal('2026-10-22T01:00:00Z')
  assert.match(local, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
  assert.equal(new Date(`${local}:00`).getTime(), Date.UTC(2026, 9, 22, 1, 0))
  assert.equal(toDateTimeLocal(''), '')
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
  assert.equal(statusTone('已签发'), 'blue')
  assert.equal(statusTone('已完成'), 'green')
  assert.equal(statusTone('REJECTED'), '风险')
  assert.equal(statusTone('未知状态'), 'neutral')
  assert.equal(statusTone(' 待处理 '), 'amber')
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
