<script setup>
// 预警规则配置（P-10，alert.manage）：阈值参数暂存于看板配置库，
// 由后端整表替换并写入审计；开关状态先本地标记，保存时统一提交。
import { computed, onBeforeUnmount, onMounted, ref } from "vue"
import ConsoleIcon from "@/modules/platform/shared/components/ConsoleIcon.vue"
import { getAlertRules, putAlertRules } from "../api/dataAnalysis"

const props = defineProps({ permissions: { type: Array, default: () => [] } })

const rules = ref([])
const loading = ref(true)
const error = ref(null)
const saving = ref(false)
const toast = ref("")
const keyword = ref("")
let toastTimer = 0

const canManage = computed(() => props.permissions.includes("alert.manage"))
const dirtyCount = computed(() => rules.value.filter((rule) => rule.enabled !== rule.originalEnabled).length)

const filteredRules = computed(() => {
  const query = keyword.value.trim().toLowerCase()
  if (!query) return rules.value
  return rules.value.filter((rule) => [rule.rule_code, rule.name, rule.source_fct].join(" ").toLowerCase().includes(query))
})

const SEVERITY_LABELS = { HIGH: "高", MEDIUM: "中", LOW: "低" }

function showToast(message) {
  toast.value = message
  window.clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => { toast.value = "" }, 2600)
}

async function load() {
  loading.value = true
  error.value = null
  try {
    rules.value = (await getAlertRules()).map((rule) => ({ ...rule, originalEnabled: rule.enabled }))
  } catch (err) {
    error.value = err?.message || "预警规则加载失败"
  } finally {
    loading.value = false
  }
}

function toggleRule(rule) {
  if (!canManage.value) return
  rule.enabled = !rule.enabled
}

async function onSave() {
  if (saving.value) return
  saving.value = true
  try {
    const saved = await putAlertRules(rules.value.map(({ originalEnabled, ...rule }) => rule))
    rules.value = saved.map((rule) => ({ ...rule, originalEnabled: rule.enabled }))
    showToast("预警规则已保存")
  } catch (err) {
    showToast(err?.message || "保存失败")
  } finally {
    saving.value = false
  }
}

onMounted(load)
onBeforeUnmount(() => window.clearTimeout(toastTimer))
</script>

<template>
  <section>
    <div class="da-filters">
      <label><ConsoleIcon name="search" /><input v-model="keyword" placeholder="搜索规则编码 / 名称 / 数据源" /></label>
      <span>{{ filteredRules.length }} 条规则</span>
      <button class="da-button primary" :disabled="saving || !canManage" @click="onSave"><ConsoleIcon name="save" />{{ saving ? '保存中…' : '保存修改' }}</button>
    </div>

    <div v-if="loading" class="da-empty"><div class="da-spinner"></div><b>预警规则加载中…</b></div>
    <div v-else-if="error" class="da-empty"><ConsoleIcon name="info" /><b>{{ error }}</b><button class="da-button" @click="load">重新加载</button></div>
    <div v-else class="da-table-panel">
      <div class="da-table-scroll">
        <table class="da-table">
          <thead><tr><th>规则编码</th><th>规则名称</th><th>数据源</th><th>严重度</th><th>阈值参数</th><th>启用</th></tr></thead>
          <tbody>
            <tr v-for="rule in filteredRules" :key="rule.rule_code">
              <td class="mono"><b>{{ rule.rule_code }}</b></td>
              <td>{{ rule.name || '—' }}</td>
              <td>{{ rule.source_fct || '—' }}</td>
              <td><span class="da-badge" :class="String(rule.severity).toUpperCase() === 'HIGH' ? 'high' : String(rule.severity).toUpperCase() === 'MEDIUM' ? 'warning' : 'info'">{{ SEVERITY_LABELS[String(rule.severity).toUpperCase()] || rule.severity }}</span></td>
              <td class="mono"><small>{{ rule.threshold_json || '—' }}</small></td>
              <td><button class="da-switch" :class="{ on: rule.enabled }" :aria-label="`${rule.enabled ? '停用' : '启用'} ${rule.rule_code}`" @click="toggleRule(rule)"><i></i></button></td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-if="filteredRules.length === 0" class="da-empty"><ConsoleIcon name="info" /><b>暂无预警规则</b><span>尚未配置任何预警规则</span></div>
      <footer v-else><span>共 {{ filteredRules.length }} 条规则{{ dirtyCount ? ` · ${dirtyCount} 处未保存修改` : '' }}</span><span>变更保存后对新触发生效</span></footer>
    </div>

    <Transition name="da-toast"><div v-if="toast" class="da-toast"><span>✓</span>{{ toast }}</div></Transition>
  </section>
</template>

