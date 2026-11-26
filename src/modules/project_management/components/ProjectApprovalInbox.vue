<script setup>
import { computed, onMounted, ref, toRef, watch } from 'vue'
import { listApprovalTasks, decideRollback, decideReportCorrection } from '../api/projectManagement.js'
import { useProjectApprovalInbox } from '../composables/useProjectApprovalInbox.js'
import { approvalApplicantLabel, approvalOwnerLabel, approvalStatusLabel, approvalTypeLabel } from '../approvalTasks.js'
import { reportStatusLabel } from '../projectDisplay.js'
import { formatBusinessDateTime } from '../../shared/utils/businessTime.js'
import PaginationBar from '../../shared/components/PaginationBar.vue'

const props = defineProps({
  requestId: { type: String, default: '' },
  context: { type: String, required: true },
  userId: { type: String, required: true },
  refreshVersion: { type: Number, default: 0 },
})
const emit = defineEmits(['open-request', 'back', 'changed'])
const comment = ref('')
const { items, total, page, view, pageSize, loading, refreshing, saving, error, success,
  load, changeView, changePage, canDecide, decide } = useProjectApprovalInbox({
  requestID: toRef(props, 'requestId'), context: toRef(props, 'context'),
  userID: toRef(props, 'userId'), listApprovalTasks, decideRollback, decideReportCorrection,
  onChanged: () => emit('changed'),
})
const detail = computed(() => props.requestId ? items.value[0] : null)
const tabs = [{ key: 'assigned', label: '我的待审批' }, { key: 'submitted', label: '我提交的' }]

// 用途：打开选中申请的精确详情，交由父视图执行受控路由导航。
// 参数：task 为当前受权列表中的申请。
// 返回值：无；忙碌或缺少申请标识时不切换。
function openRequest(task) {
  if (!saving.value && task?.id) emit('open-request',
    ['SPECIAL_METHOD_REVIEW', 'FIELD_DEVIATION', 'NATIVE_SCOPE_CHANGE'].includes(task.type)
      ? task : task.id)
}

// 用途：提交详情中明确选择的决定，成功后清空已使用的意见。
// 参数：decision 为 APPROVED 或 REJECTED。
// 返回值：无；失败保留意见供用户核对并重试。
async function submitDecision(decision) {
  if (await decide(detail.value, decision, comment.value)) comment.value = ''
}

// 用途：把后端时间转换为业务时区的显示内容。
// 参数：value 为申请创建时间。
// 返回值：本地化时间；缺失或无法解析时显示占位符。
function displayTime(value) {
  return value ? formatBusinessDateTime(value) || '—' : '—'
}

watch([() => props.requestId, () => props.context, () => props.userId], () => {
  comment.value = ''
}, { flush: 'sync' })
let reconciled = props.refreshVersion
watch([() => props.refreshVersion, loading, refreshing, saving], () => {
  if (reconciled === props.refreshVersion || loading.value || refreshing.value || saving.value) return
  reconciled = props.refreshVersion
  void load({ background: true })
})
onMounted(load)
</script>

