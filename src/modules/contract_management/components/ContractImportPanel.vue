<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { contractImportRequest, listContractImportBatches, releaseContractImportItem,
  getImportItemDocumentDescriptor, importItemSourceURL } from '../api/contract.js'
import ContractPDFPreview from './ContractPDFPreview.vue'
import { prepareImportManifest, formatImportMinor } from '../utils/contractImport.js'
import { validateContractSourceFile } from '../utils/contractPayload.js'
import { ensureStableReviewAttempt } from '../utils/opportunityIntakeReview.js'

const props = defineProps({ enabled: Boolean, pdfEnabled: Boolean, canPreview: { type: Boolean, default: true }, canCommit: Boolean,
  canApprove: Boolean, canRelease: Boolean, actorId: { type: String, default: '' }, initialBatchId: { type: String, default: '' },
  supportedModes: { type: Array, default: () => ['NORMAL'] } })
const text = ref(''), files = ref([]), batch = ref(null), batchID = ref(''), lookupID = ref(props.initialBatchId)
const busy = ref(false), error = ref(''), commitKey = ref(''), sourceSelectionVersion = ref(0)
const batches = ref([]), listOffset = ref(0), listNextOffset = ref(null), listHasMore = ref(false), listLimitReached = ref(false), document = ref(null), confirmationAttempt = ref(null), actionAttempt = ref(null)
const listBusy = ref(false), listError = ref('')
let timer = null, generation = 0, disposed = false
let documentGeneration = 0
const labels = { DRAFT: '待预检', BLOCKED: '需要修正', PREVIEWED: '预检完成', QUEUED: '等待执行', RUNNING: '正在创建记录', PARTIAL: '部分完成／需要恢复', PAUSED: '已暂停', CONFIRMATION_PENDING: '记录已创建，等待历史确认', TARGETS_PENDING: '历史已确认，等待各目标接续', COMPLETED: '本批次导入处理已完成' }
const modeLabels = { NORMAL: '普通新合同', ARCHIVE_ONLY: '历史存档', CONTINUE_LIVE: '接续履约', HISTORICAL_CLOSED: '历史结清档案' }
const targetLabels = { PROJECT: '项目接续', FINANCE: '财务接续', REPORT: '数析同步' }
const stateLabels = { WAITING_RELEASE: '待申请放行', WAITING: '等待依赖满足', QUEUED: '等待执行', RUNNING: '正在核对执行', HOLD: '暂未放行', PREPARING: '正在建立财务暂存', PREPARED: '财务已暂存，待恢复对账', READY: '核对就绪，尚未放行', RELEASE_REQUESTED: '放行已申请，等待实际应用', COMPLETE: '已完成', COMPLETED: '已完成', NOT_APPLICABLE: '不建立此类业务', FAILED: '执行失败，可核对恢复', BLOCKED: '需要处理阻塞', NEEDS_REVIEW: '合同版本变化，需核对', CORRECTION_REQUIRED: '已建单基线需要业务更正', CREATED: '记录已创建，正在完成文件引用', PENDING: '待处理', APPROVED: '确认通过', STARTING: '正在启动独立确认', REJECTED: '确认驳回', WITHDRAWN: '确认撤回', EXPIRED: '确认已超时' }
const historyItems = computed(() => (batch.value?.items || []).filter(entry => entry.item.mode !== 'NORMAL'))
const canVote = computed(() => props.canApprove && batch.value?.confirmation?.state === 'PENDING'
  && !(batch.value.confirmation.commands || []).some(command => command.actor_id === props.actorId && ['APPROVE','REJECT'].includes(command.action))
  && Object.entries(batch.value.confirmation.assignees || {}).some(([role, ids]) => Array.isArray(ids) && ids.includes(props.actorId) && !(batch.value.confirmation.approved_roles || []).includes(role)))

/**
 * refresh 查询已有结果；断网后保留批次号，不自动新建批次。
 * 参数：id为查询批次号，fromWrite仅供当前写命令收尾读取使用。
 * 返回值：Promise<void>；错误保留可见提示。
 */
