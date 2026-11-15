<script setup>
import { formatMinor } from '../api/client.js'
import { parseIssueLabel } from '../statusLabels.js'

defineProps({
  candidates: { type: Array, default: () => [] },
  canReview: { type: Boolean, default: false },
  disabled: { type: Boolean, default: false },
  groupLabels: { type: Object, default: () => ({}) },
})
const emit = defineEmits(['review'])

// 用途：以项目名称概括一张票据，多项目仍保留为同一张票。
// 参数：candidate 为当前原件的单个解析候选。
// 返回值：首个项目名称及项目数；没有名称时明确提示待核对。
function candidateTitle(candidate) {
  const names = (candidate.detail_lines || []).map(line => line.name?.trim()).filter(Boolean)
  if (!names.length) return '项目名称待核对'
  return names.length > 1 ? `${names[0]} 等 ${names.length} 项` : names[0]
}

// 用途：精确显示整数分金额，区分零值、红字金额和缺失字段。
// 参数：value 为服务端候选中的有符号整数分字符串。
// 返回值：带元单位的金额；缺失或非法值显示人工填写提示。
function money(value) {
  return typeof value === 'string' && /^-?\d+$/.test(value)
    ? `${formatMinor(value)} 元` : '缺失，需人工填写'
}
</script>

