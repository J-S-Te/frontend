<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { previewSubsystemAccessRecovery, abandonSubsystemAccessRecovery } from '../api/subsystemAccessRecovery.js'
import { buildManualRecoveryDecision } from '../utils/subsystemAccessRecovery.mjs'
import { formatUserError } from '../../../shared/utils/userError.js'

const props = defineProps({ operationId: { type: String, required: true } })
const emit = defineEmits(['resolved', 'refresh'])
const preview = ref(null), reason = ref(''), confirmed = ref(false)
const busy = ref(false), error = ref(''), resolved = ref(false)
let generation = 0, disposed = false
const canSubmit = computed(() => {
  if (busy.value || resolved.value) return false
  try { buildManualRecoveryDecision(preview.value, props.operationId, reason.value, confirmed.value); return true }
  catch { return false }
})

/** resetPanel 在目标变化时隔离旧响应与旧人工确认。
 * 参数：无，使用当前原操作属性。
 * 返回值：无，不取消已经明确提交的服务器决定。
 */
function resetPanel() {
  generation++; preview.value = null; reason.value = ''; confirmed.value = false
  busy.value = false; error.value = ''; resolved.value = false
}
watch(() => props.operationId, resetPanel)
onBeforeUnmount(() => { disposed = true; generation++ })

/** readPreview 读取真实核验，旧任务的迟到响应不进入当前表单。
 * 参数：无，仅使用当前原操作号。
 * 返回值：Promise<void>；不可核对时保持不可提交并显示错误。
 */
async function readPreview() {
  if (busy.value) return
  const id = props.operationId, current = ++generation
  busy.value = true; error.value = ''; preview.value = null; confirmed.value = false
  try {
    const value = await previewSubsystemAccessRecovery(id)
    if (disposed || current !== generation || props.operationId !== id) return
    if (value.operation_id !== id) throw new Error('返回的核验不属于当前操作，请重新查询。')
    preview.value = value
  } catch (failure) {
    if (!disposed && current === generation && props.operationId === id) {
      error.value = formatUserError(failure, '无法完成核验，请先查询原操作。')
    }
  } finally { if (!disposed && current === generation) busy.value = false }
}

/** submitDecision 只提交已核对的人工失败收口，绝不自动再次部署。
 * 参数：无，提交体仅来自当前预检和明确人工确认。
 * 返回值：Promise<void>；响应未知时要求先查询原操作。
 */
async function submitDecision() {
  if (!canSubmit.value) return
  const id = props.operationId, current = ++generation
  busy.value = true; error.value = ''
  try {
    const body = buildManualRecoveryDecision(preview.value, id, reason.value, confirmed.value)
    const value = await abandonSubsystemAccessRecovery(id, body)
    if (disposed || current !== generation || props.operationId !== id) return
    if (value.operation_id !== id || value.status !== 'FAILED' || value.error_code !== 'OPERATOR_ABANDONED') {
      throw new Error('未取得明确终止结果，请按原操作查询。')
    }
    resolved.value = true
    emit('resolved', value)
  } catch (failure) {
    if (!disposed && current === generation && props.operationId === id) {
      preview.value = null; confirmed.value = false
      error.value = `${formatUserError(failure, '终止结果尚未明确。')} 请先查询原操作，再重新核验。`
    }
  } finally { if (!disposed && current === generation) busy.value = false }
}
</script>

