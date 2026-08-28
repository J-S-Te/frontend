<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import ConsoleIcon from '@/modules/platform/shared/components/ConsoleIcon.vue'
import {
  FileTaskError,
  cancelAsyncJob,
  createAsyncJob,
  listAsyncJobs,
  rerunAsyncJob,
  retryAsyncJob,
} from '@/modules/platform/files/api/fileTasks'
import '@/modules/platform/files/styles/file-task-operations.css'

const emit = defineEmits(['toast'])

const loading = ref(false)
const actionJobId = ref('')
const errorMessage = ref('')
const jobs = ref([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)

const filters = reactive({ status: '', jobType: '', applicationId: '', query: '' })
const jobForm = reactive({ applicationId: '', jobType: '', aggregateType: '', aggregateId: '', payloadText: '{\n  \n}', priority: 100, maxAttempts: 3 })

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)))

function toast(message) { emit('toast', message) }
function formatDate(value) { const date = new Date(value); return value && !Number.isNaN(date.getTime()) ? date.toLocaleString('zh-CN', { hour12: false }) : '—' }
function statusClass(status) { return `filetask-status--${String(status || '').toLowerCase()}` }
function normalizeError(error, fallback) { return error instanceof FileTaskError ? error.message : fallback }

async function loadJobs() {
  loading.value = true; errorMessage.value = ''
  try {
    const result = await listAsyncJobs({ ...filters, page: page.value, pageSize: pageSize.value })
    jobs.value = Array.isArray(result?.items) ? result.items : []; total.value = Number(result?.total || 0)
  } catch (error) { errorMessage.value = normalizeError(error, '异步任务查询失败。') } finally { loading.value = false }
}

async function createJob() {
  let payload
  // 这里只验证 JSON 语法；任务类型白名单、负载模式和“不得含凭据”仍由服务端执行权威校验。
  try { payload = JSON.parse(jobForm.payloadText) } catch { errorMessage.value = '任务负载必须是有效 JSON，且不得包含密码、密钥或令牌。'; return }
  errorMessage.value = ''
  try {
    const job = await createAsyncJob({ applicationId: jobForm.applicationId.trim(), jobType: jobForm.jobType.trim(), aggregateType: jobForm.aggregateType.trim(), aggregateId: jobForm.aggregateId.trim(), payload, priority: Number(jobForm.priority), maxAttempts: Number(jobForm.maxAttempts) })
    toast(`异步任务 ${job.job_id || ''} 已创建。`); await loadJobs()
  } catch (error) { errorMessage.value = normalizeError(error, '创建异步任务失败。') }
}

async function operateJob(job, operation) {
  if (!job?.job_id || actionJobId.value) return
  actionJobId.value = job.job_id; errorMessage.value = ''
  try {
    // retry 复用原任务并重新入队，rerun 创建新记录；二者语义不同，不能在前端合并成同一操作。
    if (operation === 'cancel') await cancelAsyncJob(job.job_id)
    if (operation === 'retry') await retryAsyncJob(job.job_id)
    if (operation === 'rerun') await rerunAsyncJob(job.job_id)
    toast(operation === 'cancel' ? '任务已取消。' : operation === 'retry' ? '任务已重新入队。' : '已创建新的重跑任务。'); await loadJobs()
  } catch (error) { errorMessage.value = normalizeError(error, '任务操作失败。') } finally { actionJobId.value = '' }
}

function changePage(next) { page.value = Math.min(Math.max(next, 1), totalPages.value); loadJobs() }
onMounted(loadJobs)
</script>

