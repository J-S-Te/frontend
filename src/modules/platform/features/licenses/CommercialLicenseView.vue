<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import RuntimeEnforcementView from './RuntimeEnforcementView.vue'
import LicenseProblem from './LicenseProblem.vue'
import LicenseAppCard from './LicenseAppCard.vue'
import LicenseEventRow from './LicenseEventRow.vue'
import LicenseEventsSheet from './LicenseEventsSheet.vue'
import ConsoleIcon from '@/modules/shared/components/ConsoleIcon.vue'
import { hasPermission } from '../../auth/utils/principal.js'
import { MAX_LICENSE_BYTES, commitLicense, getLicenseEvents, getLicenseRequest, getLicenseStatus, initializeLicense, previewLicense, restoreLicenseClock, validateLicenseInput } from './api.js'
import { expiryMeta, formatLicenseTime, licenseEventName, licensedOnly, licenseRows, previewCanCommit, riskyChange, statusRows, systemName } from './presentation.js'
import { buildApplicationRows, licenseSteps, overallState, reasonHintOf, runtimeEnforcementInfo, runtimeEnforcementSourceLabel } from './license-state.js'
import { CLOCK_RECOVERY_CONFIRMATION, CLOCK_RECOVERY_FAILURE_NEXT, CLOCK_RECOVERY_READONLY_HINT, CLOCK_RECOVERY_RISKS, CLOCK_RECOVERY_SUCCESS, clockRecoveryReady, clockRecoverySubmitted } from './clock-recovery.js'
import { loadApplicationEnforcement } from './runtime-api.js'
import { formatUserError, safeUserMessage, userErrorDiagnostics } from '../../../shared/utils/userError.js'
import ListState from '@/modules/shared/components/ListState.vue'

const emit = defineEmits(['toast'])
const canRead = computed(() => hasPermission('platform:license:read'))
const canManage = computed(() => hasPermission('platform:license:manage'))

const status = ref(null)
const loading = ref(false)
const busy = ref(false)
// 三处问题各自独立：读取失败整页降级；初始化/下载失败走顶部；导入预览与提交贴在导入区里。
const statusProblem = ref(emptyProblem())
const actionProblem = ref(emptyProblem())
const importProblem = ref(emptyProblem())
function emptyProblem() { return { message: '', code: '', requestId: '', nextAction: '' } }
// problemOf 用途：把异常收敛成「人话 + 下一步 + 可复制的错误码/请求标识」。
// 参数：error 为接口异常，fallback 为兜底文案。
// 返回值：返回 LicenseProblem 需要的字段，不含任何内部细节。
function problemOf(error, fallback) {
  const diagnostic = userErrorDiagnostics(error)
  return {
    message: message(error, fallback),
    code: diagnostic.code,
    requestId: diagnostic.requestId,
    nextAction: safeUserMessage(error?.nextAction) || '',
  }
}

const customerID = ref('')
const environment = ref('')
const raw = ref('')
const preview = ref(null)
const confirmChanges = ref(false)
const confirmReplacement = ref(false)
const dragActive = ref(false)
const importOpen = ref(false)

const initialized = computed(() => Boolean(status.value?.initialized))
// 当前授权只展示许可证覆盖的系统；未购买系统不出现在页面。
const rows = computed(() => licensedOnly(statusRows(status.value)))
const soonestExpiry = computed(() => {
  const times = rows.value.map(row => row.application?.expires_at).filter(Boolean)
  return times.length ? Math.min(...times) : null
})
const pendingRows = computed(() => status.value?.pending ? licenseRows(status.value.pending).filter(item => item.application) : [])
// 顶层 runtime_enforcement 决定是否显示“未接入聚合”的说明；NOT_CONNECTED 是旧后端的写法。
const runtimeEnforcement = computed(() => runtimeEnforcementInfo(status.value?.runtime_enforcement))
const runtimeEnforcementSource = computed(() => status.value?.runtime_enforcement_source || '')
// 只有聚合可用时才展示来源枚举，避免“逐应用概览 + 聚合来源”这种自相矛盾的组合。
const runtimeSourceLabel = computed(() => runtimeEnforcement.value.key === 'AVAILABLE' ? runtimeEnforcementSourceLabel(runtimeEnforcementSource.value) : '')

// 执行事实优先用 systems[].enforcement 聚合；只有该字段整个缺失（旧后端）的系统
// 才需要回退到逐应用概览，避免每次打开页面都打一轮 N+1。
const enforcementByApp = ref({})
const enforcementLoading = ref(false)
const enforcementFallbackCodes = computed(() => rows.value.filter(row => row.enforcement === undefined).map(row => row.code))
let enforcementTurn = 0
async function loadEnforcementSummary() {
  if (!canRead.value) return
  const codes = enforcementFallbackCodes.value
  if (!codes.length) { enforcementByApp.value = {}; return }
  const turn = ++enforcementTurn
  enforcementLoading.value = true
  try {
    const result = await loadApplicationEnforcement(codes)
    if (turn === enforcementTurn) enforcementByApp.value = result
  } finally {
    if (turn === enforcementTurn) enforcementLoading.value = false
  }
}
const appRows = computed(() => buildApplicationRows(rows.value, enforcementByApp.value, { canManage: canManage.value, hasPending: Boolean(status.value?.pending) }))
const overall = computed(() => overallState({ status: status.value, appRows: appRows.value, canManage: canManage.value }))
const steps = computed(() => licenseSteps({ status: status.value, appRows: appRows.value }))

const dangerousChanges = computed(() => preview.value?.requires_change_confirmation || preview.value?.changes?.some(riskyChange))
const commitAllowed = computed(() => canManage.value && !busy.value && !loading.value && previewCanCommit(preview.value, confirmChanges.value, confirmReplacement.value))

function clearPreview() {
  preview.value = null
  confirmChanges.value = false
  confirmReplacement.value = false
}
watch(raw, clearPreview)

// 授权事件：页内只保留最近几条「单行摘要」，完整列表进右侧抽屉（服务端分页 20 条/页）。
// 摘要条数由 matchMedia 派生而不是 CSS 隐藏：计数文案与真实行数必须一致，
// 否则窄屏会出现「显示最近 5 条」但只看得见 3 行。≤720px 取 3 条，其余取 5 条。
const events = ref({ items: [], total: null, page: 1 })
const eventsLoading = ref(false)
const eventsRefreshing = ref(false)
const eventsError = ref('')
const eventsSheetOpen = ref(false)
const eventsTrigger = ref(null)
// 同一个 matchMedia 既给初值也给后续监听，避免两处各建一个查询对象。
let narrowMedia = typeof matchMedia === 'function' ? matchMedia('(max-width:720px)') : null
const narrowViewport = ref(Boolean(narrowMedia?.matches))
function syncNarrowViewport(event) { narrowViewport.value = Boolean(event.matches) }
// 三态闸门：加载中 / 加载失败 / 没有事件都交给 ListState，失败时绝不渲染成「暂无授权事件」。
const eventsListState = computed(() => eventsLoading.value || Boolean(eventsError.value) || !events.value.items.length)
const recentLimit = computed(() => (narrowViewport.value ? 3 : 5))
const recentEvents = computed(() => events.value.items.slice(0, recentLimit.value))
// total 未知（失败后）显示「—」而不是 0，避免把「没读到」伪装成「一条都没有」。
const eventsTotalLabel = computed(() => (Number.isFinite(events.value.total) ? events.value.total : '—'))

