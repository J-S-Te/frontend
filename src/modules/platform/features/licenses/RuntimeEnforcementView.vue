<script setup>
import { computed, onBeforeUnmount, onMounted, reactive } from 'vue'
import { hasPermission } from '../../auth/utils/principal.js'
import { formatLicenseTime } from './presentation.js'
import {
  RUNTIME_APPLICATIONS,
  RUNTIME_POLL_INTERVAL_MS,
  createRuntimeController,
  createRuntimeState,
  enforcementStatusName,
  enforcementTone,
  licenseStatusName,
  licenseTone,
  memberProgress,
  overviewActivationReady,
  overviewActivationVisible,
  overviewAllowedActions,
  overviewBlockingReasons,
  overviewImportSuggested,
  overviewIsRegistered,
  overviewIsUnregistered,
  registrationStatusName,
  runtimeObservationName,
  runtimeTimestampPresent,
  runtimeTone,
} from './runtime-api.js'

const emit = defineEmits(['toast'])
const canRead = computed(() => hasPermission('platform:license:read'))
const canManage = computed(() => hasPermission('platform:license:manage'))
const state = reactive(createRuntimeState())
// 15 秒可见轮询、隐藏暂停、切换系统/卸载丢弃迟到响应都由控制器统一处理。
const controller = createRuntimeController(state, { canRead: () => canRead.value, canManage: () => canManage.value, onSuccess: () => emit('toast', '激活请求已处理，请以服务端执行状态与服务确认记录为准。') })
const pollSeconds = RUNTIME_POLL_INTERVAL_MS / 1000
const overview = computed(() => state.overview && state.overview.application === state.application ? state.overview : null)
const applicationName = computed(() => RUNTIME_APPLICATIONS.find(item => item.code === state.application)?.name || '当前系统')
const registered = computed(() => overviewIsRegistered(overview.value))
const unregistered = computed(() => overviewIsUnregistered(overview.value))
const progress = computed(() => memberProgress(overview.value?.enforcement.members))
const activationVisible = computed(() => overviewActivationVisible(overview.value))
const activationReady = computed(() => overviewActivationReady(overview.value))
const canActivate = computed(() => canManage.value && state.confirmed && state.fresh && activationReady.value && !state.loading && !state.busy)
const blockingReasons = computed(() => overviewBlockingReasons(overview.value))
const allowedActions = computed(() => overviewAllowedActions(overview.value))
const importSuggested = computed(() => overviewImportSuggested(overview.value))
const runtimeLabel = computed(() => runtimeObservationName(overview.value?.runtime))
const runtimeHint = computed(() => {
  const runtime = overview.value?.runtime
  if (!runtime) return '尚未读取运行观察。'
  if (!runtime.available) return runtime.message || '未接入运行观察；未知不等于已停止，不能据此判断系统停止。'
  if (runtime.status === 'UNKNOWN') return runtime.message || '运行观察暂不可用；未知不等于已停止。'
  return runtime.message || '运行观察可用；运行中不代表已授权。'
})
const snapshotLabel = computed(() => overview.value?.enforcement.snapshot_current ? '当前快照已同步' : '快照未同步或待核验')
const acknowledged = member => memberProgress([member]).acknowledged === 1
const time = value => formatLicenseTime(value)
onMounted(() => { controller.refresh(); controller.startPolling() })
onBeforeUnmount(() => controller.dispose())
</script>

