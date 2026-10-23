<script setup>
import { computed, onMounted, reactive } from 'vue'
import { hasPermission } from '../../auth/utils/principal.js'
import { RUNTIME_APPLICATIONS, createRuntimeController, createRuntimeState, memberProgress, runtimeStateName, runtimeTimestampPresent } from './runtime-api.js'

const emit = defineEmits(['toast'])
const canRead = computed(() => hasPermission('platform:license:read'))
const canManage = computed(() => hasPermission('platform:license:manage'))
const state = reactive(createRuntimeState())
const controller = createRuntimeController(state, { canRead: () => canRead.value, canManage: () => canManage.value, onSuccess: () => emit('toast', '激活请求已处理，请以服务端执行状态与服务确认记录为准。') })
const progress = computed(() => memberProgress(state.snapshot?.members))
const canActivate = computed(() => canManage.value && state.confirmed && state.fresh && state.snapshot && state.snapshot.state !== 'ENFORCED' && !state.loading && !state.busy && !state.notRegistered)
const applicationName = computed(() => RUNTIME_APPLICATIONS.find(application => application.code === state.application)?.name || '当前系统')
const stateTone = computed(() => ({ ENFORCED: 'success', APPLYING: 'info', PENDING_ENFORCEMENT: 'pending' })[state.snapshot?.state] || 'muted')
const acknowledged = member => memberProgress([member]).acknowledged === 1
const time = value => {
  if (!runtimeTimestampPresent(value)) return '尚未收到'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
}
onMounted(controller.refresh)
</script>

