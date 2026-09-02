<script setup>
import { computed, ref } from 'vue'
import ConsoleIcon from '@/modules/platform/shared/components/ConsoleIcon.vue'

const props = defineProps({
  contracts: { type: Array, default: () => [] },
  enterpriseScope: { type: Boolean, default: false },
  summary: { type: Object, default: null },
  detailLimited: { type: Boolean, default: false },
})
const emit = defineEmits(['open-contract'])

const statusFilter = ref('')
const typeFilter = ref('')

const totalAmount = computed(() => props.summary ? Number(props.summary.total_amount_minor || 0) / 100 : props.contracts.reduce((total, item) => total + Number(item.amount || 0), 0))
const totalCount = computed(() => props.summary ? Number(props.summary.total_contracts || 0) : props.contracts.length)
const averageAmount = computed(() => totalCount.value ? totalAmount.value / totalCount.value : 0)
const activeCount = computed(() => props.summary ? Number(props.summary.active_contracts || 0) : props.contracts.filter((item) => item.activeUnexpired || ['已生效', '履约中', '待付款', '已归档'].includes(item.status)).length)
const expiredCount = computed(() => props.summary ? Number(props.summary.expired_contracts || 0) : props.contracts.filter((item) => item.expired).length)

function groupCounts(field) {
  const counts = new Map()
  for (const item of props.contracts) {
    const value = item[field] || '未填写'
    counts.set(value, (counts.get(value) || 0) + 1)
  }
  return [...counts.entries()].map(([label, count]) => ({ label, count })).sort((left, right) => right.count - left.count || left.label.localeCompare(right.label, 'zh-CN'))
}

const statusRows = computed(() => groupCounts('status'))
const typeRows = computed(() => groupCounts('type'))
const filteredContracts = computed(() => props.contracts.filter((item) =>
  (!statusFilter.value || item.status === statusFilter.value) && (!typeFilter.value || item.type === typeFilter.value)))

function formatAmount(amount, currency = 'CNY') {
  try {
    return new Intl.NumberFormat('zh-CN', { style: 'currency', currency: currency || 'CNY', maximumFractionDigits: 2 }).format(Number(amount || 0))
  } catch {
    return `${Number(amount || 0).toFixed(2)} ${currency || ''}`.trim()
  }
}

function statusTone(status) {
  if (['已生效', '履约中', '已完成', '已归档'].includes(status)) return 'success'
  if (status === '审批中') return 'info'
  if (status === '待付款') return 'warning'
  if (status === '已终止') return 'danger'
  return 'neutral'
}
</script>

