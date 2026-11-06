<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { previewSubsystemAccessRecovery, abandonSubsystemAccessRecovery } from '../api/subsystemAccessRecovery.js'
import {
  MANUAL_RECOVERY_MODE,
  buildManualRecoveryDecision,
  isSupersededRecovery,
} from '../utils/subsystemAccessRecovery.mjs'
import { formatUserError } from '../../../shared/utils/userError.js'

const props = defineProps({ operationId: { type: String, required: true } })
const emit = defineEmits(['resolved', 'refresh'])
const root = ref(null)
const preview = ref(null), reason = ref(''), confirmed = ref(false), confirmedSuperseded = ref(false)
const busy = ref(false), error = ref(''), resolved = ref(false)
let generation = 0, disposed = false

// 恢复模式决定本页展示哪一套事实、要求几次确认、以及最终的失败收口码。
const superseded = computed(() => isSupersededRecovery(preview.value))
const modeLabel = computed(() => (superseded.value ? '审核基准已变更' : '审核基准未变更'))
const modeKey = computed(() => (superseded.value ? MANUAL_RECOVERY_MODE.SUPERSEDED : MANUAL_RECOVERY_MODE.FENCED))
const receiptChecksum = computed(() => String(preview.value?.receipt_manifest_checksum || preview.value?.manifest_checksum || ''))
const currentChecksum = computed(() => String(preview.value?.current_profile_checksum || preview.value?.manifest_checksum || ''))
const checksumsDiffer = computed(() => Boolean(receiptChecksum.value) && Boolean(currentChecksum.value)
  && receiptChecksum.value !== currentChecksum.value)
const terminalErrorCode = computed(() => (superseded.value ? 'DEPLOYMENT_SUPERSEDED_UNKNOWN' : 'OPERATOR_ABANDONED'))
const resolvedMessage = computed(() => (superseded.value
  ? '原代次已按「已被取代」收口为失败；未声明部署成功，也未回滚。请另行显式继续恢复。'
  : '原代次已终止为失败；尚未再次部署，请显式继续恢复。'))

const canSubmit = computed(() => {
  if (busy.value || resolved.value) return false
  try {
    buildManualRecoveryDecision(
      preview.value, props.operationId, reason.value, confirmed.value, confirmedSuperseded.value)
    return true
  } catch { return false }
})

/** resetPanel 在目标变化时隔离旧响应与旧人工确认。
 * 参数：无，使用当前原操作属性。
 * 返回值：无，不取消已经明确提交的服务器决定。
 */
function resetPanel() {
  generation++; preview.value = null; reason.value = ''; confirmed.value = false; confirmedSuperseded.value = false
  busy.value = false; error.value = ''; resolved.value = false
}
watch(() => props.operationId, resetPanel)
onBeforeUnmount(() => { disposed = true; generation++ })

/** bringIntoView 把人工核验面板滚到视野内，减少操作者在长页面里找入口。
 * 参数：无，直接操作自身根节点。
 * 返回值：无。
 */
function bringIntoView() {
  const node = root.value
  if (!node || typeof node.scrollIntoView !== 'function') return
  const reduceMotion = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  // 面板通常比视口高：对齐顶部才能看到标题与第一屏事实（'nearest' 只保证"露出一角"）。
  node.scrollIntoView({ block: 'start', behavior: reduceMotion ? 'auto' : 'smooth' })
}

/** startReview 是向导「前往人工核验」的落点：定位到本面板并读取核验。
 * 参数：无。
 * 返回值：Promise<void>；已有核验或正在提交时不重复发起读取。
 */
async function startReview() {
  bringIntoView()
  if (preview.value || busy.value || resolved.value) return
  await readPreview()
  // 预检会显著拉长面板：读取前滚动会被"已到内容底部"截断，等渲染完成后重新对齐一次。
  await nextTick()
  bringIntoView()
}
defineExpose({ startReview })

