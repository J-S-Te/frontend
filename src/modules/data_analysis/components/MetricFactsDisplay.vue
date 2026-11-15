<script setup>
import { computed, ref } from 'vue'
import { formatFactMoney, formatFactRate } from '../utils/metricFacts.js'
import { formatBusinessDateTime } from '../../shared/utils/businessTime.js'

const props = defineProps({ section: { type: String, required: true }, summary: { type: Object, default: null } })
const costDimension = ref('organization')
const title = computed(() => ({ contract: '折扣与价格基准', project: '实际人员与设备利用率',
  report: '首次审核与退回', finance: '确认收入与成本' })[props.section])
const bucketLabels = { LT_80: '低于八折', FROM_80_TO_90: '八折至九折（不含九折）',
  FROM_90_TO_100: '九折至原价（不含原价）', AT_100: '原价', GT_100: '高于原价' }
const reasonLabels = { CONTENT: '报告内容', DATA: '数据问题', DATA_QUALITY: '数据质量',
  FORMAT: '格式规范', EVIDENCE: '证据材料', DOCUMENT: '文档材料', COMPLIANCE: '合规问题', OTHER: '其他原因' }
const costRows = computed(() => (props.summary?.cost_dimensions || [])
  .filter(row => row.dimension === costDimension.value))
const resources = computed(() => [{ label: '人员', value: props.summary?.person },
  { label: '设备', value: props.summary?.equipment }])
</script>

