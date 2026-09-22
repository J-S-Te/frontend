import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const consoleSource = await readFile(new URL('./platform/views/PlatformConsoleView.vue', import.meta.url), 'utf8')
const moduleSource = await readFile(new URL('./platform/files/components/FileTaskOperationsModule.vue', import.meta.url), 'utf8')

test('异步任务入口不再伪装成全局文件管理器', () => {
  assert.match(consoleSource, /key: 'jobs', label: '异步任务'/)
  assert.doesNotMatch(consoleSource, /key: 'jobs', label: '文件与任务'/)
  assert.match(moduleSource, /文件，请在对应业务页面上传或下载/)
  assert.match(moduleSource, /文件网关/)
})

test('异步任务操作和创建区域按服务端权限失败关闭', () => {
  assert.match(moduleSource, /v-if="canCreate" class="filetask-card filetask-card--job-create"/)
  assert.match(moduleSource, /v-if="canRead" class="filetask-card filetask-card--jobs"/)
  assert.match(moduleSource, /v-if="canCancel && \['PENDING','FAILED','DEAD'\]\.includes\(job\.status\)"/)
  assert.match(moduleSource, /v-if="canRetry && \['FAILED','DEAD'\]\.includes\(job\.status\)"/)
  assert.match(moduleSource, /v-if="canRerun && \['SUCCEEDED','FAILED','DEAD','CANCELLED'\]\.includes\(job\.status\)"/)
})

test('任务状态使用中文业务文案', () => {
  for (const label of ['等待执行', '执行中', '已成功', '执行失败', '已终止', '已取消']) {
    assert.match(moduleSource, new RegExp(label))
  }
  assert.match(moduleSource, /statusText\(job\.status\)/)
})
