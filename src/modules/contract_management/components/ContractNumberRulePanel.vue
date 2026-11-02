<script setup>
// 系统级合同编号规则设置面板：读取并保存全系统共用的编号规则，同时给出下一号预览。
// 正式编号只由后端在审批通过时生成，这里的预览仅用于确认规则效果。
import { computed, onMounted, ref } from 'vue'
import { formatUserError } from '../../shared/utils/userError.js'
import { formatBusinessDateTime, todayBusinessDate } from '../../shared/utils/businessTime.js'
import { getContractNumberRule, updateContractNumberRule } from '../api/contract'
import {
  CONTRACT_NUMBER_AFFIX_HINT,
  CONTRACT_NUMBER_YEAR_SEGMENTS,
  buildContractNumberPreview,
  contractNumberRuleAffixErrors,
  contractNumberRuleFormError,
  contractNumberRulePayload,
  contractNumberRuleUsageLabel,
  nextContractNumberSequence,
  normalizeContractNumberRule,
} from '../utils/contractNumberRule'

const props = defineProps({
  canManage: { type: Boolean, default: false },
})
const emit = defineEmits(['notify'])

const yearSegmentOptions = CONTRACT_NUMBER_YEAR_SEGMENTS
// 年份段预览按北京年份取值：浏览器不在东八区时，跨年窗口会算错一年；正式编号仍由后端生成。
const currentYear = Number(todayBusinessDate().slice(0, 4)) || new Date().getFullYear()

const form = ref(normalizeContractNumberRule({}))
const rule = ref(null)
const loading = ref(false)
const loadError = ref('')
const saving = ref(false)
const saveError = ref('')
const saveNotice = ref('')
// 字段高亮只在尝试保存之后出现，避免一边输入一边闪红。
const submitAttempted = ref(false)
let loadTicket = 0

const dirty = computed(() => JSON.stringify(normalizeContractNumberRule(form.value))
  !== JSON.stringify(normalizeContractNumberRule(rule.value || {})))

const nextSequence = computed(() => nextContractNumberSequence(rule.value, currentYear))
const preview = computed(() => buildContractNumberPreview(form.value, { year: currentYear, sequence: nextSequence.value }))
const previewHint = computed(() => `按 ${currentYear} 年度已用流水推算的下一号，保存后对新合同生效。`)
const selectedYearSegmentHint = computed(() => yearSegmentOptions.find((item) => item.value === form.value.year_segment)?.hint || '')
const usageLabel = computed(() => contractNumberRuleUsageLabel(rule.value))
const effectiveSample = computed(() => {
  const sample = typeof rule.value?.sample === 'string' ? rule.value.sample.trim() : ''
  return sample && sample !== preview.value.number ? sample : ''
})
// 后端在规则未初始化、流水耗尽或规则非法时不返回 sample，只返回原因；
// 必须把原因显示出来，否则面板会静默地什么都不说明。
const sampleUnavailableReason = computed(() => {
  if (effectiveSample.value) return ''
  return typeof rule.value?.sample_unavailable_reason === 'string' ? rule.value.sample_unavailable_reason.trim() : ''
})
const updatedAt = computed(() => formatUpdatedAt(rule.value?.updated_at))
// 前后缀字符集是本地就能判定的硬性约束：命中后端白名单之外的字符直接不发送请求。
const affixErrors = computed(() => contractNumberRuleAffixErrors(form.value))
const affixInvalidFields = computed(() => (submitAttempted.value ? affixErrors.value.map((item) => item.field) : []))
const affixHint = CONTRACT_NUMBER_AFFIX_HINT

// 最近保存时间是后端记录的业务时刻，按北京业务时间展示。
function formatUpdatedAt(value) {
  if (!value) return ''
  return formatBusinessDateTime(value)
}

function applyRule(data) {
  rule.value = data && typeof data === 'object' ? data : null
  form.value = normalizeContractNumberRule(rule.value || {})
}

async function loadRule() {
  const ticket = ++loadTicket
  loading.value = true
  loadError.value = ''
  saveError.value = ''
  saveNotice.value = ''
  try {
    const data = await getContractNumberRule()
    if (ticket !== loadTicket) return
    applyRule(data)
  } catch (error) {
    if (ticket !== loadTicket) return
    loadError.value = formatUserError(error, { fallback: '读取合同编号规则失败，请稍后重试。' })
  } finally {
    if (ticket === loadTicket) loading.value = false
  }
}

function resetForm() {
  form.value = normalizeContractNumberRule(rule.value || {})
  saveError.value = ''
  saveNotice.value = ''
  submitAttempted.value = false
}

