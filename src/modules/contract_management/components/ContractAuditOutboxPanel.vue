<script setup>
// 审计死信运维面板：查看平台审计上报处于 dead 状态的事件，并按人工确认重置重试。
// 与集成死信面板分开：审计死信的字段、权限（approval.manage）与重试路由不同；
// 重试只把事件重置为待投递，是否送达仍以后台投递结果为准。
import { onMounted, ref } from 'vue'
import ConsoleIcon from '@/modules/platform/shared/components/ConsoleIcon.vue'
import ConfirmDialog from '@/modules/shared/components/ConfirmDialog.vue'
import { useConfirmDialog } from '@/modules/shared/composables/useConfirmDialog.js'
import { formatUserError } from '@/modules/shared/utils/userError.js'
import { formatBusinessDateTime } from '@/modules/shared/utils/businessTime.js'
import { listFailedAuditOutboxEvents, retryFailedAuditOutboxEvent } from '../api/contract'

const props = defineProps({
  canManage: { type: Boolean, default: false },
})
const emit = defineEmits(['notify'])

const items = ref([])
const loading = ref(false)
const error = ref('')
const errorRequestID = ref('')
const permissionStatus = ref(0)
const actionError = ref('')
const actionRequestID = ref('')
const busyID = ref('')
const { dialog: confirmDialog, askConfirm, accept: acceptConfirm, cancel: cancelConfirm } = useConfirmDialog()
// 只允许最新一次读取提交列表或错误，切换/刷新不能互相覆盖。
let loadSequence = 0

// 审计事件时间是业务时刻：按北京业务时间展示，不跟随浏览器时区。
function formatTimestamp(value) {
  if (!value) return '—'
  return formatBusinessDateTime(value, { seconds: true }) || String(value)
}

function describeFailure(failure) {
  return {
    status: Number(failure?.status || 0),
    requestID: failure?.requestID || '',
    message: formatUserError(failure, { fallback: '读取审计死信失败，请稍后重试。' }),
  }
}

/**
 * load 读取审计死信列表；401/403 进入权限提示，不展示服务端原始错误。
 * @returns {Promise<void>}
 */
