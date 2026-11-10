<script setup>
const props = defineProps({ value: { type: Object, default: null }, disabled: Boolean })
const emit = defineEmits(['update:value'])

// 用途：按白名单逐项更新人工票面明细，不修改解析运行或确认状态。
// 参数：index为明细序号，key为编辑字段，value为当前输入。
// 返回值：无；通过受控事件更新父表单。
function change(index, key, value) {
  const lines = (props.value?.lines || []).map((row, position) => position === index ? { ...row, [key]: value } : row)
  emit('update:value', { lines })
}

// 用途：添加一条待人工核对的票面商品服务。
// 参数：无。
// 返回值：无；最多100条，通过事件更新父表单。
function add() {
  const lines = props.value?.lines || []
  if (lines.length < 100) emit('update:value', { lines: [...lines, { name: '', tax_classification_code: '', amount: '', tax: '' }] })
}

// 用途：移除当前表单明细，已确认票据仅在可重新确认或正式更正入口保存。
// 参数：index为需要移除的明细序号。
// 返回值：无。
function remove(index) { emit('update:value', { lines: (props.value?.lines || []).filter((_, position) => position !== index) }) }
</script>
<template>
  <fieldset :disabled="disabled" class="expense-item">
    <legend>商品服务明细（人工对照原件确认）</legend>
    <p>解析明细仅辅助填写；请逐项核对名称和税收分类编码。金额、税额可留空；不会自动确认、税务验真或抵扣。</p>
    <p v-if="!value?.lines?.length">未填写商品服务明细；费用建议将按已发布票种默认映射处理。</p>
    <div v-for="(line,index) in value?.lines || []" :key="index" class="expense-form-grid">
      <label>第{{ index+1 }}项名称<input :value="line.name" maxlength="256" @input="change(index,'name',$event.target.value)"></label>
      <label>税收分类编码<input :value="line.tax_classification_code" inputmode="numeric" maxlength="19" placeholder="无法核实时留空" @input="change(index,'tax_classification_code',$event.target.value)"></label>
      <label>不含税金额（元，可空）<input :value="line.amount" inputmode="decimal" @input="change(index,'amount',$event.target.value)"></label>
      <label>税额（元，可空）<input :value="line.tax" inputmode="decimal" @input="change(index,'tax',$event.target.value)"></label>
      <button type="button" class="expense-button" @click="remove(index)">移除此明细</button>
    </div>
    <button type="button" class="expense-button" :disabled="disabled || (value?.lines?.length || 0)>=100" @click="add">添加商品服务明细</button>
  </fieldset>
</template>
