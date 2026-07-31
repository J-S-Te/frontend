<script setup>
import { computed, reactive, ref } from 'vue'
import ConsoleIcon from '@/modules/platform/shared/components/ConsoleIcon.vue'
import { IamError, createUsersBatch } from '@/modules/platform/iam/api/iam'

// 上限与后端 POST /users/batch 的硬性约束保持一致：超过会一次性整体失败。
const BATCH_LIMIT = 100
const ACCEPTED_STATUSES = new Set(['ACTIVE', 'DISABLED'])

const props = defineProps({
  organizations: { type: Array, default: () => [] },
})
const emit = defineEmits(['close', 'completed', 'toast'])

// ---- wizard 状态 ----
const step = ref(1) // 1=上传, 2=预览, 3=结果
const fileName = ref('')
const fileSize = ref(0)
const rawText = ref('')
const parseError = ref('')
const submitting = ref(false)
const submitError = ref('')
const submitResult = ref(null) // { items: [], total, failed }

// 1-based 行号 → 行对象（包含原始单元格、解析结果、勾选状态、错误信息）。
// 解析失败的单行只影响自身，不阻断其他行的预览 / 提交。
const rows = reactive([])
let rowIdCounter = 0

// 过滤视图：'all' 看全部，'valid' 只看合法行，'invalid' 只看异常行。
const filterMode = ref('all')
const visibleRows = computed(() => {
  if (filterMode.value === 'valid') return rows.filter((row) => row.valid)
  if (filterMode.value === 'invalid') return rows.filter((row) => !row.valid)
  return rows
})

const stats = computed(() => {
  const total = rows.length
  let valid = 0
  let selected = 0
  for (const row of rows) {
    if (row.valid) valid += 1
    if (row.selected) selected += 1
  }
  return { total, valid, invalid: total - valid, selected }
})

const allSelected = computed(() => rows.length > 0 && rows.every((row) => row.selected))
const someSelected = computed(() => rows.some((row) => row.selected) && !allSelected.value)

// ---- 拖拽上传 ----
const dragOver = ref(false)
let fileInputEl = null

function onDragOver(event) {
  event.preventDefault()
  dragOver.value = true
}
function onDragLeave(event) {
  event.preventDefault()
  dragOver.value = false
}
function onDrop(event) {
  event.preventDefault()
  dragOver.value = false
  const file = event.dataTransfer?.files?.[0]
  if (file) ingestFile(file)
}
function onFilePicked(event) {
  const file = event.target?.files?.[0]
  if (file) ingestFile(file)
  // 允许同名文件再次选择
  if (event.target) event.target.value = ''
}
function pickFile() {
  fileInputEl?.click()
}

async function ingestFile(file) {
  parseError.value = ''
  if (!file) return
  if (!/\.csv$/i.test(file.name)) {
    parseError.value = '请选择 .csv 文件（UTF-8 编码）。'
    return
  }
  if (file.size > 5 * 1024 * 1024) {
    parseError.value = `文件过大（${(file.size / 1024).toFixed(0)} KB），建议拆成多个小批次。`
    return
  }
  let text = ''
  try {
    text = await file.text()
  } catch (error) {
    parseError.value = `读取文件失败：${error?.message || '未知错误'}`
    return
  }
  fileName.value = file.name
  fileSize.value = file.size
  rawText.value = text
  rebuildRows()
  if (parseError.value) return
  if (!rows.length) {
    parseError.value = '文件为空或没有可识别的数据行。'
    return
  }
  step.value = 2
}

