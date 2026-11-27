<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { createRequestScope } from '../../platform/shared/composables/requestScope.js'
import { formatUserError } from '../../shared/utils/userError.js'
import { businessWallClockToInstant, formatBusinessDateTime, instantToBusinessWallClock } from '../../shared/utils/businessTime.js'
import SearchableSelect from './SearchableSelect.vue'
import { penetrationParentAllows } from '../penetrationLifecycle.js'
import {
  advancePenetrationExecution,
  advancePenetrationReport,
  ensurePenetrationWorkPackage,
  findPenetrationEngineerByUsername,
  registerPenetrationReportArtifact,
  savePenetrationDecision,
  savePenetrationPlan,
  uploadServiceItemEvidence,
} from '../api/projectManagement'

const props = defineProps({
  item: { type: Object, required: true },
  session: { type: Object, default: () => ({}) },
  engineerOptions: { type: Array, default: () => [] },
  resolveEngineerName: { type: Function, default: () => '历史指派人员' },
  autoEnsure: { type: Boolean, default: false },
  compact: { type: Boolean, default: false },
})
const emit = defineEmits(['updated', 'notify'])

const workPackage = ref(props.item?.penetration_work_package || null)
const busy = ref(false)
const draftConflict = ref(false)
let savedDraft = ''
const initializedItem = ref('')
const reportFile = ref(null)
const pendingReportArtifact = ref(null)
const retryCommands = new Map()
const decision = ref({ status: 'REQUIRED', customerContact: '', communicatedAt: '', summary: '', changeReason: '' })
const plan = ref({ plannedStart: '', plannedEnd: '', engineerIDs: [], authDocNo: '', authStart: '', authEnd: '', authScope: '', testScope: '', testWindow: '', emergencyContact: '', rollbackPlan: '' })
const cancellation = ref({ reason: '', customerContact: '', communicatedAt: '', summary: '' })
const usernameSearchScope = createRequestScope()
const usernameMatch = ref(null)
const usernameSearchLoading = ref(false)
const usernameSearchError = ref(false)
let usernameSearchTimer

const engineerSelectOptions = computed(() => {
  const current = new Set(props.engineerOptions.map((option) => option.id))
  // 保留当前专项的历史指派以便查看或移除。
  const historical = (workPackage.value?.engineer_ids || [])
    .filter((id) => plan.value.engineerIDs.includes(id) && !current.has(id))
    .map((id) => ({ id, name: props.resolveEngineerName(id), description: '历史指派，当前资质不可用' }))
  const candidates = props.engineerOptions.map((option) => (
    option.id === usernameMatch.value?.userID ? { ...option, usernameKeyword: usernameMatch.value.keyword } : option
  ))
  return [...candidates, ...historical]
})

const permissionSet = computed(() => new Set(Array.isArray(props.session?.permissions) ? props.session.permissions : []))
const currentUserID = computed(() => String(props.session?.user_id || ''))
const isProjectManager = computed(() => currentUserID.value && currentUserID.value === String(props.item?.project_manager_id || ''))
const parentAllowsMutation = computed(() => penetrationParentAllows(props.item))
const canChangeDecision = computed(() => penetrationParentAllows(props.item, 'decision'))
const canManage = computed(() => parentAllowsMutation.value && isProjectManager.value && permissionSet.value.has('project.implementation.plan'))

// 用途：防抖查询登录用户名，并将已通过资格校验的匹配加入本地下拉搜索。
// 参数：input 为用户名、姓名或其他用户输入的搜索词。
// 返回值：无；本地姓名、资质搜索保持即时，旧请求不得覆盖当前查询。
function searchEngineerUsername(input) {
  clearTimeout(usernameSearchTimer)
  usernameSearchScope.invalidate()
  usernameMatch.value = null
  usernameSearchLoading.value = false
  usernameSearchError.value = false
  const keyword = input.trim()
  if (!canManage.value || !props.engineerOptions.length || !/^[!-~]{1,128}$/.test(keyword)) return
  const itemID = props.item.id
  const ticket = usernameSearchScope.begin(itemID)
  usernameSearchLoading.value = true
  usernameSearchTimer = setTimeout(async () => {
    try {
      const result = await findPenetrationEngineerByUsername(itemID, keyword)
      if (!usernameSearchScope.isCurrent(ticket)) return
      usernameMatch.value = { keyword, userID: result?.user_id }
    } catch {
      if (usernameSearchScope.isCurrent(ticket)) usernameSearchError.value = true
    } finally {
      if (usernameSearchScope.isCurrent(ticket)) usernameSearchLoading.value = false
    }
  }, 250)
}

