<script setup>
import { classificationLabel } from '../invoiceClassification.js'
defineProps({ rows: { type: Array, default: () => [] }, saved: Boolean })
</script>
<template>
 <article v-if="rows.length" class="expense-item">
  <h3>{{ saved ? '服务器保存的归类依据（只读）' : '票据费用建议与命中依据' }}</h3>
  <p>{{ saved ? '保存草稿时由服务器重建；再次保存会按当前确认票面和发布规则重新生成。' : '需要人工归类的票据不会自动创建费用；可核对明细、调整发布规则，或新建草稿人工选择费用类别。' }}</p>
  <details v-for="row in rows" :key="row.invoice_id" open>
   <summary>票据 {{ row.invoice_id }} · {{ classificationLabel(row.status || row.classification_status) }} · {{ classificationLabel(row.source || row.classification_source) }}</summary>
   <p>票据版本 {{ row.invoice_version }} · 政策 {{ row.rule_id }} v{{ row.rule_version }} · 建议费用 {{ row.suggested_fee_type || row.fee_type || '待人工选择' }}<template v-if="saved"> · 当前保存费用 {{ row.selected_fee_type }} · {{ row.manual_override ? '已记录人工选择' : '与建议一致' }}</template></p>
   <ul v-if="(row.reasons || row.classification_reasons)?.length"><li v-for="reason in row.reasons || row.classification_reasons" :key="reason">{{ classificationLabel(reason) }}</li></ul>
   <ul><li v-for="(match,index) in row.matches || row.classification_matches || []" :key="index">第{{ match.line_index+1 }}项 {{ match.line_name }}<template v-if="match.tax_classification_code"> · 税码 {{ match.tax_classification_code }}</template> · {{ classificationLabel(match.matched_by) }}“{{ match.matched_value }}” · 规则 {{ match.mapping_id }} → {{ match.fee_type }}</li></ul>
  </details>
 </article>
</template>