// message 用途：用户可读的失败原因；状态冲突单独给出可执行指引。
// 参数：error 为接口异常。
// 返回值：返回一句中文提示，绝不回显本地实现细节或服务端内部信息。
function message(error, fallback = '商业授权操作失败，请重试。') {
  return error?.status === 409 && error?.code === 'LICENSE_VERSION_CONFLICT' ? '授权状态已变更，请刷新并重新预览后提交。' : formatUserError(error, { fallback })
}
/* loadEvents：读取指定页的授权事件；已有行时按后台刷新处理，不把列表打回 loading。
   失败时清掉旧快照，错误态旁边不会继续挂着上一页的 total / 0 条。 */
async function loadEvents(page = 1) {
  if (!canRead.value || eventsLoading.value || eventsRefreshing.value) return
  if (events.value.items.length) eventsRefreshing.value = true
  else eventsLoading.value = true
  eventsError.value = ''
  try { events.value = await getLicenseEvents(page) }
  catch (error) {
    events.value = { items: [], total: null, page: 1 }
    eventsError.value = formatUserError(error, { fallback: '授权事件读取失败，请重试。' })
  }
  finally { eventsLoading.value = false; eventsRefreshing.value = false }
}
// openEventsSheet 用途：打开右侧抽屉（抽屉打开时自己回第 1 页并加载）。
// 参数：无。
// 返回值：无；未加载时的紧凑 loading 由抽屉自己显示，不会先闪一条「0 条」。
function openEventsSheet() {
  eventsSheetOpen.value = true
}
// closeEventsSheet 用途：关闭抽屉并把键盘焦点交还给「查看全部」入口按钮。
// 参数：无。
// 返回值：无。
async function closeEventsSheet() {
  eventsSheetOpen.value = false
  await nextTick()
  eventsTrigger.value?.focus?.({ preventScroll: true })
}
async function load() {
  if (!canRead.value || loading.value || busy.value) return
  loading.value = true
  statusProblem.value = emptyProblem()
  actionProblem.value = emptyProblem()
  clearPreview()
  try {
    status.value = await getLicenseStatus()
    environment.value = status.value.configured_environment || ''
    importOpen.value = !status.value.current
    await Promise.all([loadEvents(), loadEnforcementSummary()])
  } catch (error) {
    status.value = null
    statusProblem.value = problemOf(error, '商业授权状态读取失败，请重试。')
  } finally { loading.value = false }
}
// manage 用途：串行化写操作，并把失败文案落到调用方指定的位置。
// 参数：action 为写操作，target 为 'action' 或 'import'。
// 返回值：成功返回 true，失败返回 false（不抛错、不自动重试）。
async function manage(action, target = 'action') {
  if (!canManage.value || busy.value || loading.value) return false
  busy.value = true
  actionProblem.value = emptyProblem()
  importProblem.value = emptyProblem()
  try {
    await action()
    return true
  } catch (error) {
    const problem = problemOf(error, '商业授权操作失败，请重试。')
    if (target === 'import') importProblem.value = problem
    else actionProblem.value = problem
    if (error?.status === 409) clearPreview()
    return false
  } finally { busy.value = false }
}

const initPanel = ref(null)
const appsPanel = ref(null)
const pendingPanel = ref(null)
const importPanel = ref(null)
const importFileInput = ref(null)
const clockPanel = ref(null)
const clockInput = ref(null)
const runtimeAnchor = ref(null)
const runtimeView = ref(null)

// 时钟恢复：一次性写凭据。凭据只存在于内存与本次请求体，不进 URL、存储或日志；
// 无论成功失败，提交尝试一结束就清空输入框并撤销勾选，必须重新粘贴 + 重新勾选才能再提交。
const clockOpen = ref(false)
const clockRaw = ref('')
const clockConfirmed = ref(false)
const clockProblem = ref(emptyProblem())
const clockReady = computed(() => clockRecoveryReady({ canManage: canManage.value, raw: clockRaw.value, confirmed: clockConfirmed.value, busy: busy.value }))
const clockEntryVisible = computed(() => canManage.value && Boolean(status.value?.clock_blocked))
// openClockRecovery 用途：展开恢复面板并把键盘焦点交给凭据输入框。
async function openClockRecovery() {
  if (!canManage.value) return focusPanel(clockPanel)
  clockOpen.value = true
  await focusPanel(clockPanel)
  clockInput.value?.focus?.({ preventScroll: true })
}
function closeClockRecovery() {
  clockOpen.value = false
  clockProblem.value = emptyProblem()
  const reset = clockRecoverySubmitted()
  clockRaw.value = reset.raw
  clockConfirmed.value = reset.confirmed
}
// submitClockRecovery 用途：校验权限与两步确认后提交一次性恢复凭据。
// 参数：无。
// 返回值：无；成功后刷新状态与事件，失败把可复制的错误码留在面板里；两种结果都立即清空输入。
async function submitClockRecovery() {
  if (!clockReady.value || !canManage.value || busy.value || loading.value) return
  const credential = clockRaw.value
  let restored = false
  busy.value = true
  clockProblem.value = emptyProblem()
  try {
    await restoreLicenseClock(credential)
    restored = true
  } catch (error) {
    clockProblem.value = { ...problemOf(error, '时钟恢复未完成，请重试。'), nextAction: CLOCK_RECOVERY_FAILURE_NEXT }
  } finally {
    busy.value = false
    // 无论成败都清空：凭据可能已被服务端消费，不能留在输入框里被再次提交。
    const reset = clockRecoverySubmitted()
    clockRaw.value = reset.raw
    clockConfirmed.value = reset.confirmed
  }
  if (!restored) return
  // 写入已经成功（凭据已消费），下面的刷新失败只影响展示，不能反过来报“恢复未完成”。
  clockOpen.value = false
  emit('toast', CLOCK_RECOVERY_SUCCESS)
  await refreshAfterWrite()
}
// refreshAfterWrite 用途：写操作成功后重新读取状态、事件与执行事实。
// 参数：无。
// 返回值：读取失败时只留下可重试的状态问题条，不覆盖已经成功的写结论。
async function refreshAfterWrite() {
  loading.value = true
  statusProblem.value = emptyProblem()
  try {
    status.value = await getLicenseStatus()
    await Promise.all([loadEvents(), loadEnforcementSummary()])
  } catch (error) {
    statusProblem.value = problemOf(error, '授权状态读取失败，请重试。')
  } finally { loading.value = false }
}

