<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { getContractImportHistory } from '../api/dataAnalysis.js'
import { historyAmount, historyAvailability } from '../utils/importHistory.js'
import { formatBusinessDateTime } from '@/modules/shared/utils/businessTime.js'

const result = ref(null), busy = ref(false), error = ref('')
let generation = 0
const availability = computed(() => historyAvailability(result.value))
const periods = computed(() => Array.isArray(result.value?.periods) ? result.value.periods : [])
const statusMeta = computed(() => {
  const status = String(result.value?.sync_status || 'UNKNOWN').toUpperCase()
  const map = {
    SUCCESS: { label: '已发布', badge: 'normal', tone: 'success' },
    WAITING_SOURCE: { label: '等待源库', badge: 'warning', tone: 'warning' },
    BLOCKED: { label: '已阻塞', badge: 'risk', tone: 'danger' },
    FAILED: { label: '同步失败', badge: 'risk', tone: 'danger' },
    RUNNING: { label: '同步中', badge: 'info', tone: 'info' },
    UNKNOWN: { label: '状态未知', badge: 'neutral', tone: 'neutral' },
  }
  return map[status] || { label: status, badge: 'neutral', tone: 'neutral' }
})
const summary = computed(() => {
  const rows = periods.value
  const contractTotal = rows.reduce((sum, row) => sum + Number(row.contract_count || 0), 0)
  const sourceFactsTotal = rows.reduce((sum, row) => sum + Number(row.source_facts_count || 0), 0)
  const monthCount = new Set(rows.filter((row) => row.period !== 'UNASSIGNED').map((row) => row.period)).size
  const currencyCount = new Set(rows.map((row) => row.currency).filter(Boolean)).size
  const unassigned = Number(result.value?.unassigned_count ?? rows
    .filter((row) => row.period === 'UNASSIGNED')
    .reduce((sum, row) => sum + Number(row.contract_count || 0), 0))
  return {
    contractTotal,
    sourceFactsTotal,
    monthCount,
    currencyCount,
    unassigned: result.value?.sync_status === 'UNKNOWN' ? null : unassigned,
    coverage: contractTotal ? Math.round((sourceFactsTotal / contractTotal) * 100) : 0,
  }
})
const lastSyncLabel = computed(() => {
  if (!result.value?.synced_at) return '尚无成功同步记录'
  return formatBusinessDateTime(result.value.synced_at, { seconds: true }) || String(result.value.synced_at)
})
const periodModeLabel = (value) => ({
  CONTINUE_LIVE: '接续履约',
  ARCHIVE_ONLY: '历史存档',
  HISTORICAL_CLOSED: '历史结清',
  NORMAL: '普通新合同',
}[value] || value || '未提供')
const reportModeLabel = (value) => ({
  ARCHIVE_SEPARATE: '档案独立统计',
  HISTORICAL_SEPARATE: '历史独立统计',
}[value] || value || '未提供')
const historyStatusLabel = (value) => ({
  active: '有效',
  archived: '已归档',
  completed: '已完成',
  terminated: '已终止',
}[String(value || '').toLowerCase()] || value || '未提供')
const rowCoverage = (row) => {
  const count = Number(row.contract_count || 0)
  return count ? Math.min(100, Math.round((Number(row.source_facts_count || 0) / count) * 100)) : 0
}
const rowKey = (row) => [row.period, row.currency, row.import_mode, row.report_mode, row.status].join('/')

/**
 * refresh 查询当前会话范围的历史独立分栏及真实发布水位。
 * 参数：无；租户、组织、团队与个人范围均由服务端决定。
 * 返回值：Promise<void>；失败保留上次结果并明确标注陈旧。
 */
async function refresh() {
  const ticket = ++generation
  busy.value = true; error.value = ''
  try { const value = await getContractImportHistory(); if (ticket === generation) result.value = value }
  catch (failure) { if (ticket === generation) error.value = failure.message }
  finally { if (ticket === generation) busy.value = false }
}
defineExpose({ refresh })
onMounted(refresh)
onBeforeUnmount(() => { generation++ })
</script>

