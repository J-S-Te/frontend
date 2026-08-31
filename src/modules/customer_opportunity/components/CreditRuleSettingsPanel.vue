<script setup>
import { onMounted, reactive, ref } from 'vue'
import { getCustomerCreditRuleSettings, updateCustomerCreditRuleSettings } from '../api/credit.js'

const emit = defineEmits(['notice', 'error'])
const loading = ref(false)
const saving = ref(false)
const loaded = ref(false)
const form = reactive({ grace_days: 7, on_time_threshold: 2, late_threshold: 2, level_step: 1, enabled: true, updated_at: '' })

async function load() {
  loading.value = true
  try {
    const value = await getCustomerCreditRuleSettings()
    Object.assign(form, value || {})
    loaded.value = true
  } catch (error) { emit('error', error?.message || '信用规则暂时无法加载。') }
  finally { loading.value = false }
}
async function save() {
  if (saving.value) return
  saving.value = true
  try {
    const value = await updateCustomerCreditRuleSettings({
      grace_days: Number(form.grace_days), on_time_threshold: Number(form.on_time_threshold),
      late_threshold: Number(form.late_threshold), level_step: Number(form.level_step), enabled: Boolean(form.enabled),
      updated_at: form.updated_at || null,
    })
    Object.assign(form, value || {})
    emit('notice', '信用规则已保存；仅影响后续回款事件，不会重算历史记录。')
  } catch (error) { emit('error', error?.message || '信用规则保存失败。') }
  finally { saving.value = false }
}
onMounted(load)
</script>

<template>
  <section class="crm-panel" aria-labelledby="credit-rule-settings-title">
    <div class="crm-panel-heading"><div><h2 id="credit-rule-settings-title">信用等级规则</h2><p class="crm-note">规则在 CRM 单体内执行。修改后只作用于后续进入的回款事实，不会追溯重算既有记录。</p></div><button type="button" :disabled="loading" @click="load">{{ loading ? '加载中…' : '刷新' }}</button></div>
    <p v-if="!loaded && loading">正在加载规则配置…</p>
    <form v-else class="crm-credit-apply-form crm-credit-rule-form" @submit.prevent="save">
      <div class="crm-credit-rule-grid">
        <label><span>宽限期（天）</span><input v-model.number="form.grace_days" type="number" min="0" max="90" required><small>回款超过宽限期后计为逾期。</small></label>
        <label><span>连续按时次数</span><input v-model.number="form.on_time_threshold" type="number" min="1" max="100" required><small>达到次数后自动提升一级。</small></label>
        <label><span>连续逾期次数</span><input v-model.number="form.late_threshold" type="number" min="1" max="100" required><small>达到次数后自动降低一级。</small></label>
        <label><span>规则调整步长（级）</span><input v-model.number="form.level_step" type="number" min="1" max="3" required><small>单次自动调整的等级幅度。</small></label>
      </div>
      <label class="crm-credit-rule-toggle"><input v-model="form.enabled" type="checkbox"><span><strong>启用自动信用规则</strong><small>启用后，系统会根据后续回款事实自动计算等级。</small></span></label>
      <div class="crm-credit-rule-footer"><p class="crm-note">修改仅影响后续进入的回款事实，不会追溯重算既有记录。</p><button type="submit" class="primary" :disabled="saving">{{ saving ? '保存中…' : '保存规则' }}</button></div>
    </form>
  </section>
</template>