async function refresh(id = lookupID.value.trim(), { fromWrite = false } = {}) {
  if (busy.value && !fromWrite) return
  const current = ++generation
  clearTimeout(timer)
  try {
    const result = await contractImportRequest('get', id)
    if (disposed || current !== generation) return
    batch.value = result
    const switched = batchID.value !== result.batch_id
    if (switched) {
      documentGeneration++; document.value = null; text.value = ''; files.value = []; sourceSelectionVersion.value++
      commitKey.value = ''; confirmationAttempt.value = null; actionAttempt.value = null
    }
    batchID.value = result.batch_id
    if (switched || lookupID.value.trim() === result.batch_id) lookupID.value = result.batch_id
    if (!text.value && result.items?.length) {
      text.value = JSON.stringify({ schema_version: 1, source_system: result.source_system, items: result.items.map((entry) => entry.item) }, null, 2)
    }
    error.value = ''
    const awaitingConfirmation = ['STARTING', 'PENDING'].includes(result.confirmation?.state)
    const awaitingTarget = result.items?.some(entry => entry.targets?.some(target => ['QUEUED', 'RUNNING', 'WAITING', 'RELEASE_REQUESTED'].includes(target.state)))
    if (['RUNNING', 'QUEUED'].includes(result.state) || awaitingConfirmation || awaitingTarget) timer = setTimeout(() => refresh(result.batch_id), awaitingConfirmation || awaitingTarget ? 5000 : 2000)
  } catch (failure) { if (!disposed && current === generation) error.value = failure.message }
}

/**
 * startNewBatch 打开下一批本地清单，已保存的服务端任务继续保留。
 * 参数：无；仅允许当前可新建且没有写请求在途的操作者。
 * 返回值：无；隔离旧读取和原件响应，清除本地文件及命令状态。
 */
function startNewBatch() {
  if (busy.value || !props.enabled || !props.canPreview) return
  clearTimeout(timer); generation++; documentGeneration++
  batch.value = null; batchID.value = ''; lookupID.value = ''
  text.value = ''; files.value = []; sourceSelectionVersion.value++
  document.value = null; commitKey.value = ''; error.value = ''
  confirmationAttempt.value = null; actionAttempt.value = null
}

/**
 * preview 建立批次、逐文件暂存后提交清单预检。
 * 参数：无；新文件按明确文件名选择，已暂存文件沿用精确file_ref。
 * 返回值：Promise<void>；任一不确定结果保留批次号并要求先查询。
 */
async function preview() {
  generation++; clearTimeout(timer)
  busy.value = true; error.value = ''
  try {
    if (batch.value?.operation_id && !['PAUSED', 'PARTIAL', 'DRAFT', 'BLOCKED', 'PREVIEWED'].includes(batch.value.state)) throw new Error('请先暂停批次并查询结果，只有未建单项可修订。')
    const prepared = prepareImportManifest(text.value, files.value, batch.value?.sources || [], props.supportedModes)
    for (const file of files.value) validateContractSourceFile(file, { pdfEnabled: props.pdfEnabled })
    if (!batch.value) {
      const created = await contractImportRequest('create', '', { schema_version: 1, source_system: prepared.manifest.source_system })
      batch.value = created; batchID.value = created.batch_id; lookupID.value = created.batch_id
    }
    if (batch.value.source_system !== prepared.manifest.source_system) throw new Error('来源系统不能在批次内改变。')
    for (const item of prepared.manifest.items) {
      if (prepared.stagedByKey.has(item.item_key)) { item.source_file_ref = prepared.stagedByKey.get(item.item_key); continue }
      const form = new FormData()
      form.set('file', prepared.filesByName.get(item.source_file_ref))
      form.set('item_key', item.item_key); form.set('expected_version', String(batch.value.version))
      const source = await contractImportRequest('files', batchID.value, form)
      item.source_file_ref = source.file_ref
      batch.value = await contractImportRequest('get', batchID.value)
    }
    batch.value = await contractImportRequest('manifest', batchID.value, { expected_version: batch.value.version, manifest: prepared.manifest })
    batch.value = await contractImportRequest('preview', batchID.value, { revision: batch.value.revision })
    text.value = JSON.stringify({ schema_version: 1, source_system: batch.value.source_system, items: batch.value.items.map(entry => entry.item) }, null, 2)
    files.value = []; sourceSelectionVersion.value++; commitKey.value = ''; confirmationAttempt.value = null
  } catch (failure) { if (batchID.value) await refresh(batchID.value, { fromWrite: true }); error.value = `${failure.message}${batchID.value ? ' 批次已保留，请先查询状态。' : ''}` }
  finally { busy.value = false }
}

