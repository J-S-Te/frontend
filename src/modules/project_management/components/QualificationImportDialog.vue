<script setup>
import { computed, ref } from 'vue'
import { downloadCapabilityImportTemplate, previewCapabilitiesImport, importCapabilities, downloadEquipmentImportTemplate, previewEquipmentImport, importEquipment } from '@/modules/project_management/api/projectManagement'

const props = defineProps({ codeOptions: { type: Array, default: () => [] }, resourceType: { type: String, default: 'PERSON', validator: (value) => ['PERSON', 'EQUIPMENT'].includes(value) } })
const isEquipment = computed(() => props.resourceType === 'EQUIPMENT')
const resourceLabel = computed(() => isEquipment.value ? '设备能力' : '人员资质')
function dateLabel(value) { return !value || String(value).startsWith('0001-01-01') ? '不限' : String(value).slice(0, 10) }
const emit = defineEmits(['close', 'completed'])
const file = ref(null), preview = ref(null), result = ref(null), selected = ref([])
const busy = ref(false), error = ref(''), filter = ref('all')
const visibleRows = computed(() => (preview.value?.rows || []).filter((row) => filter.value === 'all' || (filter.value === 'valid' ? row.status === 'READY' : row.status !== 'READY')))
const readyRows = computed(() => (preview.value?.rows || []).filter((row) => row.status === 'READY'))
const selectedCount = computed(() => readyRows.value.filter((row) => selected.value.includes(row.row_no)).length)
function selectAll() { selected.value = readyRows.value.map((row) => row.row_no) }
function pick(event) {
  file.value = event.target.files?.[0] || null
  preview.value = null
  result.value = null
  selected.value = []
  error.value = ''
}
function reset() { file.value = null; preview.value = null; result.value = null; selected.value = []; error.value = ''; filter.value = 'all' }
async function download() {
  busy.value = true; error.value = ''
  let url = ''
  try {
    const value = await (isEquipment.value ? downloadEquipmentImportTemplate() : downloadCapabilityImportTemplate())
    url = URL.createObjectURL(value.blob)
    const link = document.createElement('a')
    link.href = url; link.download = value.filename; link.click()
  } catch (value) { error.value = value?.message || '模板下载失败。' }
  finally { if (url) URL.revokeObjectURL(url); busy.value = false }
}
async function inspect() {
  if (busy.value || !file.value) return
  if (!/\.csv$/i.test(file.value.name) || !file.value.size || file.value.size > 2 * 1024 * 1024) { error.value = '请选择不超过 2MB 的非空 CSV 文件。'; return }
  busy.value = true; error.value = ''
  try {
    const value = await (isEquipment.value ? previewEquipmentImport(file.value) : previewCapabilitiesImport(file.value))
    if (!Array.isArray(value?.rows)) throw new Error('预检响应异常，请重新上传。')
    preview.value = value
    filter.value = 'all'
    selectAll()
  } catch (value) { error.value = value?.message || '导入检测失败，请重试。' }
  finally { busy.value = false }
}
async function commit() {
  if (busy.value || result.value || !selectedCount.value) return
  busy.value = true; error.value = ''
  try {
    const rows = readyRows.value.filter((row) => selected.value.includes(row.row_no)).map((row) => row.row_no)
    const value = await (isEquipment.value ? importEquipment(file.value, rows) : importCapabilities(file.value, 'PERSON', rows))
    if (!Number.isInteger(value?.imported) || !Number.isInteger(value?.skipped) || !Array.isArray(value?.rows)) throw new Error('导入结果响应异常，请先核对台账再重试。')
    result.value = value
    emit('completed', result.value)
  } catch (value) { error.value = value?.message || '导入失败，请核对台账后重试。' }
  finally { busy.value = false }
}
</script>

