<script setup>
import { computed, ref } from 'vue'
import { cityByCode, searchCities } from '../cities.js'

const props = defineProps({
  modelValue: { type: String, default: '' },
  label: { type: String, required: true },
  disabled: { type: Boolean, default: false },
  optional: { type: Boolean, default: false },
})
const emit = defineEmits(['update:modelValue'])
const search = ref('')
const currentCity = computed(() => cityByCode(props.modelValue))
const options = computed(() => searchCities(search.value))
const keepCurrentOption = computed(() => currentCity.value &&
  !options.value.some((city) => city.code === props.modelValue))

// 用途：只将用户选中的内置城市编码或明确清空事件交给父表单。
// 参数：event为原生下拉选择事件，值必须来自内置城市选项。
// 返回值：无；禁用态或未知值不发射，历史未知编码等待用户重新选择。
function chooseCity(event) {
  if (props.disabled) return
  const code = event.target.value
  if (code !== '' && !cityByCode(code)) return
  emit('update:modelValue', code)
}
</script>

<template>
  <div class="expense-city-select">
    <label>{{ label }}搜索
      <input type="search" :value="search" :disabled="disabled" maxlength="80"
        placeholder="输入城市名、拼音或首字母" autocomplete="off"
        @input="search = $event.target.value">
    </label>
    <label>{{ label }}{{ optional ? '（可不选择）' : '' }}
      <select :value="modelValue" :disabled="disabled" @change="chooseCity">
        <option value="">{{ optional ? '可不选择' : '请选择城市' }}</option>
        <option v-if="modelValue && !currentCity" :value="modelValue" disabled>
          历史编码 {{ modelValue }}（待重新选择）
        </option>
        <option v-if="keepCurrentOption" :value="modelValue">
          已选：{{ currentCity.label }}
        </option>
        <option v-for="city in options" :key="city.code" :value="city.code">
          {{ city.label }}
        </option>
      </select>
    </label>
    <p v-if="modelValue && !currentCity" role="status" class="expense-city-hint">
      原城市编码 {{ modelValue }} 不在当前目录中，请重新选择；选择前保留原值。
    </p>
    <p v-else-if="!options.length" role="status" class="expense-city-hint">
      未找到匹配城市，请调整搜索词。
    </p>
  </div>
</template>

<style scoped>
.expense-city-select { min-width: 0; }
.expense-city-hint {
  margin: 4px 0;
  color: var(--text-secondary);
  font-size: 13px;
  overflow-wrap: anywhere;
}
</style>
