<script setup>
import { computed, ref, watch } from 'vue'
import { reimbursementAPI as api } from '../api/reimbursement.js'
import { createCommandRunner } from '../api/client.js'
import { formatBusinessDateTime } from '../../shared/utils/businessTime.js'
import ErrorState from '../../shared/components/ErrorState.vue'
import { claimStatusLabel as statusLabel, failureMessage } from '../statusLabels.js'

const props = defineProps({ claim: { type: Object, required: true },
  permissions: { type: Array, default: () => [] } })
const state = ref(null)
const capacity = ref(null)
// 读取失败与业务动作失败分开：前者可重读同步状态，后者不能拿"重新加载"冒充重试。
const loadError = ref(null)
const actionError = ref(null)
const reason = ref('')
const busy = ref(false)
const pending = ref(null)
const runner = createCommandRunner(api)
const canRecover = computed(() => props.permissions.includes('expense.integration.manage'))
let generation = 0

// 用途：读取单据的实际同步状态及财务容量诊断，隔离不同单据迟到响应。
// 参数：无。
// 返回值：无；失败时不展示旧单据诊断。
async function load() {
  const ticket = ++generation
  state.value = null; capacity.value = null; loadError.value = null; actionError.value = null
  try {
    const id = encodeURIComponent(props.claim.id)
    const result = await api.request(`/claims/${id}/sync-status`)
    if (ticket !== generation) return
    state.value = result
    if (props.permissions.includes('expense.payment.read')) {
      const value = await api.request(`/claims/${id}/spend-capacity`)
      if (ticket === generation) capacity.value = value
    }
  } catch (cause) { if (ticket === generation) loadError.value = cause }
}

// 用途：恢复当前单据的权威完整快照，未知结果沿用原命令。
// 参数：retry 为是否查询并重试未确认命令。
// 返回值：无；恢复不会增加财务版本或付款事实。
async function replay(retry = false) {
  if (busy.value) return
  busy.value = true; actionError.value = null
  try {
    if (retry) await runner.retry()
    else {
      if (!reason.value.trim()) throw new Error('请填写重投原因')
      await runner.execute('recovery.snapshot', `/claims/${encodeURIComponent(props.claim.id)}/spend-replays`,
        { expected_version: props.claim.version, reason: reason.value.trim() })
    }
    await load()
  } catch (cause) { actionError.value = cause }
  finally { pending.value = runner.pending(); busy.value = false }
}

watch(() => [props.claim.id, props.claim.version], load, { immediate: true })
</script>

<template>
  <article class="expense-item">
    <h3>项目支出同步</h3>
    <ErrorState v-if="loadError" compact title="同步状态读取失败" :error="loadError"
      retry-text="重新读取同步状态" @retry="load" />
    <ErrorState v-else-if="actionError" compact title="同步操作未完成" :error="actionError" :retry="false" />
    <template v-if="state">
      <p>当前财务版本 {{ state.current_revision }} · 最后成功投递版本 {{ state.successful_revision }} · {{ statusLabel(state.status) }}</p>
      <p v-if="state.last_error">同步失败：{{ failureMessage(state.last_error) }}</p>
      <p v-if="state.next_attempt_at">下一次重试：{{ formatBusinessDateTime(state.next_attempt_at) }}</p>
    </template>
    <p v-if="capacity">累计历史分摊 {{ capacity.allocations_used }} / {{ capacity.allocation_limit }}；本次付款及全额冲正预留 {{ capacity.allocation_reservation }} 条。</p>
    <p v-if="capacity?.warning" role="alert">{{ capacity.can_record ? '历史接近容量上限，请财务关注。' : '当前不能安全预留全额冲正空间，需财务受控处理。' }}</p>
    <form v-if="canRecover && state?.current_revision > 0" @submit.prevent="replay(false)">
      <label>重投原因 <input v-model="reason" required maxlength="1000" :disabled="busy || !!pending"></label>
      <button class="expense-button" type="submit" :disabled="busy || !!pending">重投权威快照</button>
    </form>
    <button v-if="pending" class="expense-button" :disabled="busy" @click="replay(true)">查询并重试原命令</button>
  </article>
</template>
