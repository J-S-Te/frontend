<script setup>
import { computed } from 'vue'
import { useCommercialRecords, COMMERCIAL_STATUSES } from '../commercialRecords.js'

const props = defineProps({
  opportunityId: { type: [String, Number], required: true },
  opportunityStatus: { type: String, default: '' },
  permissions: { type: Array, default: () => [] },
  attachments: { type: Array, default: () => [] },
  commandStore: { type: Map, default: null },
  commandScope: { type: String, default: '' },
  downloadAvailable: { type: Boolean, default: false },
})
const emit = defineEmits(['download', 'refresh-attachments'])
const {
  rows, total, page, loading, readError, formError, notice, form, voidTarget,
  voidReason, submitting, uncertain, verified, canRead, canReadAttachments, canWrite, availableAttachments,
  statuses, load, openCreate, openEdit, closeForm, selectAttachment, verifyUnknown,
  save, openVoid, confirmVoid,
} = useCommercialRecords(props, emit)
const canDownload = computed(() => canReadAttachments.value && props.downloadAvailable
  && props.permissions.includes('opportunity.attachment.download'))
const fieldsDisabled = computed(() => submitting.value || uncertain.value || !canWrite.value)

// 用途：展示当前资料类型对应的人工业务状态。
// 参数：record 为报价或投标资料。
// 返回值：中文状态名称，未知状态保留可理解占位。
function statusLabel(record) {
  return COMMERCIAL_STATUSES[record.type]?.find(([value]) => value === record.status)?.[1] || '状态未知'
}

// 用途：按当前下载能力转交父组件使用既有受控下载。
// 参数：attachment 为该记录返回的可信附件。
// 返回值：无；未通过校验或无独立下载权限时不触发。
function download(attachment) {
  if (canDownload.value && attachment.scan_status === 'CLEAN') emit('download', attachment)
}
</script>

