<script setup>
import { computed, reactive, ref, watch, toRefs, onScopeDispose, nextTick } from 'vue'
import { getMetricResources, postMetricResource, postMetricUsageAction, postMetricUsageBatch, listPersonnel } from '../api/projectManagement.js'
import * as projectAPI from '../api/projectManagement.js'
import { metricInstant, metricOperationKey } from '../metricFacts.js'
import ResourceMetricAutomationPanel from './ResourceMetricAutomationPanel.vue'
import { createResourceMetricCommands } from '../composables/useResourceMetricWorkflow.js'
import { hasUnresolvedResourceMetricCommand, parkResourceMetricCommand,
  restoreResourceMetricCommand, recordResourceMetricOutcome } from '../resourceMetricCommandState.js'
import { todayBusinessDate, formatBusinessDateTime, formatBusinessDate } from '../../shared/utils/businessTime.js'

const props = defineProps({
  items: { type: Array, default: () => [] },
  item: { type: Object, default: null },
  selectedItemId: { type: String, default: '' },
  session: { type: Object, default: null },
  resources: { type: Array, default: () => [] },
  equipment: { type: Array, default: () => [] },
  scopeToItem: { type: Boolean, default: false },
  initialTab: { type: String, default: 'usage' },
  commandState: { type: Object, default: createResourceMetricCommands },
})

const selectedMetricItemID = ref('')
const activeItem = computed(() => {
  const selected = props.items.find((item) => item.id === selectedMetricItemID.value)
  if (selected) return selected
  return props.items.length || props.selectedItemId ? null : props.item
})
const hasSelectedItem = computed(() => props.scopeToItem && !!props.selectedItemId
  && props.items.some((item) => item.id === props.selectedItemId))
const { busy, pending, batch, batchBusy } = toRefs(props.commandState)
props.commandState.unresolved ||= []
props.commandState.history ||= []
const error = ref(''), notice = ref('')
const usages = ref([]), capacities = ref([]), usagePage = ref(1), capacityPage = ref(1)
const people = ref([]), peopleKeyword = ref(''), peoplePage = ref(1), peopleTotal = ref(0), peopleError = ref('')
const orgFallbackOpen = ref(false), orgBusy = ref(false), orgError = ref('')
const autoOrg = ref({ user_id: '', organization_id: '', organization_name: '' })
const resourceOverride = ref(false)
const form = reactive({ resource_type: 'PERSON', resource_id: '', business_date: todayBusinessDate(), start: '', end: '', note: '', evidence: '', organization_witness_id: '', organization_id: '', excluded: false, version: 0, corrects_id: '' })
const comments = reactive({})
const capacityWindows = ref([{ start: '09:00', end: '12:00' }, { start: '13:00', end: '18:00' }])
const permission = computed(() => new Set(props.session?.permissions || []))
const canPerson = computed(() => ['project.implementation.plan', 'project.field.execute', 'project.person_capacity.manage'].some((code) => permission.value.has(code)))
const canEquipment = computed(() => ['project.implementation.plan', 'project.device.manage', 'project.equipment_capacity.manage'].some((code) => permission.value.has(code)))
const canCapacity = computed(() => permission.value.has(form.resource_type === 'PERSON' ? 'project.person_capacity.manage' : 'project.equipment_capacity.manage'))
const canRecord = computed(() => permission.value.has('project.resource_usage.record'))
const canConfirm = computed(() => permission.value.has('project.resource_usage.confirm'))
const activeTab = ref(props.initialTab === 'capacity' ? 'capacity' : 'usage')
watch([canCapacity, canRecord], () => {
  if (activeTab.value === 'capacity' && !canCapacity.value) activeTab.value = canRecord.value ? 'usage' : ''
  else if (activeTab.value === 'usage' && !canRecord.value) activeTab.value = canCapacity.value ? 'capacity' : ''
  else if (!activeTab.value) activeTab.value = canRecord.value ? 'usage' : canCapacity.value ? 'capacity' : ''
}, { immediate: true })
const planContext = computed(() => {
  const plan = activeItem.value?.implementation_plan
  if (!plan) return null
  const personnel = (plan.personnel || []).filter((row) => row.resource_id)
  const equipment = (plan.equipment || []).filter((row) => row.resource_id)
  const useEquipment = canEquipment.value && equipment.length
    && (form.resource_type === 'EQUIPMENT' || !canPerson.value || !personnel.length)
  const resource = useEquipment ? equipment[0] : canPerson.value ? personnel[0] : null
  if (!resource) return null
  return {
    resource_type: useEquipment ? 'EQUIPMENT' : 'PERSON',
    resource_id: resource.resource_id,
    resource_name: resource.resource_name || resource.resource_id,
    window_start: formatBusinessDate(resource.window_start) || formatBusinessDate(plan.planned_start) || '',
    window_end: formatBusinessDate(resource.window_end) || formatBusinessDate(plan.planned_end) || '',
    personnel_count: personnel.length,
    equipment_count: equipment.length,
  }
})
const resourceOptions = computed(() => {
  const map = new Map()
  const source = form.resource_type === 'PERSON'
    ? [...props.resources.filter((row) => row.resource_type === 'PERSON'), ...(activeItem.value?.implementation_plan?.personnel || [])]
    : [...props.equipment, ...(activeItem.value?.implementation_plan?.equipment || [])
      .map(row => ({ resource_type: 'EQUIPMENT', ...row }))]
  for (const row of source) {
    if (!row.resource_id) continue
    const existing = map.get(row.resource_id)
    map.set(row.resource_id, existing ? { ...existing, ...row, user_id: row.user_id || existing.user_id, resource_name: row.resource_name || existing.resource_name } : row)
  }
  return [...map.values()]
})
const selectedResource = computed(() => resourceOptions.value.find((row) => String(row.resource_id) === String(form.resource_id)) || null)
const capacityDates = computed(() => {
  const plan = activeItem.value?.implementation_plan
  const rows = form.resource_type === 'EQUIPMENT' ? plan?.equipment : plan?.personnel
  const row = (rows || []).find(value => value.resource_id === form.resource_id)
  const from = formatBusinessDate(row?.window_start || plan?.planned_start) || todayBusinessDate()
  return { from, to: formatBusinessDate(row?.window_end || plan?.planned_end) || from }
})
const selfResource = computed(() => props.resources.find((row) => row.resource_type === 'PERSON' && row.user_id === props.session?.user_id) || null)
const showResourcePicker = computed(() => resourceOverride.value || !planContext.value || (planContext.value.personnel_count + planContext.value.equipment_count !== 1))
const organizations = computed(() => people.value.find((person) => person.user_id === form.organization_witness_id)?.organizations || [])
const statusNames = { DRAFT: '草稿', PENDING: '待确认', CONFIRMED: '已确认', RETURNED: '退回', CANCEL_PENDING: '取消待独立确认', CANCELLED: '已取消', REPLACED: '已版本化更正' }
const myDrafts = computed(() => usages.value.filter((row) => ['DRAFT', 'RETURNED'].includes(row.status) && row.created_by === props.session?.user_id && canRecord.value))
const pendingConfirm = computed(() => usages.value.filter((row) => row.status === 'PENDING' && canConfirm.value && row.created_by !== props.session?.user_id && row.submitted_by !== props.session?.user_id))
const summaryText = computed(() => {
  if (myDrafts.value.length || pendingConfirm.value.length) return `本页待我处理：草稿 ${myDrafts.value.length} · 待确认 ${pendingConfirm.value.length}`
  return '本页暂无待我处理事项'
})
const canQuickCapacity = computed(() => canCapacity.value && form.resource_type === 'PERSON' && !!autoOrg.value.organization_id && !!form.resource_id)
let loadSequence = 0, orgSequence = 0, directorySequence = 0, disposed = false
let lastPreferredItemID = ''