<template>
  <section class="runtime-enforcement" aria-label="运行时授权执行">
    <template v-if="canRead">
      <header class="runtime-header">
        <div class="runtime-heading">
          <span class="runtime-heading-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M12 3 4 6v6c0 4 4 7 8 9 4-2 8-5 8-9V6l-8-3Z" /><path d="m8.5 12 2.5 2.5 4.5-5" /></svg></span>
          <div><h3>运行时授权执行</h3><p>查看各系统的服务登记、准备进度与授权执行状态。</p></div>
        </div>
        <div class="runtime-toolbar">
          <label class="runtime-select"><span>业务系统</span><select :value="state.application" :disabled="state.loading || state.busy" @change="controller.select($event.target.value)"><option v-for="application in RUNTIME_APPLICATIONS" :key="application.code" :value="application.code">{{ application.name }}</option></select></label>
          <button class="runtime-button" :disabled="state.loading || state.busy" @click="controller.refresh"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M20 7v5h-5M4 17v-5h5" /><path d="M6.1 7a7 7 0 0 1 11.6-1L20 9M4 15l2.3 3A7 7 0 0 0 18 17" /></svg>{{ state.loading ? '读取中…' : '刷新' }}</button>
        </div>
      </header>
      <p v-if="state.loading" role="status" class="runtime-message runtime-loading">正在读取服务登记与执行状态…</p>
      <div v-if="state.error" role="alert" class="runtime-message runtime-error"><span>{{ state.error }}</span><button class="runtime-button" :disabled="state.loading || state.busy" @click="controller.refresh">重新读取</button></div>
      <div v-if="state.notRegistered" class="runtime-empty runtime-card"><span class="runtime-badge" data-tone="pending">尚未登记</span><h4>{{ applicationName }}尚未受控登记</h4><p>请通过平台受控接入与部署流程完成服务登记后再刷新，不需要手工填写服务凭据。</p></div>
      <template v-if="state.snapshot && !state.notRegistered">
        <div class="runtime-card runtime-overview">
          <div class="runtime-card-head"><h4>{{ applicationName }}</h4><span v-if="!state.fresh" class="runtime-badge" data-tone="pending">{{ state.loading ? '正在更新' : '上次读取的状态' }}</span><span v-else class="runtime-live"><i aria-hidden="true"></i>服务端状态</span></div>
          <div class="runtime-metrics">
            <div class="runtime-metric runtime-state-metric"><span class="runtime-label">服务端执行状态</span><strong class="runtime-state" :data-tone="stateTone"><i aria-hidden="true"></i>{{ runtimeStateName(state.snapshot.state) }}</strong><span class="runtime-hint">最终执行状态由平台服务端决定</span></div>
            <div class="runtime-metric"><span class="runtime-label">服务准备</span><strong class="runtime-metric-value">{{ progress.ready }}<span>/ {{ progress.total }}</span></strong><span class="runtime-hint">已准备 / 登记服务</span></div>
            <div class="runtime-metric"><span class="runtime-label">当前修订确认</span><strong class="runtime-metric-value">{{ progress.acknowledged }}<span>/ {{ progress.total }}</span></strong><span class="runtime-hint">已确认当前下发修订 / 登记服务</span></div>
          </div>
          <dl class="runtime-meta">
            <div><dt>执行修订 / 部署修订</dt><dd class="runtime-revision">{{ state.snapshot.revision }}<span>/</span>{{ state.snapshot.deployment_revision ?? '—' }}</dd></div>
            <div><dt>迁移资格</dt><dd>{{ state.snapshot.migration_eligible ? '服务端已核验' : '无过渡资格' }}</dd></div>
            <div><dt>更新时间 <span class="runtime-timezone">· 本地时间</span></dt><dd :title="state.snapshot.updated_at">{{ time(state.snapshot.updated_at) }}</dd></div>
          </dl>
          <p class="runtime-note runtime-overview-note">准备与确认计数仅供诊断，不代表全部已强制执行，也不能替代服务端激活门禁。</p>
        </div>

        <section class="runtime-card runtime-services" aria-label="当前系统的受控服务">
          <div class="runtime-card-head runtime-services-head"><div><h4>当前系统的受控服务 <span class="runtime-count">{{ progress.total }}</span></h4><p class="runtime-note">核对各服务的准备状态与下发修订，摘要可展开查看。</p></div><span class="runtime-subtle">{{ applicationName }}</span></div>
          <div v-if="state.snapshot.members.length" class="runtime-table" role="region" aria-label="受控服务明细" tabindex="0">
            <table>
              <caption class="runtime-sr-only">{{ applicationName }}的受控服务，时间按本地时区显示</caption>
              <thead><tr><th scope="col">服务 / 环境</th><th scope="col">准备状态</th><th scope="col">下发 / 确认修订</th><th scope="col">确认时间</th><th scope="col">校验摘要</th></tr></thead>
              <tbody><tr v-for="member in state.snapshot.members" :key="member.service_id">
                <td data-label="服务 / 环境"><div class="runtime-service-name">{{ member.service_id }}</div><span class="runtime-environment">{{ member.environment || '—' }}</span></td>
                <td data-label="准备状态"><span class="runtime-badge" :data-tone="runtimeTimestampPresent(member.ready_at) ? 'success' : 'muted'">{{ runtimeTimestampPresent(member.ready_at) ? '已准备' : '待准备' }}</span><span class="runtime-cell-note" :title="member.ready_at">{{ time(member.ready_at) }}</span></td>
                <td data-label="下发 / 确认修订"><span class="runtime-revision">{{ member.issued_revision ?? 0 }}<span>/</span>{{ member.ack_revision ?? 0 }}</span><span class="runtime-cell-note" :class="{ 'runtime-confirmed': acknowledged(member) }">{{ acknowledged(member) ? '已确认当前修订' : '待确认当前修订' }}</span></td>
                <td data-label="确认时间"><span class="runtime-timestamp" :title="member.ack_at">{{ time(member.ack_at) }}</span></td>
                <td data-label="校验摘要"><details class="runtime-digests"><summary>查看摘要</summary><dl><div><dt>覆盖摘要</dt><dd>{{ member.coverage_digest || '—' }}</dd></div><div><dt>镜像摘要</dt><dd>{{ member.image_digest || '—' }}</dd></div></dl></details></td>
              </tr></tbody>
            </table>
          </div>
          <div v-else class="runtime-empty runtime-services-empty"><h4>暂无登记服务</h4><p>服务端尚未返回登记服务，不能据此认定执行已完成。</p></div>
        </section>

        <div v-if="canManage && state.snapshot.state !== 'ENFORCED'" class="runtime-card runtime-activation">
          <div><h4>{{ state.snapshot.state === 'APPLYING' ? '重试应用' : '发起激活' }}</h4><p class="runtime-note">服务端将核对许可、部署、覆盖与服务确认情况。失败后可按指引修复并重试。</p><label class="runtime-confirm"><input v-model="state.confirmed" type="checkbox" :disabled="state.loading || state.busy" /><span>我已核对当前系统与执行修订，确认请求启用运行时授权限制</span></label></div>
          <button class="runtime-button runtime-button-primary" :disabled="!canActivate" @click="controller.activateSelected">{{ state.busy ? '处理中…' : state.snapshot.state === 'APPLYING' ? '确认重试激活' : '确认激活' }}<span aria-hidden="true">→</span></button>
        </div>
        <p v-else-if="!canManage" class="runtime-note runtime-readonly">仅查看；需要商业授权管理权限才能发起激活。</p>
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
.runtime-overview { padding: 20px 24px 16px; }
.runtime-card-head { justify-content: space-between; flex-wrap: wrap; }
.runtime-live, .runtime-subtle { color: var(--runtime-muted); font-size: 12px; }
.runtime-live { display: inline-flex; align-items: center; gap: 6px; }
.runtime-live i { width: 6px; height: 6px; border-radius: 50%; background: #94a3b8; }
.runtime-metrics { display: grid; grid-template-columns: 1.2fr 1fr 1fr; gap: 24px; margin: 24px 0; }
.runtime-metric { display: grid; align-content: start; gap: 7px; min-width: 0; }
.runtime-metric + .runtime-metric { padding-left: 24px; border-left: 1px solid var(--runtime-border); }
.runtime-label { color: var(--runtime-muted); font-size: 12px; }
.runtime-state { display: flex; align-items: center; gap: 9px; min-height: 38px; font-size: 24px; font-weight: 600; letter-spacing: -.6px; }
.runtime-state i { width: 8px; height: 8px; border-radius: 50%; background: currentColor; }
.runtime-state[data-tone="success"] { color: var(--success-text, #15803d); }
.runtime-state[data-tone="info"] { color: var(--runtime-primary); }
.runtime-state[data-tone="pending"] { color: var(--warning-text, #b45309); }
.runtime-metric-value { display: flex; align-items: baseline; gap: 7px; font-size: 30px; line-height: 38px; font-weight: 600; font-variant-numeric: tabular-nums; }
.runtime-metric-value > span { color: var(--text-muted, #94a3b8); font-size: 17px; font-weight: 400; }
.runtime-hint { color: var(--runtime-muted); font-size: 12px; }
.runtime-meta { display: grid; grid-template-columns: 1.2fr 1fr 1fr; gap: 18px 24px; margin: 0; padding: 16px 0; border-top: 1px solid var(--runtime-border); }
.runtime-meta dt { color: var(--runtime-muted); font-size: 12px; }
.runtime-meta dd { margin: 5px 0 0; overflow-wrap: anywhere; font-size: 13px; }
.runtime-timezone { color: var(--text-muted, #94a3b8); font-size: 11px; }
.runtime-revision { display: inline-flex; gap: 8px; align-items: baseline; font-weight: 600; font-variant-numeric: tabular-nums; }
.runtime-revision > span { color: var(--text-muted, #94a3b8); font-weight: 400; }
.runtime-note { color: var(--runtime-muted); font-size: 12px; line-height: 1.7; }
.runtime-overview-note { padding-top: 12px; border-top: 1px dashed var(--runtime-border); }
.runtime-services-head { padding: 18px 24px; }
.runtime-services-head h4 { display: flex; align-items: center; gap: 8px; }
.runtime-services-head p { margin-top: 4px; }
.runtime-count { display: inline-flex; justify-content: center; align-items: center; min-width: 24px; height: 22px; padding: 0 7px; border-radius: 6px; background: var(--surface-muted, #f1f5f9); color: var(--runtime-muted); font-size: 12px; font-weight: 500; }
.runtime-table { border-radius: 0 0 14px 14px; }
table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 12px; }
th, td { text-align: left; padding: 16px 20px; vertical-align: top; overflow-wrap: anywhere; }
th { padding-top: 10px; padding-bottom: 10px; border-top: 1px solid var(--runtime-border); border-bottom: 1px solid var(--runtime-border); background: var(--surface-muted, #f8fafc); color: var(--runtime-muted); font-weight: 500; }
th:first-child, td:first-child { padding-left: 24px; width: 26%; }
th:nth-child(2) { width: 22%; }
th:nth-child(3) { width: 19%; }
th:nth-child(4) { width: 20%; }
th:last-child, td:last-child { padding-right: 24px; width: 13%; }
tbody tr + tr td { border-top: 1px solid var(--runtime-border); }
tbody tr:hover { background: var(--surface-hover, #fafbfc); }
.runtime-service-name { margin: 0 0 6px; color: var(--text, #334155); font-size: 13px; font-weight: 600; line-height: 1.5; }
.runtime-environment { display: inline-flex; padding: 1px 6px; border: 1px solid var(--runtime-border); border-radius: 4px; color: var(--runtime-muted); font-size: 11px; }
.runtime-badge { display: inline-flex; align-items: center; gap: 5px; padding: 2px 8px; border-radius: 5px; font-size: 11px; font-weight: 500; white-space: nowrap; color: var(--runtime-muted); background: var(--surface-muted, #f1f5f9); }
.runtime-badge[data-tone="success"] { color: var(--success-text, #15803d); background: var(--success-soft, #f0fdf4); }
.runtime-badge[data-tone="pending"] { color: var(--warning-text, #b45309); background: var(--warning-soft, #fffbeb); }
.runtime-cell-note { display: block; margin-top: 6px; color: var(--runtime-muted); font-size: 11px; font-variant-numeric: tabular-nums; }
.runtime-confirmed { color: var(--success-text, #15803d); }
.runtime-timestamp { font-variant-numeric: tabular-nums; color: var(--runtime-muted); }
.runtime-digests { position: relative; }
.runtime-digests summary { width: fit-content; color: var(--runtime-primary); white-space: nowrap; cursor: pointer; font-size: 12px; }
.runtime-digests dl { position: absolute; top: 100%; right: 0; z-index: 2; display: grid; gap: 14px; width: min(440px, calc(100vw - 64px)); margin: 10px 0 0; padding: 16px; border: 1px solid var(--runtime-border); border-radius: 10px; background: var(--surface-card, #fff); box-shadow: var(--shadow-popover, 0 12px 28px rgb(15 23 42 / 12%)); }
.runtime-digests dt { margin-bottom: 4px; color: var(--runtime-muted); font-size: 11px; }
.runtime-digests dd { margin: 0; color: var(--text, #475569); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; line-height: 1.6; overflow-wrap: anywhere; }
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
  th, td { padding-left: 12px; padding-right: 12px; }
}
@media (max-width: 680px) {
  .runtime-enforcement { padding-top: 22px; gap: 12px; }
  .runtime-heading-icon { flex-basis: 36px; width: 36px; height: 36px; border-radius: 10px; }
  .runtime-heading p { max-width: 250px; }
  .runtime-select { display: grid; gap: 4px; min-width: 0; }
  .runtime-select select { min-width: 0; width: 100%; }
  .runtime-toolbar { align-items: flex-end; }
  .runtime-overview { padding: 16px; }
  .runtime-metrics { grid-template-columns: 1fr 1fr; gap: 18px 0; margin: 20px 0; }
  .runtime-state-metric { grid-column: 1 / -1; }
  .runtime-metric:nth-child(2) { border-left: 0; padding-left: 0; }
  .runtime-metric:nth-child(3) { padding-left: 18px; }
  .runtime-state { font-size: 22px; }
  .runtime-meta { grid-template-columns: 1fr 1fr; gap: 14px; }
  .runtime-meta > div:last-child { grid-column: 1 / -1; }
  .runtime-services-head { padding: 16px; }
  .runtime-services-head > .runtime-subtle { display: none; }
  table, tbody, tr, td { display: block; width: 100%; }
  thead { display: none; }
  tbody tr { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 14px 16px; padding: 18px 16px; border-top: 1px solid var(--runtime-border); }
  td, td:first-child, td:last-child { width: auto; padding: 0; }
  tbody tr + tr td { border: 0; }
  td::before { content: attr(data-label); display: block; margin-bottom: 5px; color: var(--runtime-muted); font-size: 11px; }
  td:first-child, td:last-child { grid-column: 1 / -1; }
  .runtime-service-name { overflow-wrap: anywhere; }
  .runtime-digests dl { position: static; width: auto; grid-template-columns: repeat(2, minmax(0, 1fr)); padding: 12px; border-radius: 8px; background: var(--surface-muted, #f8fafc); box-shadow: none; }
  .runtime-activation { align-items: stretch; flex-direction: column; gap: 16px; padding: 16px; }
  .runtime-activation .runtime-button { width: 100%; }
}
@media (prefers-reduced-motion: reduce) { .runtime-button { transition: none; } }
</style>
