<script setup>
import { onBeforeUnmount, ref, watch } from 'vue'
import FormDialog from '../../shared/components/FormDialog.vue'
import PaginationBar from '../../shared/components/PaginationBar.vue'
import { formatUserError } from '../../shared/utils/userError.js'
import { formatContractDateTime } from '../utils/contractBusinessTime.js'
import { statusLabels } from '../utils/contractDisplay.js'
import { useContractRecordActions } from '../composables/useContractRecordActions.js'
import * as api from '../api/contract.js'

const props = defineProps({
  modelValue: { type: String, default: 'active' },
  showBrowser: { type: Boolean, default: false },
})
const emit = defineEmits(['update:modelValue', 'changed'])
const records = ref([]), total = ref(0), page = ref(1), keyword = ref('')
const listBusy = ref(false), listError = ref(''), notice = ref('')
let listSequence = 0
const { opened, busy, loading, unknown, preview, reason, error, target, canSubmit,
  openRecord, refresh, close, submit } = useContractRecordActions({ api, onChanged: recordChanged })

// loadDeleted 用途：读取独立回收站集合，末页减少时最多重取一次。
// 参数：requested 为目标页码，使用回收站自身的关键字与固定小页。
// 返回值：异步完成；错误保留上次数据且不冒充空集合，迟到请求失效。
async function loadDeleted(requested = page.value) {
  if (!props.showBrowser || props.modelValue !== 'deleted') return
  const ticket = ++listSequence
  listBusy.value = true; listError.value = ''
  try {
    let result = await api.listDeletedContractRecords({ page: requested, page_size: 20, keyword: keyword.value.trim() })
    const last = Math.max(1, Math.ceil(result.total / 20))
    if (requested > last) result = await api.listDeletedContractRecords({ page: last, page_size: 20, keyword: keyword.value.trim() })
    if (ticket !== listSequence) return
    records.value = result.items; total.value = result.total; page.value = result.page
  } catch (cause) {
    if (ticket === listSequence) listError.value = formatUserError(cause, { fallback: '回收站读取失败，请稍后刷新。' })
  } finally { if (ticket === listSequence) listBusy.value = false }
}

// recordChanged 用途：明确展示当前记录结果，再刷新独立回收站和正常台账。
// 参数：result 为已验证的写入回执或人工只读核对结果。
// 返回值：异步完成；读取失败由列表单独提示，不重发业务写入。
async function recordChanged(result) {
  notice.value = `已确认合同当前${result.record_state === 'deleted' ? '已删除' : '已恢复'}。`
  emit('changed', result)
  await loadDeleted()
}

// switchState 用途：切换有效台账与回收站，保持两份集合互相独立。
// 参数：state 为用户明确选择的记录视图。
// 返回值：无；写入期间不切换交互。
function switchState(state) {
  if (busy.value) return
  emit('update:modelValue', state)
}

watch([() => props.modelValue, () => props.showBrowser], () => {
  listSequence++; listBusy.value = false
  if (props.showBrowser && props.modelValue === 'deleted') void loadDeleted(1)
}, { immediate: true })
onBeforeUnmount(() => { listSequence++ })
defineExpose({ openRecord })
</script>

