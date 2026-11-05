<script setup>
// 集成死信运维面板：只读查看四类 Outbox 的 dead 事件，并按人工确认重置重试。
// 重试不会伪造投递成功；是否送达仍以后台投递结果为准，服务端逐请求校验 approval.manage。
import { computed, onMounted, ref } from 'vue'
import ConsoleIcon from '@/modules/platform/shared/components/ConsoleIcon.vue'
import ConfirmDialog from '@/modules/shared/components/ConfirmDialog.vue'
import { useConfirmDialog } from '@/modules/shared/composables/useConfirmDialog.js'
import { formatUserError } from '@/modules/shared/utils/userError.js'
import { formatBusinessDateTime } from '@/modules/shared/utils/businessTime.js'
import {
  listFailedIntegrationOutboxEvents,
  retryFailedIntegrationOutboxEvent,
} from '../api/contract'

const props = defineProps({
  canManage: { type: Boolean, default: false },
})
const emit = defineEmits(['notify'])

// 队列顺序与后端应用层的受管枚举一致，标签只做运维可读映射。
const KINDS = [
  { key: 'financial', label: '财务生效', short: '财务', hint: '合同生效同步至财务系统' },
  { key: 'responsibility', label: '责任变更', short: '责任', hint: '合同责任人与责任组织变更' },
  { key: 'project', label: '项目激活', short: '项目', hint: '合同激活同步至项目系统' },
  { key: 'link', label: 'CRM 关联', short: 'CRM', hint: 'CRM 商机与合同关联回写' },
]
const EVENT_LABELS = {
  'contract.financial_effective.v1': '合同财务生效事件',
  'contract.responsibility_changed.v1': '合同责任变更事件',
  'contract.activation': '合同项目激活事件',
  'crm.opportunity_contract_link': 'CRM 商机合同关联事件',
}

const kind = ref('financial')
const items = ref([])
const loading = ref(false)
const error = ref('')
const errorRequestID = ref('')
const permissionStatus = ref(0)
const actionError = ref('')
const actionRequestID = ref('')
const busyID = ref('')
const { dialog: confirmDialog, askConfirm, accept: acceptConfirm, cancel: cancelConfirm } = useConfirmDialog()
// 队列切换和手动刷新可能交错返回；只有最新一次读取可以提交列表或错误。
let loadSequence = 0

const activeQueue = computed(() => kindMeta(kind.value))
const refreshing = computed(() => loading.value && items.value.length > 0)

function kindMeta(value) {
  return KINDS.find((queue) => queue.key === value) || { key: value, label: value || '未知队列', short: value || '未知', hint: '' }
}

function eventLabel(event) {
  return EVENT_LABELS[event] || event || '未标注事件'
}

// 死信时间来自后端事件记录，是业务时刻：按北京业务时间展示，不跟随浏览器时区。
function formatTimestamp(value) {
  if (!value) return '—'
  return formatBusinessDateTime(value, { seconds: true }) || String(value)
}

function describeFailure(failure) {
  return {
    status: Number(failure?.status || 0),
    requestID: failure?.requestID || '',
    message: formatUserError(failure, { fallback: '读取集成死信失败，请稍后重试。' }),
  }
}

/**
 * load 读取当前队列的死信；401/403 进入权限提示，不展示服务端原始错误。
 * @returns {Promise<void>}
 */
async function load() {
  if (!props.canManage) return
  const sequence = ++loadSequence
  loading.value = true
  error.value = ''
  errorRequestID.value = ''
  permissionStatus.value = 0
  // 重新读取时清掉上一条重试提示，避免旧失败原因停留在新列表上。
  actionError.value = ''
  actionRequestID.value = ''
  try {
    const rows = await listFailedIntegrationOutboxEvents(kind.value, { limit: 100 })
    if (sequence !== loadSequence) return
    items.value = Array.isArray(rows) ? rows : []
  } catch (failure) {
    if (sequence !== loadSequence) return
    items.value = []
    const described = describeFailure(failure)
    if (described.status === 401 || described.status === 403) {
      permissionStatus.value = described.status
    } else {
      error.value = described.message
      errorRequestID.value = described.requestID
    }
  } finally {
    if (sequence === loadSequence) loading.value = false
  }
}

/**
 * changeKind 切换队列并重新读取；旧队列结果和操作提示一并失效。
 * @param {string} next 受管队列标识。
 * @returns {Promise<void>}
 */
function changeKind(next) {
  if (next === kind.value || !KINDS.some((queue) => queue.key === next)) return
  loadSequence += 1
  kind.value = next
  items.value = []
  error.value = ''
  errorRequestID.value = ''
  permissionStatus.value = 0
  actionError.value = ''
  actionRequestID.value = ''
  return load()
}