watch(() => [props.item.id, props.session?.tenant_id, currentUserID.value, canManage.value],
  () => searchEngineerUsername(''))
onBeforeUnmount(() => clearTimeout(usernameSearchTimer))
const canExecute = computed(() => parentAllowsMutation.value && permissionSet.value.has('project.field.execute') && (workPackage.value?.engineer_ids || []).includes(currentUserID.value))
const reportPermission = computed(() => ({
  DRAFTING: 'project.report.prepare', SUBMITTED: 'project.report.prepare', APPROVED: 'project.report.review',
  ISSUED: 'project.report.issue', ARCHIVED: 'project.report.archive',
}))
const reportNext = computed(() => ({ NONE: 'DRAFTING', DRAFTING: 'SUBMITTED', SUBMITTED: 'APPROVED', APPROVED: 'ISSUED', ISSUED: 'ARCHIVED' })[workPackage.value?.report_status] || '')
const canAdvanceReport = computed(() => Boolean(parentAllowsMutation.value && reportNext.value && permissionSet.value.has(reportPermission.value[reportNext.value])))
const decisionLabel = computed(() => ({ PENDING: '待与客户确认', REQUIRED: '确认开展', NOT_REQUIRED: '不开展' })[workPackage.value?.decision_status] || '尚未建立')
const executionLabel = computed(() => ({ NOT_STARTED: '未开始', IN_PROGRESS: '测试中', COMPLETED: '已完成', CANCELLED: '已取消' })[workPackage.value?.execution_status] || '—')
const reportLabel = computed(() => ({ NONE: '未开始', DRAFTING: '编制中', SUBMITTED: '待审核', APPROVED: '已审核', ISSUED: '已签发', ARCHIVED: '已归档' })[workPackage.value?.report_status] || '—')
const reportActionLabel = computed(() => ({ DRAFTING: '开始编制', SUBMITTED: '提交审核', APPROVED: '审核通过', ISSUED: '签发报告', ARCHIVED: '归档报告' })[reportNext.value] || '')