async function saveRule() {
  if (!props.canManage || saving.value) return
  saveError.value = ''
  saveNotice.value = ''
  submitAttempted.value = true
  // 本地校验不通过就停在这里：只显示本地中文提示并高亮字段，不发请求，
  // 也不会再叠加后端 422 的通用错误说明。
  const invalid = contractNumberRuleFormError(form.value)
  if (invalid) {
    saveError.value = invalid
    return
  }
  saving.value = true
  saveError.value = ''
  saveNotice.value = ''
  try {
    // 全量覆盖，只提交四个可编辑字段；示例、年度用量等由后端重新计算。
    const data = await updateContractNumberRule(contractNumberRulePayload(form.value))
    applyRule(data)
    submitAttempted.value = false
    saveNotice.value = '编号规则已保存。新合同将按新规则编号，历史合同编号保持不变。'
    emit('notify', '合同编号规则已保存')
  } catch (error) {
    // 校验失败（422）时保留表单内容，只提示后端给出的中文说明。
    saveError.value = formatUserError(error, { fallback: '保存合同编号规则失败，请稍后重试。', method: 'PUT' })
  } finally {
    saving.value = false
  }
}

onMounted(loadRule)
</script>

<template>
  <section class="contract-card contract-number-rule" aria-labelledby="contract-number-rule-title">
    <header>
      <div>
        <h3 id="contract-number-rule-title">合同编号规则</h3>
        <p>全系统共用一套编号规则，新合同在审批通过后按此规则自动编号；历史合同编号保持不变。</p>
      </div>
      <span class="contract-badge info"><i></i>系统级</span>
    </header>

    <p v-if="loading" class="contract-number-rule-state">正在读取编号规则…</p>

    <template v-else-if="loadError">
      <p class="contract-session-error contract-number-rule-error" role="alert">{{ loadError }}</p>
      <div class="contract-number-rule-actions contract-number-rule-retry">
        <button class="contract-button secondary small" type="button" @click="loadRule">重新读取</button>
      </div>
    </template>

    <div v-else class="contract-number-rule-body">
      <form class="contract-number-rule-form" @submit.prevent="saveRule">
        <label>
          <span>编号前缀</span>
          <input v-model="form.prefix" type="text" :readonly="!canManage" maxlength="32" autocomplete="off" placeholder="例如 GTSR-"
            :class="{ 'is-invalid': affixInvalidFields.includes('prefix') }"
            :aria-invalid="affixInvalidFields.includes('prefix')" />
          <small>前缀会出现在编号最前面，最多 32 个字符；{{ affixHint }}。</small>
        </label>
        <label>
          <span>年份段</span>
          <select v-model="form.year_segment" :disabled="!canManage">
            <option v-for="option in yearSegmentOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
          </select>
          <small>{{ selectedYearSegmentHint }}；流水每年从 1 重新开始。</small>
        </label>
        <label>
          <span>流水位数</span>
          <input v-model.number="form.seq_width" type="number" min="1" max="9" step="1" :readonly="!canManage" />
          <small>按年度递增，左补零到指定位数（1–9 位）。</small>
        </label>
        <label>
          <span>编号后缀（选填）</span>
          <input v-model="form.suffix" type="text" :readonly="!canManage" maxlength="32" autocomplete="off" placeholder="例如 -A"
            :class="{ 'is-invalid': affixInvalidFields.includes('suffix') }"
            :aria-invalid="affixInvalidFields.includes('suffix')" />
          <small>后缀紧跟在流水之后，最多 32 个字符；{{ affixHint }}。</small>
        </label>
        <p v-if="saveError" class="contract-session-error" role="alert">{{ saveError }}</p>
        <p v-else-if="saveNotice" class="contract-session-info" role="status">{{ saveNotice }}</p>
        <div class="contract-number-rule-actions">
          <template v-if="canManage">
            <button class="contract-button primary small" type="submit" :disabled="saving || !dirty">{{ saving ? '正在保存…' : '保存编号规则' }}</button>
            <button class="contract-button secondary small" type="button" :disabled="saving || !dirty" @click="resetForm">放弃修改</button>
            <small v-if="!dirty">已与当前生效规则一致</small>
          </template>
          <small v-else>当前账号只能查看编号规则，修改需要系统编号规则管理权限。</small>
        </div>
      </form>

      <aside class="contract-number-rule-preview">
        <span>预计下一号（预览，保存后生效）</span>
        <strong>{{ preview.number }}</strong>
        <small>{{ previewHint }}</small>
        <p v-if="preview.overflow" class="contract-number-rule-warning">本年度流水已超过 {{ preview.width }} 位，编号会继续变长；如需固定长度请调整流水位数。</p>
        <p v-else-if="preview.too_long" class="contract-number-rule-warning">编号超过 64 个字符，保存时会被后端拒绝，请缩短前缀或后缀。</p>
        <div class="contract-number-rule-usage">
          <strong>{{ usageLabel }}</strong>
          <span v-if="effectiveSample">当前生效的下一号：{{ effectiveSample }}</span>
          <span v-else-if="sampleUnavailableReason">{{ sampleUnavailableReason }}</span>
          <em>流水全系统共用，不按租户单独计数；修改规则后当年流水从 1 重新开始。</em>
          <em v-if="updatedAt">最近保存：{{ updatedAt }}</em>
        </div>
      </aside>
    </div>
  </section>
</template>
