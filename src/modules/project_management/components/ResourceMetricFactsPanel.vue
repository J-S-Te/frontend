<script setup>
import { computed, reactive, ref, watch } from 'vue'
import { getMetricResources, postMetricResource, postMetricUsageAction, listPersonnel } from '../api/projectManagement.js'
import { metricInstant, metricOperationKey } from '../metricFacts.js'
import { todayBusinessDate, formatBusinessDateTime } from '../../shared/utils/businessTime.js'

const props = defineProps({ items: { type: Array, default: () => [] }, item: { type: Object, default: null }, session: { type: Object, default: null }, resources: { type: Array, default: () => [] }, equipment: { type: Array, default: () => [] } })
const selectedMetricItemID = ref('')
const activeItem = computed(() => props.items.find((item) => item.id === selectedMetricItemID.value) || (props.items.length ? null : props.item))
const busy = ref(false), error = ref(''), notice = ref(''), pending = ref(null), usages = ref([]), capacities = ref([]), usagePage = ref(1), capacityPage = ref(1)
const people = ref([]), peopleKeyword = ref(''), peoplePage = ref(1), peopleTotal = ref(0), peopleError = ref('')
const form = reactive({ resource_type: 'PERSON', resource_id: '', business_date: todayBusinessDate(), start: '09:00', end: '18:00', note: '', evidence: '', organization_witness_id: '', organization_id: '', excluded: false, version: 0, corrects_id: '' })
const comments = reactive({})
const capacityWindows = ref([{ start: '09:00', end: '12:00' }, { start: '13:00', end: '18:00' }])
const permission = computed(() => new Set(props.session?.permissions || []))
const canPerson = computed(() => ['project.implementation.plan', 'project.field.execute', 'project.person_capacity.manage'].some((code) => permission.value.has(code)))
const canEquipment = computed(() => ['project.implementation.plan', 'project.device.manage', 'project.equipment_capacity.manage'].some((code) => permission.value.has(code)))
const canCapacity = computed(() => permission.value.has(form.resource_type === 'PERSON' ? 'project.person_capacity.manage' : 'project.equipment_capacity.manage'))
const canRecord = computed(() => permission.value.has('project.resource_usage.record'))
const canConfirm = computed(() => permission.value.has('project.resource_usage.confirm'))
const resourceOptions = computed(() => {
  const map = new Map()
  const source = form.resource_type === 'PERSON' ? [...props.resources.filter((row) => row.resource_type === 'PERSON'), ...(activeItem.value?.implementation_plan?.personnel || [])] : props.equipment
  for (const row of source) if (row.resource_id) map.set(row.resource_id, row)
  return [...map.values()]
})
const organizations = computed(() => people.value.find((person) => person.user_id === form.organization_witness_id)?.organizations || [])
const statusNames = { DRAFT: '草稿', PENDING: '待确认', CONFIRMED: '已确认', RETURNED: '退回', CANCEL_PENDING: '取消待独立确认', CANCELLED: '已取消', REPLACED: '已版本化更正' }
let sequence = 0

// 用途：按服务器真实范围分别读取容量和用量页。
// 参数：无。
// 返回值：无；任一失败明确显示，旧记录不会伪装成空集合。
async function load() {
  const ticket = ++sequence; error.value = ''
  try {
    const [caps, uses] = await Promise.all([getMetricResources('capacities', capacityPage.value), getMetricResources('usages', usagePage.value)])
    if (ticket !== sequence) return
    if (!Array.isArray(caps) || !Array.isArray(uses)) throw new Error('资源事实响应不完整')
    capacities.value = caps; usages.value = uses
  } catch (cause) { if (ticket === sequence) error.value = cause.message || '资源事实暂不可用' }
}

// 用途：查询受控平台在职目录，供明确选择组织依据。
// 参数：next 为是否查看下一页。
// 返回值：无；依赖失败保留可读错误，禁止手填未知组织。
async function searchPeople(next = false) {
  peopleError.value = ''; if (!next) peoplePage.value = 1
  else peoplePage.value++
  try {
    const result = await listPersonnel({ keyword: peopleKeyword.value, page: peoplePage.value, page_size: 50 })
    people.value = result.items; peopleTotal.value = result.total
  } catch (cause) { peopleError.value = cause.message || '平台目录不可用' }
}

