<script setup>
const props = defineProps({ value: { type: Array, default: () => [] } })
const emit = defineEmits(['update:value'])

// 用途：更新一条业务规则，不暴露原始JSON或服务器字段。
// 参数：index为规则序号，key为可编辑字段，value为输入值。
// 返回值：无；通过事件更新父表单。
function change(index, key, value) { emit('update:value', props.value.map((row, position) => position === index ? { ...row, [key]: value } : row)) }

// 用途：添加一条显式待配置的内容规则，默认不猜测费用类别。
// 参数：无。
// 返回值：无；最多100条规则。
function add() {
  if (props.value.length < 100) emit('update:value', [...props.value, { id: '', tax_code_prefixes: '', keywords: '', fee_type: '', default_claim_type: '', priority: 0 }])
}

// 用途：移除当前未发布表单中的一条归类规则。
// 参数：index为规则序号。
// 返回值：无。
function remove(index) { emit('update:value', props.value.filter((_, position) => position !== index)) }
</script>
<template>
 <fieldset class="expense-item">
  <legend>按票面内容归类规则</legend>
  <p>税码前缀或明细字面关键词任一命中即可；优先级越大越优先。同级多规则或混合类别需人工归类。只有发布后生效。</p>
  <p v-if="!value.length">未配置内容规则，沿用票种默认费用映射。</p>
  <div v-for="(row,index) in value" :key="index" class="expense-item">
   <h4>规则 {{ index+1 }}</h4>
   <div class="expense-form-grid">
    <label>唯一规则ID<input :value="row.id" maxlength="64" @input="change(index,'id',$event.target.value)"></label>
    <label>税码前缀（逗号分隔，最多20项）<input :value="row.tax_code_prefixes" @input="change(index,'tax_code_prefixes',$event.target.value)"></label>
    <label>明细字面关键词（每行一个，最多20项）<textarea :value="row.keywords" rows="3" @input="change(index,'keywords',$event.target.value)" /></label>
    <label>建议费用类型编码<input :value="row.fee_type" maxlength="64" @input="change(index,'fee_type',$event.target.value)"></label>
    <label>默认报销类型<select :value="row.default_claim_type" @change="change(index,'default_claim_type',$event.target.value)"><option value="">不指定</option><option value="TRAVEL">差旅</option><option value="DAILY">日常</option><option value="PROJECT_EXECUTION">项目执行</option></select></label>
    <label>优先级（0至10000）<input :value="row.priority" type="number" min="0" max="10000" @input="change(index,'priority',$event.target.value)"></label>
   </div>
   <button type="button" class="expense-button" @click="remove(index)">移除此规则</button>
  </div>
  <button type="button" class="expense-button" :disabled="value.length>=100" @click="add">添加内容归类规则</button>
 </fieldset>
</template>