// ---- 纯手写 CSV 解析（不引第三方库） ----
// 支持：双引号包裹字段、"" 转义为单 "、CRLF / LF 行尾、UTF-8 文本。
// 不支持：多行字段（被换行打断）。这与 RFC 4180 一致；如需扩展，再行。
function parseCsv(text) {
  const records = []
  let record = []
  let field = ''
  let inQuote = false
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    if (inQuote) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i += 1
        } else {
          inQuote = false
        }
      } else {
        field += ch
      }
      continue
    }
    if (ch === '"') {
      inQuote = true
    } else if (ch === ',') {
      record.push(field)
      field = ''
    } else if (ch === '\r' || ch === '\n') {
      record.push(field)
      field = ''
      if (record.some((col) => col.length > 0)) records.push(record)
      record = []
      // 兼容 \r\n
      if (ch === '\r' && text[i + 1] === '\n') i += 1
    } else {
      field += ch
    }
  }
  // 文件结尾残留字段
  if (field.length || record.length) {
    record.push(field)
    if (record.some((col) => col.length > 0)) records.push(record)
  }
  return records
}

const HEADER_ALIASES = {
  display_name: 'display_name',
  '姓名': 'display_name',
  '展示姓名': 'display_name',
  name: 'display_name',
  email: 'email',
  '邮箱': 'email',
  mail: 'email',
  mobile: 'mobile',
  '手机': 'mobile',
  '手机号': 'mobile',
  phone: 'mobile',
  status: 'status',
  '状态': 'status',
}

function normalizeHeader(value) {
  const key = String(value ?? '').trim().toLowerCase()
  return HEADER_ALIASES[key] || key
}

function rebuildRows() {
  // 重置状态
  rows.splice(0, rows.length)
  rowIdCounter = 0
  let records
  try {
    records = parseCsv(rawText.value)
  } catch (error) {
    parseError.value = `CSV 解析失败：${error?.message || '请检查文件格式'}`
    return
  }
  if (!records.length) {
    parseError.value = '文件为空或没有可识别的数据行。'
    return
  }

  // 表头检测：第一行若任意 cell 命中 HEADER_ALIASES，则视为表头。
  const firstRow = records[0]
  const hasHeader = firstRow.some((cell) => normalizeHeader(cell) in HEADER_ALIASES)
  let columnMap = { display_name: 0, email: 1, mobile: 2, status: 3 }
  let dataStart = 0
  if (hasHeader) {
    columnMap = { display_name: -1, email: -1, mobile: -1, status: -1 }
    firstRow.forEach((cell, idx) => {
      const key = normalizeHeader(cell)
      if (key in columnMap) columnMap[key] = idx
    })
    if (columnMap.display_name < 0) {
      parseError.value = '表头缺少“姓名 / display_name”列。'
      return
    }
    dataStart = 1
  }

  for (let i = dataStart; i < records.length; i += 1) {
    const cells = records[i]
    const lineNo = i + 1
    const row = makeRow(cells, columnMap, lineNo)
    rows.push(row)
  }

  if (rows.length > BATCH_LIMIT) {
    // 超过上限保留解析结果但阻止提交，避免一次性 500。
    parseError.value = `共解析出 ${rows.length} 行，超过单次 ${BATCH_LIMIT} 上限；请拆分文件后重试。`
  }
}

function pickColumn(cells, index) {
  if (index < 0) return ''
  return String(cells[index] ?? '').trim()
}

function makeRow(cells, columnMap, lineNo) {
  const displayName = pickColumn(cells, columnMap.display_name)
  const email = pickColumn(cells, columnMap.email)
  const mobile = pickColumn(cells, columnMap.mobile)
  const rawStatus = pickColumn(cells, columnMap.status).toUpperCase()
  const status = rawStatus || 'ACTIVE'

  const errors = []
  if (!displayName) errors.push('姓名必填')
  else if (Array.from(displayName).length > 100) errors.push('姓名不能超过 100 个字符')

  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push('邮箱格式不正确')

  if (mobile) {
    if (Array.from(mobile).length > 32) errors.push('手机号不能超过 32 个字符')
    else if (!/^\+?\d+$/.test(mobile.replace(/[\s-]/g, ''))) errors.push('手机号只能包含数字 / 空格 / 连字符 / 开头的加号')
  }

  if (rawStatus && !ACCEPTED_STATUSES.has(rawStatus)) errors.push('状态只能为 ACTIVE / DISABLED')

  // 标记字段过多的行（不抛错，避免打断预览）
  const overflow = cells.length > 4
  if (overflow) errors.push(`字段过多（${cells.length} 列）`)

  return {
    id: ++rowIdCounter,
    lineNo,
    displayName,
    email,
    mobile,
    status,
    valid: errors.length === 0,
    errors,
    selected: errors.length === 0, // 默认勾选合法行
    submitStatus: '', // 'success' | 'failed'
    submitMessage: '',
  }
}

