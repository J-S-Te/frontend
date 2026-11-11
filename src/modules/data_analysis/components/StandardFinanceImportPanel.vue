<script setup>
import { computed, onMounted, ref } from 'vue'
import { getStandardFinanceTemplate, getStandardFinanceStatus, previewStandardFinance, publishStandardFinance } from '../api/dataAnalysis.js'
import { formatDataAnalysisError } from '../utils/errors.js'

const props = defineProps({ permissions: { type: Array, default: () => [] } })
const selectedSource = ref('')
const publication = ref(null)
const loading = ref(false)
const busy = ref(false)
const statusError = ref('')
const error = ref('')
const notice = ref('')
const fileName = ref('')
const documentFile = ref(null)
const preview = ref(null)
const confirmed = ref(false)
const uncertain = ref(false)
const guide = ref([])
let fileVersion = 0
const canImport = computed(() => props.permissions.includes('aggregation.manage') && selectedSource.value === 'standard' && !statusError.value && !loading.value && !busy.value && !uncertain.value)
const currencyRows = computed(() => preview.value?.snapshot?.metrics?.currencies || [])

// 用途：读取权威来源状态，区分未发布、联动来源和依赖故障。
// 参数：无。
// 返回值：状态是否读取成功；失败时保留明确错误并阻止发布。
async function loadState() {
  if (loading.value) return false
  loading.value = true
  statusError.value = ''
  try {
    const result = await getStandardFinanceStatus()
    selectedSource.value = result.selected_source
    publication.value = result.publication
    uncertain.value = false
    if (preview.value && result.publication?.batch_id === documentFile.value?.batch_id && result.publication?.digest === preview.value.digest) {
      notice.value = '该批次已发布，请打开财务看板查看当前来源指标。'
      preview.value = null
      confirmed.value = false
    } else if (preview.value && result.publication?.version !== preview.value.expected_version) {
      preview.value = null
      confirmed.value = false
      notice.value = '来源版本已经变化，请重新预览当前文件后再发布。'
    }
    return true
  } catch (cause) {
    statusError.value = formatDataAnalysisError(cause, { fallback: '标准事实来源状态读取失败，请刷新核对。' })
    return false
  } finally {
    loading.value = false
  }
}

// 用途：有界读取用户明确选择的 JSON 文件，换文件时作废旧预览。
// 参数：event 为文件选择事件，仅读取首个本地文件。
// 返回值：无；超限或格式失败时不保留待发布内容。
async function onFile(event) {
  if (busy.value || loading.value) return
  const version = ++fileVersion
  preview.value = null
  confirmed.value = false
  documentFile.value = null
  error.value = ''
  notice.value = ''
  const file = event.target.files?.[0]
  fileName.value = file?.name || ''
  if (!file) return
  if (file.size > 1048576) { error.value = '事实文件不能超过 1 MiB。'; return }
  try {
    const parsed = JSON.parse(await file.text())
    if (version !== fileVersion) return
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('事实文件须为标准 JSON 对象。')
    documentFile.value = parsed
  } catch {
    if (version === fileVersion) error.value = '事实文件格式不正确，请下载标准 JSON 模板填写。'
  }
}

// 用途：将完整文件交给服务端校验并呈现分币种总额，不进行发布。
// 参数：无。
// 返回值：无；校验失败清除旧预览，保留可修正的文件错误。
async function prepare() {
  if (!canImport.value || !documentFile.value) return
  busy.value = true
  preview.value = null
  confirmed.value = false
  error.value = ''
  try {
    preview.value = await previewStandardFinance(documentFile.value)
  } catch (cause) {
    error.value = formatDataAnalysisError(cause, { fallback: '文件预览失败，请核对事实后重新选择文件。' })
  } finally {
    busy.value = false
  }
}

// 用途：只在明确确认后提交当前文件、预览指纹与版本，保留失败可核对状态。
// 参数：无。
// 返回值：无；不确定结果先锁定发布并要求读取权威状态。
async function publish() {
  if (!canImport.value || !preview.value || !confirmed.value) return
  busy.value = true
  error.value = ''
  notice.value = ''
  try {
    const result = await publishStandardFinance({ document: documentFile.value, digest: preview.value.digest, expected_version: preview.value.expected_version })
    publication.value = result
    preview.value = null
    confirmed.value = false
    notice.value = result.replayed ? '该批次此前已发布，本次重试未重复写入。' : `标准财务事实已发布，版本 ${result.version}。打开财务看板后可查看真实指标。`
    if (!await loadState()) notice.value += ' 发布已完成，但状态刷新失败，请稍后刷新核对。'
  } catch (cause) {
    error.value = formatDataAnalysisError(cause, { fallback: '发布结果尚未确认，请先刷新来源状态核对批次。' })
    confirmed.value = false
    if (cause.status === 409) preview.value = null
    else if (!cause.status || cause.status < 400 || cause.status === 408 || cause.status >= 500) {
      uncertain.value = true
    }
  } finally {
    busy.value = false
  }
}

