<script setup>
import { computed, onMounted, ref } from 'vue'
import { cityByCode, cityCatalogLoaded, ensureCityCatalog, searchCities } from '../cities.js'

const props = defineProps({
  modelValue: { type: String, default: '' },
  label: { type: String, required: true },
  disabled: { type: Boolean, default: false },
  optional: { type: Boolean, default: false },
})
const emit = defineEmits(['update:modelValue'])
const search = ref('')
// 城市目录（行政区划 + 拼音索引）体积较大，只在城市选择器真正出现时加载；
// 已加载过时首帧直接可用，不额外闪一下加载态。
const catalogReady = ref(cityCatalogLoaded())
const catalogError = ref('')
onMounted(async () => {
  if (catalogReady.value) return
  try {
    await ensureCityCatalog()
    catalogReady.value = true
  } catch {
    catalogError.value = '城市目录加载失败，请刷新页面后重试。'
  }
})
const currentCity = computed(() => (catalogReady.value ? cityByCode(props.modelValue) : undefined))
const options = computed(() => (catalogReady.value ? searchCities(search.value) : []))
const keepCurrentOption = computed(() => catalogReady.value && currentCity.value &&
  !options.value.some((city) => city.code === props.modelValue))

// 用途：只将用户选中的内置城市编码或明确清空事件交给父表单。
// 参数：event为原生下拉选择事件，值必须来自内置城市选项。
// 返回值：无；禁用态、目录未就绪或未知值不发射，历史未知编码等待用户重新选择。
function chooseCity(event) {
  if (props.disabled || !catalogReady.value) return
  const code = event.target.value
  if (code !== '' && !cityByCode(code)) return
  emit('update:modelValue', code)
}
</script>

<template>
  <div class="expense-city-select">
    <label>{{ label }}搜索
      <input type="search" :value="search" :disabled="disabled || !catalogReady" maxlength="80"
        placeholder="输入城市名、拼音或首字母" autocomplete="off"
        @input="search = $event.target.value">
    </label>
    <label>{{ label }}{{ optional ? '（可不选择）' : '' }}
      <select :value="modelValue" :disabled="disabled || !catalogReady" @change="chooseCity">
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
    <p v-if="!catalogReady" role="status" class="expense-city-hint">
      {{ catalogError || '城市目录加载中…' }}
    </p>
    <p v-else-if="modelValue && !currentCity" role="status" class="expense-city-hint">
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