/**
 * commit 提交冻结预检，不把202受理表示为审批通过。
 * 参数：无；重试复用当前预检与幂等键。
 * 返回值：Promise<void>；未知响应先查询稳定操作。
 */
async function commit() {
  generation++; clearTimeout(timer)
  busy.value = true
  try {
    if (!commitKey.value) commitKey.value = ensureStableReviewAttempt(null, { intakeId: batchID.value, decision: 'import', version: batch.value.revision, reason: batch.value.preview_token }).key
    batch.value = await contractImportRequest('commit', batchID.value, { revision: batch.value.revision, preview_token: batch.value.preview_token }, commitKey.value)
    await refresh(batchID.value, { fromWrite: true })
  } catch (failure) { await refresh(batchID.value, { fromWrite: true }); error.value = `${failure.message} 请核对当前操作号和逐项状态。` }
  finally { busy.value = false }
}

/**
 * control 暂停或恢复持久任务，采用服务器最新版本。
 * 参数：action为pause或resume。
 * 返回值：Promise<void>；冲突时刷新结果而非新建合同。
 */
async function control(action) {
  generation++; clearTimeout(timer)
  busy.value = true
  try { batch.value = await contractImportRequest(action, batchID.value, { expected_version: batch.value.version }); await refresh(batchID.value, { fromWrite: true }) }
  catch (failure) { await refresh(batchID.value, { fromWrite: true }); error.value = failure.message }
  finally { busy.value = false }
}

/**
 * loadBatches 查询当前权限范围内的创建批次及受派确认任务。
 * 参数：offset为服务端候选游标，默认刷新当前页。
 * 返回值：Promise<void>；错误保留可见提示。
 */
async function loadBatches(offset = listOffset.value) {
  if (busy.value || listBusy.value || !Number.isInteger(offset) || offset < 0 || offset > 10000) return
  listBusy.value = true; listError.value = ''
  try {
    const result = await listContractImportBatches(offset)
    if (typeof result.has_more !== 'boolean' || (result.has_more
      && (!Number.isInteger(result.next_offset) || result.next_offset <= offset || result.next_offset > 10000))) {
      throw new Error('批次分页响应不完整，请刷新或按批次号查询。')
    }
    if (!disposed) {
      batches.value = result.items || []; listOffset.value = offset
      listHasMore.value = result.has_more; listNextOffset.value = result.next_offset
      listLimitReached.value = result.query_limit_reached === true
    }
  } catch (failure) { if (!disposed) listError.value = failure.message }
  finally { if (!disposed) listBusy.value = false }
}

/**
 * confirmation 执行独立历史确认申请或当前可信角色的确认命令。
 * 参数：action为空表示提交，否则为APPROVE、REJECT或WITHDRAW。
 * 返回值：Promise<void>；未知响应先查询，不从客户端宣布通过。
 */
