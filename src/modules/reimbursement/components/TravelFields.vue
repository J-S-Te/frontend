<script setup>
const props=defineProps({ value:{type:Object,default:null},invoice:{type:Boolean,default:false},disabled:{type:Boolean,default:false} })
const emit=defineEmits(['update:value'])

// 用途：仅更新人工填报字段，不回传服务端比对结论或资格。
// 参数：key为当前字段名，value为用户输入原文。
// 返回值：无；通过受控事件更新父表单。
function change(key,value) {emit('update:value',{...(props.value||{}),[key]:value})}
</script>
<template>
 <fieldset :disabled="disabled">
  <legend>{{ invoice ? '票面行程事实（人工对照原件）' : '本人差旅行程填报' }}</legend>
  <p>城市使用明确六位代码；不从地点自由文本推断资格。填写后由服务器与权威项目及票面逐项交叉核验。</p>
  <div class="expense-grid">
   <label v-if="invoice">票面类别<select :value="value?.kind || ''" @change="change('kind',$event.target.value)">
    <option value="">不录入票面行程</option><option value="AIR">机票</option><option value="RAIL">火车票</option><option value="HOTEL">酒店</option></select></label>
   <label>出发城市代码<input :value="value?.origin_city_code || ''" maxlength="6" placeholder="酒店可空" @input="change('origin_city_code',$event.target.value)"></label>
   <label>目的城市代码<input :value="value?.destination_city_code || ''" maxlength="6" @input="change('destination_city_code',$event.target.value)"></label>
   <label>{{ invoice ? '票面开始日' : '出发日' }}<input type="date" :value="value?.[invoice?'start_date':'departure_date'] || ''" @input="change(invoice?'start_date':'departure_date',$event.target.value)"></label>
   <label>{{ invoice ? '票面结束日（酒店为离店日）' : '返回日' }}<input type="date" :value="value?.[invoice?'end_date':'return_date'] || ''" @input="change(invoice?'end_date':'return_date',$event.target.value)"></label>
  </div>
 </fieldset>
</template>
