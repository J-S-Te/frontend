<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import PromptDialog from '@/modules/shared/components/PromptDialog.vue'
import PaginationBar from '@/modules/shared/components/PaginationBar.vue'
import ConsoleIcon from '@/modules/platform/shared/components/ConsoleIcon.vue'
import { listContractRevisionHolds, resolveContractRevisionHold } from '../api/settlement.js'
import {
  REVISION_HOLD_CONTRACT_REF_MAX,
  REVISION_HOLD_MAX_OFFSET,
  REVISION_HOLD_PAGE_SIZE,
  REVISION_HOLD_REASON_MAX,
  REVISION_HOLD_REASON_MIN,
  REVISION_HOLD_STATUS_PENDING,
  REVISION_HOLD_STATUS_RESOLVED,
  formatRevisionHoldError,
  revisionHoldCreatedAt,
  revisionHoldLength,
  revisionHoldReasonMeta,
  revisionHoldResolveBlockedReason,
  revisionHoldStatusMeta,
  summarizeRevisionHoldDiff,
  validateRevisionHoldReason,
} from '../utils/revisionHold.js'

// 合同财务修订工单面板：财务查看合同修订落库的逐期差异，并在完成调整/红冲后人工关单。
// 数据全部来自服务端 GET /contract-revision-holds 与 POST /{id}/resolve；
// 页面不推断工单状态，也不改写任何计划或票据，关单成功后以刷新后的列表为准。
const props = defineProps({
  can: { type: Function, default: () => false },
  initialContractRef: { type: String, default: '' },
})

const canRead = () => props.can('settlement.revision.read')
const resolveBlockedReason = computed(() => revisionHoldResolveBlockedReason(props.can))
const canResolve = computed(() => resolveBlockedReason.value === '')

const filters = ref({
  status: REVISION_HOLD_STATUS_PENDING,
  contractRef: String(props.initialContractRef || ''),
})
const applied = ref({ status: REVISION_HOLD_STATUS_PENDING, contractRef: String(props.initialContractRef || '') })
const limit = REVISION_HOLD_PAGE_SIZE
const pageIndex = ref(0)
const items = ref([])
const loading = ref(false)
const listError = ref('')
const notice = ref('')
const resolveDialog = ref(null)
const resolveBusy = ref(false)
const resolveError = ref('')
let generation = 0
let disposed = false

const statusOptions = [
  { value: REVISION_HOLD_STATUS_PENDING, label: '待复核' },
  { value: REVISION_HOLD_STATUS_RESOLVED, label: '已关单' },
  { value: '', label: '全部状态' },
]
// 逐行预计算展示字段：模板只排版，不再重复解析 diff 或格式化时间。
const rows = computed(() =>
  items.value.map((item) => ({
    item,
    summary: summarizeRevisionHoldDiff(item?.diff),
    reason: revisionHoldReasonMeta(item?.hold_reason),
    status: revisionHoldStatusMeta(item?.status),
    createdAt: revisionHoldCreatedAt(item?.created_at),
  })),
)
const hasPageBefore = computed(() => pageIndex.value > 0)
const hasPageAfter = computed(
  () => items.value.length >= limit && (pageIndex.value + 1) * limit <= REVISION_HOLD_MAX_OFFSET,
)
const isEmpty = computed(() => !loading.value && !listError.value && items.value.length === 0)
const emptyHint = computed(() =>
  applied.value.status === REVISION_HOLD_STATUS_RESOLVED
    ? '当前筛选下没有已关单的修订工单。'
    : '当前筛选下没有待复核的修订工单，说明合同修订没有留下需要人工处理的差异。',
)

/**
 * load 读取当前筛选与页码的工单页。
 * 参数：无；使用已应用的筛选条件，迟到响应不覆盖新结果。
 * 返回值：Promise<void>；失败只更新错误提示，不改动已有列表。
 */