function localDate(value) {
  // 回填按北京墙钟（与下方 rfc3339 互为逆运算），不跟随浏览器时区。
  if (!value) return ''
  return instantToBusinessWallClock(value)
}
function rfc3339(value) {
  // 提交侧：datetime-local 取值按北京墙钟解释再换算为 UTC 瞬间。
  if (!value) return ''
  return businessWallClockToInstant(value)
}
function notify(message, type = 'success') { emit('notify', { message: formatUserError(message, { fallback: '专项操作未完成，请核对当前状态后再操作。' }), type }) }
function retryKey(name, payload) {
  const signature = JSON.stringify(payload)
  const current = retryCommands.get(name)
  if (current?.signature === signature) return current.key
  const random = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`
  const next = { signature, key: `penetration-ui-${name}-${random}`.slice(0, 128) }
  retryCommands.set(name, next)
  return next.key
}
function commandSucceeded(name) { retryCommands.delete(name) }
// 用途：应用本人操作的受权回执并同步表单基准。
// 参数：next 为服务端返回的持久工作包。
// 返回值：无。
function accept(next) {
  workPackage.value = next
  resetPackageDraft()
  emit('updated', next)
}
// 用途：把当前工作包版本映射到三个可编辑表单。
// 参数：value 为有权读取的工作包。
// 返回值：无；设置草稿比较基准。
function fillForms(value) {
  if (!value) return
  decision.value = {
    status: value.decision_status === 'NOT_REQUIRED' ? 'NOT_REQUIRED' : 'REQUIRED',
    customerContact: value.customer_contact || '', communicatedAt: localDate(value.communicated_at),
    summary: value.communication_summary || '', changeReason: '',
  }
  plan.value = {
    plannedStart: localDate(value.planned_start), plannedEnd: localDate(value.planned_end),
    engineerIDs: [...(value.engineer_ids || [])], authDocNo: value.auth_doc_no || '',
    authStart: localDate(value.auth_start), authEnd: localDate(value.auth_end), authScope: value.auth_scope || '',
    testScope: value.test_scope || '', testWindow: value.test_window || '', emergencyContact: value.emergency_contact || '',
    rollbackPlan: value.rollback_plan || '',
  }
  cancellation.value = { reason: '', customerContact: value.customer_contact || '', communicatedAt: localDate(value.communicated_at), summary: '' }
  savedDraft = packageDraft()
}

// 用途：检测专项表单自上一次读取后是否有用户输入。
// 参数：无。
// 返回值：当前三个表单的比较值。
function packageDraft() { return JSON.stringify([decision.value, plan.value, cancellation.value]) }

// 用途：让用户确认采用最新服务端版本，并以该版本重新初始化草稿。
// 参数：无。
// 返回值：无。
function resetPackageDraft() {
  draftConflict.value = false
  fillForms(workPackage.value)
}


async function ensurePackage() {
  if (!canManage.value || busy.value || workPackage.value) return
  busy.value = true
  try {
    const key = retryKey('ensure', { expected_version: props.item.version })
    accept(await ensurePenetrationWorkPackage(props.item.id, props.item.version, key))
    commandSucceeded('ensure')
    notify('渗透测试专项已建立，请记录与客户确认的结论')
  } catch (error) { notify(formatUserError(error, { fallback: '专项建立失败' }), 'error') }
  finally { busy.value = false }
}

// 用途：仅在父项允许变更时提交客户沟通结论。
// 参数：无；读取当前表单、专项版本及父项状态。
// 返回值：无；成功更新专项，失败保留草稿并提示原因。
async function submitDecision() {
  if (!workPackage.value || !canManage.value || !canChangeDecision.value || busy.value || draftConflict.value) return
  busy.value = true
  try {
    const payload = {
      decision_status: decision.value.status,
      customer_contact: decision.value.customerContact,
      communicated_at: rfc3339(decision.value.communicatedAt),
      communication_summary: decision.value.summary,
      change_reason: decision.value.changeReason,
      expected_version: workPackage.value.version,
    }
    accept(await savePenetrationDecision(props.item.id, payload, retryKey('decision', payload)))
    commandSucceeded('decision')
    notify('客户沟通结论已保存')
  } catch (error) { notify(formatUserError(error, { fallback: '沟通结论保存失败' }), 'error') }
  finally { busy.value = false }
}

// 用途：保存当前版本的专项计划。
// 参数：无。
// 返回值：无；成功使用服务端回执更新。
async function submitPlan() {
  if (!workPackage.value || busy.value || draftConflict.value) return
  busy.value = true
  try {
    const payload = {
      planned_start: rfc3339(plan.value.plannedStart), planned_end: rfc3339(plan.value.plannedEnd), engineer_ids: plan.value.engineerIDs,
      auth_doc_no: plan.value.authDocNo, auth_start: rfc3339(plan.value.authStart), auth_end: rfc3339(plan.value.authEnd),
      auth_scope: plan.value.authScope, test_scope: plan.value.testScope, test_window: plan.value.testWindow,
      emergency_contact: plan.value.emergencyContact, rollback_plan: plan.value.rollbackPlan,
      expected_version: workPackage.value.version,
    }
    accept(await savePenetrationPlan(props.item.id, payload, retryKey('plan', payload)))
    commandSucceeded('plan')
    notify('专项计划与授权信息已保存')
  } catch (error) { notify(formatUserError(error, { fallback: '专项计划保存失败' }), 'error') }
  finally { busy.value = false }
}

// 用途：对当前版本执行开始、完成或取消操作。
// 参数：action 为用户明确选择的操作。
// 返回值：无；根据真实回执更新或反馈错误。
async function execute(action) {
  if (!workPackage.value || busy.value || draftConflict.value) return
  busy.value = true
  try {
    const payload = { action, expected_version: workPackage.value.version }
    if (action === 'CANCEL') Object.assign(payload, {
      reason: cancellation.value.reason, customer_contact: cancellation.value.customerContact,
      communicated_at: rfc3339(cancellation.value.communicatedAt), communication_summary: cancellation.value.summary,
    })
    const commandName = `execution-${action.toLowerCase()}`
    accept(await advancePenetrationExecution(props.item.id, payload, retryKey(commandName, payload)))
    commandSucceeded(commandName)
    notify(action === 'START' ? '渗透测试已开始' : action === 'COMPLETE' ? '渗透测试已完成' : '专项已取消并归入不开展')
  } catch (error) { notify(formatUserError(error, { fallback: '专项执行状态更新失败' }), 'error') }
  finally { busy.value = false }
}

// 用途：将已选择报告作为当前版本的证据登记。
// 参数：无。
// 返回值：无；失败保留待核对的证据引用。
async function uploadReport() {
  if (draftConflict.value) return
  if (!workPackage.value || !(reportFile.value instanceof File) || busy.value) { notify('请选择 PDF 专项报告', 'warning'); return }
  busy.value = true
  try {
    if (!pendingReportArtifact.value) pendingReportArtifact.value = await uploadServiceItemEvidence(props.item.id, 'REPORT', reportFile.value)
    const payload = { ...pendingReportArtifact.value, expected_version: workPackage.value.version }
    accept(await registerPenetrationReportArtifact(props.item.id, payload, retryKey('report-artifact', payload)))
    commandSucceeded('report-artifact')
    pendingReportArtifact.value = null
    reportFile.value = null
    notify('专项报告文件已登记')
  } catch (error) { notify(formatUserError(error, { fallback: '专项报告上传失败' }), 'error') }
  finally { busy.value = false }
}

// 用途：按当前版本推进专项报告节点。
// 参数：无。
// 返回值：无；写入结果以服务端回执为准。
async function advanceReport() {
  if (!workPackage.value || !reportNext.value || busy.value || draftConflict.value) return
  busy.value = true
  try {
    const payload = { phase: reportNext.value, expected_version: workPackage.value.version }
    const commandName = `report-${reportNext.value.toLowerCase()}`
    accept(await advancePenetrationReport(props.item.id, payload, retryKey(commandName, payload)))
    commandSucceeded(commandName)
    notify(`专项报告已推进至${reportLabel.value}`)
  } catch (error) { notify(formatUserError(error, { fallback: '专项报告推进失败' }), 'error') }
  finally { busy.value = false }
}

watch(() => [props.item?.id, props.item?.penetration_work_package || null], ([itemID, next], [oldID] = []) => {
  const sameItem = itemID === oldID
  const samePackage = next?.id && next.id === workPackage.value?.id
  if (sameItem && samePackage && Number(next.version) <= Number(workPackage.value.version)) return
  if (sameItem && !next && !workPackage.value) return
  const keepDraft = sameItem && next?.id && next.id === workPackage.value?.id
    && (draftConflict.value || packageDraft() !== savedDraft)
  workPackage.value = next
  if (keepDraft) draftConflict.value = true
  else resetPackageDraft()
  if (props.autoEnsure && itemID && initializedItem.value !== itemID) {
    initializedItem.value = itemID
    ensurePackage()
  }
}, { immediate: true, deep: false })
</script>

<template>
  <article class="pen-package" :class="{ compact }">
    <header>
      <div><small>父服务项附属工作 · 不计入服务项与结算</small><h3>渗透测试专项</h3></div>
      <div class="pen-statuses"><span>{{ decisionLabel }}</span><span v-if="workPackage">{{ executionLabel }}</span><span v-if="workPackage">报告：{{ reportLabel }}</span></div>
    </header>
    <p v-if="draftConflict" role="status">专项版本已变化，已保留当前输入。
      <button class="pm-button" type="button" :disabled="busy" @click="resetPackageDraft">采用最新版本</button>
    </p>

    <div v-if="!workPackage" class="pen-empty">
      <p>{{ canManage ? '该历史等保服务项尚未建立专项记录，可按需建立。' : '专项将在项目经理进入实施计划时建立。' }}</p>
      <button v-if="canManage && !compact" class="pm-button primary" type="button" :disabled="busy || draftConflict" @click="ensurePackage">建立专项工作包</button>
    </div>

    <template v-else>
      <dl class="pen-summary">
        <div><dt>客户联系人</dt><dd>{{ workPackage.customer_contact || '待确认' }}</dd></div>
        <div><dt>沟通时间</dt><dd>{{ workPackage.communicated_at ? formatBusinessDateTime(workPackage.communicated_at) : '待确认' }}</dd></div>
        <div><dt>专项工程师</dt><dd>{{ (workPackage.engineer_ids || []).length ? `${workPackage.engineer_ids.length} 人` : '待指派' }}</dd></div>
        <div><dt>版本</dt><dd>v{{ workPackage.version }}</dd></div>
      </dl>
      <p v-if="workPackage.communication_summary" class="pen-note">沟通结论：{{ workPackage.communication_summary }}</p>

      <section v-if="canManage && canChangeDecision && (workPackage.decision_status !== 'REQUIRED' || workPackage.execution_status === 'NOT_STARTED')" class="pen-form">
        <h4>{{ workPackage.decision_status === 'PENDING' ? '记录客户沟通结论' : '变更开展结论' }}</h4>
        <div class="pen-choice"><label><input v-model="decision.status" type="radio" value="REQUIRED" />开展</label><label><input v-model="decision.status" type="radio" value="NOT_REQUIRED" />不开展</label></div>
        <label><span>客户联系人 *</span><input v-model.trim="decision.customerContact"  maxlength="128"/></label>
        <label><span>沟通时间 *</span><input v-model="decision.communicatedAt" type="datetime-local" /></label>
        <label class="wide"><span>沟通结论 *</span><textarea v-model.trim="decision.summary" rows="2" maxlength="2000"></textarea></label>
        <label v-if="workPackage.decision_status !== 'PENDING' && workPackage.decision_status !== decision.status" class="wide"><span>结论变更原因 *</span><textarea v-model.trim="decision.changeReason" rows="2" maxlength="1000"></textarea></label>
        <button class="pm-button primary" type="button" :disabled="busy || draftConflict" @click="submitDecision">保存沟通结论</button>
      </section>

      <section v-if="workPackage.decision_status === 'REQUIRED'" class="pen-stage">
        <div class="pen-stage-head"><h4>专项计划与授权边界</h4><span>{{ workPackage.auth_doc_no || '待补充授权' }}</span></div>
        <div v-if="canManage && ['NOT_STARTED', 'CANCELLED'].includes(workPackage.execution_status)" class="pen-form">
          <label><span>计划开始 *</span><input v-model="plan.plannedStart" type="datetime-local" /></label>
          <label><span>计划结束 *</span><input v-model="plan.plannedEnd" type="datetime-local" /></label>
          <div class="pen-field wide">
            <span>渗透测试工程师 *</span>
            <SearchableSelect v-model="plan.engineerIDs" :options="engineerSelectOptions" value-key="id"
              label-key="name" description-key="description" multiple aria-label="选择渗透测试工程师"
              placeholder="选择具备渗透测试资质的人员" search-placeholder="搜索用户名、姓名、资质编号或能力编码"
              :loading="usernameSearchLoading" @search="searchEngineerUsername"
              :empty-text="usernameSearchError ? '用户名查询暂不可用，请按姓名或资质编号搜索' : '没有匹配的有效渗透测试人员'" />
          </div>
          <p class="pen-note wide">以下信息可留空保存，请在开始测试前补齐。</p>
          <label><span>授权书编号</span><input v-model.trim="plan.authDocNo" maxlength="128" /></label>
          <label><span>授权生效</span><input v-model="plan.authStart" type="datetime-local" /></label>
          <label><span>授权截止</span><input v-model="plan.authEnd" type="datetime-local" /></label>
          <label class="wide"><span>授权范围</span><textarea v-model.trim="plan.authScope" rows="2" placeholder="多个边界使用逗号分隔" maxlength="5000"></textarea></label>
          <label class="wide"><span>测试范围</span><textarea v-model.trim="plan.testScope" rows="2" placeholder="须在授权范围内" maxlength="5000"></textarea></label>
          <label><span>测试时间窗</span><input v-model.trim="plan.testWindow" placeholder="例如 00:00-06:00" maxlength="128" /></label>
          <label><span>应急联系人</span><input v-model.trim="plan.emergencyContact" placeholder="姓名 + 电话" maxlength="128" /></label>
          <label class="wide"><span>回滚方案</span><textarea v-model.trim="plan.rollbackPlan" rows="2" maxlength="5000"></textarea></label>
          <button class="pm-button primary" type="button" :disabled="busy || draftConflict" @click="submitPlan">保存专项计划</button>
        </div>
        <dl v-else class="pen-summary details">
          <div><dt>计划窗口</dt><dd>{{ workPackage.planned_start ? `${formatBusinessDateTime(workPackage.planned_start)} 至 ${formatBusinessDateTime(workPackage.planned_end)}` : '待制定' }}</dd></div>
          <div><dt>授权范围</dt><dd>{{ workPackage.auth_scope || '待补充' }}</dd></div>
          <div><dt>测试范围</dt><dd>{{ workPackage.test_scope || '待补充' }}</dd></div>
          <div><dt>应急 / 回滚</dt><dd>{{ workPackage.emergency_contact || '待补充' }} / {{ workPackage.rollback_plan || '待补充' }}</dd></div>
        </dl>

        <div v-if="!compact" class="pen-actions">
          <button v-if="canExecute && workPackage.execution_status === 'NOT_STARTED'" class="pm-button primary" type="button" :disabled="busy || draftConflict" @click="execute('START')">开始测试</button>
          <button v-if="canExecute && workPackage.execution_status === 'IN_PROGRESS'" class="pm-button primary" type="button" :disabled="busy || draftConflict" @click="execute('COMPLETE')">确认测试完成</button>
        </div>

        <div v-if="!compact && canManage && ['NOT_STARTED', 'IN_PROGRESS'].includes(workPackage.execution_status)" class="pen-form cancellation">
          <h4>取消专项并归入不开展</h4>
          <label><span>客户联系人 *</span><input v-model.trim="cancellation.customerContact"  maxlength="128"/></label>
          <label><span>沟通时间 *</span><input v-model="cancellation.communicatedAt" type="datetime-local" /></label>
          <label class="wide"><span>最新沟通结论 *</span><textarea v-model.trim="cancellation.summary" rows="2" maxlength="2000"></textarea></label>
          <label class="wide"><span>取消原因 *</span><textarea v-model.trim="cancellation.reason" rows="2" maxlength="1000"></textarea></label>
          <button class="pm-button danger" type="button" :disabled="busy || draftConflict" @click="execute('CANCEL')">取消专项</button>
        </div>
      </section>

      <section v-if="!compact && workPackage.execution_status === 'COMPLETED'" class="pen-stage">
        <div class="pen-stage-head"><h4>独立专项报告</h4><span>R{{ workPackage.report_revision }}</span></div>
        <div v-if="workPackage.report_status === 'DRAFTING' && permissionSet.has('project.report.prepare')" class="pen-upload">
          <input type="file" accept="application/pdf" @change="reportFile = $event.target.files?.[0] || null; pendingReportArtifact = null" />
          <button class="pm-button" type="button" :disabled="busy || draftConflict" @click="uploadReport">上传专项报告</button>
        </div>
        <button v-if="canAdvanceReport" class="pm-button primary" type="button" :disabled="busy || draftConflict" @click="advanceReport">{{ reportActionLabel }}</button>
      </section>
    </template>
  </article>
</template>

<style scoped>
.pen-package{margin:18px 0;padding:20px;border:1px solid #c9dcf6;border-radius:16px;background:linear-gradient(145deg,#f7fbff,#fff);box-shadow:0 8px 24px #1d4ed80d}.pen-package>header,.pen-stage-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px}.pen-package h3,.pen-package h4{margin:3px 0 0;color:#172033}.pen-package header small{color:#64748b}.pen-statuses{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:6px}.pen-statuses span,.pen-stage-head span{padding:5px 9px;border-radius:999px;background:#e8f1ff;color:#1d4ed8;font-size:12px}.pen-empty,.pen-note{color:#64748b}.pen-summary{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin:16px 0}.pen-summary div{padding:10px;border-radius:10px;background:#f3f7fc}.pen-summary dt{font-size:12px;color:#64748b}.pen-summary dd{margin:5px 0 0;color:#172033;overflow-wrap:anywhere}.pen-summary.details{grid-template-columns:repeat(2,minmax(0,1fr))}.pen-form{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-top:16px;padding:16px;border-radius:12px;background:#f5f8fc}.pen-form h4,.pen-form .wide,.pen-form>.pm-button,.pen-choice{grid-column:1/-1}.pen-form label,.pen-field{display:grid;gap:6px;color:#44516a;font-size:13px}.pen-form input,.pen-form textarea{box-sizing:border-box;width:100%;padding:9px 11px;border:1px solid #cbd5e1;border-radius:8px;background:#fff;color:#172033}.pen-choice{display:flex;gap:20px}.pen-choice label{display:flex;grid-template-columns:auto 1fr;align-items:center}.pen-choice input{width:auto}.pen-stage{margin-top:18px;padding-top:16px;border-top:1px solid #dde7f2}.pen-actions,.pen-upload{display:flex;align-items:center;gap:10px;margin-top:14px}.cancellation{border:1px solid #fecaca;background:#fff7f7}.compact .pen-form{display:none}.compact{padding:16px}.compact .pen-summary{grid-template-columns:repeat(2,minmax(0,1fr))}@media(max-width:900px){.pen-summary,.pen-summary.details,.pen-form{grid-template-columns:1fr}.pen-package>header{display:grid}.pen-statuses{justify-content:flex-start}}

/* 深色主题：渗透工作包卡片写死的浅蓝底、白输入框与墨色；浅色声明未改。 */
[data-theme="dark"] .pen-package{border-color:var(--border);background:linear-gradient(145deg,var(--surface-tint),var(--surface-card));box-shadow:var(--shadow-raised)}
[data-theme="dark"] .pen-package h3,[data-theme="dark"] .pen-package h4,[data-theme="dark"] .pen-summary dd{color:var(--text)}
[data-theme="dark"] .pen-package header small,[data-theme="dark"] .pen-empty,[data-theme="dark"] .pen-note,[data-theme="dark"] .pen-summary dt{color:var(--text-muted)}
[data-theme="dark"] .pen-statuses span,[data-theme="dark"] .pen-stage-head span{background:var(--chip-brand);color:var(--primary-ink-strong)}
[data-theme="dark"] .pen-summary div{background:var(--surface-muted)}
[data-theme="dark"] .pen-form{background:var(--surface-muted)}
[data-theme="dark"] .pen-form label,[data-theme="dark"] .pen-field{color:var(--text-secondary)}
[data-theme="dark"] .pen-form input,[data-theme="dark"] .pen-form textarea{border-color:var(--border);background:var(--surface-input);color:var(--text)}
[data-theme="dark"] .pen-stage{border-top-color:var(--border)}
[data-theme="dark"] .cancellation{border-color:var(--danger-border);background:var(--danger-soft)}
</style>