<template>
  <div class="pm-overlay pm-import-overlay" @click.self="!busy && emit('close')">
    <section class="pm-dialog pm-dialog-wide" role="dialog" aria-modal="true" :aria-label="`${resourceLabel}批量导入`">
      <header><div><span>{{ isEquipment ? '设备能力维护' : '资质与能力管理' }}</span><h2>导入{{ resourceLabel }} CSV</h2><small class="pm-dialog-sub">下载模板 → 上传检测 → 确认导入</small></div><button class="pm-button" :disabled="busy" @click="emit('close')">关闭</button></header>
      <div class="pm-dialog-body">
        <p v-if="error" role="alert" class="pm-import-error">{{ error }}</p>
        <template v-if="!preview">
          <div class="pm-import-guide"><h3>第一步：准备文件</h3><p v-if="isEquipment">设备编号可留空，由系统生成；填写已有编号将更新对应设备，请核对更新行。同名设备可以有不同编号。检定日期填写 YYYY-MM-DD，可留空；开始日期不得晚于截止日期。已过期设备仍可登记，但不会作为有效设备参与匹配。</p><p v-else>姓名和组织名称须与基础平台人员目录一致，无需填写用户 ID。重名人员须通过组织唯一确认；资质编号可留空。这里只导入人员资质，设备请到设备能力维护。</p><button type="button" class="pm-button" :disabled="busy" @click="download">下载{{ resourceLabel }}导入模板</button></div>
          <div class="pm-table-scroll"><table v-if="isEquipment" class="pm-table"><thead><tr><th>设备名称</th><th>能力编码</th><th>状态</th><th>设备编号（选填）</th><th>检定开始日期</th><th>检定截止日期</th><th>使用范围</th></tr></thead><tbody><tr><td>实际设备名称</td><td>多个编码用分号分隔</td><td>ACTIVE / DISABLED</td><td>留空由系统生成</td><td>YYYY-MM-DD，可空</td><td>YYYY-MM-DD，可空</td><td>ANY（可借出） / COMPANY_ONLY（仅在公司使用）</td></tr></tbody></table><table v-else class="pm-table"><thead><tr><th>人员姓名</th><th>组织名称</th><th>资质编码</th><th>状态</th><th>资质编号（选填）</th></tr></thead><tbody><tr><td>填写真实姓名</td><td>填写实际组织名称</td><td>多个编码用分号分隔</td><td>ACTIVE / DISABLED</td><td>留空由系统确定</td></tr></tbody></table></div>
          <details><summary>查看当前可用{{ resourceLabel }}编码（{{ props.codeOptions.length }} 个）</summary><ul><li v-for="code in props.codeOptions" :key="code.value">{{ code.label }}</li></ul><p v-if="!props.codeOptions.length">暂无可用编码，请先在资质 / 能力编码配置中维护。</p></details>
          <label class="pm-field"><span>CSV 文件（UTF-8，最大 2MB，每次最多 500 行）</span><input type="file" accept=".csv,text/csv" :disabled="busy" @change="pick"></label><p v-if="file">已选择：{{ file.name }}</p><p>检测阶段不写入台账；检测后可筛选问题行并选择有效行导入。</p>
        </template>
        <template v-else-if="!result">
          <h3>第二步：检测结果</h3><p>共 {{ preview.total }} 行 · 可导入 {{ preview.valid }} 行 · 问题 {{ preview.invalid }} 行 · 已选 {{ selectedCount }} 行</p><p v-if="isEquipment">确认时服务端会重新核验设备、编码、检定日期和使用范围；更新行将替换对应设备的信息，请核对后选择。日期或范围留空的含义以检测结果为准。</p><p v-else>确认时服务端会重新核验人员、编码及台账；更新行将替换该档案的资质编码和状态，请核对后选择。</p>
          <div class="pm-actions"><select v-model="filter" aria-label="筛选检测结果"><option value="all">全部行</option><option value="valid">可导入</option><option value="invalid">问题行</option></select><button class="pm-button" :disabled="busy" @click="selectAll">选择全部有效行</button><button class="pm-button" :disabled="busy" @click="selected = []">清空选择</button></div>
          <div class="pm-table-scroll"><table class="pm-table"><thead><tr><th>选择</th><th>文件行号</th><th>{{ isEquipment ? '设备 / 编号' : '人员 / 组织' }}</th><th>{{ isEquipment ? '能力编码' : '资质编码' }}</th><th v-if="isEquipment">检定日期 / 使用范围</th><th>检测结果</th><th>说明</th></tr></thead><tbody><tr v-for="row in visibleRows" :key="row.row_no"><td><input v-model="selected" type="checkbox" :value="row.row_no" :disabled="busy || row.status !== 'READY'" :aria-label="`选择第 ${row.row_no} 行`"></td><td>{{ row.row_no }}</td><td>{{ row.resource_name }}<br>{{ isEquipment ? (row.capability?.resource_id || '确认时生成') : (row.organization_name || '—') }}</td><td>{{ (row.capability?.codes || []).join('；') }}</td><td v-if="isEquipment">{{ dateLabel(row.capability?.valid_from) }} ~ {{ dateLabel(row.capability?.valid_until) }}<br>{{ row.capability?.usage_scope === 'COMPANY_ONLY' ? '仅在公司使用' : '可借出' }}</td><td>{{ row.status === 'READY' ? (row.action === 'UPDATE' ? '可更新' : '可导入') : '不通过' }}</td><td>{{ [...(row.errors || []), ...(row.warnings || [])].join('；') || '校验通过' }}</td></tr></tbody></table></div>
        </template>
        <template v-else><h3>第三步：导入结果</h3><p role="status">已选行：成功 {{ result.imported }} 行 · 失败 {{ result.skipped }} 行；未选行不导入。</p><ul v-if="result.errors?.length"><li v-for="(message, index) in result.errors" :key="index">{{ message }}</li></ul><div v-if="result.rows?.length" class="pm-table-scroll"><table class="pm-table"><thead><tr><th>文件行号</th><th>结果</th><th>说明</th></tr></thead><tbody><tr v-for="row in result.rows" :key="row.row_no"><td>{{ row.row_no }}</td><td>{{ row.status === 'IMPORTED' ? '成功' : row.status === 'FAILED' ? '失败' : '跳过' }}</td><td>{{ row.message || '—' }}</td></tr></tbody></table></div></template>
      </div>
      <footer><button class="pm-button" :disabled="busy" @click="emit('close')">{{ result ? '完成' : '取消' }}</button><button v-if="preview && !result" class="pm-button" :disabled="busy" @click="reset">返回重新上传</button><button v-if="!preview" class="pm-button primary" :disabled="busy || !file" @click="inspect">{{ busy ? '检测中…' : '上传并检测' }}</button><button v-else-if="!result" class="pm-button primary" :disabled="busy || !selectedCount" @click="commit">{{ busy ? '导入中…' : `确认导入 ${selectedCount} 行` }}</button></footer>
    </section>
  </div>
</template>

<style scoped>
.pm-import-overlay{justify-content:center;align-items:center}.pm-import-guide{padding:16px;background:var(--pm-content,#f8fafc);border:1px solid var(--pm-line,#e2e8f0);border-radius:12px}.pm-import-guide h3{margin:0}.pm-import-guide p{line-height:1.7}.pm-import-error{padding:12px;border:1px solid #fecaca;background:#fef2f2;color:#b91c1c;border-radius:8px}.pm-dialog-body details li{overflow-wrap:anywhere}.pm-dialog-body p{line-height:1.6}
</style>