/** readPreview 读取真实核验，旧任务的迟到响应不进入当前表单。
 * 参数：无，仅使用当前原操作号。
 * 返回值：Promise<void>；不可核对时保持不可提交并显示错误。
 */
async function readPreview() {
  if (busy.value) return
  const id = props.operationId, current = ++generation
  busy.value = true; error.value = ''; preview.value = null
  confirmed.value = false; confirmedSuperseded.value = false
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
    const body = buildManualRecoveryDecision(
      preview.value, id, reason.value, confirmed.value, confirmedSuperseded.value)
    const value = await abandonSubsystemAccessRecovery(id, body)
    if (disposed || current !== generation || props.operationId !== id) return
    if (value.operation_id !== id || value.status !== 'FAILED' || value.error_code !== terminalErrorCode.value) {
      throw new Error('未取得明确终止结果，请按原操作查询。')
    }
    resolved.value = true
    emit('resolved', value)
  } catch (failure) {
    if (!disposed && current === generation && props.operationId === id) {
      preview.value = null; confirmed.value = false; confirmedSuperseded.value = false
      error.value = `${formatUserError(failure, '终止结果尚未明确。')} 请先查询原操作，再重新核验。`
    }
  } finally { if (!disposed && current === generation) busy.value = false }
}
</script>

<template>
  <section ref="root" class="manual-recovery" aria-label="未知部署人工恢复">
    <header class="manual-recovery__head">
      <h4>未知部署人工恢复</h4>
      <span v-if="preview" class="manual-recovery__mode" :data-mode="modeKey">{{ modeLabel }}</span>
    </header>
    <p>原操作：<code>{{ operationId }}</code></p>
    <p>核对原请求已结束、原错误来源与清单基准后，可终止原代次。终止不声明部署成功，也不自动回滚；之后仍需显式继续恢复。</p>
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
        <template v-if="!superseded">
          <dt>事实摘要</dt><dd><code>{{ preview.evidence_digest || '—' }}</code></dd>
        </template>
        <dt>收口后错误码</dt><dd><code>{{ terminalErrorCode }}</code></dd>
      </dl>

      <div class="manual-recovery__compare" :data-mode="modeKey" role="group" aria-label="清单校验和比对">
        <div class="manual-recovery__checksum">
          <span class="manual-recovery__checksum-label">原清单校验和（派发回执）</span>
          <code>{{ receiptChecksum || '—' }}</code>
        </div>
        <span class="manual-recovery__compare-op" aria-hidden="true">{{ checksumsDiffer ? '≠' : '=' }}</span>
        <div class="manual-recovery__checksum">
          <span class="manual-recovery__checksum-label">当前清单校验和（当前 profile）</span>
          <code>{{ currentChecksum || '—' }}</code>
        </div>
      </div>
      <p class="manual-recovery__compare-note" :data-mode="modeKey">
        <template v-if="checksumsDiffer">两份校验和不同：原代次派发时的审核清单已被新的发布流程替换。请逐字核对上面两段校验和后再确认收口。</template>
        <template v-else>两份校验和一致：原代次的审核基准未变更，仍需按运行文件与容器事实逐项核对后终止。</template>
      </p>

      <p v-if="preview.already_fenced" role="status">原代次已有持久终止栅栏，本次仅核对后收口平台记录。</p>

      <div v-if="superseded" class="manual-recovery__superseded" role="note">
        <h5>审核基准已变更</h5>
        <p>平台无法把当前运行文件与容器事实当作原代次的核对依据，因此本次预检不提供这两张明细表（返回为空数组，不是读取失败）。</p>
        <p>可确认的只有否定证明：<strong>既无成功回执，也无终止结果</strong>。请另行核对原操作备份，并在原因中记录结论；无法核实的变化仍按未知副作用保留。</p>
      </div>

      <template v-else>
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
      </template>

      <label class="manual-recovery__reason">人工核对原因（10至500字，不填写密码或密钥）
        <textarea v-model="reason" :disabled="busy || resolved" maxlength="1000" rows="3" />
      </label>
      <label class="manual-recovery__confirm">
        <input v-model="confirmed" type="checkbox" :disabled="busy || resolved">
        <span v-if="superseded">我已核对原请求已结束、原错误来源与上表的收口语义，确认仅终止原代次，保留未知副作用，随后另行重试。</span>
        <span v-else>我已核对原请求已结束、原错误来源、原操作备份及现场事实，确认仅终止原代次，保留未知副作用，随后另行重试。</span>
      </label>
      <label v-if="superseded" class="manual-recovery__confirm manual-recovery__confirm--strong">
        <input v-model="confirmedSuperseded" type="checkbox" :disabled="busy || resolved">
        <span>我已逐字比对：原清单校验和与当前清单校验和<b>不同</b>，确认原代次已被取代，并接受无法再核对原运行事实。</span>
      </label>
      <button type="button" class="manual-recovery__terminate" :disabled="!canSubmit" @click="submitDecision">
        {{ superseded ? '确认原代次已被取代并收口' : '确认终止原代次' }}
      </button>
    </template>
    <p v-if="resolved" role="status">{{ resolvedMessage }}</p>
  </section>
