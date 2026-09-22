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
function formatUpdatedAt(value) {
  if (!value) return '尚无更新记录'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '更新时间未知' : date.toLocaleString('zh-CN', { hour12: false })
}
onMounted(load)
</script>

<template>
  <section class="crm-panel crm-credit-rule-settings" aria-labelledby="credit-rule-settings-title">
    <header class="crm-credit-rule-header">
      <div>
        <p>客户信用自动化</p>
        <h2 id="credit-rule-settings-title">信用等级规则</h2>
        <span>依据后续回款表现自动调整客户信用等级，所有变更均保留业务记录。</span>
      </div>
      <button type="button" class="console-button ghost" :disabled="loading" @click="load"><span aria-hidden="true">↻</span>{{ loading ? '加载中…' : '刷新配置' }}</button>
    </header>
    <div v-if="!loaded && loading" class="crm-credit-rule-loading" role="status"><span aria-hidden="true"></span><div><strong>正在读取信用规则</strong><small>请稍候，当前不会修改任何配置。</small></div></div>
    <form v-else class="crm-credit-apply-form crm-credit-rule-form" @submit.prevent="save">
      <section class="crm-credit-rule-overview" :class="{ disabled: !form.enabled }" aria-label="当前规则状态">
        <div class="crm-credit-rule-overview__icon" aria-hidden="true">{{ form.enabled ? '✓' : '—' }}</div>
        <div><span>当前状态</span><strong>{{ form.enabled ? '自动规则已启用' : '自动规则已停用' }}</strong><small>{{ form.enabled ? '后续回款事实将按下方参数自动评估。' : '系统不会根据回款事实自动调整等级。' }}</small></div>
        <div class="crm-credit-rule-overview__meta"><span>生效范围</span><strong>仅后续回款事实</strong><small>更新于 {{ formatUpdatedAt(form.updated_at) }}</small></div>
      </section>

      <section class="crm-credit-rule-parameters" aria-labelledby="credit-rule-parameters-title">
        <header><div><h3 id="credit-rule-parameters-title">评估参数</h3><p>配置逾期判定、升降级触发次数和单次调整幅度。</p></div><span>4 项参数</span></header>
        <div class="crm-credit-rule-grid">
          <label class="crm-credit-rule-field"><b>01</b><span><strong>宽限期</strong><small>回款超过宽限期后计为逾期。</small></span><div><input v-model.number="form.grace_days" type="number" min="0" max="90" required aria-label="宽限期天数"><em>天</em></div></label>
          <label class="crm-credit-rule-field"><b>02</b><span><strong>连续按时次数</strong><small>达到次数后自动提升信用等级。</small></span><div><input v-model.number="form.on_time_threshold" type="number" min="1" max="100" required aria-label="连续按时次数"><em>次</em></div></label>
          <label class="crm-credit-rule-field"><b>03</b><span><strong>连续逾期次数</strong><small>达到次数后自动降低信用等级。</small></span><div><input v-model.number="form.late_threshold" type="number" min="1" max="100" required aria-label="连续逾期次数"><em>次</em></div></label>
          <label class="crm-credit-rule-field"><b>04</b><span><strong>规则调整步长</strong><small>单次自动调整的等级幅度。</small></span><div><input v-model.number="form.level_step" type="number" min="1" max="3" required aria-label="规则调整步长"><em>级</em></div></label>
        </div>
      </section>

      <label class="crm-credit-rule-toggle" :class="{ enabled: form.enabled }"><input v-model="form.enabled" type="checkbox" role="switch" :aria-checked="form.enabled"><i aria-hidden="true"></i><span><strong>启用自动信用规则</strong><small>启用后，系统会按照以上参数处理后续回款事实；关闭不会修改已有信用等级。</small></span><em>{{ form.enabled ? '已启用' : '已停用' }}</em></label>
      <footer class="crm-credit-rule-footer"><div><strong>保存前请确认</strong><p>修改仅影响保存后进入的回款事实，不会追溯重算既有记录。</p></div><button type="submit" class="console-button primary" :disabled="saving || loading">{{ saving ? '保存中…' : '保存规则' }}</button></footer>
    </form>
  </section>
</template>
