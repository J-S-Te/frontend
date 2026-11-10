<script setup>
import { ref } from 'vue'
import { reimbursementAPI as api, publicPrefix } from '../api/reimbursement.js'
import { createCommandRunner } from '../api/client.js'

const props = defineProps({ archives: { type: Object, default: null } })
const jobs = ref({})
const busy = ref(false)
const error = ref('')
const pending = ref(null)
const runner = createCommandRunner(api)

// 用途：把任务状态枚举转成操作者能理解的文案，过期下载包不显示成原始枚举。
// 参数：status 为服务端返回的任务状态码。
// 返回值：中文文案；未知状态原样返回。
function jobStatusText(status) {
  if (status === 'EXPIRED') return '已过期，请重新生成'
  if (status === 'DONE') return '已完成'
  if (status === 'FAILED') return '生成失败'
  if (status === 'PROCESSING') return '生成中'
  if (status === 'PENDING') return '排队中'
  return status
}

// 用途：针对不可变封存版本排队生成档案包，不把排队状态当完成。
// 参数：archive 为服务器返回的封存版本。
// 返回值：无；保存原命令或真实异步任务。
async function generate(archive) {
  if (busy.value || pending.value) return
  busy.value = true; error.value = ''
  try {
    jobs.value[archive.id] = await runner.execute('archive.package.create',
      `/archives/${encodeURIComponent(archive.id)}/packages`, { expected_version: archive.package_version })
  } catch (cause) { error.value = cause.message }
  finally { pending.value = runner.pending(); busy.value = false }
}

// 用途：读取生成任务的实际状态和失败原因。
// 参数：archiveID 为当前所选封存版本。
// 返回值：无；服务端仍重新校验当前授权。
async function refresh(archiveID) {
  try { jobs.value[archiveID] = await api.request(`/archive-packages/${encodeURIComponent(jobs.value[archiveID].id)}`) }
  catch (cause) { error.value = cause.message }
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

// 用途：通过当前会话下载服务端重新授权并校验过的ZIP包。
// 参数：job 为已完成的生成任务。
// 返回值：无；失败显示公开原因，不拼接外部下载地址。
async function download(job) {
  busy.value = true; error.value = ''
  try {
    const response = await fetch(`${publicPrefix}/api/v1/archive-packages/${encodeURIComponent(job.id)}/download`,
      { method: 'POST', credentials: 'include', headers: { 'X-CSRF-Token': '1' }, signal: AbortSignal.timeout(60000) })
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
    <p v-if="error" role="alert">{{ error }}</p>
    <div v-for="archive in props.archives?.items || []" :key="archive.id">
      <span>档案版本 {{ archive.package_version }} · {{ archive.status }}</span>
      <button v-if="archive.status === 'SEALED'" class="expense-button" :disabled="busy || !!pending" @click="generate(archive)">生成文件包</button>
      <template v-if="jobs[archive.id]">
        <span>任务 {{ jobStatusText(jobs[archive.id].status) }} · {{ jobs[archive.id].last_error || '' }}</span>
        <button class="expense-button" :disabled="busy" @click="refresh(archive.id)">查询生成状态</button>
        <button v-if="jobs[archive.id].status === 'DONE'" class="expense-button" :disabled="busy" @click="download(jobs[archive.id])">下载证据包</button>
      </template>
    </div>
    <button v-if="pending" class="expense-button" :disabled="busy" @click="retry">确认并重试原建包命令</button>
  </article>
</template>