<template>
  <section class="filetask-module" aria-labelledby="filetask-heading">
    <header class="filetask-module__header"><div><span class="filetask-module__eyebrow">MYSQL JOBS</span><h2 id="filetask-heading">异步任务</h2><p>文件上传、下载、清理和对账已经迁移至独立 File Gateway；平台控制台仅保留异步任务运营能力。</p></div><button class="console-button ghost" type="button" :disabled="loading" @click="loadJobs"><ConsoleIcon name="reset" /> 刷新任务</button></header>
    <p v-if="errorMessage" class="filetask-module__error">{{ errorMessage }}</p>
    <article class="filetask-card filetask-card--job-create"><header><ConsoleIcon name="info" /><div><h3>创建异步任务</h3><p>仅可创建已注册的任务类型。负载不得包含密码、Token、客户端密钥或原始文件内容。</p></div></header><div class="filetask-form-grid"><label><span>应用 ID</span><input v-model="jobForm.applicationId" placeholder="可选" /></label><label><span>任务类型</span><input v-model="jobForm.jobType" placeholder="例如 REPORT_EXPORT" /></label><label><span>聚合类型</span><input v-model="jobForm.aggregateType" placeholder="可选" /></label><label><span>聚合 ID</span><input v-model="jobForm.aggregateId" placeholder="可选" /></label><label><span>优先级</span><input v-model.number="jobForm.priority" type="number" /></label><label><span>最大尝试次数</span><input v-model.number="jobForm.maxAttempts" type="number" min="1" max="100" /></label></div><label><span>JSON 负载</span><textarea v-model="jobForm.payloadText" rows="5" spellcheck="false" /></label><div class="filetask-card__actions"><button class="console-button primary" type="button" @click="createJob">创建任务</button></div></article>
    <article class="filetask-card filetask-card--jobs"><header class="filetask-jobs__header"><div><h3>任务运营查询</h3><p>运行中的任务不可直接取消；失败任务可重试，终态任务可创建新的重跑记录。</p></div><div class="filetask-jobs__filters"><select v-model="filters.status" @change="page = 1; loadJobs()"><option value="">全部状态</option><option value="PENDING">等待</option><option value="RUNNING">运行中</option><option value="SUCCEEDED">成功</option><option value="FAILED">失败</option><option value="DEAD">死信</option><option value="CANCELLED">已取消</option></select><input v-model="filters.jobType" placeholder="任务类型" @keyup.enter="page = 1; loadJobs()" /><button class="console-button ghost small" type="button" @click="page = 1; loadJobs()">查询</button></div></header><div class="filetask-table-wrap"><table class="console-data-table filetask-table"><thead><tr><th>任务 ID</th><th>类型</th><th>状态</th><th>尝试</th><th>可执行时间</th><th>错误摘要</th><th>操作</th></tr></thead><tbody><tr v-if="loading"><td colspan="7">正在加载…</td></tr><tr v-else-if="!jobs.length"><td colspan="7">暂无任务记录。</td></tr><tr v-for="job in jobs" :key="job.job_id"><td><code>{{ job.job_id }}</code></td><td>{{ job.job_type }}</td><td><span class="filetask-status" :class="statusClass(job.status)">{{ job.status }}</span></td><td>{{ job.attempts }}/{{ job.max_attempts }}</td><td>{{ formatDate(job.available_at) }}</td><td>{{ job.last_error_message || '—' }}</td><td class="filetask-table__actions"><button v-if="['PENDING','FAILED','DEAD'].includes(job.status)" class="console-button ghost small" type="button" :disabled="Boolean(actionJobId)" @click="operateJob(job, 'cancel')">取消</button><button v-if="['FAILED','DEAD'].includes(job.status)" class="console-button ghost small" type="button" :disabled="Boolean(actionJobId)" @click="operateJob(job, 'retry')">重试</button><button v-if="['SUCCEEDED','FAILED','DEAD','CANCELLED'].includes(job.status)" class="console-button ghost small" type="button" :disabled="Boolean(actionJobId)" @click="operateJob(job, 'rerun')">重跑</button></td></tr></tbody></table></div><footer class="filetask-pagination"><span>共 {{ total }} 条</span><span><button class="console-button ghost small" type="button" :disabled="page <= 1" @click="changePage(page - 1)">上一页</button><strong>{{ page }} / {{ totalPages }}</strong><button class="console-button ghost small" type="button" :disabled="page >= totalPages" @click="changePage(page + 1)">下一页</button></span></footer></article>
  </section>
</template>
