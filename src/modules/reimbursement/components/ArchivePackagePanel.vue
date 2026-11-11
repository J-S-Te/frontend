<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { reimbursementAPI as api, publicPrefix } from '../api/reimbursement.js'
import { createCommandRunner, timeoutSignal } from '../api/client.js'
import { claimStatusLabel as statusLabel, failureMessage } from '../statusLabels.js'
import { pollTask, taskSettled } from '../asyncTask.js'
import { recallTask, rememberTask, savedAtLabel } from '../taskPersistence.js'
import ErrorState from '../../shared/components/ErrorState.vue'

const props = defineProps({ archives: { type: Object, default: null } })
const jobs = ref({})
const busy = ref(false)
const error = ref('')
const pending = ref(null)
const notice = ref('')
// 上次生成的文件包任务：刷新页面后任务号不再只存在于内存里。
const restored = ref(null)
const restoredLabel = ref('')
const runner = createCommandRunner(api)
let pollSequence = 0

// 用途：记住最近一次证据包任务号，供刷新后找回。
// 参数：archive 为封存版本，job 为服务端返回的任务。
// 返回值：无；存储不可用时静默忽略。
function remember(job, archiveID = '') {
  if (!job?.id) return
  const record = { task_id: String(job.id), archive_id: String(archiveID || ''), status: String(job.status || '') }
  if (rememberTask('archive', record)) {
    restored.value = { ...record, saved_at: Date.now() }
    restoredLabel.value = '刚刚'
  }
}

// 用途：继续查询上次生成的文件包任务，避免刷新后重复建包。
// 参数：无。
// 返回值：无；失败显示公开原因并保留任务号。
async function resume() {
  const saved = restored.value
  if (!saved?.task_id || busy.value) return
  busy.value = true; error.value = ''
  try {
    const job = await api.request(`/archive-packages/${encodeURIComponent(saved.task_id)}`)
    if (saved.archive_id) jobs.value[saved.archive_id] = job
    restored.value = { ...saved, status: String(job?.status || saved.status || '') }
    remember(job, saved.archive_id)
    applyJobNotice(job)
  } catch (cause) { error.value = cause.message }
  finally { pending.value = runner.pending(); busy.value = false }
}

onMounted(() => {
  const saved = recallTask('archive')
  if (!saved?.task_id) return
  restored.value = saved
  restoredLabel.value = savedAtLabel(saved.saved_at)
})

// 用途：把任务状态枚举转成操作者能理解的文案，过期下载包不显示成原始枚举。
// 参数：status 为服务端返回的任务状态码。
// 返回值：中文文案；未知状态显示待确认，不回显机器码。
function jobStatusText(status) {
  if (status === 'EXPIRED') return '已过期，请重新生成'
  if (status === 'DONE') return '已完成'
  if (status === 'FAILED') return '生成失败'
  if (status === 'PROCESSING') return '生成中'
  if (status === 'PENDING') return '排队中'
  return '状态待确认'
}

// 用途：把任务终态转成可读提示，完成与失败都能被用户看到。
// 参数：job 为最近一次读取到的任务。
// 返回值：无。
function applyJobNotice(job) {
  if (!taskSettled(job?.status)) return
  notice.value = job.status === 'DONE'
    ? '证据包已生成，可下载。'
    : `证据包未生成：${failureMessage(job.last_error)}`
}

// 用途：建包后自动短轮询，避免用户反复手点查询。
// 参数：archiveID 为封存版本标识。
// 返回值：无；页面卸载或切换后停止更新。
async function autoRefresh(archiveID) {
  const ticket = ++pollSequence
  const jobID = jobs.value[archiveID]?.id
  if (!jobID) return
  try {
    const final = await pollTask(async () => {
      const job = await api.request(`/archive-packages/${encodeURIComponent(jobID)}`)
      if (!job || typeof job.status !== 'string') return job
      if (ticket === pollSequence) jobs.value[archiveID] = job
      return job
    }, {
      attempts: 5,
      delay: 2000,
      shouldContinue: () => ticket === pollSequence,
      onValue: (job) => { if (ticket === pollSequence) applyJobNotice(job) },
    })
    if (final?.status && !taskSettled(final.status) && ticket === pollSequence) {
      notice.value = '证据包仍在生成中；可稍后点击查询生成状态。'
    }
  } catch (cause) {
    if (ticket === pollSequence) error.value = cause.message
  }
}