// 用途：执行或精确重试冻结的资源命令，防止未知结果下重复登记。
// 参数：command 为可选新命令，缺省重试原载荷。
// 返回值：无；持久回执确认后才释放表单。
async function execute(command = pending.value) {
  if (!command || busy.value) return
  pending.value = command; busy.value = true; error.value = ''; notice.value = ''
  try {
    if (command.action) await postMetricUsageAction(command.id, command.action, command.payload)
    else await postMetricResource(command.kind, command.payload)
    pending.value = null; notice.value = '资源事实已保存'; await load()
  } catch (cause) {
    error.value = cause.message || '资源操作未完成'
    if (!cause.outcomeUnknown) pending.value = null
  } finally { busy.value = false }
}

// 用途：发布有业务用途依据的容量版本或登记真实实际时段。
// 参数：kind 为capacities或usages。
// 返回值：无；实际时刻明确按北京转换，不能以计划替代实绩。
async function save(kind) {
  if (busy.value || pending.value) return
  try {
    if (!form.resource_id || !form.note.trim()) throw new Error('请选择资源并填写业务用途与依据')
    const payload = { resource_type: form.resource_type, resource_id: form.resource_id, business_date: form.business_date, note: form.note.trim(), idempotency_key: metricOperationKey() }
    const interval = { start: metricInstant(form.business_date, form.start), end: metricInstant(form.business_date, form.end) }
    if (kind === 'capacities') Object.assign(payload, { intervals: form.excluded ? [] : capacityWindows.value.map((window) => ({ start: metricInstant(form.business_date, window.start), end: metricInstant(form.business_date, window.end) })), organization_id: form.organization_id, organization_witness_id: form.organization_witness_id, expected_version: form.version })
    else {
      if (!activeItem.value?.id || !form.evidence.trim()) throw new Error('请先选择服务项，并填写实际工作或运行证据')
      Object.assign(payload, interval, { service_item_id: activeItem.value.id, evidence: form.evidence.trim(), corrects_id: form.corrects_id })
    }
    await execute({ kind, payload })
  } catch (cause) { error.value = cause.message }
}

// 用途：提交、独立确认或申请取消真实用量，使用原版本并保留理由。
// 参数：row 为真实用量，action 为路由动作，decision 为可选审核决定。
// 返回值：无；所有决定仍由服务器复验职责分离与项目范围。
async function act(row, action, decision = '') {
  if (busy.value || pending.value) return
  const note = String(comments[row.id] || '').trim()
  if (action !== 'submit' && !note) { error.value = '请填写确认、退回或取消说明'; return }
  await execute({ id: row.id, action, payload: { expected_version: row.version, decision, note, idempotency_key: metricOperationKey() } })
}

// 用途：选择原容量作为更正基础，不直接改写历史归属。
// 参数：row 为真实容量版本。
// 返回值：无；有确认用量时服务端要求先独立取消收口。
function correctCapacity(row) {
  Object.assign(form, { resource_type: row.resource_type, resource_id: row.resource_id, business_date: row.business_date, organization_id: row.organization_id, organization_witness_id: row.organization_witness_id, version: row.version, note: '', corrects_id: '' })
  capacityWindows.value = (row.intervals || []).map((window) => ({ start: clockFromInstant(window.start), end: clockFromInstant(window.end) }))
  form.excluded = capacityWindows.value.length === 0
  notice.value = '正在更正所选容量，请重新核对时段和平台组织依据；已有确认用量须先独立取消。'
}

// 用途：把真实UTC时刻回显为北京时钟，避免本机时区漂移。
// 参数：instant 为事实的RFC3339时刻。
// 返回值：北京HH:mm，供容量更正表单使用。
function clockFromInstant(instant) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(instant))
}

// 用途：增加明确可用容量时段，不默认补造全天工时。
// 参数：无。
// 返回值：无；最多24段，时段重叠继续由服务端拒绝。
function addCapacityWindow() {
  if (capacityWindows.value.length < 24) capacityWindows.value.push({ start: '', end: '' })
}

// 用途：为已确认用量建立关联更正草稿，保留旧确认事实。
// 参数：row 为原已确认记录。
// 返回值：无；新记录独立确认后才替代原净时长。
function correctUsage(row) {
  selectedMetricItemID.value = row.service_item_id
  Object.assign(form, { resource_type: row.resource_type, resource_id: row.resource_id, business_date: row.business_date, corrects_id: row.id, note: '', evidence: '' })
  notice.value = '正在登记关联更正，请选择原服务项并填写正确实际时段与更正依据。'
}

// 用途：根据业务集合切换真实分页。
// 参数：kind 为集合名，delta 为页码增量。
// 返回值：无；读取服务端下一页。
async function changePage(kind, delta) {
  if (kind === 'capacities') capacityPage.value = Math.max(1, capacityPage.value + delta)
  else usagePage.value = Math.max(1, usagePage.value + delta)
  await load()
}
watch(canPerson, (allowed) => { if (!allowed && canEquipment.value) form.resource_type = 'EQUIPMENT' }, { immediate: true })
watch(() => activeItem.value?.id, () => { usagePage.value = 1; load() }, { immediate: true })
</script>