async function confirmation(action = '') {
  generation++; clearTimeout(timer)
  busy.value = true
  try {
    if (!action) {
      confirmationAttempt.value = ensureStableReviewAttempt(confirmationAttempt.value, { intakeId: batchID.value, decision: 'confirmation', version: batch.value.revision, reason: batch.value.preview_token })
      await contractImportRequest('submit-confirmation', batchID.value, { revision: batch.value.revision, preview_token: batch.value.preview_token }, confirmationAttempt.value.key)
    } else {
      const workflow = batch.value.confirmation?.workflow_id || ''
      if ((batch.value.confirmation?.commands || []).some(command => command.actor_id === props.actorId && command.action === action)) { await refresh(batchID.value, { fromWrite: true }); return }
      if (!actionAttempt.value || actionAttempt.value.batchID !== batchID.value || actionAttempt.value.workflow !== workflow || actionAttempt.value.action !== action) {
        const attempt = ensureStableReviewAttempt(null, { intakeId: batchID.value, decision: action, version: batch.value.version, reason: workflow })
        actionAttempt.value = { ...attempt, batchID: batchID.value, workflow, action, expectedVersion: batch.value.version }
      }
      await contractImportRequest('confirmation-actions', batchID.value, { expected_version: actionAttempt.value.expectedVersion, command_key: actionAttempt.value.key, action })
    }
    await refresh(batchID.value, { fromWrite: true })
  } catch (failure) {
    await refresh(batchID.value, { fromWrite: true })
    if (action && failure.status >= 400 && failure.status < 500 && ![408,429].includes(failure.status)) actionAttempt.value = null
    error.value = `${failure.message} 请先核对确认状态与命令结果。`
  }
  finally { busy.value = false }
}

/**
 * release 申请项目、财务或数析独立目标命令。
 * 参数：entry为持久单项，target为服务器目标状态，phase明确财务准备或放行。
 * 返回值：Promise<void>；完成与否只看服务器实际回执。
 */
async function release(entry, target, phase = 'RELEASE') {
  generation++; clearTimeout(timer)
  busy.value = true
  try { await releaseContractImportItem(entry.id, { target: target.target, expected_version: target.version, phase }); await refresh(batchID.value, { fromWrite: true }) }
  catch (failure) { await refresh(batchID.value, { fromWrite: true }); error.value = failure.message }
  finally { busy.value = false }
}

/**
 * canRetryProjectRejection 只为项目端明确参数拒绝显示同命令恢复入口。
 * 参数：target为服务端持久目标及真实拒绝分类。
 * 返回值：是否可提出重试；权限、版本及冻结基线仍由服务端强制核验。
 */
function canRetryProjectRejection(target) {
  return target.target === 'PROJECT' && target.phase === 'RELEASE'
    && target.state === 'BLOCKED' && target.recipient_http_status === 422
    && target.recipient_code === 'IMPORT_VALIDATION_FAILED'
}

/**
 * viewSource 读取受批次及冻结受派权限保护的同一原件描述。
 * 参数：entry为当前批次项。
 * 返回值：Promise<void>；迟到描述不会显示到另一批次。
 */
async function viewSource(entry) {
  const ticket = ++documentGeneration, id = batchID.value
  try {
    const descriptor = await getImportItemDocumentDescriptor(id, entry.id)
    if (disposed || ticket !== documentGeneration || id !== batchID.value) return
    document.value = { ...descriptor, batchID: id, itemID: entry.id }
  } catch (failure) { if (ticket === documentGeneration) error.value = failure.message }
}

/**
 * closeSource 关闭当前冻结原件并隔离迟到的描述响应。
 * 参数：无。
 * 返回值：无；PDF子组件卸载时释放当前Object URL。
 */
function closeSource() { documentGeneration++; document.value = null }

onMounted(() => { if (props.initialBatchId) refresh(props.initialBatchId) })

onBeforeUnmount(() => { disposed = true; generation++; documentGeneration++; clearTimeout(timer) })
</script>

