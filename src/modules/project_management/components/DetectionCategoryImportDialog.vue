<script setup>
import { computed, ref } from 'vue'
import { downloadDetectionCategoryImportTemplate, previewDetectionCategoriesImport, importDetectionCategories } from '@/modules/project_management/api/projectManagement'

const props = defineProps({ codeOptions: { type: Array, default: () => [] } })
const emit = defineEmits(['close', 'completed'])
const file = ref(null), preview = ref(null), result = ref(null), selected = ref([])
const busy = ref(false), error = ref(''), filter = ref('all')
const readyRows = computed(() => (preview.value?.rows || []).filter((row) => row.status === 'READY'))
const visibleRows = computed(() => (preview.value?.rows || []).filter((row) => filter.value === 'all' || (filter.value === 'valid' ? row.status === 'READY' : row.status !== 'READY')))
const selectedCount = computed(() => readyRows.value.filter((row) => selected.value.includes(row.row_no)).length)
const methodLabels = { NO: '否', MARKABLE: '可标记', REQUIRED: '必为特殊方法' }
function selectAll() { selected.value = readyRows.value.map((row) => row.row_no) }
function pick(event) { file.value = event.target.files?.[0] || null; preview.value = null; result.value = null; selected.value = []; error.value = ''; filter.value = 'all' }
function reset() { file.value = null; preview.value = null; result.value = null; selected.value = []; error.value = ''; filter.value = 'all' }
async function download(example = false) {
  if (busy.value) return
  busy.value = true; error.value = ''
  let url = ''
  try {
    const value = await downloadDetectionCategoryImportTemplate(example)
    url = URL.createObjectURL(value.blob)
    const link = document.createElement('a')
    link.href = url; link.download = value.filename; link.click()
  } catch (value) { error.value = value?.message || '文件下载失败，请重试。' }
  finally { if (url) URL.revokeObjectURL(url); busy.value = false }
}
async function inspect() {
  if (busy.value || !file.value) return
  if (!/\.csv$/i.test(file.value.name) || !file.value.size || file.value.size > 2 * 1024 * 1024) { error.value = '请选择不超过 2MB 的非空 CSV 文件。'; return }
  busy.value = true; error.value = ''
  try {
    const value = await previewDetectionCategoriesImport(file.value)
    if (!Array.isArray(value?.rows)) throw new Error('检测响应异常，请重新上传。')
    preview.value = value; filter.value = 'all'; selectAll()
  } catch (value) { error.value = value?.message || '导入检测失败，请重试。' }
  finally { busy.value = false }
}
async function commit() {
  if (busy.value || result.value || !selectedCount.value) return
  busy.value = true; error.value = ''
  try {
    const rows = readyRows.value.filter((row) => selected.value.includes(row.row_no)).map((row) => row.row_no)
    const value = await importDetectionCategories(file.value, rows)
    if (!Number.isInteger(value?.imported) || !Number.isInteger(value?.skipped) || !Array.isArray(value?.rows)) throw new Error('导入结果响应异常，请先核对类别目录再重试。')
    result.value = value; emit('completed', value)
  } catch (value) { error.value = value?.message || '导入失败，请核对类别目录后重试。' }
  finally { busy.value = false }
}
</script>