<template>
  <section class="da-native-panel import-history" aria-label="历史导入独立统计">
    <header class="import-history-head">
      <div class="import-history-title">
        <span class="da-panel-kicker">HISTORICAL IMPORT</span>
        <b>历史导入独立统计</b>
        <p>按原业务月份、币种和合同模式独立分栏；未归期不以导入时间代替，不并入普通签约、商机转化或经营趋势。</p>
      </div>
      <div class="import-history-head-actions">
        <span class="da-badge" :class="statusMeta.badge">{{ statusMeta.label }}</span>
        <button class="da-button" type="button" :disabled="busy" @click="refresh">{{ busy ? '读取中…' : '刷新历史统计' }}</button>
      </div>
    </header>

    <p v-if="error" class="import-history-error" role="alert">{{ error }}。下面如有数据为上次结果，须重新核对。</p>

    <div class="import-history-status" :class="`tone-${statusMeta.tone}`" role="status">
      <span class="import-history-status-dot" aria-hidden="true"></span>
      <div>
        <strong>{{ availability }}</strong>
        <span>最近成功同步：{{ lastSyncLabel }}<template v-if="result && result.sync_status !== 'UNKNOWN'"> · 未归期 {{ summary.unassigned }} 份</template></span>
      </div>
    </div>

    <template v-if="result">
      <div class="import-history-metrics">
        <article class="da-native-metric">
          <span>历史合同</span><strong>{{ summary.contractTotal }}</strong><small>份</small>
          <p>按当前授权范围汇总</p>
        </article>
        <article class="da-native-metric">
          <span>覆盖原月份</span><strong>{{ summary.monthCount }}</strong><small>个月</small>
          <p>{{ summary.currencyCount }} 个币种独立分栏</p>
        </article>
        <article class="da-native-metric" :class="{ 'warn': summary.coverage < 100 }">
          <span>源事实接入</span><strong>{{ summary.sourceFactsTotal }} / {{ summary.contractTotal }}</strong><small>{{ summary.coverage }}%</small>
          <p>其余仅 API 摘要，不代表源事实已接入</p>
        </article>
        <article class="da-native-metric" :class="{ 'danger': summary.unassigned > 0 }">
          <span>未归期合同</span><strong>{{ summary.unassigned === null ? '未知' : summary.unassigned }}</strong><small>份</small>
          <p>缺少可用原业务月份，不能并入趋势</p>
        </article>
      </div>

      <article class="import-history-table-card">
        <div class="import-history-table-head">
          <div>
            <b>历史独立分栏</b>
            <span>金额按原币种分别展示，不合并币种；同一月份可因模式不同出现多行。</span>
          </div>
          <span class="da-badge neutral">{{ periods.length }} 组</span>
        </div>
        <div class="import-history-scroll" data-table-scroll>
          <table class="da-table import-history-table">
            <thead>
              <tr>
                <th scope="col">原月份</th>
                <th scope="col">币种</th>
                <th scope="col">导入模式</th>
                <th scope="col">统计口径</th>
                <th scope="col">原状态</th>
                <th scope="col">合同数</th>
                <th scope="col">原金额</th>
                <th scope="col">源事实接入</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in periods" :key="rowKey(row)">
                <td>
                  <span class="da-badge" :class="row.period === 'UNASSIGNED' ? 'warning' : 'neutral'">{{ row.period === 'UNASSIGNED' ? '未归期' : row.period }}</span>
                </td>
                <td>{{ row.currency }}</td>
                <td>
                  <strong>{{ periodModeLabel(row.import_mode) }}</strong>
                  <small class="import-history-code" :title="row.import_mode">{{ row.import_mode }}</small>
                </td>
                <td>
                  <span>{{ reportModeLabel(row.report_mode) }}</span>
                  <small class="import-history-code" :title="row.report_mode">{{ row.report_mode }}</small>
                </td>
                <td><span class="da-badge neutral">{{ historyStatusLabel(row.status) }}</span></td>
                <td class="import-history-number">{{ row.contract_count }}</td>
                <td class="import-history-number">{{ row.currency }} {{ historyAmount(row.amount_minor) }}</td>
                <td>
                  <div class="import-history-coverage" :class="{ 'is-partial': rowCoverage(row) < 100 }">
                    <div class="import-history-progress"><i :style="{ width: `${rowCoverage(row)}%` }" /></div>
                    <div>
                      <strong>{{ row.source_facts_count }} / {{ row.contract_count }}</strong>
                      <small>{{ rowCoverage(row) }}%<template v-if="rowCoverage(row) < 100"> · 其余仅 API 摘要</template></small>
                    </div>
                  </div>
                </td>
              </tr>
              <tr v-if="!periods.length">
                <td colspan="8" class="import-history-empty">
                  {{ result.sync_status === 'SUCCESS' && !result.stale ? '本次成功发布范围内无历史合同。' : '尚无可用历史分栏，不能据此判断为零。' }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </article>

      <p class="import-history-note">
        <strong>口径提醒</strong>
        API 摘要已接入不代表源库事实已接入，也不代表原件签名已核验；缺少源库配置或版本覆盖时应保留等待／阻塞状态。
      </p>

      <details class="import-history-tech">
        <summary>数据来源与发布水位</summary>
        <dl>
          <div><dt>同步状态</dt><dd><span class="da-badge" :class="statusMeta.badge">{{ statusMeta.label }}</span> <code>{{ result.sync_status || 'UNKNOWN' }}</code></dd></div>
          <div><dt>最近成功同步</dt><dd>{{ lastSyncLabel }}</dd></div>
          <div><dt>来源快照</dt><dd class="import-history-code">{{ result.source_snapshot_id || '未知' }}</dd></div>
          <div><dt>聚合运行</dt><dd class="import-history-code">{{ result.aggregation_run_id || '未知' }}</dd></div>
          <div v-if="result.error_code"><dt>错误码</dt><dd class="import-history-code">{{ result.error_code }}</dd></div>
          <div><dt>统计口径</dt><dd>{{ result.basis }}</dd></div>
        </dl>
      </details>
    </template>
    <p v-else-if="busy" class="import-history-empty" role="status">正在读取历史独立统计…</p>
  </section>
</template>

<style scoped>
.import-history {
  margin-block: 20px;
  overflow-wrap: anywhere;
}

.import-history-head {
  align-items: flex-start;
}

.import-history-title {
  min-width: 0;
}

.import-history-title > b {
  display: block;
  margin-top: 4px;
}

.import-history-title > p {
  max-width: 760px;
  margin: 6px 0 0;
  color: var(--da-muted);
  font-size: var(--fs-xs);
  line-height: 1.65;
}

.import-history-head-actions {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 8px;
}

.import-history-error {
  margin: 0 0 12px;
  padding: 10px 12px;
  color: var(--da-red-text);
  font-size: var(--fs-xs);
  line-height: 1.6;
  border: 1px solid var(--danger-border);
  border-radius: 8px;
  background: var(--da-red-soft);
}

.import-history-status {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  margin-bottom: 14px;
  padding: 10px 12px;
  color: var(--da-body);
  font-size: var(--fs-xs);
  line-height: 1.55;
  border: 1px solid var(--da-line);
  border-radius: 9px;
  background: var(--da-soft);
}

.import-history-status-dot {
  width: 7px;
  height: 7px;
  flex: 0 0 auto;
  margin-top: 5px;
  border-radius: 50%;
  background: var(--da-green);
}

.import-history-status.tone-warning .import-history-status-dot { background: var(--da-amber); }
.import-history-status.tone-danger .import-history-status-dot { background: var(--da-red); }
.import-history-status.tone-info .import-history-status-dot { background: var(--da-blue); }
.import-history-status.tone-neutral .import-history-status-dot { background: var(--da-muted); }
.import-history-status strong { display: block; color: var(--da-ink); font-size: var(--fs-xs); }
.import-history-status span { display: block; margin-top: 2px; color: var(--da-muted); }

.import-history-metrics {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
  margin-bottom: 14px;
}

.import-history-metrics .da-native-metric {
  min-height: 0;
  padding: 13px 14px;
}

.import-history-metrics .da-native-metric p {
  margin: 5px 0 0;
  color: var(--da-muted);
  font-size: var(--fs-xs);
  line-height: 1.5;
}

.import-history-table-card {
  overflow: hidden;
  border: 1px solid var(--da-line);
  border-radius: 10px;
  background: var(--surface-card);
}

.import-history-table-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 13px 15px;
  border-bottom: 1px solid var(--da-line-soft);
}

