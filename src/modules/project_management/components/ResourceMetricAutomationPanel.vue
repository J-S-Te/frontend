<script setup>
import { computed, reactive, ref, watch } from 'vue'
import {
  getMetricCalendar, saveMetricCalendarRule,
  getMetricCalendarExceptions, saveMetricCalendarException, deleteMetricCalendarException,
  generateMetricCapacities,
  getMetricUsageCandidates, applyMetricUsageCandidate,
  getMetricAutoConfirmSetting, setMetricAutoConfirmSetting,
} from '../api/projectManagement.js'
import { metricOperationKey } from '../metricFacts.js'
import { todayBusinessDate, formatBusinessDateTime } from '../../shared/utils/businessTime.js'

const props = defineProps({
  session: { type: Object, default: null },
  item: { type: Object, default: null },
  resource: { type: Object, default: null },
  organization: { type: String, default: '' },
  witness: { type: String, default: '' },
  canCapacity: { type: Boolean, default: false },
  canRecord: { type: Boolean, default: false },
  canConfirm: { type: Boolean, default: false },
})
const emit = defineEmits(['applied'])
const weekdayNames = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']
const rules = ref([])
const calendarLoading = ref(false), calendarError = ref(''), calendarNotice = ref('')
const calendar = ref(weekdayNames.map((name, index) => ({ weekday: index + 1, name, enabled: false, start: '09:00', end: '18:00', version: 0 })))
const exceptions = ref([])
const exceptionError = ref(''), exceptionNotice = ref('')
const exceptionForm = reactive({ kind: 'LEAVE', business_date: todayBusinessDate(), start: '09:00', end: '18:00', zero: true, note: '', version: 0 })
const candidates = ref([]), candidatesLoading = ref(false), candidatesError = ref(''), candidatesNotice = ref('')
const autoConfirm = ref(null), autoConfirmError = ref(''), autoConfirmSaving = ref(false)
const generateFrom = ref(todayBusinessDate()), generateTo = ref(todayBusinessDate())
const generateBusy = ref(false), generateError = ref(''), generateNotice = ref(''), generateResults = ref([])
const active = computed(() => !!props.organization && !!props.item)
const canGenerate = computed(() => props.canCapacity && !!props.organization && !!props.resource?.resource_id && !!props.witness)
const monthFrom = computed(() => (todayBusinessDate() || '').slice(0, 7) + '-01')
const monthTo = computed(() => {
  const month = (todayBusinessDate() || '').slice(0, 7)
  if (!month) return ''
  const date = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0))
  return date.toISOString().slice(0, 10)
})

// 用途：读取组织工作日历、资源例外、现场候选和自动确认策略。
async function loadCalendar() {
  if (!props.organization) return
  calendarLoading.value = true; calendarError.value = ''
  try {
    const loaded = await getMetricCalendar(props.organization)
    rules.value = Array.isArray(loaded) ? loaded : []
    const byWeekday = new Map(rules.value.map((row) => [row.weekday, row]))
    calendar.value = weekdayNames.map((name, index) => {
      const row = byWeekday.get(index + 1)
      const interval = (row?.intervals || [])[0]
      return {
        weekday: index + 1, name, version: row?.version || 0,
        enabled: !!row && (row.intervals || []).length > 0,
        start: clockFromInstant(interval?.start) || '09:00',
        end: clockFromInstant(interval?.end) || '18:00',
      }
    })
  } catch (cause) { calendarError.value = cause.message || '组织工作日历读取失败' }
  finally { calendarLoading.value = false }
}

async function loadExceptions() {
  if (!props.organization) return
  exceptionError.value = ''
  try {
    const loaded = await getMetricCalendarExceptions(props.organization, monthFrom.value, monthTo.value)
    exceptions.value = Array.isArray(loaded) ? loaded : []
  } catch (cause) { exceptionError.value = cause.message || '容量例外读取失败' }
}

async function loadCandidates() {
  if (!props.item?.id) { candidates.value = []; return }
  candidatesLoading.value = true; candidatesError.value = ''
  try {
    const loaded = await getMetricUsageCandidates(props.item.id)
    candidates.value = Array.isArray(loaded) ? loaded : []
  } catch (cause) { candidatesError.value = cause.message || '现场候选读取失败' }
  finally { candidatesLoading.value = false }
}