// 用途：下载无模拟事实的标准模板，同时展示字段含义与金额日期口径。
// 参数：无。
// 返回值：无；下载失败通过页面错误展示。
async function downloadTemplate() {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    const result = await getStandardFinanceTemplate()
    guide.value = result.guide || []
    const url = URL.createObjectURL(new Blob([JSON.stringify(result.document, null, 2)], { type: 'application/json' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = result.filename
    anchor.click()
    URL.revokeObjectURL(url)
  } catch (cause) {
    error.value = formatDataAnalysisError(cause, { fallback: '模板下载失败，请稍后重试。' })
  } finally {
    busy.value = false
  }
}

// 用途：将服务端整数金额转换为明确的币种金额显示。
// 参数：minor 为服务端校验的百分之一币种金额整数。
// 返回值：保留两位小数的金额文本。
function amount(minor) {
  return (Number(minor || 0) / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

onMounted(loadState)
</script>

<template>
  <section class="da-table-panel standard-finance-panel" aria-label="标准经营事实导入">
    <header class="da-filters">
      <div><b>标准经营事实导入 · 财务</b><p>上传截至日完整已确认应收与有效回款，预览后明确发布。</p></div>
      <button class="da-button" :disabled="busy || loading" @click="downloadTemplate">下载标准 JSON 模板</button>
      <button class="da-button ghost" :disabled="busy || loading" @click="loadState">刷新来源状态</button>
    </header>
    <p v-if="loading" role="status">正在读取来源状态…</p>
    <p v-else-if="statusError" role="alert">{{ statusError }}</p>
    <p v-else-if="selectedSource !== 'standard'">当前财务看板使用业务联动来源。标准事实导入未启用，请联系管理员选择来源。</p>
    <template v-else>
      <p role="status">{{ publication?.published ? `已发布版本 ${publication.version} · 批次 ${publication.batch_id}` : '尚未发布标准财务事实，财务看板将明确显示未发布。' }}</p>
      <p>每次发布替换本标准来源上一版；金额单位为币种金额的 1/100，按币种分别核对。文件最多 1 MiB、合计 1000 条。</p>
      <div class="da-filters">
        <label>选择事实文件 <input type="file" accept=".json,application/json" :disabled="!canImport" @change="onFile" /></label>
        <span>{{ fileName }}</span>
        <button class="da-button" :disabled="!canImport || !documentFile" @click="prepare">校验并预览</button>
      </div>
      <div v-if="preview" class="da-table-scroll">
        <p>截至日 {{ documentFile.as_of_date }} · {{ preview.row_count }} 条事实 · 预期当前版本 {{ preview.expected_version }}</p>
        <p v-if="preview.row_count === 0">文件无事实记录，本次发布将把本来源明确更新为真实零值，请确认业务确实无应收和回款。</p>
        <table class="da-table"><thead><tr><th scope="col">币种</th><th scope="col">原始应收</th><th scope="col">已核销回款</th><th scope="col">未清余额</th><th scope="col">逾期超过90天</th><th scope="col">截至月回款</th></tr></thead><tbody><tr v-for="row in currencyRows" :key="row.currency"><td>{{ row.currency }}</td><td>{{ amount(row.original_minor) }}</td><td>{{ amount(row.allocated_minor) }}</td><td>{{ amount(row.open_minor) }}</td><td>{{ amount(row.over_90_minor) }}</td><td>{{ amount(row.month_receipts_minor) }}</td></tr></tbody></table>
        <label class="standard-finance-confirm"><input v-model="confirmed" type="checkbox" :disabled="!canImport" />我已核对截至日、完整性和分币种总额，确认发布本来源的新版本。</label>
        <button class="da-button primary" :disabled="!canImport || !confirmed" @click="publish">明确发布标准事实</button>
      </div>
    </template>
    <p v-if="error" role="alert">{{ error }}</p>
    <p v-if="notice" role="status">{{ notice }}</p>
    <details v-if="guide.length"><summary>标准字段与统计口径说明</summary><ul><li v-for="item in guide" :key="item">{{ item }}</li></ul></details>
  </section>
</template>

<style scoped>
.standard-finance-panel { margin-bottom: 20px; padding: 16px; }
.standard-finance-panel p { line-height: 1.7; }
.standard-finance-confirm { display: flex; gap: 8px; align-items: center; margin: 16px 0; }
</style>