<template>
  <aside v-if="canRead" class="crm-opportunity-attachment-panel crm-commercial-panel"
    aria-label="报价与投标资料">
    <h3>报价与投标资料</h3>
    <p class="crm-note">人工登记资料，仅记录线下业务事实，不代表审批通过，不自动推进商机阶段。</p>
    <div class="crm-actions">
      <template v-if="canWrite">
        <button type="button" :disabled="submitting || uncertain" @click="openCreate('QUOTATION')">
          登记报价
        </button>
        <button type="button" :disabled="submitting || uncertain" @click="openCreate('BID')">
          登记投标
        </button>
      </template>
      <button type="button" :disabled="loading || submitting" @click="load()">
        {{ loading ? '读取中…' : '刷新资料' }}
      </button>
    </div>
    <p v-if="notice" class="crm-alert success" role="status">{{ notice }}</p>
    <p v-if="readError" class="crm-alert error" role="alert">
      {{ readError }}<span v-if="notice"> 保存已确认，刷新失败不会撤销已保存的资料。</span>
    </p>
    <p v-if="!loading && !readError && !rows.length" class="crm-note">暂无人工登记资料。</p>
    <ul v-if="rows.length" class="crm-commercial-list">
      <li v-for="record in rows" :key="record.id" :class="{ 'is-void': record.is_void }">
        <div class="crm-commercial-heading">
          <strong>{{ record.title }}</strong>
          <span class="crm-tag">人工登记</span>
          <span v-if="record.is_void" class="crm-tag">已作废</span>
        </div>
        <dl>
          <dt>类型 / 状态</dt>
          <dd>{{ record.type === 'BID' ? '投标' : '报价' }} · {{ statusLabel(record) }}</dd>
          <dt>业务单号</dt><dd>{{ record.document_no || '未填写' }}</dd>
          <dt>业务日期</dt><dd>{{ record.record_date || '—' }}</dd>
          <dt>金额（元）</dt><dd>{{ record.amount ?? '未知' }}</dd>
          <dt>录入人 / 版本</dt><dd>{{ record.created_by_name || '—' }} · v{{ record.version }}</dd>
          <template v-if="record.notes"><dt>说明</dt><dd>{{ record.notes }}</dd></template>
          <template v-if="record.is_void">
            <dt>作废说明</dt><dd>{{ record.void_reason || '—' }}</dd>
          </template>
        </dl>
        <ul v-if="canReadAttachments && record.attachments?.length" class="crm-commercial-files">
          <li v-for="attachment in record.attachments" :key="attachment.id">
            <span>{{ attachment.file_name }}</span>
            <button type="button" :disabled="!canDownload || attachment.scan_status !== 'CLEAN'"
              :title="!downloadAvailable ? '可信附件下载暂不可用，请刷新附件能力。' : ''"
              @click="download(attachment)">下载</button>
          </li>
        </ul>
        <div v-if="canWrite && !record.is_void" class="crm-actions">
          <button type="button" :disabled="submitting || uncertain" @click="openEdit(record)">更正</button>
          <button type="button" class="danger" :disabled="submitting || uncertain"
            @click="openVoid(record)">作废登记</button>
        </div>
      </li>
    </ul>
    <nav v-if="total > 20" class="crm-actions" aria-label="人工资料分页">
      <button type="button" :disabled="loading || submitting || page <= 1"
        @click="load(page - 1)">上一页</button>
      <span>第 {{ page }} 页 · 共 {{ total }} 条</span>
      <button type="button" :disabled="loading || submitting || page * 20 >= total"
        @click="load(page + 1)">下一页</button>
    </nav>

    <form v-if="form" class="crm-commercial-form" @submit.prevent="save">
      <h4>{{ form.id ? '更正' : '登记' }}{{ form.type === 'BID' ? '投标' : '报价' }}资料</h4>
      <fieldset :disabled="fieldsDisabled">
        <label>资料主题<input v-model="form.title" required maxlength="200"></label>
        <label>业务单号（可空）<input v-model="form.document_no" maxlength="64"></label>
        <label>业务日期<input v-model="form.record_date" required type="date"></label>
        <label>金额（元，可空）
          <input v-model="form.amount" inputmode="decimal" maxlength="19"
            placeholder="未知可留空，最多两位小数">
        </label>
        <label>人工业务状态
          <select v-model="form.status" required>
            <option v-for="[value, label] in statuses" :key="value" :value="value">{{ label }}</option>
          </select>
        </label>
        <label>说明（可空）<textarea v-model="form.notes" maxlength="2000"></textarea></label>
        <fieldset class="crm-commercial-attachments">
          <legend>关联可信附件（可不选，最多20个）</legend>
          <p class="crm-note">请先在可信附件区上传并完成校验；这里仅关联已通过校验的文件。</p>
          <label v-for="attachment in availableAttachments" :key="attachment.id" class="check">
            <input type="checkbox" :checked="form.attachment_ids.includes(String(attachment.id))"
              @change="selectAttachment(String(attachment.id), $event.target.checked)">
            {{ attachment.file_name }}
          </label>
          <p v-if="!availableAttachments.length" class="crm-note">
            暂无可关联的已校验附件；可先保存纯资料登记。
          </p>
        </fieldset>
      </fieldset>
      <p v-if="uncertain" class="crm-alert warning" role="alert">
        登记结果尚未确认，请先核对最新列表是否已存在本次资料。重试将使用原登记内容与幂等键。
      </p>
      <p v-if="formError" class="crm-alert error" role="alert">{{ formError }}</p>
      <div class="crm-actions">
        <button type="button" :disabled="submitting || uncertain" @click="closeForm">取消</button>
        <button v-if="uncertain" type="button" :disabled="loading || submitting"
          @click="verifyUnknown">核对最新列表</button>
        <button class="primary" :disabled="!canWrite || submitting || (uncertain && !verified)">
          {{ submitting ? '保存中…' : uncertain ? '已核对，重试原登记' : '保存资料' }}
        </button>
      </div>
    </form>
    <form v-if="voidTarget" class="crm-commercial-form" @submit.prevent="confirmVoid">
      <h4>作废资料登记：{{ voidTarget.title }}</h4>
      <p class="crm-note">作废只撤销错误录入并保留历史；离线业务取消请通过更正状态记录。</p>
      <label>作废说明<textarea v-model="voidReason" required maxlength="500"
        :disabled="submitting || !canWrite"></textarea></label>
      <p v-if="formError" class="crm-alert error" role="alert">{{ formError }}</p>
      <div class="crm-actions">
        <button type="button" :disabled="submitting" @click="closeForm">取消</button>
        <button class="danger" :disabled="submitting || !canWrite">
          {{ submitting ? '作废中…' : '确认作废登记' }}
        </button>
      </div>
    </form>
  </aside>
</template>

<style scoped>
.crm-commercial-panel { min-width: 0; }
.crm-commercial-list, .crm-commercial-files { list-style: none; padding: 0; margin: 0; }
.crm-commercial-list > li {
  padding: 0.85rem 0;
  border-bottom: 1px solid var(--border-color, #d7dce5);
}
.crm-commercial-heading { display: flex; align-items: center; flex-wrap: wrap; gap: 0.4rem; }
.crm-commercial-heading strong { overflow-wrap: anywhere; }
.crm-commercial-list dl {
  display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 0.3rem 0.7rem;
  margin: 0.6rem 0;
}
.crm-commercial-list dd { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
.crm-commercial-files li { display: flex; align-items: center; gap: 0.5rem; margin: 0.4rem 0; }
.crm-commercial-files span { overflow-wrap: anywhere; }
.crm-commercial-form {
  display: grid; gap: 0.75rem; margin-top: 1rem; padding-top: 0.8rem;
  border-top: 1px solid var(--border-color, #d7dce5);
}
.crm-commercial-form h4 { margin: 0; }
.crm-commercial-form > fieldset { border: 0; padding: 0; margin: 0; min-width: 0; }
.crm-commercial-form label { display: grid; gap: 0.3rem; margin-bottom: 0.7rem; }
.crm-commercial-form input, .crm-commercial-form select, .crm-commercial-form textarea {
  box-sizing: border-box; max-width: 100%; min-width: 0;
}
.crm-commercial-form label.check { display: flex; align-items: center; overflow-wrap: anywhere; }
.crm-commercial-attachments { border: 1px solid var(--border-color, #d7dce5); min-width: 0; }
.is-void > .crm-commercial-heading strong { text-decoration: line-through; }
</style>
