<script setup>
import { computed, onMounted, reactive } from 'vue'
import { getNativeProjectScope, requestNativeProjectScope, decideNativeProjectScope, withdrawNativeProjectScope } from '../api/projectManagement.js'
import { useNativeScopeChange } from '../composables/useNativeScopeChange.js'

const props = defineProps({ projectId: { type: String, required: true }, categories: { type: Array, default: () => [] }, disabled: Boolean, initialState: { type: Object, default: null } })
const emit = defineEmits(['changed', 'close'])
const ui = useNativeScopeChange({ projectId: props.projectId, initialState: props.initialState,
  disabled: () => props.disabled, onChanged: (value) => emit('changed', value),
  api: { read: getNativeProjectScope, request: requestNativeProjectScope, decide: decideNativeProjectScope, withdraw: withdrawNativeProjectScope } })
const { state, lines, reason, confirmed, busy, loading, error, notice, pending, canRequest } = ui
const comments = reactive({})
const categories = computed(() => props.categories.filter((entry) => entry.enabled))
const locked = computed(() => props.disabled || busy.value || loading.value || !!pending.value)
const statusNames = { PENDING: '待审批', APPROVED: '已批准生效', REJECTED: '已驳回', WITHDRAWN: '已撤回' }

// 用途：增加不复用旧合同编号的本地范围行。
// 参数：无。
// 返回值：无；服务端最终生成稳定来源行身份。
function addLine() {
  if (!canRequest.value || lines.value.length >= 200) return
  lines.value.push({ source_id: '', batch: '第一批', site: '', site_code: '', category: '', system: '', system_level: '', requirement: '', test_mode: 'STANDARD' })
}

// 用途：按原提案版本提交明确决定和必填意见。
// 参数：change 为持久提案，decision 为批准、驳回或撤回。
// 返回值：无；自批和角色分离由控制器及服务端同时校验。
async function decide(change, decision) { await ui.decide(change, decision, comments[change.id]) }

// 用途：保持当前项目固定，挂载时读取真实范围和审批历史。
// 参数：无。
// 返回值：无；失败显示原错误。
async function load() { await ui.load() }
onMounted(load)
</script>