async function focusPanel(target) {
  await nextTick()
  const element = target?.value
  if (!element) return
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
  element.scrollIntoView?.({ behavior: reduced ? 'auto' : 'smooth', block: 'start' })
  element.focus?.({ preventScroll: true })
}
// openImport 用途：把唯一的“导入许可证”主行动落到导入区，并把键盘焦点交给文件选择。
async function openImport() {
  if (!canManage.value) return focusPanel(importPanel)
  importOpen.value = true
  await focusPanel(importPanel)
  importFileInput.value?.focus?.({ preventScroll: true })
}
// focusRuntime 用途：切换到指定系统的运行详情，激活仍由该区域的确认与门禁完成。
async function focusRuntime(application) {
  if (application) await runtimeView.value?.selectApplication?.(application)
  await focusPanel(runtimeAnchor)
}
async function handleAction(action) {
  if (!action) return
  if (action.target === 'import') return openImport()
  if (action.target === 'init') return focusPanel(initPanel)
  if (action.target === 'apps') return focusPanel(appsPanel)
  if (action.target === 'pending') return focusPanel(pendingPanel)
  if (action.target === 'clock') return openClockRecovery()
  if (action.target === 'refresh') return load()
  if (action.target === 'runtime') return focusRuntime(action.application || '')
}
const runRowAction = row => handleAction({ ...row.action, application: row.code })