// 用途：带出计划资源或本人档案，实际起止仍由已经发生的事实提供。
// 参数：无，读取当前服务项、人员档案和会话职责。
// 返回值：无；不从计划推算实际时长。
function applyPlanDefaults() {
  const context = planContext.value
  if (canRecord.value && permission.value.has('project.field.execute')
    && !permission.value.has('project.implementation.plan') && !canCapacity.value && selfResource.value) {
    form.resource_type = 'PERSON'
    form.resource_id = selfResource.value.resource_id
    form.business_date = todayBusinessDate()
    if (!form.note.trim()) form.note = '本人实施投入'
    return
  }
  if (!context) return
  if (context.resource_type === 'PERSON' && !canPerson.value) return
  if (context.resource_type === 'EQUIPMENT' && !canEquipment.value) return
  const today = todayBusinessDate()
  form.resource_type = context.resource_type
  form.resource_id = context.resource_id
  form.business_date = today
  if (!form.note.trim()) form.note = `实施计划：${context.resource_name}`
  resourceOverride.value = false
}

// 用途：从平台人员目录解析当前人员归属组织，避免手工找“组织见证人”。
// 参数：无，读取当前资源和平台身份。
// 返回值：解析完成；旧资源和旧父项返回不覆盖当前选择。
async function resolveOrganization() {
  orgBusy.value = false
  if (form.version || form.corrects_id) return
  const resource = selectedResource.value
  const userID = resource?.user_id || ''
  const ticket = ++orgSequence
  orgError.value = ''
  autoOrg.value = { user_id: '', organization_id: '', organization_name: '' }
  form.organization_id = ''
  form.organization_witness_id = ''
  if (form.resource_type !== 'PERSON' || !userID) return
  orgBusy.value = true
  try {
    const page = await listPersonnel({ user_id: userID, page: 1, page_size: 1 })
    if (ticket !== orgSequence) return
    const person = (page.items || []).find((row) => String(row.user_id) === String(userID))
    const organization = (person?.organizations || [])[0]
    if (!organization) {
      orgError.value = '该人员未关联平台组织，请在高级设置中手动选择组织依据'
      return
    }
    autoOrg.value = { user_id: userID, organization_id: organization.organization_id, organization_name: organization.organization_name || organization.organization_id }
    form.organization_witness_id = userID
    form.organization_id = organization.organization_id
    orgFallbackOpen.value = false
  } catch (cause) {
    if (ticket === orgSequence) orgError.value = cause.message || '平台组织目录不可用'
  } finally {
    if (ticket === orgSequence) orgBusy.value = false
  }
}

function openOrgFallback() { orgFallbackOpen.value = true }
// 用途：保留人工选择的组织依据，使旧自动解析失效。
// 参数：无。
// 返回值：无。
function markManualOrg() {
  orgSequence++; orgBusy.value = false
  autoOrg.value = { user_id: '', organization_id: '', organization_name: '' }
}

// 用途：按服务器真实范围分别读取容量和用量页。
// 参数：无，节点模式只读取当前父项，中心模式保留全局分页。
// 返回值：读取完成；旧上下文返回不更新当前台账。
async function load() {
  const ticket = ++loadSequence
  const itemID = activeItem.value?.id
  error.value = ''
  if (props.scopeToItem && !itemID) { capacities.value = []; usages.value = []; return }
  try {
    const read = props.scopeToItem
      ? (kind, page) => projectAPI.getItemMetricResources(itemID, kind, page)
      : getMetricResources
    const [caps, uses] = await Promise.all([read('capacities', capacityPage.value), read('usages', usagePage.value)])
    if (ticket !== loadSequence) return
    if (!Array.isArray(caps) || !Array.isArray(uses)) throw new Error('资源事实响应不完整')
    capacities.value = caps
    usages.value = uses
  } catch (cause) {
    if (ticket === loadSequence) error.value = cause.message || '资源事实暂不可用'
  }
}

// 用途：查询受控平台在职目录，供人员未关联组织时手动选择。
// 参数：next 表示同一查询的下一页。
// 返回值：当前查询结果；旧查询或旧父项返回丢弃。
async function searchPeople(next = false) {
  const ticket = ++directorySequence
  peopleError.value = ''
  if (!next) { peoplePage.value = 1; people.value = []; peopleTotal.value = 0 }
  else peoplePage.value++
  try {
    const result = await listPersonnel({ keyword: peopleKeyword.value, page: peoplePage.value, page_size: 50 })
    if (ticket !== directorySequence) return
    people.value = result.items
    peopleTotal.value = result.total
  } catch (cause) {
    if (ticket === directorySequence) peopleError.value = cause.message || '平台目录不可用'
  }
}