<template>
  <section class="pm-panel pm-approval-inbox" aria-label="审批待办">
    <header class="pm-approval-header">
      <div><h2>{{ requestId ? '审批申请详情' : '审批待办' }}</h2>
        <p>报告返工、更正和现场回退在此审批；特殊方法、偏离及范围变更进入原处理页。</p>
      </div>
      <div class="pm-actions">
        <button v-if="requestId" type="button" class="pm-button"
          :disabled="saving" @click="emit('back')">返回待办列表</button>
        <button type="button" class="pm-button" :disabled="loading || saving" @click="load">
          {{ loading ? '加载中…' : '刷新待办' }}
        </button>
      </div>
    </header>
    <nav v-if="!requestId" class="pm-approval-tabs" aria-label="审批列表视图">
      <button v-for="tab in tabs" :key="tab.key" type="button" class="pm-button"
        :class="{ primary: view === tab.key }" :aria-pressed="view === tab.key"
        :disabled="loading || saving" @click="changeView(tab.key)">{{ tab.label }}</button>
      <span>仅列出待处理申请；通知详情可查看处理结果。</span>
    </nav>
    <p v-if="success" role="status" class="pm-approval-success">{{ success }}</p>
    <div v-if="error" class="pm-approval-error" role="alert"><p>{{ error }}</p>
      <button type="button" class="pm-button" :disabled="loading || saving" @click="load">
        重新加载
      </button>
    </div>
    <p v-if="loading" role="status">正在加载审批申请…</p>
    <template v-else>
      <article v-if="detail" class="pm-approval-detail" aria-label="申请详情">
        <h3>{{ approvalTypeLabel(detail.type) }} · {{ approvalStatusLabel(detail.status) }}</h3>
        <dl class="pm-approval-facts">
          <div><dt>申请编号</dt><dd>{{ detail.id }}</dd></div>
          <div><dt>项目 / 服务项</dt><dd>{{ detail.project_id }} / {{ detail.service_item_id }}</dd></div>
          <div><dt>现场地点</dt><dd>{{ detail.site || '未提供' }}</dd></div>
          <div><dt>申请人</dt><dd>{{ approvalApplicantLabel(detail.requester_display_name, detail.requester_user_id) }}</dd></div>
          <div><dt>审批归属</dt><dd>{{ approvalOwnerLabel(detail) }}</dd></div>
          <div><dt>申请时间</dt><dd>{{ displayTime(detail.created_at) }}</dd></div>
          <div><dt>服务项状态</dt><dd>{{ detail.service_item_status || '—' }}</dd></div>
          <div><dt>报告状态</dt><dd>{{ reportStatusLabel[detail.report_status] || '未提供' }}</dd></div>
        </dl>
        <h4>申请原因</h4><p class="pm-approval-text">{{ detail.reason || '未提供' }}</p>
        <template v-if="detail.status !== 'PENDING'">
          <p class="pm-form-hint">该申请{{ approvalStatusLabel(detail.status) }}，无需再次审批。</p>
          <h4>处理意见</h4><p class="pm-approval-text">{{ detail.decision_comment || '未提供' }}</p>
        </template>
        <template v-else-if="['SPECIAL_METHOD_REVIEW', 'FIELD_DEVIATION', 'NATIVE_SCOPE_CHANGE'].includes(detail.type)">
          <p class="pm-form-hint">请进入原业务页核对本次申请及处理权限。</p>
          <button type="button" class="pm-button" :disabled="saving" @click="openRequest(detail)">进入处理页</button>
        </template>
        <template v-else-if="canDecide(detail) || saving">
          <p v-if="detail.type === 'REPORT_CORRECTION'" class="pm-form-hint">
            批准后旧报告版本作废，并生成待整改的新版本，需重新编制、审核、签发和归档。
          </p>
          <p v-else class="pm-form-hint">批准后服务项将按申请类型回退，相关资源按业务规则补偿。</p>
          <label class="pm-approval-comment"><span>审批意见（必填）</span>
            <textarea v-model="comment" rows="3" maxlength="1000" :disabled="saving"
              placeholder="请说明批准或驳回的依据" /></label>
          <div class="pm-actions"><button type="button" class="pm-button primary"
            :disabled="saving || refreshing || !comment.trim()" @click="submitDecision('APPROVED')">批准申请</button>
            <button type="button" class="pm-button danger" :disabled="saving || refreshing || !comment.trim()"
              @click="submitDecision('REJECTED')">驳回申请</button>
            <span v-if="saving" role="status">正在保存审批结果…</span>
          </div>
        </template>
        <p v-else class="pm-form-hint">{{ detail.requester_user_id === userId
          ? '你是申请人，不能审批自己的申请。' : '当前账号无审批权限，请由归属审批人处理。' }}</p>
      </article>
      <template v-else-if="!requestId && !error">
        <p v-if="!items.length" class="pm-empty-mini">{{ view === 'assigned'
          ? '暂无需要你审批的申请。' : '暂无你提交的待处理申请。' }}</p>
        <div v-else class="pm-approval-list">
          <article v-for="task in items" :key="`${task.type}:${task.id}`" class="pm-approval-row">
            <div><h3>{{ approvalTypeLabel(task.type) }} · {{ task.service_item_id }}</h3>
              <p>{{ task.project_id }} · {{ task.site || '地点未提供' }}</p>
              <p class="pm-approval-text">{{ task.reason }}</p>
              <small>申请人：{{ approvalApplicantLabel(task.requester_display_name, task.requester_user_id) }}
                · 审批归属：{{ approvalOwnerLabel(task) }} · {{ displayTime(task.created_at) }}</small>
            </div>
            <button type="button" class="pm-button" :disabled="saving" @click="openRequest(task)">
              查看申请
            </button>
          </article>
        </div>
        <PaginationBar label="审批待办分页" :page="page" :page-size="pageSize" :total="total"
          :loading="loading" :disabled="saving" @change="changePage" />
      </template>
    </template>
  </section>
</template>

<style scoped>
.pm-approval-header,.pm-approval-row{display:flex;align-items:center;justify-content:space-between;
  flex-wrap:wrap;gap:16px}
.pm-approval-header h2,.pm-approval-row h3{margin:0}
.pm-approval-header p,.pm-approval-tabs span,.pm-approval-row small{color:var(--pm-muted)}
.pm-approval-tabs{display:flex;align-items:center;flex-wrap:wrap;gap:8px;margin:20px 0}
.pm-approval-list{display:grid;gap:12px;margin:20px 0}
.pm-approval-row,.pm-approval-detail{padding:20px;border:1px solid var(--pm-line);border-radius:12px}
.pm-approval-row>div{flex:1;min-width:0}
.pm-approval-facts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}
.pm-approval-facts dt{color:var(--pm-muted);font-size:var(--pm-fs-sm)}
.pm-approval-facts dd{margin:4px 0 0;overflow-wrap:anywhere}
.pm-approval-text{white-space:pre-wrap;overflow-wrap:anywhere}
.pm-approval-comment{display:grid;gap:8px;margin:20px 0}
.pm-approval-comment textarea{box-sizing:border-box;width:100%;padding:12px;resize:vertical;
  background:var(--pm-card);color:inherit;border:1px solid var(--pm-line);border-radius:8px}
.pm-approval-error{color:var(--pm-red-text)}
.pm-approval-success{color:var(--pm-green-text)}
@media(max-width:640px){.pm-approval-facts{grid-template-columns:1fr}}
</style>