async function loadAutoConfirm() {
  if (!props.canConfirm) return
  autoConfirmError.value = ''
  try { autoConfirm.value = await getMetricAutoConfirmSetting() }
  catch (cause) { autoConfirmError.value = cause.message || '自动确认策略读取失败' }
}

// 用途：保存单个星期的组织工作日历，保留服务端版本。
async function saveWeekday(row) {
  if (!props.organization || !props.witness) { calendarError.value = '请先确认人员组织归属'; return }
  calendarError.value = ''; calendarNotice.value = ''
  try {
    await saveMetricCalendarRule({
      organization_id: props.organization, weekday: row.weekday,
      intervals: row.enabled ? [{ start: instantOf(row.start, todayBusinessDate()), end: instantOf(row.end, todayBusinessDate()) }] : [],
      expected_version: row.version, note: '组织工作日历维护',
      organization_witness_id: props.witness, idempotency_key: metricOperationKey(),
    })
    calendarNotice.value = `${row.name}已保存`
    await loadCalendar()
  } catch (cause) { calendarError.value = cause.message || `${row.name}保存失败` }
}

// 用途：保存请假、加班、停机或组织假日例外；零容量用空时段显式表达。
async function saveException() {
  if (!props.organization || !exceptionForm.note.trim()) { exceptionError.value = '请填写例外依据'; return }
  const holiday = exceptionForm.kind === 'HOLIDAY'
  const resourceType = holiday ? 'ORG' : props.resource?.resource_type
  const resourceID = holiday ? props.organization : props.resource?.resource_id
  if (!resourceType || !resourceID) { exceptionError.value = '请先选择资源'; return }
  exceptionError.value = ''; exceptionNotice.value = ''
  try {
    await saveMetricCalendarException({
      organization_id: props.organization, resource_type: resourceType, resource_id: resourceID,
      business_date: exceptionForm.business_date, kind: exceptionForm.kind,
      intervals: exceptionForm.zero ? [] : [{ start: instantOf(exceptionForm.start), end: instantOf(exceptionForm.end) }],
      expected_version: exceptionForm.version, note: exceptionForm.note.trim(), idempotency_key: metricOperationKey(),
    })
    exceptionNotice.value = '容量例外已保存'
    exceptionForm.note = ''; exceptionForm.version = 0
    await loadExceptions()
  } catch (cause) { exceptionError.value = cause.message || '容量例外保存失败' }
}

async function removeException(row) {
  exceptionError.value = ''
  try {
    await deleteMetricCalendarException(row.id, row.version, metricOperationKey())
    exceptionNotice.value = '容量例外已删除'
    await loadExceptions()
  } catch (cause) { exceptionError.value = cause.message || '容量例外删除失败' }
}

// 用途：按组织日历生成当前资源一段日期的容量；结果逐日显示。
async function generate() {
  if (!canGenerate.value) { generateError.value = '请先选择有平台组织依据的人员或设备'; return }
  generateBusy.value = true; generateError.value = ''; generateNotice.value = ''; generateResults.value = []
  try {
    const rows = await generateMetricCapacities({
      resource_type: props.resource.resource_type, resource_ids: [props.resource.resource_id],
      organization_id: props.organization, from: generateFrom.value, to: generateTo.value,
      idempotency_key: metricOperationKey(),
    })
    generateResults.value = Array.isArray(rows) ? rows : []
    const published = generateResults.value.filter((row) => row.status === 'PUBLISHED').length
    generateNotice.value = `容量生成完成：${published} 天已发布`
    emit('applied')
  } catch (cause) { generateError.value = cause.message || '容量生成失败' }
  finally { generateBusy.value = false }
}

// 用途：应用服务端重新计算的现场候选；完整事件链在策略开启时直接确认。
async function applyCandidate(candidate) {
  if (!props.item?.id || !candidate.resource_id) return
  candidatesError.value = ''; candidatesNotice.value = ''
  try {
    await applyMetricUsageCandidate(props.item.id, { resource_id: candidate.resource_id, business_date: candidate.business_date, idempotency_key: metricOperationKey() })
    candidatesNotice.value = '候选已登记'
    await loadCandidates()
    emit('applied')
  } catch (cause) { candidatesError.value = cause.message || '候选登记失败' }
}