// ---- 选中控制 ----
function toggleAll(value) {
  for (const row of rows) row.selected = Boolean(value)
}
function selectAll() { toggleAll(true) }
function invertSelection() {
  for (const row of rows) row.selected = !row.selected
}
function selectValidOnly() {
  for (const row of rows) row.selected = row.valid
}

const selectedValidRows = computed(() => rows.filter((row) => row.selected && row.valid))

// ---- 样例 CSV ----
const SAMPLE_CSV = 'display_name,email,mobile,status\n张三,zhang.san@example.com,13800000000,ACTIVE\n李四,,13900000000,ACTIVE\n王五,wang.wu@example.com,,\n赵六,zhao.liu@example.com,13500000000,DISABLED\n'

function downloadSample() {
  // 加上 UTF-8 BOM，方便 Excel 直接打开不乱码。
  const blob = new Blob(['\uFEFF', SAMPLE_CSV], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = 'users-template.csv'
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

// ---- 提交 ----
async function submit() {
  if (submitting.value) return
  const items = selectedValidRows.value
  if (!items.length) {
    submitError.value = '请至少勾选 1 行合法数据。'
    return
  }
  if (items.length > BATCH_LIMIT) {
    submitError.value = `单次最多 ${BATCH_LIMIT} 条，当前勾选 ${items.length} 条。`
    return
  }
  submitError.value = ''
  submitting.value = true
  try {
    const payload = items.map((row) => ({
      displayName: row.displayName,
      email: row.email || null,
      mobile: row.mobile || null,
      status: row.status || 'ACTIVE',
    }))
    const result = await createUsersBatch(payload)
    const created = Array.isArray(result?.items) ? result.items : []
    const createdByLineNo = new Map()
    for (const item of created) {
      if (item && (item.line_no || item.lineNo)) {
        createdByLineNo.set(Number(item.line_no || item.lineNo), item)
      }
    }
    // 标记每行结果。后端当前是全量提交/全量回滚；如果有 line_no 回执，单独标记成功行。
    for (const row of items) {
      if (createdByLineNo.has(row.lineNo)) {
        row.submitStatus = 'success'
        row.submitMessage = ''
      } else {
        row.submitStatus = 'success'
        row.submitMessage = ''
      }
    }
    submitResult.value = {
      createdCount: created.length || items.length,
      requestedCount: items.length,
      failedCount: 0,
      failures: [],
    }
    step.value = 3
    emit('toast', `已批量创建 ${created.length || items.length} 位用户。`)
    emit('completed', { createdCount: created.length || items.length })
  } catch (error) {
    submitError.value = error instanceof IamError ? error.message : (error?.message || '批量导入失败。')
    emit('toast', submitError.value)
  } finally {
    submitting.value = false
  }
}

// ---- 关闭 ----
function close() {
  if (submitting.value) return
  emit('close')
}
function onBackdropClick() {
  if (!submitting.value) emit('close')
}
function onKeydown(event) {
  if (event?.key === 'Escape' && !submitting.value) {
    event.stopPropagation()
    emit('close')
  }
}
function restart() {
  // 回到第一步重置
  step.value = 1
  rows.splice(0, rows.length)
  rawText.value = ''
  fileName.value = ''
  fileSize.value = 0
  parseError.value = ''
  submitError.value = ''
  submitResult.value = null
  filterMode.value = 'all'
}

function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}
</script>

<template>
  <div class="iam-modal-backdrop" role="presentation" @click.self="onBackdropClick" @keydown="onKeydown">
    <section class="iam-modal iam-batch-import-modal" role="dialog" aria-modal="true" aria-label="批量导入用户">
      <header>
        <div>
          <p>批量导入</p>
          <h3>从 CSV 导入用户</h3>
        </div>
        <button class="console-modal-close" type="button" aria-label="关闭批量导入" :disabled="submitting" @click="close">
          <ConsoleIcon name="close" />
        </button>
      </header>

      <ol class="iam-batch-import-steps" aria-label="批量导入步骤">
        <li :class="{ active: step === 1, done: step > 1 }"><b>1</b><span>上传 CSV</span></li>
        <li :class="{ active: step === 2, done: step > 2 }"><b>2</b><span>校验预览</span></li>
        <li :class="{ active: step === 3 }"><b>3</b><span>提交结果</span></li>
      </ol>

      <!-- 步骤 1：上传 CSV -->
      <div v-if="step === 1" class="iam-batch-import-body">
        <p class="iam-form-alert">
          <ConsoleIcon name="info" />
          支持列：<code>display_name</code>（姓名，必填）·<code>email</code>（邮箱，可选）·<code>mobile</code>（手机，可选）·<code>status</code>（<code>ACTIVE</code> / <code>DISABLED</code>，默认 <code>ACTIVE</code>）。单次最多 {{ BATCH_LIMIT }} 行，文件大小不超过 5 MB。
        </p>

        <div
          class="iam-batch-import-dropzone"
          :class="{ over: dragOver }"
          role="button"
          tabindex="0"
          aria-label="点击或拖拽上传 CSV 文件"
          @click="pickFile"
          @keydown.enter.prevent="pickFile"
          @keydown.space.prevent="pickFile"
          @dragover="onDragOver"
          @dragleave="onDragLeave"
          @drop="onDrop"
        >
          <ConsoleIcon name="download" />
          <strong>将 CSV 文件拖到此处，或点击选择</strong>
          <small>仅支持 <code>.csv</code>（UTF-8），解析失败的单行不会阻断其他行</small>
        </div>

        <input
          ref="fileInputEl"
          type="file"
          accept=".csv,text/csv"
          hidden
          @change="onFilePicked"
        />

        <div v-if="parseError" class="iam-batch-import-error" role="alert">{{ parseError }}</div>

        <div class="iam-batch-import-sample">
          <div>
            <strong>样例 CSV</strong>
            <p>第一行是表头，姓名列必填，其他列可留空。状态留空时按 <code>ACTIVE</code> 处理。</p>
            <pre><code>{{ SAMPLE_CSV }}</code></pre>
          </div>
          <button class="console-button ghost small" type="button" @click="downloadSample">
            <ConsoleIcon name="download" />下载样例 CSV
          </button>
        </div>
      </div>

      <!-- 步骤 2：预览 / 校验 -->
      <div v-else-if="step === 2" class="iam-batch-import-body">
        <div class="iam-batch-import-summary">
          <div>
            <strong>{{ fileName }}</strong>
            <small>{{ formatFileSize(fileSize) }} · 共 {{ stats.total }} 行</small>
          </div>
          <div class="iam-batch-import-stats">
            <span class="stat valid"><b>{{ stats.valid }}</b><small>合法</small></span>
            <span class="stat invalid"><b>{{ stats.invalid }}</b><small>异常</small></span>
            <span class="stat selected"><b>{{ stats.selected }}</b><small>已勾选</small></span>
          </div>
        </div>

        <div class="iam-batch-import-toolbar">
          <div class="iam-batch-import-toolbar-left">
            <button class="console-button ghost small" type="button" :disabled="!rows.length" @click="selectAll">全选</button>
            <button class="console-button ghost small" type="button" :disabled="!rows.length" @click="invertSelection">反选</button>
            <button class="console-button ghost small" type="button" :disabled="!rows.length" @click="selectValidOnly">只看合法行</button>
          </div>
          <div class="iam-batch-import-toolbar-right">
            <label class="iam-batch-import-filter">
              <span>筛选</span>
              <select v-model="filterMode">
                <option value="all">全部（{{ stats.total }}）</option>
                <option value="valid">仅合法（{{ stats.valid }}）</option>
                <option value="invalid">仅异常（{{ stats.invalid }}）</option>
              </select>
            </label>
            <button class="console-button ghost small" type="button" @click="restart">
              <ConsoleIcon name="reset" />重新上传
            </button>
          </div>
        </div>

        <div v-if="parseError" class="iam-batch-import-error" role="alert">{{ parseError }}</div>

        <div class="iam-batch-import-table-wrap">
          <table class="iam-batch-import-table">
            <thead>
              <tr>
                <th class="col-check">
                  <input
                    type="checkbox"
                    :checked="allSelected"
                    :indeterminate.prop="someSelected"
                    :disabled="!rows.length"
                    aria-label="全选"
                    @change="(event) => toggleAll(event.target.checked)"
                  />
                </th>
                <th class="col-line">行</th>
                <th>姓名</th>
                <th>邮箱</th>
                <th>手机</th>
                <th>状态</th>
                <th class="col-status">校验</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="!visibleRows.length">
                <td colspan="7" class="empty">当前筛选下没有数据行。</td>
              </tr>
              <tr
                v-for="row in visibleRows"
                :key="row.id"
                :class="{ invalid: !row.valid, success: row.submitStatus === 'success', failed: row.submitStatus === 'failed' }"
              >
                <td class="col-check">
                  <input
                    type="checkbox"
                    v-model="row.selected"
                    :disabled="!row.valid"
                    :aria-label="`第 ${row.lineNo} 行`"
                  />
                </td>
                <td class="col-line">{{ row.lineNo }}</td>
                <td>{{ row.displayName || '—' }}</td>
                <td>{{ row.email || '—' }}</td>
                <td>{{ row.mobile || '—' }}</td>
                <td>{{ row.status }}</td>
                <td class="col-status">
                  <span v-if="row.submitStatus === 'success'" class="badge ok">
                    <ConsoleIcon name="save" />已创建
                  </span>
                  <span v-else-if="row.submitStatus === 'failed'" class="badge bad" :title="row.submitMessage">
                    <ConsoleIcon name="close" />失败
                  </span>
                  <span v-else-if="row.valid" class="badge ok">
                    <ConsoleIcon name="save" />合法
                  </span>
                  <span v-else class="badge bad" :title="row.errors.join('；')">
                    <ConsoleIcon name="close" />{{ row.errors[0] }}
                    <small v-if="row.errors.length > 1">等 {{ row.errors.length }} 项</small>
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- 步骤 3：结果 -->
      <div v-else class="iam-batch-import-body">
        <div v-if="submitResult" class="iam-batch-import-result">
          <p class="iam-form-alert success">
            <ConsoleIcon name="save" />
            成功导入 <b>{{ submitResult.createdCount }}</b> / {{ submitResult.requestedCount }} 位用户，员工编号与“普通用户”角色由后端自动生成。
          </p>
          <p class="iam-field-help">导入后可在“用户”列表刷新查看，也可在“登录账号”中按需补建本地账号。</p>
        </div>
        <div v-else class="iam-batch-import-result">
          <p class="iam-form-alert danger">
            <ConsoleIcon name="info" />本次未提交任何数据。
          </p>
        </div>
      </div>

      <footer>
        <template v-if="step === 1">
          <button class="console-button ghost" type="button" @click="close">取消</button>
        </template>
        <template v-else-if="step === 2">
          <button class="console-button ghost" type="button" :disabled="submitting" @click="restart">重新上传</button>
          <button class="console-button ghost" type="button" :disabled="submitting" @click="close">取消</button>
          <button
            class="console-button primary"
            type="button"
            :disabled="submitting || !selectedValidRows.length || rows.length > BATCH_LIMIT"
            @click="submit"
          >
            <ConsoleIcon name="save" />
            {{ submitting ? '提交中…' : `提交 ${selectedValidRows.length} 行` }}
          </button>
        </template>
        <template v-else>
          <button class="console-button ghost" type="button" @click="restart">再导一批</button>
          <button class="console-button primary" type="button" @click="close">完成</button>
        </template>
      </footer>
    </section>
  </div>
</template>

<style scoped>
.iam-batch-import-modal {
  width: min(960px, 100%);
  max-height: min(880px, calc(100vh - 40px));
}

.iam-batch-import-steps {
  list-style: none;
  display: flex;
  align-items: center;
  gap: var(--s-3, 12px);
  margin: 0;
  padding: 18px 28px 4px;
  color: var(--ink-3, #6b7280);
  font-size: 12.5px;
}
.iam-batch-import-steps li {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
}
.iam-batch-import-steps li b {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 999px;
  background: var(--surface-2, #f3f4f6);
  color: var(--ink-3, #6b7280);
  font-size: 12px;
  font-weight: 700;
}
.iam-batch-import-steps li.active b {
  background: var(--brand-1, #2563eb);
  color: #fff;
}
.iam-batch-import-steps li.done b {
  background: var(--brand-1, #2563eb);
  color: #fff;
  opacity: 0.65;
}
.iam-batch-import-steps li.active { color: var(--ink-1, #111827); }

.iam-batch-import-body {
  padding: 18px 28px 4px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.iam-batch-import-dropzone {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 36px 24px;
  border: 1.5px dashed var(--line-2, #e5e7eb);
  border-radius: 12px;
  background: var(--surface-2, #fafbff);
  color: var(--ink-2, #374151);
  cursor: pointer;
  transition: border-color 160ms, background 160ms;
}
.iam-batch-import-dropzone:hover,
.iam-batch-import-dropzone:focus,
.iam-batch-import-dropzone.over {
  border-color: var(--brand-1, #2563eb);
  background: var(--brand-soft, #eef4ff);
  outline: none;
}
.iam-batch-import-dropzone svg { width: 28px; height: 28px; color: var(--brand-1, #2563eb); }
.iam-batch-import-dropzone strong { font-size: 14px; }
.iam-batch-import-dropzone small { color: var(--ink-3, #6b7280); font-size: 12px; }
.iam-batch-import-dropzone code {
  background: var(--surface, #fff);
  border: 1px solid var(--line-2, #e5e7eb);
  border-radius: 4px;
  padding: 0 4px;
  font-size: 11.5px;
}

.iam-batch-import-error {
  background: #fef2f2;
  border: 1px solid #fecaca;
  color: #b91c1c;
  padding: 10px 12px;
  border-radius: 8px;
  font-size: 13px;
}

.iam-batch-import-sample {
  display: flex;
  gap: 16px;
  align-items: flex-start;
  padding: 12px 14px;
  background: var(--surface-2, #fafbff);
  border: 1px solid var(--line-2, #e5e7eb);
  border-radius: 10px;
}
.iam-batch-import-sample > div { flex: 1; }
.iam-batch-import-sample strong { font-size: 13px; }
.iam-batch-import-sample p { margin: 4px 0 8px; color: var(--ink-3, #6b7280); font-size: 12px; }
.iam-batch-import-sample pre {
  margin: 0;
  background: var(--surface, #fff);
  border: 1px solid var(--line-2, #e5e7eb);
  border-radius: 6px;
  padding: 8px 10px;
  font-size: 12px;
  overflow-x: auto;
  color: var(--ink-2, #374151);
  line-height: 1.55;
}

.iam-batch-import-summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 14px;
  background: var(--surface-2, #fafbff);
  border: 1px solid var(--line-2, #e5e7eb);
  border-radius: 10px;
}
.iam-batch-import-summary strong { font-size: 13px; }
.iam-batch-import-summary small { display: block; color: var(--ink-3, #6b7280); font-size: 12px; margin-top: 2px; }
.iam-batch-import-stats { display: flex; gap: 14px; }
.iam-batch-import-stats .stat {
  display: flex;
  flex-direction: column;
  align-items: center;
  min-width: 56px;
  padding: 4px 8px;
  border-radius: 8px;
  background: var(--surface, #fff);
  border: 1px solid var(--line-2, #e5e7eb);
}
.iam-batch-import-stats .stat b { font-size: 18px; line-height: 1; }
.iam-batch-import-stats .stat small { font-size: 11px; color: var(--ink-3, #6b7280); }
.iam-batch-import-stats .stat.valid b { color: #15803d; }
.iam-batch-import-stats .stat.invalid b { color: #b91c1c; }
.iam-batch-import-stats .stat.selected b { color: var(--brand-1, #2563eb); }

.iam-batch-import-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
.iam-batch-import-toolbar-left,
.iam-batch-import-toolbar-right {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.iam-batch-import-filter {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12.5px;
  color: var(--ink-3, #6b7280);
}
.iam-batch-import-filter select {
  font-size: 12.5px;
  padding: 4px 8px;
  border: 1px solid var(--line-2, #e5e7eb);
  border-radius: 6px;
  background: var(--surface, #fff);
}

.iam-batch-import-table-wrap {
  border: 1px solid var(--line-2, #e5e7eb);
  border-radius: 10px;
  overflow: auto;
  max-height: min(480px, calc(100vh - 360px));
}
.iam-batch-import-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12.5px;
}
.iam-batch-import-table thead th {
  position: sticky;
  top: 0;
  background: var(--surface-2, #fafbff);
  text-align: left;
  font-weight: 600;
  color: var(--ink-2, #374151);
  padding: 8px 10px;
  border-bottom: 1px solid var(--line-2, #e5e7eb);
  white-space: nowrap;
}
.iam-batch-import-table tbody td {
  padding: 7px 10px;
  border-bottom: 1px solid var(--line-2, #e5e7eb);
  color: var(--ink-2, #374151);
  vertical-align: middle;
}
.iam-batch-import-table tbody tr:last-child td { border-bottom: 0; }
.iam-batch-import-table tbody tr.invalid { background: #fef2f2; }
.iam-batch-import-table tbody tr.success { background: #f0fdf4; }
.iam-batch-import-table tbody tr.failed { background: #fef2f2; }
.iam-batch-import-table tbody td.empty { text-align: center; color: var(--ink-3, #6b7280); padding: 18px; }
.iam-batch-import-table .col-check { width: 36px; text-align: center; }
.iam-batch-import-table .col-line { width: 50px; color: var(--ink-3, #6b7280); }
.iam-batch-import-table .col-status { width: 200px; }
.iam-batch-import-table .badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11.5px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 999px;
}
.iam-batch-import-table .badge svg { width: 12px; height: 12px; }
.iam-batch-import-table .badge.ok { background: #dcfce7; color: #15803d; }
.iam-batch-import-table .badge.bad { background: #fee2e2; color: #b91c1c; }
.iam-batch-import-table .badge small { font-weight: 500; opacity: 0.85; margin-left: 2px; }

.iam-batch-import-result { display: flex; flex-direction: column; gap: 8px; }
.iam-batch-import-result .iam-form-alert.success {
  background: #f0fdf4;
  border-color: #bbf7d0;
  color: #14532d;
}
.iam-batch-import-result .iam-form-alert.danger {
  background: #fef2f2;
  border-color: #fecaca;
  color: #b91c1c;
}

@media (max-width: 640px) {
  .iam-batch-import-modal { width: 100%; }
  .iam-batch-import-body { padding: 16px 18px 4px; }
  .iam-batch-import-steps { padding: 14px 18px 0; }
  .iam-batch-import-summary { flex-direction: column; align-items: flex-start; }
  .iam-batch-import-table .col-status { width: auto; }
}
</style>