<template>
  <section class="pm-resource-facts pm-panel" aria-label="人员设备实际容量与用量">
    <header><h3>明确容量与实际用量</h3><button type="button" :disabled="busy" @click="load">刷新核对</button></header>
    <p>全部时刻为北京时间。先发布明确可用容量，再登记已实际发生的工作或运行时段并独立确认；计划、预约和签到不会自动变成实际用时。容量组织为明确业务归属，历史更正保留原记录。</p>
    <p v-if="error" role="alert">{{ error }}</p><p v-if="notice" role="status">{{ notice }}</p>
    <p v-if="pending" role="status">本次结果尚未确认，请刷新核对，再 <button type="button" :disabled="busy" @click="execute()">按原操作重试</button>。</p>
    <fieldset v-if="canRecord || canCapacity" :disabled="busy || !!pending">
      <label v-if="items.length">实际用量服务项（授权进行中及历史项）
        <select v-model="selectedMetricItemID"><option value="">请选择服务项</option><option v-for="candidate in items" :key="candidate.id" :value="candidate.id">{{ candidate.site || candidate.id }} · {{ candidate.status }} · {{ candidate.project_id }}</option></select>
      </label>
      <legend>资源事实登记{{ form.corrects_id ? ' · 关联更正' : '' }}</legend>
      <div class="pm-resource-form">
        <label>资源类型<select v-model="form.resource_type"><option v-if="canPerson" value="PERSON">人员</option><option v-if="canEquipment" value="EQUIPMENT">设备</option></select></label>
        <label>实际资源<select v-model="form.resource_id"><option value="">请选择</option><option v-for="row in resourceOptions" :key="row.resource_id" :value="row.resource_id">{{ row.resource_name || row.name || row.resource_id }}</option></select></label>
        <label>北京业务日<input v-model="form.business_date" type="date" /></label>
        <label>开始时刻<input v-model="form.start" type="time" maxlength="5" /></label><label>结束时刻<input v-model="form.end" type="time" maxlength="5" /></label>
        <label>用途 / 事实 / 更正原因<textarea v-model="form.note" maxlength="1000" /></label>
      </div>
      <template v-if="canCapacity">
        <h4>当天明确可用时段（可分段排除午休、休假或停机）</h4>
        <div v-for="(window, index) in capacityWindows" :key="index" class="pm-resource-form"><label>可用开始<input v-model="window.start" type="time" maxlength="5" /></label><label>可用结束<input v-model="window.end" type="time" maxlength="5" /></label><button type="button" @click="capacityWindows.splice(index, 1)">移除此时段</button></div>
        <button type="button" :disabled="capacityWindows.length >= 24" @click="addCapacityWindow">新增明确可用时段</button>
        <label><input v-model="form.excluded" type="checkbox" /> 当天明确无可用容量（请说明休假、停机或检定等原因）</label>
        <div class="pm-resource-form">
          <label>平台组织目录<input v-model="peopleKeyword" maxlength="100" placeholder="搜索在职人员以选择其组织" /></label><button type="button" @click="searchPeople()">查询组织依据</button>
          <label>目录依据人员<select v-model="form.organization_witness_id"><option value="">请选择</option><option v-for="person in people" :key="person.user_id" :value="person.user_id">{{ person.display_name }}</option></select></label>
          <label>容量业务归属组织<select v-model="form.organization_id"><option value="">请选择</option><option v-for="org in organizations" :key="org.organization_id" :value="org.organization_id">{{ org.organization_name }}</option></select></label>
          <button v-if="peoplePage * 50 < peopleTotal" type="button" @click="searchPeople(true)">目录下一页</button>
        </div>
        <p v-if="peopleError" role="alert">{{ peopleError }}</p><button type="button" @click="save('capacities')">{{ form.version ? '发布更正容量版本' : '发布明确容量' }}</button>
      </template>
      <template v-if="canRecord"><label>实际工作 / 运行证据<textarea v-model="form.evidence" maxlength="1000" /></label><p>{{ activeItem ? `当前服务项：${activeItem.site || activeItem.id}` : '请在实施计划或报告工作台先选择服务项后登记用量。' }}</p><button type="button" :disabled="!activeItem" @click="save('usages')">保存实际用量草稿</button></template>
      <button v-if="form.version || form.corrects_id" type="button" @click="form.version = 0; form.corrects_id = ''; notice = ''">退出更正登记</button>
    </fieldset>
    <h4>容量发布台账</h4><div class="pm-resource-scroll"><table><thead><tr><th>资源</th><th>业务日</th><th>容量分钟</th><th>组织 / 依据</th><th>版本 / 状态</th><th>操作</th></tr></thead><tbody><tr v-for="row in capacities" :key="row.id"><td>{{ row.resource_id }}</td><td>{{ row.business_date }}</td><td>{{ row.minutes }}</td><td>{{ row.organization_id }} · {{ row.note }}</td><td>{{ row.version }} / {{ row.status === 'PUBLISHED' ? '生效' : '已替换' }}</td><td><button v-if="row.status === 'PUBLISHED' && permission.has(row.resource_type === 'PERSON' ? 'project.person_capacity.manage' : 'project.equipment_capacity.manage')" type="button" :disabled="busy || !!pending" @click="correctCapacity(row)">版本化更正</button></td></tr></tbody></table></div>
    <footer><button type="button" :disabled="capacityPage === 1 || busy" @click="changePage('capacities', -1)">上一页</button>第{{ capacityPage }}页<button type="button" :disabled="capacities.length < 50 || busy" @click="changePage('capacities', 1)">下一页</button></footer>
    <h4>实际用量台账</h4><div class="pm-resource-scroll"><table><thead><tr><th>资源 / 服务项</th><th>实际时段（北京）</th><th>实际分钟</th><th>状态 / 依据</th><th>说明与操作</th></tr></thead><tbody><tr v-for="row in usages" :key="row.id"><td>{{ row.resource_id }} · {{ row.service_item_id }}</td><td>{{ formatBusinessDateTime(row.start) }} 至 {{ formatBusinessDateTime(row.end) }}</td><td>{{ row.minutes }}</td><td>{{ statusNames[row.status] || row.status }} · {{ row.note }}<small>{{ row.decision_note }}</small></td><td>
      <textarea v-model="comments[row.id]" maxlength="1000" placeholder="确认、退回或取消说明" :disabled="busy || !!pending" />
      <template v-if="row.created_by === session?.user_id && canRecord"><button v-if="['DRAFT','RETURNED'].includes(row.status)" type="button" :disabled="busy || !!pending" @click="act(row, 'submit')">提交确认</button><button v-if="['DRAFT','RETURNED','PENDING','CONFIRMED'].includes(row.status)" type="button" :disabled="busy || !!pending" @click="act(row, 'cancel')">{{ row.status === 'CONFIRMED' ? '申请取消并独立复核' : '取消' }}</button><button v-if="row.status === 'CONFIRMED'" type="button" :disabled="busy || !!pending" @click="correctUsage(row)">关联更正</button></template>
      <template v-if="canConfirm && ['PENDING','CANCEL_PENDING'].includes(row.status) && row.created_by !== session?.user_id && row.submitted_by !== session?.user_id"><button type="button" :disabled="busy || !!pending" @click="act(row, 'decision', 'CONFIRMED')">{{ row.status === 'CANCEL_PENDING' ? '独立批准取消' : '独立确认' }}</button><button type="button" :disabled="busy || !!pending" @click="act(row, 'decision', 'RETURNED')">退回</button></template>
    </td></tr></tbody></table></div>
    <p v-if="!usages.length && !error">当前页暂无已登记实际用量，不据此推断历史实际为零。</p>
    <footer><button type="button" :disabled="usagePage === 1 || busy" @click="changePage('usages', -1)">上一页</button>第{{ usagePage }}页<button type="button" :disabled="usages.length < 50 || busy" @click="changePage('usages', 1)">下一页</button></footer>
  </section>
</template>

<style scoped>
.pm-resource-facts{padding:16px;margin-block:16px;border:1px solid var(--border-color,#dce2eb);border-radius:12px}.pm-resource-facts header,.pm-resource-facts footer{display:flex;flex-wrap:wrap;gap:12px;align-items:center}.pm-resource-form{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-block:12px}.pm-resource-facts label{display:flex;flex-direction:column;gap:6px}.pm-resource-facts fieldset{min-width:0;padding:16px;border:1px solid var(--border-color,#dce2eb)}.pm-resource-facts textarea{min-height:64px}.pm-resource-scroll{overflow:auto;margin-block:12px}.pm-resource-facts table{width:100%;border-collapse:collapse;min-width:680px}.pm-resource-facts th,.pm-resource-facts td{padding:10px;text-align:left;vertical-align:top;border-bottom:1px solid var(--border-color,#dce2eb)}.pm-resource-facts small{display:block}.pm-resource-facts p{line-height:1.7}
</style>