</template>

<style scoped>
.manual-recovery { margin-top: 18px; scroll-margin-top: 16px; padding: 18px; border: 1px solid #e9c98a; border-radius: 12px; background: #fffcf5; color: #342e25; }
.manual-recovery__head { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; justify-content: space-between; }
.manual-recovery__head h4 { margin: 0 0 10px; }
.manual-recovery p { line-height: 1.6; }
.manual-recovery__actions { display: flex; gap: 10px; flex-wrap: wrap; }
.manual-recovery button { padding: 8px 12px; border: 1px solid #c8b99e; border-radius: 7px; background: white; cursor: pointer; }
.manual-recovery button:disabled { opacity: .5; cursor: not-allowed; }
.manual-recovery dl { display: grid; grid-template-columns: 110px minmax(0, 1fr); gap: 8px; }
.manual-recovery dd { margin: 0; overflow-wrap: anywhere; }

/* 模式徽章：沿用面板的暖色警示语义，只用深浅两档底色表达"是否已漂移"。 */
.manual-recovery__mode {
  flex: none; padding: 4px 10px; border: 1px solid #d8c49b; border-radius: 999px;
  background: #fff5e0; color: #7a5a13; font-size: 12px; font-weight: 600; white-space: nowrap;
}
.manual-recovery__mode[data-mode="superseded"] { border-color: #d99898; background: #fdeeee; color: #8f2929; }

/* 两份校验和并排，中间用一个符号表明"是否不同"；窄屏自动堆叠。 */
.manual-recovery__compare { display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); gap: 10px; align-items: stretch; margin: 16px 0 8px; }
.manual-recovery__checksum { display: grid; gap: 6px; padding: 10px 12px; border: 1px solid #e4daca; border-radius: 9px; background: #fff; }
.manual-recovery__checksum-label { font-size: 12px; color: #6b5f4d; }
.manual-recovery__checksum code { font-size: .86em; overflow-wrap: anywhere; }
.manual-recovery__compare-op { align-self: center; font-size: 18px; font-weight: 700; color: #6b5f4d; }
.manual-recovery__compare[data-mode="superseded"] .manual-recovery__checksum { border-color: #e7c4c4; }
.manual-recovery__compare[data-mode="superseded"] .manual-recovery__compare-op { color: #8f2929; }
.manual-recovery__compare-note { margin: 0 0 14px; font-size: 13px; }
.manual-recovery__compare-note[data-mode="superseded"] { color: #8f2929; }

/* 「审核基准已变更」说明块：替代两张空的运行事实表。 */
.manual-recovery__superseded { margin: 14px 0; padding: 12px 14px; border: 1px dashed #d99898; border-radius: 9px; background: #fdf6f6; }
.manual-recovery__superseded h5 { margin: 0 0 8px; font-size: 14px; }
.manual-recovery__superseded p { margin: 0 0 8px; }
.manual-recovery__superseded p:last-child { margin-bottom: 0; }

.manual-recovery table { width: 100%; table-layout: fixed; border-collapse: collapse; margin: 14px 0; }
.manual-recovery caption { text-align: left; font-weight: 600; padding: 6px 0; }
.manual-recovery th, .manual-recovery td { padding: 8px; border: 1px solid #e4daca; text-align: left; overflow-wrap: anywhere; }
.manual-recovery code { overflow-wrap: anywhere; font-size: .86em; }
.manual-recovery__reason { display: grid; gap: 6px; margin: 14px 0; }
.manual-recovery textarea { width: 100%; box-sizing: border-box; padding: 10px; border: 1px solid #c8b99e; border-radius: 7px; }
.manual-recovery__confirm { display: flex; align-items: flex-start; gap: 8px; margin: 12px 0; }
.manual-recovery__confirm--strong { color: #8f2929; }
.manual-recovery .manual-recovery__terminate { color: #8f2929; border-color: #d99898; }
.manual-recovery__error { color: #9f2222; }

@media (max-width: 620px) {
  .manual-recovery__compare { grid-template-columns: minmax(0, 1fr); }
  /* 堆叠后符号独占一行：做成居中的小圆牌，才不会被读成列表项。 */
  .manual-recovery__compare-op {
    justify-self: center; padding: 1px 10px; border: 1px solid #e4daca; border-radius: 999px;
    background: #fff; font-size: 13px; line-height: 1.6;
  }
  [data-theme="dark"] .manual-recovery__compare-op {
    border-color: var(--border); background: var(--surface-card); color: var(--danger-text);
  }
  .manual-recovery dl { grid-template-columns: minmax(0, 1fr); gap: 4px; }
}

/* 深色主题：人工恢复面板的暖白底、浅描边与警示墨色；浅色声明未改。 */
[data-theme="dark"] .manual-recovery {
  color: var(--text);
  border-color: var(--warning-border);
  background: var(--warning-soft);
}
[data-theme="dark"] .manual-recovery button {
  border-color: var(--border);
  background: var(--surface-raised);
  color: var(--text-secondary);
}
[data-theme="dark"] .manual-recovery button:hover:not(:disabled) {
  background: var(--surface-hover);
}
[data-theme="dark"] .manual-recovery th,
[data-theme="dark"] .manual-recovery td {
  border-color: var(--border);
}
[data-theme="dark"] .manual-recovery textarea {
  border-color: var(--border);
  background: var(--surface-input);
  color: var(--text);
}
[data-theme="dark"] .manual-recovery .manual-recovery__terminate {
  color: var(--danger-text);
  border-color: var(--danger-border);
}
[data-theme="dark"] .manual-recovery__error {
  color: var(--danger-text);
}
[data-theme="dark"] .manual-recovery__mode {
  border-color: var(--warning-border);
  background: var(--warning-soft-strong);
  color: var(--warning-text);
}
[data-theme="dark"] .manual-recovery__mode[data-mode="superseded"] {
  border-color: var(--danger-border);
  background: var(--danger-soft-strong);
  color: var(--danger-text);
}
[data-theme="dark"] .manual-recovery__checksum {
  border-color: var(--border);
  background: var(--surface-card);
  color: var(--text);
}
[data-theme="dark"] .manual-recovery__checksum-label,
[data-theme="dark"] .manual-recovery__compare-op { color: var(--text-muted); }
[data-theme="dark"] .manual-recovery__compare[data-mode="superseded"] .manual-recovery__checksum { border-color: var(--danger-border); }
[data-theme="dark"] .manual-recovery__compare[data-mode="superseded"] .manual-recovery__compare-op,
[data-theme="dark"] .manual-recovery__compare-note[data-mode="superseded"],
[data-theme="dark"] .manual-recovery__confirm--strong { color: var(--danger-text); }
[data-theme="dark"] .manual-recovery__superseded {
  border-color: var(--danger-border);
  background: var(--danger-soft);
}
</style>