// retry 核对后把失败事件重新置入后台投递队列。
// 参数：item 为失败事件及所属队列。
// 返回值：异步处理结果；取消不重试，重置不表示送达。
async function retry(item) {
  if (!props.canManage || busyID.value) return
  const queue = kindMeta(item.kind || kind.value)
  const accepted = await askConfirm({
    title: '重试集成死信投递？',
    description: `将把${queue.label}队列中的事件 ${eventLabel(item.event)}（资源 ${item.aggregate_id || '未记录'}，已尝试 ${item.attempts} 次）重置为待投递，并记录本次运维审计。\n重置不代表已经送达，最终结果仍取决于后台投递。`,
    confirmText: '重新投递',
    cancelText: '取消',
    danger: false,
  })
  if (!accepted) return
  busyID.value = item.id
  actionError.value = ''
  actionRequestID.value = ''
  try {
    await retryFailedIntegrationOutboxEvent(item.kind || kind.value, item.id)
    emit('notify', `已重置${queue.label}死信事件，后台将重新投递；请稍后刷新核对结果。`)
    await load()
  } catch (failure) {
    const described = describeFailure(failure)
    if (described.status === 401 || described.status === 403) {
      permissionStatus.value = described.status
    } else {
      actionError.value = `重试未完成：${described.message}`
      actionRequestID.value = described.requestID
    }
  } finally {
    busyID.value = ''
  }
}

onMounted(load)
</script>

<template>
  <section class="contract-outbox-panel" aria-label="集成死信">
    <div class="contract-info-banner">
      <ConsoleIcon name="info" />
      <span>集成死信是四类 Outbox 中已停止自动重试的事件。重试只会把事件重置为待投递并记录审计，不会补齐业务数据，也不代表已经送达。</span>
    </div>

    <div class="contract-outbox-toolbar">
      <div class="contract-tabs contract-outbox-tabs" role="tablist" aria-label="选择集成死信队列">
        <button
          v-for="queue in KINDS"
          :key="queue.key"
          type="button"
          role="tab"
          :aria-selected="kind === queue.key"
          :class="{ active: kind === queue.key }"
          :disabled="!canManage"
          :title="queue.hint"
          @click="changeKind(queue.key)"
        >
          {{ queue.label }}
          <i v-if="kind === queue.key && items.length && !loading">{{ items.length }}</i>
        </button>
      </div>
      <button
        v-if="canManage"
        class="contract-button secondary small"
        type="button"
        :disabled="loading"
        @click="load"
      ><ConsoleIcon name="reset" />{{ loading ? '正在刷新…' : '刷新' }}</button>
    </div>

    <p v-if="!canManage" class="contract-outbox-notice" role="status">
      当前账号没有集成死信运维权限（需要 approval.manage）。如需处理投递失败，请联系合同系统管理员。
    </p>

    <div v-else-if="permissionStatus" class="contract-card contract-empty-state contract-outbox-permission" role="alert">
      <ConsoleIcon name="shield" />
      <h3>{{ permissionStatus === 401 ? '登录状态已失效' : '没有查看集成死信的权限' }}</h3>
      <p v-if="permissionStatus === 401">服务端未确认当前登录状态，页面没有显示服务端原始错误。请重新登录合同系统后再打开本页面。</p>
      <p v-else>服务端拒绝了本次只读查询（HTTP 403）。请确认当前账号具备 approval.manage 权限，或联系管理员调整角色后重试。</p>
      <button class="contract-button secondary" type="button" :disabled="loading" @click="load">
        {{ loading ? '正在重新校验…' : '重新校验权限' }}
      </button>
    </div>

    <p v-else-if="actionError" class="contract-session-error contract-outbox-action-error" role="alert">
      {{ actionError }}<small v-if="actionRequestID" class="contract-outbox-request-id">请求编号：{{ actionRequestID }}</small>
    </p>

    <div v-if="canManage && !permissionStatus && loading && !items.length" class="contract-table-card contract-outbox-loading" aria-busy="true" aria-live="polite">
      <div v-for="row in 4" :key="row" class="contract-outbox-loading-row"><i></i><i></i><i></i><i></i></div>
      <p>正在读取{{ activeQueue.label }}队列的死信事件…</p>
    </div>

    <div v-else-if="canManage && !permissionStatus && error" class="contract-card contract-empty-state contract-outbox-error" role="alert">
      <ConsoleIcon name="info" />
      <h3>死信列表加载失败</h3>
      <p>{{ error }}</p>
      <p v-if="errorRequestID" class="contract-outbox-request-id">请求编号：{{ errorRequestID }}</p>
      <button class="contract-button secondary" type="button" @click="load">重新加载</button>
    </div>

    <div v-else-if="canManage && !permissionStatus && !items.length" class="contract-card contract-empty-state contract-outbox-empty">
      <ConsoleIcon name="save" />
      <h3>当前没有死信事件</h3>
      <p>{{ activeQueue.label }}队列中没有处于 dead 状态的事件（{{ activeQueue.hint }}）。后台投递重试耗尽后的事件会显示在这里。</p>
      <button class="contract-button ghost" type="button" @click="load">刷新列表</button>
    </div>

    <div v-else-if="canManage && !permissionStatus" class="contract-table-card contract-outbox-table-card" :class="{ 'is-refreshing': refreshing }">
      <div class="contract-table-scroll">
        <table class="contract-data-table contract-outbox-table">
          <thead>
            <tr>
              <th>类型</th>
              <th>事件 / 资源</th>
              <th>尝试次数</th>
              <th>最后错误</th>
              <th>创建时间</th>
              <th>最近变化</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in items" :key="`${item.kind}:${item.id}`">
              <td>
                <span class="contract-badge danger"><i></i>{{ kindMeta(item.kind).short }}</span>
                <small class="block mono">{{ item.id }}</small>
              </td>
              <td>
                <strong>{{ eventLabel(item.event) }}</strong>
                <small class="block mono">{{ item.event }}</small>
                <small class="block">资源 {{ item.aggregate_id || '未记录' }}</small>
              </td>
              <td><span class="contract-outbox-attempts">{{ item.attempts }} 次</span></td>
              <td><span class="contract-outbox-last-error" :title="item.last_error || '未记录错误信息'">{{ item.last_error || '未记录错误信息' }}</span></td>
              <td>{{ formatTimestamp(item.created_at) }}</td>
              <td>{{ formatTimestamp(item.updated_at) }}</td>
              <td>
                <button
                  class="contract-text-button"
                  type="button"
                  :disabled="busyID === item.id"
                  @click="retry(item)"
                >{{ busyID === item.id ? '正在提交…' : '重试' }}</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <footer class="contract-table-footer">
        <span>共 {{ items.length }} 条死信事件</span>
        <span>{{ activeQueue.hint }}</span>
      </footer>
    </div>

    <ConfirmDialog
      v-if="confirmDialog"
      :title="confirmDialog.title"
      :description="confirmDialog.description"
      :confirm-text="confirmDialog.confirmText"
      :cancel-text="confirmDialog.cancelText"
      :danger="confirmDialog.danger"
      :busy="Boolean(busyID)"
      @confirm="acceptConfirm"
      @cancel="cancelConfirm"
    />
  </section>