async function load() {
  if (!canRead()) return
  const ticket = ++generation
  loading.value = true
  listError.value = ''
  try {
    const result = await listContractRevisionHolds({
      status: applied.value.status,
      contractRef: applied.value.contractRef,
      limit,
      offset: pageIndex.value * limit,
    })
    if (disposed || ticket !== generation) return
    items.value = Array.isArray(result?.items) ? result.items : []
  } catch (failure) {
    if (disposed || ticket !== generation) return
    listError.value = formatRevisionHoldError(failure, { action: 'list' })
  } finally {
    if (!disposed && ticket === generation) loading.value = false
  }
}

/**
 * applyFilters 应用筛选：先本地校验合同筛选项长度，再回到第一页重新读取。
 * 参数：无。
 * 返回值：Promise<void>。
 */
async function applyFilters() {
  const contractRef = filters.value.contractRef.trim()
  if (revisionHoldLength(contractRef) > REVISION_HOLD_CONTRACT_REF_MAX) {
    listError.value = `合同编号或合同 ID 最多 ${REVISION_HOLD_CONTRACT_REF_MAX} 字，请缩短后再查询。`
    return
  }
  applied.value = { status: filters.value.status, contractRef }
  pageIndex.value = 0
  notice.value = ''
  await load()
}

async function resetFilters() {
  filters.value = { status: REVISION_HOLD_STATUS_PENDING, contractRef: '' }
  await applyFilters()
}

async function changePage(delta) {
  if (loading.value) return
  const next = Math.max(0, pageIndex.value + delta)
  if (next === pageIndex.value) return
  if (delta > 0 && !hasPageAfter.value) return
  pageIndex.value = next
  notice.value = ''
  await load()
}

/**
 * openResolve 打开关单确认弹窗；无权限时改为展示禁用原因，不进入弹窗。
 * 参数：item 为当前工单行。
 * 返回值：无。
 */
function openResolve(item) {
  if (!item?.id) return
  if (!canResolve.value) {
    listError.value = resolveBlockedReason.value
    return
  }
  resolveError.value = ''
  resolveDialog.value = {
    id: item.id,
    contractNo: item.source_contract_no || item.source_contract_id || '',
    versionText: `${item.from_contract_version ?? '—'} → ${item.to_contract_version ?? '—'}`,
  }
}

function closeResolve() {
  if (resolveBusy.value) return
  resolveDialog.value = null
  resolveError.value = ''
}

/**
 * submitResolve 校验关单说明后提交；提交中禁止重复提交，成功后刷新列表。
 * 参数：value 为弹窗里的关单说明。
 * 返回值：Promise<void>。
 */
// goToPage 把分页条的目标页码换算成既有 changePage 的相对步数：
// 只允许“上一页”或“下一页”一步（与服务端 offset 语义一致，避免跳页造成空窗）。
async function goToPage(target) {
  const next = Math.max(1, Math.trunc(Number(target) || 1)) - 1
  if (next === pageIndex.value) return
  if (next > pageIndex.value && !hasPageAfter.value) return
  await changePage(next - pageIndex.value)
}

async function submitResolve(value) {
  if (resolveBusy.value || !resolveDialog.value) return
  const checked = validateRevisionHoldReason(value)
  if (!checked.ok) {
    resolveError.value = checked.message
    return
  }
  const target = resolveDialog.value
  resolveBusy.value = true
  resolveError.value = ''
  try {
    await resolveContractRevisionHold(target.id, checked.reason)
    if (disposed) return
    resolveDialog.value = null
    notice.value = `已关单：${target.contractNo || target.id}（合同版本 ${target.versionText}）。请核对刷新后的列表。`
    await load()
  } catch (failure) {
    if (disposed) return
    resolveError.value = formatRevisionHoldError(failure, { action: 'resolve' })
  } finally {
    if (!disposed) resolveBusy.value = false
  }
}

onMounted(() => {
  if (!canRead()) return
  load()
})
onBeforeUnmount(() => {
  disposed = true
  generation++
})
</script>