// 用途：执行或精确重试冻结的资源命令，防止未知结果下重复登记。
// 参数：command 为新命令或页面会话保留的原命令。
// 返回值：执行完成；未知结果保留原载荷和操作号，旧界面不回写。
async function execute(command = pending.value) {
  if (!command || busy.value || batchBusy.value || batch.value) return
  const required = command.kind === 'capacities'
    ? command.payload.resource_type === 'PERSON' ? 'project.person_capacity.manage' : 'project.equipment_capacity.manage'
    : command.action === 'decision' ? 'project.resource_usage.confirm' : 'project.resource_usage.record'
  if (!permission.value.has(required)) { error.value = '当前权限不能继续该操作，可先暂存待核对。'; return }
  const replaying = command === pending.value
  if (!replaying && hasUnresolvedResourceMetricCommand(props.commandState, command)) {
    error.value = '同一目标有尚未解决的原操作，请从待核对列表恢复，勿重新登记。'; return
  }
  command.context_item_id ||= command.payload?.service_item_id || command.itemID
    || (props.scopeToItem ? activeItem.value?.id : '') || ''
  command.itemIDs ||= command.context_item_id ? [command.context_item_id] : []
  command.state = 'SENDING'
  pending.value = command
  busy.value = true
  error.value = ''
  notice.value = ''
  try {
    let result
    if (command.kind === 'candidate') {
      result = await projectAPI.applyMetricUsageCandidate(command.itemID, command.payload)
    } else if (command.action) result = await postMetricUsageAction(command.id, command.action, command.payload)
    else result = await postMetricResource(command.kind, command.payload)
    if (!result?.id || !Number.isSafeInteger(result.version) || result.version < 1) {
      throw Object.assign(new Error('未收到完整资源保存回执，请核对后重试原操作。'), { outcomeUnknown: true })
    }
    recordResourceMetricOutcome(props.commandState, command, 'CONFIRMED', '资源操作已保存。')
    pending.value = null
    props.commandState.lastSavedItemID = command.context_item_id
    props.commandState.revision++
  } catch (cause) {
    command.failure = cause.message || '资源操作未完成'
    command.state = cause.outcomeUnknown || replaying ? 'UNKNOWN' : 'REJECTED'
    recordResourceMetricOutcome(props.commandState, command, command.state, command.failure)
    if (!disposed) error.value = command.failure
    if (command.state === 'REJECTED') pending.value = null
  } finally {
    busy.value = false
  }
}

// 用途：暂存单笔未知命令，保留原键并允许处理其他目标。
// 参数：无。
// 返回值：无；在途命令不能暂存。
function parkPending() {
  if (parkResourceMetricCommand(props.commandState, 'single')) notice.value = '原操作已暂存待核对，可处理其他目标。'
}

// 用途：恢复待核对列表内的原单笔或原批次，不创建新操作号。
// 参数：entry 为当前页面未解决列表中的命令。
// 返回值：无；已有活动命令时保留现状。
function restorePending(entry) {
  if (restoreResourceMetricCommand(props.commandState, entry)) notice.value = '已恢复原操作，请核对原服务项后继续。'
}

// 用途：把当前服务项候选交给同一资源命令通道，关闭窗口后仍可原键恢复。
// 参数：candidate 为子面板当前父项、资源和业务日，不接受另一父项的迟到事件。
// 返回值：候选登记Promise，最终事件与自动确认资格由服务端重算。
async function applyCandidate(candidate) {
  if (!canRecord.value || busy.value || pending.value || batchBusy.value
    || candidate.item_id !== activeItem.value?.id) return
  await execute({ kind: 'candidate', itemID: candidate.item_id, payload: {
    resource_id: candidate.resource_id, business_date: candidate.business_date,
    idempotency_key: metricOperationKey(),
  } })
}

// 用途：发布容量或登记用量草稿；容量必须已有可核验的组织归属。
// 参数：kind 为capacities或usages，实际用时不采用容量窗口作为默认值。
// 返回值：命令执行完成；字段错误保留在当前面板。
async function save(kind) {
  if (busy.value || pending.value || batch.value || batchBusy.value) return
  try {
    if (!form.resource_id || !form.note.trim()) throw new Error('请选择资源并填写业务用途与依据')
    if (kind === 'capacities' && orgBusy.value) throw new Error('正在解析组织归属，请稍候再发布')
    if (kind === 'capacities' && (!form.organization_id || !form.organization_witness_id)) throw new Error('请先确认组织归属；人员未关联平台目录时请在高级设置中手动选择')
    const payload = { resource_type: form.resource_type, resource_id: form.resource_id, business_date: form.business_date, note: form.note.trim(), idempotency_key: metricOperationKey() }
    if (kind === 'capacities') Object.assign(payload, { intervals: form.excluded ? [] : capacityWindows.value.map((window) => ({ start: metricInstant(form.business_date, window.start), end: metricInstant(form.business_date, window.end) })), organization_id: form.organization_id, organization_witness_id: form.organization_witness_id, expected_version: form.version })
    else {
      if (!activeItem.value?.id || !form.evidence.trim()) throw new Error('请先选择服务项，并填写实际工作或运行证据')
      Object.assign(payload, { start: metricInstant(form.business_date, form.start),
        end: metricInstant(form.business_date, form.end), service_item_id: activeItem.value.id,
        evidence: form.evidence.trim(), corrects_id: form.corrects_id })
    }
    await execute({ kind, payload })
  } catch (cause) {
    error.value = cause.message
  }
}

// 用途：按标准工作日窗口快速发布当前人员今日容量，仍可先调整时段。
async function quickPublishCapacity() {
  if (!canQuickCapacity.value) {
    error.value = '快速发布仅适用于已关联平台组织的人员；设备或未关联目录人员请使用完整表单'
    return
  }
  if (!form.note.trim()) form.note = '按标准工作日发布'
  capacityWindows.value = [{ start: '09:00', end: '12:00' }, { start: '13:00', end: '18:00' }]
  form.business_date = todayBusinessDate()
  form.excluded = false
  await save('capacities')
}

// 用途：提交、独立确认或申请取消真实用量，使用原版本并保留理由。
// 参数：row 为真实来源行，action 为命令，decision 为确认或退回结论。
// 返回值：命令完成；回执绑定来源服务项，与当前选择无关。
async function act(row, action, decision = '') {
  if (busy.value || pending.value || batch.value || batchBusy.value) return
  const note = String(comments[row.id] || '').trim()
  if (action !== 'submit' && !note) {
    error.value = '请填写确认、退回或取消说明'
    return
  }
  await execute({ id: row.id, action, context_item_id: row.service_item_id,
    payload: { expected_version: row.version, decision, note, idempotency_key: metricOperationKey() } })
}

// 用途：批量处理本页我的草稿或待我确认的用量；逐条保留版本和幂等键。
// 参数：kind 为submit或confirm，来源行与父项随批次冻结。
// 返回值：无；已有命令、批次或相同目标待核对时不覆盖。
function armBatch(kind) {
  const rows = kind === 'submit' ? myDrafts.value : pendingConfirm.value
  if (!rows.length || batchBusy.value || busy.value || pending.value || batch.value) return
  const command = { kind: 'batch', action: kind, state: 'READY',
    items: rows.map(row => ({ id: row.id, version: row.version, service_item_id: row.service_item_id })),
    itemIDs: [...new Set(rows.map(row => row.service_item_id).filter(Boolean))], count: rows.length, key: metricOperationKey() }
  if (hasUnresolvedResourceMetricCommand(props.commandState, command)) {
    error.value = '批次内有待核对的原操作，请先恢复原批次。'; return
  }
  batch.value = command
  error.value = ''
  notice.value = ''
}