</template>

<style scoped>
.contract-outbox-panel {
  display: grid;
  gap: 14px;
}

.contract-outbox-toolbar {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.contract-outbox-tabs {
  min-width: 0;
  flex: 1;
  margin-bottom: 0;
  overflow-x: auto;
}

.contract-outbox-tabs button {
  white-space: nowrap;
}

.contract-outbox-notice {
  margin: 0;
  padding: 13px 15px;
  color: var(--cm-secondary);
  font-size: 12px;
  border: 1px solid var(--cm-card-border);
  border-radius: 10px;
  background: var(--surface-card, #fff);
}

.contract-outbox-permission,
.contract-outbox-error,
.contract-outbox-empty {
  display: grid;
  justify-items: center;
  gap: 4px;
}

.contract-outbox-permission > svg,
.contract-outbox-error > svg {
  color: var(--cm-orange);
}

.contract-outbox-request-id {
  display: block;
  margin: 0;
  color: var(--cm-muted);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 10px;
}

.contract-outbox-action-error .contract-outbox-request-id {
  margin-top: 5px;
}

.contract-outbox-loading {
  padding: 14px 16px;
}

.contract-outbox-loading-row {
  display: grid;
  grid-template-columns: 110px minmax(180px, 1.4fr) minmax(160px, 1fr) 110px;
  gap: 18px;
  padding: 13px 0;
  border-bottom: 1px solid var(--border-soft, #f1f5f9);
}

.contract-outbox-loading-row i {
  display: block;
  height: 10px;
  border-radius: 5px;
  background: linear-gradient(90deg,
    var(--surface-hover, #eef2f8) 25%, var(--surface-muted, #f8fafc) 50%, var(--surface-hover, #eef2f8) 75%);
  background-size: 200% 100%;
  animation: contract-outbox-shimmer 1.4s ease-in-out infinite;
}

.contract-outbox-loading-row i:last-child {
  width: 60%;
}

.contract-outbox-loading p {
  margin: 14px 0 2px;
  color: var(--cm-muted);
  font-size: 11px;
}

@keyframes contract-outbox-shimmer {
  from { background-position: 200% 0; }
  to { background-position: -200% 0; }
}

.contract-outbox-table-card.is-refreshing {
  opacity: .72;
  transition: opacity .15s ease;
}

.contract-outbox-table {
  min-width: 1080px;
}

.contract-outbox-attempts {
  color: var(--cm-text);
  font-weight: 600;
  white-space: nowrap;
}

.contract-outbox-last-error {
  display: -webkit-box;
  max-width: 300px;
  overflow: hidden;
  color: var(--cm-secondary);
  font-size: 11px;
  line-height: 1.5;
  overflow-wrap: anywhere;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
  line-clamp: 3;
}

.contract-outbox-table-card .contract-table-footer span:last-child {
  color: var(--cm-muted);
}

@media (max-width: 720px) {
  .contract-outbox-toolbar {
    align-items: stretch;
    flex-direction: column;
  }

  .contract-outbox-toolbar > .contract-button {
    width: 100%;
  }

  .contract-outbox-last-error {
    max-width: 220px;
  }
}
</style>