<template>
  <section
    v-if="canRead()"
    class="settlement-panel settlement-revision-holds"
    aria-labelledby="settlement-revision-holds-title"
  >
    <div class="settlement-panel-head">
      <div>
        <p class="revision-holds-eyebrow">合同财务修订</p>
        <h2 id="settlement-revision-holds-title">
          修订工单 <small>差异待人工关单</small>
        </h2>
        <p>
          合同条款修订后，含已回款、核销、开票或预占的分期不会被自动改写，差异会落在待复核工单里。财务按逐期差异完成调整或红冲后在这里关单。
        </p>
      </div>
      <div class="revision-holds-actions">
        <button
          type="button"
          class="console-button secondary small"
          :disabled="loading || resolveBusy"
          aria-label="刷新修订工单列表"
          @click="load"
        >
          <ConsoleIcon name="reset" />刷新
        </button>
      </div>
    </div>

    <form class="settlement-filter-bar revision-holds-filters" aria-label="修订工单筛选" @submit.prevent="applyFilters">
      <label
        ><span class="settlement-visually-hidden">工单状态</span>
        <select v-model="filters.status" aria-label="工单状态">
          <option v-for="option in statusOptions" :key="option.value" :value="option.value">
            {{ option.label }}
          </option>
        </select>
      </label>
      <label
        ><ConsoleIcon name="search" /><span class="settlement-visually-hidden">合同编号或合同 ID</span
        ><input
          v-model.trim="filters.contractRef"
          :maxlength="REVISION_HOLD_CONTRACT_REF_MAX"
          placeholder="合同编号或合同 ID"
          aria-label="合同编号或合同 ID"
        />
      </label>
      <button type="submit" class="console-button small" :disabled="loading">查询</button>
      <button type="button" class="console-button secondary small" :disabled="loading" @click="resetFilters">
        重置筛选
      </button>
    </form>

    <p v-if="resolveBlockedReason" class="settlement-detail-notice revision-holds-blocked" role="status">
      关单按钮已禁用：{{ resolveBlockedReason }}
    </p>
    <p v-if="loading" class="settlement-loading" role="status">正在读取修订工单…</p>
    <p v-if="listError" class="settlement-error" role="alert">{{ listError }}</p>
    <p v-if="notice" class="settlement-muted revision-holds-notice" role="status">{{ notice }}</p>

    <p v-if="isEmpty" class="settlement-table-empty" data-testid="revision-holds-empty">{{ emptyHint }}</p>

    <div v-if="rows.length" class="settlement-table-scroll">
      <table>
        <caption class="settlement-visually-hidden">
          合同财务修订工单列表：合同、合同版本、逐期差异、工单原因、创建时间与关单操作
        </caption>
        <thead>
          <tr>
            <th scope="col">合同</th>
            <th scope="col">合同版本</th>
            <th scope="col">差异摘要</th>
            <th scope="col">工单原因</th>
            <th scope="col">创建时间</th>
            <th scope="col">状态</th>
            <th scope="col">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="row.item.id">
            <td class="settlement-contract-cell">
              <strong>{{ row.item.source_contract_no || '—' }}</strong>
              <small class="settlement-muted">合同 ID {{ row.item.source_contract_id || '—' }}</small>
              <small v-if="row.item.contract_snapshot_id" class="settlement-muted">
                合同快照 {{ row.item.contract_snapshot_id }}
              </small>
              <small v-else class="settlement-muted">无新合同快照（本次修订未落地）</small>
            </td>
            <td>
              <span class="revision-holds-version">
                v{{ row.item.from_contract_version ?? '—' }}
                <span aria-hidden="true">→</span>
                <span class="settlement-visually-hidden">修订为</span>
                v{{ row.item.to_contract_version ?? '—' }}
              </span>
              <small class="settlement-muted">修订事件 {{ row.item.revision_event_id || '—' }}</small>
            </td>
            <td>
              <p v-if="row.summary.hasRows" class="revision-holds-summary">
                <template v-if="row.summary.oldContractAmount || row.summary.newContractAmount">
                  合同金额 {{ row.summary.oldContractAmount || '—' }} → {{ row.summary.newContractAmount || '—' }}；
                </template>
                待人工处理 {{ row.summary.rows.length }} 期
              </p>
              <ul v-if="row.summary.hasRows" class="revision-holds-diff-list">
                <li v-for="diff in row.summary.rows.slice(0, 2)" :key="`${row.item.id}-${diff.installmentNo}`">
                  第 {{ diff.installmentNo || '—' }} 期 · {{ diff.kindLabel }}
                  <template v-if="diff.removed">
                    （原计划 {{ diff.oldAmount || '—' }}，{{ diff.oldDueDate || '—' }}）
                  </template>
                  <template v-else>
                    ：金额 {{ diff.oldAmount || '—' }} → {{ diff.newAmount || '—' }}，到期日
                    {{ diff.oldDueDate || '—' }} → {{ diff.newDueDate || '—' }}
                  </template>
                </li>
              </ul>
              <p v-if="row.summary.rows.length > 2" class="settlement-muted">
                另有 {{ row.summary.rows.length - 2 }} 期差异，见下方逐期明细。
              </p>
              <details v-if="row.summary.hasRows" class="revision-holds-detail">
                <summary>查看逐期差异{{ row.summary.hasFacts ? '与已发生事实' : '' }}</summary>
                <table class="revision-holds-detail-table">
                  <caption class="settlement-visually-hidden">
                    逐期差异明细
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">期次</th>
                      <th scope="col">差异类型</th>
                      <th scope="col">计划金额</th>
                      <th scope="col">计划到期日</th>
                      <th scope="col">已发生事实</th>
                      <th scope="col">关联单据</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="diff in row.summary.rows" :key="`${row.item.id}-detail-${diff.installmentNo}`">
                      <td>第 {{ diff.installmentNo || '—' }} 期</td>
                      <td>{{ diff.kindLabel }}</td>
                      <td>
                        {{ diff.oldAmount || '—' }}
                        <template v-if="!diff.removed"> → {{ diff.newAmount || '—' }}</template>
                      </td>
                      <td>
                        {{ diff.oldDueDate || '—' }}
                        <template v-if="!diff.removed"> → {{ diff.newDueDate || '—' }}</template>
                      </td>
                      <td>
                        <template v-if="diff.facts.length">
                          <span v-for="fact in diff.facts" :key="fact.key" class="revision-holds-fact">
                            {{ fact.label }} {{ fact.amount }}
                          </span>
                        </template>
                        <span v-else class="settlement-muted">—</span>
                      </td>
                      <td>{{ diff.references ? `${diff.references} 条` : '—' }}</td>
                    </tr>
                  </tbody>
                </table>
              </details>
              <p v-if="row.summary.hasDiff && !row.summary.hasRows" class="revision-holds-summary">
                <template v-if="row.summary.oldContractAmount || row.summary.newContractAmount">
                  合同金额 {{ row.summary.oldContractAmount || '—' }} → {{ row.summary.newContractAmount || '—' }}；
                </template>
                <template v-if="row.summary.newTermTotal">新条款合计 {{ row.summary.newTermTotal }}；</template>
                <template v-if="row.summary.newTermsCount">共 {{ row.summary.newTermsCount }} 期；</template>
                没有逐期差异明细。
              </p>
              <p v-if="!row.summary.hasDiff" class="settlement-muted">服务端未返回可读的差异明细，请按合同版本核对。</p>
            </td>
            <td>
              <span class="revision-holds-reason">{{ row.reason.label }}</span>
              <small class="settlement-muted">{{ row.reason.note }}</small>
            </td>
            <td>
              {{ row.createdAt || '—' }}
              <small class="settlement-muted">北京时间</small>
            </td>
            <td>
              <span class="settlement-badge" :class="`tone-${row.status.tone}`">{{ row.status.label }}</span>
              <small v-if="row.item.status === REVISION_HOLD_STATUS_RESOLVED" class="settlement-muted">
                {{ row.item.resolution_reason || '关单说明缺失' }}
                <template v-if="row.item.resolved_by"> · {{ row.item.resolved_by }}</template>
              </small>
            </td>
            <td>
              <button
                v-if="row.item.status === REVISION_HOLD_STATUS_PENDING"
                type="button"
                class="console-button secondary small"
                :disabled="!canResolve || resolveBusy || loading"
                :aria-label="`关单：${row.item.source_contract_no || row.item.source_contract_id || row.item.id}`"
                :aria-describedby="canResolve ? undefined : 'settlement-revision-holds-resolve-hint'"
                @click="openResolve(row.item)"
              >
                关闭修订工单
              </button>
              <span v-else class="settlement-muted">已关单</span>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-if="!canResolve" id="settlement-revision-holds-resolve-hint" class="settlement-muted">
        {{ resolveBlockedReason }}
      </p>
    </div>

    <div v-if="rows.length || hasPageBefore" class="revision-holds-pagination">
      <span class="settlement-muted">每页最多 {{ limit }} 条</span>
      <PaginationBar
        label="修订工单分页"
        prev-text="上一页"
        next-text="下一页"
        :page="pageIndex + 1"
        :count="rows.length"
        :page-size="limit"
        :has-more="hasPageAfter"
        :loading="loading"
        @change="goToPage"
      />
    </div>

    <PromptDialog
      :open="Boolean(resolveDialog)"
      title="关单确认"
      :description="`确认修订工单 ${resolveDialog?.contractNo || resolveDialog?.id || ''}（合同版本 ${resolveDialog?.versionText || ''}）已完成逐期调整或红冲。关单只关闭人工复核工单，不会自动改写任何收款计划或票据。`"
      :label="`关单说明（${REVISION_HOLD_REASON_MIN} 至 ${REVISION_HOLD_REASON_MAX} 字）`"
      placeholder="请写明已完成的处理，例如：第 2 期已按修订金额调整并红冲原发票"
      confirm-text="关闭修订工单"
      cancel-text="取消"
      :minlength="REVISION_HOLD_REASON_MIN"
      :maxlength="REVISION_HOLD_REASON_MAX"
      :busy="resolveBusy"
      :error="resolveError"
      @confirm="submitResolve"
      @cancel="closeResolve"
    />
  </section>