// 用途：针对不可变封存版本排队生成档案包，不把排队状态当完成。
// 参数：archive 为服务器返回的封存版本。
// 返回值：无；保存原命令或真实异步任务。
async function generate(archive) {
  if (busy.value || pending.value) return
  busy.value = true; error.value = ''; notice.value = ''
  try {
    const job = await runner.execute('archive.package.create',
      `/archives/${encodeURIComponent(archive.id)}/packages`, { expected_version: archive.package_version })
    jobs.value[archive.id] = job
    remember(job, archive.id)
    if (job?.status) await autoRefresh(archive.id)
  } catch (cause) { error.value = cause.message }
  finally { pending.value = runner.pending(); busy.value = false }
}

// 用途：读取生成任务的实际状态和失败原因。
// 参数：archiveID 为当前所选封存版本。
// 返回值：无；服务端仍重新校验当前授权。
async function refresh(archiveID) {
  try {
    const job = await api.request(`/archive-packages/${encodeURIComponent(jobs.value[archiveID].id)}`)
    jobs.value[archiveID] = job
    applyJobNotice(job)
  } catch (cause) { error.value = cause.message }
}

// 用途：用原命令恢复未知建包结果，避免新建重复任务。
// 参数：无。
// 返回值：无；未确认时保留原命令。
async function retry() {
  busy.value = true
  try {
    const id = pending.value.path.split('/')[2]
    jobs.value[id] = await runner.retry()
  } catch (cause) { error.value = cause.message }
  finally { pending.value = runner.pending(); busy.value = false }
}

onBeforeUnmount(() => { ++pollSequence })

// 用途：通过当前会话下载服务端重新授权并校验过的ZIP包。
// 参数：job 为已完成的生成任务。
// 返回值：无；失败显示公开原因，不拼接外部下载地址。
async function download(job) {
  busy.value = true; error.value = ''
  try {
    const response = await fetch(`${publicPrefix}/api/v1/archive-packages/${encodeURIComponent(job.id)}/download`,
      { method: 'POST', credentials: 'include', headers: { 'X-CSRF-Token': '1' }, signal: timeoutSignal(60000) })
    if (!response.ok) {
      const body = await response.json().catch(() => ({}))
      throw new Error(body.message || '档案包下载失败')
    }
    if (!response.headers.get('content-type')?.includes('application/zip')) throw new Error('档案包响应格式不正确')
    const url = URL.createObjectURL(await response.blob())
    const link = document.createElement('a'); link.href = url; link.download = `reimbursement-archive-${job.id}.zip`
    link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
  } catch (cause) { error.value = cause.message }
  finally { busy.value = false }
}
</script>

<template>
  <article class="expense-item">
    <h3>按封存版本生成证据包</h3>
    <p>文件包包含不可变清单及逐份校验的原件；单包上限20MiB，原件合计上限100MiB。下载时再次核验当前授权。</p>
    <ErrorState v-if="error" compact title="证据包操作未完成" :error="error" :retry="false" />
    <p v-if="notice" role="status">{{ notice }}</p>
    <div v-for="archive in props.archives?.items || []" :key="archive.id">
      <span>档案版本 {{ archive.package_version }} · {{ statusLabel(archive.status) }}</span>
      <button v-if="archive.status === 'SEALED'" class="expense-button" :disabled="busy || !!pending" @click="generate(archive)">生成文件包</button>
      <template v-if="jobs[archive.id]">
        <span>任务 {{ jobStatusText(jobs[archive.id].status) }}<template v-if="jobs[archive.id].last_error"> · {{ failureMessage(jobs[archive.id].last_error) }}</template></span>
        <button class="expense-button" :disabled="busy" @click="refresh(archive.id)">查询生成状态</button>
        <button v-if="jobs[archive.id].status === 'FAILED'" class="expense-button" :disabled="busy || !!pending" @click="generate(archive)">重试生成</button>
        <button v-if="jobs[archive.id].status === 'DONE'" class="expense-button" :disabled="busy" @click="download(jobs[archive.id])">下载证据包</button>
      </template>
    </div>
    <button v-if="pending" class="expense-button" :disabled="busy" @click="retry">确认并重试原建包命令</button>
    <!-- 刷新页面后任务号仍在：给出继续查询入口，避免重新建包。 -->
    <div v-if="restored" role="status">
      <span>上次生成任务 {{ restored.task_id }} · {{ jobStatusText(restored.status) }}<template v-if="restoredLabel"> · {{ restoredLabel }}保存</template></span>
      <button class="expense-button" :disabled="busy" @click="resume">继续查询上次任务</button>
    </div>
  </article>
</template>