<template>
  <section class="contract-report-summary">
    <article>
      <p>{{ enterpriseScope ? '企业合同总额' : '合同总额' }}</p><strong>{{ formatAmount(totalAmount) }}</strong><span>{{
        enterpriseScope ? '当前企业范围' : '负责范围' }}</span>
    </article>
    <article>
      <p>合同数量</p><strong>{{ totalCount }} 份</strong><span>当前授权范围</span>
    </article>
    <article>
      <p>平均合同金额</p><strong>{{ formatAmount(averageAmount) }}</strong><span>按当前合同计算</span>
    </article>
    <article>
      <p>有效 / 超期</p><strong>{{ activeCount }} / {{ expiredCount }} 份</strong><span>按状态和到期日期统计</span>
    </article>
  </section>

  <section class="contract-report-breakdowns">
    <article class="contract-card">
      <header>
        <div>
          <h3>合同状态分布</h3>
          <p>各生命周期状态的合同数量</p>
        </div>
        <ConsoleIcon name="audit" />
      </header>
      <ul>
        <li v-for="row in statusRows" :key="row.label"><span>{{ row.label }}</span><strong>{{ row.count }}
            份</strong><i><b :style="{ width: `${contracts.length ? row.count / contracts.length * 100 : 0}%` }"></b></i>
        </li>
        <li v-if="!statusRows.length">暂无合同</li>
      </ul>
    </article>
    <article class="contract-card">
      <header>
        <div>
          <h3>合同类型分布</h3>
          <p>按合同类型汇总数量</p>
        </div>
        <ConsoleIcon name="save" />
      </header>
      <ul>
        <li v-for="row in typeRows" :key="row.label"><span>{{ row.label }}</span><strong>{{ row.count }} 份</strong><i><b
              :style="{ width: `${contracts.length ? row.count / contracts.length * 100 : 0}%` }"></b></i></li>
        <li v-if="!typeRows.length">暂无合同</li>
      </ul>
    </article>
  </section>

  <section class="contract-report-detail contract-table-card">
    <header>
      <div>
        <h3>合同详细信息</h3>
        <p>展示当前授权范围内的全部合同业务字段</p>
      </div>
      <div><select v-model="statusFilter" aria-label="按状态筛选">
          <option value="">全部状态</option>
          <option v-for="row in statusRows" :key="row.label" :value="row.label">{{ row.label }}</option>
        </select><select v-model="typeFilter" aria-label="按类型筛选">
          <option value="">全部类型</option>
          <option v-for="row in typeRows" :key="row.label" :value="row.label">{{ row.label }}</option>
        </select></div>
    </header>
    <p v-if="detailLimited" class="contract-info-banner">明细展示最近更新的 200 份合同，汇总数据为当前授权范围的精确结果。</p>
    <div class="contract-table-scroll">
      <table class="contract-data-table contract-report-detail-table">
        <thead>
          <tr>
            <th>合同编号</th>
            <th>合同名称</th>
            <th>合同类型</th>
            <th>服务类型</th>
            <th>客户信用等级</th>
            <th>金额 / 币种</th>
            <th>负责人</th>
            <th>开始日期</th>
            <th>到期日期</th>
            <th>创建日期</th>
            <th>更新日期</th>
            <th>状态</th>
            <th>合同内容</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="contract in filteredContracts" :key="contract.recordId">
            <td class="mono">{{ contract.id }}</td>
            <td><strong>{{ contract.name }}</strong></td>
            <td>{{ contract.type }}</td>
            <td>{{ contract.serviceType }}</td>
            <td>{{ contract.customerCreditLevel }}</td>
            <td class="amount">{{ formatAmount(contract.amount, contract.currency) }}</td>
            <td>{{ contract.owner }}</td>
            <td>{{ contract.startDate }}</td>
            <td>{{ contract.endDate }}</td>
            <td>{{ contract.createdAt }}</td>
            <td>{{ contract.updatedAt }}</td>
            <td><span class="contract-badge" :class="statusTone(contract.status)"><i></i>{{ contract.status }}</span>
            </td>
            <td><span class="contract-report-content">{{ contract.content || '未填写' }}</span></td>
            <td><button class="contract-text-button" type="button"
                @click="emit('open-contract', contract)">查看详情</button></td>
          </tr>
          <tr v-if="!filteredContracts.length">
            <td colspan="14" class="contract-empty">当前筛选条件下暂无合同</td>
          </tr>
        </tbody>
      </table>
    </div>
    <footer class="contract-table-footer"><span>共 {{ filteredContracts.length }} 份合同</span><span>仅展示业务信息</span></footer>
  </section>
</template>

<style scoped>
.contract-report-breakdowns {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
  margin-bottom: 15px
}

.contract-report-breakdowns article {
  overflow: hidden
}

.contract-report-breakdowns header,
.contract-report-detail>header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 15px 17px;
  border-bottom: 1px solid var(--cm-card-border)
}

.contract-report-breakdowns h3,
.contract-report-detail h3 {
  margin: 0;
  font-size: 12px
}

.contract-report-breakdowns header p,
.contract-report-detail header p {
  margin: 4px 0 0;
  color: var(--cm-muted);
  font-size: 9px
}

.contract-report-breakdowns header>svg {
  width: 20px;
  height: 20px;
  color: var(--cm-primary)
}

.contract-report-breakdowns ul {
  display: grid;
  gap: 10px;
  margin: 0;
  padding: 15px 17px;
  list-style: none
}

.contract-report-breakdowns li {
  display: grid;
  grid-template-columns: minmax(90px, 1fr) auto;
  align-items: center;
  gap: 6px 12px;
  color: var(--cm-secondary);
  font-size: 10px
}

.contract-report-breakdowns li strong {
  font-size: 10px
}

.contract-report-breakdowns li i {
  grid-column: 1/-1;
  height: 5px;
  overflow: hidden;
  border-radius: 4px;
  background: #e2e8f0
}

.contract-report-breakdowns li i b {
  display: block;
  height: 100%;
  border-radius: 4px;
  background: linear-gradient(90deg, #2563eb, #60a5fa)
}

.contract-report-detail>header>div:last-child {
  display: flex;
  gap: 8px
}

.contract-report-detail select {
  height: 32px;
  padding: 0 28px 0 9px;
  color: var(--cm-secondary);
  font-size: 10px;
  border: 1px solid var(--cm-border);
  border-radius: 6px;
  background: #fff
}

.contract-report-detail-table {
  min-width: 1700px
}

.contract-report-content {
  display: block;
  max-width: 260px;
  overflow: hidden;
  color: var(--cm-muted);
  text-overflow: ellipsis;
  white-space: nowrap
}

.contract-table-footer span:last-child {
  margin-left: auto
}

@media(max-width:720px) {
  .contract-report-breakdowns {
    grid-template-columns: 1fr
  }

  .contract-report-detail>header {
    align-items: flex-start;
    flex-direction: column
  }

  .contract-report-detail>header>div:last-child {
    width: 100%
  }

  .contract-report-detail select {
    min-width: 0;
    flex: 1
  }
}
</style>