// 用途：执行冻结批次，未知时保留原键和真实服务项范围。
// 参数：无，读取已明确确认的原批次。
// 返回值：整批处理完成；单笔在途或权限不符时不发送。
async function executeBatch() {
  const current = batch.value
  if (!current || batchBusy.value || busy.value || pending.value) return
  const action = current.action || current.kind
  if (!(action === 'confirm' ? canConfirm.value : canRecord.value)) return
  const replaying = current.state === 'UNKNOWN'
  current.state = 'SENDING'
  batchBusy.value = true
  error.value = ''
  notice.value = ''
  try {
    const result = await postMetricUsageBatch({
      items: current.items.map((item) => ({ id: item.id, expected_version: item.version })),
      action: action === 'confirm' ? 'DECISION' : 'SUBMIT',
      decision: action === 'confirm' ? 'CONFIRMED' : undefined,
      note: action === 'confirm' ? '批量确认' : undefined,
      idempotency_key: current.key,
    })
    const items = Array.isArray(result?.items) ? result.items : []
    if (items.length !== current.items.length || new Set(items.map(row => row.id)).size !== current.items.length
      || current.items.some(row => !items.some(value => value.id === row.id))) {
      throw Object.assign(new Error('批次回执不完整，请核对后重试原批次。'), { outcomeUnknown: true })
    }
    recordResourceMetricOutcome(props.commandState, current, 'CONFIRMED', `批次已确认完成${items.length}条。`)
    batch.value = null
    props.commandState.lastSavedItemID = current.context_item_id || activeItem.value?.id || ''
    props.commandState.revision++
    if (!disposed) notice.value = `批量处理完成 ${items.length || current.count} 条`
  } catch (cause) {
    current.failure = cause.message || '批量处理未完成'
    current.state = cause.outcomeUnknown || replaying ? 'UNKNOWN' : 'REJECTED'
    recordResourceMetricOutcome(props.commandState, current, current.state, current.failure)
    if (!disposed) error.value = current.failure
    if (current.state === 'REJECTED') batch.value = null
  } finally {
    batchBusy.value = false
  }
}

// 用途：仅取消尚未发送的批次，未知结果不能被普通取消丢弃。
// 参数：无。
// 返回值：无。
function cancelBatch() {
  if (!batchBusy.value && batch.value?.state === 'READY') batch.value = null
}

// 用途：暂存未知批次，使原行、范围和操作号可在中心恢复。
// 参数：无。
// 返回值：无；在途批次不移动。
function parkBatch() {
  if (parkResourceMetricCommand(props.commandState, 'batch')) notice.value = '原批次已暂存待核对。'
}

// 用途：选择原容量作为更正基础，不直接改写历史归属。
function correctCapacity(row) {
  Object.assign(form, { resource_type: row.resource_type, resource_id: row.resource_id, business_date: row.business_date, organization_id: row.organization_id, organization_witness_id: row.organization_witness_id, version: row.version, note: '', corrects_id: '' })
  capacityWindows.value = (row.intervals || []).map((window) => ({ start: clockFromInstant(window.start), end: clockFromInstant(window.end) }))
  form.excluded = capacityWindows.value.length === 0
  notice.value = '正在更正所选容量，请重新核对时段和平台组织依据；已有确认用量须先独立取消。'
}

function clockFromInstant(instant) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(instant))
}

function addCapacityWindow() {
  if (capacityWindows.value.length < 24) capacityWindows.value.push({ start: '', end: '' })
}

// 用途：先切到原记录父项，再设置关联更正，避免更正标识被切项清理。
// 参数：row 为原父项仍可见的已确认记录。
// 返回值：父项更新完成；不可见或上下文已变化时仅提示。
async function correctUsage(row) {
  if (!canRecord.value || !props.items.some(item => item.id === row.service_item_id)) {
    error.value = '原服务项不在当前可见列表，请刷新或重新进入该项目后更正。'
    return
  }
  selectedMetricItemID.value = row.service_item_id
  await nextTick()
  if (disposed || activeItem.value?.id !== row.service_item_id) return
  Object.assign(form, { resource_type: row.resource_type, resource_id: row.resource_id,
    business_date: row.business_date, version: 0, corrects_id: row.id, note: '', evidence: '', start: '', end: '' })
  activeTab.value = 'usage'
  notice.value = '正在登记关联更正，请选择原服务项并填写正确实际时段与更正依据。'
}

async function changePage(kind, delta) {
  if (kind === 'capacities') capacityPage.value = Math.max(1, capacityPage.value + delta)
  else usagePage.value = Math.max(1, usagePage.value + delta)
  await load()
}

// 用途：核对入口传入的父项，失效深链不自动替换为其他服务项。
// 参数：无，读取入口父项与当前可见列表。
// 返回值：无；保留用户后续明确改选。
function syncSelectedItem() {
  const preferred = String(props.selectedItemId || '')
  const changed = preferred !== lastPreferredItemID
  const previous = lastPreferredItemID
  lastPreferredItemID = preferred
  const currentVisible = props.items.some(item => item.id === selectedMetricItemID.value)
  if (preferred && (changed || !currentVisible || selectedMetricItemID.value === previous)) {
    if (props.items.some(item => item.id === preferred)) selectedMetricItemID.value = preferred
    else {
      selectedMetricItemID.value = ''
      notice.value = '指定服务项不在当前可见列表，请重新选择；不会自动替换为其他服务项。'
    }
  } else if (!currentVisible) {
    selectedMetricItemID.value = ''
  }
}

watch(() => [props.selectedItemId, props.items], syncSelectedItem, { immediate: true })
watch(() => [activeItem.value?.id, form.resource_type, form.resource_id], () => {
  if (activeTab.value === 'capacity' && !form.version && !form.corrects_id) form.business_date = capacityDates.value.from
  void resolveOrganization()
})
watch(() => activeItem.value?.id, () => {
  usagePage.value = 1; capacityPage.value = 1
  capacities.value = []; usages.value = []
  directorySequence++; orgSequence++
  people.value = []; peopleTotal.value = 0; peoplePage.value = 1
  autoOrg.value = { user_id: '', organization_id: '', organization_name: '' }
  capacityWindows.value = [{ start: '09:00', end: '12:00' }, { start: '13:00', end: '18:00' }]
  Object.assign(form, { version: 0, corrects_id: '', start: '', end: '', note: '', evidence: '',
    resource_id: '', organization_id: '', organization_witness_id: '', excluded: false,
    business_date: todayBusinessDate() })
  applyPlanDefaults()
  if (activeTab.value === 'capacity') form.business_date = capacityDates.value.from
  void load()
}, { immediate: true })
watch(canPerson, (allowed) => {
  if (!allowed && canEquipment.value) {
    form.resource_type = 'EQUIPMENT'
    if (props.initialTab === 'capacity' && canCapacity.value) activeTab.value = 'capacity'
  }
}, { immediate: true })
watch(() => form.resource_type, () => {
  if (form.version || form.corrects_id) return
  if (form.resource_id && !resourceOptions.value.some(row => row.resource_id === form.resource_id)) {
    form.resource_id = ''
    applyPlanDefaults()
  }
})
watch(() => props.commandState.revision, () => {
  const target = props.commandState.lastSavedItemID
  notice.value = target ? `资源操作已保存，关联服务项：${target}。` : '资源操作已保存。'
  void load()
})
watch(() => JSON.stringify(props.session?.permissions || []), () => {
  loadSequence++; orgSequence++
  capacities.value = []; usages.value = []
  if (props.session?.permissions?.includes('project.read')) void load()
})
onScopeDispose(() => { disposed = true; loadSequence++; orgSequence++; directorySequence++ })
</script>

