<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { getContractImportHistory } from '../api/dataAnalysis.js'
import { historyAmount, historyAvailability } from '../utils/importHistory.js'

const result = ref(null), busy = ref(false), error = ref('')
let generation = 0
const availability = computed(() => historyAvailability(result.value))

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
onMounted(refresh)
onBeforeUnmount(() => { generation++ })
</script>

<template>
  <section class="da-native-panel import-history" aria-label="历史导入独立统计">
    <header><b>历史导入独立统计</b><button class="da-button" type="button" :disabled="busy" @click="refresh">{{ busy ? '读取中…' : '刷新历史统计' }}</button></header>
    <p>按原业务月份、币种和模式单列，未归期不使用导入时间代替；不并入普通合同签约、商机转化或经营趋势。</p>
    <p role="status">{{ error ? '本次读取失败，下面如有数据为上次结果，须重新核对。' : availability }}</p>
    <p v-if="error" role="alert">{{ error }}</p>
    <template v-if="result">
      <p>同步状态：{{ result.sync_status || 'UNKNOWN' }}；最近成功同步：{{ result.synced_at || '尚无成功记录' }}；未归期：{{ result.sync_status === 'UNKNOWN' ? '未知' : result.unassigned_count }}。</p>
      <p>来源快照 {{ result.source_snapshot_id || '未知' }}；聚合运行 {{ result.aggregation_run_id || '未知' }}<span v-if="result.error_code">；错误 {{ result.error_code }}</span></p>
      <div class="import-history-scroll"><table class="da-table"><thead><tr><th>原月份</th><th>币种</th><th>模式／口径／状态</th><th>数量</th><th>原金额</th><th>实际源事实接入</th></tr></thead><tbody>
        <tr v-for="row in result.periods || []" :key="[row.period,row.currency,row.import_mode,row.report_mode,row.status].join('/')">
          <td>{{ row.period === 'UNASSIGNED' ? '未归期' : row.period }}</td><td>{{ row.currency }}</td><td>{{ row.import_mode }}／{{ row.report_mode }}／{{ row.status }}</td><td>{{ row.contract_count }}</td><td>{{ historyAmount(row.amount_minor) }}</td><td>{{ row.source_facts_count }}／{{ row.contract_count }}（其余仅API摘要）</td>
        </tr>
      </tbody></table></div>
      <p v-if="!result.periods?.length">{{ result.sync_status === 'SUCCESS' && !result.stale ? '本次成功发布范围内无历史合同。' : '尚无可用历史分栏，不能据此判断为零。' }}</p>
      <p>{{ result.basis }}</p>
      <p>API摘要已接入不代表源库事实已接入，也不代表原件签名已核验。缺少源库配置或版本覆盖时应保留等待／阻塞状态。</p>
    </template>
  </section>
</template>

<style scoped>
.import-history { margin-block: 20px; overflow-wrap: anywhere; }
.import-history-scroll { overflow-x: auto; }
.import-history p { margin-block: 10px; }
</style>