<template>
  <section class="runtime-enforcement" aria-label="运行时授权概览">
    <template v-if="canRead">
      <header class="runtime-header">
        <div class="runtime-heading">
          <span class="runtime-heading-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M12 3 4 6v6c0 4 4 7 8 9 4-2 8-5 8-9V6l-8-3Z" /><path d="m8.5 12 2.5 2.5 4.5-5" /></svg></span>
          <div><h3>运行时授权执行</h3><p>只读概览：持续核对系统运行、商业授权与运行时授权执行三项事实。</p></div>
        </div>
        <div class="runtime-toolbar">
          <label class="runtime-select"><span>业务系统</span><select :value="state.application" :disabled="state.busy" @change="controller.select($event.target.value)"><option v-for="application in RUNTIME_APPLICATIONS" :key="application.code" :value="application.code">{{ application.name }}</option></select></label>
          <button class="runtime-button" :disabled="state.loading || state.busy" @click="controller.refresh"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M20 7v5h-5M4 17v-5h5" /><path d="M6.1 7a7 7 0 0 1 11.6-1L20 9M4 15l2.3 3A7 7 0 0 0 18 17" /></svg>{{ state.loading ? '读取中…' : '刷新' }}</button>
        </div>
      </header>
      <p class="runtime-note runtime-poll">页面可见时每 {{ pollSeconds }} 秒自动刷新；页面隐藏时暂停；切换业务系统会丢弃上一系统的迟到响应。</p>
      <p v-if="state.loading && !overview" role="status" class="runtime-message runtime-loading">正在读取运行时授权概览…</p>
      <div v-if="state.error" role="alert" class="runtime-message runtime-error"><span>{{ state.error }}</span><button class="runtime-button" :disabled="state.loading || state.busy" @click="controller.refresh">重新读取</button></div>
      <template v-if="overview">
        <div class="runtime-card runtime-facts">
          <div class="runtime-card-head">
            <div><h4>{{ applicationName }} · 运行时授权概览</h4><p class="runtime-note">三项事实彼此独立，必须分别核对，任何一项都不能替代另外两项。</p></div>
            <div class="runtime-badges">
              <span class="runtime-badge" :data-tone="unregistered ? 'pending' : 'success'">{{ unregistered ? '未纳管' : registrationStatusName(overview.registration.status) }}</span>
              <span v-if="!state.fresh" class="runtime-badge" data-tone="pending">{{ state.loading ? '正在更新' : '上次读取的状态' }}</span>
              <span v-else class="runtime-live"><i aria-hidden="true"></i>服务端状态</span>
            </div>
          </div>
          <p class="runtime-caveat">注意：系统运行中不代表已授权；许可证有效也不代表已强制执行。请以本页三项事实与服务端状态为准。</p>
          <dl class="runtime-facts-grid">
            <div class="runtime-fact">
              <dt class="runtime-label">系统运行 <span class="runtime-fact-source">运行观察</span></dt>
              <dd>
                <strong class="runtime-fact-value" :data-tone="runtimeTone(overview.runtime.status)">{{ runtimeLabel }}</strong>
                <span class="runtime-hint">{{ runtimeHint }}</span>
                <span class="runtime-hint">观察时间 {{ time(overview.runtime.checked_at) }}</span>
              </dd>
            </div>
            <div class="runtime-fact">
              <dt class="runtime-label">商业授权</dt>
              <dd>
                <strong class="runtime-fact-value" :data-tone="licenseTone(overview.license.status)">{{ licenseStatusName(overview.license.status) }}</strong>
                <span class="runtime-hint">许可证版本 {{ overview.license.version }} · 状态修订 {{ overview.license.revision }}</span>
                <span class="runtime-hint">生效 {{ time(overview.license.not_before) }} · 到期 {{ time(overview.license.expires_at) }}</span>
                <span class="runtime-hint">许可证有效不代表已强制执行。</span>
              </dd>
            </div>
            <div class="runtime-fact">
              <dt class="runtime-label">运行时授权执行</dt>
              <dd>
                <strong class="runtime-fact-value" :data-tone="enforcementTone(overview.enforcement.status)">{{ enforcementStatusName(overview.enforcement.status) }}</strong>
                <span class="runtime-hint">登记状态 {{ registrationStatusName(overview.registration.status) }} · 登记组件 {{ overview.registration.member_count }}</span>
                <span class="runtime-hint">执行修订 {{ overview.enforcement.revision }} / 部署修订 {{ overview.enforcement.deployment_revision }}</span>
                <span class="runtime-hint">{{ registered ? snapshotLabel : '未纳管时不存在运行时授权执行事实' }}</span>
              </dd>
            </div>
          </dl>
          <p class="runtime-note runtime-checked">概览读取时间 {{ time(overview.checked_at) }}<span v-if="overview.environment"> · 环境 {{ overview.environment }}</span></p>
        </div>

        <div v-if="blockingReasons.length || allowedActions.length" class="runtime-card runtime-blocking" role="status" aria-label="阻塞事实与可用操作">
          <h4>尚未满足的条件</h4>
          <ul v-if="blockingReasons.length" class="runtime-reason-list">
            <li v-for="reason in blockingReasons" :key="reason.code"><span class="runtime-badge" data-tone="pending">{{ reason.name }}</span><code class="runtime-reason-code">{{ reason.code }}</code></li>
          </ul>
          <p v-if="importSuggested" class="runtime-note">需要导入或续期商业授权；请使用上方商业授权导入入口，本页只读，不提供准备动作。</p>
          <p v-else-if="allowedActions.length" class="runtime-note">可执行操作：{{ allowedActions.map(action => action.name).join('、') }}；请在商业授权区域完成，本页不新增按钮。</p>
        </div>

        <div v-if="unregistered" class="runtime-card runtime-unregistered">
          <span class="runtime-badge" data-tone="pending">未纳管</span>
          <h4>{{ applicationName }}尚未受控登记</h4>
          <p class="runtime-note">未登记表示运行组件尚未接入运行时授权执行，不代表系统停止运行，也不代表已获得商业授权。请通过平台受控接入与部署流程完成登记后再刷新。</p>
        </div>

        <section v-if="registered" class="runtime-card runtime-services" aria-label="当前系统的受控服务">
          <div class="runtime-card-head runtime-services-head">
            <div><h4>当前系统的受控服务 <span class="runtime-count">{{ overview.enforcement.members.length }}</span></h4><p class="runtime-note">登记组件 {{ overview.registration.member_count }} 个；已准备 {{ progress.ready }}、已确认当前修订 {{ progress.acknowledged }}；计数仅供诊断，不代表全部已强制执行。</p></div>
            <span class="runtime-subtle">{{ applicationName }}</span>
          </div>
          <div v-if="overview.enforcement.members.length" class="runtime-table" role="region" aria-label="受控服务明细" tabindex="0">
            <table>
              <caption class="runtime-sr-only">{{ applicationName }}的受控服务，时间按北京时间显示</caption>
              <thead><tr><th scope="col">服务</th><th scope="col">准备状态</th><th scope="col">下发 / 确认修订</th><th scope="col">确认时间</th></tr></thead>
              <tbody><tr v-for="member in overview.enforcement.members" :key="member.service_id">
                <td data-label="服务"><div class="runtime-service-name">{{ member.service_id }}</div></td>
                <td data-label="准备状态"><span class="runtime-badge" :data-tone="runtimeTimestampPresent(member.ready_at) ? 'success' : 'muted'">{{ runtimeTimestampPresent(member.ready_at) ? '已准备' : '待准备' }}</span><span class="runtime-cell-note" :title="member.ready_at">{{ time(member.ready_at) }}</span></td>
                <td data-label="下发 / 确认修订"><span class="runtime-revision">{{ member.issued_revision }}<span>/</span>{{ member.ack_revision }}</span><span class="runtime-cell-note" :class="{ 'runtime-confirmed': acknowledged(member) }">{{ acknowledged(member) ? '已确认当前修订' : '待确认当前修订' }}</span></td>
                <td data-label="确认时间"><span class="runtime-timestamp" :title="member.ack_at">{{ time(member.ack_at) }}</span></td>
              </tr></tbody>
            </table>
          </div>
          <div v-else class="runtime-empty runtime-services-empty"><h4>暂无登记服务</h4><p>服务端尚未返回登记服务，不能据此认定执行已完成。</p></div>
        </section>

        <template v-if="activationVisible">
          <div v-if="canManage" class="runtime-card runtime-activation">
            <div>
              <h4>{{ overview.enforcement.status === 'APPLYING' ? '重试应用' : '发起激活' }}</h4>
              <p class="runtime-note">服务端将核对商业授权、部署、覆盖与服务确认情况。失败后可按指引修复并重试。</p>
              <p v-if="!activationReady" class="runtime-note">运行时执行状态为{{ enforcementStatusName(overview.enforcement.status) }}，请等待服务端更新可推进状态后再发起激活。</p>
              <label class="runtime-confirm"><input v-model="state.confirmed" type="checkbox" :disabled="state.loading || state.busy || !activationReady" /><span>我已核对当前系统与执行修订，确认请求启用运行时授权限制</span></label>
            </div>
            <button class="runtime-button runtime-button-primary" :disabled="!canActivate" @click="controller.activateSelected">{{ state.busy ? '处理中…' : overview.enforcement.status === 'APPLYING' ? '确认重试激活' : '确认激活' }}<span aria-hidden="true">→</span></button>
          </div>
          <p v-else class="runtime-note runtime-readonly">仅查看；需要商业授权管理权限才能发起激活。</p>
        </template>
        <p v-else-if="overview.enforcement.status === 'ENFORCED'" class="runtime-note runtime-readonly">当前系统已强制执行运行时授权限制，本页不提供重复激活。</p>
      </template>
    </template>
    <p v-else class="runtime-message">没有商业授权查看权限。</p>
  </section>