<template>
  <details class="contract-import-panel">
    <summary>批量导入外部合同原件</summary>
    <p>当前开放：{{ supportedModes.map(mode => modeLabels[mode] || mode).join('、') }}。普通合同仍需逐份走现有审批；历史合同走当前独立导入确认，各子系统分别核对放行。</p>
    <p>历史签署日期是来源声明，导入确认不补造原年度审批，也不替代签署原件核验。</p>
    <p v-if="!enabled">新增批次已关闭；已有批次仍可查询、暂停与恢复。</p>
    <button v-if="enabled && canPreview" type="button" :disabled="busy" @click="startNewBatch">开始新批次（保留已保存任务）</button>
    <label>查询批次号 <input v-model="lookupID" maxlength="26" :disabled="busy" autocomplete="off" /></label>
    <button type="button" :disabled="busy || !lookupID" @click="refresh(lookupID)">查询／刷新结果</button>
    <button type="button" :disabled="busy || listBusy" @click="loadBatches()">我的批次与待确认任务</button>
    <p v-if="listBusy" role="status">正在查询批次列表…</p>
    <p v-if="listError" role="alert">{{ listError }}</p>
    <div class="contract-import-task-list"><button v-for="record in batches" :key="record.batch_id" type="button" :disabled="busy" @click="refresh(record.batch_id)">{{ record.batch_id }} · {{ labels[record.state] || record.state }}</button></div>
    <div v-if="batches.length || listOffset || listHasMore" class="contract-import-task-list"><button type="button" :disabled="busy || listBusy || !listOffset" @click="loadBatches(Math.max(0, listOffset - 50))">列表上一页</button><button type="button" :disabled="busy || listBusy || !listHasMore" @click="loadBatches(listNextOffset)">列表下一页</button></div>
    <p v-if="listLimitReached">已到达批次列表查询上限，请使用批次号定位需要处理的记录。</p>
    <template v-if="enabled && canPreview && !['STARTING','PENDING','APPROVED'].includes(batch?.confirmation?.state) && (!batch?.operation_id || ['PAUSED','PARTIAL','DRAFT','BLOCKED','PREVIEWED'].includes(batch.state))">
      <p v-if="batch?.operation_id">已建单项须原样保留，只能修订尚未建单项；新修订会使旧预检和执行代次失效。已建单内容更正需先核对原合同。</p>
      <label>UTF-8 JSON 清单（≤2MiB，1—100项）<textarea v-model="text" maxlength="2097152" rows="8" :disabled="busy" placeholder='{"schema_version":1,"source_system":"legacy","items":[{"item_key":"one","external_record_id":"原业务键","mode":"NORMAL","source_file_ref":"原件.pdf","metadata":{}}]}' /></label>
      <p>每项 metadata 填写完整合同字段；source_file_ref 在此处填写对应文件名，须与所选原件一一匹配。不会从 PDF 猜测金额、客户或分期。</p>
      <p v-if="batch">已暂存项保留当前 file_ref；需要更换原件时，将该行 source_file_ref 改为新选择的文件名。相同文件名的历史代次不会自动替换当前原件。</p>
      <label>选择对应原件 <input :key="sourceSelectionVersion" type="file" multiple :accept="pdfEnabled ? '.docx,.pdf' : '.docx'" :disabled="busy" @change="files = Array.from($event.target.files || [])" /></label>
      <p v-if="files.length">已选择：{{ files.map(file => file.name).join('、') }}</p>
      <button type="button" :disabled="busy || !text" @click="preview">{{ batch ? '继续暂存／修订并重新预检' : '暂存并逐项预检' }}</button>
    </template>
    <p v-if="error" role="alert">{{ error }}</p>
    <template v-if="batch">
      <p role="status">批次 {{ batch.batch_id }} · 第 {{ batch.revision }} 版 · {{ labels[batch.state] || batch.state }}</p>
      <p v-if="batch.operation_id">操作号：{{ batch.operation_id }}。请保留批次号，重新登录或刷新页面后可查询恢复。</p>
      <div class="contract-import-scroll"><table><thead><tr><th>单项</th><th>来源业务键</th><th>状态／合同ID</th><th>字段及错误</th></tr></thead><tbody>
        <tr v-for="entry in batch.items" :key="entry.id"><td>{{ entry.item.item_key }} · {{ modeLabels[entry.item.mode] }}<br /><small>原件：{{ batch.sources.find(source => source.file_ref === entry.item.source_file_ref)?.filename }}<br />{{ entry.item.source_file_ref }}</small><button v-if="entry.contract_id" type="button" :disabled="busy" @click="viewSource(entry)">查看冻结原件</button></td><td>{{ entry.item.external_record_id }}<p>纸面编号：{{ entry.item.metadata.external_paper_number || '未提供' }}</p><p v-if="entry.item.history_evidence">声明签署日：{{ entry.item.history_evidence.declared_signed_date || '未声明' }}<br />原终态／履约态：{{ entry.item.history_evidence.historical_status }}</p></td><td>{{ stateLabels[entry.state] || entry.state }}<br />{{ entry.contract_id || '尚未建单' }}<p v-if="entry.normalized_metadata">权威客户：{{ entry.normalized_metadata.customer_name }}<br />客户ID：{{ entry.normalized_metadata.crm_customer_id }}<br />规范金额：{{ entry.normalized_metadata.currency }} {{ formatImportMinor(entry.normalized_metadata.amount_minor) }}</p><p v-if="entry.item.metadata.customer_name !== entry.normalized_metadata?.customer_name">清单客户声明：{{ entry.item.metadata.customer_name }}</p></td><td><p v-for="issue in entry.issues" :key="issue.field_path + issue.code">{{ issue.field_path }}：{{ issue.code }}{{ issue.retryable ? '（可恢复）' : '' }}</p></td></tr>
      </tbody></table></div>
      <p v-if="batch.state === 'PREVIEWED'">预计创建 {{ batch.items.filter(entry => !entry.contract_id).length }} 份记录；本次不免审生效。普通模式之后逐份审批；历史模式之后独立确认，再分别放行项目、财务和报表。</p>
      <p v-if="!batch.can_commit">当前身份可查看此批次；提交和恢复须由具有导入提交权限的批次创建人执行。</p>
      <button v-if="batch.state === 'PREVIEWED' && !historyItems.length && canCommit && batch.can_commit" type="button" :disabled="busy" @click="commit">确认冻结清单并创建草稿</button>
      <button v-if="['RUNNING','QUEUED'].includes(batch.state) && canCommit && batch.can_commit" type="button" :disabled="busy" @click="control('pause')">暂停新认领</button>
      <button v-if="['PAUSED','PARTIAL'].includes(batch.state) && canCommit && batch.can_commit && !batch.items.some(entry => ['CORRECTION_REQUIRED','NEEDS_REVIEW'].includes(entry.state))" type="button" :disabled="busy" @click="control('resume')">重新授权并恢复原操作</button>
      <section v-if="historyItems.length" aria-label="历史导入确认及分目标接续">
        <h3>历史导入独立确认</h3>
        <p>确认对象为本批次当前冻结的原件、字段、原业务事实及子系统政策。已创建记录不代表历史接续已经完成。</p>
        <button v-if="canCommit && batch.can_commit && batch.state === 'PREVIEWED' && !['STARTING','PENDING','APPROVED'].includes(batch.confirmation?.state)" type="button" :disabled="busy" @click="confirmation()">冻结清单、建立历史记录并提交独立确认</button>
        <template v-if="batch.confirmation">
          <p>当前确认：{{ stateLabels[batch.confirmation.state] || batch.confirmation.state }}；冻结修订 {{ batch.confirmation.revision }}。</p>
          <p>要求角色：{{ batch.confirmation.roles.join('、') }}；已确认：{{ batch.confirmation.approved_roles?.join('、') || '无' }}。</p>
          <button v-if="canVote" type="button" :disabled="busy" @click="confirmation('APPROVE')">确认本次历史导入基线</button>
          <button v-if="canVote" type="button" :disabled="busy" @click="confirmation('REJECT')">驳回本次历史导入</button>
          <button v-if="canCommit && batch.can_commit && ['STARTING','PENDING'].includes(batch.confirmation.state)" type="button" :disabled="busy" @click="confirmation('WITHDRAW')">撤回本次确认</button>
        </template>
        <article v-for="entry in historyItems" :key="entry.id" class="contract-import-targets">
          <h4>{{ entry.item.item_key }} · {{ entry.confirmed ? '当前历史基线已确认' : '等待当前独立确认' }}</h4>
          <p>项目政策 {{ entry.item.policy_options.project_mode }}；财务政策 {{ entry.item.policy_options.finance_mode }}；报表政策 {{ entry.item.policy_options.report_mode }}。</p>
          <p v-if="entry.item.policy_options.finance_mode === 'EVIDENCE_ONLY'">仅保存原财务证明，未在结算重建财务台账，不能将此项解释为结算已核验零余额。</p>
          <div v-for="target in entry.targets" :key="target.target">
            <strong>{{ targetLabels[target.target] }}</strong>：{{ stateLabels[target.state] || target.state }}<span v-if="target.error_code && target.state !== 'COMPLETE'"> · {{ target.error_code }}</span>
            <span v-if="target.receipt_id"> · 实际回执 {{ target.receipt_id }}</span>
            <p v-if="target.state === 'BLOCKED' && target.recipient_http_status === 409 && target.recipient_code === 'SETTLEMENT_CONFLICT'">接收方已明确拒绝旧放行。财务须先重新对账；再次申请会严格核对新凭证、政策与责任，并保留旧命令记录。来源或政策不一致仍阻断。</p>
            <p v-if="canRetryProjectRejection(target)">项目端明确拒绝参数或负责人。请核对项目负责人在目标环境的有效授权及冻结字段；恢复仅重试原命令，不修改已确认基线。</p>
            <template v-if="canRelease && entry.confirmed && !['COMPLETE','NOT_APPLICABLE'].includes(target.state) && (target.state !== 'BLOCKED' || canRetryProjectRejection(target) || (target.target === 'FINANCE' && target.phase === 'RELEASE' && target.recipient_http_status === 409 && target.recipient_code === 'SETTLEMENT_CONFLICT'))">
              <button v-if="target.target === 'FINANCE' && !target.receipt_id" type="button" :disabled="busy" @click="release(entry, target, 'PREPARE')">建立／恢复财务HOLD暂存</button>
              <button v-else-if="canRetryProjectRejection(target)" type="button" :disabled="busy" @click="release(entry, target)">核对项目参数和负责人后重试同一命令</button>
              <button v-else type="button" :disabled="busy" @click="release(entry, target)">{{ target.target === 'FINANCE' ? (target.state === 'BLOCKED' ? '重新核对并申请财务放行' : '核验对账和责任后申请财务放行') : target.target === 'REPORT' ? '申请／查询真实数析应用' : '申请／恢复项目绑定' }}</button>
            </template>
            <a v-if="target.target === 'FINANCE' && target.receipt_id" :href="`/settlement/imports?import_snapshot=${encodeURIComponent(target.receipt_id)}`">前往财务恢复工作台</a>
          </div>
        </article>
      </section>
    </template>
    <section v-if="document" aria-label="冻结导入原件">
      <button type="button" @click="closeSource">关闭原件</button>
      <ContractPDFPreview v-if="document.format === 'PDF'" :descriptor="document" title="当前导入基线的PDF原件" />
      <a v-else :href="importItemSourceURL(document.batchID, document.itemID)">下载冻结的 DOCX 原件</a>
    </section>
  </details>
</template>

<style scoped>
.contract-import-panel { padding: 16px; margin-block: 16px; border: 1px solid #cbd5e1; border-radius: 8px; background: white; }
.contract-import-panel label { display: block; margin-block: 12px; }
.contract-import-panel textarea { display: block; width: 100%; box-sizing: border-box; }
.contract-import-panel input { max-width: 100%; }
.contract-import-panel p { overflow-wrap: anywhere; }
.contract-import-panel button { margin: 4px; padding: 8px; }
.contract-import-scroll { overflow-x: auto; }
.contract-import-panel th,.contract-import-panel td { padding: 8px; text-align: left; vertical-align: top; }
.contract-import-task-list { display: flex; flex-wrap: wrap; }
.contract-import-targets { padding: 12px; border-block-start: 1px solid #d9e1ec; }
.contract-import-targets div { margin-block: 8px; }
</style>