</template>

<style scoped>
.settlement-revision-holds {
  overflow-wrap: anywhere;
}
.settlement-revision-holds .settlement-panel-head {
  align-items: flex-start;
}
.revision-holds-eyebrow {
  margin: 0 0 4px;
  color: var(--settlement-blue, #2563eb);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
}
.revision-holds-actions {
  flex: 0 0 auto;
}
.revision-holds-filters {
  margin-block: 12px;
}
.revision-holds-filters label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.revision-holds-blocked,
.revision-holds-notice {
  margin-block: 8px;
  line-height: 1.65;
}
.revision-holds-version {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 2px 8px;
  border-radius: 999px;
  background: rgba(37, 99, 235, 0.09);
  color: var(--settlement-blue-dark, #1d4ed8);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.settlement-revision-holds td small {
  display: block;
  margin-top: 2px;
  line-height: 1.5;
}
.revision-holds-summary {
  margin: 0 0 6px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.revision-holds-diff-list {
  margin: 0 0 6px;
  padding-inline-start: 18px;
  color: #475569;
  line-height: 1.6;
}
.revision-holds-detail {
  margin-top: 6px;
  overflow-x: auto;
}
.revision-holds-detail > summary {
  cursor: pointer;
  color: var(--settlement-blue, #2563eb);
  font-weight: 600;
}
.revision-holds-detail-table {
  margin-top: 8px;
  min-width: 520px;
  border-radius: 10px;
  background: #f8fafc;
  font-size: 13px;
}
.revision-holds-detail-table th,
.revision-holds-detail-table td {
  padding: 6px 10px;
  font-variant-numeric: tabular-nums;
}
.revision-holds-fact {
  display: inline-block;
  margin: 0 6px 4px 0;
  padding: 1px 7px;
  border-radius: 999px;
  background: rgba(217, 119, 6, 0.12);
  color: #b45309;
  font-size: 12px;
  font-weight: 600;
}
.revision-holds-reason {
  display: inline-block;
  margin-bottom: 4px;
  font-weight: 600;
}
.revision-holds-pagination {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 12px;
}
@media (max-width: 720px) {
  .revision-holds-pagination {
    justify-content: flex-start;
  }
}

/* 深色主题：差异清单墨色、明细表底片与预警小胶囊；浅色声明未改。 */
[data-theme="dark"] .revision-holds-diff-list {
  color: var(--text-secondary);
}
[data-theme="dark"] .revision-holds-detail-table {
  background: var(--surface-muted);
}
[data-theme="dark"] .revision-holds-fact {
  color: var(--warning-text);
}
</style>
