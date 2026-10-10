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
const time = value => runtimeTimestampPresent(value) ? value : '尚未收到'
onMounted(controller.refresh)
</script>

<template>
  <section class="runtime-enforcement" aria-label="运行时授权执行">
    <template v-if="canRead">
      <header><div><h3>运行时授权执行</h3><p>逐系统查看受控服务登记与确认进度；最终执行状态由平台服务端决定。</p></div><button :disabled="state.loading || state.busy" @click="controller.refresh">刷新</button></header>
      <label class="runtime-select">业务系统<select :value="state.application" :disabled="state.loading || state.busy" @change="controller.select($event.target.value)"><option v-for="application in RUNTIME_APPLICATIONS" :key="application.code" :value="application.code">{{ application.name }}</option></select></label>
      <p v-if="state.loading" role="status">正在读取服务登记与执行状态…</p>
      <div v-if="state.error" role="alert" class="runtime-error">{{ state.error }} <button :disabled="state.loading || state.busy" @click="controller.refresh">重新读取</button></div>
      <p v-if="state.notRegistered" class="runtime-panel">尚未受控登记。请通过平台受控接入与部署流程完成服务登记后再刷新，不需要手工填写服务凭据。</p>
      <template v-if="state.snapshot && !state.notRegistered">
        <div class="runtime-panel"><dl><dt>服务端执行状态</dt><dd>{{ runtimeStateName(state.snapshot.state) }}</dd><dt>执行修订 / 部署修订</dt><dd>{{ state.snapshot.revision }} / {{ state.snapshot.deployment_revision ?? '—' }}</dd><dt>迁移资格</dt><dd>{{ state.snapshot.migration_eligible ? '服务端已核验' : '无过渡资格' }}</dd><dt>更新时间</dt><dd>{{ time(state.snapshot.updated_at) }}</dd></dl><p>已准备 {{ progress.ready }} / {{ progress.total }} · 已确认当前下发修订 {{ progress.acknowledged }} / {{ progress.total }}</p><p class="runtime-note">准备与确认计数仅供诊断，不代表全部已强制执行，也不能替代服务端激活门禁。</p></div>
        <div class="runtime-table"><table><caption>当前系统的受控服务</caption><thead><tr><th>服务</th><th>环境</th><th>覆盖摘要</th><th>镜像摘要</th><th>准备时间</th><th>下发 / 确认修订</th><th>确认时间</th></tr></thead><tbody><tr v-for="member in state.snapshot.members" :key="member.service_id"><td>{{ member.service_id }}</td><td>{{ member.environment }}</td><td class="runtime-digest">{{ member.coverage_digest || '—' }}</td><td class="runtime-digest">{{ member.image_digest || '—' }}</td><td>{{ time(member.ready_at) }}</td><td>{{ member.issued_revision ?? 0 }} / {{ member.ack_revision ?? 0 }}</td><td>{{ time(member.ack_at) }}</td></tr><tr v-if="!state.snapshot.members.length"><td colspan="7">服务端尚未返回登记服务，不能据此认定执行已完成。</td></tr></tbody></table></div>
        <div v-if="canManage && state.snapshot.state !== 'ENFORCED'" class="runtime-panel"><h4>{{ state.snapshot.state === 'APPLYING' ? '重试应用' : '发起激活' }}</h4><p>激活将由服务端核对许可、部署、覆盖和所有服务确认情况。失败时保留服务端状态，可按指引修复后重试。</p><label class="runtime-confirm"><input v-model="state.confirmed" type="checkbox" :disabled="state.loading || state.busy" />我已核对当前系统与执行修订，确认请求启用运行时授权限制</label><button :disabled="!canActivate" @click="controller.activateSelected">{{ state.busy ? '处理中…' : state.snapshot.state === 'APPLYING' ? '确认重试激活' : '确认激活' }}</button></div>
        <p v-else-if="!canManage" class="runtime-note">仅查看；需要商业授权管理权限才能发起激活。</p>
      </template>
    </template>
    <p v-else>没有商业授权查看权限。</p>
  </section>
</template>

<style scoped>
.runtime-enforcement{display:grid;gap:16px;margin-top:24px;padding-top:24px;border-top:1px solid var(--line,#e2e8f0)}header{display:flex;align-items:center;justify-content:space-between;gap:16px}h3,h4,p{margin:0 0 8px}.runtime-select{display:flex;align-items:center;gap:12px}.runtime-panel{padding:16px;background:var(--panel,#f8fafc);border:1px solid var(--line,#e2e8f0);border-radius:10px}dl{display:grid;grid-template-columns:180px 1fr;gap:8px;margin:0 0 12px}dd{margin:0;overflow-wrap:anywhere}.runtime-note{color:var(--muted,#64748b);font-size:13px}.runtime-error{padding:12px;color:var(--danger,#b91c1c);background:var(--danger-bg,#fff1f2);border-radius:8px}.runtime-table{overflow:auto}table{width:100%;border-collapse:collapse;font-size:13px}caption{text-align:left;font-weight:600;padding-bottom:8px}th,td{text-align:left;padding:10px;border-bottom:1px solid var(--line,#e2e8f0);vertical-align:top}.runtime-digest{max-width:180px;overflow-wrap:anywhere;font-family:monospace}.runtime-confirm{display:flex;align-items:flex-start;gap:8px;margin:12px 0}button,select{border:1px solid var(--line,#cbd5e1);border-radius:6px;padding:8px 12px;background:var(--panel,#fff);color:inherit}button:disabled{opacity:.5;cursor:not-allowed}@media(max-width:640px){header{align-items:flex-start}dl{grid-template-columns:1fr}dt{font-weight:600}}
</style>