<template>
  <section class="pm-native-scope" aria-label="原生委托范围变更">
    <header><h3>原生委托范围变更</h3><button type="button" :disabled="busy || loading" @click="load">刷新并核对</button><button type="button" :disabled="busy || !!pending" @click="emit('close')">关闭</button></header>
    <p>仅支持未开工或已按原受控流程退回待确认的项目。业务管理员发起，技术总监或项目管理员异人单级审批；批准后仍须重新确认拆解与履约资格。</p>
    <p v-if="error" role="alert">{{ error }}</p><p v-if="notice" role="status">{{ notice }}</p>
    <p v-if="pending">操作号 {{ pending.payload.operation_id }} 尚未确认。保留原载荷，请刷新核对或 <button type="button" :disabled="busy || disabled" @click="ui.retry">按原操作精确重试</button>。</p>
    <template v-if="state">
      <h4>当前生效范围 v{{ state.scope_version }} · 项目版本 {{ state.project_version }}</h4>
      <ul><li v-for="item in state.service_items" :key="item.source_service_id">{{ item.source_service_id }} · {{ item.batch }} · {{ item.site }} · {{ item.category }} · {{ item.test_mode }} · {{ item.system }} · {{ item.system_level }} · {{ item.system_standard }} · {{ (item.required_codes || []).join('、') }} · {{ item.requirement || '无附加要求' }}</li></ul>
      <form v-if="state.can_request" @submit.prevent="ui.submit">
        <fieldset :disabled="locked || !canRequest">
          <legend>申请完整范围新版本（不直接生效）</legend>
          <label>变更原因<textarea v-model="reason" maxlength="500" required /></label>
          <div v-for="(line, index) in lines" :key="index" class="pm-native-line">
            <strong>{{ line.source_id || '新增本地行，审批后进入新范围' }}</strong>
            <label>批次<input v-model="line.batch" maxlength="64" required></label>
            <label>实施场所<input v-model="line.site" maxlength="255" required @input="line.site_code = ''"></label>
            <label>检测类别<select v-model="line.category" required><option value="" disabled>请选择启用类别</option><option v-for="entry in categories" :key="entry.category" :value="entry.category">{{ entry.category }}</option></select></label>
            <label>检测方法<select v-model="line.test_mode"><option value="STANDARD">常规</option><option value="PENETRATION">渗透测试</option></select></label>
            <label>系统<input v-model="line.system" maxlength="128"></label><label>系统级别<input v-model="line.system_level" maxlength="64"></label>
            <label>技术要求<textarea v-model="line.requirement" maxlength="2000" /></label>
            <button type="button" :disabled="lines.length <= 1" @click="lines.splice(index, 1)">移除此项</button>
          </div>
          <button type="button" :disabled="lines.length >= 200" @click="addLine">增加服务项</button>
          <label><input v-model="confirmed" type="checkbox" required>确认以上完整范围送审，待审批期间冻结项目履约写入。</label>
          <button type="submit" :disabled="!confirmed || !categories.length">提交异人审批</button>
        </fieldset>
      </form>
      <h4>最近二十条范围提案</h4>
      <p v-if="!state.changes.length">暂无范围变更记录。</p>
      <article v-for="change in state.changes" :key="change.id" class="pm-native-change">
        <h5>{{ statusNames[change.status] || '未知状态，禁止操作' }} · 基于 v{{ change.base_scope_version }}<span v-if="change.applied_scope_version"> → v{{ change.applied_scope_version }}</span></h5>
        <p>原操作号 {{ change.operation_id }} · 申请人 {{ change.requested_by }} · {{ change.reason }}</p>
        <p v-if="change.decided_by">决定人 {{ change.decided_by }} · {{ change.comment }}</p>
        <details><summary>冻结送审范围（{{ change.scope_hash }}）</summary><ul><li v-for="item in change.service_items" :key="item.source_service_id">{{ item.source_service_id }} · {{ item.batch }} · {{ item.site }} · {{ item.category }} · {{ item.test_mode }} · {{ item.system }} · {{ item.system_level }} · {{ item.system_standard }} · {{ (item.required_codes || []).join('、') }} · {{ item.requirement }}</li></ul></details>
        <template v-if="change.status === 'PENDING'">
          <label v-if="ui.canDecide(change) || (state.can_request && change.requested_by === state.actor_id)">审批或撤回意见<textarea v-model="comments[change.id]" :disabled="locked" maxlength="500" /></label>
          <template v-if="ui.canDecide(change)"><button type="button" :disabled="locked || !comments[change.id]?.trim()" @click="decide(change, 'APPROVE')">批准并生效新版本</button><button type="button" :disabled="locked || !comments[change.id]?.trim()" @click="decide(change, 'REJECT')">驳回</button></template>
          <button v-if="state.can_request && change.requested_by === state.actor_id" type="button" :disabled="locked || !comments[change.id]?.trim()" @click="decide(change, 'WITHDRAW')">撤回我的提案</button>
          <p v-if="change.requested_by === state.actor_id">申请人不能审批自己的提案。</p>
        </template>
      </article>
    </template>
  </section>
</template>

<style scoped>
.pm-native-scope { padding: 1rem; border: 1px solid #ccd4df; border-radius: .5rem; background: #fff; color: #172b4d; }
header { display: flex; align-items: center; gap: .75rem; flex-wrap: wrap; }
h3 { margin-right: auto; }
label { display: grid; gap: .25rem; margin: .65rem 0; }
input, select, textarea { min-width: 0; max-width: 100%; font: inherit; }
textarea { min-height: 4rem; }
.pm-native-line, .pm-native-change { padding: .75rem; margin: .75rem 0; border: 1px solid #dce3ed; border-radius: .35rem; overflow-wrap: anywhere; }
button { margin: .25rem; padding: .4rem .65rem; }
[role="alert"] { color: #a82424; }
li { margin: .3rem 0; overflow-wrap: anywhere; }

/* 深色主题：面板白底、浅描边与墨色；浅色声明未改。 */
[data-theme="dark"] .pm-native-scope {
  border-color: var(--border);
  background: var(--surface-card);
  color: var(--text);
}
[data-theme="dark"] .pm-native-line,
[data-theme="dark"] .pm-native-change {
  border-color: var(--border);
}
[data-theme="dark"] input,
[data-theme="dark"] select,
[data-theme="dark"] textarea {
  border-color: var(--border);
  background: var(--surface-input);
  color: var(--text);
}
[data-theme="dark"] [role="alert"] {
  color: var(--danger-text);
}
</style>