<template>
  <div class="pm-overlay pm-category-import-overlay" @click.self="!busy && emit('close')">
    <section class="pm-dialog pm-dialog-wide" role="dialog" aria-modal="true" aria-label="检测类别与人员要求批量导入">
      <header><div><span>检测类别与人员要求</span><h2>导入检测类别 CSV</h2><small class="pm-dialog-sub">准备模板 → 上传检测 → 选择有效行 → 确认导入</small></div><button class="pm-button" :disabled="busy" @click="emit('close')">关闭</button></header>
      <div class="pm-dialog-body">
        <p v-if="error" role="alert" class="pm-category-import-error">{{ error }}</p>
        <template v-if="!preview">
          <section class="pm-category-import-guide"><h3>第一步：准备文件</h3><p>空白模板仅包含表头；填写示例仅用于说明，上传前必须将示例行替换为实际类别或删除。无需填写任何用户 ID、组织 ID。</p><div class="pm-actions"><button class="pm-button" :disabled="busy" @click="download(false)">下载空白导入模板</button><button class="pm-button" :disabled="busy" @click="download(true)">下载填写示例</button></div></section>
          <div class="pm-table-scroll"><table class="pm-table"><thead><tr><th>检测类别</th><th>默认体系要求</th><th>必备资质（默认）</th><th>必检能力码</th><th>是否特殊方法</th><th>状态</th></tr></thead><tbody><tr><td>实际检测类别（必填）</td><td>实际体系要求，可留空</td><td>人员资质文字要求，可留空</td><td>选择下方实际编码，多个用分号分隔，可留空</td><td>否 / 可标记 / 必为特殊方法</td><td>启用 / 停用</td></tr></tbody></table></div>
          <p>特殊方法也可填写 NO / MARKABLE / REQUIRED；状态也可填写 true / false。类别名称相同时为更新，将替换该类别的体系、资质、能力编码、特殊方法和状态，请核对检测结果中的更新行。</p>
          <details><summary>查看当前可用人员能力编码（{{ props.codeOptions.length }} 个）</summary><ul><li v-for="code in props.codeOptions" :key="code.value">{{ code.label }}</li></ul><p v-if="!props.codeOptions.length">暂无可用人员编码；必检能力码可留空，需要配置时请先维护资质 / 能力编码目录。</p></details>
          <label class="pm-field"><span>CSV 文件（UTF-8，最大 2MB，每次最多 500 行）</span><input type="file" accept=".csv,text/csv" :disabled="busy" @change="pick"></label><p v-if="file">已选择：{{ file.name }}</p><p>上传检测不会写入类别目录；服务器检查表头、字段、编码、重复类别等，问题行不可选择。</p>
        </template>
        <template v-else-if="!result">
          <h3>第二步：检测结果</h3><p>共 {{ preview.total }} 行 · 可导入 {{ preview.valid }} 行 · 问题 {{ preview.invalid }} 行 · 已选 {{ selectedCount }} 行</p><p>确认时重新读取原文件并校验，只导入勾选的有效行。更新行将替换原配置，关联服务项不会被这次导入改写。</p>
          <div class="pm-actions"><select v-model="filter" aria-label="筛选检测结果"><option value="all">全部行</option><option value="valid">可导入</option><option value="invalid">问题行</option></select><button class="pm-button" :disabled="busy" @click="selectAll">选择全部有效行</button><button class="pm-button" :disabled="busy" @click="selected = []">清空选择</button></div>
          <div class="pm-table-scroll"><table class="pm-table"><thead><tr><th>选择</th><th>文件行号</th><th>检测类别</th><th>体系 / 资质要求</th><th>必检能力码</th><th>特殊方法 / 状态</th><th>检测结果</th><th>说明</th></tr></thead><tbody><tr v-for="row in visibleRows" :key="row.row_no"><td><input v-model="selected" type="checkbox" :value="row.row_no" :disabled="busy || row.status !== 'READY'" :aria-label="`选择第 ${row.row_no} 行`"></td><td>{{ row.row_no }}</td><td>{{ row.item?.category || '—' }}</td><td>{{ row.item?.system_standard || '—' }}<br>{{ row.item?.required_qualifications || '—' }}</td><td>{{ row.item?.required_codes || '—' }}</td><td>{{ methodLabels[row.item?.special_method] || row.item?.special_method || '—' }} / {{ row.item?.enabled ? '启用' : '停用' }}</td><td>{{ row.status === 'READY' ? (row.action === 'UPDATE' ? '可更新' : '可导入') : '不通过' }}</td><td>{{ [...(row.errors || []), ...(row.warnings || [])].join('；') || '校验通过' }}</td></tr></tbody></table></div>
        </template>
        <template v-else><h3>第三步：导入结果</h3><p role="status">已选行：成功 {{ result.imported }} 行 · 失败 {{ result.skipped }} 行；未选行不导入。</p><ul v-if="result.errors?.length"><li v-for="(message, index) in result.errors" :key="index">{{ message }}</li></ul><div class="pm-table-scroll"><table class="pm-table"><thead><tr><th>文件行号</th><th>结果</th><th>说明</th></tr></thead><tbody><tr v-for="row in result.rows" :key="row.row_no"><td>{{ row.row_no }}</td><td>{{ row.status === 'IMPORTED' ? '成功' : row.status === 'FAILED' ? '失败' : '跳过' }}</td><td>{{ row.message || '—' }}</td></tr></tbody></table></div></template>
      </div>
      <footer><button class="pm-button" :disabled="busy" @click="emit('close')">{{ result ? '完成' : '取消' }}</button><button v-if="preview && !result" class="pm-button" :disabled="busy" @click="reset">返回重新上传</button><button v-if="!preview" class="pm-button primary" :disabled="busy || !file" @click="inspect">{{ busy ? '检测中…' : '上传并检测' }}</button><button v-else-if="!result" class="pm-button primary" :disabled="busy || !selectedCount" @click="commit">{{ busy ? '导入中…' : `确认导入 ${selectedCount} 行` }}</button></footer>
    </section>
  </div>
</template>

<style scoped>
.pm-category-import-overlay{justify-content:center;align-items:center}.pm-category-import-guide{padding:16px;background:var(--pm-content,#f8fafc);border:1px solid var(--pm-line,#e2e8f0);border-radius:12px}.pm-category-import-guide h3{margin:0}.pm-dialog-body p{line-height:1.7}.pm-category-import-error{padding:12px;border:1px solid #fecaca;background:#fef2f2;color:#b91c1c;border-radius:8px}.pm-dialog-body details li{overflow-wrap:anywhere}
</style>