<template>
  <section class="manual-recovery" aria-label="未知部署人工恢复">
    <h4>未知部署人工恢复</h4>
    <p>原操作：<code>{{ operationId }}</code></p>
    <p>核对原请求已结束、原错误来源、运行文件和容器事实后，可终止原代次。终止不声明部署成功，也不自动回滚；之后仍需显式继续恢复。</p>
    <div class="manual-recovery__actions">
      <button type="button" :disabled="busy || resolved" @click="readPreview">读取人工恢复核验</button>
      <button type="button" :disabled="busy" @click="emit('refresh', operationId)">查询原操作状态</button>
    </div>
    <p v-if="error" role="alert" class="manual-recovery__error">{{ error }}</p>
    <template v-if="preview">
      <dl>
        <dt>目标</dt><dd>{{ preview.application_code }} / {{ preview.environment }}</dd>
        <dt>版本 / 代次</dt><dd>{{ preview.operation_version }} / {{ preview.generation }}</dd>
        <dt>当前错误</dt><dd>{{ preview.error_code }} · {{ preview.error_message }}</dd>
        <dt>清单</dt><dd><code>{{ preview.manifest_checksum }}</code></dd>
        <dt>事实摘要</dt><dd><code>{{ preview.evidence_digest }}</code></dd>
      </dl>
      <p v-if="preview.already_fenced" role="status">原代次已有持久终止栅栏，本次仅核对后收口平台记录。</p>
      <p>本页只展示当前快照，不包含原备份差异。请另行核对原操作备份，并在原因中记录结论；无法核实的变化仍按未知副作用保留。</p>
      <table>
        <caption>受控运行文件（仅当前存在性与摘要）</caption>
        <thead><tr><th>文件</th><th>状态</th><th>SHA256</th></tr></thead>
        <tbody><tr v-for="file in preview.runtime_files" :key="file.path">
          <td>{{ file.path }}</td><td>{{ file.present ? '存在' : '不存在' }}</td><td><code>{{ file.sha256 || '—' }}</code></td>
        </tr></tbody>
      </table>
      <table>
        <caption>当前选择服务的实际容器</caption>
        <thead><tr><th>服务 / 容器</th><th>镜像</th><th>运行 / 健康</th></tr></thead>
        <tbody><tr v-for="container in preview.containers" :key="`${container.service_id}/${container.container_id || ''}`">
          <td>{{ container.service_id }}<br><code>{{ container.container_id || '不存在' }}</code></td>
          <td><code>{{ container.image || '—' }}</code></td><td>{{ container.state || '不存在' }} / {{ container.health || '未提供' }}</td>
        </tr></tbody>
      </table>
      <label class="manual-recovery__reason">人工核对原因（10至500字，不填写密码或密钥）
        <textarea v-model="reason" :disabled="busy || resolved" maxlength="1000" rows="3" />
      </label>
      <label class="manual-recovery__confirm">
        <input v-model="confirmed" type="checkbox" :disabled="busy || resolved">
        我已核对原请求已结束、原错误来源、原操作备份及现场事实，确认仅终止原代次，保留未知副作用，随后另行重试。
      </label>
      <button type="button" class="manual-recovery__terminate" :disabled="!canSubmit" @click="submitDecision">确认终止原代次</button>
    </template>
    <p v-if="resolved" role="status">原代次已终止为失败；尚未再次部署，请显式继续恢复。</p>
  </section>
</template>

<style scoped>
.manual-recovery { margin-top: 18px; padding: 18px; border: 1px solid #e9c98a; border-radius: 12px; background: #fffcf5; color: #342e25; }
.manual-recovery h4 { margin: 0 0 10px; }
.manual-recovery p { line-height: 1.6; }
.manual-recovery__actions { display: flex; gap: 10px; flex-wrap: wrap; }
.manual-recovery button { padding: 8px 12px; border: 1px solid #c8b99e; border-radius: 7px; background: white; cursor: pointer; }
.manual-recovery button:disabled { opacity: .5; cursor: not-allowed; }
.manual-recovery dl { display: grid; grid-template-columns: 110px minmax(0, 1fr); gap: 8px; }
.manual-recovery dd { margin: 0; overflow-wrap: anywhere; }
.manual-recovery table { width: 100%; table-layout: fixed; border-collapse: collapse; margin: 14px 0; }
.manual-recovery caption { text-align: left; font-weight: 600; padding: 6px 0; }
.manual-recovery th, .manual-recovery td { padding: 8px; border: 1px solid #e4daca; text-align: left; overflow-wrap: anywhere; }
.manual-recovery code { overflow-wrap: anywhere; font-size: .86em; }
.manual-recovery__reason { display: grid; gap: 6px; margin: 14px 0; }
.manual-recovery textarea { width: 100%; box-sizing: border-box; padding: 10px; border: 1px solid #c8b99e; border-radius: 7px; }
.manual-recovery__confirm { display: flex; align-items: flex-start; gap: 8px; margin: 12px 0; }
.manual-recovery .manual-recovery__terminate { color: #8f2929; border-color: #d99898; }
.manual-recovery__error { color: #9f2222; }
</style>