async function toggleAutoConfirm() {
  if (!props.canConfirm || autoConfirmSaving.value) return
  autoConfirmSaving.value = true; autoConfirmError.value = ''
  try {
    autoConfirm.value = await setMetricAutoConfirmSetting({ enabled: !autoConfirm.value?.enabled, expected_version: autoConfirm.value?.version || 0, idempotency_key: metricOperationKey() })
    await loadCandidates()
  } catch (cause) { autoConfirmError.value = cause.message || '自动确认策略保存失败' }
  finally { autoConfirmSaving.value = false }
}

function instantOf(clock, day = exceptionForm.business_date || todayBusinessDate()) {
  return new Date(`${day}T${clock}:00+08:00`).toISOString()
}

function clockFromInstant(value) {
  if (!value) return ''
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value))
}

function hasCandidateEnd(candidate) {
  return !!candidate?.end && !String(candidate.end).startsWith('0001-01-01')
}

watch(() => exceptionForm.kind, (kind) => { exceptionForm.zero = kind !== 'OVERTIME' }, { immediate: true })
watch(() => props.organization, () => { void loadCalendar(); void loadExceptions() }, { immediate: true })
watch(() => props.item?.id, () => { void loadCandidates() }, { immediate: true })
watch(() => props.canConfirm, () => { void loadAutoConfirm() }, { immediate: true })
</script>