<template>
  <section class="pm-resource-facts pm-panel" aria-label="人员设备实际容量与用量">
    <header class="pm-resource-header">
      <div class="pm-resource-title">
        <p class="pm-panel-kicker">资源事实</p>
        <h3>容量与实际用量</h3>
        <p class="pm-resource-subtitle">先发布明确容量，再登记并独立确认实际用量；计划、预约和签到不会自动变成实际用时。</p>
        <p v-if="scopeToItem" class="pm-resource-hint">仅显示当前服务项相关、且当前权限可见的容量与用量；完整台账请进入“工时与设备用量”。</p>
      </div>
      <div class="pm-resource-header-actions">
        <span class="pm-resource-summary">{{ summaryText }}</span>
        <button type="button" class="pm-button" :disabled="busy" @click="load">刷新核对</button>
      </div>
    </header>
    <div class="pm-resource-context" aria-label="资源事实当前上下文">
      <span v-if="activeItem" class="pm-resource-chip">服务项：{{ activeItem.site || activeItem.id }} · {{ activeItem.status }}</span>
      <span v-if="planContext" class="pm-resource-chip">计划：{{ planContext.window_start || '未填' }} ~ {{ planContext.window_end || '未填' }}</span>
      <span v-if="selectedResource" class="pm-resource-chip">资源：{{ selectedResource.resource_name || selectedResource.name || selectedResource.resource_id }}</span>
      <span v-if="autoOrg.organization_id" class="pm-resource-chip">组织：{{ autoOrg.organization_name }}</span>
      <span v-if="orgBusy" class="pm-resource-chip">正在解析组织…</span>
    </div>
    <nav v-if="canCapacity || canRecord" class="pm-resource-tabs" aria-label="资源事实录入类型">
      <button v-if="canCapacity" type="button" :class="{ active: activeTab === 'capacity' }" @click="activeTab = 'capacity'">容量发布</button>
      <button v-if="canRecord" type="button" :class="{ active: activeTab === 'usage' }" @click="activeTab = 'usage'">实际用量</button>
    </nav>
    <p v-if="error" role="alert">{{ error }}</p>
    <p v-if="notice" role="status">{{ notice }}</p>
    <p v-if="pending" role="status">本次结果尚未确认{{ pending.context_item_id ? `（服务项：${pending.context_item_id}）` : '' }}，请刷新核对，再 <button type="button" :disabled="busy || batchBusy" @click="execute()">按原操作重试</button>。{{ pending.failure || '' }}
      <button v-if="pending.state === 'UNKNOWN'" type="button" :disabled="busy" @click="parkPending">暂存待核对，处理其他事项</button>
    </p>
    <section v-if="commandState.unresolved.length" class="pm-resource-worklist" aria-label="尚待核对的原操作">
      <h4>尚待核对的原操作</h4>
      <p class="pm-resource-hint">原操作内容与操作号仍保留，同一目标请恢复原操作核对，勿重新登记。</p>
      <ul><li v-for="entry in commandState.unresolved" :key="entry.id">
        {{ entry.type === 'batch' ? '原批次' : '原操作' }} · {{ entry.command.itemIDs?.join('、') || entry.command.context_item_id || '资源台账' }}
        <button type="button" :disabled="busy || batchBusy || !!pending || !!batch" @click="restorePending(entry)">恢复原操作</button>
      </li></ul>
    </section>
    <details v-if="commandState.history.length" class="pm-resource-worklist">
      <summary>本页操作回执（{{ commandState.history.length }}）</summary>
      <ul><li v-for="(receipt, index) in commandState.history" :key="index">{{ receipt.itemIDs?.join('、') || '资源台账' }} · {{ receipt.message }}</li></ul>
    </details>

    <section v-if="(canCapacity || canRecord) && activeTab" class="pm-resource-card" :aria-busy="busy || !!pending || batchBusy">
      <header>
        <div>
          <h4>{{ activeTab === 'capacity' ? '发布明确容量' : '登记实际用量' }}</h4>
          <p>{{ activeTab === 'capacity' ? '容量是资源当日可用的明确时间窗；发布后实际用量必须落在容量内。' : '只记录已经发生的实际工作或设备运行，提交后由其他人独立确认。' }}</p>
        </div>
        <span v-if="form.corrects_id" class="pm-badge amber">关联更正</span>
      </header>
      <div class="pm-resource-form">
        <label v-if="!hasSelectedItem && items.length">实际用量服务项（授权进行中及历史项）
          <select v-model="selectedMetricItemID" :disabled="!!form.corrects_id"><option value="">请选择服务项</option><option v-for="candidate in items" :key="candidate.id" :value="candidate.id">{{ candidate.site || candidate.id }} · {{ candidate.status }} · {{ candidate.project_id }}</option></select>
        </label>
        <label v-else-if="activeItem">服务项
          <span class="pm-resource-chip">{{ activeItem.site || activeItem.id }} · {{ activeItem.status }}</span>
        </label>
        <label>资源类型<select v-model="form.resource_type" :disabled="!!form.corrects_id"><option v-if="canPerson" value="PERSON">人员</option><option v-if="canEquipment" value="EQUIPMENT">设备</option></select></label>
        <label v-if="showResourcePicker">实际资源<select v-model="form.resource_id" :disabled="!!form.corrects_id"><option value="">请选择</option><option v-for="row in resourceOptions" :key="row.resource_id" :value="row.resource_id">{{ row.resource_name || row.name || row.resource_id }}</option></select></label>
        <label v-else>实际资源
          <span class="pm-resource-chip">{{ selectedResource?.resource_name || form.resource_id }} <button type="button" class="pm-link" @click="resourceOverride = true">更换</button></span>
        </label>
        <label>北京业务日<input v-model="form.business_date" type="date" /></label>
        <label v-if="activeTab === 'usage'">开始时刻<input v-model="form.start" type="time" maxlength="5" /></label>
        <label v-if="activeTab === 'usage'">结束时刻<input v-model="form.end" type="time" maxlength="5" /></label>
      </div>
      <p v-if="planContext" class="pm-resource-hint">已按实施计划带出资源{{ activeTab === 'capacity' ? '与容量建议日期，可核对调整' : '；实际业务日默认今天，请核对实际起止' }}{{ planContext.personnel_count + planContext.equipment_count > 1 ? '；计划中还有多人/多设备，可在“实际资源”切换' : '' }}。</p>
      <p v-if="activeTab === 'usage'" class="pm-resource-hint">实际用量必须落在已发布的明确容量内；没有容量时请先由容量管理员发布，不能按每天 8 小时推算。</p>
      <label class="pm-resource-wide">用途 / 事实 / 更正原因<textarea v-model="form.note" maxlength="1000" /></label>

      <template v-if="activeTab === 'capacity' && canCapacity">
        <div class="pm-resource-capacity">
          <h4>当天明确可用时段</h4>
          <div v-for="(window, index) in capacityWindows" :key="index" class="pm-resource-form pm-resource-window">
            <label>可用开始<input v-model="window.start" type="time" maxlength="5" /></label>
            <label>可用结束<input v-model="window.end" type="time" maxlength="5" /></label>
            <button type="button" @click="capacityWindows.splice(index, 1)">移除此时段</button>
          </div>
          <button type="button" :disabled="capacityWindows.length >= 24" @click="addCapacityWindow">新增明确可用时段</button>
          <label class="pm-resource-inline"><input v-model="form.excluded" type="checkbox" /> 当天明确无可用容量（请说明休假、停机或检定等原因）</label>
          <div v-if="autoOrg.organization_id" class="pm-resource-org" role="status">
            <span>组织归属：{{ autoOrg.organization_name }}（来自平台目录，可更换）</span>
            <button type="button" class="pm-link" @click="openOrgFallback">更换</button>
          </div>
          <p v-else-if="orgError" role="alert">{{ orgError }}</p>
          <details class="pm-resource-advanced" :open="orgFallbackOpen || !autoOrg.organization_id">
            <summary>组织归属 / 目录依据（人员未关联平台目录时才需要手选）</summary>
            <div class="pm-resource-form">
              <label>平台组织目录<input v-model="peopleKeyword" maxlength="100" placeholder="搜索在职人员以选择其组织" /></label>
              <button type="button" @click="searchPeople()">查询组织依据</button>
              <label>目录依据人员<select v-model="form.organization_witness_id" @change="markManualOrg"><option value="">请选择</option><option v-for="person in people" :key="person.user_id" :value="person.user_id">{{ person.display_name }}</option></select></label>
              <label>容量业务归属组织<select v-model="form.organization_id" @change="markManualOrg"><option value="">请选择</option><option v-for="org in organizations" :key="org.organization_id" :value="org.organization_id">{{ org.organization_name }}</option></select></label>
              <button v-if="peoplePage * 50 < peopleTotal" type="button" @click="searchPeople(true)">目录下一页</button>
            </div>
            <p v-if="peopleError" role="alert">{{ peopleError }}</p>
          </details>
          <div class="pm-resource-actions">
            <button type="button" @click="save('capacities')">{{ form.version ? '发布更正容量版本' : '发布明确容量' }}</button>
            <button v-if="canQuickCapacity" type="button" class="secondary" @click="quickPublishCapacity">按标准工作日快速发布今日容量</button>
          </div>
        </div>
      </template>

      <template v-if="activeTab === 'usage' && canRecord">
        <label class="pm-resource-wide">实际工作 / 运行证据<textarea v-model="form.evidence" maxlength="1000" /></label>
        <p>{{ activeItem ? `当前服务项：${activeItem.site || activeItem.id}` : '请先选择服务项后登记用量。' }}</p>
        <button type="button" :disabled="!activeItem" @click="save('usages')">保存实际用量草稿</button>
      </template>
      <button v-if="form.version || form.corrects_id" type="button" @click="form.version = 0; form.corrects_id = ''; notice = ''">退出更正登记</button>
    </section>

    <section v-if="canRecord || canConfirm" class="pm-resource-worklist" :class="{ 'is-empty': !myDrafts.length && !pendingConfirm.length }">
      <header><h4>待我处理</h4><span>{{ summaryText }}</span></header>
      <div class="pm-resource-batch-actions">
        <button v-if="canRecord && myDrafts.length" type="button" :disabled="batchBusy || busy || !!pending || !!batch" @click="armBatch('submit')">提交我的草稿（{{ myDrafts.length }}）</button>
        <button v-if="canConfirm && pendingConfirm.length" type="button" :disabled="batchBusy || busy || !!pending || !!batch" @click="armBatch('confirm')">批量确认（{{ pendingConfirm.length }}）</button>
      </div>
      <div v-if="batch" class="pm-resource-batch-confirm" role="group" aria-label="批量处理确认">
        <p>{{ batch.action === 'submit' ? `将提交 ${batch.count} 条草稿，提交后进入独立确认。` : `将确认 ${batch.count} 条用量，确认说明统一记为“批量确认”。` }}</p>
        <p>本批涉及服务项：{{ batch.itemIDs?.join('、') || '原列表中的服务项' }}。{{ batch.failure || '' }}</p>
        <button type="button" :disabled="batchBusy || busy || !!pending" @click="executeBatch">{{ batchBusy ? '正在处理…' : batch.state === 'UNKNOWN' ? '核对后重试原批次' : '确认执行' }}</button>
        <button type="button" :disabled="batchBusy || batch.state !== 'READY'" @click="cancelBatch">取消未发送批次</button>
        <button v-if="batch.state === 'UNKNOWN'" type="button" :disabled="batchBusy" @click="parkBatch">暂存原批次待核对</button>
      </div>
      <p v-if="batchBusy" role="status">正在逐条处理，请勿关闭页面…</p>
      <p v-if="!myDrafts.length && !pendingConfirm.length" class="pm-empty-mini">当前页没有待我处理的事项。</p>
    </section>

    <ResourceMetricAutomationPanel
      v-if="activeItem && (canCapacity || canRecord || canConfirm)"
      :session="session" :item="activeItem" :resource="selectedResource"
      :organization="form.organization_id || autoOrg.organization_id"
      :witness="form.organization_witness_id || autoOrg.user_id"
      :can-capacity="canCapacity" :can-record="canRecord" :can-confirm="canConfirm"
      :busy="busy || !!pending || !!batch || batchBusy"
      :revision="commandState.revision"
      :suggested-from="capacityDates.from" :suggested-to="capacityDates.to"
      @apply-candidate="applyCandidate"
      @applied="load"
    />

    <div class="pm-resource-ledger">
      <h4>容量发布台账</h4><div class="pm-resource-scroll"><table><thead><tr><th>资源</th><th>业务日</th><th>容量分钟</th><th>组织 / 依据</th><th>版本 / 状态</th><th>操作</th></tr></thead><tbody><tr v-for="row in capacities" :key="row.id"><td>{{ row.resource_id }}</td><td>{{ row.business_date }}</td><td>{{ row.minutes }}</td><td>{{ row.organization_id }} · {{ row.note }}</td><td>{{ row.version }} / {{ row.status === 'PUBLISHED' ? '生效' : '已替换' }}</td><td><button v-if="row.status === 'PUBLISHED' && permission.has(row.resource_type === 'PERSON' ? 'project.person_capacity.manage' : 'project.equipment_capacity.manage')" type="button" :disabled="busy || !!pending || batchBusy" @click="correctCapacity(row)">版本化更正</button></td></tr></tbody></table></div>
      <footer><button type="button" :disabled="capacityPage === 1 || busy || batchBusy" @click="changePage('capacities', -1)">上一页</button>第{{ capacityPage }}页<button type="button" :disabled="capacities.length < 50 || busy || batchBusy" @click="changePage('capacities', 1)">下一页</button></footer>

      <h4>实际用量台账</h4><div class="pm-resource-scroll"><table><thead><tr><th>资源 / 服务项</th><th>实际时段（北京）</th><th>实际分钟</th><th>状态 / 依据</th><th>说明与操作</th></tr></thead><tbody><tr v-for="row in usages" :key="row.id"><td>{{ row.resource_id }} · {{ row.service_item_id }}</td><td>{{ formatBusinessDateTime(row.start) }} 至 {{ formatBusinessDateTime(row.end) }}</td><td>{{ row.minutes }}</td><td>{{ statusNames[row.status] || row.status }} · {{ row.note }}<small>{{ row.decision_note }}</small></td><td>
        <textarea v-model="comments[row.id]" maxlength="1000" placeholder="确认、退回或取消说明" :disabled="busy || !!pending || batchBusy" />
        <template v-if="row.created_by === session?.user_id && canRecord"><button v-if="['DRAFT','RETURNED'].includes(row.status)" type="button" :disabled="busy || !!pending || batchBusy" @click="act(row, 'submit')">提交确认</button><button v-if="['DRAFT','RETURNED','PENDING','CONFIRMED'].includes(row.status)" type="button" :disabled="busy || !!pending || batchBusy" @click="act(row, 'cancel')">{{ row.status === 'CONFIRMED' ? '申请取消并独立复核' : '取消' }}</button><button v-if="row.status === 'CONFIRMED'" type="button" :disabled="busy || !!pending || batchBusy" @click="correctUsage(row)">关联更正</button></template>
        <template v-if="canConfirm && ['PENDING','CANCEL_PENDING'].includes(row.status) && row.created_by !== session?.user_id && row.submitted_by !== session?.user_id"><button type="button" :disabled="busy || !!pending || batchBusy" @click="act(row, 'decision', 'CONFIRMED')">{{ row.status === 'CANCEL_PENDING' ? '独立批准取消' : '独立确认' }}</button><button type="button" :disabled="busy || !!pending || batchBusy" @click="act(row, 'decision', 'RETURNED')">退回</button></template>
      </td></tr></tbody></table></div>
      <p v-if="!usages.length && !error">当前页暂无已登记实际用量，不据此推断历史实际为零。</p>
      <footer><button type="button" :disabled="usagePage === 1 || busy || batchBusy" @click="changePage('usages', -1)">上一页</button>第{{ usagePage }}页<button type="button" :disabled="usages.length < 50 || busy || batchBusy" @click="changePage('usages', 1)">下一页</button></footer>
    </div>
  </section>