async function load() {
  if (!props.canManage) return
  const sequence = ++loadSequence
  loading.value = true
  error.value = ''
  errorRequestID.value = ''
  permissionStatus.value = 0
  actionError.value = ''
  actionRequestID.value = ''
  try {
    const rows = await listFailedAuditOutboxEvents({ limit: 100 })
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

// retry 核对后把审计死信重新置入后台投递队列。
// 参数：item 为审计死信记录。
// 返回值：异步处理结果；取消不重试，重置不表示送达。
async function retry(item) {
  if (!props.canManage || busyID.value) return
  const accepted = await askConfirm({
    title: '重试审计死信投递？',
    description: `将把审计事件 ${item.event_id || item.id}（动作 ${item.action || '未记录'}，已尝试 ${item.attempts} 次）重置为待投递，并记录本次运维审计。\n重置不代表已经送达，最终结果仍取决于后台投递。`,
    confirmText: '重新投递',
    cancelText: '取消',
    danger: false,
  })
  if (!accepted) return
  busyID.value = item.id
  actionError.value = ''
  actionRequestID.value = ''
  try {
    await retryFailedAuditOutboxEvent(item.id)
    emit('notify', '已重置审计死信事件，后台将重新投递；请稍后刷新核对结果。')
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
  <section class="contract-audit-outbox" aria-label="审计死信">
    <div class="contract-info-banner">
      <ConsoleIcon name="info" />
      <span>审计死信是平台审计上报已停止自动重试的事件。重试只会把事件重置为待投递并记录运维审计，不会补齐审计内容，也不代表已经送达。</span>
    </div>

    <div class="contract-audit-outbox__toolbar">
      <p>仅显示当前租户的审计死信；重试需要 <code>approval.manage</code> 权限。</p>
      <button v-if="canManage" class="contract-button secondary small" type="button" :disabled="loading" @click="load">
        <ConsoleIcon name="reset" />{{ loading ? '正在刷新…' : '刷新' }}
      </button>
    </div>

    <p v-if="!canManage" class="contract-audit-outbox__notice" role="status">
      当前账号没有审计死信运维权限（需要 approval.manage）。如需处理审计上报失败，请联系合同系统管理员。
    </p>

    <div v-else-if="permissionStatus" class="contract-card contract-empty-state" role="alert">
      <ConsoleIcon name="shield" />
      <h3>{{ permissionStatus === 401 ? '登录状态已失效' : '没有查看审计死信的权限' }}</h3>
      <p v-if="permissionStatus === 401">服务端未确认当前登录状态，页面没有显示服务端原始错误。请重新登录合同系统后再打开本页面。</p>
      <p v-else>服务端拒绝了本次只读查询（HTTP 403）。请确认当前账号具备 approval.manage 权限，或联系管理员调整角色后重试。</p>
      <button class="contract-button secondary" type="button" :disabled="loading" @click="load">{{ loading ? '正在重新校验…' : '重新校验权限' }}</button>
    </div>

    <template v-else>
      <p v-if="actionError" class="contract-session-error" role="alert">
        {{ actionError }}<small v-if="actionRequestID" class="contract-audit-outbox__request-id">请求编号：{{ actionRequestID }}</small>
      </p>

      <div v-if="loading && !items.length" class="contract-table-card contract-audit-outbox__loading" aria-busy="true" aria-live="polite">
        <p>正在读取审计死信…</p>
      </div>

      <div v-else-if="error" class="contract-card contract-empty-state" role="alert">
        <ConsoleIcon name="info" />
        <h3>审计死信列表加载失败</h3>
        <p>{{ error }}</p>
        <p v-if="errorRequestID" class="contract-audit-outbox__request-id">请求编号：{{ errorRequestID }}</p>
        <button class="contract-button secondary" type="button" @click="load">重新加载</button>
      </div>

      <div v-else-if="!items.length" class="contract-card contract-empty-state">
        <ConsoleIcon name="save" />
        <h3>当前没有审计死信</h3>
        <p>平台审计上报没有处于 dead 状态的事件。上报重试耗尽后的事件会显示在这里。</p>
        <button class="contract-button ghost" type="button" @click="load">刷新列表</button>
      </div>

      <div v-else class="contract-table-card">
        <div class="contract-table-scroll" data-table-scroll>
          <table class="contract-data-table contract-audit-outbox__table">
            <thead>
              <tr>
                <th scope="col">事件 / 动作</th>
                <th scope="col">资源</th>
                <th scope="col">请求编号</th>
                <th scope="col">尝试次数</th>
                <th scope="col">最后错误</th>
                <th scope="col">创建时间</th>
                <th scope="col">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in items" :key="item.id">
                <td>
                  <strong>{{ item.event_id }}</strong>
                  <small class="block">{{ item.action || '未记录动作' }}</small>
                  <small class="block mono">{{ item.id }}</small>
                </td>
                <td>
                  <span>{{ item.resource_type || '—' }}</span>
                  <small class="block mono">{{ item.resource_id || '未记录' }}</small>
                </td>
                <td><span class="mono">{{ item.request_id || '—' }}</span></td>
                <td><span class="contract-audit-outbox__attempts">{{ item.attempts }} 次</span></td>
                <td><span class="contract-audit-outbox__last-error" :title="item.last_error || '未记录错误信息'">{{ item.last_error || '未记录错误信息' }}</span></td>
                <td>{{ formatTimestamp(item.created_at) }}</td>
                <td>
                  <button class="contract-text-button" type="button" :disabled="busyID === item.id" @click="retry(item)">
                    {{ busyID === item.id ? '正在提交…' : '重试' }}
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <footer class="contract-table-footer">
          <span>共 {{ items.length }} 条审计死信</span>
          <span>重置不代表已经送达</span>
        </footer>
      </div>
    </template>

    <ConfirmDialog
      :open="Boolean(confirmDialog)"
      v-bind="confirmDialog || {}"
      :busy="Boolean(busyID)"
      @confirm="acceptConfirm"
      @cancel="cancelConfirm"
    />
  </section>
</template>

<style scoped>
.contract-audit-outbox {
  display: grid;
  gap: 14px;
}

.contract-audit-outbox__toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.contract-audit-outbox__toolbar p {
  margin: 0;
  color: var(--cm-muted);
  font-size: var(--fs-xs);
}

.contract-audit-outbox__toolbar code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}

.contract-audit-outbox__notice {
  margin: 0;
  padding: 13px 15px;
  color: var(--cm-secondary);
  font-size: 12px;
  border: 1px solid var(--cm-card-border);
  border-radius: 10px;
  background: var(--surface-card, #fff);
}

.contract-audit-outbox__loading {
  padding: 18px;
  color: var(--cm-muted);
  font-size: 12px;
}

.contract-audit-outbox__request-id {
  display: block;
  margin: 4px 0 0;
  color: var(--cm-muted);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 10px;
}

.contract-audit-outbox__attempts {
  color: var(--cm-text);
  font-weight: 600;
  white-space: nowrap;
}

.contract-audit-outbox__last-error {
  display: -webkit-box;
  max-width: 320px;
  overflow: hidden;
  color: var(--cm-secondary);
  font-size: 11px;
  line-height: 1.5;
  overflow-wrap: anywhere;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
  line-clamp: 3;
}

.contract-audit-outbox__table {
  min-width: 1080px;
}

@media (max-width: 720px) {
  .contract-audit-outbox__toolbar {
    align-items: stretch;
    flex-direction: column;
  }

  .contract-audit-outbox__toolbar > .contract-button {
    width: 100%;
  }

  .contract-audit-outbox__last-error {
    max-width: 220px;
  }
}
</style>