<template>
  <details class="pm-resource-automation" :open="false">
    <summary>自动化助手：现场候选 / 容量生成 / 工作日历与例外 / 自动确认策略</summary>
    <p v-if="!active" class="pm-resource-note">请先选择服务项和组织归属，再使用自动化能力。</p>

    <section v-if="item" class="pm-resource-automation-block">
      <header><h4>现场事件候选</h4><span>{{ candidates.length }} 条</span></header>
      <p class="pm-resource-hint">由现场开始/签到/记录/签名事件推算，必须由人核对；策略开启且事件链完整时可自动确认。</p>
      <p v-if="candidatesError" role="alert">{{ candidatesError }}</p>
      <p v-if="candidatesNotice" role="status">{{ candidatesNotice }}</p>
      <p v-if="candidatesLoading" role="status">正在读取现场候选…</p>
      <div v-if="candidates.length" class="pm-resource-candidates">
        <article v-for="candidate in candidates" :key="`${candidate.resource_id}-${candidate.business_date}`" class="pm-resource-candidate">
          <b>{{ candidate.resource_id || '未匹配人员' }}</b>
          <span>{{ candidate.business_date }} · {{ formatBusinessDateTime(candidate.start) }} 至 {{ hasCandidateEnd(candidate) ? formatBusinessDateTime(candidate.end) : '待补结束' }}</span>
          <small>{{ candidate.evidence }}</small>
          <small v-if="candidate.reason">{{ candidate.reason }}</small>
          <span class="pm-badge" :class="candidate.complete ? 'normal' : '风险'">{{ candidate.complete ? (candidate.auto_confirmable ? '强证据可自动确认' : '完整待登记') : '不完整' }}</span>
          <button type="button" :disabled="!candidate.complete || !candidate.resource_id || !canRecord" @click="applyCandidate(candidate)">{{ candidate.auto_confirmable ? '登记并自动确认' : '登记候选' }}</button>
        </article>
      </div>
      <p v-else-if="!candidatesLoading && !candidatesError" class="pm-empty-mini">当前服务项暂无现场事件候选。</p>
    </section>

    <section v-if="canCapacity && active" class="pm-resource-automation-block">
      <header><h4>容量自动生成</h4><span>{{ resource?.resource_name || resource?.resource_id || '未选资源' }}</span></header>
      <div class="pm-resource-form">
        <label>开始日期<input v-model="generateFrom" type="date" /></label>
        <label>结束日期<input v-model="generateTo" type="date" /></label>
        <button type="button" :disabled="generateBusy || !canGenerate" @click="generate">{{ generateBusy ? '正在生成…' : '按组织日历生成容量' }}</button>
      </div>
      <p v-if="generateError" role="alert">{{ generateError }}</p>
      <p v-if="generateNotice" role="status">{{ generateNotice }}</p>
      <ul v-if="generateResults.length" class="pm-resource-results">
        <li v-for="row in generateResults" :key="row.business_date">
          {{ row.business_date }} · {{ row.status }} · {{ row.minutes }} 分钟
          <small v-if="row.message">{{ row.message }}</small>
        </li>
      </ul>
    </section>

    <section v-if="canCapacity && active" class="pm-resource-automation-block">
      <header><h4>请假 / 加班 / 停机 / 假日例外</h4><span>{{ exceptions.length }} 条</span></header>
      <div class="pm-resource-form">
        <label>例外类型<select v-model="exceptionForm.kind"><option value="LEAVE">请假</option><option value="OVERTIME">加班</option><option value="DOWNTIME">停机</option><option value="HOLIDAY">组织假日</option></select></label>
        <label>业务日<input v-model="exceptionForm.business_date" type="date" /></label>
        <label>开始<input v-model="exceptionForm.start" type="time" maxlength="5" :disabled="exceptionForm.zero" /></label>
        <label>结束<input v-model="exceptionForm.end" type="time" maxlength="5" :disabled="exceptionForm.zero" /></label>
        <label class="pm-resource-inline"><input v-model="exceptionForm.zero" type="checkbox" /> 当天容量为零</label>
        <label>依据<textarea v-model="exceptionForm.note" maxlength="1000" /></label>
        <button type="button" @click="saveException">保存例外</button>
      </div>
      <p v-if="exceptionError" role="alert">{{ exceptionError }}</p>
      <p v-if="exceptionNotice" role="status">{{ exceptionNotice }}</p>
      <ul v-if="exceptions.length" class="pm-resource-results">
        <li v-for="row in exceptions" :key="row.id">{{ row.business_date }} · {{ row.kind }} · {{ row.resource_id }} <button type="button" class="pm-link" @click="removeException(row)">删除</button></li>
      </ul>
    </section>

    <section v-if="canCapacity && active" class="pm-resource-automation-block">
      <header><h4>组织工作日历</h4><span>{{ calendarLoading ? '读取中…' : '按星期维护' }}</span></header>
      <p v-if="calendarError" role="alert">{{ calendarError }}</p>
      <p v-if="calendarNotice" role="status">{{ calendarNotice }}</p>
      <div class="pm-resource-calendar">
        <div v-for="row in calendar" :key="row.weekday" class="pm-resource-calendar-row">
          <label class="pm-resource-inline"><input v-model="row.enabled" type="checkbox" />{{ row.name }}</label>
          <input v-model="row.start" type="time" maxlength="5" :disabled="!row.enabled" />
          <input v-model="row.end" type="time" maxlength="5" :disabled="!row.enabled" />
          <button type="button" @click="saveWeekday(row)">保存</button>
        </div>
      </div>
    </section>

    <section v-if="canConfirm" class="pm-resource-automation-block">
      <header><h4>强证据自动确认策略</h4><span>{{ autoConfirm?.enabled ? '已开启' : '已关闭' }}</span></header>
      <p class="pm-resource-hint">开启后，仅当现场开始/签到/记录/签名事件链完整且服务端重算候选一致时才自动确认；历史记录不改写。</p>
      <p v-if="autoConfirmError" role="alert">{{ autoConfirmError }}</p>
      <button type="button" :disabled="autoConfirmSaving" @click="toggleAutoConfirm">{{ autoConfirm?.enabled ? '关闭自动确认' : '开启自动确认' }}</button>
    </section>
  </details>
</template>

<style scoped>
.pm-resource-automation{margin-block:16px;border:1px solid var(--border-color,#dce2eb);border-radius:8px;padding:10px}.pm-resource-automation>summary{cursor:pointer;font-weight:600}.pm-resource-automation-block{margin-block:14px;padding-block:12px;border-top:1px solid var(--border-color,#dce2eb)}.pm-resource-automation-block header{display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between}.pm-resource-form{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;margin-block:10px}.pm-resource-form label{display:flex;flex-direction:column;gap:6px}.pm-resource-inline{flex-direction:row;align-items:center}.pm-resource-candidates{display:grid;gap:8px}.pm-resource-candidate{display:grid;gap:4px;padding:10px;border:1px solid var(--border-color,#dce2eb);border-radius:8px}.pm-resource-candidate small{color:var(--pm-muted,#5b6778)}.pm-resource-results{margin:8px 0;padding-inline-start:18px}.pm-resource-calendar{display:grid;gap:6px}.pm-resource-calendar-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
</style>