</template>

<style scoped>
.pm-resource-facts{padding:16px;margin-block:16px;border:1px solid var(--border-color,#dce2eb);border-radius:12px}.pm-resource-header{display:flex;flex-wrap:wrap;gap:16px;align-items:flex-start;justify-content:space-between}.pm-resource-header-actions{display:flex;flex-wrap:wrap;gap:12px;align-items:center}.pm-resource-summary{color:var(--pm-muted,#5b6778);font-size:13px}.pm-resource-note{line-height:1.7;color:var(--pm-muted,#5b6778)}.pm-resource-context{display:flex;flex-wrap:wrap;gap:8px 16px;margin-block:12px;font-size:13px}.pm-resource-form{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-block:12px}.pm-resource-facts label{display:flex;flex-direction:column;gap:6px}.pm-resource-facts fieldset{min-width:0;padding:16px;border:1px solid var(--border-color,#dce2eb)}.pm-resource-facts textarea{min-height:64px}.pm-resource-wide{display:flex;flex-direction:column;gap:6px}.pm-resource-hint{color:var(--pm-muted,#5b6778);font-size:13px}.pm-resource-chip{display:inline-flex;align-items:center;gap:8px;padding:6px 10px;border:1px solid var(--border-color,#dce2eb);border-radius:999px;background:var(--pm-surface,#f7f9fc)}.pm-resource-inline{flex-direction:row;align-items:center}.pm-resource-org{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-block:8px;padding:8px 10px;border-radius:8px;background:var(--pm-surface,#f7f9fc)}.pm-resource-advanced{margin-block:10px}.pm-resource-advanced summary{cursor:pointer;color:var(--pm-muted,#5b6778)}.pm-resource-actions{display:flex;flex-wrap:wrap;gap:12px;margin-block:8px}.pm-resource-worklist{margin-block:16px;padding:12px;border:1px dashed var(--border-color,#dce2eb);border-radius:8px}.pm-resource-worklist header{display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between}.pm-resource-batch-actions{display:flex;flex-wrap:wrap;gap:12px;margin-block:8px}.pm-resource-batch-confirm{padding:10px;border:1px solid var(--border-color,#dce2eb);border-radius:8px;background:var(--pm-surface,#f7f9fc)}.pm-resource-scroll{overflow:auto;margin-block:12px}.pm-resource-facts table{width:100%;border-collapse:collapse;min-width:680px}.pm-resource-facts th,.pm-resource-facts td{padding:10px;text-align:left;vertical-align:top;border-bottom:1px solid var(--border-color,#dce2eb)}.pm-resource-facts small{display:block}.pm-resource-facts p{line-height:1.7}

/* 资源事实可读性：容量/用量分栏、三列表单、紧凑待办与台账。 */
.pm-resource-facts { display: grid; gap: var(--pm-sp-4); padding: var(--pm-sp-5); border: 1px solid var(--pm-line); border-radius: var(--pm-r-lg); background: var(--pm-card); }
.pm-resource-header { display: flex; flex-wrap: wrap; gap: var(--pm-sp-4); align-items: flex-start; justify-content: space-between; }
.pm-resource-title h3 { margin: 0 0 4px; color: var(--pm-ink); }
.pm-resource-subtitle { max-width: 760px; margin: 0; color: var(--pm-muted); font-size: var(--pm-fs-sm); line-height: 1.55; }
.pm-resource-header-actions { display: flex; flex-wrap: wrap; gap: var(--pm-sp-3); align-items: center; }
.pm-resource-summary { color: var(--pm-muted); font-size: var(--pm-fs-hint); }
.pm-resource-context { display: flex; flex-wrap: wrap; gap: var(--pm-sp-2); }
.pm-resource-chip { display: inline-flex; align-items: center; gap: var(--pm-sp-2); padding: 6px 10px; border: 1px solid var(--pm-line); border-radius: var(--pm-r-full); background: var(--pm-card); color: var(--pm-body); font-size: var(--pm-fs-hint); }
.pm-resource-tabs { display: inline-flex; gap: 2px; border-bottom: 1px solid var(--pm-line); }
.pm-resource-tabs button { padding: 8px 14px; border: 0; border-bottom: 2px solid transparent; background: transparent; color: var(--pm-muted); font-size: var(--pm-fs-sm); font-weight: var(--pm-fw-semibold); cursor: pointer; }
.pm-resource-tabs button.active { border-bottom-color: var(--pm-primary); color: var(--pm-primary); }
.pm-resource-card { display: grid; gap: var(--pm-sp-4); padding: var(--pm-sp-4); border: 1px solid var(--pm-line); border-radius: var(--pm-r-md); background: var(--pm-card); }
.pm-resource-card > header { display: flex; flex-wrap: wrap; align-items: flex-start; justify-content: space-between; gap: var(--pm-sp-3); }
.pm-resource-card > header h4 { margin: 0 0 4px; color: var(--pm-ink); }
.pm-resource-card > header p { max-width: 720px; margin: 0; color: var(--pm-muted); font-size: var(--pm-fs-hint); line-height: 1.5; }
.pm-resource-form { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--pm-sp-3) var(--pm-sp-4); margin: 0; }
.pm-resource-form label { display: flex; flex-direction: column; gap: 6px; color: var(--pm-body); font-size: var(--pm-fs-label); font-weight: var(--pm-fw-semibold); }
.pm-resource-facts input:not([type="checkbox"]), .pm-resource-facts select, .pm-resource-facts textarea { width: 100%; min-height: var(--pm-h-control); padding: 8px 10px; border: 1px solid var(--pm-line); border-radius: var(--pm-r-sm); background: var(--pm-card); color: var(--pm-body); font-size: var(--pm-fs-sm); font-weight: var(--pm-fw-regular); }
.pm-resource-facts textarea { min-height: 72px; resize: vertical; }
.pm-resource-facts button:not(.pm-link):not(.pm-button):not(.pm-resource-tabs button) { min-height: var(--pm-h-button); padding: 7px 12px; border: 1px solid var(--pm-line); border-radius: var(--pm-r-sm); background: var(--pm-card); color: var(--pm-body); font-size: var(--pm-fs-sm); cursor: pointer; }
.pm-resource-facts button:not(.pm-link):not(.pm-button):not(.pm-resource-tabs button):hover:not(:disabled) { border-color: var(--pm-primary); color: var(--pm-primary); }
.pm-resource-wide { grid-column: 1 / -1; display: flex; flex-direction: column; gap: 6px; }
.pm-resource-window { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto; align-items: end; padding: var(--pm-sp-3); border: 1px solid var(--pm-line-soft); border-radius: var(--pm-r-sm); background: var(--pm-sunken); }
.pm-resource-inline { flex-direction: row; align-items: center; gap: var(--pm-sp-2); font-weight: var(--pm-fw-regular); }
.pm-resource-org { display: flex; flex-wrap: wrap; align-items: center; gap: var(--pm-sp-2); padding: var(--pm-sp-2) var(--pm-sp-3); border: 1px solid var(--pm-line); border-radius: var(--pm-r-sm); color: var(--pm-body); font-size: var(--pm-fs-hint); }
.pm-resource-actions { display: flex; flex-wrap: wrap; gap: var(--pm-sp-2); }
.pm-resource-worklist { display: grid; gap: var(--pm-sp-3); padding: var(--pm-sp-4); border: 1px solid var(--pm-line); border-radius: var(--pm-r-md); background: var(--pm-card); }
.pm-resource-worklist.is-empty { padding: 0; border: 0; background: transparent; }
.pm-resource-worklist > header { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: var(--pm-sp-2); }
.pm-resource-worklist > header h4 { margin: 0; color: var(--pm-ink); }
.pm-resource-worklist > header span { color: var(--pm-muted); font-size: var(--pm-fs-hint); }
.pm-resource-batch-actions { display: flex; flex-wrap: wrap; gap: var(--pm-sp-2); }
.pm-resource-batch-confirm { display: flex; flex-wrap: wrap; align-items: center; gap: var(--pm-sp-2); padding: var(--pm-sp-3); border: 1px solid var(--pm-line); border-radius: var(--pm-r-sm); background: var(--pm-sunken); }
.pm-resource-batch-confirm p { flex: 1 1 320px; margin: 0; }
.pm-resource-ledger { display: grid; gap: var(--pm-sp-3); }
.pm-resource-ledger > h4 { margin: var(--pm-sp-2) 0 0; color: var(--pm-ink); }
.pm-resource-scroll { overflow: auto; border: 1px solid var(--pm-line); border-radius: var(--pm-r-sm); }
.pm-resource-scroll table { width: 100%; border-collapse: collapse; font-size: var(--pm-fs-sm); }
.pm-resource-scroll th, .pm-resource-scroll td { padding: 9px 10px; border-bottom: 1px solid var(--pm-line-soft); text-align: left; vertical-align: top; }
.pm-resource-scroll th { background: var(--pm-th-bg); color: var(--pm-muted); font-size: var(--pm-fs-hint); font-weight: var(--pm-fw-semibold); white-space: nowrap; }
.pm-resource-scroll tbody tr:last-child td { border-bottom: 0; }
.pm-resource-scroll td textarea { min-height: 48px; }
.pm-resource-ledger footer { display: flex; align-items: center; gap: var(--pm-sp-2); }
@media (max-width: 900px) {
  .pm-resource-form { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 640px) {
  .pm-resource-facts { padding: var(--pm-sp-4); }
  .pm-resource-form, .pm-resource-window { grid-template-columns: minmax(0, 1fr); }
  .pm-resource-header { flex-direction: column; }
}
</style>