<template>
  <article class="da-native-panel metric-facts-display">
    <header><b>{{ title }}</b><span>{{ summary?.period || '当前合同' }} · 已登记事实</span></header>
    <p v-if="!summary?.available" class="da-native-note" role="status">
      {{ summary?.stale_reason || '尚无完整发布的指标来源，请完成业务记录并等待同步。' }}
    </p>
    <template v-else>
      <dl class="metric-facts-times" aria-label="来源时间（北京时间）">
        <div v-for="item in [
          { label: '新事实采集起点', value: summary.collection_started_at },
          { label: '来源最后更新', value: summary.source_updated_at },
          { label: '快照读取时间', value: summary.snapshot_at },
        ]" :key="item.label">
          <dt>{{ item.label }}（北京时间）</dt>
          <dd>{{ formatBusinessDateTime(item.value, { seconds: true }) || '未知（未提供）' }}</dd>
        </div>
      </dl>
      <p v-if="summary.stale" class="da-native-note" role="status">数据可能陈旧：{{ summary.stale_reason }}</p>
      <template v-if="section === 'contract'">
        <p class="da-native-note">完整可比基准 {{ summary.discount_known }} 份；基准未知 {{ summary.discount_unknown }} 份。未知合同不计入折扣分桶。</p>
        <p v-if="summary.unknown" class="da-native-note">生效月份未知 {{ summary.unknown }} 份，不归入所选月份；全部合同视图仍保留这些合同。</p>
        <div class="da-native-bars">
          <div v-for="(label, key) in bucketLabels" :key="key" class="da-native-bar-row">
            <span>{{ label }}</span><small>{{ summary.discount_buckets?.[key] || 0 }} 份</small>
          </div>
        </div>
        <p class="da-native-note">折扣率为成交金额 ÷ 冻结标准金额，80% 为八折；让利率为 100% − 折扣率。不同币种金额分别比价。</p>
      </template>
      <template v-else-if="section === 'report'">
        <div class="metric-facts-cards">
          <div class="da-native-metric"><span>本期首次通过率</span><strong>{{ formatFactRate(summary.first_pass_rate) }}</strong></div>
          <div class="da-native-metric"><span>首轮终决 / 首次通过</span><strong>{{ summary.first_reviewed }} / {{ summary.first_passed }}</strong></div>
          <div class="da-native-metric"><span>当前待审 / 历史首次未知</span><strong>{{ summary.pending }} / {{ summary.unknown }}</strong></div>
          <div class="da-native-metric"><span>退回决定 / 去重报告</span><strong>{{ summary.returned_decisions }} / {{ summary.returned_reports }}</strong></div>
        </div>
        <div class="da-native-bars">
          <div v-for="(count, code) in summary.return_reason_counts" :key="code" class="da-native-bar-row">
            <span>{{ reasonLabels[code] || code }}</span><small>{{ count }} 次</small>
          </div>
        </div>
        <p class="da-native-note">按首次决定的北京业务月份统计。待审与无法证明历史首次的报告不计失败；更正版本不重新获得逻辑报告首次样本。</p>
      </template>
      <template v-else-if="section === 'project'">
        <div class="metric-facts-cards">
          <div v-for="resource in resources" :key="resource.label" class="da-native-metric">
            <span>{{ resource.label }}实际利用率</span><strong>{{ formatFactRate(resource.value?.rate) }}</strong>
            <p class="da-native-note">已确认 {{ resource.value?.actual_minutes }} 分钟 / 明确容量 {{ resource.value?.capacity_minutes }} 分钟</p>
            <p class="da-native-note">待确认 {{ resource.value?.pending }}；容量或采集未知 {{ resource.value?.unknown }}</p>
          </div>
        </div>
        <p class="da-native-note">仅统计项目实施已确认时段。未配置容量不默认八小时；无分母显示“—”。预约与签到不作为实际用量，售前工时单独管理。</p>
      </template>
      <template v-else-if="section === 'finance'">
        <p class="da-native-note">已登记待审 {{ summary.pending }} 笔；待处理确认差异 {{ summary.conflicts }} 笔。以下确认额为不含税净额，冲回在其确认月份计负。</p>
        <p v-if="summary.unknown" class="da-native-note" role="status">历史付款缺少完整审批依据 {{ summary.unknown }} 笔，未归入报销、预付或确认成本；需补齐证据后处理。</p>
        <div class="metric-facts-cards">
          <div v-for="currency in summary.currencies" :key="currency.currency" class="da-native-metric">
            <span>{{ currency.currency }} 已确认收入</span><strong>{{ formatFactMoney(currency.income_minor) }}</strong>
            <p>已确认成本 {{ formatFactMoney(currency.cost_minor) }} {{ currency.currency }}</p>
            <p class="da-native-note">收入税额 {{ formatFactMoney(currency.income_tax_minor) }}；成本税额 {{ formatFactMoney(currency.cost_tax_minor) }}</p>
            <p class="da-native-note">报销净支出 {{ formatFactMoney(currency.spend_minor) }}；预付净支出 {{ formatFactMoney(currency.prepayment_minor) }}</p>
          </div>
        </div>
        <p v-if="!summary.currencies?.length" class="da-native-note">当前范围尚无本期已登记确认金额或已同步报销支出；不代表外部账务为零。</p>
        <label class="metric-facts-select">成本归属
          <select v-model="costDimension"><option value="organization">承担部门</option><option value="identity">归属人员</option><option value="project">项目</option></select>
        </label>
        <div v-if="costRows.length" class="metric-facts-table">
          <table class="da-table"><thead><tr><th scope="col">归属</th><th scope="col">币种</th><th scope="col">净确认成本</th></tr></thead>
            <tbody><tr v-for="row in costRows" :key="`${row.dimension}/${row.id}/${row.currency}`">
              <td>{{ row.name || (row.id ? '已确认归属（名称未提供）' : '未分配') }}</td>
              <td>{{ row.currency }}</td><td>{{ formatFactMoney(row.amount_minor) }}</td>
            </tr></tbody>
          </table>
        </div>
        <p class="da-native-note">报销支出、预付与成本确认分别列示，不重复累加；个人归属成本不等同工资。原有应收回款来源保持独立。</p>
      </template>
      <p class="da-native-note">{{ summary.basis }}</p>
    </template>
  </article>
</template>

<style scoped>
.metric-facts-display { margin-top: 18px; }
.metric-facts-times { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 220px), 1fr)); gap: 12px; margin-block: 14px; }
.metric-facts-times dt { color: var(--da-muted); font-size: 13px; }
.metric-facts-times dd { margin: 4px 0 0; overflow-wrap: anywhere; }
.metric-facts-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 220px), 1fr)); gap: 12px; margin-block: 14px; }
.metric-facts-cards p { margin-block: 8px; }
.metric-facts-table { overflow-x: auto; }
.metric-facts-select { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin-block: 12px; }
.metric-facts-select select { padding: 8px; border: 1px solid var(--da-line); border-radius: 6px; background: var(--surface-card); color: var(--da-ink); }
</style>