<template>
  <div v-if="candidates.length" class="expense-invoice-cards" aria-label="发票识别卡片">
    <article v-for="(candidate, index) in candidates" :key="index" class="expense-invoice-card">
      <header class="expense-invoice-card-head">
        <h3>{{ candidateTitle(candidate) }}</h3>
        <span class="expense-invoice-review-state">待人工复核</span>
      </header>
      <div class="expense-invoice-tags" aria-label="发票摘要">
        <span class="expense-invoice-tag">
          <span>发票号</span><strong>{{ candidate.invoice_number || '待核对' }}</strong>
        </span>
        <span class="expense-invoice-tag">
          <span>开票日期</span><strong>{{ candidate.invoice_date || '待核对' }}</strong>
        </span>
        <span class="expense-invoice-tag">
          <span>类型</span><strong>{{ candidate.invoice_type || '待核对' }}</strong>
        </span>
        <span class="expense-invoice-tag expense-invoice-tag-total">
          <span>总计金额</span><strong>{{ money(candidate.gross_minor) }}</strong>
        </span>
      </div>
      <details class="expense-invoice-details">
        <summary>查看完整票面信息</summary>
        <dl class="expense-invoice-facts">
          <div><dt>销售方名称</dt><dd>{{ candidate.seller_name || '待核对' }}</dd></div>
          <div><dt>销售方税号</dt><dd>{{ candidate.seller_tax_id || '待核对' }}</dd></div>
          <div><dt>开票人</dt><dd>{{ candidate.issuer || '待核对' }}</dd></div>
          <div><dt>合计（不含税）</dt><dd>{{ money(candidate.amount_minor) }}</dd></div>
          <div><dt>税额合计</dt><dd>{{ money(candidate.tax_minor) }}</dd></div>
          <div><dt>价税合计</dt><dd>{{ money(candidate.gross_minor) }}</dd></div>
        </dl>
        <div v-if="candidate.detail_lines?.length" class="expense-invoice-lines" tabindex="0"
          role="region" aria-label="票面项目明细，可横向滚动">
          <table class="expense-table-body">
            <thead>
              <tr>
                <th scope="col">项目名称</th><th scope="col">规格型号</th>
                <th scope="col">单位</th><th scope="col">数量</th><th scope="col">单价</th>
                <th scope="col">金额</th><th scope="col">税率 / 征收率</th><th scope="col">税额</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(line, lineIndex) in candidate.detail_lines" :key="lineIndex">
                <td>
                  {{ line.name || '待核对' }}
                  <small v-for="issue in line.issues || []" :key="issue">
                    {{ parseIssueLabel(issue) }}
                  </small>
                </td>
                <td>{{ line.model || '—' }}</td><td>{{ line.unit || '待核对' }}</td>
                <td>{{ line.quantity || '待核对' }}</td><td>{{ line.unit_price || '待核对' }}</td>
                <td>{{ money(line.amount_minor) }}</td><td>{{ line.tax_rate || '待核对' }}</td>
                <td>{{ money(line.tax_minor) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p v-else class="expense-invoice-hint">暂无可用项目明细，请对照原件核对。</p>
      </details>
      <p class="expense-invoice-hint">
        {{ groupLabels[candidate.group_kind] || '分组未确认，需人工判断' }}
      </p>
      <ul v-if="candidate.issues?.length" class="expense-invoice-issues">
        <li v-for="issue in candidate.issues" :key="issue">{{ parseIssueLabel(issue) }}</li>
      </ul>
      <button v-if="canReview" type="button" class="expense-button" :disabled="disabled"
        @click="emit('review', candidate)">辅助填写人工复核</button>
    </article>
  </div>
  <p v-else class="expense-invoice-hint">
    暂无可用识别候选，可从当前已就绪原件人工录入；不能把缺金额当成零元票据。
  </p>
</template>

<style scoped>
.expense-invoice-cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 440px), 1fr));
  gap: 16px;
  margin: 20px 0;
}
.expense-invoice-card {
  min-width: 0;
  padding: 20px;
  border: 1px solid var(--exp-line);
  border-radius: var(--exp-radius);
  background: var(--exp-card);
}
.expense-invoice-card-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 16px;
}
.expense-invoice-card-head h3 {
  min-width: 0;
  margin: 0;
  color: var(--exp-ink);
  font-size: 17px;
  line-height: 1.6;
  overflow-wrap: anywhere;
}
.expense-invoice-review-state {
  flex-shrink: 0;
  padding: 3px 9px;
  border-radius: 999px;
  background: var(--exp-warning-soft);
  color: var(--exp-warning);
  font-size: 12px;
}
.expense-invoice-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}
.expense-invoice-tag {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 4px 8px;
  max-width: 100%;
  padding: 7px 12px;
  border: 1px solid var(--exp-line);
  border-radius: 999px;
  background: var(--exp-inset);
  color: var(--exp-ink-soft);
  font-size: 13px;
  line-height: 1.5;
}
.expense-invoice-tag strong {
  min-width: 0;
  color: var(--exp-ink);
  font-weight: 500;
  overflow-wrap: anywhere;
}
.expense-invoice-tag-total {
  border-color: var(--exp-accent-border);
  background: var(--exp-accent-soft);
}
.expense-invoice-tag-total strong { color: var(--exp-accent); font-weight: 700; }
.expense-invoice-details { margin-top: 18px; }
.expense-invoice-details summary { color: var(--exp-accent); cursor: pointer; }
.expense-invoice-facts {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 220px), 1fr));
  gap: 14px 20px;
  margin: 18px 0;
}
.expense-invoice-facts div { min-width: 0; }
.expense-invoice-facts dt { color: var(--exp-muted); font-size: 12px; }
.expense-invoice-facts dd {
  margin: 5px 0 0;
  color: var(--exp-ink);
  overflow-wrap: anywhere;
}
.expense-invoice-lines { max-width: 100%; overflow-x: auto; }
.expense-invoice-lines table { width: 100%; min-width: 780px; border-collapse: collapse; }
.expense-invoice-lines th, .expense-invoice-lines td {
  padding: 10px 12px;
  border-bottom: 1px solid var(--exp-line);
  text-align: left;
  font-size: 13px;
}
.expense-invoice-lines th { background: var(--exp-inset); color: var(--exp-ink-soft); }
.expense-invoice-lines td { color: var(--exp-ink); }
.expense-invoice-lines small { display: block; color: var(--exp-warning); }
.expense-invoice-hint, .expense-invoice-issues {
  color: var(--exp-muted);
  font-size: 13px;
  line-height: 1.7;
}
.expense-invoice-hint { margin: 16px 0 8px; }
.expense-invoice-issues { margin: 0 0 16px; padding-left: 20px; }
@media (max-width: 480px) {
  .expense-invoice-card { padding: 16px; }
  .expense-invoice-card-head { flex-wrap: wrap; }
}
</style>