<template>
  <section v-if="showBrowser" class="contract-record-browser" aria-label="合同记录管理">
    <div class="record-toolbar">
      <div class="record-tabs" aria-label="合同记录状态">
        <button type="button" :aria-pressed="modelValue === 'active'" :disabled="busy" @click="switchState('active')">正常合同</button>
        <button type="button" :aria-pressed="modelValue === 'deleted'" :disabled="busy" @click="switchState('deleted')">回收站</button>
      </div>
      <p>删除保留原编号、文件和历史；恢复保留原业务状态。</p>
    </div>
    <p v-if="notice" role="status" class="record-notice">{{ notice }}</p>
    <template v-if="modelValue === 'deleted'">
      <form class="record-search" @submit.prevent="loadDeleted(1)">
        <label>搜索已删除合同<input v-model="keyword" maxlength="100" type="search" placeholder="合同编号、名称或类型" /></label>
        <button type="submit" class="contract-button secondary small" :disabled="listBusy">查询</button>
        <button type="button" class="contract-button secondary small" :disabled="listBusy" @click="loadDeleted()">刷新</button>
      </form>
      <p v-if="listError" class="record-error" role="alert">{{ listError }}</p>
      <div class="record-table-wrap" :aria-busy="listBusy">
        <table class="record-table">
          <thead><tr><th>合同编号 / 名称</th><th>原状态</th><th>删除时间</th><th>删除人</th><th>删除原因</th><th>操作</th></tr></thead>
          <tbody>
            <tr v-for="row in records" :key="row.id">
              <td><strong>{{ row.contract_number || '待编号' }}</strong><span>{{ row.title }}</span></td>
              <td>{{ statusLabels[row.status] || row.status }}</td><td>{{ formatContractDateTime(row.deleted_at) }}</td>
              <td>{{ row.deleted_by || '—' }}</td><td class="record-reason">{{ row.delete_reason }}</td>
              <td><button type="button" class="contract-text-button" :disabled="busy" @click="openRecord(row.id, 'active')">核对并恢复</button></td>
            </tr>
            <tr v-if="!records.length && !listError && !listBusy"><td colspan="6">没有符合条件的已删除合同。</td></tr>
            <tr v-if="listBusy && !records.length"><td colspan="6">正在读取回收站…</td></tr>
          </tbody>
        </table>
      </div>
      <PaginationBar label="合同回收站分页" :page="page" :total="total" :page-size="20" :loading="listBusy" @change="loadDeleted" />
    </template>
  </section>

  <FormDialog :open="opened" :busy="busy" :title="target === 'deleted' ? '删除合同' : '恢复合同'" panel-class="contract-record-dialog" @close="close">
    <p v-if="loading" role="status">正在核对当前合同及业务关联…</p>
    <p v-if="error" class="record-error" role="alert">{{ error }}</p>
    <template v-if="preview">
      <p><strong>{{ preview.title }}</strong> · {{ preview.contract_number || '待编号' }} · V{{ preview.version }}</p>
      <p>{{ target === 'deleted' ? '删除后普通台账和业务引用将不可见，原件及历史保留，可由管理员恢复。' : '恢复原编号和原业务状态，不重新发起审批、建项目或生成资金记录。' }}</p>
      <ul v-if="preview.blockers.length" class="record-blockers"><li v-for="item in preview.blockers" :key="item.code">{{ item.message }}</li></ul>
      <p v-else-if="(target === 'deleted' && preview.record_state === 'deleted') || (target === 'active' && preview.record_state === 'active')" role="status">合同当前已处于目标状态。</p>
      <label class="record-reason-input">{{ target === 'deleted' ? '删除原因' : '恢复说明（选填）' }}
        <textarea v-model="reason" rows="3" :disabled="busy || unknown" :required="target === 'deleted'" maxlength="2000" placeholder="请填写操作依据，最多 1000 个字符" />
        <small>{{ Array.from(reason.trim()).length }} / 1000 个字符</small>
      </label>
    </template>
    <div class="record-dialog-actions">
      <button type="button" class="contract-button secondary" :disabled="busy" @click="close">关闭</button>
      <button type="button" class="contract-button secondary" :disabled="busy || loading" @click="refresh">{{ unknown ? '只读核对结果' : '重新核对资格' }}</button>
      <button type="button" class="contract-button primary" :disabled="!canSubmit" @click="submit">{{ busy ? '正在保存…' : target === 'deleted' ? '确认删除' : '确认恢复' }}</button>
    </div>
  </FormDialog>
</template>

<style scoped>
.contract-record-browser { display: grid; gap: 16px; margin-bottom: 20px; }
.record-toolbar, .record-search, .record-dialog-actions { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.record-toolbar { justify-content: space-between; }
.record-toolbar p { color: var(--text-secondary, #475569); font-size: 13px; margin: 0; }
.record-tabs { display: flex; padding: 4px; border: 1px solid var(--border, #e2e8f0); border-radius: 10px; }
.record-tabs button { border: 0; background: transparent; padding: 8px 20px; border-radius: 7px; color: inherit; cursor: pointer; }
.record-tabs button[aria-pressed='true'] { color: var(--on-primary, #ffffff); background: var(--primary, #2563eb); }
.record-search label, .record-reason-input { display: grid; gap: 8px; }
.record-search input, .record-reason-input textarea { padding: 10px 12px; border: 1px solid var(--line-strong, #cbd5e1); border-radius: 8px; font: inherit; max-width: 100%; color: var(--text, #0f172a); background: var(--surface-card, #ffffff); }
.record-reason-input textarea { box-sizing: border-box; width: 100%; resize: vertical; }
.record-dialog-actions { justify-content: flex-end; margin-top: 24px; }
.record-error, .record-blockers { color: var(--danger-text, #b91c1c); line-height: 1.65; }
.record-notice { color: var(--success-text, #15803d); }
.record-table-wrap { overflow-x: auto; border: 1px solid var(--border, #e2e8f0); border-radius: 12px; background: var(--surface-card, #ffffff); }
.record-table { width: 100%; border-collapse: collapse; text-align: left; font-size: 14px; }
.record-table th, .record-table td { padding: 14px 16px; border-bottom: 1px solid var(--border, #e2e8f0); vertical-align: top; }
.record-table th { background: var(--surface-muted, #f8fafc); white-space: nowrap; }
.record-table td strong, .record-table td span { display: block; min-width: 150px; }
.record-table td span { margin-top: 6px; color: var(--text-secondary, #475569); }
.record-reason { min-width: 160px; max-width: 400px; overflow-wrap: anywhere; white-space: pre-wrap; }
</style>

<style>
.contract-record-dialog { width: min(620px, calc(100vw - 32px)); padding: 24px; }
.contract-record-more { display: inline-block; margin-left: 10px; vertical-align: top; }
.contract-record-more summary { cursor: pointer; color: var(--primary, #2563eb); }
</style>