async function initialize() {
  if (initialized.value || !customerID.value.trim() || !environment.value.trim()) return
  const done = await manage(async () => {
    await initializeLicense(customerID.value.trim(), environment.value.trim())
    status.value = await getLicenseStatus()
    await Promise.all([loadEvents(), loadEnforcementSummary()])
    emit('toast', '部署实例已初始化，可下载签发申请并导入许可证。')
  })
  if (done) { importOpen.value = true; await focusPanel(importPanel) }
}
async function downloadRequest() {
  await manage(async () => {
    const request = await getLicenseRequest()
    const url = URL.createObjectURL(new Blob([JSON.stringify(request, null, 2)], { type: 'application/json' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'commercial-license-request.json'
    anchor.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  })
}
// readLicenseFile 用途：文件选择与拖拽共用同一份校验，避免两条入口规则不一致。
async function readLicenseFile(file) {
  if (!file || busy.value || !canManage.value) return
  clearPreview()
  importProblem.value = emptyProblem()
  busy.value = true
  try {
    if (file.size > MAX_LICENSE_BYTES) throw new Error('许可证不能超过 256 KiB。')
    const text = await file.text()
    validateLicenseInput(text)
    raw.value = text
  } catch (error) { raw.value = ''; importProblem.value = problemOf(error, '许可证文件读取失败，请重新选择。') }
  finally { busy.value = false }
}
function selectFile(event) {
  const file = event.target.files?.[0]
  event.target.value = ''
  return readLicenseFile(file)
}
function dropFile(event) {
  dragActive.value = false
  return readLicenseFile(event.dataTransfer?.files?.[0])
}
async function runPreview() {
  clearPreview()
  await manage(async () => { preview.value = await previewLicense(raw.value) }, 'import')
}
async function commit() {
  if (!commitAllowed.value) return
  const done = await manage(async () => {
    await commitLicense(raw.value, preview.value, confirmChanges.value, confirmReplacement.value)
    raw.value = ''
    clearPreview()
    status.value = await getLicenseStatus()
    importOpen.value = false
    await Promise.all([loadEvents(), loadEnforcementSummary()])
    emit('toast', '许可证已导入；应用状态已刷新，请按页面提示完成激活。')
  }, 'import')
  // 导入成功后把视线带回应用状态，避免停留在“已导入”的输入框上。
  if (done) await focusPanel(rows.value.length ? appsPanel : importPanel)
}
onMounted(load)
// 摘要条数跟着视口走：只在同一个 matchMedia 上加减监听，卸载时摘掉，避免叠加。
onMounted(() => narrowMedia?.addEventListener?.('change', syncNarrowViewport))
onBeforeUnmount(() => {
  narrowMedia?.removeEventListener?.('change', syncNarrowViewport)
  narrowMedia = null
})
</script>

<template>
  <section class="license-page" aria-label="商业授权管理">
    <header class="license-header">
      <div class="license-heading">
        <span class="license-eyebrow"><ConsoleIcon name="shield" />LICENSE &amp; ENFORCEMENT</span>
        <h2>商业授权</h2>
        <p>部署绑定、签发与导入许可证，并跟踪每个系统的运行时强制执行进度。许可层面由签名许可证决定；运行执行层面需要逐应用激活，并由组件确认当前修订。</p>
      </div>
      <div class="license-header-actions">
        <span v-if="status && overall.key !== 'LOADING'" class="license-flag" :data-tone="overall.tone">{{ overall.label }}</span>
        <button type="button" class="console-button secondary" :disabled="loading || busy" @click="load"><ConsoleIcon name="reset" />{{ loading ? '读取中…' : '刷新状态' }}</button>
      </div>
    </header>

    <p v-if="!canRead" class="license-alert" role="alert">无商业授权查看权限。</p>
    <template v-else>
      <LicenseProblem
        v-if="statusProblem.message"
        title="授权状态读取失败"
        :message="statusProblem.message"
        :code="statusProblem.code"
        :request-id="statusProblem.requestId"
        :next-action="statusProblem.nextAction"
        retry-label="重新读取"
        @retry="load"
      />
      <LicenseProblem
        v-if="actionProblem.message"
        title="操作未完成"
        :message="actionProblem.message"
        :code="actionProblem.code"
        :request-id="actionProblem.requestId"
        :next-action="actionProblem.nextAction"
        retry-label="重新读取状态"
        @retry="load"
      />
      <p v-if="loading && !status" role="status" class="license-loading">正在读取授权状态…</p>

      <template v-if="status && !loading">
        <!-- 未初始化：只保留绑定客户与环境这一件事 -->
        <form v-if="!initialized" ref="initPanel" tabindex="-1" class="console-card license-init" @submit.prevent="initialize">
          <header class="license-section-head">
            <div>
              <span class="license-eyebrow">STEP 1 · 部署绑定</span>
              <h3>初始化部署实例</h3>
              <p class="license-note">首次初始化将绑定客户、环境和部署实例，之后不可更改；请与签发申请保持一致。初始化后才能导入供应商签发的许可证。</p>
            </div>
            <span class="license-flag" data-tone="warning">尚未初始化</span>
          </header>
          <template v-if="canManage">
            <div class="license-field-row">
              <label class="license-field"><span>客户标识</span><input v-model="customerID" required maxlength="128" :disabled="busy" pattern="[A-Za-z0-9._:-]+" placeholder="如 customer-a" /></label>
              <label class="license-field"><span>环境（服务端配置）</span><input :value="environment" readonly required /></label>
            </div>
            <div class="license-actions">
              <button type="submit" class="console-button primary" :disabled="busy || !customerID.trim() || !environment.trim()"><ConsoleIcon name="save" />{{ busy ? '处理中…' : '首次初始化' }}</button>
              <span class="license-note">客户标识只能包含字母、数字与 . _ : - </span>
            </div>
          </template>
          <p v-else class="license-note">需要商业授权管理权限才能初始化。</p>
        </form>

        <template v-else>
          <!-- 1 顶部摘要：总体状态 + 唯一主行动 + 进度 + 关键事实 -->
          <article class="license-hero" :data-tone="overall.tone" aria-labelledby="license-overall-title">
            <div class="license-hero-top">
              <div class="license-hero-copy">
                <span class="license-eyebrow">当前进度 {{ overall.step }}/4</span>
                <h3 id="license-overall-title" class="license-hero-title"><i class="license-hero-dot" aria-hidden="true"></i>{{ overall.label }}</h3>
                <p class="license-hero-desc">{{ overall.description }}</p>
              </div>
              <div class="license-hero-cta">
                <button v-if="overall.action.target !== 'none'" type="button" class="console-button primary" :disabled="loading || busy" @click="handleAction(overall.action)">{{ overall.action.label }}<span aria-hidden="true">→</span></button>
                <span v-else class="license-hero-cta-text">{{ overall.action.label }}</span>
                <p v-if="overall.action.hint" class="license-hero-hint">{{ overall.action.hint }}</p>
              </div>
            </div>

            <ol class="license-steps" aria-label="授权进度">
              <li v-for="(step, index) in steps" :key="step.key" :class="`is-${step.state}`">
                <i aria-hidden="true">{{ step.state === 'done' ? '✓' : index + 1 }}</i>
                <span class="license-step-label">{{ step.label }}</span>
                <small class="license-step-hint">{{ step.hint }}</small>
              </li>
            </ol>

            <dl class="license-facts">
              <div><dt>许可证版本</dt><dd>{{ status.current_version || '—' }}<small>状态修订 {{ status.revision }}</small></dd></div>
              <div><dt>授权范围</dt><dd>{{ appRows.length }} 个系统<small>已强制执行 {{ overall.counts.enforced || 0 }} 个</small></dd></div>
              <div><dt>客户标识</dt><dd class="mono">{{ status.customer_id || '—' }}</dd></div>
              <div><dt>绑定环境</dt><dd>{{ status.environment || '—' }}</dd></div>
              <div><dt>部署实例</dt><dd class="mono">{{ status.instance_id || '—' }}</dd></div>
              <div><dt>当前授权生效</dt><dd>{{ formatLicenseTime(status.current?.not_before) }}</dd></div>
              <div><dt>最近到期</dt><dd>{{ soonestExpiry ? formatLicenseTime(soonestExpiry).split(' ')[0] : '—' }}<small :data-tone="soonestExpiry ? expiryMeta(soonestExpiry).tone : 'none'">{{ soonestExpiry ? expiryMeta(soonestExpiry).label : '暂无到期项' }}</small></dd></div>
              <div><dt>执行状态来源</dt><dd>{{ runtimeEnforcement.label }}<small v-if="runtimeSourceLabel" :title="runtimeEnforcementSource">{{ runtimeSourceLabel }}</small></dd></div>
            </dl>
          </article>

          <!-- 1.5 时钟保护：唯一能解除保护的动作是提交供应商签发的一次性恢复凭据 -->
          <section v-if="status.clock_blocked" ref="clockPanel" tabindex="-1" class="console-card license-section license-clock" aria-labelledby="license-clock-title">
            <header class="license-section-head">
              <div>
                <span class="license-eyebrow"><ConsoleIcon name="info" />CLOCK PROTECTION</span>
                <h3 id="license-clock-title">时钟保护中 · 恢复时钟</h3>
                <p class="license-note">检测到系统时钟回退，所有授权判断已按失败关闭处理。只有供应商签发的一次性恢复凭据可以解除保护；刷新状态、重新导入许可证都不能恢复。</p>
              </div>
              <span class="license-flag" data-tone="danger">授权已暂停</span>
            </header>

            <template v-if="clockEntryVisible">
              <div class="license-actions">
                <button type="button" class="console-button ghost" :aria-expanded="clockOpen" aria-controls="license-clock-body" @click="clockOpen ? closeClockRecovery() : openClockRecovery()"><ConsoleIcon :name="clockOpen ? 'close' : 'reset'" />{{ clockOpen ? '收起恢复面板' : '恢复时钟' }}</button>
                <span class="license-note">恢复凭据由供应商签发，使用一次即失效。</span>
              </div>

              <div v-show="clockOpen" id="license-clock-body" class="license-clock-body">
                <ul class="license-clock-risks" aria-label="提交前的风险说明">
                  <li v-for="risk in CLOCK_RECOVERY_RISKS" :key="risk">{{ risk }}</li>
                </ul>
                <label class="license-field">
                  <span>时间恢复凭据（raw_jws）</span>
                  <textarea ref="clockInput" v-model="clockRaw" rows="3" autocomplete="off" autocapitalize="off" spellcheck="false" :disabled="busy" :maxlength="MAX_LICENSE_BYTES" placeholder="eyJhbGciOiJFZERTQSIs…" />
                </label>
                <label class="license-check license-check-risk">
                  <input v-model="clockConfirmed" type="checkbox" :disabled="busy" />
                  <span>{{ CLOCK_RECOVERY_CONFIRMATION }}</span>
                </label>
                <div class="license-actions">
                  <button type="button" class="console-button primary" :disabled="!clockReady" @click="submitClockRecovery"><ConsoleIcon name="shield" />{{ busy ? '提交中…' : '提交恢复凭据' }}</button>
                  <button type="button" class="console-button ghost" :disabled="busy" @click="closeClockRecovery">取消</button>
                  <span class="license-note">必须勾选确认后才能提交；提交后输入框自动清空。</span>
                </div>
                <LicenseProblem
                  v-if="clockProblem.message"
                  title="时钟恢复未完成"
                  :message="clockProblem.message"
                  :code="clockProblem.code"
                  :request-id="clockProblem.requestId"
                  :next-action="clockProblem.nextAction"
                  :retry="false"
                />
              </div>
            </template>
            <p v-else class="license-note license-note-strong">{{ CLOCK_RECOVERY_READONLY_HINT }}</p>
          </section>

          <!-- 2 逐应用状态：许可层面与运行执行层面分列 -->
          <section ref="appsPanel" tabindex="-1" class="console-card license-section" aria-labelledby="license-apps-title">
            <header class="license-section-head">
              <div>
                <h3 id="license-apps-title">应用授权与执行状态</h3>
                <p class="license-note">每张卡片是签名许可证状态，不代表业务系统已开放；运行时是否强制执行，请以每个系统的运行时登记与执行确认状态为准。</p>
              </div>
              <div class="license-head-actions">
                <span class="license-chip">{{ appRows.length }} 个系统</span>
                <span v-if="enforcementLoading" class="license-chip" role="status">执行状态读取中…</span>
                <template v-else-if="enforcementFallbackCodes.length">
                  <span class="license-chip">{{ enforcementFallbackCodes.length }} 个系统回退逐应用概览</span>
                  <button type="button" class="console-button ghost small" :disabled="loading || busy" @click="loadEnforcementSummary"><ConsoleIcon name="reset" />刷新执行状态</button>
                </template>
                <span v-else-if="appRows.length" class="license-chip">执行状态来自授权状态字段</span>
              </div>
            </header>

            <p v-if="runtimeEnforcement.notice" class="license-note license-note-strong">{{ runtimeEnforcement.notice }}</p>

            <ul class="license-legend" aria-label="六类状态说明">
              <li><span class="license-badge" data-tone="success">已导入</span>许可层面：验签通过且在有效期内</li>
              <li><span class="license-badge" data-tone="info">待生效</span>许可层面：已导入但未到生效时间</li>
              <li><span class="license-badge" data-tone="danger">已过期</span>许可层面：有效期已结束</li>
              <li><span class="license-badge" data-tone="warning">待激活</span>运行执行层面：满足条件但尚未提交激活</li>
              <li><span class="license-badge" data-tone="info">激活中</span>运行执行层面：已提交，等待组件确认</li>
              <li><span class="license-badge" data-tone="success">已强制执行</span>运行执行层面：组件已确认当前修订</li>
            </ul>

            <div v-if="!status.current" class="license-empty">
              <h4>尚未导入当前生效许可证</h4>
              <p>导入供应商签发的许可证后，这里会按系统分别显示许可层面与运行执行层面的状态。</p>
              <button v-if="canManage" type="button" class="console-button primary small" @click="openImport">导入许可证</button>
              <button v-else-if="status.pending" type="button" class="console-button ghost small" @click="focusPanel(pendingPanel)">查看待生效许可证</button>
              <span v-else class="license-note">需要商业授权管理权限才能导入许可证，请联系授权管理员。</span>
            </div>
            <ListState
              v-else-if="!appRows.length"
              compact
              empty-title="当前许可证未包含任何业务系统。"
              empty-description="供应商签发的许可证没有覆盖业务系统时，这里不会显示任何执行状态。"
            />
            <ul v-else class="license-app-grid" aria-label="逐系统授权与执行状态">
              <LicenseAppCard
                v-for="row in appRows"
                :key="row.code"
                :row="row"
                :busy="busy"
                :loading="loading"
                @action="runRowAction"
              />
            </ul>
          </section>

          <!-- 3 待生效许可证：导入的合法结果，不是失败 -->
          <section v-if="status.pending" ref="pendingPanel" tabindex="-1" class="console-card license-section license-pending" aria-labelledby="license-pending-title">
            <header class="license-section-head">
              <div>
                <h3 id="license-pending-title">待生效许可证 · 版本 {{ status.pending.version }}</h3>
                <p class="license-note">已导入并通过验签，尚未到达生效时间（{{ formatLicenseTime(status.pending.not_before) }}）。到达后刷新状态时由服务端自动切换为当前授权，不需要再次导入；替换它需要重新导入并显式确认。</p>
              </div>
              <span class="license-badge" data-tone="info">待生效</span>
            </header>
            <ul v-if="pendingRows.length" class="license-pending-list">
              <li v-for="row in pendingRows" :key="row.code">
                <strong>{{ row.name }}</strong>
                <span class="license-app-meta">{{ row.application.kind === 'TRIAL' ? '试用授权' : '正式授权' }} · 到期 {{ formatLicenseTime(row.application.expires_at) }}</span>
                <span class="license-badge" data-tone="info">{{ row.state }}</span>
              </li>
            </ul>
            <p v-else class="license-note">待生效许可证未包含任何业务系统。</p>
          </section>

          <!-- 4 导入区：与状态区分离，已有许可证时默认收起 -->
          <section v-if="canManage" ref="importPanel" tabindex="-1" class="console-card license-section license-import" aria-labelledby="license-import-title">
            <header class="license-section-head">
              <div>
                <h3 id="license-import-title">导入或许可证续期</h3>
                <p class="license-note">首次授权与续签同一入口：选择或粘贴供应商签发的 compact JWS（≤256 KiB）。内容仅用于本次操作，不保存在浏览器。</p>
              </div>
              <div class="license-head-actions">
                <span class="license-chip">{{ status.current ? `当前版本 ${status.current_version}` : '尚未导入' }}</span>
                <button type="button" class="console-button ghost small" :aria-expanded="importOpen" aria-controls="license-import-body" @click="importOpen = !importOpen">{{ importOpen ? '收起导入' : '展开导入' }}</button>
              </div>
            </header>

            <div id="license-import-body" v-show="importOpen" class="license-import-body">
              <div class="license-drop" :data-active="dragActive ? 'true' : 'false'" @dragenter.prevent="dragActive = true" @dragover.prevent="dragActive = true" @dragleave.prevent="dragActive = false" @drop.prevent="dropFile">
                <label class="license-drop-label">
                  <ConsoleIcon name="download" />
                  <span>拖拽许可证文件到这里，或点击选择文件</span>
                  <input ref="importFileInput" type="file" accept=".jws,.txt,.json,application/json" :disabled="busy" @change="selectFile" />
                  <small>只接受签发后的许可证文件；不接受私钥。文件只在本地读取。</small>
                </label>
              </div>

              <label class="license-field">
                <span>许可证内容</span>
                <textarea v-model="raw" :disabled="busy" rows="4" autocomplete="off" spellcheck="false" placeholder="eyJhbGciOiJFZERTQSIs…" maxlength="1000000" />
              </label>

              <div class="license-actions">
                <button type="button" class="console-button primary" :disabled="busy || !raw.trim()" @click="runPreview"><ConsoleIcon name="search" />{{ busy ? '处理中…' : '验证并预览' }}</button>
                <button type="button" class="console-button ghost" :disabled="busy" @click="downloadRequest"><ConsoleIcon name="download" />下载签发申请 JSON</button>
                <span class="license-note">签发申请供供应商工具自动填充客户、环境与实例标识。</span>
              </div>

              <LicenseProblem
                v-if="importProblem.message"
                title="导入未完成"
                :message="importProblem.message"
                :code="importProblem.code"
                :request-id="importProblem.requestId"
                :next-action="importProblem.nextAction"
                retry-label="重新验证"
                @retry="runPreview"
              />

              <div v-if="preview" class="license-preview">
                <div class="license-preview-head">
                  <h4>导入预览 · 版本 {{ preview.license.version }}</h4>
                  <span class="license-chip">生效 {{ formatLicenseTime(preview.license.not_before) }}</span>
                  <span class="license-chip">{{ preview.changes.length }} 项变更</span>
                </div>
                <ul v-if="preview.changes.length" class="license-changes">
                  <li v-for="change in preview.changes" :key="change.code" :class="{ risky: riskyChange(change) }">
                    <strong>{{ systemName(change.code) }}</strong>
                    <span>{{ change.kind === 'REMOVED' ? '移除授权' : change.kind === 'ADDED' ? '新增授权' : '变更授权' }}</span>
                    <template v-if="change.old"><span class="license-app-meta">原到期 {{ formatLicenseTime(change.old.expires_at) }}</span></template>
                    <template v-if="change.new"><span class="license-app-meta">→ 新到期 {{ formatLicenseTime(change.new.expires_at) }}</span></template>
                    <em v-if="riskyChange(change)">授权范围减少或有效期缩短</em>
                  </li>
                </ul>
                <p v-else class="license-note">许可证内容与当前状态一致，没有需要确认的授权变更。</p>
                <label v-if="dangerousChanges" class="license-check license-check-risk"><input v-model="confirmChanges" type="checkbox" :disabled="busy" /><span>我已核对并确认本次移除、缩短或其他授权变更</span></label>
                <label v-if="preview.requires_pending_replacement" class="license-check license-check-risk"><input v-model="confirmReplacement" type="checkbox" :disabled="busy" /><span>我确认替换现有待生效许可证</span></label>
                <div class="license-actions">
                  <button type="button" class="console-button primary" :disabled="!commitAllowed" @click="commit"><ConsoleIcon name="save" />{{ busy ? '处理中…' : '确认导入' }}</button>
                  <button type="button" class="console-button ghost" :disabled="busy" @click="clearPreview">取消预览</button>
                  <span class="license-note">导入只更新许可证；应用仍需在运行详情中逐应用激活。</span>
                </div>
              </div>
            </div>
          </section>

        </template>
      </template>
    </template>

    <!-- P1：运行时授权概览始终挂载，未登记/未初始化时也持续显示三项事实，不再整块隐藏。 -->
    <div ref="runtimeAnchor" tabindex="-1" class="license-runtime-anchor">
      <RuntimeEnforcementView ref="runtimeView" :license-revision="status?.revision || 0" @toast="emit('toast', $event)" />
    </div>

    <!-- 6 授权事件：页面最底部，最近 N 条单行摘要 + 「查看全部」进右侧抽屉。
         摘要不再内滚动、不再页内分页：挤占问题从结构上消掉，完整列表交给抽屉。 -->
    <section v-if="canRead && status && initialized && !loading" class="console-card license-section license-events" aria-labelledby="license-events-title">
      <header class="license-section-head">
        <div>
          <h3 id="license-events-title">授权事件</h3>
          <p class="license-note">初始化、导入、生效与运行登记的不可变记录，按时间倒序；展开单行可看原始事件码、时间与摘要。</p>
        </div>
        <div class="license-head-actions">
          <span v-if="!eventsError && events.items.length" class="license-chip">共 {{ eventsTotalLabel }} 条</span>
        </div>
      </header>

      <ListState
        v-if="eventsListState"
        :loading="eventsLoading"
        :error="eventsError"
        error-title="授权事件加载失败"
        empty-title="暂无授权事件。"
        retry-text="重新读取"
        compact
        @retry="loadEvents(events.page)"
      />
      <ul v-else class="license-event-list" :aria-busy="eventsRefreshing ? 'true' : 'false'" aria-label="最近授权事件">
        <LicenseEventRow v-for="event in recentEvents" :key="event.id" :event="event" id-prefix="license-event" />
      </ul>

      <footer v-if="!eventsListState" class="license-event-foot">
        <span class="license-note">显示最近 {{ recentEvents.length }} 条，共 {{ eventsTotalLabel }} 条</span>
        <button
          ref="eventsTrigger"
          type="button"
          class="console-button ghost small"
          aria-haspopup="dialog"
          :aria-expanded="eventsSheetOpen"
          @click="openEventsSheet"
        >查看全部 {{ eventsTotalLabel }} 条<span aria-hidden="true">→</span></button>
      </footer>
    </section>

    <!-- 抽屉自己取数据、自己分页：页内摘要必须始终是「最近几条」，不能被抽屉翻页带走。 -->
    <LicenseEventsSheet v-if="canRead" :open="eventsSheetOpen" @close="closeEventsSheet" />
  </section>
</template>

<style scoped>
/* ==========================================================================
   商业授权页
   --------------------------------------------------------------------------
   · 颜色、间距、圆角、字号全部取 main.css 的共享 token（深色主题由 token 覆盖，
     不再写第二套字面量），与平台控制台其余页面同一套语义色。
   · 语义色只有五种：success 正常/已完成、info 进行中/进行、warning 待办/受限、
     danger 故障/冲突、neutral 未知/未购买。正文永远带文字，不靠颜色单独表意。
   ========================================================================== */
.license-page {
  --license-ink: var(--text, #0f172a);
  --license-body: var(--text-secondary, #475569);
  --license-muted: var(--text-muted, #64748b);
  --license-border: var(--border, #e2e8f0);
  display: grid;
  gap: 18px;
  color: var(--license-ink);
}
/* 本页所有段落/标题都由下方的类决定间距，先清掉浏览器默认外边距。 */
.license-page :is(h2, h3, h4) { margin: 0; }
.license-page p { margin: 0; }
.license-page .license-note { margin: 6px 0 0; }
.license-page h2 { font-size: 22px; font-weight: 700; }
.license-page h3 { font-size: 16px; font-weight: 650; letter-spacing: -.1px; }
.license-page h4 { font-size: 14px; font-weight: 650; }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; overflow-wrap: anywhere; }

/* 页头 */
.license-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
.license-heading { display: grid; gap: 6px; min-width: 0; }
.license-heading p { max-width: 780px; color: var(--license-muted); font-size: 13px; line-height: 1.65; }
.license-header-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; }
.license-eyebrow { display: inline-flex; align-items: center; gap: 6px; color: var(--primary); font-size: 11px; font-weight: 700; letter-spacing: .09em; }
.license-eyebrow :deep(svg) { width: 14px; height: 14px; }

/* 顶部摘要卡 */
.license-hero {
  --hero-tone: var(--primary);
  --hero-soft: var(--primary-soft, #eff6ff);
  --hero-ink: var(--primary-ink, var(--primary-dark, #1d4ed8));
  position: relative;
  display: grid;
  gap: 18px;
  padding: 22px 24px 20px 26px;
  overflow: hidden;
  border: 1px solid var(--license-border);
  border-radius: 14px;
  background: linear-gradient(180deg, var(--hero-soft) 0%, var(--surface-card, #fff) 72%);
  box-shadow: var(--shadow-card);
}
.license-hero::before { content: ''; position: absolute; inset: 0 auto 0 0; width: 4px; background: var(--hero-tone); }
.license-hero[data-tone="success"] { --hero-tone: var(--success, #16a34a); --hero-soft: var(--success-soft, #ecfdf5); --hero-ink: var(--success-text, #15803d); }
.license-hero[data-tone="warning"] { --hero-tone: var(--warning, #d97706); --hero-soft: var(--warning-soft); --hero-ink: var(--warning-text, #b45309); }
.license-hero[data-tone="danger"] { --hero-tone: var(--danger, #dc2626); --hero-soft: var(--danger-soft, #fef2f2); --hero-ink: var(--danger-text, #b91c1c); }
.license-hero[data-tone="info"] { --hero-tone: var(--primary, #2563eb); --hero-soft: var(--primary-soft, #eff6ff); --hero-ink: var(--primary-ink, var(--primary-dark, #1d4ed8)); }
.license-hero[data-tone="neutral"] { --hero-tone: var(--text-faint, #94a3b8); --hero-soft: var(--surface-muted, #f8fafc); --hero-ink: var(--text-secondary, #475569); }
.license-hero .license-eyebrow { color: var(--hero-ink); }
.license-hero-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; flex-wrap: wrap; }
.license-hero-copy { display: grid; gap: 6px; min-width: 0; }
.license-hero-title { display: flex; align-items: center; gap: 9px; font-size: 20px; font-weight: 700; letter-spacing: -.2px; }
.license-hero-dot { width: 10px; height: 10px; flex: 0 0 auto; border-radius: 999px; background: var(--hero-tone); }
.license-hero-desc { max-width: 720px; color: var(--license-body); font-size: 13px; line-height: 1.7; }
.license-hero-cta { display: grid; justify-items: end; gap: 6px; text-align: right; }
.license-hero-cta-text { color: var(--hero-ink); font-size: 13.5px; font-weight: 650; }
.license-hero-hint { max-width: 300px; color: var(--license-muted); font-size: 11.5px; line-height: 1.6; }

/* 进度条 */
.license-steps { display: flex; flex-wrap: wrap; gap: 12px 0; margin: 0; padding: 14px 0 0; border-top: 1px dashed var(--license-border); list-style: none; }
.license-steps li { display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: center; gap: 2px 8px; flex: 1 1 170px; min-width: 0; padding-right: 16px; }
.license-steps li i { grid-row: span 2; display: grid; place-items: center; width: 22px; height: 22px; border: 1px solid var(--license-border); border-radius: 999px; background: var(--surface-card, #fff); color: var(--license-muted); font-size: 11px; font-style: normal; font-weight: 700; }
.license-steps li.is-done i { border-color: transparent; background: var(--success-soft, #ecfdf5); color: var(--success-text, #15803d); }
.license-steps li.is-current i { border-color: transparent; background: var(--primary, #2563eb); color: #fff; }
.license-step-label { font-size: 12.5px; font-weight: 600; color: var(--license-ink); }
.license-steps li.is-todo .license-step-label { color: var(--license-muted); font-weight: 500; }
.license-steps li.is-current .license-step-label { color: var(--primary-ink, var(--primary-dark, #1d4ed8)); }
.license-step-hint { grid-column: 2; color: var(--license-muted); font-size: 11px; line-height: 1.5; }

/* 摘要事实 */
.license-facts { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(148px, 100%), 1fr)); gap: 12px 18px; margin: 0; padding: 14px 0 0; border-top: 1px solid var(--license-border); }
.license-facts dt { color: var(--license-muted); font-size: 11.5px; }
.license-facts dd { margin: 4px 0 0; color: var(--license-ink); font-size: 14px; font-weight: 600; overflow-wrap: anywhere; }
.license-facts dd small { display: block; margin-top: 2px; color: var(--license-muted); font-size: 11px; font-weight: 400; }
.license-facts dd small[data-tone="expired"] { color: var(--danger-text, #b91c1c); }
.license-facts dd small[data-tone="soon"] { color: var(--warning-text, #b45309); }

/* 区块 */
.license-section { display: grid; gap: 14px; padding: 20px 22px; }
.license-init { display: grid; gap: 16px; padding: 22px 24px; }
.license-section-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
.license-section-head > div { min-width: 0; }
.license-section-head .license-eyebrow { margin-bottom: 4px; }
.license-note { max-width: 780px; color: var(--license-muted); font-size: 12.5px; line-height: 1.65; }
.license-note-strong { color: var(--license-body); }
.license-note code { padding: 1px 5px; border-radius: 4px; background: var(--surface-muted, #f8fafc); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; }
.license-head-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
.license-loading { color: var(--license-muted); font-size: 13px; }

/* 状态徽标 */
.license-badge { display: inline-flex; align-items: center; padding: 2px 9px; border-radius: 999px; font-size: 11.5px; font-weight: 650; white-space: nowrap; color: var(--text-secondary, #475569); background: var(--surface-muted, #f8fafc); }
.license-badge[data-tone="success"] { color: var(--success-text, #15803d); background: var(--success-soft, #ecfdf5); }
.license-badge[data-tone="info"] { color: var(--primary-ink, var(--primary-dark, #1d4ed8)); background: var(--primary-soft, #eff6ff); }
.license-badge[data-tone="warning"] { color: var(--warning-text, #b45309); background: var(--warning-soft); }
.license-badge[data-tone="danger"] { color: var(--danger-text, #b91c1c); background: var(--danger-soft, #fef2f2); }
.license-badge[data-tone="neutral"] { color: var(--text-secondary, #475569); background: var(--surface-muted, #f8fafc); }
.license-chip { display: inline-flex; align-items: center; padding: 2px 9px; border: 1px solid var(--license-border); border-radius: 999px; color: var(--license-muted); background: var(--surface-card, #fff); font-size: 11.5px; white-space: nowrap; }
.license-flag { display: inline-flex; align-items: center; padding: 3px 11px; border-radius: 999px; font-size: 12px; font-weight: 650; white-space: nowrap; color: var(--text-secondary, #475569); background: var(--surface-muted, #f8fafc); }
.license-flag[data-tone="success"] { color: var(--success-text, #15803d); background: var(--success-soft, #ecfdf5); }
.license-flag[data-tone="info"] { color: var(--primary-ink, var(--primary-dark, #1d4ed8)); background: var(--primary-soft, #eff6ff); }
.license-flag[data-tone="warning"] { color: var(--warning-text, #b45309); background: var(--warning-soft); }
.license-flag[data-tone="danger"] { color: var(--danger-text, #b91c1c); background: var(--danger-soft, #fef2f2); }

/* 六类状态说明：文字为主，颜色只是辅助 */
.license-legend { display: flex; flex-wrap: wrap; gap: 6px 20px; margin: 0; padding: 10px 12px; border: 1px solid var(--license-border); border-radius: 10px; background: var(--surface-muted, #f8fafc); list-style: none; }
.license-legend li { display: inline-flex; align-items: center; gap: 7px; color: var(--license-muted); font-size: 11.5px; line-height: 1.6; }

/* 逐应用卡片网格：auto-fit 自然落位（≥1280 四列），卡片近方形，窄屏单列。
   列数只由 auto-fit + 240px 下限推导：1120px 容器恰好落成 4 列、每列约 268px；
   若把上限写死成 300px，auto-repeat 会按上限计数，同样宽度只会得到 3 列。 */
.license-app-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(240px, 100%), 1fr));
  justify-content: center;
  gap: 16px;
  max-width: 1120px;
  /* 宽度到顶之后整块网格在区块里居中，避免右侧留出一条空白带。 */
  margin: 0 auto;
  padding: 0;
  list-style: none;
}
/* 仍在待生效列表、变更预览里复用的说明文字；卡片内的一套在 LicenseAppCard 里 */
.license-app-meta { color: var(--license-muted); font-size: 11.5px; line-height: 1.55; overflow-wrap: anywhere; }

/* 空状态 */
.license-empty { display: grid; justify-items: start; gap: 8px; padding: 20px; border: 1px dashed var(--line-strong, #cbd5e1); border-radius: 10px; background: var(--surface-muted, #f8fafc); }
.license-empty p { max-width: 620px; color: var(--license-muted); font-size: 12.5px; line-height: 1.65; }

/* 待生效许可证 */
.license-pending { border-color: var(--primary-border, #bfdbfe); }
.license-pending-list { display: grid; gap: 8px; margin: 0; padding: 0; list-style: none; }
.license-pending-list li { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; padding: 10px 14px; border: 1px solid var(--license-border); border-radius: 8px; background: var(--surface-muted, #f8fafc); }
.license-pending-list strong { font-size: 13px; font-weight: 650; }

/* 时钟保护与恢复面板：一次性凭据的写操作，风险说明先于输入框出现 */
.license-clock { border-color: var(--danger-border, #fecaca); }
.license-clock-body { display: grid; gap: 12px; padding-top: 14px; border-top: 1px dashed var(--license-border); }
.license-clock-risks { display: grid; gap: 6px; max-width: 760px; margin: 0; padding: 10px 14px 10px 30px; border: 1px solid var(--warning-border, #fde68a); border-radius: 10px; background: var(--warning-soft); color: var(--warning-text, #b45309); font-size: 12px; line-height: 1.65; }
.license-clock-risks li::marker { color: var(--warning, #d97706); }


/* 导入区 */
.license-import-body { display: grid; gap: 14px; }
.license-drop { border: 1px dashed var(--line-strong, #cbd5e1); border-radius: 12px; background: var(--surface-muted, #f8fafc); transition: border-color .15s, background .15s; }
.license-drop[data-active="true"] { border-color: var(--primary, #2563eb); background: var(--primary-soft, #eff6ff); }
.license-drop:focus-within { border-color: var(--primary, #2563eb); box-shadow: 0 0 0 3px var(--primary-soft, #eff6ff); }
.license-drop-label { display: grid; justify-items: center; gap: 6px; padding: 20px 16px; color: var(--license-body); font-size: 13px; text-align: center; cursor: pointer; }
.license-drop-label :deep(svg) { width: 22px; height: 22px; color: var(--primary); }
.license-drop-label small { color: var(--license-muted); font-size: 11.5px; }
/* 视觉隐藏但保留键盘焦点：文件选择仍是原生 input，回车/空格即可打开。 */
.license-drop-label input[type="file"] { width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip-path: inset(50%); border: 0; }
.license-field { display: grid; gap: 6px; color: var(--license-body); font-size: 12.5px; }
.license-field > span { font-weight: 500; }
.license-field input:not([type="file"]), .license-field textarea { width: 100%; max-width: 760px; padding: 9px 11px; border: 1px solid var(--license-border); border-radius: 8px; background: var(--surface-card, #fff); color: var(--license-ink); font: inherit; font-size: 13px; box-sizing: border-box; }
.license-field textarea { min-height: 96px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; line-height: 1.6; overflow-wrap: anywhere; resize: vertical; }
.license-field input:not([type="file"]):focus, .license-field textarea:focus { border-color: var(--primary, #2563eb); box-shadow: 0 0 0 3px var(--primary-soft, #eff6ff); outline: 0; }
.license-field-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(240px, 100%), 1fr)); gap: 14px; }
.license-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; }
.license-actions .license-note { margin: 0; max-width: 460px; }

/* 预览与确认 */
.license-preview { display: grid; gap: 12px; padding-top: 14px; border-top: 1px dashed var(--license-border); }
.license-preview-head { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; }
.license-changes { display: grid; gap: 6px; margin: 0; padding: 0; list-style: none; }
.license-changes li { display: flex; flex-wrap: wrap; align-items: baseline; gap: 10px; padding: 9px 12px; border: 1px solid var(--license-border); border-radius: 8px; background: var(--surface-muted, #f8fafc); font-size: 12.5px; }
.license-changes li.risky { border-color: var(--danger-border, #fecaca); background: var(--danger-soft, #fef2f2); color: var(--danger-text, #b91c1c); }
.license-changes em { color: var(--warning-text, #b45309); font-size: 11.5px; font-style: normal; font-weight: 600; }
.license-check { display: flex; align-items: flex-start; gap: 8px; padding: 10px 12px; border-radius: 8px; color: var(--license-body); font-size: 12.5px; line-height: 1.6; cursor: pointer; }
.license-check input { flex: 0 0 auto; width: 15px; height: 15px; margin: 2px 0 0; accent-color: var(--primary, #2563eb); }
.license-check-risk { border: 1px solid var(--danger-border, #fecaca); background: var(--danger-soft, #fef2f2); color: var(--danger-text, #b91c1c); }

/* 授权事件：页内只留最近几条单行摘要，行本身（LicenseEventRow）自带样式。
   这里不再有 max-height / overflow / 页内分页：完整列表搬到右侧抽屉。 */
.license-events { background: var(--surface-card, #fff); }
.license-events h3 { font-size: 15px; }
.license-event-list { display: grid; margin: 0; padding: 0; list-style: none; }
.license-event-list[aria-busy="true"] { opacity: .72; }
.license-event-foot { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--space-2) var(--space-3); padding-top: var(--space-3); border-top: 1px solid var(--license-border); }
.license-event-foot .license-note { margin: 0; font-size: 12px; }

/* 运行详情锚点：从“去激活”跳转过来时承接焦点。 */
.license-runtime-anchor { scroll-margin-top: 12px; outline: none; }

.license-alert { margin: 0; padding: 12px 14px; border: 1px solid var(--danger-border, #fecaca); border-radius: 10px; background: var(--danger-soft, #fef2f2); color: var(--danger-text, #b91c1c); font-size: 13px; }

/* 卡片网格自己负责列数，这里只剩顶部摘要卡在中等宽度下的对齐调整。 */
@media (max-width: 1080px) {
  .license-hero-cta { justify-items: start; text-align: left; }
}
@media (max-width: 720px) {
  .license-hero, .license-section, .license-init { padding: 16px; }
  .license-hero-title { font-size: 18px; }
  .license-steps li { flex-basis: 100%; padding-right: 0; }
  .license-facts { grid-template-columns: repeat(auto-fit, minmax(min(130px, 100%), 1fr)); }
  .license-event-foot { align-items: stretch; }
  .license-event-foot .console-button { width: 100%; }
  .license-timeline li { grid-template-columns: minmax(0, 1fr); gap: 4px; }
  .license-event-time { padding-bottom: 4px; }
  .license-app-grid { grid-template-columns: minmax(0, 1fr); justify-content: stretch; }
}
</style>