.import-history-table-head b {
  color: var(--da-ink);
  font-size: 13px;
}

.import-history-table-head span:not(.da-badge) {
  display: block;
  margin-top: 3px;
  color: var(--da-muted);
  font-size: var(--fs-xs);
  line-height: 1.5;
}

.import-history-scroll { overflow-x: auto; }
.import-history-table { min-width: 860px; }
.import-history-table td { vertical-align: top; }

.import-history-number {
  color: var(--da-ink);
  font-variant-numeric: tabular-nums;
  text-align: right;
  white-space: nowrap;
}

.import-history-code {
  display: block;
  margin-top: 2px;
  color: var(--da-muted);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 10.5px;
  line-height: 1.45;
  overflow-wrap: anywhere;
}

.import-history-coverage {
  display: grid;
  min-width: 148px;
  gap: 5px;
}

.import-history-progress {
  width: 100%;
  height: 5px;
  overflow: hidden;
  border-radius: 4px;
  background: var(--da-soft);
}

.import-history-progress i {
  display: block;
  height: 100%;
  border-radius: 4px;
  background: var(--da-green);
}

.import-history-coverage.is-partial .import-history-progress i { background: var(--da-amber); }
.import-history-coverage strong { color: var(--da-ink); font-size: 11.5px; }
.import-history-coverage small { display: block; color: var(--da-muted); font-size: 10.5px; }