</template>

<style scoped>
.runtime-enforcement { --runtime-border: var(--border, #e2e8f0); --runtime-muted: var(--text-secondary, #64748b); --runtime-primary: var(--primary, #2563eb); display: grid; gap: 16px; min-width: 0; margin-top: 12px; padding-top: 28px; border-top: 1px solid var(--runtime-border); color: var(--text, #1e293b); font-size: 14px; line-height: 1.6; }
.runtime-enforcement *, .runtime-enforcement *::before, .runtime-enforcement *::after { box-sizing: border-box; }
h3, h4, p { margin: 0; }
h3 { font-size: 18px; font-weight: 650; letter-spacing: -.3px; }
h4 { font-size: 15px; font-weight: 600; }
.runtime-header, .runtime-heading, .runtime-toolbar, .runtime-card-head { display: flex; align-items: center; gap: 12px; }
.runtime-header { justify-content: space-between; flex-wrap: wrap; gap: 18px; margin-bottom: 2px; }
.runtime-heading { min-width: 0; }
.runtime-heading p { margin-top: 3px; color: var(--runtime-muted); font-size: 12px; }
.runtime-heading-icon { display: grid; flex: 0 0 42px; width: 42px; height: 42px; place-items: center; border: 1px solid var(--primary-border, #dbeafe); border-radius: 12px; background: var(--primary-soft, #eff6ff); color: var(--runtime-primary); }
.runtime-heading-icon svg { width: 23px; height: 23px; }
.runtime-toolbar { flex-wrap: wrap; gap: 10px; }
.runtime-select { display: flex; align-items: center; gap: 10px; margin: 0; color: var(--runtime-muted); font-size: 12px; }
.runtime-select select { min-width: 192px; max-width: 100%; height: 38px; padding: 0 30px 0 12px; border: 1px solid var(--runtime-border); border-radius: 8px; background: var(--surface-card, #fff); color: var(--text, #1e293b); font: inherit; font-size: 13px; cursor: pointer; }
.runtime-button { display: inline-flex; align-items: center; justify-content: center; gap: 8px; flex-shrink: 0; min-height: 38px; padding: 8px 14px; border: 1px solid var(--runtime-border); border-radius: 8px; background: var(--surface-card, #fff); color: var(--text, #334155); font: inherit; font-size: 13px; font-weight: 500; white-space: nowrap; cursor: pointer; transition: background .15s, border-color .15s; }
.runtime-button svg { width: 15px; height: 15px; }
.runtime-button:hover:not(:disabled) { background: var(--surface-muted, #f8fafc); border-color: #b8c5d6; }
.runtime-button-primary { background: var(--runtime-primary); border-color: var(--runtime-primary); color: #fff; }
.runtime-button-primary:hover:not(:disabled) { background: var(--primary-dark, #1d4ed8); border-color: var(--primary-dark, #1d4ed8); }
button:disabled, select:disabled { opacity: .5; cursor: not-allowed; }
button:focus-visible, select:focus-visible, input:focus-visible, summary:focus-visible, .runtime-table:focus-visible { outline: 2px solid var(--runtime-primary); outline-offset: 3px; }
.runtime-card { min-width: 0; border: 1px solid var(--runtime-border); border-radius: 14px; background: var(--surface-card, #fff); box-shadow: 0 1px 2px rgb(15 23 42 / 3%); }
.runtime-facts { padding: 20px 24px 16px; }
.runtime-card-head { justify-content: space-between; flex-wrap: wrap; }
.runtime-badges { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
.runtime-live, .runtime-subtle { color: var(--runtime-muted); font-size: 12px; }
.runtime-live { display: inline-flex; align-items: center; gap: 6px; }
.runtime-live i { width: 6px; height: 6px; border-radius: 50%; background: #22c55e; }
.runtime-caveat { margin: 16px 0 0; padding: 10px 14px; border: 1px solid var(--warning-border, #fde68a); border-radius: 10px; background: var(--warning-soft, #fffbeb); color: var(--warning-text, #92400e); font-size: 12px; line-height: 1.7; }
.runtime-facts-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 0; margin: 18px 0 0; padding: 0; }
.runtime-fact { display: grid; align-content: start; gap: 8px; min-width: 0; padding: 0 24px; border-left: 1px solid var(--runtime-border); }
.runtime-fact:first-child { padding-left: 0; border-left: 0; }
.runtime-fact:last-child { padding-right: 0; }
.runtime-fact dd { display: grid; gap: 5px; margin: 0; min-width: 0; }
.runtime-label { color: var(--runtime-muted); font-size: 12px; }
.runtime-fact-source { color: var(--text-muted, #94a3b8); font-size: 11px; }
.runtime-fact-value { display: flex; align-items: center; gap: 8px; min-height: 32px; font-size: 22px; font-weight: 600; letter-spacing: -.4px; }
.runtime-fact-value[data-tone="success"] { color: var(--success-text, #15803d); }
.runtime-fact-value[data-tone="info"] { color: var(--runtime-primary); }
.runtime-fact-value[data-tone="pending"] { color: var(--warning-text, #b45309); }
.runtime-fact-value[data-tone="danger"] { color: var(--danger-text, #b91c1c); }
.runtime-fact-value[data-tone="muted"] { color: var(--text-secondary, #64748b); }
.runtime-hint { color: var(--runtime-muted); font-size: 12px; line-height: 1.6; overflow-wrap: anywhere; }
.runtime-note { color: var(--runtime-muted); font-size: 12px; line-height: 1.7; }
.runtime-poll { padding: 0 4px; }
.runtime-checked { margin-top: 16px; padding-top: 12px; border-top: 1px dashed var(--runtime-border); }
.runtime-blocking { display: grid; gap: 10px; padding: 18px 24px; }
.runtime-reason-list { display: flex; flex-wrap: wrap; gap: 8px 18px; margin: 0; padding: 0; list-style: none; }
.runtime-reason-list li { display: inline-flex; align-items: center; gap: 8px; }
.runtime-reason-code { color: var(--text-muted, #94a3b8); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; }
.runtime-unregistered { display: grid; gap: 8px; justify-items: start; padding: 20px 24px; }
.runtime-unregistered .runtime-note { max-width: 760px; }
.runtime-services-head { padding: 18px 24px; }
.runtime-services-head h4 { display: flex; align-items: center; gap: 8px; }
.runtime-services-head p { margin-top: 4px; }
.runtime-count { display: inline-flex; justify-content: center; align-items: center; min-width: 24px; height: 22px; padding: 0 7px; border-radius: 6px; background: var(--surface-muted, #f1f5f9); color: var(--runtime-muted); font-size: 12px; font-weight: 500; }
.runtime-table { border-radius: 0 0 14px 14px; }
table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 12px; }
th, td { text-align: left; padding: 16px 20px; vertical-align: top; overflow-wrap: anywhere; }
th { padding-top: 10px; padding-bottom: 10px; border-top: 1px solid var(--runtime-border); border-bottom: 1px solid var(--runtime-border); background: var(--surface-muted, #f8fafc); color: var(--runtime-muted); font-weight: 500; }
th:first-child, td:first-child { padding-left: 24px; width: 34%; }
th:nth-child(2) { width: 24%; }
th:nth-child(3) { width: 24%; }
th:last-child, td:last-child { padding-right: 24px; width: 18%; }
tbody tr + tr td { border-top: 1px solid var(--runtime-border); }
tbody tr:hover { background: var(--surface-hover, #fafbfc); }
.runtime-service-name { margin: 0; color: var(--text, #334155); font-size: 13px; font-weight: 600; line-height: 1.5; }
.runtime-badge { display: inline-flex; align-items: center; gap: 5px; padding: 2px 8px; border-radius: 5px; font-size: 11px; font-weight: 500; white-space: nowrap; color: var(--runtime-muted); background: var(--surface-muted, #f1f5f9); }
.runtime-badge[data-tone="success"] { color: var(--success-text, #15803d); background: var(--success-soft, #f0fdf4); }
.runtime-badge[data-tone="pending"] { color: var(--warning-text, #b45309); background: var(--warning-soft, #fffbeb); }
.runtime-badge[data-tone="danger"] { color: var(--danger-text, #b91c1c); background: var(--danger-soft, #fff1f2); }
.runtime-cell-note { display: block; margin-top: 6px; color: var(--runtime-muted); font-size: 11px; font-variant-numeric: tabular-nums; }
.runtime-confirmed { color: var(--success-text, #15803d); }
.runtime-timestamp { font-variant-numeric: tabular-nums; color: var(--runtime-muted); }
.runtime-activation { display: flex; align-items: center; justify-content: space-between; gap: 24px; padding: 20px 24px; }
.runtime-activation p { margin-top: 4px; }
.runtime-confirm { display: flex; align-items: flex-start; gap: 8px; margin: 14px 0 0; color: var(--text-secondary, #475569); font-size: 12px; cursor: pointer; }
.runtime-confirm input { flex-shrink: 0; width: 15px; height: 15px; margin: 3px 0 0; accent-color: var(--runtime-primary); }
.runtime-message { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; padding: 12px 16px; border: 1px solid var(--runtime-border); border-radius: 10px; background: var(--surface-muted, #f8fafc); color: var(--runtime-muted); font-size: 13px; }
.runtime-error { color: var(--danger-text, #b91c1c); border-color: #fecaca; background: var(--danger-soft, #fff1f2); }
.runtime-empty { padding: 36px 24px; text-align: center; }
.runtime-empty h4 { margin-top: 10px; }
.runtime-empty p { max-width: 540px; margin: 8px auto 0; color: var(--runtime-muted); font-size: 13px; }
.runtime-services-empty { border-top: 1px solid var(--runtime-border); }
.runtime-readonly { padding: 0 4px; }
.runtime-sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; border: 0; }
@media (max-width: 1000px) {
  .runtime-header { align-items: flex-start; }
  .runtime-toolbar { width: 100%; }
  .runtime-select { flex: 1; }
  .runtime-select select { flex: 1; }
  .runtime-facts-grid { grid-template-columns: minmax(0, 1fr); gap: 18px; }
  .runtime-fact { padding: 0; border-left: 0; }
  .runtime-fact + .runtime-fact { padding-top: 18px; border-top: 1px dashed var(--runtime-border); }
  th, td { padding-left: 12px; padding-right: 12px; }
}
@media (max-width: 680px) {
  .runtime-enforcement { padding-top: 22px; gap: 12px; }
  .runtime-heading-icon { flex-basis: 36px; width: 36px; height: 36px; border-radius: 10px; }
  .runtime-heading p { max-width: 250px; }
  .runtime-select { display: grid; gap: 4px; min-width: 0; }
  .runtime-select select { min-width: 0; width: 100%; }
  .runtime-toolbar { display: grid; grid-template-columns: minmax(0, 1fr) auto; }
  .runtime-facts, .runtime-blocking, .runtime-unregistered, .runtime-activation { padding: 16px; }
  .runtime-activation { display: grid; justify-items: start; gap: 14px; }
  .runtime-table { overflow-x: auto; }
  table { min-width: 560px; }
}
</style>
