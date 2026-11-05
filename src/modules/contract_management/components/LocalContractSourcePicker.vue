<script setup>
import { computed, ref, watch } from 'vue'
import { listLocalContractCounterparties, listLocalContractCategories } from '../api/contract.js'
import { formatUserError } from '../../shared/utils/userError.js'

const props = defineProps({ modelValue: { type: Object, required: true }, capabilities: { type: Object, default: () => ({}) }, disabled: { type: Boolean, default: false } })
const emit = defineEmits(['update:modelValue'])
const counterparties = ref([])
const categories = ref([])
const loading = ref(false)
const error = ref('')
const keyword = ref('')
let requestVersion = 0
const localCounterparty = computed(() => props.capabilities.counterparty_source === 'local')
const localCategory = computed(() => props.capabilities.category_source === 'local')
const blocked = computed(() => props.disabled || loading.value || !!error.value)
const enabledCounterparties = computed(() => counterparties.value.filter(item => item.enabled))
const enabledCategories = computed(() => categories.value.filter(item => item.enabled))

// 用途：仅加载服务端明确选择的本地目录，不连接CRM或猜测外部类别来源。
// 参数：无；来源取自受认证能力响应。
// 返回值：无；依赖失败保留错误并阻止选择，迟到响应不得恢复旧目录。
async function load() {
  const version = ++requestVersion
  error.value = ''
  if (!localCounterparty.value && !localCategory.value) return
  loading.value = true
  try {
    const [parties, catalog] = await Promise.all([
      localCounterparty.value ? listLocalContractCounterparties({ keyword: keyword.value }) : Promise.resolve([]),
      localCategory.value ? listLocalContractCategories({ keyword: keyword.value }) : Promise.resolve([]),
    ])
    if (version !== requestVersion) return
    counterparties.value = parties
    categories.value = catalog
  } catch (cause) {
    if (version === requestVersion) error.value = formatUserError(cause, { fallback: '本地目录暂不可用，请刷新后重新选择。' })
  } finally {
    if (version === requestVersion) loading.value = false
  }
}

// 用途：以本地目录稳定引用替换表单的交易对方，清除CRM及商机身份。
// 参数：id为用户在当前可见启用目录中选择的ID。
// 返回值：无；通过update:modelValue返回完整新表单，不改业务服务项身份。
function selectCounterparty(id) {
  if (blocked.value || !localCounterparty.value) return
  const value = enabledCounterparties.value.find(item => item.id === id)
  emit('update:modelValue', { ...props.modelValue, counterparty_source: 'LOCAL', local_counterparty_id: value?.id || '', counterparty_version: value?.version || 0, customer_name: value?.name || '', customer_id: '', crm_customer_id: 0, opportunity_id: '', opportunity_name: '' })
}

// 用途：为指定服务项选择独立类别引用，不占用该服务项的SourceID。
// 参数：index为当前服务项位置，id为可见启用类别ID。
// 返回值：无；通过update:modelValue回传保留其余字段的完整表单。
function selectCategory(index, id) {
  if (blocked.value || !localCategory.value || !Array.isArray(props.modelValue.service_items)) return
  const value = enabledCategories.value.find(item => item.id === id)
  const items = props.modelValue.service_items.map((item, position) => position === index ? { ...item, category_id: value?.id || '', category_version: value?.version || 0, category: value?.name || '' } : item)
  emit('update:modelValue', { ...props.modelValue, category_source: 'LOCAL', service_items: items })
}

watch(() => [props.capabilities.counterparty_source, props.capabilities.category_source], load, { immediate: true })
</script>

<template>
  <section v-if="localCounterparty || localCategory" class="local-source-picker" aria-label="合同本地来源选择">
    <label>检索目录<input v-model="keyword" maxlength="100" :disabled="disabled || loading" @keydown.enter.prevent="load" /><button type="button" :disabled="disabled || loading" @click="load">检索 / 刷新目录</button></label>
    <p>当前使用合同自有目录。交易对方和服务类别将按已选版本由服务端复核。</p>
    <p v-if="error" role="alert">{{ error }} <button type="button" :disabled="loading || disabled" @click="load">刷新目录</button></p>
    <p v-if="loading" role="status">正在读取本地目录…</p>
    <label v-if="localCounterparty">本地交易对方
      <select :value="modelValue.local_counterparty_id || ''" :disabled="blocked" required @change="selectCounterparty($event.target.value)">
        <option value="">请选择已启用的本地交易对方</option><option v-for="item in enabledCounterparties" :key="item.id" :value="item.id">{{ item.name }}</option>
      </select>
    </label>
    <p v-if="localCounterparty && !loading && !error && !enabledCounterparties.length">当前数据范围内暂无启用的本地交易对方，请由有权管理员维护目录。</p>
    <template v-if="localCategory">
      <label v-for="(item, index) in modelValue.service_items || []" :key="item.source_id || index">服务项 {{ index + 1 }} 的本地类别
        <select :value="item.category_id || ''" :disabled="blocked" required @change="selectCategory(index, $event.target.value)"><option value="">请选择已启用的本地类别</option><option v-for="category in enabledCategories" :key="category.id" :value="category.id">{{ category.name }} · {{ category.code }}</option></select>
      </label>
      <p v-if="!loading && !error && !enabledCategories.length">当前数据范围内暂无启用的本地类别，请先维护目录。</p>
    </template>
  </section>
</template>

<style scoped>
/* 深色主题：来源选择框走 token，浅色回退到原字面量。 */
.local-source-picker { padding: 14px; margin: 12px 0; border: 1px solid var(--border-soft, #d5dfeb); border-radius: 8px; background: var(--surface-tint, #f8fbff); }
.local-source-picker label { display: flex; flex-direction: column; gap: 6px; margin: 10px 0; }
.local-source-picker select { min-height: 36px; max-width: 100%; padding: 6px 8px; }
.local-source-picker p { line-height: 1.6; }
</style>