.import-history-empty {
  padding: 24px 16px;
  color: var(--da-muted);
  font-size: var(--fs-xs);
  text-align: center;
}

.import-history-note {
  margin: 12px 0 0;
  padding: 9px 11px;
  color: var(--da-muted);
  font-size: var(--fs-xs);
  line-height: 1.6;
  border: 1px solid var(--da-line-soft);
  border-radius: 8px;
  background: var(--da-soft);
}

.import-history-note strong { color: var(--da-ink); }

.import-history-tech {
  margin-top: 12px;
  border: 1px solid var(--da-line);
  border-radius: 9px;
}

.import-history-tech > summary {
  padding: 9px 12px;
  color: var(--da-secondary);
  font-size: var(--fs-xs);
  font-weight: 600;
  cursor: pointer;
}

.import-history-tech dl {
  display: grid;
  gap: 8px;
  margin: 0;
  padding: 0 12px 12px;
}

.import-history-tech dl > div {
  display: grid;
  grid-template-columns: 100px minmax(0, 1fr);
  gap: 10px;
}

.import-history-tech dt { color: var(--da-muted); font-size: 10.5px; }
.import-history-tech dd { min-width: 0; margin: 0; color: var(--da-body); font-size: var(--fs-xs); line-height: 1.55; overflow-wrap: anywhere; }

@media (max-width: 900px) {
  .import-history-metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}

@media (max-width: 640px) {
  .import-history { padding: 14px; }
  .import-history-head { flex-direction: column; }
  .import-history-head-actions { width: 100%; justify-content: space-between; }
  .import-history-metrics { grid-template-columns: minmax(0, 1fr); }
  .import-history-tech dl > div { grid-template-columns: 1fr; gap: 2px; }
}
</style>
