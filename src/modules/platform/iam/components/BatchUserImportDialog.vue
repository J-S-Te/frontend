<script setup>
import { computed, reactive, ref } from 'vue'
import ConsoleIcon from '@/modules/platform/shared/components/ConsoleIcon.vue'
import { IamError, createUsersBatch } from '@/modules/platform/iam/api/iam'
import { parseApplicationRoles } from '@/modules/platform/iam/utils/batchUserImport.js'

// 上限与后端 POST /users/batch 的硬性约束保持一致：超过会一次性整体失败。
const BATCH_LIMIT = 100
const ACCEPTED_STATUSES = new Set(['ACTIVE', 'DISABLED'])
const STATUS_ALIASES = new Map([
  ['启用', 'ACTIVE'],
  ['停用', 'DISABLED'],
  ['ACTIVE', 'ACTIVE'],
  ['DISABLED', 'DISABLED'],
])

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

// 解析器把引号内的逗号、换行和双引号转义保留为字段内容，只在引号外把 CRLF/LF
// 视为记录边界。这里不做业务字段校验，解析后的每一行会在预览阶段独立标记错误，
// 避免单行脏数据让管理员失去检查其余记录的机会。
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
      // CRLF 是一个记录分隔符，消费 \r 后跳过紧随的 \n，避免生成空记录。
      if (ch === '\r' && text[i + 1] === '\n') i += 1
    } else {
      field += ch
    }
  }
  // 文件可以不以换行结尾，循环结束后仍要提交最后一个字段和记录。
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
  application_roles: 'application_roles',
  '应用角色': 'application_roles',
  roles: 'application_roles',
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
  let columnMap = { display_name: 0, email: 1, mobile: 2, status: 3, application_roles: 4 }
  let dataStart = 0
  if (hasHeader) {
    columnMap = { display_name: -1, email: -1, mobile: -1, status: -1, application_roles: -1 }
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
  const rawStatus = pickColumn(cells, columnMap.status)
  const normalizedStatus = rawStatus.toUpperCase()
  const status = STATUS_ALIASES.get(rawStatus) || STATUS_ALIASES.get(normalizedStatus) || 'ACTIVE'
  const rawApplicationRoles = pickColumn(cells, columnMap.application_roles)
  const applicationRoles = []

  const errors = []
  if (!displayName) errors.push('姓名必填')
  else if (Array.from(displayName).length > 100) errors.push('姓名不能超过 100 个字符')

  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push('邮箱格式不正确')

  if (mobile) {
    if (Array.from(mobile).length > 32) errors.push('手机号不能超过 32 个字符')
    else if (!/^\+?\d+$/.test(mobile.replace(/[\s-]/g, ''))) errors.push('手机号只能包含数字 / 空格 / 连字符 / 开头的加号')
  }

  if (rawStatus && !STATUS_ALIASES.has(rawStatus) && !ACCEPTED_STATUSES.has(normalizedStatus)) {
    errors.push('状态只能填写“启用”或“停用”')
  }

  if (rawApplicationRoles) {
    const parsedRoles = parseApplicationRoles(rawApplicationRoles)
    applicationRoles.push(...parsedRoles.roles)
    errors.push(...parsedRoles.errors)
  }

  // 标记字段过多的行（不抛错，避免打断预览）
  const expectedColumns = Math.max(...Object.values(columnMap).filter((value) => value >= 0), 3) + 1
  const overflow = cells.length > expectedColumns
  if (overflow) errors.push(`字段过多（${cells.length} 列）`)

  return {
    id: ++rowIdCounter,
    lineNo,
    displayName,
    email,
    mobile,
    status,
    rawApplicationRoles,
    applicationRoles,
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
const SAMPLE_CSV = '姓名,邮箱,手机号,状态,应用角色\n张三,zhang.san@example.com,13800000000,启用,\n李四,,13900000000,启用,\n王五,wang.wu@example.com,,启用,\n赵六,zhao.liu@example.com,13500000000,停用,合同管理系统：审计管理员\n'

function downloadSample() {
  // 加上 UTF-8 BOM，方便 Excel 直接打开不乱码。
  const blob = new Blob(['\uFEFF', SAMPLE_CSV], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = '用户批量导入模板.csv'
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
      applicationRoles: row.applicationRoles,
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
        <div class="iam-batch-import-heading">
          <span class="iam-batch-import-heading-icon"><ConsoleIcon name="user" /></span>
          <div>
            <p>用户目录 · 批量创建</p>
            <h3>从 CSV 导入用户</h3>
            <small>上传文件后先校验数据，确认无误再写入用户目录</small>
          </div>
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
        <p class="iam-form-alert iam-batch-import-guide">
          <ConsoleIcon name="info" />
          <span>表头使用“姓名、邮箱、手机号、状态、应用角色”。标准角色应通过任职关系和岗位授权模板自动获得；“应用角色”仅用于少量个人例外，可留空。单次最多 {{ BATCH_LIMIT }} 行。</span>
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
          <span class="iam-batch-import-upload-icon"><ConsoleIcon name="download" /></span>
          <strong>拖拽 CSV 文件到此处</strong>
          <small>或者 <b>点击选择文件</b> · 仅支持 UTF-8 编码的 <code>.csv</code></small>
          <em>解析失败的行会单独标记，不影响其他有效数据</em>
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
          <div class="iam-batch-import-sample-copy">
            <span class="iam-batch-import-sample-title"><ConsoleIcon name="info" /><strong>文件格式示例</strong></span>
            <p>姓名必填，其他列可留空。个人例外角色填写“应用名称：角色名称”，多个角色用“|”分隔；日常岗位角色不要写入 CSV。</p>
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
          <div class="iam-batch-import-file">
            <span><ConsoleIcon name="download" /></span>
            <div>
            <strong>{{ fileName }}</strong>
            <small>{{ formatFileSize(fileSize) }} · 共 {{ stats.total }} 行</small>
            </div>
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
            <button class="console-button ghost small" type="button" :disabled="!rows.length" @click="selectValidOnly">仅选合法行</button>
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
                <th>应用角色</th>
                <th class="col-status">校验</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="!visibleRows.length">
                <td colspan="8" class="empty">当前筛选下没有数据行。</td>
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
                <td>{{ row.status === 'ACTIVE' ? '启用' : '停用' }}</td>
                <td><code>{{ row.rawApplicationRoles || '—' }}</code></td>
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
          <span class="iam-batch-import-result-icon success"><ConsoleIcon name="save" /></span>
          <h4>用户导入完成</h4>
          <p class="iam-form-alert success">
            <ConsoleIcon name="save" />
            成功导入 <b>{{ submitResult.createdCount }}</b> / {{ submitResult.requestedCount }} 位用户。员工编号与基础平台“普通用户”角色由后端自动生成；CSV 中非空的应用角色按个人例外授权处理并更新授权版本。
          </p>
          <p class="iam-field-help">导入后可在“用户”列表刷新查看，也可在“登录账号”中按需补建本地账号。</p>
        </div>
        <div v-else class="iam-batch-import-result">
          <span class="iam-batch-import-result-icon danger"><ConsoleIcon name="info" /></span>
          <h4>没有可展示的导入结果</h4>
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
  width: min(1040px, 100%);
  max-height: min(900px, calc(100vh - 40px));
  overflow: hidden;
  border-color: #dce5f1;
  background: #fff;
}

.iam-batch-import-modal > header {
  align-items: center;
  padding: 24px 28px;
  background: linear-gradient(135deg, #fff 0%, #f8fbff 72%, #eef5ff 100%);
}

.iam-batch-import-heading {
  display: flex;
  align-items: center;
  gap: 14px;
}

.iam-batch-import-heading-icon {
  display: grid;
  width: 44px;
  height: 44px;
  flex: 0 0 auto;
  place-items: center;
  color: #fff;
  border-radius: 12px;
  background: linear-gradient(145deg, var(--brand-3, #3b82f6), var(--brand-1, #1e40af));
  box-shadow: 0 10px 24px rgba(37, 99, 235, .22);
}

.iam-batch-import-heading-icon svg { width: 22px; height: 22px; }
.iam-batch-import-heading h3 { margin-top: 4px !important; }
.iam-batch-import-heading small {
  display: block;
  margin-top: 5px;
  color: var(--ink-3, #475569);
  font-size: 12px;
  line-height: 1.5;
}

.iam-batch-import-steps {
  list-style: none;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  align-items: center;
  gap: 0;
  margin: 0;
  padding: 20px 28px 18px;
  color: var(--ink-4, #94a3b8);
  font-size: 12.5px;
  border-bottom: 1px solid var(--line-2, #eef0f4);
  background: #fff;
}
.iam-batch-import-steps li {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
}
.iam-batch-import-steps li:not(:last-child)::after {
  content: '';
  height: 1px;
  flex: 1;
  margin: 0 14px 0 6px;
  background: var(--line-1, #e6e9ef);
}
.iam-batch-import-steps li.done:not(:last-child)::after { background: #93b4f8; }
.iam-batch-import-steps li b {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  flex: 0 0 auto;
  border-radius: 999px;
  border: 1px solid var(--line-1, #e6e9ef);
  background: var(--bg-soft, #fafbfd);
  color: var(--ink-4, #94a3b8);
  font-size: 12px;
  font-weight: 700;
}
.iam-batch-import-steps li.active b {
  background: var(--brand-1, #2563eb);
  border-color: var(--brand-1, #2563eb);
  color: #fff;
  box-shadow: 0 0 0 4px rgba(37, 99, 235, .1);
}
.iam-batch-import-steps li.done b {
  color: var(--brand-1, #1e40af);
  border-color: #bfdbfe;
  background: var(--brand-soft, #eff6ff);
}
.iam-batch-import-steps li.active { color: var(--ink-1, #111827); }

.iam-batch-import-body {
  min-height: 0;
  max-height: calc(100vh - 275px);
  padding: 24px 28px 6px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  overflow: auto;
}

.iam-batch-import-guide {
  align-items: center;
  padding: 12px 14px;
  color: #3f5574;
  border-color: #dbe7f7;
  background: #f6f9fe;
}

.iam-batch-import-guide code { white-space: nowrap; }

.iam-batch-import-guide > svg {
  width: 18px;
  height: 18px;
}

.iam-batch-import-dropzone {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 9px;
  min-height: 210px;
  padding: 34px 24px;
  border: 1.5px dashed #b9cce7;
  border-radius: 14px;
  background: linear-gradient(180deg, #fbfdff 0%, #f5f8fd 100%);
  color: var(--ink-2, #374151);
  cursor: pointer;
  transition: border-color 160ms, background 160ms, box-shadow 160ms, transform 160ms;
}
.iam-batch-import-dropzone:hover,
.iam-batch-import-dropzone:focus,
.iam-batch-import-dropzone.over {
  border-color: var(--brand-1, #2563eb);
  background: var(--brand-soft, #eef4ff);
  outline: none;
  box-shadow: inset 0 0 0 1px rgba(37, 99, 235, .08), 0 10px 30px rgba(37, 99, 235, .07);
  transform: translateY(-1px);
}
.iam-batch-import-upload-icon {
  display: grid;
  width: 52px;
  height: 52px;
  margin-bottom: 4px;
  place-items: center;
  color: var(--brand-2, #2563eb);
  border: 1px solid #d5e3fb;
  border-radius: 14px;
  background: #fff;
  box-shadow: 0 8px 22px rgba(37, 99, 235, .12);
}
.iam-batch-import-upload-icon svg { width: 25px; height: 25px; }
.iam-batch-import-dropzone strong { color: var(--ink-1, #0a0f1c); font-size: 15px; }
.iam-batch-import-dropzone small { color: var(--ink-3, #475569); font-size: 12.5px; }
.iam-batch-import-dropzone small b { color: var(--brand-2, #2563eb); font-weight: 600; }
.iam-batch-import-dropzone em { color: var(--ink-4, #94a3b8); font-size: 11.5px; font-style: normal; }
.iam-batch-import-dropzone code {
  background: #fff;
  border: 1px solid #dce5f1;
  border-radius: 4px;
  padding: 0 4px;
  font-size: 11.5px;
}

.iam-batch-import-error {
  background: var(--danger-soft, #fef2f2);
  border: 1px solid #fecaca;
  color: #b91c1c;
  padding: 12px 14px;
  border-radius: 10px;
  font-size: 13px;
}

.iam-batch-import-sample {
  display: flex;
  gap: 20px;
  align-items: flex-start;
  padding: 16px 18px;
  background: var(--bg-soft, #fafbfd);
  border: 1px solid var(--line-1, #e6e9ef);
  border-radius: 12px;
}
.iam-batch-import-sample-copy { min-width: 0; flex: 1; }
.iam-batch-import-sample-title { display: flex; align-items: center; gap: 7px; }
.iam-batch-import-sample-title svg { width: 16px; height: 16px; color: var(--brand-2, #2563eb); }
.iam-batch-import-sample strong { color: var(--ink-1, #0a0f1c); font-size: 13px; }
.iam-batch-import-sample p { margin: 6px 0 10px; color: var(--ink-3, #475569); font-size: 12px; }
.iam-batch-import-sample pre {
  margin: 0;
  background: #101827;
  border: 1px solid #26344a;
  border-radius: 8px;
  padding: 11px 13px;
  font-size: 11.5px;
  overflow-x: auto;
  color: #d7e5f7;
  line-height: 1.65;
}

.iam-batch-import-summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  padding: 14px 16px;
  background: linear-gradient(135deg, #fbfdff, #f5f8fd);
  border: 1px solid var(--line-1, #e6e9ef);
  border-radius: 12px;
}
.iam-batch-import-file { display: flex; align-items: center; gap: 11px; min-width: 0; }
.iam-batch-import-file > span {
  display: grid;
  width: 36px;
  height: 36px;
  flex: 0 0 auto;
  place-items: center;
  color: var(--brand-2, #2563eb);
  border: 1px solid #d7e4f7;
  border-radius: 9px;
  background: #fff;
}
.iam-batch-import-file > span svg { width: 18px; height: 18px; }
.iam-batch-import-file > div { min-width: 0; }
.iam-batch-import-file strong {
  display: block;
  max-width: 390px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.iam-batch-import-summary strong { color: var(--ink-1, #0a0f1c); font-size: 13px; }
.iam-batch-import-summary small { display: block; color: var(--ink-3, #6b7280); font-size: 12px; margin-top: 2px; }
.iam-batch-import-stats { display: flex; gap: 8px; }
.iam-batch-import-stats .stat {
  display: grid;
  grid-template-columns: auto auto;
  align-items: baseline;
  gap: 3px 6px;
  min-width: 72px;
  padding: 8px 10px;
  border-radius: 9px;
  background: #fff;
  border: 1px solid var(--line-1, #e6e9ef);
}
.iam-batch-import-stats .stat b { font-size: 17px; line-height: 1; }
.iam-batch-import-stats .stat small { margin: 0; font-size: 11px; color: var(--ink-3, #6b7280); }
.iam-batch-import-stats .stat.valid b { color: #15803d; }
.iam-batch-import-stats .stat.invalid b { color: #b91c1c; }
.iam-batch-import-stats .stat.selected b { color: var(--brand-1, #2563eb); }

.iam-batch-import-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  padding: 2px 0;
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
  min-height: 32px;
  padding: 4px 30px 4px 9px;
  color: var(--ink-2, #1e293b);
  border: 1px solid var(--line-1, #e6e9ef);
  border-radius: 8px;
  background: #fff;
}
.iam-batch-import-filter select:focus {
  border-color: var(--brand-2, #2563eb);
  outline: 0;
  box-shadow: 0 0 0 3px rgba(37, 99, 235, .1);
}

.iam-batch-import-table-wrap {
  border: 1px solid var(--line-1, #e6e9ef);
  border-radius: 12px;
  overflow: auto;
  max-height: min(480px, calc(100vh - 360px));
  box-shadow: 0 4px 16px rgba(15, 23, 42, .035);
}
.iam-batch-import-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12.5px;
}
.iam-batch-import-table thead th {
  position: sticky;
  top: 0;
  z-index: 1;
  background: #f5f8fc;
  text-align: left;
  font-weight: 600;
  color: var(--ink-2, #374151);
  padding: 11px 12px;
  border-bottom: 1px solid var(--line-1, #e6e9ef);
  white-space: nowrap;
}
.iam-batch-import-table tbody td {
  padding: 10px 12px;
  border-bottom: 1px solid var(--line-2, #e5e7eb);
  color: var(--ink-2, #374151);
  vertical-align: middle;
}
.iam-batch-import-table tbody tr { transition: background 140ms; }
.iam-batch-import-table tbody tr:hover:not(.invalid):not(.failed) { background: #f8fbff; }
.iam-batch-import-table tbody tr:last-child td { border-bottom: 0; }
.iam-batch-import-table tbody tr.invalid { background: #fff8f8; }
.iam-batch-import-table tbody tr.success { background: #f0fdf4; }
.iam-batch-import-table tbody tr.failed { background: #fff8f8; }
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
  padding: 4px 8px;
  border-radius: 999px;
}
.iam-batch-import-table .badge svg { width: 12px; height: 12px; }
.iam-batch-import-table .badge.ok { background: #dcfce7; color: #15803d; }
.iam-batch-import-table .badge.bad { background: #fee2e2; color: #b91c1c; }
.iam-batch-import-table .badge small { font-weight: 500; opacity: 0.85; margin-left: 2px; }

.iam-batch-import-result {
  display: flex;
  min-height: 300px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 30px;
  text-align: center;
}
.iam-batch-import-result-icon {
  display: grid;
  width: 58px;
  height: 58px;
  place-items: center;
  border-radius: 50%;
}
.iam-batch-import-result-icon svg { width: 28px; height: 28px; }
.iam-batch-import-result-icon.success { color: var(--ok-1, #047857); background: var(--ok-soft, #ecfdf5); }
.iam-batch-import-result-icon.danger { color: var(--danger-1, #b91c1c); background: var(--danger-soft, #fef2f2); }
.iam-batch-import-result h4 { margin: 2px 0 6px; color: var(--ink-1, #0a0f1c); font-size: 18px; }
.iam-batch-import-result .iam-form-alert { width: min(620px, 100%); justify-content: center; }
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

.iam-batch-import-modal > footer {
  position: sticky;
  bottom: 0;
  margin-top: 18px;
  background: rgba(255, 255, 255, .96);
  backdrop-filter: blur(8px);
}

@media (max-width: 760px) {
  .iam-batch-import-modal { width: 100%; }
  .iam-batch-import-modal > header { padding: 20px; }
  .iam-batch-import-heading-icon { display: none; }
  .iam-batch-import-body { padding: 18px 20px 4px; }
  .iam-batch-import-steps { padding: 16px 20px; }
  .iam-batch-import-steps li { gap: 6px; }
  .iam-batch-import-steps li:not(:last-child)::after { margin-inline: 6px; }
  .iam-batch-import-steps li span { font-size: 11.5px; }
  .iam-batch-import-dropzone { min-height: 180px; padding: 28px 16px; }
  .iam-batch-import-sample { flex-direction: column; }
  .iam-batch-import-summary { flex-direction: column; align-items: flex-start; }
  .iam-batch-import-stats { width: 100%; }
  .iam-batch-import-stats .stat { flex: 1; }
  .iam-batch-import-table .col-status { width: auto; }
  .iam-batch-import-modal > footer { flex-wrap: wrap; padding-inline: 20px; }
}

@media (max-width: 480px) {
  .iam-batch-import-steps li:not(:last-child)::after { display: none; }
  .iam-batch-import-steps { gap: 8px; }
  .iam-batch-import-steps li { justify-content: center; }
  .iam-batch-import-steps li span { display: none; }
  .iam-batch-import-toolbar-left,
  .iam-batch-import-toolbar-right { width: 100%; }
}
</style>
