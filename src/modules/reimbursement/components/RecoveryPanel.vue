<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { reimbursementAPI as api } from '../api/reimbursement.js'
import { createCommandRunner } from '../api/client.js'
import { recoveryCommand } from '../recovery.js'
import { formatBusinessDateTime } from '../../shared/utils/businessTime.js'

const props = defineProps({ permissions: { type: Array, default: () => [] } })
const kinds = computed(() => [
  ...(props.permissions.includes('expense.approval.recover') ? [['approvals', '审批异常接管']] : []),
  ...(props.permissions.includes('expense.integration.manage')
    ? [['outboxes', '失败投递'], ['jobs', '失败任务'], ['reconciliation', '对账差异']] : []),
])
const kind = ref(kinds.value[0]?.[0] || '')
const rows = ref([])
const page = ref(1)
const total = ref(0)
const selected = ref(null)
const reason = ref('')
const target = ref('')
const loading = ref(false)
const saving = ref(false)
const error = ref('')
const notice = ref('')
const pending = ref(null)
const runner = createCommandRunner(api)
let sequence = 0

// 用途：只读取当前授权操作区的分页对象，丢弃切换后的迟到响应。
// 参数：无。
// 返回值：无；请求失败保留公开错误。
async function load() {
  const ticket = ++sequence
  if (!kinds.value.some(([key]) => key === kind.value)) return
  loading.value = true
  error.value = ''
  try {
    const prefix = kind.value === 'approvals' ? '/approval-recovery-tasks' : `/operations/${kind.value}`
    const result = await api.request(`${prefix}?page=${page.value}&page_size=20${kind.value === 'reconciliation' ? '' : '&status=FAILED'}`)
    if (ticket !== sequence) return
    if (!Array.isArray(result.items) || !Number.isFinite(result.total)) throw new Error('恢复列表响应不完整')
    rows.value = result.items
    total.value = result.total
    selected.value = null
  } catch (cause) { if (ticket === sequence) error.value = cause.message }
  finally { if (ticket === sequence) loading.value = false }
}

// 用途：按当前对象版本执行独立授权的异常恢复命令。
// 参数：无。
// 返回值：无；未知结果保留原命令，禁止另起动作。
async function recover() {
  if (saving.value || !selected.value) return
  saving.value = true
  error.value = ''; notice.value = ''
  try {
    const command = recoveryCommand(kind.value, selected.value, reason.value, target.value)
    await runner.execute(`recovery.${kind.value}`, command.path, command.payload)
    notice.value = '恢复命令已记录；队列受理和业务完成分别查看。'
    await load()
  } catch (cause) {
    error.value = cause.message
    if (cause.status === 409) await load()
  } finally { pending.value = runner.pending(); saving.value = false }
}

// 用途：使用原命令标识确认或重试未知结果，避免重复恢复。
// 参数：无。
// 返回值：无；失败继续保留原命令。
async function retryPending() {
  if (saving.value) return
  saving.value = true
  try { await runner.retry(); await load(); notice.value = '原恢复命令已确认。' }
  catch (cause) { error.value = cause.message }
  finally { pending.value = runner.pending(); saving.value = false }
}

// 用途：选中服务器返回的恢复对象并清空旧对象表单。
// 参数：row 为当前分页对象。
// 返回值：无。
function choose(row) { selected.value = row; reason.value = ''; target.value = '' }

watch(kind, () => { page.value = 1; rows.value = []; void load() })
watch(page, () => { void load() })
watch(() => props.permissions, () => {
  if (!kinds.value.some(([key]) => key === kind.value)) kind.value = kinds.value[0]?.[0] || ''
  void load()
}, { immediate: true })
onBeforeUnmount(() => { sequence++ })
</script>

<template>
  <section class="expense-panel">
    <h2>异常恢复</h2>
    <p>按当前租户和明确组织范围处理。接管须核验原人失效和目标资格；重投保留原始业务事实。</p>
    <label>处理类型 <select v-model="kind" :disabled="saving || !!pending">
      <option v-for="[key, label] in kinds" :key="key" :value="key">{{ label }}</option>
    </select></label>
    <button class="expense-button" :disabled="loading || saving" @click="load">刷新</button>
    <p v-if="error" role="alert">{{ error }}</p>
    <p v-if="notice" role="status">{{ notice }}</p>
    <p v-if="loading">正在读取当前状态…</p>
    <table v-else class="expense-table">
      <thead><tr><th>对象 / 类型</th><th>状态 / 原因</th><th>版本 / 时间</th><th>操作</th></tr></thead>
      <tbody><tr v-for="row in rows" :key="row.id">
        <td>{{ row.claim_id || row.resource_id || row.id }}<br>{{ row.node_code || row.topic || row.kind }}</td>
        <td>{{ row.status }}<br>{{ row.last_error || row.assignee || row.reason || '—' }}</td>
        <td>{{ row.version }}<br>{{ formatBusinessDateTime(row.updated_at || row.next_attempt_at) }}</td>
        <td><button class="expense-button" :disabled="saving || !!pending" @click="choose(row)">核对处理</button></td>
      </tr></tbody>
    </table>
    <p v-if="!loading && !rows.length">当前范围没有待处理记录。</p>
    <div class="expense-toolbar">
      <button class="expense-button" :disabled="page <= 1 || loading" @click="page--">上一页</button>
      <span>第 {{ page }} 页，共 {{ total }} 条</span>
      <button class="expense-button" :disabled="page * 20 >= total || loading" @click="page++">下一页</button>
    </div>
    <form v-if="selected" class="expense-item" @submit.prevent="recover">
      <h3>核对 {{ selected.id }}</h3>
      <p v-if="kind === 'reconciliation'">源版本 {{ selected.source_revision }} / 项目版本 {{ selected.remote_revision }}；重建保留权威事件。</p>
      <label v-if="kind === 'approvals'">新受理人主体标识 <input v-model="target" required maxlength="128"></label>
      <label>处置原因 <textarea v-model="reason" required maxlength="1000" /></label>
      <button class="expense-button" :disabled="saving || !!pending" type="submit">
        {{ kind === 'approvals' ? '核验并接管' : '核验并恢复' }}
      </button>
    </form>
    <div v-if="pending" role="status">
      原命令 {{ pending.command_id }} 结果尚未确认。
      <button class="expense-button" :disabled="saving" @click="retryPending">查询并重试原命令</button>
    </div>
  </section>
</template>
