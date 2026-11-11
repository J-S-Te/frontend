<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { reimbursementAPI as api } from '../api/reimbursement.js'
import { createCommandRunner, formatMinor } from '../api/client.js'
import { recoveryCommand } from '../recovery.js'
import { formatBusinessDateTime } from '../../shared/utils/businessTime.js'
import PaginationBar from '@/modules/shared/components/PaginationBar.vue'
import ErrorState from '../../shared/components/ErrorState.vue'
import { claimStatusLabel as statusLabel, failureMessage } from '../statusLabels.js'

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
const detailLoading = ref(false)
const saving = ref(false)
const error = ref('')
const notice = ref('')
const pending = ref(null)
const runner = createCommandRunner(api)
let sequence = 0
let detailSequence = 0

const snapshotItemCount = computed(() => {
  const items = selected.value?.snapshot?.items
  return Array.isArray(items) ? items.length : 0
})
const snapshotAmountMinor = computed(() => {
  const snapshot = selected.value?.snapshot
  if (!snapshot) return ''
  if (typeof snapshot.payable_minor === 'string' && /^\d+$/.test(snapshot.payable_minor)) {
    return snapshot.payable_minor
  }
  const items = Array.isArray(snapshot.items) ? snapshot.items : []
  if (!items.length) return ''
  let total = 0n
  for (const item of items) {
    if (typeof item?.requested_minor !== 'string' || !/^\d+$/.test(item.requested_minor)) return ''
    total += BigInt(item.requested_minor)
  }
  return String(total)
})
const canRecover = computed(() => Array.isArray(selected.value?.allowed_actions)
  && selected.value.allowed_actions.includes('RECOVER'))

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

// 用途：选中服务器返回的恢复对象，并读取审批恢复详情端点核验冻结版本。
// 参数：row 为当前分页对象。
// 返回值：无；详情读取失败保留列表对象并提示，不用列表猜测提交版本。
async function choose(row) {
  selected.value = row; reason.value = ''; target.value = ''
  if (kind.value !== 'approvals' || !row?.id) return
  const ticket = ++detailSequence
  detailLoading.value = true
  error.value = ''
  try {
    const detail = await api.request(`/approval-recovery-tasks/${encodeURIComponent(row.id)}`)
    if (ticket !== detailSequence || selected.value?.id !== row.id) return
    if (detail?.id !== row.id || !Number.isFinite(detail?.version)) throw new Error('审批恢复详情响应不完整')
    selected.value = detail
  } catch (cause) {
    if (ticket !== detailSequence || selected.value?.id !== row.id) return
    if (cause.status === 409) {
      await load()
      if (ticket !== detailSequence) return
      error.value = error.value ? `任务已改变；${error.value}` : '任务已改变，请以最新列表重新核对。'
    } else {
      error.value = `审批恢复详情读取失败：${cause.message}；请刷新列表后再核对。`
    }
  } finally { if (ticket === detailSequence) detailLoading.value = false }
}

watch(kind, () => { page.value = 1; rows.value = []; void load() })
watch(page, () => { void load() })
watch(() => props.permissions, () => {
  if (!kinds.value.some(([key]) => key === kind.value)) kind.value = kinds.value[0]?.[0] || ''
  void load()
}, { immediate: true })
onBeforeUnmount(() => { sequence++; detailSequence++ })
</script>

<template>
  <section class="expense-panel">
    <h2>异常恢复</h2>
    <p>按当前租户和明确组织范围处理。接管须核验原人失效和目标资格；重投保留原始业务事实。</p>
    <label>处理类型 <select v-model="kind" :disabled="saving || !!pending">
      <option v-for="[key, label] in kinds" :key="key" :value="key">{{ label }}</option>
    </select></label>
    <button class="expense-button" :disabled="loading || saving" @click="load">刷新</button>
    <ErrorState v-if="error" compact title="异常恢复未完成" :error="error" :retry="false" />
    <p v-if="notice" role="status">{{ notice }}</p>
    <p v-if="loading">正在读取当前状态…</p>
    <div v-else class="expense-table">
      <table class="expense-table-body">
        <thead><tr><th scope="col">对象 / 类型</th><th scope="col">状态 / 原因</th><th scope="col">版本 / 时间</th><th scope="col">操作</th></tr></thead>
        <tbody><tr v-for="row in rows" :key="row.id">
          <td>{{ row.claim_id || row.resource_id || row.id }}<br>{{ row.node_code || row.topic || row.kind }}</td>
          <td>{{ statusLabel(row.status) }}<br>{{ row.last_error ? failureMessage(row.last_error) : (row.assignee || row.reason || '—') }}</td>
          <td>{{ row.version }}<br>{{ formatBusinessDateTime(row.updated_at || row.next_attempt_at) }}</td>
          <td><button class="expense-button" :disabled="saving || !!pending" @click="choose(row)">核对处理</button></td>
        </tr></tbody>
      </table>
    </div>
    <p v-if="!loading && !rows.length">当前范围没有待处理记录。</p>
    <div class="expense-toolbar">
      <PaginationBar label="异常恢复分页" :page="page" :total="total" :page-size="20" :loading="loading"
        @change="nextPage => { page = nextPage }" />
    </div>
    <form v-if="selected" class="expense-item" @submit.prevent="recover">
      <h3>核对 {{ selected.id }}</h3>
      <p v-if="kind === 'reconciliation'">源版本 {{ selected.source_revision }} / 项目版本 {{ selected.remote_revision }}；重建保留权威事件。</p>
      <dl v-if="kind === 'approvals'" class="expense-grid">
        <div><dt>单据</dt><dd>{{ selected.claim_title || '—' }}<br>{{ selected.claim_id || selected.id }}</dd></div>
        <div><dt>原冻结受理人</dt><dd>{{ selected.frozen_assignee || '未记录' }}</dd></div>
        <div><dt>当前受理人</dt><dd>{{ selected.assignee || selected.assignee_subject_id || '未记录' }}</dd></div>
        <div><dt>任务版本 / 单据版本</dt><dd>{{ selected.version ?? '—' }} / {{ selected.claim_version ?? '—' }}</dd></div>
        <div><dt>资格核验</dt><dd>{{ selected.recovery_qualification_status === 'REQUIRES_CURRENT_VERIFICATION'
          ? '提交接管时按当前主体实时核验资格' : '未提示实时核验' }}</dd></div>
        <div><dt>恢复动作</dt><dd>{{ canRecover ? '允许接管这条待办' : '当前不允许接管，请在核对资格后再试' }}</dd></div>
        <div><dt>冻结快照摘要</dt><dd>{{ snapshotItemCount }} 项费用<template v-if="snapshotAmountMinor"> · 金额合计 {{ formatMinor(snapshotAmountMinor) }} 元</template></dd></div>
      </dl>
      <p v-if="detailLoading" role="status">正在读取审批恢复详情…</p>
      <label v-if="kind === 'approvals'">新受理人主体标识 <input v-model="target" required maxlength="128"></label>
      <label>处置原因 <textarea v-model="reason" required maxlength="1000" /></label>
      <button class="expense-button" :disabled="saving || detailLoading || !!pending" type="submit">
        {{ kind === 'approvals' ? '核验并接管' : '核验并恢复' }}
      </button>
    </form>
    <div v-if="pending" role="status">
      原命令 {{ pending.command_id }} 结果尚未确认。
      <button class="expense-button" :disabled="saving" @click="retryPending">查询并重试原命令</button>
    </div>
  </section>
</template>
